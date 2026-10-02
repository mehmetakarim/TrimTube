// Raw recognition only: user edits and approval stay in the project.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function key(opts) {
  let source = ['youtube', opts.videoId];
  if (opts.localFile) {
    const stat = fs.statSync(opts.localFile);
    source = ['local', path.resolve(opts.localFile), stat.size, stat.mtimeMs];
  }
  return hash([1, source, opts.source === 'youtube' ? ['youtube', opts.lang, !!opts.auto] : ['whisper', opts.model || 'small']]);
}
function valid(doc) {
  return doc && doc.version === 1 && (!doc.range || (Number.isFinite(doc.range.start) && doc.range.start >= 0 && Number.isFinite(doc.range.duration) && doc.range.duration > 0)) && Array.isArray(doc.segments) && doc.segments.length > 0 && doc.segments.length <= 100000 &&
    doc.segments.every(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start && typeof c.text === 'string') &&
    Array.isArray(doc.words) && doc.words.every(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end > w.start && typeof w.word === 'string');
}
function put(dir, opts, doc, range = null) {
  const record = { version: 1, source: doc.source, model: doc.model, lang: doc.lang, auto: doc.auto, segments: doc.segments, words: doc.words || [], range };
  if (!valid(record)) return;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `transcript-v1-${key(opts)}-${hash(range)}.json`);
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, JSON.stringify(record)); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function get(dir, opts, range = null) {
  try {
    const prefix = `transcript-v1-${key(opts)}-`;
    for (const name of fs.readdirSync(dir).filter(n => n.startsWith(prefix) && n.endsWith('.json'))) {
      try {
        const file = path.join(dir, name); if (fs.statSync(file).size > 20000000) continue;
        const doc = JSON.parse(fs.readFileSync(file, 'utf8')); if (!valid(doc)) continue;
        if (!range) { if (!doc.range) return doc; continue; }
        if (doc.range && (doc.range.start > range.start || doc.range.start + doc.range.duration < range.start + range.duration)) continue;
        const shift = c => ({ ...c, start: Math.max(0, c.start - range.start), end: Math.min(range.duration, c.end - range.start) });
        const intersects = c => c.end > range.start && c.start < range.start + range.duration;
        const segments = doc.segments.filter(intersects).map(shift);
        if (!segments.length) continue;
        return { ...doc, segments, words: doc.words.filter(intersects).map(shift) };
      } catch {} // A broken record is a cache miss, never a broken editing session.
    }
  } catch {}
  return null;
}
module.exports = { get, put };
