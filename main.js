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
  lastFolder: null,
  sidebarOpen: false,     // sol navigasyon menüsü (v1.12.0): kapalı başlar
  geminiKey: '',          // Faz 14: kullanıcının kendi Gemini API anahtarı (yalnızca yerelde durur)
  elevenKey: '',          // Faz 15: ElevenLabs anahtarı (seslendirme)
  moodVoice: null         // Faz 15: son seçilen anlatıcı sesi (voice_id)
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

// --- Faz 12: kare önizlemeli film şeridi (ana zaman çizelgesi arka planı) ---
// 12 kare, videoya eşit aralıklı. Her kare için ayrı `-ss T -i input` girdisi
// kullanılır (hızlı sarma): tüm videoyu çözmeden — uzak akışta da — saniyeler
// içinde biter. Kendi süreç takibi vardır; yeni istek eskisini iptal eder
// (waveform ile aynı kalıp), indirme/kesme işlerine dokunmaz.
let filmstripProc = null;

ipcMain.handle('filmstrip', async (e, { url, duration, videoId, localPath }) => {
  const localFile = (localPath && fs.existsSync(localPath)) ? localPath : findCachedMedia(videoId);
  const input = localFile || url;
  if (!input || !duration || duration <= 0) return null;
  if (filmstripProc) { filmstripProc.supersededByNewer = true; try { filmstripProc.kill(); } catch {} filmstripProc = null; }

  const FRAMES = 12;
  const out = path.join(os.tmpdir(), `trimtube-strip-${Date.now()}.png`);
  const inputs = [];
  const labels = [];
  for (let i = 0; i < FRAMES; i++) {
    // Kareler aralık ortalarından: (i+0.5)/FRAMES — kapak/kapanış karesine denk gelmesin
    const t = Math.min(Math.max(0, duration - 0.5), ((i + 0.5) / FRAMES) * duration);
    inputs.push('-ss', t.toFixed(2), '-i', input);
    labels.push(`[v${i}]`);
  }
  const chains = Array.from({ length: FRAMES }, (_, i) => `[${i}:v]scale=160:-2[v${i}]`).join(';');
  const args = [
    '-y', ...inputs,
    '-filter_complex', `${chains};${labels.join('')}hstack=inputs=${FRAMES}`,
    '-frames:v', '1', out, '-loglevel', 'error'
  ];

  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true, env: procEnv });
    filmstripProc = proc;
    let errBuf = '';
    proc.stderr.on('data', (d) => { errBuf += d.toString('utf8'); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { proc.kill(); } catch {} }, localFile ? 20000 : 60000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (filmstripProc === proc) filmstripProc = null;
      if (proc.supersededByNewer) return resolve(null); // beklenen iptal
      if (timedOut || code !== 0 || !fs.existsSync(out)) {
        // Film şeridi süs katmanıdır: başarısızlık sessizce yutulur, akış etkilenmez
        if (!timedOut && code !== 0) console.error('[filmstrip] başarısız:', errBuf.trim().split('\n').pop() || code);
        return resolve(null);
      }
      try {
        const b64 = fs.readFileSync(out).toString('base64');
        fs.rmSync(out, { force: true });
        resolve('data:image/png;base64,' + b64);
      } catch {
        resolve(null);
      }
    });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
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
      size: st.size,          // sıkıştırma modalındaki dosya kartı için
      w: meta.w,
      h: meta.h,
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
    filters: [
      { name: 'Video ve Proje', extensions: [...LOCAL_VIDEO_EXTS, 'trimtube'] },
      { name: 'TrimTube Projesi', extensions: ['trimtube'] }
    ]
  });
  return res.canceled ? null : res.filePaths[0];
});

// --- Faz 12: .trimtube proje dosyası ---
// Proje = oturumun hafif JSON'u (kaynak, kesim, format, takip, altyazı, marka,
// kuyruk). Video verisi içermez. Açılırken "tümü" (kaynak+kesim+kuyruk dahil)
// veya "yalnız ayarlar" (şablon gibi) olarak uygulanabilir.
ipcMain.handle('project-save', async (e, data) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: `${sanitizeName(data.title || 'proje')}.trimtube`,
    filters: [{ name: 'TrimTube Projesi', extensions: ['trimtube'] }]
  });
  if (res.canceled || !res.filePath) return { cancelled: true };
  try {
    const doc = { app: 'trimtube', version: 1, savedAt: new Date().toISOString(), ...data };
    fs.writeFileSync(res.filePath, JSON.stringify(doc, null, 2), 'utf8');
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { error: 'Proje kaydedilemedi: ' + err.message };
  }
});

ipcMain.handle('project-open', async (e, filePath) => {
  let p = filePath;
  if (!p) {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'TrimTube Projesi', extensions: ['trimtube'] }]
    });
    if (res.canceled) return { cancelled: true };
    p = res.filePaths[0];
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (data.app !== 'trimtube') return { error: 'Bu bir TrimTube proje dosyası değil.' };
    // Diskte olmayan yollar renderer'da uyarıya dönüşür (sessiz kırılma olmasın)
    if (data.watermark && data.watermark.file && !fs.existsSync(data.watermark.file)) data.watermark.missing = true;
    if (data.localFile && !fs.existsSync(data.localFile)) data.localFileMissing = true;
    return { ok: true, project: data };
  } catch {
    return { error: 'Proje dosyası okunamadı veya bozuk.' };
  }
});

// Yükleme türü sorusu: yerleşik diyalogla (tasarım diline ek modal gerektirmez)
ipcMain.handle('project-ask-mode', async () => {
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Tümünü geri yükle', 'Yalnız ayarları uygula', 'Vazgeç'],
    defaultId: 0,
    cancelId: 2,
    title: 'Proje aç',
    message: 'Proje nasıl uygulansın?',
    detail: 'Tümünü geri yükle: video, kesim aralığı ve kuyruk dahil her şey geri gelir.\nYalnız ayarları uygula: kalite/format/takip/altyazı/marka, şablon gibi mevcut oturuma uygulanır.'
  });
  return r.response === 0 ? 'full' : r.response === 1 ? 'settings' : 'cancel';
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
// runner: alt süreci hangi takiple çalıştıracağı (varsayılan ana kuyruk —
// currentProc; AI araçları kendi bağımsız takibini [runAiProc] geçirir ki
// kuyruğun Durdur'u AI'ın altyazı indirmesini öldürmesin, tersi de olmasın).
async function fetchSubtitle(url, videoId, lang, isAuto, runner = runProc) {
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
  await runner(YTDLP, args, () => {});

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
      .filter(f => f !== keep && !f.endsWith('.part') && !f.includes('_sub') && !f.includes('_ai_'))
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
  },
  // GIF (Faz 12): palet tabanlı tek geçiş; venc/ses yolu ve altyazı/marka/takip
  // zinciri uygulanmaz — amaç "tek tık paylaşımlık kesit". 12 fps + 480px genişlik
  // boyut/kalite dengesinin tatlı noktası.
  gif: { suffix: ' [gif]', vf: null, marginV: 25, label: 'GIF' }
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
    // GIF'e altyazı/marka uygulanmadığından adına da o etiketler girmez
    if (fmt === 'gif') return path.join(folder, `${sanitizeName(title)}${baseSuffix} [gif].gif`);
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
    return { ok: true, files: [target] };
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
    const outFiles = []; // üretilen dosyalar (toast'taki "Sıkıştır" kısayolu için)
    for (let i = 0; i < formats.length; i++) {
      const fmt = formats[i];
      const def = FORMAT_DEFS[fmt];
      const tracked = fmt === 'vertical' && trackReady;
      const target = targetFor(fmt, tracked);
      if (formats.length > 1) win.webContents.send('log', `Format ${i + 1}/${formats.length}: ${def.label}${tracked ? ' (takipli)' : ''}`);
      win.webContents.send('progress', 0);

      // GIF: kendi tek geçişli yolu (palettegen/paletteuse), venc/ses devre dışı
      if (fmt === 'gif') {
        const gf = await runProc(FFMPEG, [
          '-y', ...(trim ? ['-ss', trim.start] : []), '-i', cacheFile,
          '-filter_complex', 'fps=12,scale=480:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer',
          '-an', ...(trim ? ['-t', String(clipSec)] : []),
          '-progress', 'pipe:1', '-nostats', target
        ], ffProgress);
        if (cancelRequested) {
          try { fs.rmSync(target, { force: true }); } catch {}
          cleanupTmp();
          return { ok: false, cancelled: true };
        }
        if (gf.code !== 0) {
          cleanupTmp();
          return { ok: false, error: 'GIF formatı başarısız:\n' + gf.stderr.split(/\r?\n/).filter(Boolean).slice(-4).join('\n') };
        }
        outFiles.push(target);
        continue;
      }

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
      outFiles.push(target);
    }

    cleanupTmp();
    return { ok: true, files: outFiles };
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

