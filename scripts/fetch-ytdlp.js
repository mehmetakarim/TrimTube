// Paketleme öncesi platforma özel yt-dlp ikili dosyasını indirir.
// Kullanım: node scripts/fetch-ytdlp.js [win32|darwin]
const https = require('https');
const fs = require('fs');
const path = require('path');

const platform = process.argv[2] || process.platform;
const isWin = platform === 'win32';
const url = isWin
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';

const outDir = path.join(__dirname, '..', 'resources', 'bin', isWin ? 'win' : 'mac');
const outFile = path.join(outDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');

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
        if (!isWin) fs.chmodSync(dest, 0o755);
        console.log('yt-dlp indirildi:', dest);
      });
    });
  }).on('error', (err) => {
    console.error(err);
    process.exit(1);
  });
}

download(url, outFile);
