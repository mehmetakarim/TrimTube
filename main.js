const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

// macOS'ta GUI/Finder üzerinden başlatıldığında Homebrew ve yerel bin yollarını PATH'e ekle
if (process.platform === 'darwin') {
  process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`;
}

// Beklenmeyen bir hata (ör. bir alt süreç/promise'te öngörülmeyen bir durum)
// artık tüm uygulamayı çökertmesin — Node'un varsayılan davranışı işlenmemiş
// promise reddini/istisnayı fatal sayıp süreci sonlandırmaktır. Loglanır,
// uygulama açık kalır; kullanıcı en kötü ihtimalle o işlemi tekrar dener.
// Paketlenmiş uygulamada ana süreç konsolu görünmez (terminal yok); hatayı
// DevTools'ta (F12) görülebilsin diye render sürecine de ilet.
function reportFatal(label, err) {
  console.error(label, err);
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send('main-error', `${label} ${err && err.message ? err.message : err}`);
    }
  } catch {}
}
process.on('uncaughtException', (err) => reportFatal('[uncaughtException]', err));
process.on('unhandledRejection', (err) => reportFatal('[unhandledRejection]', err));

// --- Kalıcı ayarlar (userData/settings.json) ---
// electron-store bağımlılığı eklemeden basit bir JSON store. Varsayılan kalite/
// format/klasör, tema ve önbellek limiti burada tutulur. app.whenReady öncesinde
// de okunabilmesi için app.getPath yerine tembel yükleme kullanılır.
const SETTINGS_DEFAULTS = {
  theme: 'system',        // system | light | dark
  cacheLimit: 2,          // önbellekte tutulacak video sayısı (1-10)
  defaultQuality: 'best',
  defaultFormats: ['original'],
  lastFolder: null
};
let settingsCache = null;
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  if (settingsCache) return settingsCache;
  try {
    settingsCache = { ...SETTINGS_DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    settingsCache = { ...SETTINGS_DEFAULTS };
  }
  return settingsCache;
}
function saveSettings(patch) {
  settingsCache = { ...loadSettings(), ...patch };
  try { fs.writeFileSync(settingsPath(), JSON.stringify(settingsCache, null, 2), 'utf8'); } catch {}
  return settingsCache;
}

ipcMain.handle('get-settings', () => ({ ...loadSettings(), appVersion: app.getVersion() }));
ipcMain.handle('set-settings', (e, patch) => saveSettings(patch));

let win = null;
let currentProc = null;
let cancelRequested = false;

// yt-dlp (PyInstaller/Python) çıktısının Windows'ta UTF-8 olması için
const procEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };

// Paketlenmiş uygulamada yt-dlp, resources/bin altına gömülür (bkz. scripts/fetch-ytdlp.js
// ve package.json > build.win/mac.extraResources); geliştirme ortamında sistemdeki PATH kullanılır.
function resolveYtdlp() {
  if (app.isPackaged) {
    const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const bundled = path.join(process.resourcesPath, 'bin', exe);
    if (fs.existsSync(bundled)) return bundled;
  }
  return 'yt-dlp';
}

// ffmpeg, ffmpeg-static paketiyle gömülür — hem geliştirme hem paketlenmiş sürümde
// sistemde kurulu olmasına gerek kalmaz.
function resolveFfmpeg() {
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

// Kişi takibi (tracker): paketlenmiş sürümde PyInstaller ile dondurulmuş ikili
// resources/bin altında gelir (Python kurulumu gerekmez — Faz 10-B); geliştirme
// ortamında sistemdeki python + tracker.py kullanılır. subtitle.py (Whisper)
// hâlâ sistem Python'ı gerektirir (dev bağımlılığı; frozen kapsamı dışında).
function resolveTracker() {
  if (app.isPackaged) {
    const exe = process.platform === 'win32' ? 'tracker.exe' : 'tracker';
    const bundled = path.join(process.resourcesPath, 'bin', exe);
    if (fs.existsSync(bundled)) return { cmd: bundled, prefix: [] };
  }
  const py = process.platform === 'win32' ? 'python' : 'python3';
  return { cmd: py, prefix: [path.join(__dirname, 'tracker.py')] };
}

const YTDLP = resolveYtdlp();
const FFMPEG = resolveFfmpeg();
const TRACKER = resolveTracker();

// --- GPU hızlandırmalı kodlama ---
// Gömülü ffmpeg-static ikilisi NVENC/QuickSync/AMF (Win/Linux) ve VideoToolbox
// (macOS) ile derlenmiş, ancak gerçek kullanılabilirlik kullanıcının donanım/
// sürücüsüne bağlı — bu yüzden varsayımla değil, küçük bir test kodlamasıyla
// çalışma zamanında tespit edilir. Bulunamazsa veya render sırasında hata
// verirse CPU'ya (libx264) sessizce düşülür.
const ENCODER_CANDIDATES = {
  win32: ['h264_nvenc', 'h264_qsv', 'h264_amf'],
  linux: ['h264_nvenc', 'h264_qsv', 'h264_amf'],
  darwin: ['h264_videotoolbox']
};

function probeEncoder(codec) {
  return new Promise((resolve) => {
    const args = ['-f', 'lavfi', '-i', 'color=c=black:s=160x90:d=0.5', '-frames:v', '5', '-c:v', codec, '-f', 'null', '-'];
    const proc = spawn(FFMPEG, args, { windowsHide: true, env: procEnv });
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    const timer = setTimeout(() => { try { proc.kill(); } catch {} finish(false); }, 8000);
    proc.on('close', (code) => { clearTimeout(timer); finish(code === 0); });
    proc.on('error', () => { clearTimeout(timer); finish(false); });
  });
}

let encoderPromise = null;
function getEncoder() {
  if (!encoderPromise) {
    encoderPromise = (async () => {
      for (const codec of ENCODER_CANDIDATES[process.platform] || []) {
        if (await probeEncoder(codec)) return codec;
      }
      return 'libx264';
    })();
  }
  return encoderPromise;
}

// Donanım kodlayıcıyla eşleşen donanım çözücü (decode) bayrağı. Ölçüldü:
// GPU'da yalnızca kodlama %10-15 kazandırıyor; asıl kazanç (2-2.5x) 4K/AV1
// gibi ağır kaynakların çözme adımı da GPU'ya taşındığında ortaya çıkıyor.
// Gerçek dosyada çözme başarısız olursa runEncodeWithFallback zaten CPU'ya
// düşer, bu yüzden ayrı bir çözme probu gerekmiyor.
const HWACCEL_FOR_ENCODER = {
  h264_nvenc: ['-hwaccel', 'cuda'],
  h264_qsv: ['-hwaccel', 'qsv'],
  h264_amf: process.platform === 'win32' ? ['-hwaccel', 'd3d11va'] : [],
  h264_videotoolbox: ['-hwaccel', 'videotoolbox']
};
function hwaccelArgs(codec) {
  return HWACCEL_FOR_ENCODER[codec] || [];
}

// crf: 0-51 arası kalite hedefi (libx264 ölçeği); diğer kodlayıcılar için
// en yakın karşılığa çevrilir.
function videoEncodeArgs(codec, crf) {
  switch (codec) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', String(crf), '-b:v', '0'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', String(crf)];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf + 2)];
    case 'h264_videotoolbox':
      // -q:v 1-100 (yüksek=iyi kalite), crf'in tersi yönde; kabaca karşılık
      return ['-c:v', 'h264_videotoolbox', '-q:v', String(Math.max(1, 100 - crf * 3))];
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf)];
  }
}

// buildArgs(hwaccel, videoArgs) → tam ffmpeg argüman listesi (hwaccel bayrağı
// -i'den önceki uygun konuma, videoArgs -c:v olarak yerleştirilir). Donanım
// çözme/kodlama gerçek render sırasında (probe'u geçmesine rağmen) hata
// verirse tek seferlik tam CPU'ya düşüşle otomatik tekrar dener.
async function runEncodeWithFallback(buildArgs, crf, onLine, cwd) {
  const encoder = await getEncoder();
  const r1 = await runProc(FFMPEG, buildArgs(hwaccelArgs(encoder), videoEncodeArgs(encoder, crf)), onLine, cwd);
  if (r1.code === 0 || encoder === 'libx264' || cancelRequested) return r1;
  win.webContents.send('log', `GPU kodlama (${encoder}) başarısız oldu, CPU ile devam ediliyor…`);
  return runProc(FFMPEG, buildArgs([], videoEncodeArgs('libx264', crf)), onLine, cwd);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: 'TrimTube',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // F12: sorun bildirimlerinde konsol hatasını görebilmek için DevTools
  win.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') win.webContents.toggleDevTools();
  });
}

// GitHub Releases'teki en son (Draft/Prerelease olmayan) sürümü kontrol eder.
// İşletim sisteminin kendi (opak) bildirim/otomatik-kurulum akışı yerine
// tamamen uygulama içi kart üzerinden, kullanıcının açıkça "Güncelle" ve
// "Yeniden başlat" butonlarına basmasıyla ilerleyen bir akış kullanılır —
// hem şeffaf hem de sessiz kurulum hatalarının fark edilmesini sağlar.
// macOS'ta uygulama kod imzasız olduğu için indirme/kurulum başarısız
// olabilir; bu durumda hata kart üzerinde gösterilir. Linux (.deb) hedefi
// electron-updater tarafından desteklenmediği için atlanır.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function initAutoUpdate() {
  if (!app.isPackaged) return;
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('update-available', info.version);
  });
  autoUpdater.on('download-progress', (p) => {
    win.webContents.send('update-progress', Math.round(p.percent));
  });
  autoUpdater.on('update-downloaded', () => {
    win.webContents.send('update-ready');
  });
  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater]', err.message);
    win.webContents.send('update-error', err.message);
  });

  autoUpdater.checkForUpdates().catch((err) => console.error('[autoUpdater]', err.message));
}

// macOS'ta imzasız uygulamada oto-kurulum imza doğrulamasına takılır; kullanıcı
// bunun yerine en son release'i tarayıcıda açıp dmg'yi elle indirir.
ipcMain.handle('open-release-page', () => shell.openExternal('https://github.com/mehmetakarim/TrimTube/releases/latest'));

ipcMain.handle('update-download', () => autoUpdater.downloadUpdate());
// isSilent=false: kurulum sihirbazı görünür açılır (sessiz kurulumda oluşabilecek
// hataların kullanıcı tarafından fark edilmeden uygulamanın silinmesini önler).
// isForceRunAfter=true: kurulum bitince uygulama otomatik yeniden başlar.
ipcMain.handle('update-install', () => autoUpdater.quitAndInstall(false, true));

app.whenReady().then(() => {
  createWindow();
  initAutoUpdate();
  getEncoder().then((e) => console.log('[encoder]', e)); // ilk render'dan önce arka planda tespit edilsin
});
app.on('window-all-closed', () => app.quit());

// yt-dlp'nin stderr çıktısından kullanıcıya gösterilebilir hata mesajı ayıklar
// yt-dlp'nin ham İngilizce hatalarını bilinen kalıplara göre anlaşılır Türkçe
// karşılıklara çevirir. Eşleşme yoksa ham ERROR satırı gösterilir (teşhis için).
const ERROR_PATTERNS = [
  [/Sign in to confirm your age|age-restricted|inappropriate for some users/i,
    'Bu video yaş kısıtlamalı. YouTube oturum açmadan indirilemiyor.'],
  [/Private video|This video is private/i,
    'Bu video gizli (private) olarak işaretlenmiş, indirilemiyor.'],
  [/members-only|join this channel/i,
    'Bu video yalnızca kanal üyelerine açık, indirilemiyor.'],
  [/video is unavailable|video has been removed|no longer available|account.*terminated/i,
    'Bu video kaldırılmış veya artık kullanılamıyor.'],
  [/not available in your country|geo|blocked it in your country/i,
    'Bu video bulunduğunuz bölgede erişime kapalı.'],
  [/This live event will begin|Premieres in|is not currently live/i,
    'Bu bir canlı yayın/prömiyer; henüz yayınlanmadığı için indirilemiyor.'],
  [/Sign in to confirm.*not a bot|confirm you.?re not a robot/i,
    'YouTube bot doğrulaması istiyor. Bir süre sonra tekrar deneyin.'],
  [/Unable to download webpage|Failed to resolve|getaddrinfo|Temporary failure in name resolution|Connection.*timed out|Network is unreachable/i,
    'İnternet bağlantısı kurulamadı. Bağlantınızı kontrol edip tekrar deneyin.'],
  [/Unsupported URL|is not a valid URL|Unable to extract/i,
    'Bağlantı tanınamadı. Geçerli bir YouTube video bağlantısı olduğundan emin olun.'],
  [/HTTP Error 429|Too Many Requests/i,
    'YouTube çok fazla istek nedeniyle geçici olarak engelledi. Birkaç dakika sonra deneyin.']
];

function extractError(stderr) {
  const raw = stderr || '';
  for (const [re, msg] of ERROR_PATTERNS) {
    if (re.test(raw)) return msg;
  }
  const lines = raw.split(/\r?\n/).filter(l => l.includes('ERROR'));
  return lines.length ? lines.join('\n') : (raw || 'Bilinmeyen hata');
}

function toSec(hms) {
  return hms.split(':').reverse().reduce((acc, p, i) => acc + parseInt(p, 10) * Math.pow(60, i), 0);
}

// Bir alt süreci çalıştırır, stdout satırlarını onLine'a iletir.
// UTF-8 karakterlerin chunk sınırında bölünmemesi için StringDecoder kullanır.
function runProc(cmd, args, onLine, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { windowsHide: true, env: procEnv, cwd });
    currentProc = proc;
    const dec = new StringDecoder('utf8');
    let buf = '';
    let errBuf = '';
    proc.stdout.on('data', (d) => {
      buf += dec.write(d);
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach((l) => { if (l.trim()) onLine(l); });
    });
    proc.stderr.on('data', (d) => { errBuf += d.toString('utf8'); });
    proc.on('close', (code) => { currentProc = null; resolve({ code, stderr: errBuf }); });
    proc.on('error', (err) => { currentProc = null; resolve({ code: -1, stderr: err.message }); });
  });
}

// --- İnce ayar şeridi için dalga formu üretimi ---
// Önizleme akışının (360p progressive mp4) yalnızca istenen aralığını HTTP range
// ile okuyup showwavespic ile PNG üretir. İndirme/kesme işlerinden bağımsızdır:
// currentProc'a dokunmaz (İptal butonu dalga formunu öldürmesin), kendi içinde
// önceki isteği iptal eder (kullanıcı slider'ı hızlı oynattığında birikme olmasın).
let waveformProc = null;

// Video zaten önbelleğe indirilmişse dalga formunu uzak YouTube akışı yerine
// yerel dosyadan üret: <1 sn sürer, ağ hızından/YouTube kısıtlamasından
// bağımsızdır. Kalite ne seçilmiş olursa olsun ses içeriği aynıdır, bu yüzden
// bu id ile başlayan herhangi bir önbellek dosyası iş görür.
function findCachedMedia(videoId) {
  if (!videoId) return null;
  try {
    const cacheDir = path.join(app.getPath('userData'), 'cache');
    const hit = fs.readdirSync(cacheDir).find(f =>
      f.startsWith(`${videoId}_`) && (f.endsWith('.mp4') || f.endsWith('.mp3'))
    );
    return hit ? path.join(cacheDir, hit) : null;
  } catch {
    return null;
  }
}

ipcMain.handle('waveform', async (e, { url, start, duration, videoId, localPath }) => {
  // Yerel dosya modu: dalga formu doğrudan kaynak dosyadan (en hızlı yol);
  // YouTube modu: önce önbellek, yoksa uzak önizleme akışı
  const localFile = (localPath && fs.existsSync(localPath)) ? localPath : findCachedMedia(videoId);
  const input = localFile || url;
  if (!input) return null;
  // Yeni bir istek eskisinin yerini alıyor — bu normal/beklenen bir iptal,
  // hata değil. supersededByNewer bayrağı aşağıda "hata" olarak loglanmasını
  // engeller (aksi halde her slider hareketinde konsola sahte hata düşerdi).
  if (waveformProc) { waveformProc.supersededByNewer = true; try { waveformProc.kill(); } catch {} waveformProc = null; }

  const out = path.join(os.tmpdir(), `trimtube-wave-${Date.now()}.png`);
  const args = [
    '-y', '-ss', String(start), '-i', input, '-t', String(duration),
    // scale=sqrt: kısık sesli konuşmayı görünür kılar, gerçek sessizlik düz kalır —
    // kesim noktasını diyalog/sessizlik sınırına koymayı kolaylaştırır
    '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=900x92:colors=0A84FF:scale=sqrt',
    '-frames:v', '1', out, '-loglevel', 'error'
  ];

  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true, env: procEnv });
    waveformProc = proc;
    let errBuf = '';
    proc.stderr.on('data', (d) => { errBuf += d.toString('utf8'); });
    // Yerel dosyadan üretim saniyeler sürer; uzak akışta YouTube'un hız
    // kısıtlaması devreye girebildiği için daha geniş pay bırakılır.
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { proc.kill(); } catch {} }, localFile ? 15000 : 45000);
    const report = (msg) => {
      console.error(msg);
      try { win && !win.isDestroyed() && win.webContents.send('main-error', msg); } catch {}
    };
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (waveformProc === proc) waveformProc = null;
      if (proc.supersededByNewer) return resolve(null); // beklenen iptal, sessizce geç
      if (timedOut) report('[waveform] zaman aşımına uğradı (30s) — muhtemelen eşzamanlı ağır bir işlem CPU\'yu meşgul ediyor');
      if (code !== 0 || !fs.existsSync(out)) {
        if (!timedOut) report(`[waveform] başarısız, code: ${code} ${errBuf.trim()}`);
        return resolve(null);
      }
      try {
        const b64 = fs.readFileSync(out).toString('base64');
        fs.rmSync(out, { force: true });
        resolve('data:image/png;base64,' + b64);
      } catch (err) {
        report('[waveform] dosya okunamadı: ' + err.message);
        resolve(null);
      }
    });
    proc.on('error', (err) => { clearTimeout(timer); report('[waveform] spawn hatası: ' + err.message); resolve(null); });
  });
});

ipcMain.handle('get-default-folder', () => app.getPath('downloads'));

ipcMain.handle('choose-folder', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('open-folder', (e, folder) => shell.openPath(folder));

ipcMain.handle('choose-image', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Görsel', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('get-info', (e, url) => {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP,
      ['-j', '--no-playlist', '--no-warnings', url],
      { maxBuffer: 100 * 1024 * 1024, env: procEnv },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(extractError(stderr)));
        try {
          const j = JSON.parse(stdout);
          // Önizleme için ses+görüntü içeren (progressive) bir mp4 akışı seç;
          // düşük çözünürlük yeterli, amaç kesim noktası seçimi
          const prog = (j.formats || []).filter(f =>
            f.url && f.vcodec !== 'none' && f.acodec !== 'none' &&
            (f.protocol || '').startsWith('http') && f.ext === 'mp4'
          );
          prog.sort((a, b) => (a.height || 0) - (b.height || 0));
          const preferred = prog.filter(f => (f.height || 0) <= 480).pop() || prog[0];
          resolve({
            id: j.id,
            title: j.title,
            duration: j.duration,
            thumbnail: j.thumbnail,
            uploader: j.uploader || j.channel || '',
            previewUrl: preferred ? preferred.url : null,
            // Altyazı: manuel diller olduğu gibi; otomatik (ASR) listesi yüzlerce
            // çeviri varyantı içerdiğinden yalnızca Türkçe varyantlar aktarılır
            subLangs: Object.keys(j.subtitles || {}),
            autoLangs: Object.keys(j.automatic_captions || {}).filter(l => l === 'tr' || l.startsWith('tr-')),
            // Video sahibinin tanımladığı bölümler — hazır kesim önerisi olarak sunulur
            chapters: (j.chapters || []).map(c => ({
              title: c.title,
              start: Math.floor(c.start_time || 0),
              end: Math.floor(c.end_time || 0)
            }))
          });
        } catch {
          reject(new Error('Video bilgisi çözümlenemedi.'));
        }
      }
    );
  });
});

function sanitizeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '').trim() || 'video';
}

// --- Faz 9: oynatma listesi (playlist) toplu indirme ---
// --flat-playlist ile videoları indirmeden yalnızca listeyi (id/başlık/süre)
// alır; kullanıcı seçtiklerini kuyruğa ekler.
ipcMain.handle('get-playlist', (e, url) => {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP,
      ['--flat-playlist', '-J', '--no-warnings', url],
      { maxBuffer: 200 * 1024 * 1024, env: procEnv },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(extractError(stderr)));
        try {
          const j = JSON.parse(stdout);
          const entries = (j.entries || [])
            .filter(en => en && en.id && en.ie_key !== 'YoutubeTab') // alt-liste değil, video
            .map(en => ({
              id: en.id,
              title: en.title || en.id,
              url: en.url || `https://www.youtube.com/watch?v=${en.id}`,
              duration: Math.floor(en.duration || 0)
            }));
          resolve({ title: j.title || 'Oynatma listesi', count: entries.length, entries });
        } catch {
          reject(new Error('Oynatma listesi çözümlenemedi.'));
        }
      }
    );
  });
});

