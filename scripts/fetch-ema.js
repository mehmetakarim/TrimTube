// Paketleme öncesi yerel seslendirme (EMA Lightning) modellerini indirir ve SHA-256 ile doğrular.
// Dosyalar TrimTube deposundaki ema-models-1 release ekinde; nasıl üretildikleri tools/ema/README.md'de.
// Kullanım: node scripts/fetch-ema.js   (zaten varsa ve özet tutuyorsa indirmez)
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = 'https://github.com/mehmetakarim/TrimTube/releases/download/ema-models-1/';
const FILES = {
  'ema_text.onnx': 'dd092357185c7f0b171cb25378bd6bedfbb0d43e61d3ccad4bee61818d30bfc2',
  'ema_sound.onnx': '656349eb4539aeb1497a87113d2db579c87438cc953d174ce7c0d23ec9551f6a',
  'ema_decoder.onnx': '52f6317666b7921637b5129706cd64202a119881ee43e581d9fac98f531a8aa7',
  'ema_config.json': 'd0eaa3e8d5846f1f11ee2878cc50510c3f8d7c55ec058b4512c83700d808ad74',
  'normalizer_tr.wasm': 'cea1a094dc92fff2cd6c96b0f0d82828c4f83b8c40d7e3e3f4c2de18df112abb',
  'NOTICE.txt': '902488a0ce704a02f7c109552c03e8906bca62b413a13a5df59195067b011c63'
};
const outDir = path.join(__dirname, '..', 'resources', 'ema');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(Error('Çok fazla yönlendirme'));
    https.get(url, { headers: { 'User-Agent': 'trimtube-build' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(download(res.headers.location, dest, redirects + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(Error(`İndirme hatası ${res.statusCode}: ${url}`)); }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, hash] of Object.entries(FILES)) {
    const dest = path.join(outDir, name);
    if (fs.existsSync(dest) && sha(dest) === hash) continue;
    const part = dest + '.part';
    await download(BASE + name, part);
    const got = sha(part);
    if (got !== hash) { fs.rmSync(part, { force: true }); throw Error(`${name} doğrulanamadı (beklenen ${hash.slice(0, 12)}…, gelen ${got.slice(0, 12)}…)`); }
    fs.renameSync(part, dest);
    console.log('EMA modeli indirildi:', name);
  }
  console.log('EMA modelleri hazır:', outDir);
})().catch(err => { console.error(err.message); process.exit(1); });