// --- Faz 11: Sıkıştırma (Compress) ---
// Üretilen (veya herhangi bir yerel) videoyu görsel olarak kayıpsız biçimde
// yeniden kodlayıp küçültür. Render, kalite hedefli donanım kodlayıcılarla
// bitrate tavanı olmadan şişkin dosyalar üretebildiğinden burada bilinçli
// olarak CPU kodlayıcı (libx264/libx265) kullanılır: aynı görsel kalitede
// belirgin küçülme sağlar, kesim hızını etkilemez (ayrı ve isteğe bağlı adım).
// İndirme/kesme işlerinden bağımsız kendi süreç takibini kullanır (currentProc'a
// dokunmaz — İptal butonu sıkıştırmayı, Durdur da indirmeyi öldürmesin).
let compressProc = null;
let compressCancelled = false;

function runCompressProc(args, onLine, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true, env: procEnv, cwd });
    compressProc = proc;
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
    proc.on('close', (code) => { if (compressProc === proc) compressProc = null; resolve({ code, stderr: errBuf }); });
    proc.on('error', (err) => { if (compressProc === proc) compressProc = null; resolve({ code: -1, stderr: err.message }); });
  });
}

ipcMain.handle('compress-cancel', () => {
  compressCancelled = true;
  if (compressProc) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(compressProc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { compressProc.kill(); } catch {}
    }
  }
});

// Çakışmayan çıktı yolu: ad.mp4 → ad-2.mp4 → ad-3.mp4 …
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 2; ; i++) {
    const cand = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
}

// Ses akışının bitrate'ini (kb/s) ffmpeg -i stderr'inden okur; bulunamazsa
// uygulamanın kendi çıktılarındaki varsayılan (192) kullanılır.
function probeAudioKbps(file) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-i', file], { windowsHide: true, env: procEnv });
    let buf = '';
    proc.stderr.on('data', (d) => { buf += d.toString('utf8'); });
    proc.on('close', () => {
      const m = buf.match(/Audio:.*?(\d+) kb\/s/);
      resolve(m ? +m[1] : 192);
    });
    proc.on('error', () => resolve(192));
  });
}

// mode: 'quality' (görsel kayıpsız, CRF) | 'size' (hedef MB, two-pass)
ipcMain.handle('compress-video', async (e, { file, mode, targetMB, hevc }) => {
  compressCancelled = false;
  if (!file || !fs.existsSync(file)) return { error: 'Dosya bulunamadı.' };
  const meta = await probeMedia(file);
  if (!meta.duration || !meta.w) return { error: 'Video bilgisi okunamadı — dosya bozuk veya desteklenmiyor olabilir.' };
  const beforeBytes = fs.statSync(file).size;

  const target = uniquePath(path.join(
    path.dirname(file),
    `${path.basename(file, path.extname(file))} [sıkıştırılmış].mp4`
  ));
  // Two-pass log dosyaları buraya yazılır (göreli adla, cwd=tmpDir — boşluklu
  // yollarda x265-params ayrıştırma sorunlarından kaçınmak için)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-compress-'));
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };

  const send = (p) => { try { win.webContents.send('compress-progress', p); } catch {} };
  // İlerleme: out_time / toplam süre; two-pass'te 1. geçiş %0-50, 2. geçiş %50-100
  const progressFor = (base, span) => {
    let speed = 0;
    return (line) => {
      const sp = line.match(/^speed=\s*([\d.]+)x/);
      if (sp) { speed = parseFloat(sp[1]); return; }
      const m = line.match(/^out_time=(\d+):(\d+):(\d+)/);
      if (m) {
        const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
        const pct = base + Math.min(1, t / meta.duration) * span;
        let eta = null;
        if (speed > 0) {
          const remain = Math.max(0, Math.round((meta.duration - t) / speed));
          eta = `${String(Math.floor(remain / 60)).padStart(2, '0')}:${String(remain % 60).padStart(2, '0')}`;
        }
        send({ pct: Math.min(99.9, pct), eta });
      }
    };
  };

  const common = ['-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats'];

  try {
    if (mode === 'size') {
      // Hedef boyut: video bitrate = toplam bütçe − ses bütçesi (ses kopyalanır)
      const audioKbps = await probeAudioKbps(file);
      const videoKbps = Math.floor((targetMB * 8192) / meta.duration - audioKbps);
      if (videoKbps < 150) { cleanup(); return { error: 'Hedef boyut bu süre için çok küçük — daha büyük bir değer girin.' }; }
      const venc = hevc
        ? ['-c:v', 'libx265', '-preset', 'medium', '-b:v', `${videoKbps}k`, '-tag:v', 'hvc1']
        : ['-c:v', 'libx264', '-preset', 'slow', '-b:v', `${videoKbps}k`];
      const passArg = (n) => hevc
        ? ['-x265-params', `pass=${n}:stats=x265stats`]
        : ['-pass', String(n), '-passlogfile', 'ff2pass'];

      const p1 = await runCompressProc(
        ['-y', '-i', file, ...venc, ...passArg(1), '-an', '-f', 'null', '-progress', 'pipe:1', '-nostats', '-'],
        progressFor(0, 50), tmpDir
      );
      if (compressCancelled) { cleanup(); return { cancelled: true }; }
      if (p1.code !== 0) { cleanup(); return { error: 'Sıkıştırma (1. geçiş) başarısız:\n' + p1.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') }; }

      const p2 = await runCompressProc(
        ['-y', '-i', file, ...venc, ...passArg(2), '-c:a', 'copy', ...common, target],
        progressFor(50, 50), tmpDir
      );
      if (compressCancelled) { try { fs.rmSync(target, { force: true }); } catch {} cleanup(); return { cancelled: true }; }
      if (p2.code !== 0) { try { fs.rmSync(target, { force: true }); } catch {} cleanup(); return { error: 'Sıkıştırma (2. geçiş) başarısız:\n' + p2.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') }; }
    } else {
      // Görsel kayıpsız: CRF tabanlı tek geçiş; ses kayıpsız kopya
      const venc = hevc
        ? ['-c:v', 'libx265', '-preset', 'medium', '-crf', '20', '-tag:v', 'hvc1']
        : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18'];
      const r = await runCompressProc(
        ['-y', '-i', file, ...venc, '-c:a', 'copy', ...common, target],
        progressFor(0, 100), tmpDir
      );
      if (compressCancelled) { try { fs.rmSync(target, { force: true }); } catch {} cleanup(); return { cancelled: true }; }
      if (r.code !== 0) { try { fs.rmSync(target, { force: true }); } catch {} cleanup(); return { error: 'Sıkıştırma başarısız:\n' + r.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') }; }
    }

    cleanup();
    const afterBytes = fs.statSync(target).size;
    return { ok: true, outFile: target, beforeBytes, afterBytes };
  } catch (err) {
    try { fs.rmSync(target, { force: true }); } catch {}
    cleanup();
    return { error: err.message };
  }
});

// --- Faz 13: Kurgu Motoru — Akıllı Kırpma (Smart Trim) ---
// Whisper kelime zaman damgalarından sessizlik ve dolgu kelime (ıı, eee, hmm…)
// adayları çıkarır; kullanıcı onayladıktan sonra ffmpeg trim/atrim/concat filtre
// zinciriyle (dosyasız, kare-hassas) tek dosyada birleştirir. Bu zincir aynı
// zamanda Faz 15/16'nın (Moodlar, J/L-cut) ihtiyaç duyacağı montaj altyapısının
// ilk halidir. İndirme/sıkıştırma işlerinden bağımsız kendi süreç takibini
// kullanır (compress ile aynı desen — Durdur bunu, bu da Durdur'u öldürmesin).
let smartTrimProc = null;
let smartTrimCancelled = false;

function runSmartTrimProc(cmd, args, onLine, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { windowsHide: true, env: procEnv, cwd });
    smartTrimProc = proc;
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
    proc.on('close', (code) => { if (smartTrimProc === proc) smartTrimProc = null; resolve({ code, stderr: errBuf }); });
    proc.on('error', (err) => { if (smartTrimProc === proc) smartTrimProc = null; resolve({ code: -1, stderr: err.message }); });
  });
}

ipcMain.handle('smarttrim-cancel', () => {
  smartTrimCancelled = true;
  if (smartTrimProc) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(smartTrimProc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { smartTrimProc.kill(); } catch {}
    }
  }
});

// Temiz/anlamsız dolgu sesleri — "yani/şey/işte" gibi gerçek anlam taşıyabilecek
// kelimeler bilinçli olarak dışarıda bırakıldı (yanlış-pozitif riski).
const FILLER_WORDS = new Set(['ıı', 'ııı', 'eee', 'ee', 'öö', 'aa', 'ahh', 'hmm', 'hm', 'hıı', 'hı']);

function normalizeWord(w) {
  return String(w || '')
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/^[.,!?;:…"'“”‘’]+|[.,!?;:…"'“”‘’]+$/g, '');
}

// Kelime dizisinden sessizlik + dolgu kelime adaylarını çıkarır; bitişik/örtüşen
// adaylar (epsilon 0.05s) tek adaya birleştirilir.
function buildSmartTrimCandidates(words, duration, threshold, includeFillers) {
  const raw = [];
  let prevEnd = 0;
  for (const w of words) {
    const gap = w.start - prevEnd;
    if (gap >= threshold) raw.push({ type: 'silence', start: prevEnd, end: w.start });
    if (includeFillers && FILLER_WORDS.has(normalizeWord(w.word))) {
      raw.push({ type: 'filler', start: w.start, end: w.end, text: w.word.trim() });
    }
    prevEnd = Math.max(prevEnd, w.end);
  }
  const trailingGap = duration - prevEnd;
  if (trailingGap >= threshold) raw.push({ type: 'silence', start: prevEnd, end: duration });

  raw.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const c of raw) {
    const last = merged[merged.length - 1];
    if (last && c.start - last.end <= 0.05) {
      last.end = Math.max(last.end, c.end);
      // Sessizlik+dolgu çakışırsa dolgu bilgisini koru (kullanıcıya daha anlamlı)
      if (c.type === 'filler' && last.type === 'silence') { last.type = 'filler'; last.text = c.text; }
    } else {
      merged.push({ ...c });
    }
  }
  return merged.map((c, i) => ({ id: i, type: c.type, start: +c.start.toFixed(2), end: +c.end.toFixed(2), text: c.text }));
}

ipcMain.handle('smarttrim-analyze', async (e, { file, model, threshold, includeFillers }) => {
  smartTrimCancelled = false;
  if (!file || !fs.existsSync(file)) return { error: 'Dosya bulunamadı.' };
  const meta = await probeMedia(file);
  if (!meta.duration || !meta.w) return { error: 'Video bilgisi okunamadı — dosya bozuk veya desteklenmiyor olabilir.' };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-smarttrim-'));
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
  const send = (p) => { try { win.webContents.send('smarttrim-progress', p); } catch {} };

  try {
    send({ stage: 'audio', pct: 0 });
    const audioFile = path.join(tmpDir, 'aud.wav');
    const ex = await runSmartTrimProc(FFMPEG, ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioFile], () => {});
    if (smartTrimCancelled) { cleanup(); return { cancelled: true }; }
    if (ex.code !== 0 || !fs.existsSync(audioFile)) { cleanup(); return { error: 'Ses çıkarılamadı.' }; }

    send({ stage: 'model', pct: 0 });
    const modelDir = path.join(app.getPath('userData'), 'whisper-models');
    fs.mkdirSync(modelDir, { recursive: true });
    const wordsJson = path.join(tmpDir, 'words.json');
    const throwawaySrt = path.join(tmpDir, 'throwaway.srt');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    let errLine = '';
    const tr = await runSmartTrimProc(pythonCmd, [
      path.join(__dirname, 'subtitle.py'), audioFile,
      '--out', throwawaySrt, '--words-out', wordsJson, '--model', model || 'small', '--model-dir', modelDir
    ], (line) => {
      const m = line.match(/^PROGRESS (\d+)/);
      if (m) { send({ stage: 'transcribe', pct: +m[1] }); return; }
      if (line.startsWith('STATUS model')) send({ stage: 'model', pct: 0 });
      else if (line.startsWith('STATUS transcribe')) send({ stage: 'transcribe', pct: 0 });
      else if (line.startsWith('ERROR ')) errLine = line.slice(6).trim();
    });
    if (smartTrimCancelled) { cleanup(); return { cancelled: true }; }
    if (tr.code !== 0 || !fs.existsSync(wordsJson)) {
      let msg = errLine;
      if (!msg) {
        if (/ENOENT/.test(tr.stderr)) msg = 'Python bulunamadı. Akıllı kırpma için Python 3 kurulu olmalı.';
        else msg = tr.stderr.split(/\r?\n/).filter(Boolean).slice(-2).join('\n') || 'Bilinmeyen hata.';
      }
      cleanup();
      return { error: 'Analiz başarısız: ' + msg };
    }

    const data = JSON.parse(fs.readFileSync(wordsJson, 'utf8'));
    const candidates = buildSmartTrimCandidates(data.words || [], meta.duration, threshold || 0.7, includeFillers !== false);
    cleanup();
    return { ok: true, duration: meta.duration, candidates };
  } catch (err) {
    cleanup();
    return { error: err.message };
  }
});

