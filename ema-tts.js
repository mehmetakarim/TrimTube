// EMA Lightning (yerel Türkçe TTS) — PyTorch'suz çalıştırma.
// Model (Apache-2.0, canberkkkkkk/ema-lightning) üç ONNX grafiğine çevrildi: metin
// (harf → özellik + harf süresi), ses (akış eşleme, 4 adımda 64 boyutlu latent, 25 Hz)
// ve çözücü (latent → 48 kHz ses). Türkçe metin normalleştirici (normalizer-tr, Rust,
// Apache-2.0) WebAssembly'ye derlendi. Python gerekmez; onnxruntime-node ile CPU'da çalışır.
// Yapıştırıcı kod ema_lightning paketinin (engine.py, chunker.py, frontend.py) birebir karşılığıdır.
const fs = require('fs');
const path = require('path');

const RATE = 48000, FPS = 25, MAX_WORD_FRAMES = 250, MAX_FRAMES = 3000;
// chunker.py: ~10 sn'lik parçalar; cümle sonunda .25, yan cümlede .12 sn sessizlik
const LETTERS_PER_SECOND = 18, MAX_SECONDS = 10, MAX_LETTERS = 250, SENTENCE_PAUSE = .25, CLAUSE_PAUSE = .12;
const TURKISH = new Set('çğıöşüÇĞİÖŞÜ');
const TYPOGRAPHY = { '’': "'", '‘': "'", 'ʼ': "'", '´': "'", '`': "'", '“': '"', '”': '"', '„': '"', '«': '"', '»': '"', '–': '-', '—': '-', '−': '-', '…': '...' };
const UNSAFE = /[\x00-\x08\x0b-\x1f\x7f-\x9f؜‎‏‪-‮⁦-⁩]/g;

