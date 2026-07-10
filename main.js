const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

const YTDLP = resolveYtdlp();
const FFMPEG = resolveFfmpeg();

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
function extractError(stderr) {
  const lines = (stderr || '').split(/\r?\n/).filter(l => l.includes('ERROR'));
  return lines.length ? lines.join('\n') : (stderr || 'Bilinmeyen hata');
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

ipcMain.handle('waveform', async (e, { url, start, duration }) => {
  if (!url) return null;
  if (waveformProc) { try { waveformProc.kill(); } catch {} waveformProc = null; }

  const out = path.join(os.tmpdir(), `trimtube-wave-${Date.now()}.png`);
  const args = [
    '-y', '-ss', String(start), '-i', url, '-t', String(duration),
    // scale=sqrt: kısık sesli konuşmayı görünür kılar, gerçek sessizlik düz kalır —
    // kesim noktasını diyalog/sessizlik sınırına koymayı kolaylaştırır
    '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=900x92:colors=0A84FF:scale=sqrt',
    '-frames:v', '1', out, '-loglevel', 'error'
  ];

  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true, env: procEnv });
    waveformProc = proc;
    const timer = setTimeout(() => { try { proc.kill(); } catch {} }, 30000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (waveformProc === proc) waveformProc = null;
      if (code !== 0 || !fs.existsSync(out)) return resolve(null);
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
            previewUrl: preferred ? preferred.url : null
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
function pruneCache(cacheDir, keep) {
  try {
    fs.readdirSync(cacheDir)
      .filter(f => f !== keep && !f.endsWith('.part'))
      .map(f => ({ f, t: fs.statSync(path.join(cacheDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(1) // keep dışında en yeni 1 dosya daha kalsın
      .forEach(x => { try { fs.rmSync(path.join(cacheDir, x.f), { force: true }); } catch {} });
  } catch {}
}

ipcMain.handle('download', async (e, opts) => {
  const { url, id, title, folder, quality, trim, vertical, duration, track, trackPoint } = opts;
  cancelRequested = false;

  const isAudio = quality === 'audio';
  const wantVertical = vertical && !isAudio;
  const wantTrack = wantVertical && track;
  const needPost = !!trim || wantVertical;

  // --- Basit durum: kesme/dönüştürme yok → doğrudan hedef klasöre indir ---
  if (!needPost) {
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
  const cacheName = `${id}_${quality}.${isAudio ? 'mp3' : 'mp4'}`;
  const cacheFile = path.join(cacheDir, cacheName);

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

  // Çıktı adı ve ffmpeg argümanları
  let suffix = trim ? ` [${trim.start.replace(/:/g, '.')}-${trim.end.replace(/:/g, '.')}]` : '';
  if (wantVertical) suffix += wantTrack ? ' [9x16 takipli]' : ' [9x16]';
  const target = path.join(folder, `${sanitizeName(title)}${suffix}.${isAudio ? 'mp3' : 'mp4'}`);

  const clipSec = trim ? (toSec(trim.end) - toSec(trim.start)) : (duration || 0);

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

  // --- Kişi takipli dikey kadraj: kes → takip et → dinamik kırp ---
  if (wantTrack) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-trim-'));
    const cleanupTmp = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} };
    try {
      // 1) Kesit (orijinal en-boy oranında); kesme yoksa tam video kullanılır
      let clipFile = cacheFile;
      if (trim) {
        clipFile = path.join(tmpDir, 'clip.mp4');
        win.webContents.send('phase', 'convert');
        win.webContents.send('progress', 0);
        const cut = await runEncodeWithFallback((hwaccel, venc) => [
          '-y', ...hwaccel, '-ss', trim.start, '-i', cacheFile, '-t', String(clipSec),
          ...venc, '-c:a', 'copy',
          '-progress', 'pipe:1', '-nostats', clipFile
        ], 18, ffProgress);
        if (cancelRequested) { cleanupTmp(); return { ok: false, cancelled: true }; }
        if (cut.code !== 0) { cleanupTmp(); return { ok: false, error: 'Kesme başarısız:\n' + cut.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') }; }
      }

      // 2) Kişiyi takip et (tracker.py kırpma penceresi komutlarını üretir)
      win.webContents.send('phase', 'track');
      win.webContents.send('progress', 0);
      const trackArgs = [path.join(__dirname, 'tracker.py'), clipFile, '--out', path.join(tmpDir, 'cmds.txt')];
      if (trackPoint) trackArgs.push('--point', `${trackPoint.x.toFixed(4)},${trackPoint.y.toFixed(4)}`);
      
      // macOS/Linux'ta python3, Windows'ta python çalıştır
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      const tr = await runProc(pythonCmd, trackArgs, (line) => {
        const m = line.match(/^PROGRESS (\d+)/);
        if (m) win.webContents.send('progress', Math.min(99.9, +m[1]));
        else if (line.startsWith('WARN')) win.webContents.send('log', line);
      });
      if (cancelRequested) { cleanupTmp(); return { ok: false, cancelled: true }; }
      if (tr.code !== 0 || !fs.existsSync(path.join(tmpDir, 'cmds.txt'))) {
        cleanupTmp();
        return { ok: false, error: 'Kişi takibi başarısız:\n' + tr.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') };
      }

      // 3) Takip verisiyle dinamik kırpma (sendcmd yolu sorun çıkarmasın diye cwd=tmpDir)
      win.webContents.send('phase', 'convert');
      win.webContents.send('progress', 0);
      const ff = await runEncodeWithFallback((hwaccel, venc) => [
        '-y', ...hwaccel, '-i', clipFile,
        '-vf', 'sendcmd=f=cmds.txt,crop=w=ih*9/16:h=ih:x=(iw-ow)/2:y=0,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
        ...venc, '-c:a', 'aac', '-b:a', '192k',
        '-progress', 'pipe:1', '-nostats', target
      ], 20, ffProgress, tmpDir);
      if (cancelRequested) { try { fs.rmSync(target, { force: true }); } catch {} cleanupTmp(); return { ok: false, cancelled: true }; }
      if (ff.code !== 0) { cleanupTmp(); return { ok: false, error: 'Dinamik kırpma başarısız:\n' + ff.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') }; }
      cleanupTmp();
      return { ok: true };
    } catch (err) {
      cleanupTmp();
      return { ok: false, error: err.message };
    }
  }
  // -ss'in -i'den önce olması hızlı sarma sağlar; yeniden kodlamayla kare hassasiyetindedir
  const inputArgs = [];
  if (trim) inputArgs.push('-ss', trim.start);
  inputArgs.push('-i', cacheFile);
  if (trim) inputArgs.push('-t', String(clipSec));

  win.webContents.send('phase', 'convert');
  win.webContents.send('progress', 0);

  let ff;
  if (isAudio) {
    // mp3 kesmede yeniden kodlamaya (dolayısıyla GPU kodlamaya) gerek yok
    ff = await runProc(FFMPEG, ['-y', ...inputArgs, '-c', 'copy', '-progress', 'pipe:1', '-nostats', target], ffProgress);
  } else {
    // Ortadan 9:16 kırp; kaynak zaten darsa kırpma, 1080x1920 tuvale sığdır
    const vf = wantVertical
      ? ['-vf', 'crop=min(iw\\,ih*9/16):ih,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2']
      : [];
    ff = await runEncodeWithFallback((hwaccel, venc) => [
      '-y', ...hwaccel, ...inputArgs, ...vf, ...venc, '-c:a', 'aac', '-b:a', '192k',
      '-progress', 'pipe:1', '-nostats', target
    ], 20, ffProgress);
  }

  if (cancelRequested) {
    try { fs.rmSync(target, { force: true }); } catch {}
    return { ok: false, cancelled: true };
  }
  if (ff.code !== 0) {
    return { ok: false, error: 'Kesme/dönüştürme başarısız:\n' + ff.stderr.split(/\r?\n/).filter(Boolean).slice(-4).join('\n') };
  }
  return { ok: true };
});

ipcMain.handle('cancel', () => {
  cancelRequested = true;
  if (currentProc) {
    // Windows'ta ffmpeg gibi alt süreçlerin de kapanması için süreç ağacını öldür
    spawn('taskkill', ['/pid', String(currentProc.pid), '/T', '/F'], { windowsHide: true });
  }
});
