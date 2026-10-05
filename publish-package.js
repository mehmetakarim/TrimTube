const fs = require('fs');
const path = require('path');
function validate(options, duration, audio, subtitle) {
  if (!options?.enabled) return;
  if (audio) throw Error('Yayın paketi için video çıktısı seçin.');
  if (!Number.isFinite(options.coverTime) || options.coverTime < 0 || options.coverTime >= duration) throw Error('Kapak zamanı çıktı süresinin içinde olmalı.');
  if (options.srt && !subtitle) throw Error('SRT dosyası için altyazıyı oluşturup onaylayın ve etkinleştirin.');
  if (typeof options.title !== 'string' || options.title.length > 200 || typeof options.description !== 'string' || options.description.length > 5000) throw Error('Yayın başlığı veya açıklaması geçersiz.');
}
async function create({ options, files, subtitle, ffmpeg, run, cancelled }) {
  const dir = fs.mkdtempSync(path.join(path.dirname(files[0]), 'Yayin-paketi-'));
  const extras = [];
  try {
    for (const file of files) {
      if (cancelled()) throw Error('Yayın paketi iptal edildi. Video dosyaları korundu.');
      const stem = path.parse(file).name;
      const cover = path.join(dir, stem + '.kapak.jpg');
      const result = await run(ffmpeg, ['-y','-ss',String(options.coverTime),'-i',file,'-frames:v','1','-q:v','2',cover], () => {});
      if (cancelled()) throw Error('Yayın paketi iptal edildi. Video dosyaları korundu.');
      if (result.code !== 0 || !fs.existsSync(cover) || !fs.statSync(cover).size) throw Error('Kapak karesi oluşturulamadı. Video dosyaları korundu.');
      extras.push(cover);
      if (options.srt) { const srt = path.join(dir, stem + '.srt'); fs.writeFileSync(srt, subtitle.srt, 'utf8'); extras.push(srt); }
    }
    const note = path.join(dir, 'yayin-metni.txt');
    fs.writeFileSync(note, `${options.title}\n\n${options.description}\n`, 'utf8'); extras.push(note);
    const manifest = path.join(dir, 'paket.json');
    fs.writeFileSync(manifest, JSON.stringify({version:1,title:options.title,description:options.description,coverTime:options.coverTime,videos:files.map(f=>path.basename(f)),files:extras.map(f=>path.basename(f))},null,2),'utf8'); extras.push(manifest);
    return extras;
  } catch (err) { fs.rmSync(dir,{recursive:true,force:true}); throw err; }
}
module.exports = { validate, create };
