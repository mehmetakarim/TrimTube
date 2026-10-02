// One source, ordered cuts. Lossless intermediate keeps export effects on one timeline.
const fs = require('fs');
const path = require('path');
const Timeline = require('./renderer/timeline-data');
async function assemble({ source, clips, dir, ffmpeg, run, cancelled, progress }) {
  const probe = await run(ffmpeg, ['-i', source], () => {});
  if (cancelled()) return { cancelled: true };
  const match = probe.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw Error('Kurgu kaynağının süresi okunamadı.');
  const duration = +match[1] * 3600 + +match[2] * 60 + +match[3];
  clips = Timeline.validate(clips, duration);
  const video = /Video:/.test(probe.stderr), audio = /Audio:/.test(probe.stderr);
  if (!video) throw Error('Kurgu için video içeren bir kaynak seçin.');
  // Read each range separately: reverse edits on long recordings must not buffer
  // every preceding frame in a multi-branch concat filter graph.
  const files = []; let offset = 0;
  for (let i = 0; i < clips.length; i++) {
    if (cancelled()) return { cancelled: true };
    const clip = clips[i], name = `part-${i}.mkv`, length = clip.end - clip.start;
    const result = await run(ffmpeg, ['-y', '-ss', String(clip.start), '-i', source, '-map', '0:v:0', ...(audio ? ['-map', '0:a:0', '-af', 'apad'] : []), '-t', String(length), '-c:v', 'ffv1', '-level', '3', '-c:a', 'pcm_s16le', '-progress', 'pipe:1', '-nostats', path.join(dir, name)], line => {
      const m = line.match(/^out_time=(\d+):(\d+):([\d.]+)/);
      if (m) progress(`out_time=00:00:${offset + Math.min(length, +m[1] * 3600 + +m[2] * 60 + +m[3])}`);
    });
    if (cancelled()) return { cancelled: true };
    if (result.code !== 0) throw Error(`${i + 1}. parça hazırlanamadı: ` + result.stderr.split(/\r?\n/).filter(Boolean).slice(-4).join('\n'));
    files.push(name); offset += length;
  }
  const list = path.join(dir, 'sequence.ffconcat'), file = path.join(dir, 'sequence.mkv');
  fs.writeFileSync(list, 'ffconcat version 1.0\n' + files.map((name, i) => `file ${name}\nduration ${clips[i].end - clips[i].start}`).join('\n'), 'utf8');
  const result = await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '1', '-i', list, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', file], () => {});
  if (cancelled()) return { cancelled: true };
  if (result.code !== 0) throw Error('Kurgu birleştirilemedi: ' + result.stderr.split(/\r?\n/).filter(Boolean).slice(-4).join('\n'));
  return { file, duration: Timeline.duration(clips) };
}
module.exports = { assemble };