// cuts: [{start,end}] (kaldırılacak aralıklar) → tümleyeni alıp keep segmentlerini
// hesaplar; birbirine değen/örtüşen kesimler birleştirilir, çok kısa kalıntı
// parçalar (<0.12s — ffmpeg trim'de artefakta yol açabilir) komşusuna katılır.
function computeKeepSegments(cuts, duration) {
  const sorted = [...cuts].filter(c => c.end > c.start).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const c of sorted) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else merged.push({ ...c });
  }
  const keep = [];
  let cursor = 0;
  for (const c of merged) {
    if (c.start > cursor) keep.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < duration) keep.push({ start: cursor, end: duration });
  const MIN = 0.12;
  const cleaned = [];
  for (const k of keep) {
    if (k.end - k.start < MIN && cleaned.length) cleaned[cleaned.length - 1].end = k.end;
    else cleaned.push(k);
  }
  return cleaned.filter(k => k.end - k.start >= 0.02);
}

ipcMain.handle('smarttrim-apply', async (e, { file, duration, cuts }) => {
  smartTrimCancelled = false;
  if (!file || !fs.existsSync(file)) return { error: 'Dosya bulunamadı.' };
  // Savunmacı: analiz sırasında ölçülen süre yerine dosyayı yeniden ölçmeyi
  // dene — aradan başka bir dosya seçilmiş olsa bile tutarlılık bozulmasın
  const meta = await probeMedia(file);
  const dur = meta.duration || duration;
  if (!dur || dur <= 0) return { error: 'Video süresi geçersiz.' };

  const keep = computeKeepSegments(Array.isArray(cuts) ? cuts : [], dur);
  if (!keep.length) return { error: 'Tüm video kırpılamaz — en az bir aday işaretini kaldırın.' };
  if (keep.length > 200) return { error: `Çok fazla kesim noktası (${keep.length}) — sessizlik eşiğini yükseltip tekrar deneyin.` };

  const target = uniquePath(path.join(
    path.dirname(file),
    `${path.basename(file, path.extname(file))} [kırpıldı].mp4`
  ));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-smarttrim-out-'));
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
  const send = (p) => { try { win.webContents.send('smarttrim-progress', p); } catch {} };

  const keptTotal = keep.reduce((s, k) => s + (k.end - k.start), 0);
  let speed = 0;
  const onLine = (line) => {
    const sp = line.match(/^speed=\s*([\d.]+)x/);
    if (sp) { speed = parseFloat(sp[1]); return; }
    const m = line.match(/^out_time=(\d+):(\d+):(\d+)/);
    if (m) {
      const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
      const pct = Math.min(99.9, (t / keptTotal) * 100);
      let eta = null;
      if (speed > 0) {
        const remain = Math.max(0, Math.round((keptTotal - t) / speed));
        eta = `${String(Math.floor(remain / 60)).padStart(2, '0')}:${String(remain % 60).padStart(2, '0')}`;
      }
      send({ stage: 'render', pct, eta });
    }
  };

  // Dosyasız, kare-hassas concat: her keep segmenti kendi trim/atrim'ini alır,
  // ardından tek concat düğümünde birleşir (mevcut watermark overlay zincirinde
  // de kanıtlanmış hwaccel+filter_complex kombinasyonu — bkz. format döngüsü).
  const parts = [];
  const labels = [];
  keep.forEach((k, i) => {
    parts.push(`[0:v]trim=${k.start}:${k.end},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=${k.start}:${k.end},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  const filter = `${parts.join(';')};${labels.join('')}concat=n=${keep.length}:v=1:a=1[outv][outa]`;

  const buildArgs = (hwaccel, venc) => [
    '-y', ...hwaccel, '-i', file,
    '-filter_complex', filter, '-map', '[outv]', '-map', '[outa]',
    ...venc, '-c:a', 'aac', '-b:a', '192k',
    '-progress', 'pipe:1', '-nostats', target
  ];

  try {
    // runEncodeWithFallback'in GPU→CPU düşme mantığı, kendi süreç takibimizle
    // (runSmartTrimProc) tekrarlanır: paylaşılan currentProc'a bağlanırsa ana
    // kuyruğun Durdur'u bu render'ı da öldürür — bağımsızlık bozulur.
    const encoder = await getEncoder();
    let r = await runSmartTrimProc(FFMPEG, buildArgs(hwaccelArgs(encoder), videoEncodeArgs(encoder, 20)), onLine, tmpDir);
    if (!smartTrimCancelled && r.code !== 0 && encoder !== 'libx264') {
      win.webContents.send('log', `GPU kodlama (${encoder}) başarısız oldu, CPU ile devam ediliyor…`);
      r = await runSmartTrimProc(FFMPEG, buildArgs([], videoEncodeArgs('libx264', 20)), onLine, tmpDir);
    }
    if (smartTrimCancelled) { try { fs.rmSync(target, { force: true }); } catch {} cleanup(); return { cancelled: true }; }
    if (r.code !== 0) {
      cleanup();
      return { error: 'Kırpma başarısız:\n' + r.stderr.split(/\r?\n/).filter(Boolean).slice(-4).join('\n') };
    }
    cleanup();
    return { ok: true, outFile: target, beforeDuration: dur, afterDuration: keptTotal };
  } catch (err) {
    try { fs.rmSync(target, { force: true }); } catch {}
    cleanup();
    return { error: err.message };
  }
});

// --- Faz 14: AI Altyapısı ve İlk Meyveler (Gemini) ---
// Dört araç (başlık/hashtag üretimi, semantik konu arama, hook bulucu, reklam
// dostu içerik taraması) tek bir transkript üzerinde çalışır. Gemini çağrıları
// burada (main) yapılır: renderer CSP'si (default-src 'self') dışa istek
// yasaklar; anahtar kullanıcının kendisinindir ve yalnızca settings.json'da
// yerel durur. İndirme/sıkıştırma/akıllı kırpma işlerinden bağımsız kendi
// süreç takibi + fetch iptali vardır (compress/smarttrim ile aynı desen).
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

let aiProc = null;
let aiCancelled = false;
let aiAbort = null; // süren Gemini isteğinin iptali (AbortController)

function runAiProc(cmd, args, onLine, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { windowsHide: true, env: procEnv, cwd });
    aiProc = proc;
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
    proc.on('close', (code) => { if (aiProc === proc) aiProc = null; resolve({ code, stderr: errBuf }); });
    proc.on('error', (err) => { if (aiProc === proc) aiProc = null; resolve({ code: -1, stderr: err.message }); });
  });
}

ipcMain.handle('ai-cancel', () => {
  aiCancelled = true;
  if (aiProc) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(aiProc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { aiProc.kill(); } catch {}
    }
  }
  if (aiAbort) { try { aiAbort.abort(); } catch {} }
});

function aiSend(p) { try { win.webContents.send('ai-progress', p); } catch {} }

// Gemini HTTP hatalarını kullanıcıya gösterilebilir Türkçe mesaja çevirir
function geminiErrorMessage(status, body) {
  const raw = String(body || '');
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(raw)) {
    return 'Gemini API anahtarı geçersiz. Ayarlar ekranından kontrol edin.';
  }
  if (status === 401 || status === 403) return 'Gemini API anahtarı reddedildi (yetki yok). Anahtarı Ayarlar ekranından kontrol edin.';
  if (status === 429) return 'Gemini kota sınırına takıldı (ücretsiz katmanda dakika başına istek sınırı vardır). Bir dakika sonra tekrar deneyin.';
  if (status === 404) return `Gemini modeli bulunamadı (${GEMINI_MODEL}). Uygulama güncellemesi gerekebilir.`;
  if (status >= 500) return 'Gemini hizmeti şu an yanıt veremiyor. Birkaç dakika sonra tekrar deneyin.';
  const m = raw.match(/"message"\s*:\s*"([^"]+)"/);
  return `Gemini isteği başarısız (${status})` + (m ? `: ${m[1]}` : '');
}

// Tek Gemini çağrısı: prompt → JSON. Yanıt responseMimeType ile JSON istenir;
// yine de kod bloğu çitleriyle gelirse temizlenip öyle parse edilir.
// setAbort/isCancelled parametreli: her akış (AI araçları / Moodlar) kendi iptal
// denetleyicisini kaydeder — biri diğerinin süren isteğini iptal edemez.
async function geminiRequest(prompt, temperature, setAbort, isCancelled) {
  const key = (loadSettings().geminiKey || '').trim();
  if (!key) return { error: 'Gemini API anahtarı girilmemiş. Ayarlar ekranından ücretsiz bir anahtar ekleyin.' };
  const ctrl = new AbortController();
  setAbort(ctrl);
  const timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, 120000);
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, responseMimeType: 'application/json' }
      })
    });
    if (!res.ok) return { error: geminiErrorMessage(res.status, await res.text().catch(() => '')) };
    const j = await res.json();
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const text = parts.map(p => p.text || '').join('').trim();
    if (!text) return { error: 'AI boş yanıt döndürdü — içerik güvenlik filtresine takılmış olabilir.' };
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return { data: JSON.parse(clean) }; }
    catch { return { error: 'AI yanıtı çözümlenemedi (beklenmeyen biçim). Tekrar deneyin.' }; }
  } catch (err) {
    if (isCancelled()) return { cancelled: true };
    if (err && err.name === 'AbortError') return { error: 'Gemini isteği zaman aşımına uğradı (120 sn).' };
    return { error: 'Gemini bağlantısı kurulamadı: ' + (err && err.message ? err.message : err) };
  } finally {
    clearTimeout(timer);
    setAbort(null);
  }
}

// AI araçları akışının sarmalayıcısı (aiAbort/aiCancelled ile)
function geminiGenerate(prompt, temperature) {
  return geminiRequest(prompt, temperature, (c) => { aiAbort = c; }, () => aiCancelled);
}

// Anahtar doğrulama: modele küçük bir GET (üretim maliyeti olmadan)
ipcMain.handle('ai-test-key', async (e, key) => {
  key = String(key || '').trim();
  if (!key) return { error: 'Anahtar boş.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, 15000);
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}?key=${encodeURIComponent(key)}`, { signal: ctrl.signal });
    if (res.ok) return { ok: true };
    return { error: geminiErrorMessage(res.status, await res.text().catch(() => '')) };
  } catch (err) {
    return { error: err && err.name === 'AbortError' ? 'Doğrulama zaman aşımına uğradı.' : 'Bağlantı kurulamadı: ' + err.message };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle('open-gemini-key-page', () => shell.openExternal('https://aistudio.google.com/apikey'));

// SRT içeriğini {start, end, text} segment dizisine çevirir. YouTube otomatik
// (ASR) altyazılarında birebir yinelenen bloklar tek segmentte birleştirilir.
function parseSrtSegments(content) {
  const toS = (h, m, s, ms) => (+h) * 3600 + (+m) * 60 + (+s) + (+ms) / 1000;
  const segs = [];
  for (const block of String(content || '').split(/\r?\n\r?\n/)) {
    const m = block.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!m) continue;
    const lines = block.split(/\r?\n/);
    const text = lines.slice(lines.findIndex(l => l.includes('-->')) + 1)
      .join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = toS(m[1], m[2], m[3], m[4]);
    const end = toS(m[5], m[6], m[7], m[8]);
    const last = segs[segs.length - 1];
    if (last && text === last.text) { last.end = Math.max(last.end, +end.toFixed(2)); continue; }
    segs.push({ start: +start.toFixed(2), end: +end.toFixed(2), text });
  }
  return segs;
}

// AI araçları için kullanılabilir yerel medya: yerel dosya > önbellekteki tam
// video > daha önce indirilmiş yalnız-ses (_ai_audio) dosyası
function findAiMedia(videoId, localFile) {
  if (localFile && fs.existsSync(localFile)) return localFile;
  const hit = findCachedMedia(videoId);
  if (hit) return hit;
  if (!videoId) return null;
  try {
    const dir = cacheDirPath();
    const f = fs.readdirSync(dir).find(n => n.startsWith(`${videoId}_ai_audio`));
    return f ? path.join(dir, f) : null;
  } catch {
    return null;
  }
}

// Yerel medyayı Whisper ile segmentlere çevirir: 16k mono WAV çıkarımı +
// subtitle.py + SRT parse. runner/sendStage/isCancelled parametreli — AI
// araçları (runAiProc/ai-progress) ve Moodlar (runMoodProc/mood-progress)
// kendi bağımsız takipleriyle aynı gövdeyi paylaşır.
async function whisperSegments(media, model, tmpDir, runner, sendStage, isCancelled) {
  sendStage({ stage: 'audio' });
  const wav = path.join(tmpDir, 'aud.wav');
  const ex = await runner(FFMPEG, ['-y', '-i', media, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], () => {});
  if (isCancelled()) return { cancelled: true };
  if (ex.code !== 0 || !fs.existsSync(wav)) return { error: 'Ses çıkarılamadı.' };

  sendStage({ stage: 'model' });
  const modelDir = path.join(app.getPath('userData'), 'whisper-models');
  fs.mkdirSync(modelDir, { recursive: true });
  const outSrt = path.join(tmpDir, 'ai.srt');
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  let errLine = '';
  const tr = await runner(pythonCmd, [
    path.join(__dirname, 'subtitle.py'), wav,
    '--out', outSrt, '--model', model, '--model-dir', modelDir
  ], (line) => {
    const m = line.match(/^PROGRESS (\d+)/);
    if (m) { sendStage({ stage: 'transcribe', pct: +m[1] }); return; }
    if (line.startsWith('STATUS model')) sendStage({ stage: 'model' });
    else if (line.startsWith('STATUS transcribe')) sendStage({ stage: 'transcribe', pct: 0 });
    else if (line.startsWith('ERROR ')) errLine = line.slice(6).trim();
  });
  if (isCancelled()) return { cancelled: true };
  if (tr.code !== 0 || !fs.existsSync(outSrt)) {
    let msg = errLine;
    if (!msg) {
      if (/ENOENT/.test(tr.stderr)) msg = 'Python bulunamadı. Transkript için Python 3 kurulu olmalı.';
      else msg = tr.stderr.split(/\r?\n/).filter(Boolean).slice(-2).join('\n') || 'Bilinmeyen hata.';
    }
    return { error: 'Transkript başarısız: ' + msg };
  }
  return { segments: parseSrtSegments(fs.readFileSync(outSrt, 'utf8')) };
}

// Transkript hazırlama — tüm AI araçlarının ortak ön koşulu. YouTube altyazısı
// varsa onu indirir (saniyeler sürer, anahtar gerektirmez); yoksa sesi (gerekirse
// tam videoyu indirmeden yalnız-ses indirmesiyle) Whisper'a verir. Sonuç
// id+kaynak anahtarıyla önbelleğe yazılır; _ai_ dosyaları pruneCache'ten muaftır.
ipcMain.handle('ai-transcript', async (e, opts) => {
  aiCancelled = false;
  const id = opts.videoId;
  if (!id) return { error: 'Önce bir video yükleyin.' };
  const cacheDir = cacheDirPath();
  fs.mkdirSync(cacheDir, { recursive: true });
  const isYt = opts.source === 'youtube';
  const model = opts.model || 'small';
  const cacheKey = isYt
    ? `${id}_ai_transcript_yt_${opts.lang}${opts.auto ? '.auto' : ''}.json`
    : `${id}_ai_transcript_${model}.json`;
  const cached = path.join(cacheDir, cacheKey);
  if (fs.existsSync(cached)) {
    try { return { ok: true, cachedHit: true, ...JSON.parse(fs.readFileSync(cached, 'utf8')) }; } catch {}
  }

  const url = opts.url || `https://www.youtube.com/watch?v=${id}`;
  let tmpDir = null;
  const cleanup = () => { if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} } };

  try {
    let segments;
    let doc;
    if (isYt) {
      aiSend({ stage: 'subdl' });
      const srtPath = await fetchSubtitle(url, id, opts.lang, opts.auto, runAiProc);
      if (aiCancelled) return { cancelled: true };
      if (!srtPath) return { error: 'YouTube altyazısı indirilemedi. Tekrar deneyin; sorun sürerse video altyazısız olabilir.' };
      segments = parseSrtSegments(fs.readFileSync(srtPath, 'utf8'));
      doc = { source: 'youtube', lang: opts.lang, auto: !!opts.auto, segments };
    } else {
      // 1) Medya: yerel dosya / önbellekteki video / yalnız-ses indirmesi
      let media = findAiMedia(id, opts.localFile);
      if (!media) {
        aiSend({ stage: 'download', pct: 0 });
        const outBase = path.join(cacheDir, `${id}_ai_audio`);
        const dl = await runAiProc(YTDLP, [
          '--no-playlist', '--newline', '--progress', '--no-warnings',
          '-f', 'bestaudio[ext=m4a]/bestaudio',
          '--ffmpeg-location', FFMPEG, '-o', `${outBase}.%(ext)s`, url
        ], (line) => {
          const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
          if (m) aiSend({ stage: 'download', pct: parseFloat(m[1]) });
        });
        if (aiCancelled) return { cancelled: true };
        if (dl.code !== 0) return { error: extractError(dl.stderr) };
        media = findAiMedia(id, null);
        if (!media) return { error: 'Ses indirildi ama dosya bulunamadı.' };
      }

      // 2) Whisper: WAV çıkarımı + çözümleme (paylaşılan yardımcı)
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-ai-'));
      const w = await whisperSegments(media, model, tmpDir, runAiProc, aiSend, () => aiCancelled);
      if (w.cancelled || w.error) return w;
      segments = w.segments;
      doc = { source: 'whisper', model, segments };
    }
    if (!segments.length) return { error: 'Bu videoda kullanılabilir konuşma/altyazı metni bulunamadı.' };
    try { fs.writeFileSync(cached, JSON.stringify(doc), 'utf8'); } catch {}
    return { ok: true, ...doc };
  } catch (err) {
    return { error: err.message };
  } finally {
    cleanup();
  }
});

// Segmentleri "[başlangıç-bitiş] metin" satırlarına çevirir; istenirse aralık
// filtresi ve segment başına enerji etiketi eklenir. Aşırı uzun transkriptler
// kabaca kırpılır (Gemini bağlamı geniş ama sınırsız değil).
const AI_MAX_CHARS = 250000;

function aiTranscriptBlock(segments, range, energyLabels) {
  const list = Array.isArray(segments) ? segments : [];
  let idxs = list.map((s, i) => i);
  if (range) idxs = idxs.filter(i => list[i].end > range.start && list[i].start < range.end);
  const lines = idxs.map(i => {
    const s = list[i];
    const en = energyLabels && energyLabels[i] ? ` (enerji: ${energyLabels[i]})` : '';
    return `[${(+s.start).toFixed(1)}-${(+s.end).toFixed(1)}]${en} ${s.text}`;
  });
  let text = lines.join('\n');
  let truncated = false;
  if (text.length > AI_MAX_CHARS) { text = text.slice(0, AI_MAX_CHARS); truncated = true; }
  return { count: idxs.length, text, truncated };
}

// Başlık/açıklama/hashtag üretici (kesim aralığı verilirse yalnız o aralık)
ipcMain.handle('ai-titles', async (e, { segments, videoTitle, range }) => {
  aiCancelled = false;
  const t = aiTranscriptBlock(segments, range || null);
  if (!t.count) return { error: 'Seçili aralıkta transkript metni yok.' };
  aiSend({ stage: 'think' });
  const prompt = [
    'Sen YouTube Shorts için çalışan usta bir içerik editörüsün. Aşağıda bir video',
    'klibinin transkripti var. Çıktıyı TÜRKÇE üret.',
    '',
    'İstenenler:',
    '- "titles": 3 vurucu Shorts başlığı (her biri en fazla 60 karakter; merak uyandıran ama yanıltıcı/tıklama tuzağı olmayan)',
    '- "caption": 1-2 cümlelik açıklama + izleyiciyi yoruma/etkileşime çağıran kısa bir soru',
    '- "hashtags": 8-12 hashtag (# ile; Türkçe ağırlıklı, konuya uygunsa birkaç İngilizce)',
    '',
    'Yalnızca şu JSON şemasıyla yanıt ver: {"titles":["...","...","..."],"caption":"...","hashtags":["#..."]}',
    '',
    videoTitle ? `Videonun özgün başlığı: ${videoTitle}` : '',
    'Transkript:',
    t.text
  ].filter(Boolean).join('\n');
  const r = await geminiGenerate(prompt, 0.7);
  if (r.error || r.cancelled) return r;
  const d = r.data || {};
  if (!Array.isArray(d.titles) || !d.titles.length) return { error: 'AI yanıtı beklenen biçimde değil, tekrar deneyin.' };
  return {
    ok: true,
    titles: d.titles.slice(0, 5).map(String),
    caption: String(d.caption || ''),
    hashtags: Array.isArray(d.hashtags) ? d.hashtags.map(String) : []
  };
});

// Semantik konu arama: "X'ten bahsettiği yerleri bul" → eşleşen zaman aralıkları
ipcMain.handle('ai-search', async (e, { segments, query }) => {
  aiCancelled = false;
  query = String(query || '').trim();
  if (!query) return { error: 'Aranacak bir konu yazın.' };
  const t = aiTranscriptBlock(segments, null);
  if (!t.count) return { error: 'Transkript boş.' };
  aiSend({ stage: 'think' });
  const prompt = [
    'Görev: aşağıdaki video transkriptinde, kullanıcının aradığı konudan gerçekten',
    'bahsedilen bölümleri bulmak. Satırlar "[başlangıç-bitiş] metin" biçiminde,',
    'zamanlar saniye cinsindendir. Yanıt dili TÜRKÇE.',
    '',
    `Kullanıcının aradığı: "${query}"`,
    '',
    'Kurallar:',
    '- Bitişik satırlar aynı konuyu sürdürüyorsa TEK bölümde birleştir (start=ilk satırın başlangıcı, end=son satırın bitişi).',
    '- Yalnızca gerçekten ilgili bölümleri döndür; zayıf/uzak çağrışımları alma.',
    '- Hiç eşleşme yoksa boş dizi döndür.',
    '- En fazla 10 sonuç.',
    '',
    'Yalnızca şu JSON şemasıyla yanıt ver:',
    '{"matches":[{"start":sayı,"end":sayı,"quote":"ilgili kısa alıntı","reason":"bir cümlelik gerekçe"}]}',
    '',
    'Transkript:',
    t.text
  ].join('\n');
  const r = await geminiGenerate(prompt, 0.2);
  if (r.error || r.cancelled) return r;
  const d = r.data || {};
  const matches = (Array.isArray(d.matches) ? d.matches : [])
    .filter(m => isFinite(+m.start) && isFinite(+m.end) && +m.end > +m.start)
    .map(m => ({ start: +m.start, end: +m.end, quote: String(m.quote || ''), reason: String(m.reason || '') }))
    .sort((a, b) => a.start - b.start)
    .slice(0, 10);
  return { ok: true, matches, truncated: t.truncated };
});

// Ses enerjisi profili: saniye başına ortalama RMS (dB). astats her saniyelik
// pencere (asetnsamples=16000 @ 16 kHz mono) için seviyeyi metadata olarak
// stdout'a yazar; -inf (mutlak sessizlik) -90 dB'ye sabitlenir.
async function computeEnergyProfile(file) {
  const vals = [];
  let lastT = 0;
  const r = await runAiProc(FFMPEG, [
    '-i', file, '-vn', '-ac', '1', '-ar', '16000',
    '-af', 'asetnsamples=16000,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-'
  ], (line) => {
    const tm = line.match(/pts_time:([\d.]+)/);
    if (tm) { lastT = parseFloat(tm[1]); return; }
    const vm = line.match(/RMS_level=(-?[\d.]+|-?inf|nan)/i);
    if (vm) {
      const v = parseFloat(vm[1]);
      vals.push({ t: lastT, db: isFinite(v) ? v : -90 });
    }
  });
  return (r.code === 0 && vals.length) ? vals : null;
}

// Her segmentin ortalama dB'sini videonun kendi dağılımına göre üç kademeye
// ayırır — mutlak eşik yerine görece eşik: kısık kayıtlı videolarda da çalışır.
function energyLabelsFor(segments, prof) {
  const avgs = segments.map(s => {
    const inSeg = prof.filter(p => p.t >= s.start && p.t < Math.max(s.start + 1, s.end));
    if (!inSeg.length) return null;
    return inSeg.reduce((a, b) => a + b.db, 0) / inSeg.length;
  });
  const valid = avgs.filter(a => a !== null).slice().sort((a, b) => a - b);
  if (valid.length < 6) return segments.map(() => null); // anlamlı dağılım için çok az örnek
  const lo = valid[Math.floor(valid.length / 3)];
  const hi = valid[Math.floor((valid.length * 2) / 3)];
  return avgs.map(a => a === null ? null : (a <= lo ? 'düşük' : a >= hi ? 'yüksek' : 'orta'));
}

// AI Hook Finder: viral potansiyelli anları transkript + ses enerjisiyle puanlar.
// Yerel medya yoksa (YouTube + yalnız altyazı yolu) enerji atlanır, yalnız
// transkriptle devam edilir — sonuç yine üretilir, renderer'da not gösterilir.
ipcMain.handle('ai-hooks', async (e, { segments, videoId, localFile }) => {
  aiCancelled = false;
  if (!Array.isArray(segments) || !segments.length) return { error: 'Transkript boş.' };

  let energyLabels = null;
  const media = findAiMedia(videoId, localFile);
  if (media) {
    aiSend({ stage: 'energy' });
    const prof = await computeEnergyProfile(media);
    if (aiCancelled) return { cancelled: true };
    if (prof) energyLabels = energyLabelsFor(segments, prof);
  }

  const t = aiTranscriptBlock(segments, null, energyLabels);
  aiSend({ stage: 'think' });
  const prompt = [
    'Sen viral kısa video (Shorts/Reels/TikTok) uzmanısın. Aşağıdaki transkriptte',
    'izleyiciyi İLK SANİYEDE yakalayacak "hook" anlarını bul. Satırlar',
    '"[başlangıç-bitiş] (enerji: …) metin" biçiminde; enerji etiketi o anın ses',
    'yoğunluğunu gösterir (yüksek enerji genelde vurgulu/duygusal anlardır).',
    'Yanıt dili TÜRKÇE.',
    '',
    'Kurallar:',
    '- Her hook 15-60 saniyelik, kendi başına anlamlı bir kesit olmalı (start/end\'i buna göre genişlet).',
    '- Değerlendir: merak uyandırma, duygusal/komik yoğunluk, şaşırtıcı ifade, ses enerjisi.',
    '- "score" 0-100 arası viral potansiyel puanı; en iyi en fazla 5 anı döndür, puana göre sırala.',
    '- "title" o kesit için 3-6 kelimelik etiket; "reason" bir cümlelik gerekçe.',
    '',
    'Yalnızca şu JSON şemasıyla yanıt ver:',
    '{"hooks":[{"start":sayı,"end":sayı,"score":sayı,"title":"...","reason":"..."}]}',
    '',
    'Transkript:',
    t.text
  ].join('\n');
  const r = await geminiGenerate(prompt, 0.4);
  if (r.error || r.cancelled) return r;
  const d = r.data || {};
  const hooks = (Array.isArray(d.hooks) ? d.hooks : [])
    .filter(h => isFinite(+h.start) && isFinite(+h.end) && +h.end > +h.start)
    .map(h => ({
      start: +h.start,
      end: +h.end,
      score: Math.max(0, Math.min(100, Math.round(+h.score || 0))),
      title: String(h.title || ''),
      reason: String(h.reason || '')
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return { ok: true, hooks, energyUsed: !!energyLabels };
});

// Reklam dostu içerik taraması. Not: Content ID / telif taraması teknik olarak
// yapılamaz (YouTube'un parmak izi veritabanına dış erişim yok); bu araç yalnız
// transkript içeriğini reklamveren yönergelerine göre değerlendirir.
ipcMain.handle('ai-adcheck', async (e, { segments, range }) => {
  aiCancelled = false;
  const t = aiTranscriptBlock(segments, range || null);
  if (!t.count) return { error: 'Seçili aralıkta transkript metni yok.' };
  aiSend({ stage: 'think' });
  const prompt = [
    'YouTube\'un "reklamveren dostu içerik" yönergelerine göre aşağıdaki video',
    'transkriptini tara. Aranan sorunlar: küfür/argo, şiddet ve ağır betimlemeler,',
    'yetişkin/cinsel içerik, uyuşturucu/alkol/sigara övgüsü, nefret söylemi/aşağılama,',
    'hassas güncel olaylar, tehlikeli davranışlar. Yanıt dili TÜRKÇE.',
    '',
    'Kurallar:',
    '- Her bulgu için transkriptteki zaman aralığını ve kısa alıntıyı ver.',
    '- "severity": "düşük" (tek/hafif küfür, ima) | "orta" (tekrarlı küfür, tartışmalı konu) | "yüksek" (ağır küfür, açık şiddet/cinsellik, nefret söylemi).',
    '- "verdict": "uygun" (bulgu yok/önemsiz) | "sınırlı" (sınırlı reklam riski) | "riskli" (reklam kapatılma riski yüksek).',
    '- "summary": 1-2 cümlelik genel değerlendirme.',
    '- Bulgu yoksa "findings" boş dizi olsun.',
    '',
    'Yalnızca şu JSON şemasıyla yanıt ver:',
    '{"verdict":"uygun|sınırlı|riskli","summary":"...","findings":[{"start":sayı,"end":sayı,"quote":"...","category":"...","severity":"düşük|orta|yüksek"}]}',
    '',
    'Transkript:',
    t.text
  ].join('\n');
  const r = await geminiGenerate(prompt, 0.2);
  if (r.error || r.cancelled) return r;
  const d = r.data || {};
  const verdict = ['uygun', 'sınırlı', 'riskli'].includes(d.verdict) ? d.verdict : 'sınırlı';
  const findings = (Array.isArray(d.findings) ? d.findings : [])
    .filter(f => isFinite(+f.start) && isFinite(+f.end))
    .map(f => ({
      start: +f.start,
      end: +f.end,
      quote: String(f.quote || ''),
      category: String(f.category || ''),
      severity: ['düşük', 'orta', 'yüksek'].includes(f.severity) ? f.severity : 'orta'
    }))
    .sort((a, b) => a.start - b.start)
    .slice(0, 30);
  return { ok: true, verdict, summary: String(d.summary || ''), findings };
});

// --- Faz 15: Moodlar & AI Director ---
// Bir bölüm dosyasından seçilen mood'da (~1 dk) anlatıcılı kısa kurgu üretir:
// Whisper diyalog haritası (Faz 14 transkript önbelleğini paylaşır) → Gemini'den
// sahne+anlatım planı → ElevenLabs TTS → montaj robotu. Montaj, Faz 13'ün
// kanıtlı trim/atrim/concat zinciri üzerine kurulur; anlatım çalarken özgün ses
// volume enable='between(...)' ile kısılır (ducking), anlatımlar adelay+amix ile
// bindirilir. Diğer işlerden bağımsız kendi süreç/iptal takibi vardır.
let moodProc = null;
let moodCancelled = false;
let moodAbort = null; // süren Gemini/TTS isteğinin iptali

function runMoodProc(cmd, args, onLine, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { windowsHide: true, env: procEnv, cwd });
    moodProc = proc;
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
    proc.on('close', (code) => { if (moodProc === proc) moodProc = null; resolve({ code, stderr: errBuf }); });
    proc.on('error', (err) => { if (moodProc === proc) moodProc = null; resolve({ code: -1, stderr: err.message }); });
  });
}

ipcMain.handle('mood-cancel', () => {
  moodCancelled = true;
  if (moodProc) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(moodProc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { moodProc.kill(); } catch {}
    }
  }
  if (moodAbort) { try { moodAbort.abort(); } catch {} }
});

