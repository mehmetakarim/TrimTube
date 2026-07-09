// Paketleme öncesi platforma özel yt-dlp ikili dosyasını indirir.
// Kullanım: node scripts/fetch-ytdlp.js [win32|darwin|linux]
const https = require('https');
const fs = require('fs');
const path = require('path');

const platform = process.argv[2] || process.platform;

const TARGETS = {
  win32: { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', dir: 'win', file: 'yt-dlp.exe' },
  darwin: { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos', dir: 'mac', file: 'yt-dlp' },
  linux: { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', dir: 'linux', file: 'yt-dlp' }
};

const target = TARGETS[platform];
if (!target) {
  console.error('Bilinmeyen platform:', platform);
  process.exit(1);
}

const outDir = path.join(__dirname, '..', 'resources', 'bin', target.dir);
const outFile = path.join(outDir, target.file);

fs.mkdirSync(outDir, { recursive: true });

function download(u, dest, redirects = 0) {
  if (redirects > 5) {
    console.error('Çok fazla yönlendirme');
    process.exit(1);
  }
  https.get(u, { headers: { 'User-Agent': 'trimtube-build' } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      return download(res.headers.location, dest, redirects + 1);
    }
    if (res.statusCode !== 200) {
      console.error('İndirme hatası:', res.statusCode, u);
      process.exit(1);
    }
    const file = fs.createWriteStream(dest);
    res.pipe(file);
    file.on('finish', () => {
      file.close(() => {
        if (platform !== 'win32') fs.chmodSync(dest, 0o755);
        console.log('yt-dlp indirildi:', dest);
      });
    });
  }).on('error', (err) => {
    console.error(err);
    process.exit(1);
  });
}

download(target.url, outFile);