// --- Faz 8: yerel dosya kaynağı ---
// Sürükle-bırak (veya dosya seçici) ile alınan yerel video, YouTube akışıyla
// aynı boru hattından geçer: önizleme file:// ile oynatılır; kesme, format,
// kişi takibi, Whisper altyazısı ve marka aynen çalışır — yalnızca indirme
// adımı atlanır (dosya doğrudan işlenir, önbelleğe kopyalanmaz).
const LOCAL_VIDEO_EXTS = ['mp4', 'mkv', 'mov', 'webm', 'm4v', 'avi'];

// ffmpeg -i stderr'inden süre + boyut okur (ffprobe pakete dahil değil)
function probeMedia(file) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-i', file], { windowsHide: true, env: procEnv });
    let buf = '';
    proc.stderr.on('data', (d) => { buf += d.toString('utf8'); });
    proc.on('close', () => {
      const dm = buf.match(/Duration:\s*(\d+):(\d+):(\d+)/);
      const vm = buf.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
      resolve({
        duration: dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + (+dm[3]) : 0,
        w: vm ? +vm[1] : 0,
        h: vm ? +vm[2] : 0
      });
    });
    proc.on('error', () => resolve({ duration: 0, w: 0, h: 0 }));
  });
}

ipcMain.handle('local-info', async (e, filePath) => {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return { error: 'Bu bir dosya değil.' };
    const ext = path.extname(filePath).toLowerCase().slice(1);
    if (!LOCAL_VIDEO_EXTS.includes(ext)) {
      return { error: `Desteklenmeyen dosya türü (.${ext}). Desteklenenler: ${LOCAL_VIDEO_EXTS.join(', ')}` };
    }
    const meta = await probeMedia(filePath);
    if (!meta.duration || !meta.w) {
      return { error: 'Video okunamadı — dosya bozuk veya desteklenmeyen bir kodekte olabilir.' };
    }
    // Kararlı kısa kimlik (yol+boyut+değişim zamanı): dalga formu ve Whisper
    // SRT önbelleği bu kimlikle çalışır; dosya değişirse kimlik de değişir
    const id = 'local_' + crypto.createHash('md5')
      .update(`${filePath}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 12);
    return {
      id,
      title: path.basename(filePath, path.extname(filePath)),
      duration: meta.duration,
      localFile: filePath,
      previewUrl: pathToFileURL(filePath).href
    };
  } catch {
    return { error: 'Dosya okunamadı.' };
  }
});

ipcMain.handle('choose-video', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: LOCAL_VIDEO_EXTS }]
  });
  return res.canceled ? null : res.filePaths[0];
});

// --- Altyazı gömme ---
// Stiller libass force_style ile uygulanır; üçü de gerçek 1080x1920 çıktı
// üzerinde görsel olarak doğrulandı. FontSize/MarginV değerleri libass'ın
// varsayılan PlayRes (384x288) ölçeğindedir, çıktı boyutuna otomatik ölçeklenir.
const SUBTITLE_STYLES = {
  klasik: 'FontName=Arial,Bold=1,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=1.5,Shadow=0.5',
  kutulu: 'FontName=Arial,Bold=1,FontSize=13,PrimaryColour=&H00FFFFFF,BorderStyle=4,BackColour=&HA0000000,Outline=0,Shadow=0',
  dolgun: 'FontName=Arial Black,Bold=1,FontSize=17,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2.8,Shadow=0'
};

// SRT'yi kesim penceresine kaydırır: pencere dışındaki bloklar atılır,
// kalanların zamanı klip başlangıcına göre sıfırlanır.
function shiftSrt(content, startSec, durSec) {
  const toMs = (h, m, s, ms) => ((+h * 3600 + +m * 60 + +s) * 1000 + +ms);
  const fmt = (ms) => {
    ms = Math.max(0, Math.round(ms));
    const h = Math.floor(ms / 3600000); ms %= 3600000;
    const m = Math.floor(ms / 60000); ms %= 60000;
    const s = Math.floor(ms / 1000);
    const r = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`;
  };
  const startMs = startSec * 1000;
  const endMs = (startSec + durSec) * 1000;
  const out = [];
  let idx = 1;
  for (const block of content.split(/\r?\n\r?\n/)) {
    const m = block.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!m) continue;
    const s = toMs(m[1], m[2], m[3], m[4]);
    const e = toMs(m[5], m[6], m[7], m[8]);
    if (e <= startMs || s >= endMs) continue;
    const lines = block.split(/\r?\n/);
    const text = lines.slice(lines.findIndex(l => l.includes('-->')) + 1).join('\n');
    if (!text.trim()) continue;
    out.push(`${idx++}\n${fmt(Math.max(0, s - startMs))} --> ${fmt(Math.min(endMs, e) - startMs)}\n${text}`);
  }
  return out.length ? out.join('\n\n') + '\n' : '';
}