// Normalleştiricinin harf harf okuduğu (geri dönüş) sık yazımlar, ondan önce okunur hale
// getirilir: "K2'yi" → "K 2'yi" (ke ikiyi), "600 mm/s" → "milimetre bölü saniye",
// "60°C" → "altmış derece", "350x350" → "çarpı", "K1 vs K2" → "karşı".
const UNIT_WORDS = { mm: 'milimetre', cm: 'santimetre', m: 'metre', km: 'kilometre', g: 'gram', kg: 'kilogram', ml: 'mililitre', l: 'litre' };
const PER_WORDS = { s: 'saniye', sn: 'saniye', sa: 'saat', h: 'saat', dk: 'dakika', min: 'dakika' };
const LETTER_NAMES = { A: 'a', B: 'be', C: 'ce', Ç: 'çe', D: 'de', E: 'e', F: 'fe', G: 'ge', Ğ: 'yumuşak ge', H: 'he', I: 'ı', İ: 'i', J: 'je', K: 'ke', L: 'le', M: 'me', N: 'ne', O: 'o', Ö: 'ö', P: 'pe', Q: 'kü', R: 're', S: 'se', Ş: 'şe', T: 'te', U: 'u', Ü: 'ü', V: 've', W: 'dabılyu', X: 'iks', Y: 'ye', Z: 'ze' };
const spell = letters => [...letters.toLocaleUpperCase('tr')].map(ch => LETTER_NAMES[ch] || ch).join(' ');
function prepare(text) {
  return text
    .replace(/[’‘ʼ´`]/g, "'")
    // Ekli model adı / kısaltma: harfler adıyla okunur, ek son hece ile birleşir
    .replace(/\b([A-ZÇĞİÖŞÜ]{1,3})(\d+)'/g, (m, l, d) => `${spell(l)} ${d}'`)
    .replace(/\b([A-ZÇĞİÖŞÜ]{2,5})'([a-zçğıöşü]+)/g, (m, l, suffix) => spell(l) + suffix)
    .replace(/\b(\d+)([A-ZÇĞİÖŞÜ]{1,3})'([a-zçğıöşü]+)/g, (m, d, l, suffix) => `${d} ${spell(l)}${suffix}`)
    .replace(/(\d)\s*(mm|cm|km|kg|ml|m|g|l)\s*\/\s*(sn|sa|dk|min|s|h)\b/g, (m, d, u, p) => `${d} ${UNIT_WORDS[u]} bölü ${PER_WORDS[p]}`)
    .replace(/(\d)\s*°\s*[CcСс]\b/g, '$1 derece').replace(/(\d)\s*°\s*F\b/g, '$1 derece fahrenhayt').replace(/(\d)\s*°/g, '$1 derece')
    .replace(/(\d)\s*[xX×]\s*(?=\d)/g, '$1 çarpı ')
    .replace(/(^|\s)[xX×](\d+)(?![\p{L}\d])/gu, '$1$2 kat')
    .replace(/\s(?:vs\.?|VS\.?|Vs\.?)\s/g, ' karşı ');
}

function createEma({ dir, ort }) {
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'ema_config.json'), 'utf8'));
  const vocab = config.vocab, stoi = new Map(vocab.map((ch, i) => [ch, i])), vocabSet = new Set(vocab);
  let sessions = null, wasm = null;

  // ---- metin ön işleme (frontend.py) ----
  function normalizer() {
    if (!wasm) wasm = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path.join(dir, 'normalizer_tr.wasm'))), {}).exports;
    return wasm;
  }
  function spoken(text) {
    const w = normalizer(), bytes = Buffer.from(text, 'utf8');
    if (!bytes.length) return '';
    const p = w.alloc(bytes.length);
    new Uint8Array(w.memory.buffer, p, bytes.length).set(bytes);
    const r = w.normalize(p, bytes.length); w.free(p, bytes.length);
    const ptr = Number(r >> 32n), len = Number(r & 0xffffffffn);
    const out = Buffer.from(new Uint8Array(w.memory.buffer, ptr, len)).toString('utf8'); w.free(ptr, len);
    return out;
  }
  function blocks(text) { // normalleştirici tek çağrıda ≤ 8 KB alır
    const out = []; let block = [], size = 0;
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const n = Buffer.byteLength(word) + 1;
      if (block.length && size + n > 8 * 1024) { out.push(block.join(' ')); block = []; size = 0; }
      block.push(word); size += n;
    }
    if (block.length) out.push(block.join(' '));
    return out;
  }
  function alphabet(text) {
    text = [...text].map(ch => TYPOGRAPHY[ch] ?? ch).join('').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
    let out = '';
    for (let ch of text) {
      if (!TURKISH.has(ch)) ch = ch.normalize('NFKD').replace(/\p{M}/gu, '');
      out += ch && [...ch].every(c => vocabSet.has(c)) ? ch : ' ';
    }
    return out.replace(/\s+/g, ' ').trim();
  }
  function frontend(text) {
    text = prepare(String(text || '').replace(UNSAFE, ' '));
    if (!text.trim()) return '';
    return alphabet(blocks(text).map(spoken).join(' '));
  }

  // ---- parçalara bölme (chunker.py) ----
  function chunk(text, speed) {
    const limit = Math.floor(Math.min(MAX_LETTERS, LETTERS_PER_SECOND * MAX_SECONDS * speed));
    const cuts = [[/[.!?]+["')]*(?= )/g, SENTENCE_PAUSE], [/[,;:](?= )/g, CLAUSE_PAUSE], [/\S(?= )/g, CLAUSE_PAUSE]];
    const pieces = []; let rest = text.trim();
    while (rest) {
      let cut = rest.length, pause = 0;
      if (rest.length > limit) {
        cut = limit;
        for (const [re, gap] of cuts) {
          const ends = []; re.lastIndex = 0; let m;
          const head = rest.slice(0, limit + 1);
          while ((m = re.exec(head))) ends.push(m.index + m[0].length);
          if (ends.length) { cut = ends.at(-1); pause = gap; break; }
        }
      }
      const piece = rest.slice(0, cut).trim(); rest = rest.slice(cut).trim();
      if (/\p{L}/u.test(piece)) pieces.push([finish(piece), pause]);
    }
    if (pieces.length) pieces.at(-1)[1] = 0;
    return pieces;
  }
  const finish = piece => /[.!?]$/.test(piece.replace(/["')]+$/, '')) ? piece : piece.replace(/[,;:\- ]+$/, '') + '.';

  // ---- motor (engine.py) ----
  async function load() {
    if (sessions) return sessions;
    const opts = { executionProviders: ['cpu'], graphOptimizationLevel: 'all' };
    sessions = {
      text: await ort.InferenceSession.create(path.join(dir, 'ema_text.onnx'), opts),
      sound: await ort.InferenceSession.create(path.join(dir, 'ema_sound.onnx'), opts),
      decoder: await ort.InferenceSession.create(path.join(dir, 'ema_decoder.onnx'), opts)
    };
    return sessions;
  }
  // Tohumlu Gauss gürültüsü (mulberry32 + Box-Muller): aynı tohum, aynı ses
  function noise(seed, count) {
    let a = seed >>> 0;
    const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const out = new Float32Array(count);
    for (let i = 0; i < count; i += 2) {
      const u = Math.max(rand(), 1e-12), v = rand(), r = Math.sqrt(-2 * Math.log(u));
      out[i] = r * Math.cos(2 * Math.PI * v); if (i + 1 < count) out[i + 1] = r * Math.sin(2 * Math.PI * v);
    }
    return out;
  }
  const i64 = arr => BigInt64Array.from(arr, v => BigInt(v));
  async function piece(text, speed, seed) {
    const s = await load();
    const ids = [...text].map(ch => stoi.get(ch) ?? 1), L = ids.length;
    const starts = []; [...text].forEach((ch, i, all) => { if (ch !== ' ' && (i === 0 || all[i - 1] === ' ')) starts.push(i); });
    const bounds = [0, ...(starts.length ? starts.slice(1) : []), L];
    const cw = new Array(L), wstart = new Array(L);
    for (let w = 0; w + 1 < bounds.length; w++) for (let i = bounds[w]; i < bounds[w + 1]; i++) { cw[i] = w; wstart[i] = bounds[w]; }
    // 1) metin aşaması: harf özellikleri ve süreleri
    const t = await s.text.run({ ids: new ort.Tensor('int64', i64(ids), [1, L]) });
    const dur = Float32Array.from(t.dur.data, d => d / speed);
    // 2) kare çizelgesi: kelime başına kare sayısı, her karenin kelimesi ve kelime içi konumu
    const words = cw[L - 1] + 1, sums = new Float64Array(words);
    for (let i = 0; i < L; i++) sums[cw[i]] += dur[i];
    const counts = Array.from(sums, v => Math.min(MAX_WORD_FRAMES, Math.max(1, Math.round(v))));
    const T = Math.min(counts.reduce((a, b) => a + b, 0), MAX_FRAMES);
    const fw = new Array(T), fp = new Float32Array(T);
    for (let w = 0, f = 0; w < words && f < T; w++) for (let k = 0; k < counts[w] && f < T; k++, f++) { fw[f] = w; fp[f] = k / counts[w]; }
    // 3) ses aşaması: 4 adımda latentler (tohumlu gürültüden)
    const steps = config.times.length, dim = config.latent_dim;
    const z = await s.sound.run({
      h: t.h, dur: new ort.Tensor('float32', dur, [1, L]), cw: new ort.Tensor('int64', i64(cw), [1, L]), wstart: new ort.Tensor('int64', i64(wstart), [1, L]),
      fw: new ort.Tensor('int64', i64(fw), [1, T]), fp: new ort.Tensor('float32', fp, [1, T]),
      noise: new ort.Tensor('float32', noise(seed, steps * T * dim), [1, steps, T, dim])
    });
    // 4) çözücü: latent → 48 kHz ses (parça tek seferde; pencere sınırı yok)
    const a = await s.decoder.run({ z: z.latents });
    const firsts = new Map(), lasts = new Map();
    fw.forEach((w, f) => { if (!firsts.has(w)) firsts.set(w, f); lasts.set(w, f); });
    return { audio: a.audio.data, frames: T, words: text.split(' ').map((word, w) => firsts.has(w) ? { word, start: firsts.get(w) / FPS, end: (lasts.get(w) + 1) / FPS } : null).filter(Boolean) };
  }

  /** Metin → { audio: Float32Array (48 kHz mono, -1..1), words: [{word,start,end}] }. */
  async function synthesize(text, { speed = 1, seed = 1 } = {}) {
    speed = Math.min(4, Math.max(.25, +speed || 1));
    const parts = chunk(frontend(text), speed);
    if (!parts.length) return { audio: new Float32Array(0), words: [] };
    const chunks = [], words = [];
    let offset = 0, total = 0;
    for (let i = 0; i < parts.length; i++) {
      const [text_, pause] = parts[i];
      const p = await piece(text_, speed, (seed * 1000003 + i) % 2147483647);
      chunks.push(p.audio); total += p.audio.length;
      for (const w of p.words) words.push({ word: w.word, start: +(offset + w.start).toFixed(3), end: +(offset + w.end).toFixed(3) });
      const gap = Math.round(pause * RATE);
      if (gap) { chunks.push(new Float32Array(gap)); total += gap; }
      offset += p.frames / FPS + gap / RATE;
    }
    const audio = new Float32Array(total);
    let o = 0; for (const c of chunks) { audio.set(c, o); o += c.length; }
    return { audio, words };
  }
  return { synthesize, frontend, chunk, RATE };
}

// 48 kHz float → 16 bit PCM WAV
function wavBuffer(audio, rate = RATE) {
  const pcm = Buffer.alloc(audio.length * 2);
  for (let i = 0; i < audio.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, audio[i])) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

module.exports = { createEma, wavBuffer, prepare, RATE };
