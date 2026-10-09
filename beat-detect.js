// Müzik ritmi (tempo + vuruş zamanları) — anlatımlı videoda sahne geçişlerini
// ve vurguları müziğe oturtmak için. Saf modül: mono 16-bit PCM alır.
// Yöntem: bas (≈150 Hz altı) ve tüm bant enerjisindeki artışlardan vuruş
// sinyali → otokorelasyonla 70–180 BPM arası tempo (120 civarı hafif tercih)
// → tarakla faz hizalama → her vuruş yakınındaki tepeye ufak düzeltme.
// Belirgin ritim yoksa (ambient, konuşma) null döner; senkron uygulanmaz.

function onsetEnvelope(pcm, rate, hop) {
  const n = Math.floor(pcm.length / 2), frames = Math.floor(n / hop);
  const a = Math.exp(-2 * Math.PI * 150 / rate); // tek kutuplu alçak geçiren
  let low = 0, prevLow = 0, prevAll = 0;
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let eLow = 0, eAll = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      const x = pcm.readInt16LE(i * 2) / 32768;
      low = (1 - a) * x + a * low;
      eLow += low * low; eAll += x * x;
    }
    const lLow = Math.log1p(1000 * eLow / hop), lAll = Math.log1p(1000 * eAll / hop);
    env[f] = Math.max(0, lLow - prevLow) * 1.4 + Math.max(0, lAll - prevAll);
    prevLow = lLow; prevAll = lAll;
  }
  // Yerel ortalamayı çıkar (yavaş ses seviyesi değişimlerini bastır)
  const out = new Float32Array(frames), w = Math.max(1, Math.round(.3 * rate / hop));
  let sum = 0;
  for (let f = 0; f < frames; f++) {
    sum += env[f]; if (f > 2 * w) sum -= env[f - 2 * w - 1];
    out[f] = Math.max(0, env[f] - sum / Math.min(f + 1, 2 * w + 1));
  }
  return out;
}

function detectBeats(pcm, rate, { minBpm = 70, maxBpm = 180 } = {}) {
  const hop = Math.max(64, Math.round(rate * .0116)); // ≈11,6 ms
  const env = onsetEnvelope(pcm, rate, hop);
  const fps = rate / hop, frames = env.length;
  if (frames < fps * 6) return null; // en az ~6 sn müzik
  const minLag = Math.floor(fps * 60 / maxBpm), maxLag = Math.ceil(fps * 60 / minBpm);
  let mean = 0; for (const v of env) mean += v; mean /= frames;
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0; for (let f = lag; f < frames; f++) s += (env[f] - mean) * (env[f - lag] - mean);
    ac[lag] = s / (frames - lag);
  }
  let best = -1, bestScore = -Infinity, total = 0, count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 * fps / lag;
    const weight = Math.exp(-.5 * Math.pow(Math.log2(bpm / 120) / .9, 2)); // 120 civarı hafif tercih
    const score = ac[lag] * weight;
    if (ac[lag] > 0) { total += ac[lag]; count++; }
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  if (best < 0 || ac[best] <= 0) return null;
  // Güven: tempo gecikmesindeki otokorelasyonun sıfır gecikmedeki enerjiye oranı
  // (normalize periyodiklik). Gürültüde ~0, düzenli ritimde belirgin şekilde yüksek.
  let ac0 = 0; for (let f = 0; f < frames; f++) ac0 += (env[f] - mean) ** 2; ac0 /= frames;
  const confidence = ac[best] / Math.max(1e-12, ac0);
  // Parabolik iyileştirme → kesirli periyot
  const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1];
  const delta = (y0 - 2 * y1 + y2) !== 0 ? .5 * (y0 - y2) / (y0 - 2 * y1 + y2) : 0;
  const period = best + Math.max(-.5, Math.min(.5, delta));
  // Faz: tarak toplamını en büyükleyen başlangıç
  let phase = 0, phaseScore = -Infinity;
  for (let p = 0; p < period; p += .5) {
    let s = 0; for (let t = p; t < frames; t += period) s += env[Math.round(t)] || 0;
    if (s > phaseScore) { phaseScore = s; phase = p; }
  }
  // Müzik tempo olarak sabittir: vuruşlar düzenli ızgaradır (tek tek tepeye
  // kaydırmak geçişlerde aksak bir his yaratıyordu)
  const beats = [];
  for (let t = phase; t < frames; t += period) beats.push(+(t / fps).toFixed(3));
  return { bpm: +(60 * fps / period).toFixed(1), period: +(period / fps).toFixed(4), beats, confidence: +confidence.toFixed(2) };
}

// Döngülenen müzik biriminin vuruşları video süresi boyunca tekrarlanır
function tileBeats(result, unitLength, total) {
  if (!result || !(unitLength > 0)) return [];
  const out = [];
  for (let base = 0; base < total; base += unitLength)
    for (const b of result.beats) { const t = base + b; if (b < unitLength && t < total) out.push(+t.toFixed(3)); }
  return out;
}

module.exports = { detectBeats, tileBeats, onsetEnvelope };