// Altyazıyı indirip önbelleğe alır (videonun kendisi gibi altyazı da
// tekrar klip kesimlerinde yeniden indirilmesin)
async function fetchSubtitle(url, videoId, lang, isAuto) {
  const cacheDir = path.join(app.getPath('userData'), 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `${videoId}_sub_${lang}${isAuto ? '.auto' : ''}.srt`);
  if (fs.existsSync(cached)) return cached;

  const outBase = path.join(cacheDir, `${videoId}_subdl`);
  const args = [
    '--no-playlist', '--no-warnings', '--skip-download',
    isAuto ? '--write-auto-subs' : '--write-subs',
    '--sub-langs', lang, '--convert-subs', 'srt',
    '--ffmpeg-location', FFMPEG, '-o', outBase, url
  ];
  await runProc(YTDLP, args, () => {});

  const produced = `${outBase}.${lang}.srt`;
  if (fs.existsSync(produced)) { fs.renameSync(produced, cached); return cached; }
  // Dil kodu varyasyonu (ör. tr-TR) — üretilen ilk srt'yi kabul et
  try {
    const alt = fs.readdirSync(cacheDir).find(f => f.startsWith(`${videoId}_subdl`) && f.endsWith('.srt'));
    if (alt) { fs.renameSync(path.join(cacheDir, alt), cached); return cached; }
  } catch {}
  return null;
}

