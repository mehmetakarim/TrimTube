const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
  const args = ['--no-playlist', '--newline', '--progress', '--no-warnings', '-N', '8', ...extraArgs];
  return runProc(YTDLP, args, (line) => {
    const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
    if (m) win.webContents.send('progress', parseFloat(m[1]));
    else win.webContents.send('log', line.trim());
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

  const ffProgress = (line) => {
    const m = line.match(/^out_time=(\d+):(\d+):(\d+)/);
    if (m && clipSec > 0) {
      const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
      win.webContents.send('progress', Math.min(99.9, (t / clipSec) * 100));
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
        const cut = await runProc(FFMPEG, [
          '-y', '-ss', trim.start, '-i', cacheFile, '-t', String(clipSec),
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'copy',
          '-progress', 'pipe:1', '-nostats', clipFile
        ], ffProgress);
        if (cancelRequested) { cleanupTmp(); return { ok: false, cancelled: true }; }
        if (cut.code !== 0) { cleanupTmp(); return { ok: false, error: 'Kesme başarısız:\n' + cut.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') }; }
      }

      // 2) Kişiyi takip et (tracker.py kırpma penceresi komutlarını üretir)
      win.webContents.send('phase', 'track');
      win.webContents.send('progress', 0);
      const trackArgs = [path.join(__dirname, 'tracker.py'), clipFile, '--out', path.join(tmpDir, 'cmds.txt')];
      if (trackPoint) trackArgs.push('--point', `${trackPoint.x.toFixed(4)},${trackPoint.y.toFixed(4)}`);
      const tr = await runProc('python', trackArgs, (line) => {
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
      const ff = await runProc(FFMPEG, [
        '-y', '-i', clipFile,
        '-vf', 'sendcmd=f=cmds.txt,crop=w=ih*9/16:h=ih:x=(iw-ow)/2:y=0,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '192k',
        '-progress', 'pipe:1', '-nostats', target
      ], ffProgress, tmpDir);
      if (cancelRequested) { try { fs.rmSync(target, { force: true }); } catch {} cleanupTmp(); return { ok: false, cancelled: true }; }
      if (ff.code !== 0) { cleanupTmp(); return { ok: false, error: 'Dinamik kırpma başarısız:\n' + ff.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') }; }
      cleanupTmp();
      return { ok: true };
    } catch (err) {
      cleanupTmp();
      return { ok: false, error: err.message };
    }
  }
  const ffArgs = ['-y'];
  // -ss'in -i'den önce olması hızlı sarma sağlar; yeniden kodlamayla kare hassasiyetindedir
  if (trim) ffArgs.push('-ss', trim.start);
  ffArgs.push('-i', cacheFile);
  if (trim) ffArgs.push('-t', String(clipSec));
  if (isAudio) {
    ffArgs.push('-c', 'copy'); // mp3 kesmede yeniden kodlamaya gerek yok
  } else {
    if (wantVertical) {
      // Ortadan 9:16 kırp; kaynak zaten darsa kırpma, 1080x1920 tuvale sığdır
      ffArgs.push('-vf', 'crop=min(iw\\,ih*9/16):ih,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2');
    }
    ffArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '192k');
  }
  ffArgs.push('-progress', 'pipe:1', '-nostats', target);

  win.webContents.send('phase', 'convert');
  win.webContents.send('progress', 0);

  const ff = await runProc(FFMPEG, ffArgs, ffProgress);

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