function moodSend(p) { try { win.webContents.send('mood-progress', p); } catch {} }

// Mood tanımları: prompt'a giden anlatıcı tonu tarifleri
const MOODS = {
  komedi: 'komedi — esprili, hafif alaycı, enerjik bir anlatıcı tonu; komik ve absürt anlar öne çıkar',
  dram: 'dram — ağır, duygulu, düşündüren bir anlatıcı tonu; çatışma ve yüzleşme anları öne çıkar',
  gerilim: 'gerilim — tedirgin edici, merak kamçılayan bir anlatıcı tonu; belirsizlik ve tehdit anları öne çıkar',
  duygusal: 'duygusal — sıcak, dokunaklı, samimi bir anlatıcı tonu; bağ kuran ve hüzünlü anlar öne çıkar',
  ozet: 'özet — tarafsız, akıcı bir "önceki bölümlerde" tonu; olay örgüsünü taşıyan kilit anlar öne çıkar'
};

const ELEVEN_BASE = 'https://api.elevenlabs.io/v1';

function elevenErrorMessage(status, body) {
  const raw = String(body || '');
  if (status === 401) return 'ElevenLabs anahtarı geçersiz veya reddedildi. Ayarlar ekranından kontrol edin.';
  if (status === 429) return 'ElevenLabs istek sınırına takıldı. Biraz bekleyip tekrar deneyin.';
  if (status === 402 || /quota_exceeded|character/i.test(raw)) return 'ElevenLabs karakter kotası doldu — hesabınızı kontrol edin.';
  if (status >= 500) return 'ElevenLabs hizmeti şu an yanıt veremiyor. Birkaç dakika sonra tekrar deneyin.';
  return `ElevenLabs isteği başarısız (${status}).`;
}