// --- Faz 7: Whisper ile otomatik altyazı ---
// Videoda gömülü/indirilebilir altyazı yoksa, kesim aralığının sesini
// faster-whisper (subtitle.py) ile metne çevirip SRT üretir. Yalnızca gerekli
// aralığın sesi çıkarıldığı için üretilen SRT doğrudan klip başlangıcına göre
// (0'dan) zamanlanır — shiftSrt gerekmez. Sonuç, id+model+aralık anahtarıyla
// önbelleğe alınır (aynı klip tekrar işlenirse yeniden çözümleme yapılmaz).
async function transcribeSubtitle(mediaFile, videoId, model, trim, clipSec, tmpDir) {
  const cacheDir = path.join(app.getPath('userData'), 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const rangeKey = trim ? `${Math.round(toSec(trim.start))}_${Math.round(clipSec)}` : 'full';
  const cached = path.join(cacheDir, `${videoId}_sub_whisper_${model}_${rangeKey}.srt`);
  if (fs.existsSync(cached)) {
    win.webContents.send('log', 'Otomatik altyazı önbellekten alındı.');
    return { path: cached };
  }

  // 1) Kesim aralığının sesini 16 kHz mono WAV'a çıkar (whisper'ın beklediği biçim;
  //    ayrıca tüm videoyu değil yalnızca gerekli aralığı çözümleyerek süreyi kısaltır)
  const audioFile = path.join(tmpDir, 'aud.wav');
  const exArgs = ['-y'];
  if (trim) exArgs.push('-ss', trim.start);
  exArgs.push('-i', mediaFile);
  if (trim) exArgs.push('-t', String(clipSec));
  exArgs.push('-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioFile);
  const ex = await runProc(FFMPEG, exArgs, () => {});
  if (cancelRequested) return { cancelled: true };
  if (ex.code !== 0 || !fs.existsSync(audioFile)) {
    return { error: 'Altyazı için ses çıkarılamadı.' };
  }

  // 2) subtitle.py ile metne çevir. Model ilk kullanımda indirilir; indirme
  //    konumu userData/whisper-models'a sabitlenir (önbellek temizliğinden bağımsız).
  const modelDir = path.join(app.getPath('userData'), 'whisper-models');
  fs.mkdirSync(modelDir, { recursive: true });
  const outSrt = path.join(tmpDir, 'whisper.srt');
  const args = [
    path.join(__dirname, 'subtitle.py'), audioFile,
    '--out', outSrt, '--model', model, '--model-dir', modelDir
  ];
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  let errLine = '';
  const tr = await runProc(pythonCmd, args, (line) => {
    const m = line.match(/^PROGRESS (\d+)/);
    if (m) { win.webContents.send('progress', Math.min(99.9, +m[1])); return; }
    if (line.startsWith('STATUS model')) win.webContents.send('log', 'Altyazı modeli hazırlanıyor (ilk kullanımda indirilir)…');
    else if (line.startsWith('STATUS transcribe')) win.webContents.send('log', 'Konuşma metne çevriliyor…');
    else if (line.startsWith('ERROR ')) errLine = line.slice(6).trim();
  });
  if (cancelRequested) return { cancelled: true };
  if (tr.code !== 0 || !fs.existsSync(outSrt)) {
    let msg = errLine;
    if (!msg) {
      if (/ENOENT/.test(tr.stderr)) msg = 'Python bulunamadı. Otomatik altyazı için Python 3 kurulu olmalı.';
      else msg = tr.stderr.split(/\r?\n/).filter(Boolean).slice(-2).join('\n') || 'Bilinmeyen hata.';
    }
    return { error: 'Otomatik altyazı başarısız: ' + msg };
  }
  try { fs.copyFileSync(outSrt, cached); } catch {}
  return { path: cached };
}

// yt-dlp indirme argümanları (kalite seçimine göre)
function qualityArgs(quality) {
  if (quality === 'audio') return ['-x', '--audio-format', 'mp3', '--audio-quality', '0'];
  const args = ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'];
  if (quality === '1080') args.push('-S', 'res:1080,ext:mp4:m4a');
  else if (quality === '720') args.push('-S', 'res:720,ext:mp4:m4a');
  else args.push('-S', 'ext:mp4:m4a');
  return args;
}

function runYtdlp(extraArgs) {
  // Eşzamanlı parça sayısı platforma göre: macOS'ta çoklu bağlantı YouTube tarafından
  // sıfırlanıp "X bytes read, Y more expected" hatası verdiği için 1; Windows'ta bu
  // sorun görülmedi ve -N 8 uzun videolarda ~4-5 kat hız kazandırıyor.
  // --ffmpeg-location: yt-dlp, ses/videoyu birleştirirken sistem PATH'ine bakmak
  // yerine gömülü ffmpeg'i kullanır (ffmpeg kurulu olmayan kullanıcılar için şart).
  const fragments = process.platform === 'win32' ? '8' : '1';
  const args = ['--no-playlist', '--newline', '--progress', '--no-warnings', '-N', fragments, '--ffmpeg-location', FFMPEG, ...extraArgs];
  return runProc(YTDLP, args, (line) => {
    const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
    if (m) {
      win.webContents.send('progress', parseFloat(m[1]));
      const eta = line.match(/ETA\s+([\d:]+)/);
      win.webContents.send('eta', eta ? eta[1] : null);
    } else {
      win.webContents.send('log', line.trim());
    }
  });
}

// Önbellekte en yeni 2 video kalsın (tam bölümler büyük yer kaplayabilir)
// Önbellekte en yeni N video (ayarlanabilir, varsayılan 2) kalsın. Altyazı
// (_sub) ve yarım (.part) dosyalar bu sayıma dahil değildir.
function pruneCache(cacheDir, keep) {
  const limit = Math.max(1, loadSettings().cacheLimit || 2);
  try {
    fs.readdirSync(cacheDir)
      .filter(f => f !== keep && !f.endsWith('.part') && !f.includes('_sub'))
      .map(f => ({ f, t: fs.statSync(path.join(cacheDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(limit - 1) // keep dışında (limit-1) video daha kalsın
      .forEach(x => { try { fs.rmSync(path.join(cacheDir, x.f), { force: true }); } catch {} });
  } catch {}
}

// --- Önbellek yönetimi ---
function cacheDirPath() { return path.join(app.getPath('userData'), 'cache'); }

ipcMain.handle('cache-info', () => {
  const dir = cacheDirPath();
  let bytes = 0, videos = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === 'Cache_Data') continue; // Chromium'un kendi önbelleği, bize ait değil
      const full = path.join(dir, f);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      bytes += st.size;
      if ((f.endsWith('.mp4') || f.endsWith('.mp3')) && !f.endsWith('.part')) videos++;
    }
  } catch {}
  return { bytes, videos };
});

ipcMain.handle('cache-clear', () => {
  const dir = cacheDirPath();
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === 'Cache_Data') continue;
      try { fs.rmSync(path.join(dir, f), { force: true, recursive: true }); } catch {}
    }
  } catch {}
  return { ok: true };
});

// Bir videonun/görselin genişlik-yüksekliğini ffmpeg -i çıktısından okur
// (ffprobe pakete dahil değil). Başarısızlıkta 16:9 varsayılanı döner.
function probeDims(file) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-i', file], { windowsHide: true, env: procEnv });
    let buf = '';
    proc.stderr.on('data', (d) => { buf += d.toString('utf8'); });
    proc.on('close', () => {
      const m = buf.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
      resolve(m ? { w: +m[1], h: +m[2] } : { w: 1920, h: 1080 });
    });
    proc.on('error', () => resolve({ w: 1920, h: 1080 }));
  });
}

// Watermark overlay konum ifadeleri (W,H=ana; w,h=logo; PAD=kenar payı)
function watermarkOverlayExpr(position, pad) {
  switch (position) {
    case 'sol-ust': return `x=${pad}:y=${pad}`;
    case 'sag-alt': return `x=W-w-${pad}:y=H-h-${pad}`;
    case 'sol-alt': return `x=${pad}:y=H-h-${pad}`;
    case 'sag-ust':
    default: return `x=W-w-${pad}:y=${pad}`;
  }
}

// Başlık için ASS dosyası üretir (üst-orta, kalın, yarı saydam kutu). PlayRes
// çıktı boyutuna eşitlenip yazı/kenar payı oransal ölçeklenir. libass Türkçe
// ve tipografik karakterleri (— « » vb.) doğru işler — drawtext'in aksine.
function writeTitleAss(dir, text, dims, seconds) {
  const fontSize = Math.round(dims.h * 0.05);
  const marginV = Math.round(dims.h * 0.045);
  // ASS metninde satır sonu \N; virgül/süslü parantez sorun çıkarmaz ama
  // kaçış için newline'ları \N'e çeviriyoruz
  const safe = String(text).replace(/\r?\n/g, '\\N');
  const end = `0:00:0${Math.min(9, seconds)}.00`;
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${dims.w}
PlayResY: ${dims.h}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, Bold, BorderStyle, Outline, Shadow, BackColour, Alignment, MarginL, MarginR, MarginV
Style: Baslik, Arial, ${fontSize}, &H00FFFFFF, 1, 4, 0, 0, &H90000000, 8, 60, 60, ${marginV}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},Baslik,,0,0,0,,${safe}
`;
  const p = path.join(dir, 'title.ass');
  fs.writeFileSync(p, ass, 'utf8');
  return 'title.ass'; // cwd=tmpDir ile göreli kullanılacak
}

// Çıktı formatları: her biri ayrı bir dosya üretir. Kişi takibi yalnızca
// 9:16 çıktısına uygulanır (takip verisi o kırpma genişliği için üretilir);
// 1:1 ve orijinal her zaman merkez kadrajdır.
const FORMAT_DEFS = {
  original: { suffix: '', vf: null, marginV: 25, label: 'orijinal' },
  vertical: {
    suffix: ' [9x16]',
    vf: 'crop=min(iw\\,ih*9/16):ih,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
    marginV: 55,
    label: '9:16'
  },
  square: {
    suffix: ' [1x1]',
    vf: 'crop=min(iw\\,ih):min(iw\\,ih),scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2',
    marginV: 35,
    label: '1:1'
  }
};

ipcMain.handle('download', async (e, opts) => {
  const { url, id, title, folder, quality, trim, vertical, duration, track, trackPoint, subtitle } = opts;
  cancelRequested = false;

  const isAudio = quality === 'audio';
  // Yerel dosya modu (Faz 8): indirme atlanır, dosya doğrudan işlenir
  const localFile = (opts.localFile && fs.existsSync(opts.localFile)) ? opts.localFile : null;
  // Geriye uyumluluk: formats gelmezse eski tekil vertical bayrağından türet
  const formats = (!isAudio && Array.isArray(opts.formats) && opts.formats.length)
    ? opts.formats.filter(f => FORMAT_DEFS[f])
    : [vertical && !isAudio ? 'vertical' : 'original'];
  const wantTrack = !isAudio && track && formats.includes('vertical');
  const wantSubs = !!subtitle && !isAudio; // altyazı gömme yeniden kodlama gerektirir
  // Marka öğeleri (Faz 6): logo/watermark + başlık metni
  const watermark = (!isAudio && opts.watermark && opts.watermark.file && fs.existsSync(opts.watermark.file)) ? opts.watermark : null;
  const titleText = (!isAudio && opts.titleText && String(opts.titleText).trim()) ? String(opts.titleText).trim() : null;
  const needPost = !!trim || wantSubs || !!watermark || !!titleText || formats.some(f => f !== 'original') || formats.length > 1;

  // --- Basit durum: kesme/dönüştürme yok → doğrudan hedef klasöre indir ---
  if (!needPost) {
    if (localFile) {
      // Yerel dosyada hiçbir işlem seçilmemişse dosya olduğu gibi kopyalanır
      try {
        fs.copyFileSync(localFile, path.join(folder, `${sanitizeName(title)}${path.extname(localFile)}`));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: 'Dosya kopyalanamadı: ' + err.message };
      }
    }
    win.webContents.send('phase', 'download');
    const dl = await runYtdlp([...qualityArgs(quality), '-o', path.join(folder, '%(title)s.%(ext)s'), url]);
    if (cancelRequested) return { ok: false, cancelled: true };
    if (dl.code !== 0) return { ok: false, error: extractError(dl.stderr) };
    return { ok: true };
  }

  // --- Kesme/dönüştürme var: tam videoyu önbelleğe indir, yerelde ffmpeg ile işle ---
  // (Kesit indirme --download-sections yerine bu yol seçildi: tam indirme yt-dlp'nin
  // hızlı paralel indiricisini kullanır ve yerel kesme saniyeler sürer; ayrıca aynı
  // videodan ikinci klip önbellekten anında kesilir.)
  const cacheDir = path.join(app.getPath('userData'), 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  let cacheFile;
  if (localFile) {
    cacheFile = localFile; // yerel kaynak: indirme yok, dosya doğrudan işlenir
  } else {
    const cacheName = `${id}_${quality}.${isAudio ? 'mp3' : 'mp4'}`;
    cacheFile = path.join(cacheDir, cacheName);

    if (!fs.existsSync(cacheFile)) {
      win.webContents.send('phase', 'download');
      const dl = await runYtdlp([...qualityArgs(quality), '-o', path.join(cacheDir, `${id}_${quality}.%(ext)s`), url]);
      if (cancelRequested) return { ok: false, cancelled: true };
      if (dl.code !== 0) return { ok: false, error: extractError(dl.stderr) };
      if (!fs.existsSync(cacheFile)) return { ok: false, error: 'İndirilen dosya bulunamadı.' };
      pruneCache(cacheDir, cacheName);
    } else {
      win.webContents.send('log', 'Video önbellekte bulundu, indirme atlandı.');
    }
  }

  const clipSec = trim ? (toSec(trim.end) - toSec(trim.start)) : (duration || 0);

  // --- Altyazı hazırlığı: indir (önbellekten), kesim penceresine kaydır ---
  // Kişi takibi ve/veya altyazı gömme geçici klasörle çalışır (sendcmd/subtitles
  // filtrelerine Windows yolu vermek yerine cwd üzerinden göreli ad kullanılır)
  const tmpDir = (wantTrack || wantSubs || titleText) ? fs.mkdtempSync(path.join(os.tmpdir(), 'yt-trim-')) : null;
  const cleanupTmp = () => { if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} } };

  // Altyazı hazırsa format bazında MarginV ile filtre üretir (dikeyde daha yüksek konum)
  let subStyleBase = null;
  if (wantSubs) {
    win.webContents.send('log', 'Altyazı hazırlanıyor…');
    const isWhisper = subtitle.source === 'whisper';
    // Whisper: kesim aralığının sesinden üretir; sonuç zaten klip başına göre
    // zamanlıdır (kaydırma gerekmez). YouTube altyazısı: tam videonunkini indirip
    // kesim penceresine kaydırır.
    let content = null;
    if (isWhisper) {
      win.webContents.send('phase', 'subtitle');
      win.webContents.send('progress', 0);
      const res = await transcribeSubtitle(cacheFile, id, subtitle.model || 'small', trim, clipSec, tmpDir);
      if (cancelRequested || res.cancelled) { cleanupTmp(); return { ok: false, cancelled: true }; }
      if (res.error) { cleanupTmp(); return { ok: false, error: res.error }; }
      content = fs.readFileSync(res.path, 'utf8'); // zaten klip-göreli
    } else {
      const srtPath = await fetchSubtitle(url, id, subtitle.lang, subtitle.auto);
      if (cancelRequested) { cleanupTmp(); return { ok: false, cancelled: true }; }
      if (srtPath) {
        const raw = fs.readFileSync(srtPath, 'utf8');
        content = trim ? shiftSrt(raw, toSec(trim.start), clipSec) : raw;
      }
    }
    if (content && content.trim()) {
      fs.writeFileSync(path.join(tmpDir, 'subs.srt'), content, 'utf8');
      subStyleBase = SUBTITLE_STYLES[subtitle.style] || SUBTITLE_STYLES.klasik;
    } else if (isWhisper) {
      win.webContents.send('log', 'Seçilen aralıkta konuşma bulunmuyor.');
    } else if (content !== null) {
      win.webContents.send('log', 'Seçilen aralıkta altyazı bulunmuyor.');
    } else {
      win.webContents.send('log', 'Altyazı indirilemedi, altyazısız devam ediliyor.');
    }
  }
  const subFilterFor = (marginV) => subStyleBase
    ? `subtitles=subs.srt:force_style='${subStyleBase},MarginV=${marginV}'`
    : '';

  // Ortak çıktı adı parçaları
  const baseSuffix = trim ? ` [${trim.start.replace(/:/g, '.')}-${trim.end.replace(/:/g, '.')}]` : '';
  const subSuffix = subStyleBase ? ' [altyazılı]' : '';
  const brandSuffix = (watermark || titleText) ? ' [marka]' : '';
  const targetFor = (fmt, tracked) => {
    const fmtSuffix = fmt === 'vertical' ? (tracked ? ' [9x16 takipli]' : ' [9x16]') : FORMAT_DEFS[fmt].suffix;
    return path.join(folder, `${sanitizeName(title)}${baseSuffix}${fmtSuffix}${subSuffix}${brandSuffix}.${isAudio ? 'mp3' : 'mp4'}`);
  };

  // Orijinal format için kaynak boyutu (watermark/başlık oransal ölçeği); yalnızca
  // gerektiğinde ve bir kez sorgulanır
  let srcDims = null;
  const outDimsFor = async (fmt) => {
    if (fmt === 'vertical') return { w: 1080, h: 1920 };
    if (fmt === 'square') return { w: 1080, h: 1080 };
    if (!srcDims) srcDims = await probeDims(cacheFile);
    return srcDims;
  };

  let ffSpeed = 0; // ffmpeg -progress çıktısındaki speed= alanı (ör. 3.5x)
  const ffProgress = (line) => {
    const sp = line.match(/^speed=\s*([\d.]+)x/);
    if (sp) { ffSpeed = parseFloat(sp[1]); return; }
    const m = line.match(/^out_time=(\d+):(\d+):(\d+)/);
    if (m && clipSec > 0) {
      const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
      win.webContents.send('progress', Math.min(99.9, (t / clipSec) * 100));
      if (ffSpeed > 0) {
        const remain = Math.max(0, Math.round((clipSec - t) / ffSpeed));
        const mm = Math.floor(remain / 60);
        const ss = remain % 60;
        win.webContents.send('eta', `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);
      }
    }
  };

  // --- Ses (MP3): tek çıktı, yeniden kodlamasız kesim ---
  if (isAudio) {
    const target = targetFor('original', false);
    const inputArgs = [];
    if (trim) inputArgs.push('-ss', trim.start);
    inputArgs.push('-i', cacheFile);
    if (trim) inputArgs.push('-t', String(clipSec));
    win.webContents.send('phase', 'convert');
    win.webContents.send('progress', 0);
    // Önbellekteki yt-dlp çıktısı zaten mp3 → kayıpsız kopya yeterli;
    // yerel video kaynağından ise ses MP3'e kodlanmalı
    const codecArgs = localFile ? ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'] : ['-c', 'copy'];
    const ff = await runProc(FFMPEG, ['-y', ...inputArgs, ...codecArgs, '-progress', 'pipe:1', '-nostats', target], ffProgress);
    cleanupTmp();
    if (cancelRequested) { try { fs.rmSync(target, { force: true }); } catch {} return { ok: false, cancelled: true }; }
    if (ff.code !== 0) return { ok: false, error: 'Kesme başarısız:\n' + ff.stderr.split(/\r?\n/).filter(Boolean).slice(-4).join('\n') };
    return { ok: true };
  }

  try {
    // --- Kişi takibi ön hazırlığı (yalnızca 9:16 çıktısı için) ---
    // Kesit bir kez tmp'e alınır, tracker bir kez çalışır; 9:16 sendcmd ile
    // dinamik, diğer formatlar merkez kadrajla üretilir.
    let trackClipFile = null;
    let trackReady = false;
    if (wantTrack) {
      trackClipFile = cacheFile;
      if (trim) {
        trackClipFile = path.join(tmpDir, 'clip.mp4');
        win.webContents.send('phase', 'convert');
        win.webContents.send('progress', 0);
        const cut = await runEncodeWithFallback((hwaccel, venc) => [
          '-y', ...hwaccel, '-ss', trim.start, '-i', cacheFile, '-t', String(clipSec),
          ...venc, '-c:a', 'copy',
          '-progress', 'pipe:1', '-nostats', trackClipFile
        ], 18, ffProgress);
        if (cancelRequested) { cleanupTmp(); return { ok: false, cancelled: true }; }
        if (cut.code !== 0) { cleanupTmp(); return { ok: false, error: 'Kesme başarısız:\n' + cut.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') }; }
      }

      win.webContents.send('phase', 'track');
      win.webContents.send('progress', 0);
      const trackArgs = [...TRACKER.prefix, trackClipFile, '--out', path.join(tmpDir, 'cmds.txt')];
      if (opts.speakerMode) {
        // Aktif konuşanı takip (Faz 10): sesi mono wav'a çıkarıp konuşmacı moduna ver
        const wav = path.join(tmpDir, 'track.wav');
        await runProc(FFMPEG, ['-y', '-i', trackClipFile, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], () => {});
        trackArgs.push('--speaker');
        if (fs.existsSync(wav)) trackArgs.push('--audio', wav);
      } else if (trackPoint) {
        trackArgs.push('--point', `${trackPoint.x.toFixed(4)},${trackPoint.y.toFixed(4)}`);
      }
      // Paketlenmiş: donmuş tracker ikilisi; geliştirme: python + tracker.py
      const tr = await runProc(TRACKER.cmd, trackArgs, (line) => {
        const m = line.match(/^PROGRESS (\d+)/);
        if (m) win.webContents.send('progress', Math.min(99.9, +m[1]));
        else if (line.startsWith('WARN')) win.webContents.send('log', line);
      });
      if (cancelRequested) { cleanupTmp(); return { ok: false, cancelled: true }; }
      if (tr.code !== 0 || !fs.existsSync(path.join(tmpDir, 'cmds.txt'))) {
        cleanupTmp();
        return { ok: false, error: 'Kişi takibi başarısız:\n' + tr.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') };
      }
      trackReady = true;
    }

    // --- Format döngüsü: seçilen her format ayrı dosya üretir ---
    win.webContents.send('phase', 'convert');
    for (let i = 0; i < formats.length; i++) {
      const fmt = formats[i];
      const def = FORMAT_DEFS[fmt];
      const tracked = fmt === 'vertical' && trackReady;
      const target = targetFor(fmt, tracked);
      if (formats.length > 1) win.webContents.send('log', `Format ${i + 1}/${formats.length}: ${def.label}${tracked ? ' (takipli)' : ''}`);
      win.webContents.send('progress', 0);

      const outDims = (watermark || titleText) ? await outDimsFor(fmt) : null;

      // Temel görüntü filtre zinciri: kadraj → altyazı → başlık (hepsi [0:v] üzerinde)
      const baseParts = [];
      if (tracked) {
        baseParts.push('sendcmd=f=cmds.txt,crop=w=ih*9/16:h=ih:x=(iw-ow)/2:y=0,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2');
      } else if (def.vf) {
        baseParts.push(def.vf);
      }
      const sf = subFilterFor(def.marginV);
      if (sf) baseParts.push(sf);
      if (titleText) {
        writeTitleAss(tmpDir, titleText, outDims, 3);
        baseParts.push('subtitles=title.ass'); // cwd=tmpDir ile göreli
      }
      const baseChain = baseParts.join(',');

      // Takipli çıktı, önceden kesilmiş klipten okur (-ss gerekmez);
      // diğerleri önbellekteki tam videodan -ss ile hızlı sarar. -t her zaman
      // çıktı seçeneği olarak (target'tan hemen önce) verilir ki watermark
      // ikinci girdisi araya girince yanlışlıkla ona uygulanmasın.
      const mainInput = tracked
        ? ['-i', trackClipFile]
        : [...(trim ? ['-ss', trim.start] : []), '-i', cacheFile];
      const durArg = (!tracked && trim) ? ['-t', String(clipSec)] : [];

      // Watermark: ikinci girdi (logo) + filter_complex overlay; yoksa düz -vf
      const buildArgs = (hwaccel, venc) => {
        if (watermark) {
          const pad = Math.round(outDims.w * 0.03);
          const logoH = Math.round(outDims.h * 0.09);
          const overlay = watermarkOverlayExpr(watermark.position, pad);
          const chain = `[0:v]${baseChain || 'null'}[base];[1:v]scale=-1:${logoH}[wm];[base][wm]overlay=${overlay}[out]`;
          return ['-y', ...hwaccel, ...mainInput, '-i', watermark.file,
            '-filter_complex', chain, '-map', '[out]', '-map', '0:a?',
            ...venc, '-c:a', 'aac', '-b:a', '192k', ...durArg,
            '-progress', 'pipe:1', '-nostats', target];
        }
        const vf = baseChain ? ['-vf', baseChain] : [];
        return ['-y', ...hwaccel, ...mainInput, ...vf,
          ...venc, '-c:a', 'aac', '-b:a', '192k', ...durArg,
          '-progress', 'pipe:1', '-nostats', target];
      };

      const ff = await runEncodeWithFallback(buildArgs, 20, ffProgress, tmpDir || undefined);

      if (cancelRequested) {
        try { fs.rmSync(target, { force: true }); } catch {}
        cleanupTmp();
        return { ok: false, cancelled: true };
      }
      if (ff.code !== 0) {
        cleanupTmp();
        return { ok: false, error: `${def.label} formatı başarısız:\n` + ff.stderr.split(/\r?\n/).filter(Boolean).slice(-4).join('\n') };
      }
    }

    cleanupTmp();
    return { ok: true };
  } catch (err) {
    cleanupTmp();
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('cancel', () => {
  cancelRequested = true;
  if (currentProc) {
    // Windows'ta ffmpeg gibi alt süreçlerin de kapanması için süreç ağacını öldür
    spawn('taskkill', ['/pid', String(currentProc.pid), '/T', '/F'], { windowsHide: true });
  }
});

// --- Faz 8: kadraj yolu önizlemesi ---
// Kişi takibinin üreteceği 9:16 kırpma penceresini render'a girmeden görmek
// için: seçili aralık düşük çözünürlükte (480p) geçici bir klibe alınır,
// tracker.py render'dakiyle AYNI sözleşmeyle çalıştırılır ve cmds.txt
// normalize edilmiş {t, x} dizisi olarak renderer'a döner; renderer bunu
// önizleme videosunun üzerine canlı bindirir.
//
// İndirme/kesme işlerinden bağımsız kendi süreç takibini kullanır (currentProc'a
// dokunmaz — İptal butonu kadraj önizlemesini, önizleme iptali de indirmeyi öldürmesin).
let trackPrevProc = null;
let trackPrevCancelled = false;
// Üretilen 480p klip + veri klasörü modal kapanana kadar tutulur (modal onu
// file:// ile oynatır); yeni istekte ve kapanışta temizlenir.
let trackPrevTmpDir = null;

function cleanupTrackPrevTmp() {
  if (trackPrevTmpDir) {
    try { fs.rmSync(trackPrevTmpDir, { recursive: true, force: true }); } catch {}
    trackPrevTmpDir = null;
  }
}

function runPreviewProc(cmd, args, onLine) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { windowsHide: true, env: procEnv });
    trackPrevProc = proc;
    const dec = new StringDecoder('utf8');
    let buf = '';
    let errBuf = '';
    proc.stdout.on('data', (d) => {
      buf += dec.write(d);
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach((l) => { if (l.trim()) onLine(l); });
    });
    proc.stderr.on('data', (d) => { errBuf += d.toString('utf8'); });
    proc.on('close', (code) => { if (trackPrevProc === proc) trackPrevProc = null; resolve({ code, stderr: errBuf }); });
    proc.on('error', (err) => { if (trackPrevProc === proc) trackPrevProc = null; resolve({ code: -1, stderr: err.message }); });
  });
}