// Kullanılabilir sesler (Moodlar ekranındaki seçici için)
ipcMain.handle('mood-voices', async () => {
  const key = (loadSettings().elevenKey || '').trim();
  if (!key) return { error: 'ElevenLabs anahtarı girilmemiş. Ayarlar ekranından ekleyin.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, 15000);
  try {
    const res = await fetch(`${ELEVEN_BASE}/voices`, { headers: { 'xi-api-key': key }, signal: ctrl.signal });
    if (!res.ok) return { error: elevenErrorMessage(res.status, await res.text().catch(() => '')) };
    const j = await res.json();
    const voices = (j.voices || []).map(v => ({ id: v.voice_id, name: v.name })).filter(v => v.id && v.name).slice(0, 50);
    if (!voices.length) return { error: 'Hesapta kullanılabilir ses bulunamadı.' };
    return { ok: true, voices };
  } catch (err) {
    return { error: err && err.name === 'AbortError' ? 'Ses listesi zaman aşımına uğradı.' : 'ElevenLabs bağlantısı kurulamadı: ' + err.message };
  } finally {
    clearTimeout(timer);
  }
});

// Tek anlatım metnini MP3'e çevirir (eleven_multilingual_v2 Türkçeyi destekler)
async function elevenTts(text, voiceId, outFile) {
  const key = (loadSettings().elevenKey || '').trim();
  if (!key) return { error: 'ElevenLabs anahtarı girilmemiş. Ayarlar ekranından ekleyin (seslendirme için gerekli).' };
  const ctrl = new AbortController();
  moodAbort = ctrl;
  const timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, 60000);
  try {
    const res = await fetch(`${ELEVEN_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
      signal: ctrl.signal
    });
    if (!res.ok) return { error: elevenErrorMessage(res.status, await res.text().catch(() => '')) };
    fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
    return { ok: true };
  } catch (err) {
    if (moodCancelled) return { cancelled: true };
    if (err && err.name === 'AbortError') return { error: 'Seslendirme isteği zaman aşımına uğradı.' };
    return { error: 'ElevenLabs bağlantısı kurulamadı: ' + (err && err.message ? err.message : err) };
  } finally {
    clearTimeout(timer);
    moodAbort = null;
  }
}

// Hassas süre (ondalıklı saniye) — anlatım ofset/ducking hesapları kare
// hassasiyeti ister; probeMedia'nın tam-saniye değeri yetmez.
function probeDurationPrecise(file) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-i', file], { windowsHide: true, env: procEnv });
    let buf = '';
    proc.stderr.on('data', (d) => { buf += d.toString('utf8'); });
    proc.on('close', () => {
      const m = buf.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
      resolve(m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 100 : 0);
    });
    proc.on('error', () => resolve(0));
  });
}

// Kurgu planı: transkript (önbellekten ya da Whisper) → Gemini → doğrulanmış
// sahne listesi. Plan kullanıcıya gösterilir; montaj ayrı adımda (mood-render).
ipcMain.handle('mood-plan', async (e, { file, videoId, mood, targetSec, model }) => {
  moodCancelled = false;
  if (!file || !fs.existsSync(file)) return { error: 'Dosya bulunamadı.' };
  const moodDesc = MOODS[mood];
  if (!moodDesc) return { error: 'Geçersiz mood seçimi.' };
  const meta = await probeMedia(file);
  if (!meta.duration || !meta.w) return { error: 'Video bilgisi okunamadı — dosya bozuk veya desteklenmiyor olabilir.' };

  // 1) Transkript — AI Araçları ile aynı önbellek anahtarı (iki ekran paylaşır)
  const cacheDir = cacheDirPath();
  fs.mkdirSync(cacheDir, { recursive: true });
  const mdl = model || 'small';
  const cached = videoId ? path.join(cacheDir, `${videoId}_ai_transcript_${mdl}.json`) : null;
  let segments = null;
  if (cached && fs.existsSync(cached)) {
    try { segments = JSON.parse(fs.readFileSync(cached, 'utf8')).segments; } catch {}
  }
  let tmpDir = null;
  const cleanup = () => { if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} } };
  try {
    if (!segments || !segments.length) {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-mood-'));
      const w = await whisperSegments(file, mdl, tmpDir, runMoodProc, moodSend, () => moodCancelled);
      if (w.cancelled || w.error) return w;
      segments = w.segments;
      if (cached && segments.length) {
        try { fs.writeFileSync(cached, JSON.stringify({ source: 'whisper', model: mdl, segments }), 'utf8'); } catch {}
      }
    }
    if (!segments.length) return { error: 'Bu videoda kullanılabilir konuşma bulunamadı.' };

    // 2) Gemini kurgu planı
    moodSend({ stage: 'plan' });
    const t = aiTranscriptBlock(segments, null);
    const target = Math.max(30, Math.min(120, +targetSec || 60));
    const prompt = [
      'Sen usta bir dizi editörü ve anlatıcı senaristisin. Aşağıda bir bölümün zaman',
      'damgalı transkripti var ("[başlangıç-bitiş] metin", saniye cinsinden).',
      `Görev: bu bölümden şu havada bir kısa kurgu çıkarmak → ${moodDesc}.`,
      `Hedef süre: yaklaşık ${target} saniye (±%20). Yanıt dili TÜRKÇE.`,
      '',
      'Kurallar:',
      '- 3-6 sahne seç; her sahne kaynaktan kesintisiz bir aralıktır (start/end transkript zamanları).',
      '- YALNIZCA güçlü, kendi başına anlaşılır diyalogların olduğu sahneleri seç; sessiz/zayıf anları alma.',
      '- Sahneler kronolojik sırada olmalı ve birbiriyle örtüşmemeli.',
      '- Sahne sınırlarını cümle ortasında kesme: aralığı satır sınırlarına oturt.',
      '- "narration": o sahnenin başında okunacak 1 cümlelik anlatıcı metni (hikayeyi bağlar, seçilen tonda; spoiler dozunda). Her sahnede gerekmiyorsa null bırak; toplam 2-4 anlatım olsun, ilk sahnede mutlaka olsun.',
      '- "title": kurgunun 3-5 kelimelik adı.',
      '',
      'Yalnızca şu JSON şemasıyla yanıt ver:',
      '{"title":"...","scenes":[{"start":sayı,"end":sayı,"narration":"... ya da null"}]}',
      '',
      'Transkript:',
      t.text
    ].join('\n');
    const r = await geminiRequest(prompt, 0.6, (c) => { moodAbort = c; }, () => moodCancelled);
    if (r.error || r.cancelled) return r;
    const d = r.data || {};

    // 3) Doğrulama/kırpma: sayısal, süre sınırları içinde, kronolojik, örtüşmesiz
    let scenes = (Array.isArray(d.scenes) ? d.scenes : [])
      .filter(s => isFinite(+s.start) && isFinite(+s.end) && +s.end > +s.start)
      .map(s => ({
        start: Math.max(0, +(+s.start).toFixed(2)),
        end: Math.min(meta.duration, +(+s.end).toFixed(2)),
        narration: (s.narration && String(s.narration).trim()) ? String(s.narration).trim().slice(0, 400) : null
      }))
      .sort((a, b) => a.start - b.start)
      .slice(0, 8);
    for (let i = 1; i < scenes.length; i++) {
      if (scenes[i].start < scenes[i - 1].end) scenes[i].start = scenes[i - 1].end;
    }
    scenes = scenes.filter(s => s.end - s.start >= 1.5);
    if (!scenes.length) return { error: 'Kurgu planı üretilemedi — farklı bir mood veya süre deneyin.' };
    const totalSec = scenes.reduce((s, x) => s + (x.end - x.start), 0);
    return { ok: true, title: String(d.title || ''), scenes, totalSec };
  } catch (err) {
    return { error: err.message };
  } finally {
    cleanup();
  }
});

// Montaj filter_complex grafiğini kurar (saf fonksiyon — testte doğrudan sınanır).
// Girdi 0 = kaynak video; 1..N = anlatım sesleri (narrItems sırası girdi sırasıdır).
// narrItems: [{offset, dur}] — offset çıktı zaman çizelgesindeki saniye.
function buildMoodFilterGraph(scenes, narrItems) {
  const parts = [];
  const labels = [];
  scenes.forEach((s, i) => {
    parts.push(`[0:v]trim=${s.start}:${s.end},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=${s.start}:${s.end},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  parts.push(`${labels.join('')}concat=n=${scenes.length}:v=1:a=1[outv][ca]`);
  if (!narrItems.length) {
    parts.push('[ca]anull[outa]');
    return parts.join(';');
  }
  // Ducking: anlatım çalarken özgün ses kısılır (0.22), bitince kendiliğinden döner
  const spans = narrItems.map(n => `between(t,${n.offset.toFixed(2)},${(n.offset + n.dur).toFixed(2)})`).join('+');
  parts.push(`[ca]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.22:enable='${spans}'[duck]`);
  const mixIns = ['[duck]'];
  narrItems.forEach((n, i) => {
    parts.push(`[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(n.offset * 1000)}:all=1[n${i}]`);
    mixIns.push(`[n${i}]`);
  });
  // duration=first: çıktı uzunluğunu montaj sesi belirler; normalize=0 seviye korur
  parts.push(`${mixIns.join('')}amix=inputs=${narrItems.length + 1}:duration=first:normalize=0[outa]`);
  return parts.join(';');
}

// Montaj robotu: TTS (sahne başına) → filter graph → tek geçişte render.
// GPU→CPU düşüşü smarttrim-apply'daki gibi kendi süreç takibiyle yapılır.
ipcMain.handle('mood-render', async (e, { file, scenes, voiceId, mood }) => {
  moodCancelled = false;
  if (!file || !fs.existsSync(file)) return { error: 'Dosya bulunamadı.' };
  const valid = (Array.isArray(scenes) ? scenes : [])
    .filter(s => isFinite(+s.start) && isFinite(+s.end) && +s.end > +s.start)
    .map(s => ({ start: +s.start, end: +s.end, narration: s.narration || null }));
  if (!valid.length) return { error: 'Montaj için sahne yok.' };
  const narrScenes = valid.filter(s => s.narration);
  if (narrScenes.length && !voiceId) return { error: 'Anlatıcı sesi seçilmedi.' };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-mood-out-'));
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
  const target = uniquePath(path.join(
    path.dirname(file),
    `${path.basename(file, path.extname(file))} [mood-${mood || 'kurgu'}].mp4`
  ));

  try {
    // 1) TTS: her anlatım ayrı MP3 (süreleri ofset/ducking hesabına girer)
    const narrItems = [];
    let done = 0;
    const offsets = [];
    let acc = 0;
    valid.forEach(s => { offsets.push(acc); acc += (s.end - s.start); });
    const totalSec = acc;
    for (let i = 0; i < valid.length; i++) {
      if (!valid[i].narration) continue;
      done++;
      moodSend({ stage: 'tts', idx: done, total: narrScenes.length });
      const mp3 = path.join(tmpDir, `narr${i}.mp3`);
      const t = await elevenTts(valid[i].narration, voiceId, mp3);
      if (moodCancelled || t.cancelled) { cleanup(); return { cancelled: true }; }
      if (t.error) { cleanup(); return t; }
      const dur = await probeDurationPrecise(mp3);
      if (!dur) { cleanup(); return { error: 'Seslendirme dosyası okunamadı.' }; }
      narrItems.push({ file: mp3, offset: offsets[i], dur });
    }

    // 2) Render
    const graph = buildMoodFilterGraph(valid, narrItems);
    let speed = 0;
    const onLine = (line) => {
      const sp = line.match(/^speed=\s*([\d.]+)x/);
      if (sp) { speed = parseFloat(sp[1]); return; }
      const m = line.match(/^out_time=(\d+):(\d+):(\d+)/);
      if (m && totalSec > 0) {
        const tSec = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
        let eta = null;
        if (speed > 0) {
          const remain = Math.max(0, Math.round((totalSec - tSec) / speed));
          eta = `${String(Math.floor(remain / 60)).padStart(2, '0')}:${String(remain % 60).padStart(2, '0')}`;
        }
        moodSend({ stage: 'render', pct: Math.min(99.9, (tSec / totalSec) * 100), eta });
      }
    };
    const buildArgs = (hwaccel, venc) => [
      '-y', ...hwaccel, '-i', file,
      ...narrItems.flatMap(n => ['-i', n.file]),
      '-filter_complex', graph, '-map', '[outv]', '-map', '[outa]',
      ...venc, '-c:a', 'aac', '-b:a', '192k',
      '-progress', 'pipe:1', '-nostats', target
    ];
    moodSend({ stage: 'render', pct: 0 });
    const encoder = await getEncoder();
    let r = await runMoodProc(FFMPEG, buildArgs(hwaccelArgs(encoder), videoEncodeArgs(encoder, 20)), onLine, tmpDir);
    if (!moodCancelled && r.code !== 0 && encoder !== 'libx264') {
      win.webContents.send('log', `GPU kodlama (${encoder}) başarısız oldu, CPU ile devam ediliyor…`);
      r = await runMoodProc(FFMPEG, buildArgs([], videoEncodeArgs('libx264', 20)), onLine, tmpDir);
    }
    if (moodCancelled) { try { fs.rmSync(target, { force: true }); } catch {} cleanup(); return { cancelled: true }; }
    if (r.code !== 0) {
      cleanup();
      return { error: 'Montaj başarısız:\n' + r.stderr.split(/\r?\n/).filter(Boolean).slice(-4).join('\n') };
    }
    cleanup();
    return { ok: true, outFile: target, duration: totalSec, narrated: narrItems.length };
  } catch (err) {
    try { fs.rmSync(target, { force: true }); } catch {}
    cleanup();
    return { error: err.message };
  }
});