ipcMain.handle('track-preview-cancel', () => {
  trackPrevCancelled = true;
  if (trackPrevProc) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(trackPrevProc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { trackPrevProc.kill(); } catch {}
    }
  }
});

// Modal kapanınca tutulan geçici klip/veri klasörünü sil
ipcMain.handle('track-preview-cleanup', () => { cleanupTrackPrevTmp(); });

ipcMain.handle('track-preview', async (e, { url, videoId, localFile, start, duration, trackPoint, speakerMode }) => {
  trackPrevCancelled = false;
  cleanupTrackPrevTmp(); // önceki önizlemenin klibini bırak
  // Kaynak önceliği: yerel dosya > önbellekteki tam video > 360p önizleme akışı
  const local = (localFile && fs.existsSync(localFile)) ? localFile : findCachedMedia(videoId);
  const input = local || url;
  if (!input) return { error: 'Önizleme için kaynak bulunamadı.' };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-trackprev-'));
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
  const send = (p) => { try { win.webContents.send('track-preview-progress', p); } catch {} };

  try {
    // 1) Aralığı 480p'ye küçültülmüş sessiz geçici klibe al — tracker zaten
    //    480p üzerinde çalışır, tam çözünürlük yalnızca gereksiz yük olur.
    //    Modal bu klibi file:// ile oynatacağı için tarayıcının çözebildiği
    //    yuv420p + faststart ile yazılır.
    const clip = path.join(tmpDir, 'prev.mp4');
    send({ stage: 'extract' });
    // Ses de dahil edilir: modal önizlemesinde kullanıcı sesi duyar (daha doğru
    // kesim/kadraj kontrolü). Takip (tracker.py) sesi kullanmaz; ekstra yük düşük.
    const ex = await runPreviewProc(FFMPEG, [
      '-y', '-ss', String(start), '-i', input, '-t', String(duration),
      '-vf', 'scale=-2:480', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '128k',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      clip
    ], () => {});
    if (trackPrevCancelled) { cleanup(); return { cancelled: true }; }
    if (ex.code !== 0 || !fs.existsSync(clip)) {
      cleanup();
      return { error: 'Aralık hazırlanamadı:\n' + ex.stderr.split(/\r?\n/).filter(Boolean).slice(-2).join('\n') };
    }

    // 2) tracker.py — render'daki takiple aynı kod; ek olarak takip kutusu yolu
    const cmds = path.join(tmpDir, 'cmds.txt');
    const boxesFile = path.join(tmpDir, 'boxes.txt');
    const args = [...TRACKER.prefix, clip, '--out', cmds, '--boxes-out', boxesFile];
    if (speakerMode) {
      // Aktif konuşanı takip: 480p klibin sesini wav'a çıkarıp ver
      const wav = path.join(tmpDir, 'prev.wav');
      await runPreviewProc(FFMPEG, ['-y', '-i', clip, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], () => {});
      args.push('--speaker');
      if (fs.existsSync(wav)) args.push('--audio', wav);
    } else if (trackPoint) {
      args.push('--point', `${trackPoint.x.toFixed(4)},${trackPoint.y.toFixed(4)}`);
    }
    const tr = await runPreviewProc(TRACKER.cmd, args, (line) => {
      const m = line.match(/^PROGRESS (\d+)/);
      if (m) send({ stage: 'track', pct: +m[1] });
    });
    if (trackPrevCancelled) { cleanup(); return { cancelled: true }; }
    if (tr.code !== 0 || !fs.existsSync(cmds)) {
      cleanup();
      return { error: 'Kişi takibi başarısız:\n' + tr.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') };
    }

    // 3) cmds.txt → normalize kadraj yolu: x = pencerenin SOL kenarı / kaynak
    //    genişliği; cropW = pencere genişliği / kaynak genişliği (0-1)
    const dims = await probeDims(clip);
    const pathArr = [];
    for (const line of fs.readFileSync(cmds, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([\d.]+)\s+crop\s+x\s+(\d+);/);
      if (m) pathArr.push({ t: +m[1], x: (+m[2]) / dims.w });
    }
    if (!pathArr.length) { cleanup(); return { error: 'Takip verisi üretilemedi.' }; }

    // 4) boxes.txt → takip edilen kişinin normalize kutu yolu (maske için)
    const boxes = [];
    try {
      for (const line of fs.readFileSync(boxesFile, 'utf8').split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length === 5) {
          boxes.push({ t: +parts[0], x: +parts[1], y: +parts[2], w: +parts[3], h: +parts[4] });
        } else if (parts.length === 2 && parts[1] === '-') {
          boxes.push({ t: +parts[0], x: null }); // bu anda kişi görünmüyor
        }
      }
    } catch {}

    // Klibi (ve veriyi) tut: modal file:// ile oynatacak. Modal kapanınca
    // track-preview-cleanup ile silinir; yeni istekte de üstte temizlenir.
    trackPrevTmpDir = tmpDir;
    return {
      path: pathArr,
      cropW: (dims.h * 9 / 16) / dims.w,
      boxes,
      clipUrl: pathToFileURL(clip).href
    };
  } catch (err) {
    cleanup();
    return { error: err.message };
  }
});
