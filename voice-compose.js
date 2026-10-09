// Anlatımlı video: sahne başına HyperFrames kompozisyonu (HTML + GSAP).
// Her sahne kendi dosyasında, sesinin süresine göre üretilir; böylece yalnız
// değişen sahne yeniden render edilir. Görünüm TEMADAN (renk, yazı tipi, zemin,
// kart, görsel çerçevesi, motifler, hareket enerjisi), sahne kararları AI SAHNE
// YÖNETMENİNDEN (düzen varyantı, vurgu kelimesi/tarzı, görsel konumu, geçiş,
// renk tonu) gelir. Hareket iki kaynaktan:
//  1) Konuşmayla senkron: başlık kelimeleri, sayılar, maddeler, karşılaştırma
//     tarafları ve alıntı kelimeleri söylendikleri anda (Whisper kelime zamanları).
//  2) Sürekli katman: kamera itişi, temaya özgü zemin hareketi, ritim nabzı.
// Kalıplar HyperFrames kataloğundaki (Apache-2.0) caption-highlight, count-up,
// headline-slam, push-in, light-sweep-pass ve grain-overlay bileşenlerinden
// uyarlanmıştır: tüm değişimler zaman çizelgesine yazılır (ileri/geri sarılabilir).
// Saf modül: dosya yazmaz, süreç başlatmaz (scripts/check-voice-video.cjs).
const Themes = require('./renderer/voice-themes');

const FPS = 30;
const ACCENTS = Themes.BUILT_IN[0].colors.accents;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const frames = seconds => Math.max(1, Math.round(seconds * FPS));
const snap = seconds => frames(seconds) / FPS;
const num = n => +(+n).toFixed(3);
const norm = w => String(w).toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]/gu, '');
function rng(seed) { let s = (seed * 9301 + 49297) % 233280 || 1; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mixHex = (a, b, t) => '#' + hexRgb(a).map((v, i) => Math.round(v + (hexRgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
// Yazı olarak kullanılan vurgu rengi: üstünde durduğu her yüzeye karşı en az 3:1
// kontrast verene kadar yazı rengine karıştırılır (açık temada sarı → hardal).
function readableAccent(a, ink, surfaces) {
  for (let k = 0; k <= 10; k++) { const m = mixHex(a, ink, k / 10); if (surfaces.every(x => Themes.contrast(m, x) >= 3)) return m; }
  return ink;
}
const alpha = (hex, a) => hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

// Mono 16-bit PCM'den 1/15 sn'lik RMS zarfı (0..1, 95. persentile normalize)
function envelopeFromPcm(buffer, sampleRate, rate = 15) {
  const samples = Math.floor(buffer.length / 2), step = Math.max(1, Math.round(sampleRate / rate)), out = [];
  for (let start = 0; start < samples; start += step) {
    let sum = 0; const end = Math.min(samples, start + step);
    for (let i = start; i < end; i++) { const v = buffer.readInt16LE(i * 2) / 32768; sum += v * v; }
    out.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const sorted = [...out].sort((a, b) => a - b), ref = sorted[Math.floor(sorted.length * .95)] || 1;
  return out.map(v => +Math.min(1, v / (ref || 1)).toFixed(3));
}

// "%45", "600 mm/s", "1.250.000 TL", "2,5x" → {prefix, value, decimals, suffix}
function parseNumber(text) {
  const m = String(text || '').match(/^(\D*?)(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)(.*)$/);
  if (!m) return null;
  let raw = m[2], decimals = 0;
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, '');
  else if (/[.,]/.test(raw)) { decimals = raw.split(/[.,]/)[1].length; raw = raw.replace(',', '.'); }
  const value = +raw;
  return Number.isFinite(value) ? { prefix: m[1], value, decimals: Math.min(decimals, 2), suffix: m[3] } : null;
}
const formatNumber = (v, d) => v.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });

// Konuşmada bir ifadenin geçtiği an: ifadenin ilk anlamlı kelimesi (sayılarda
// rakamlar) kelime zamanlarında `from` indeksinden sonra aranır.
function makeFinder(words) {
  const keys = (words || []).map(w => norm(w.text));
  return (phrase, from = 0) => {
    const tokens = String(phrase || '').split(/\s+/).map(norm).filter(Boolean);
    const digits = String(phrase || '').match(/\d+/);
    const wanted = digits ? [digits[0]] : tokens.filter(t => t.length >= 3).slice(0, 3);
    for (const want of wanted.length ? wanted : tokens.slice(0, 1)) {
      for (let i = from; i < keys.length; i++) {
        if (keys[i] === want || (want.length >= 4 && keys[i].startsWith(want.slice(0, Math.max(4, want.length - 2))))
          || (digits && keys[i].replace(/\D/g, '') === want)) return { t: words[i].start, i };
      }
    }
    return null;
  };
}

// Harf içeren sonek (mm/s, TL, saat) küçük birim olarak ayrı yazılır; °C, % olduğu gibi kalır
const unitOf = n => n && /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(n.suffix) && !/^°[CF]$/.test(n.suffix.trim()) ? n.suffix.trim() : '';
function numberHtml(value) {
  const n = parseNumber(value), unit = unitOf(n);
  if (!n) return `<span class="n">${esc(value)}</span>`;
  return `<span class="n">${esc(n.prefix + formatNumber(n.value, n.decimals) + (unit ? '' : n.suffix))}</span>${unit ? `<span class="unit">${esc(unit)}</span>` : ''}`;
}
const shownNumber = value => { const n = parseNumber(value); return n ? n.prefix + formatNumber(n.value, n.decimals) + (unitOf(n) ? '' : n.suffix) : String(value || ''); };
function fitSize(text, steps) {
  const n = String(text || '').length;
  for (const [limit, size] of steps) if (n <= limit) return size;
  return steps[steps.length - 1][1];
}

// Elle çizilmiş görünümlü SVG yollar (karalama daire, alt çizgi, ok)
function scribbleEllipse(random) {
  const pts = [];
  for (let k = 0; k <= 26; k++) { const a = k / 24 * Math.PI * 2 - .3, r = 1 + (random() - .5) * .08; pts.push(`${(50 + 48 * r * Math.cos(a)).toFixed(1)},${(50 + 44 * r * Math.sin(a)).toFixed(1)}`); }
  return `M${pts.join(' L')}`;
}
function scribbleLine(random) { let d = 'M2,12'; for (let x = 10; x <= 100; x += 9) d += ` Q${x - 4},${(6 + random() * 12).toFixed(1)} ${x},${(9 + random() * 6).toFixed(1)}`; return d; }
function tornBlob(random, cx, cy, rx, ry) {
  const pts = [];
  for (let k = 0; k < 40; k++) { const a = k / 40 * Math.PI * 2, j = 1 + (random() - .5) * .22; pts.push(`${(cx + rx * j * Math.cos(a)).toFixed(0)},${(cy + ry * j * Math.sin(a)).toFixed(0)}`); }
  return pts.join(' ');
}

const { VARIANTS } = require('./renderer/voice-script');
// Reels / Shorts / TikTok ortak güvenli alanı (1080x1920): üstte hesap/başlık, altta
// açıklama + müzik satırı, sağda beğen/yorum/paylaş sütunu. Anlamlı her öğe bu kutuda kalır.
const SAFE_AREA = { top: 230, bottom: 480, left: 70, right: 170 };

// ---- Şablonlar: html + konuşma zamanlı animasyon satırları ----
function templateParts(v, ctx) {
  const { land, speech, find, ink, theme, direction, random, energy } = ctx, accent = ctx.textAccent;
  const lines = [], hits = [];
  const items = v.items || [];
  const variant = (VARIANTS[v.type] || []).includes(direction.variant) ? direction.variant : (VARIANTS[v.type] || ['default'])[0];
  const enter = energy === 'calm' ? { y: 50, scale: 1.12, blur: 8, dur: .6, ease: 'power3.out' } : energy === 'normal' ? { y: 70, scale: 1.22, blur: 12, dur: .5, ease: 'back.out(1.4)' } : { y: 80, scale: 1.3, blur: 14, dur: .45, ease: 'back.out(1.7)' };
  const at = (phrase, fallback, from = 0) => { const f = find(phrase, from); return f ? { t: Math.max(.05, f.t - .12), i: f.i + 1 } : { t: fallback, i: from }; };
  // Başlık hemen kademeli girer (kanca boş kalmasın); her kelime söylendiği an
  // vurgu rengiyle kısa bir sıçrama yapar.
  const headline = (text, cls, start = .1, step = ctx.step || (energy === 'calm' ? .1 : .07)) => {
    const tokens = String(text || '').split(/\s+/).filter(Boolean);
    let from = 0;
    const html = tokens.map((w, k) => `<span class="w ${cls}-w" id="${cls}${k}">${esc(w)}</span>`).join(' ');
    tokens.forEach((w, k) => {
      const t = start + k * step;
      lines.push(`tl.fromTo('#${cls}${k}',{y:${enter.y},scale:${enter.scale},opacity:0,filter:'blur(${enter.blur}px)'},{y:0,scale:1,opacity:1,filter:'blur(0px)',duration:${enter.dur},ease:'${enter.ease}'},${num(t)});`);
      const f = find(w, from);
      if (f) from = f.i + 1;
      if (f && f.t > t + .5) {
        lines.push(`tl.fromTo('#${cls}${k}',{scale:1,color:'${ink}'},{scale:1.14,color:'${accent}',duration:.1,ease:'power2.out'},${num(f.t)});tl.to('#${cls}${k}',{scale:1,color:'${ink}',duration:.45,ease:'power2.out'},${num(f.t + .12)});`);
        hits.push(f.t);
      }
    });
    return { html, tokens, end: start + tokens.length * step + enter.dur };
  };
  // Vurgu: yönetmenin seçtiği kelime (yoksa en uzun kelime) ve tarzı
  const emphasize = (h, cls, text) => {
    const tokens = h.tokens;
    if (!tokens.length) return h.html;
    const wanted = norm(direction.emphasis?.word || '');
    let key = wanted ? tokens.findIndex(w => norm(w) === wanted || (wanted.length > 3 && norm(w).startsWith(wanted.slice(0, 4)))) : -1;
    if (key < 0) key = tokens.reduce((b, w, k) => norm(w).length > norm(tokens[b] || '').length ? k : b, 0);
    const style = Themes.EMPHASIS.includes(direction.emphasis?.style) ? direction.emphasis.style : theme.emphasis[0] || 'marker';
    const hit = find(tokens[key] || '');
    const t = num(Math.min(speech, (hit ? hit.t : h.end) + .08));
    hits.push(hit ? hit.t : h.end);
    const word = esc(tokens[key]);
    let deco = '';
    if (style === 'marker') { deco = '<i id="mark" class="mark"></i>'; lines.push(`tl.fromTo('#mark',{scaleX:0},{scaleX:1,duration:.45,ease:'power3.inOut'},${t});`); }
    else if (style === 'box') { deco = '<i id="mark" class="mark box"></i>'; lines.push(`tl.fromTo('#mark',{scaleX:0},{scaleX:1,duration:.35,ease:'power3.out'},${t});tl.to('#${cls}${key}',{color:'${Themes.contrast(ctx.accent, '#ffffff') >= Themes.contrast(ctx.accent, '#111111') ? '#ffffff' : '#111111'}',duration:.2},${t});`); }
    else if (style === 'underline') { deco = `<svg class="ink-line" viewBox="0 0 104 24" preserveAspectRatio="none"><path id="mark" d="${scribbleLine(random)}" pathLength="1"/></svg>`; lines.push(`tl.fromTo('#mark',{strokeDashoffset:1},{strokeDashoffset:0,duration:.5,ease:'power2.out'},${t});`); }
    else if (style === 'circle') { deco = `<svg class="ink-circle" viewBox="0 0 100 100" preserveAspectRatio="none"><path id="mark" d="${scribbleEllipse(random)}" pathLength="1"/></svg>`; lines.push(`tl.fromTo('#mark',{strokeDashoffset:1},{strokeDashoffset:0,duration:.6,ease:'power2.inOut'},${t});`); }
    else lines.push(`tl.to('#${cls}${key}',{color:'${accent}',duration:.25},${t});`);
    return h.html.replace(`id="${cls}${key}">${word}</span>`, `id="${cls}${key}"><span class="mark-wrap">${deco}${word}</span></span>`);
  };
  const countUp = (sel, value, t, dur = 1.05, enterAt = t) => {
    const n = parseNumber(value);
    if (n && unitOf(n)) n.suffix = '';
    const box = sel.replace(/ \.n$/, '');
    if (!n) return `tl.fromTo('${sel}',{scale:.4,opacity:0},{scale:1,opacity:1,duration:.5,ease:'back.out(1.8)'},${num(t)});`;
    const count = Math.max(6, Math.round(dur * FPS)), ease = k => 1 - Math.pow(1 - k / count, 3);
    const rows = [];
    for (let k = 0; k <= count; k++) rows.push(`${n.prefix}${formatNumber(n.value * ease(k), n.decimals)}${n.suffix}`);
    return `tl.set('${sel}',{textContent:${JSON.stringify(rows[0])}},${num(Math.min(enterAt, t))});tl.fromTo('${box}',{opacity:0,scale:.82},{opacity:1,scale:1,duration:.3,ease:'power2.out'},${num(Math.min(enterAt, t))});(function(){var r=${JSON.stringify(rows)};for(var k=0;k<r.length;k++)tl.set('${sel}',{textContent:r[k]},${num(t)}+k/${FPS});})();tl.to('${box}',{scale:1.09,duration:.12,ease:'power3.out'},${num(t + dur)});tl.to('${box}',{scale:1,duration:.3,ease:'power2.out'},${num(t + dur + .12)});`;
  };
  const reveal = (sel, t, from = `{y:40,opacity:0,filter:'blur(8px)'}`, to = `{y:0,opacity:1,filter:'blur(0px)',duration:.5,ease:'power3.out'}`) => lines.push(`tl.fromTo('${sel}',${from},${to},${num(t)});`);
  // Kare hiç boş kalmaz: öğe ilk saniyede soluk (yapı) olarak kurulur, konuşmada
  // anıldığı an tam görünür ve parlar. Anılma zaten erkense doğrudan girer.
  const early = (k, after) => Math.max(.15, after) + k * .14;
  const preview = (sel, k, t, after, from, to, dim = .34) => {
    const e = early(k, after);
    if (t - e < .45) { lines.push(`tl.fromTo('${sel}',${from},${to},${num(t)});`); return; }
    lines.push(`tl.fromTo('${sel}',${from},${to.replace(/opacity:1/, 'opacity:' + dim)},${num(e)});`);
    lines.push(`tl.to('${sel}',{opacity:1,duration:.25,ease:'power2.out'},${num(t)});tl.fromTo('${sel}',{scale:1},{scale:1.04,duration:.12,yoyo:true,repeat:1,ease:'power2.out'},${num(t)});`);
  };
  // Sırayla anılan öğelerin zamanları (bulunamayanlar konuşmaya yayılır, aralar ≥0,25 sn)
  const spokenTimes = (list, after) => {
    let from = 0;
    const times = list.map((txt, k) => { const f = find(txt, from); if (f) from = f.i + 1; return f ? Math.max(after - .2, f.t - .15) : Math.max(after, .3) + (speech - Math.max(after, .3)) * k / Math.max(1, list.length); });
    for (let k = 1; k < times.length; k++) if (times[k] < times[k - 1] + .25) times[k] = times[k - 1] + .25;
    return times;
  };
  const sizeHead = text => land ? fitSize(text, [[14, 160], [26, 132], [42, 106], [999, 88]]) : fitSize(text, [[10, 176], [18, 150], [30, 124], [48, 104], [999, 90]]);
  const label = v.label && variant === 'label' ? `<div class="eyebrow" id="eyebrow">${esc(v.label)}</div>` : (theme.label && (v.type === 'title' || v.type === 'statement') ? `<div class="eyebrow" id="eyebrow">${esc(theme.label)}</div>` : '');
  if (label) lines.push(`tl.fromTo('#eyebrow',{scaleX:0,opacity:0},{scaleX:1,opacity:1,duration:.35,ease:'power3.out'},.05);`);
  switch (v.type) {
    case 'title': case 'statement': {
      const text = v.heading || v.label || '';
      const h = headline(text, 'h');
      const html = emphasize(h, 'h', text);
      const sub = v.subheading ? at(v.subheading, Math.min(speech - .6, h.end + .25)) : null;
      if (sub) reveal('.sub', Math.min(h.end + .8, Math.max(h.end - .1, sub.t)), `{y:30,opacity:0,filter:'blur(8px)'}`);
      const left = variant === 'stacked' || variant === 'left';
      const cls = v.type === 'title' ? 'mega' : 'statement';
      const size = sizeHead(text) * (v.type === 'title' ? (variant === 'stacked' ? 1.08 : 1) : .86);
      if (variant === 'left') lines.push(`tl.fromTo('.rule',{scaleX:0},{scaleX:1,duration:.6,ease:'power3.inOut'},.1);`);
      return { html: `<div class="center${left ? ' left' : ''}">${label}${variant === 'left' ? '<i class="rule"></i>' : ''}<h1 class="${cls}${variant === 'stacked' ? ' stacked' : ''}" style="font-size:${size}px">${html}</h1>${v.subheading ? `<p class="sub">${esc(v.subheading)}</p>` : ''}</div>`, lines, hits, ghost: h.tokens.reduce((a, w) => w.length > a.length ? w : a, '') };
    }
    case 'stat': {
      const pct = parseNumber(v.value), isPct = pct && /%/.test(v.value) && pct.value > 0 && pct.value <= 100;
      const mode = variant === 'ring' && !isPct ? 'giant' : variant;
      const t = at(v.value, .35).t;
      lines.push(countUp('#statValue .n', v.value, t, 1.05, Math.min(t, .3)));
      const r = 236, c = +(2 * Math.PI * r).toFixed(1);
      if (mode === 'ring') lines.push(`tl.fromTo('.arc',{strokeDashoffset:${c}},{strokeDashoffset:${num(c * (1 - pct.value / 100))},duration:1.15,ease:'power3.out'},${num(t)});tl.fromTo('.ring-glow',{opacity:0,scale:.8},{opacity:1,scale:1.15,duration:.3},${num(t + 1.05)});tl.to('.ring-glow',{opacity:.25,scale:1,duration:.6},${num(t + 1.35)});`);
      if (mode === 'bar') lines.push(`tl.fromTo('.bar-fill',{scaleX:0},{scaleX:${isPct ? num(pct.value / 100) : 1},duration:1.1,ease:'power3.out'},${num(t)});`);
      if (mode === 'giant') lines.push(`tl.fromTo('.stat-rule',{scaleX:0},{scaleX:1,duration:.7,ease:'power3.inOut'},${num(t + .9)});`);
      const lab = v.label ? at(v.label, t + .7) : null;
      if (lab) reveal('.stat-label', Math.min(Math.max(t + .35, lab.t), Math.max(.7, Math.min(1.1, t + .35))), `{y:34,opacity:0,filter:'blur(8px)'}`);
      if (v.source) lines.push(`tl.fromTo('.stat-source',{opacity:0},{opacity:1,duration:.4},${num(Math.min(speech, t + 1.4))});`);
      hits.push(t + 1.05);
      const shown = shownNumber(v.value);
      const unitLen = unitOf(parseNumber(v.value)) ? unitOf(parseNumber(v.value)).length * .5 : 0, fitLen = shown.length + unitLen;
      const valueSize = mode === 'giant' ? (land ? fitSize('x'.repeat(Math.ceil(fitLen)), [[4, 320], [6, 260], [8, 200], [99, 150]]) : fitSize('x'.repeat(Math.ceil(fitLen)), [[3, 330], [4, 290], [5, 240], [6, 200], [8, 165], [99, 130]]))
        : land ? fitSize(shown, [[4, 260], [6, 220], [9, 170], [99, 130]]) : fitSize(shown, [[4, 290], [6, 240], [9, 185], [99, 140]]);
      const value = `<div class="stat-value" id="statValue" style="font-size:${valueSize}px">${numberHtml(v.value)}</div>`;
      const visual = mode === 'ring' ? `<div class="ring-wrap"><div class="ring-glow"></div><svg class="ring" viewBox="0 0 520 520"><circle cx="260" cy="260" r="${r}" class="track"/><circle cx="260" cy="260" r="${r}" class="arc" style="stroke-dasharray:${c};stroke-dashoffset:${c}"/></svg>${value}</div>`
        : mode === 'bar' ? `${value}<div class="bar"><i class="bar-fill"></i></div>` : `${value}<i class="stat-rule"></i>`;
      return { html: `<div class="center stat-${mode}">${visual}${v.label ? `<p class="stat-label">${esc(v.label)}</p>` : ''}${v.source ? `<p class="stat-source">Kaynak: ${esc(v.source)}</p>` : ''}</div>`, lines, hits, ghost: v.value };
    }
    case 'bignumber': {
      const list = items.length ? items : [{ value: v.value, text: v.label }];
      let from = 0;
      const html = list.map((item, k) => {
        const f = find(item.value || item.text, from); if (f) from = f.i + 1;
        const t = f ? Math.max(.1, f.t - .12) : .2 + k * Math.max(.6, speech / (list.length + 1));
        const e = Math.min(t, .2 + k * .18);
        lines.push(`tl.fromTo('#ni${k}',{y:60,opacity:0},{y:0,opacity:1,duration:.45,ease:'power3.out'},${num(e)});`, countUp(`#nv${k} .n`, item.value, t, .9, e));
        hits.push(t + .9);
        return `<div class="num-item" id="ni${k}"><div class="num-value" id="nv${k}" style="color:${ctx.readable(theme.colors.accents[(ctx.tone + k) % theme.colors.accents.length])}">${numberHtml(item.value)}</div><div class="num-text">${esc(item.text)}</div></div>`;
      }).join('');
      return { html: `<div class="center numbers ${land ? 'row' : ''}">${html}</div>`, lines, hits, ghost: list[0]?.value };
    }
    case 'quote': {
      const text = v.quote || v.heading || '';
      const qtokens = text.split(/\s+/).filter(Boolean);
      let from = 0;
      const times = qtokens.map(w => { const f = find(w, from); if (f) { from = f.i + 1; return f.t; } return null; });
      const matched = times.filter(t => t !== null).length;
      const html = qtokens.map((w, k) => `<span class="qw" id="q${k}">${esc(w)}</span>`).join(' ');
      lines.push(`tl.fromTo('.quote-card',{y:110,opacity:0,rotation:-2},{y:0,opacity:1,rotation:0,duration:.6,ease:'power3.out'},.08);`);
      qtokens.forEach((w, k) => {
        const t = matched >= qtokens.length * .5 && times[k] !== null ? times[k] : .5 + (speech - .9) * k / Math.max(1, qtokens.length);
        lines.push(`tl.to('#q${k}',{opacity:1,duration:.18},${num(t)});`);
      });
      lines.push(`tl.fromTo('.author',{opacity:0,y:20},{opacity:1,y:0,duration:.4},.55);`);
      const big = variant === 'big';
      const size = fitSize(text, land ? [[80, big ? 76 : 60], [140, big ? 64 : 52], [999, 48]] : [[70, big ? 76 : 60], [130, big ? 64 : 52], [999, 46]]);
      return { html: `<div class="center"><div class="${big ? 'quote-big' : 'card'} quote-card"><div class="qmark">❝</div><p class="quote" style="font-size:${size}px">${html}</p><div class="author"><span class="avatar">${esc((v.author || '?').trim().charAt(0).toLocaleUpperCase('tr'))}</span><span><b>${esc(v.author)}</b>${v.source ? `<i>${esc(v.source)}</i>` : ''}</span></div></div></div>`, lines, hits, ghost: '❝' };
    }
    case 'list': case 'steps': {
      const h = v.heading ? headline(v.heading, 'lh', .1, .07) : { html: '', end: .2 };
      const texts = items.map(i => i.text || i.value);
      const times = spokenTimes(texts, h.end);
      const steps = v.type === 'steps';
      const mode = steps ? (variant === 'cards' ? 'cards' : 'timeline') : variant;
      items.forEach((_, k) => {
        preview(`#li${k}`, k, times[k], h.end, `{x:${land ? -110 : -90},opacity:0,filter:'blur(10px)'}`, `{x:0,opacity:1,filter:'blur(0px)',duration:.45,ease:'power3.out'}`);
        lines.push(`tl.to('#li${k}',{'--on':1,duration:.2},${num(times[k])});`);
        if (k + 1 < items.length) lines.push(`tl.to('#li${k}',{'--on':0,duration:.3},${num(times[k + 1])});`);
        if (steps && mode === 'timeline') lines.push(`tl.fromTo('#rail',{scaleY:${num(k / items.length)}},{scaleY:${num((k + 1) / items.length)},duration:.5,ease:'power2.out'},${num(times[k])});`);
        hits.push(times[k] + .1);
      });
      const marker = k => mode === 'checklist' ? '<span class="li-num check">✓</span>' : mode === 'numbers' ? `<span class="li-num big">${k + 1}</span>` : `<span class="li-num">${String(k + 1).padStart(2, '0')}</span>`;
      return { html: `<div class="center list-wrap list-${mode}">${v.heading ? `<h2 class="list-head">${h.html}</h2>` : ''}<ol class="list">${steps && mode === 'timeline' ? '<i class="rail-track"></i><i class="rail" id="rail"></i>' : ''}${items.map((item, k) => `<li class="li" id="li${k}">${marker(k)}<span>${esc(item.text || item.value)}</span></li>`).join('')}</ol></div>`, lines, hits, ghost: String(items.length).padStart(2, '0') };
    }
    case 'specs': {
      const h = v.heading ? headline(v.heading, 'sh', .1, .07) : { html: '', end: .2 };
      const times = spokenTimes(items.map(i => i.value || i.text), h.end);
      items.forEach((item, k) => {
        preview(`#sr${k}`, k, times[k], h.end, `{x:-60,opacity:0}`, `{x:0,opacity:1,duration:.4,ease:'power3.out'}`);
        if (parseNumber(item.value)) lines.push(countUp(`#sv${k} .n`, item.value, times[k] + .05, .7, Math.min(times[k], early(k, h.end))));
        hits.push(times[k] + .1);
      });
      return { html: `<div class="center specs">${v.heading ? `<h2 class="list-head">${h.html}</h2>` : ''}<div class="spec-rows">${items.map((item, k) => `<div class="spec-row" id="sr${k}"><span class="spec-k">${esc(item.text)}</span><i></i><span class="spec-v" id="sv${k}">${numberHtml(item.value)}</span></div>`).join('')}</div></div>`, lines, hits, ghost: items[0]?.value };
    }
    case 'comparison': {
      const L = v.left || { title: '', items: [] }, R = v.right || { title: '', items: [] };
      const sL = at(L.title, .15).t, sR = Math.max(sL + .5, at(R.title, Math.max(.8, speech * .45)).t);
      const tL = Math.min(sL, .15), tR = Math.min(sR, .45);
      reveal('#sideA', tL, `{x:${land ? -120 : 0},y:${land ? 0 : -60},opacity:0}`, `{x:0,y:0,opacity:1,duration:.5,ease:'power3.out'}`);
      reveal('#sideB', tR, `{x:${land ? 120 : 0},y:${land ? 0 : 60},opacity:0}`, `{x:0,y:0,opacity:1,duration:.5,ease:'power3.out'}`);
      lines.push(`tl.fromTo('#vs',{scale:0,rotation:-25},{scale:1,rotation:-6,duration:.5,ease:'back.out(2.2)'},${num(Math.max(.3, tR - .1))});`);
      for (const [id, spoken, shown] of [['A', sL, tL], ['B', sR, tR]]) if (spoken - shown > .6) lines.push(`tl.fromTo('#side${id}',{scale:1},{scale:1.045,duration:.16,yoyo:true,repeat:1,ease:'power2.out'},${num(spoken)});`);
      hits.push(sL + .1, sR + .1);
      const side = (s, id, k) => {
        const spoken = id === 'A' ? sL : sR, shown = id === 'A' ? tL : tR;
        const times = spokenTimes(s.items || [], spoken + .3);
        (s.items || []).forEach((_, j) => preview(`#c${id}${j}`, j, times[j], shown + .35, `{opacity:0,y:16}`, `{opacity:1,y:0,duration:.35}`));
        return `<div class="side side-${id}" id="side${id}" style="--side:${theme.colors.accents[(ctx.tone + k) % theme.colors.accents.length]};--side-ink:${ctx.readable(theme.colors.accents[(ctx.tone + k) % theme.colors.accents.length])}"><h3>${esc(s.title)}</h3><ul>${(s.items || []).map((it, j) => `<li id="c${id}${j}">${esc(it)}</li>`).join('')}</ul></div>`;
      };
      return { html: `<div class="center compare compare-${variant} ${land ? 'row' : 'col'}">${side(L, 'A', 0)}<div class="vs" id="vs">VS</div>${side(R, 'B', 1)}</div>`, lines, hits, ghost: 'VS' };
    }
    case 'cta': {
      const h = headline(v.heading, 'ch', .15, .1);
      const btn = v.button ? at(v.button, Math.max(h.end + .3, speech * .6)) : null;
      const burst = variant === 'burst';
      if (burst) lines.push(`tl.fromTo('.burst i',{scaleX:0,opacity:0},{scaleX:1,opacity:1,duration:.8,ease:'power2.out',stagger:.025},.05);tl.to('.burst',{rotation:25,duration:${num(Math.max(1, speech + 1))},ease:'none'},0);`);
      if (v.subheading) reveal('.sub', h.end, `{opacity:0,y:20}`, `{opacity:1,y:0,duration:.4}`);
      if (btn) { lines.push(`tl.fromTo('.pill',{scale:.4,opacity:0},{scale:1,opacity:1,duration:.5,ease:'back.out(2.2)'},${num(btn.t)});tl.to('.pill',{scale:1.06,duration:.45,ease:'sine.inOut',yoyo:true,repeat:${Math.max(0, Math.floor((speech - btn.t) / .45))}},${num(btn.t + .5)});`); hits.push(btn.t + .2); }
      return { html: `${burst ? `<div class="burst">${Array.from({ length: 16 }, (_, k) => `<i style="transform:rotate(${(k * 360 / 16).toFixed(1)}deg)"></i>`).join('')}</div>` : ''}<div class="center">${label}<h1 class="mega cta-head" style="font-size:${sizeHead(v.heading)}px">${emphasize(h, 'ch', v.heading)}</h1>${v.subheading ? `<p class="sub">${esc(v.subheading)}</p>` : ''}${v.button ? `<div class="pill">${esc(v.button)} →</div>` : ''}</div>`, lines, hits, ghost: null };
    }
    default: return templateParts({ ...v, type: 'statement' }, ctx);
  }
}

// Konuşmayla senkron kinetik altyazı (isteğe bağlı; caption-highlight kalıbı)
function captionLayer(words, land) {
  if (!words?.length) return { html: '', lines: [] };
  const groups = []; let g = [];
  const maxChars = land ? 30 : 18;
  for (const w of words) {
    if (g.length && (g.length >= (land ? 5 : 3) || (g.map(x => x.text).join(' ') + ' ' + w.text).length > maxChars)) { groups.push(g); g = []; }
    g.push(w);
    if (/[.!?…,;:]$/.test(w.text)) { groups.push(g); g = []; }
  }
  if (g.length) groups.push(g);
  let html = '', k = 0; const lines = [];
  groups.forEach((group, gi) => {
    const start = group[0].start, next = groups[gi + 1]?.[0].start ?? group[group.length - 1].end + .5;
    const end = Math.min(group[group.length - 1].end + .4, next - .02);
    html += `<div class="cap-group" id="cg${gi}">${group.map(w => `<span class="cap-w" id="cw${k++}"><i class="cap-bg"></i><b>${esc(w.text.toLocaleUpperCase('tr'))}</b></span>`).join(' ')}</div>`;
    lines.push(`tl.fromTo('#cg${gi}',{opacity:0,y:24,scale:.92},{opacity:1,y:0,scale:1,duration:.14,ease:'power2.out'},${num(start)});tl.to('#cg${gi}',{opacity:0,duration:.1},${num(Math.max(start + .15, end - .1))});`);
  });
  k = 0;
  groups.forEach(group => group.forEach(w => {
    lines.push(`tl.fromTo('#cw${k} .cap-bg',{scaleX:0,opacity:0},{scaleX:1,opacity:1,duration:.12,ease:'power2.out'},${num(w.start)});tl.fromTo('#cw${k}',{scale:1},{scale:1.08,duration:.08,yoyo:true,repeat:1},${num(w.start)});tl.to('#cw${k} .cap-bg',{opacity:0,duration:.08},${num(Math.max(w.start + .13, w.end))});`);
    k++;
  }));
  return { html: `<div class="captions">${html}</div>`, lines };
}

// Tema → CSS (renkler ve yazı tipleri değişken olarak; dekor zemin türüne göre)
function baseCss(W, H, theme, accent, accent2, textAccent = accent) {
  const land = W > H, c = theme.colors, light = Themes.isLight(c.bg), R = theme.radius;
  const onAccent = Themes.contrast(accent, '#ffffff') >= Themes.contrast(accent, '#111111') ? '#ffffff' : '#111111';
  const font = f => `'${f}','Segoe UI',Arial,sans-serif`;
  const cardBg = { glass: alpha(c.card, .82), paper: c.card, solid: c.card, outline: 'transparent' }[theme.card];
  const cardBorder = { glass: `1.5px solid ${alpha(c.ink, .12)}`, paper: `2px solid ${alpha(c.ink, .14)}`, solid: '0', outline: `3px solid ${accent}` }[theme.card];
  const cardShadow = theme.card === 'outline' ? 'none' : light ? `0 24px 60px ${alpha('#000000', .14)}` : `0 40px 120px rgba(0,0,0,.5)`;
  return `html,body{margin:0;background:${c.bg}}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;font-family:${font(theme.fonts.body)};color:${c.ink};background:${c.bg}}
.clip{position:absolute;inset:0}
.blob{position:absolute;border-radius:50%;filter:blur(${land ? 150 : 140}px);opacity:${light ? .35 : .3}}
.b1{width:${land ? 1100 : 1000}px;height:${land ? 1100 : 1000}px;background:${accent};left:${land ? -12 : -48}%;top:${land ? -30 : -14}%}
.b2{width:${land ? 900 : 860}px;height:${land ? 900 : 860}px;background:${accent2};right:${land ? -14 : -50}%;top:${land ? 40 : 58}%;opacity:.2}
.b3{width:700px;height:700px;background:${c.bg2};left:22%;bottom:-30%;opacity:.5}
.halo{position:absolute;left:50%;top:${land ? 50 : 42}%;width:${land ? 1100 : 1000}px;height:${land ? 700 : 900}px;transform:translate(-50%,-50%);background:radial-gradient(ellipse,${alpha(accent, light ? .16 : .2)},transparent 62%)}
.soft-bg{position:absolute;inset:0;background:radial-gradient(circle at 30% 20%,${c.bg2},transparent 60%),radial-gradient(circle at 80% 85%,${alpha(accent, .22)},transparent 55%)}
.dots{position:absolute;inset:-60px;background-image:radial-gradient(${alpha(c.ink, .08)} 1.6px,transparent 1.7px);background-size:46px 46px;mask-image:radial-gradient(circle at 50% 45%,#000 25%,transparent 72%)}
.gridlines{position:absolute;inset:-80px;background-image:linear-gradient(${alpha(accent, .12)} 1.5px,transparent 1.5px),linear-gradient(90deg,${alpha(accent, .12)} 1.5px,transparent 1.5px);background-size:${land ? 96 : 90}px ${land ? 96 : 90}px;mask-image:radial-gradient(circle at 50% 45%,#000 30%,transparent 80%)}
.paper-tex{position:absolute;inset:0;opacity:${light ? .55 : .3};mix-blend-mode:multiply}
.fold{position:absolute;background:linear-gradient(90deg,transparent,${alpha('#000000', .05)},transparent)}
.torn{position:absolute;inset:0}
.halftone{position:absolute;width:${land ? 520 : 460}px;height:${land ? 520 : 460}px;background-image:radial-gradient(${alpha(accent, .55)} 3px,transparent 3.6px);background-size:18px 18px;mask-image:radial-gradient(circle,#000 20%,transparent 70%)}
.regmark{position:absolute;width:64px;height:64px}
.regmark circle,.regmark path{fill:none;stroke:${alpha(c.ink, .45)};stroke-width:2}
.hud-c{position:absolute;width:70px;height:70px;border:4px solid ${accent}}
.hud-label{position:absolute;font-family:${font(theme.fonts.label)};font-size:${land ? 22 : 24}px;letter-spacing:4px;color:${alpha(c.ink, .7)};text-transform:uppercase}
.scan{position:absolute;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,${accent},transparent);box-shadow:0 0 22px ${accent};opacity:.7}
.dust{position:absolute;width:6px;height:6px;border-radius:50%;background:${light ? c.ink : '#fff'};box-shadow:0 0 12px ${light ? 'transparent' : '#fff'}}
.sweep{position:absolute;top:-30%;left:-60%;width:38%;height:160%;background:linear-gradient(90deg,transparent,${light ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.11)'},transparent);transform:rotate(18deg);mix-blend-mode:${light ? 'soft-light' : 'screen'}}
.comet{position:absolute;height:5px;border-radius:5px;box-shadow:0 0 22px ${accent}}
.grain{position:absolute;inset:-50%;opacity:${light ? .06 : .045};background-image:radial-gradient(${light ? 'rgba(0,0,0,.9)' : 'rgba(255,255,255,.9)'} .7px,transparent .8px),radial-gradient(rgba(0,0,0,.9) .7px,transparent .8px);background-size:5px 5px,7px 7px;background-position:0 0,2px 3px}
.vignette{position:absolute;inset:0;background:radial-gradient(circle at 50% 46%,transparent 40%,${light ? 'rgba(0,0,0,.12)' : 'rgba(0,0,0,.62)'} 100%)}
.media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,${alpha(c.bg, .5)},${alpha(c.bg, .76)} 50%,${alpha(c.bg, .93)})}
.ghost{position:absolute;left:50%;top:${land ? 50 : 44}%;font-family:${font(theme.fonts.display)};font-weight:900;font-size:${land ? 520 : 460}px;line-height:1;white-space:nowrap;color:transparent;-webkit-text-stroke:3px ${alpha(c.ink, .07)};letter-spacing:-10px;transform:translate(-50%,-50%);text-transform:uppercase}
.logo{position:absolute;width:auto;object-fit:contain;z-index:5}
.camera{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transform-origin:50% ${land ? 50 : 44}%}
.stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;${land ? '' : 'padding-bottom:12%;box-sizing:border-box;'}}
.center{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;width:${land ? 80 : 88}%;gap:30px}
.center.left{align-items:flex-start;text-align:left}
.eyebrow{font-family:${font(theme.fonts.label)};font-size:${land ? 28 : 32}px;font-weight:700;letter-spacing:5px;text-transform:uppercase;background:${accent};color:${onAccent};padding:10px 22px;border-radius:${Math.min(R, 999)}px;transform-origin:0 50%}
.rule{display:block;width:180px;height:10px;background:${accent};transform-origin:0 50%}
.mega,.statement{font-family:${font(theme.fonts.display)};line-height:1.02;font-weight:${theme.type.weight};letter-spacing:${theme.type.tracking}px;margin:0;text-wrap:balance;text-transform:${theme.type.case === 'upper' ? 'uppercase' : 'none'}}
.statement{line-height:1.06}
.stacked .w{display:block}
.w{display:inline-block;will-change:transform,filter}
.mark-wrap{position:relative;display:inline-block}
.mark{position:absolute;left:-4%;right:-4%;bottom:6%;height:34%;background:linear-gradient(90deg,${accent},${accent2});transform-origin:0 50%;transform:scaleX(0);z-index:-1;border-radius:${Math.min(R, 10)}px;opacity:.85}
.mark.box{top:-2%;bottom:-6%;height:auto;background:${accent};opacity:1}
.ink-line{position:absolute;left:-4%;width:108%;bottom:-18%;height:34%;overflow:visible}
.ink-circle{position:absolute;left:-14%;top:-22%;width:128%;height:144%;overflow:visible}
.ink-line path,.ink-circle path{fill:none;stroke:${accent};stroke-width:${land ? 5 : 6};stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;vector-effect:non-scaling-stroke}
.sub{font-size:${land ? 44 : 54}px;line-height:1.3;color:${c.muted};margin:0;font-weight:600;text-wrap:balance}
.ring-wrap{position:relative;width:540px;height:540px;display:flex;align-items:center;justify-content:center}
.ring{position:absolute;inset:0;transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:36;stroke-linecap:round}.ring .track{stroke:${alpha(c.ink, .08)}}.ring .arc{stroke:${accent};filter:drop-shadow(0 0 ${light ? 0 : 22}px ${accent})}
.ring-glow{position:absolute;inset:8%;border-radius:50%;background:radial-gradient(circle,${alpha(accent, .33)},transparent 65%);opacity:0}
.stat-value{font-family:${font(theme.fonts.display)};font-weight:900;letter-spacing:-6px;line-height:1;white-space:nowrap;text-shadow:${light ? 'none' : `0 0 40px ${alpha(accent, .4)}`}}
.stat-giant .stat-value{color:${textAccent}}
.stat-rule{display:block;width:60%;height:12px;background:${accent};transform-origin:0 50%;border-radius:${Math.min(R, 6)}px}
.bar{width:100%;height:${land ? 34 : 40}px;background:${alpha(c.ink, .1)};border-radius:${Math.min(R, 40)}px;overflow:hidden}
.bar-fill{display:block;height:100%;background:linear-gradient(90deg,${accent},${accent2});transform-origin:0 50%}
.n{display:inline-block}.unit{font-size:.36em;letter-spacing:0;margin-left:.12em;opacity:.85;font-weight:800}
.stat-label{font-size:${land ? 54 : 62}px;font-weight:800;margin:0;line-height:1.18;text-wrap:balance}
.stat-source{font-size:32px;color:${c.muted};margin:0;font-family:${font(theme.fonts.label)}}
.numbers{gap:${land ? 90 : 80}px}.numbers.row{flex-direction:row}
.num-value{font-family:${font(theme.fonts.display)};white-space:nowrap;font-size:${land ? 210 : 250}px;font-weight:900;line-height:1;letter-spacing:-6px}
.num-text{font-size:${land ? 46 : 54}px;color:${c.muted};margin-top:10px;font-weight:600}
.card{background:${cardBg};border:${cardBorder};border-radius:${R}px;padding:${land ? '70px 80px' : '64px 60px'};box-shadow:${cardShadow};text-align:left;width:100%;box-sizing:border-box}
.quote-big{text-align:left;width:100%}
.quote-big .qmark{font-size:300px;height:150px}
.qmark{font-family:${font(theme.fonts.display)};font-size:140px;line-height:.7;color:${textAccent};height:80px}
.quote{font-family:${font(theme.fonts.display)};line-height:1.25;font-weight:${Math.max(600, Math.min(800, theme.type.weight))};margin:28px 0 44px}
.qw{display:inline-block;opacity:.22}
.author{display:flex;align-items:center;gap:24px;font-size:34px}.author b{display:block}.author i{display:block;font-style:normal;color:${c.muted};font-size:28px}
.avatar{width:84px;height:84px;border-radius:50%;background:${accent};color:${onAccent};font-weight:900;font-size:40px;display:flex;align-items:center;justify-content:center;flex:none}
.list-wrap{align-items:flex-start;text-align:left}.list-head{font-family:${font(theme.fonts.display)};font-size:${land ? 88 : 96}px;font-weight:${theme.type.weight};margin:0 0 14px;letter-spacing:${theme.type.tracking}px;line-height:1.05;text-transform:${theme.type.case === 'upper' ? 'uppercase' : 'none'}}
.list{position:relative;list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:24px;width:100%}
.li{--on:0;display:flex;align-items:center;gap:30px;font-size:${land ? 50 : 58}px;font-weight:700;background:${theme.card === 'outline' ? 'transparent' : alpha(c.ink, .04)};border:2px solid color-mix(in srgb,${accent} calc(var(--on)*100%),${alpha(c.ink, .1)});border-radius:${Math.min(R, 30)}px;padding:28px 36px;opacity:0;box-shadow:0 0 calc(var(--on)*30px) ${alpha(accent, .35)}}
.li-num{font-family:${font(theme.fonts.label)};font-size:36px;font-weight:900;color:${textAccent};min-width:70px}
.li-num.check{display:flex;align-items:center;justify-content:center;width:70px;height:70px;min-width:70px;border-radius:50%;background:${accent};color:${onAccent};font-size:40px}
.li-num.big{font-family:${font(theme.fonts.display)};font-size:110px;line-height:.8;color:transparent;-webkit-text-stroke:3px ${accent};min-width:100px}
.list-checklist .li,.list-numbers .li{background:transparent;border-color:transparent;padding:14px 0;box-shadow:none}
.list-timeline .list{padding-left:20px}
.list-timeline .li{background:transparent;border:0;box-shadow:none;padding:16px 0 16px 70px}
.list-timeline .li-num{position:absolute;left:0;width:56px;height:56px;min-width:0;border-radius:50%;background:${c.bg};border:5px solid ${accent};display:flex;align-items:center;justify-content:center;font-size:24px}
.rail-track,.rail{position:absolute;left:46px;top:30px;bottom:30px;width:6px;background:${alpha(c.ink, .12)};border-radius:6px}
.rail{background:${accent};transform-origin:50% 0;transform:scaleY(0)}
.specs{align-items:stretch;text-align:left}.spec-rows{display:flex;flex-direction:column;gap:26px;width:100%}
.spec-row{display:flex;align-items:baseline;gap:20px;font-size:${land ? 46 : 52}px;opacity:0}
.spec-k{color:${c.muted};font-weight:600}.spec-row i{flex:1;border-bottom:3px dotted ${alpha(c.ink, .25)};transform:translateY(-10px)}
.spec-v .unit{font-size:.62em;opacity:.9}
.spec-v{font-family:${font(theme.fonts.display)};font-weight:900;color:${textAccent};white-space:nowrap}
.compare{gap:${land ? 50 : 40}px;align-items:stretch}.compare.row{flex-direction:row}.compare.col{flex-direction:column}
.side{flex:1;background:${cardBg};border:${theme.card === 'outline' ? `3px solid var(--side)` : cardBorder};border-top:10px solid var(--side);border-radius:${R}px;padding:${land ? '40px 46px' : '36px 44px'};text-align:left;box-shadow:${cardShadow}}
.side h3{font-family:${font(theme.fonts.display)};font-size:${land ? 64 : 66}px;margin:0 0 18px;font-weight:${theme.type.weight};color:var(--side-ink);letter-spacing:${theme.type.tracking}px}
.side ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:14px}
.side li{font-size:${land ? 40 : 44}px;font-weight:600;padding-left:34px;position:relative}.side li:before{content:'';position:absolute;left:0;top:.42em;width:16px;height:16px;border-radius:50%;background:var(--side)}
.vs{align-self:center;font-family:${font(theme.fonts.display)};font-size:${land ? 120 : 110}px;font-weight:900;color:${onAccent};background:${accent};padding:${land ? '20px 36px' : '14px 36px'};border-radius:${Math.min(R, 24)}px;transform:rotate(-6deg);box-shadow:0 20px 50px ${alpha('#000000', .25)};z-index:2}
.compare.col .vs{margin:-30px 0}
.compare-table .vs{font-size:${land ? 70 : 64}px}
.burst{position:absolute;left:50%;top:${land ? 50 : 44}%;width:0;height:0}.burst i{position:absolute;left:0;top:-3px;width:${land ? 1000 : 820}px;height:6px;transform-origin:0 50%;background:linear-gradient(90deg,transparent 30%,${alpha(accent, .67)});border-radius:6px}
.pill{background:linear-gradient(90deg,${accent},${accent2});color:${onAccent};font-weight:900;font-size:44px;padding:24px 56px;border-radius:${Math.min(R, 999) || 8}px;box-shadow:0 0 ${light ? 0 : 50}px ${alpha(accent, .6)}}
.captions{position:absolute;left:0;right:0;bottom:${land ? 9 : 17}%;height:0}
.cap-group{position:absolute;left:6%;right:6%;bottom:0;display:flex;flex-wrap:wrap;justify-content:center;gap:10px 14px;opacity:0}
.cap-w{position:relative;display:inline-block;padding:6px 16px 10px;font-family:${font(theme.fonts.display)};font-size:${land ? 64 : 76}px;font-weight:900;letter-spacing:-1px;text-shadow:${light ? 'none' : '0 6px 24px rgba(0,0,0,.6)'}}
.cap-w b{position:relative;z-index:1}.cap-bg{position:absolute;inset:0;border-radius:${Math.min(R, 14)}px;background:${accent};transform-origin:0 50%;transform:scaleX(0);opacity:0}
.progress{position:absolute;left:${land ? 6 : 8}%;right:${land ? 6 : 8}%;bottom:${land ? 4 : 5}%;display:flex;gap:10px}
.progress span{flex:1;height:7px;border-radius:7px;background:${alpha(c.ink, .14)}}.progress span.on{background:var(--c)}
.progress span.now{overflow:hidden;position:relative}.progress span.now:after{content:'';position:absolute;inset:0;background:var(--c);transform-origin:0 50%;transform:scaleX(var(--p,0))}
.wave{position:absolute;left:8%;right:8%;bottom:${land ? 10 : 11}%;height:${land ? 150 : 170}px;display:flex;align-items:flex-end;gap:8px}
.wave i{flex:1;height:100%;border-radius:8px;background:linear-gradient(0deg,${accent},${alpha(accent, .33)});transform-origin:50% 100%;transform:scaleY(.06)}
.audiogram{flex-direction:column;gap:46px}.ag-eyebrow{font-family:${font(theme.fonts.label)};font-size:30px;letter-spacing:8px;color:${textAccent};font-weight:800}
.ag-title{font-family:${font(theme.fonts.display)};font-size:${land ? 76 : 80}px;font-weight:${theme.type.weight};line-height:1.08;margin:0;text-align:center;width:84%;text-wrap:balance}
.ag-wave{width:${land ? 74 : 84}%;height:${land ? 300 : 360}px;display:flex;align-items:center;gap:10px}
.ag-wave i{flex:1;height:100%;border-radius:10px;background:linear-gradient(180deg,${accent},${alpha(accent2, .67)});transform:scaleY(.05)}
.flash{position:absolute;inset:0;background:radial-gradient(circle at 50% 45%,${light ? '#ffffff' : '#fff'},${alpha(accent, .33)} 60%,transparent);opacity:0;mix-blend-mode:${light ? 'normal' : 'screen'}}
.hero{position:absolute;border-radius:${R}px;overflow:hidden;box-shadow:${light ? `0 30px 70px ${alpha('#000000', .22)}` : '0 40px 110px rgba(0,0,0,.55)'},0 0 0 1.5px ${alpha(c.ink, .1)}}
.hero-media{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.hero-photo{background:${light ? c.bg2 : '#0b0d18'}}
.hero-fill{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(30px) brightness(${light ? .9 : .5}) saturate(1.2);transform:scale(1.25)}
.hero-studio .hero-media{inset:4%;width:92%;height:92%}
.hero-cutout{overflow:visible;box-shadow:none;border-radius:0}
.hero-cutout .hero-media{object-fit:contain;filter:drop-shadow(0 46px 60px rgba(0,0,0,${light ? .3 : .65}))}
.hero-glow{position:absolute;inset:10%;border-radius:50%;background:radial-gradient(circle,${alpha(accent, .4)},transparent 65%);filter:blur(30px)}
.hero-gloss{position:absolute;top:-20%;left:0;width:30%;height:140%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.28),transparent);transform:rotate(16deg);mix-blend-mode:screen;pointer-events:none}
.frame-tape,.frame-polaroid{border-radius:2px;overflow:visible;background:#fbfaf7;box-shadow:0 26px 60px ${alpha('#000000', .28)}}
.frame-tape .hero-inner,.frame-polaroid .hero-inner{position:absolute;inset:16px;overflow:hidden;background:${c.bg2}}
.frame-polaroid .hero-inner{bottom:70px}
.tape{position:absolute;width:190px;height:54px;background:${alpha('#efe3c4', .82)};box-shadow:0 2px 6px ${alpha('#000000', .12)};z-index:3}
.frame-hud{border-radius:0;box-shadow:none;border:2px solid ${alpha(accent, .5)}}
.frame-hud .hud-c{width:56px;height:56px}
.frame-soft{box-shadow:0 30px 90px ${alpha('#000000', light ? .18 : .5)}}
.hero-inner{position:absolute;inset:0;overflow:hidden;border-radius:inherit}
.hero-bg .hero-inner{border-radius:0}
.stage.with-hero{${land ? 'padding-left:46%;padding-bottom:0' : 'padding:4% 0 6%'};box-sizing:border-box}
.fit{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${land ? 0 : 60}px;width:100%}
.hero-slot{position:relative;flex:none}
.stage.with-hero .center{zoom:${land ? .74 : .78}}
.stage.with-hero .ring-wrap{width:420px;height:420px}
.stage.over-hero .center{zoom:${land ? .9 : .92}}
.arrow{position:absolute;overflow:visible}.arrow path{fill:none;stroke:${accent};stroke-width:7;stroke-linecap:round;stroke-linejoin:round}`;
}

// Ses zarfı → GSAP set satırları (yalnız sayısal değerler; sarılabilir)
function waveTimeline(selector, env, bars, rate = 15, centered = false) {
  if (!env?.length) return '';
  const shape = Array.from({ length: bars }, (_, i) => +(0.55 + 0.45 * Math.abs(Math.sin(i * 1.7 + 0.6))).toFixed(3));
  return `(function(){var env=${JSON.stringify(env)},shape=${JSON.stringify(shape)},bars=document.querySelectorAll('${selector}');
for(var k=0;k<env.length;k++){(function(k){tl.set(bars,{scaleY:function(i){var v=env[k]*shape[i]*(0.75+0.25*Math.abs(Math.sin(k*0.9+i*1.3)));return Math.max(${centered ? .04 : .06},Math.min(1,v));}},${num(1 / rate)}*k);})(k);}})();`;
}

/**
 * Bir sahnenin kompozisyonu.
 *  scene {visual, direction}, index, total, duration (sn), speech (konuşma süresi),
 *  words [{text,start,end}] (sahne içi), format 'reels'|'podcast', theme (normalize),
 *  media {kind, file} (stok zemin), hero {kind,file,cutout,edge,w,h} (sahne görseli),
 *  logo (proje göreli dosya), waveMode 'none'|'wave'|'audiogram', envelope, title,
 *  captions, beats (sahne içi sn), beatPeriod
 */
function buildScene(o) {
  const { scene, index = 0, total = 1, format = 'reels', media = null, waveMode = 'none', envelope = null, title = '', captions = false } = o;
  const theme = o.theme && o.theme.colors ? o.theme : Themes.BUILT_IN[0];
  const direction = scene.direction && typeof scene.direction === 'object' ? scene.direction : {};
  const c = theme.colors, light = Themes.isLight(c.bg);
  const duration = snap(o.duration);
  const D = duration, exitAt = Math.max(.3, D - .26);
  const W = format === 'podcast' ? 1920 : 1080, H = format === 'podcast' ? 1080 : 1920, land = W > H;
  const audiogram = waveMode === 'audiogram';
  const safe = !land && o.safeArea !== false ? SAFE_AREA : null;
  const heroPos = ['top', 'side', 'background', 'inset', 'none'].includes(direction.hero) ? direction.hero : 'auto';
  const hero = o.hero && o.hero.file && !audiogram && heroPos !== 'none' ? o.hero : null;
  const beatPeriod = +o.beatPeriod || 0;
  const sceneBeats = Array.isArray(o.beats) ? o.beats.filter(b => Number.isFinite(b) && b >= 0 && b < D) : [];
  const words = Array.isArray(o.words) ? o.words.filter(w => w && Number.isFinite(w.start)) : [];
  const speech = Math.max(.5, Math.min(duration, o.speech || (words.length ? words[words.length - 1].end : duration - .4)));
  const tone = Number.isInteger(direction.tone) && direction.tone >= 0 ? direction.tone : index;
  const accent = c.accents[tone % c.accents.length], accent2 = c.accents[(tone + 1) % c.accents.length];
  const energy = theme.energy;
  // Yırtık kâğıt, yazı rengiyle karışmayan bir vurgudan seçilir; vurgu yazıları tüm yüzeylerde okunur kalır
  const lightBg = Themes.isLight(c.bg);
  const tornFill = theme.motifs.includes('torn') ? [accent, ...c.accents].find(a => Themes.contrast(a, c.ink) >= 3) : null;
  const surfaces = [c.bg, c.card, ...(tornFill ? [mixHex(c.bg, tornFill, lightBg ? .85 : .35)] : [])];
  const readable = a => readableAccent(a, c.ink, surfaces);
  const textAccent = readable(accent);
  const transition = Themes.TRANSITIONS.includes(direction.transition) ? direction.transition : theme.transition;
  const has = m => theme.motifs.includes(m);
  const random = rng(index + 7);
  const find = makeFinder(words);
  let content = '', anim = [], hits = [], ghost = null;
  if (audiogram) {
    const v = scene.visual || {};
    const cap = captionLayer(words, land);
    content = `<div class="center audiogram"><div class="ag-eyebrow">PODCAST</div><h1 class="ag-title">${esc(title)}</h1><div class="ag-wave">${'<i></i>'.repeat(land ? 48 : 36)}</div>${!words.length && (v.heading || v.quote) ? `<p class="sub">${esc(v.heading || v.quote)}</p>` : ''}</div>${cap.html}`;
    anim = [waveTimeline('.ag-wave i', envelope, land ? 48 : 36, 15, true), ...cap.lines];
  } else {
    const t = templateParts(scene.visual || {}, { land, words, speech, find, accent, textAccent, readable, ink: c.ink, bg: c.bg, theme, direction, random, energy, tone, index, step: beatPeriod ? Math.max(.06, Math.min(.2, beatPeriod / 2)) : 0 });
    content = t.html; anim = t.lines; hits = t.hits; ghost = has('blobs') && light ? null : t.ghost;
  }
  const capLayer = captions && !audiogram ? captionLayer(words, land) : { html: '', lines: [] };

  // ---- Sahne görseli: konum (yönetmen) + çerçeve (tema) ----
  let heroHtml = '', heroBottom = 0, stageClass = '', heroFlow = false, heroW = 0, heroH = 0;
  const heroLines = [];
  if (hero) {
    const place = heroPos === 'auto' ? (land ? 'side' : 'top') : heroPos === 'side' && !land ? 'top' : heroPos === 'top' && land ? 'side' : heroPos;
    const mode = hero.cutout ? 'cutout' : hero.edge ? 'studio' : 'photo';
    const frame = mode === 'cutout' || place === 'background' ? 'none' : theme.frame;
    const src = esc(hero.file);
    const media2 = hero.kind === 'video'
      ? `<video class="hero-media" id="heroMedia" src="${src}" muted playsinline data-start="0" data-duration="${D}"></video>`
      : `${mode === 'photo' ? `<img class="hero-fill" src="${src}" alt="">` : ''}<img class="hero-media" id="heroMedia" src="${src}" alt="">`;
    // Standart 16:9 kart: görsel hiç kırpılmaz (contain); boş kenarları aynı
    // görselin bulanık kopyası doldurur. Şeffaf kesim kendi oranında, kartsız.
    let w, h, box;
    if (place === 'background') { box = 'left:0;top:0;width:100%;height:100%'; stageClass = ' over-hero'; }
    else {
      if (mode === 'cutout') { const aspect = Math.min(2.2, Math.max(.62, (hero.w || 16) / (hero.h || 9))); w = land ? 845 : 930; h = Math.min(land ? 800 : 820, Math.max(400, w / aspect)); }
      else if (place === 'inset') { w = land ? 620 : 640; h = Math.round(w * 9 / 16); }
      else { w = land ? 880 : Math.min(960, safe ? W - safe.left - safe.right : 960); h = Math.round(w * 9 / 16); }
      if (mode === 'cutout' && safe) { const k = Math.min(1, (W - safe.left - safe.right) / w); w = Math.round(w * k); h = Math.round(h * k); }
      if (place === 'inset') box = land ? `right:5%;width:${w}px;top:8%;height:${h}px` : `right:${safe ? safe.right : 60}px;width:${w}px;top:${safe ? safe.top : 90}px;height:${h}px`;
      else box = land ? `left:5%;width:${w}px;top:${Math.round((H - h) / 2 - 20)}px;height:${Math.round(h)}px` : 'left:0;top:0;width:100%;height:100%';
      if (!land && place === 'inset') heroBottom = (safe ? safe.top : 90) + Math.round(h);
      heroFlow = !land && place !== 'inset';
      stageClass = place === 'inset' && land ? ' over-hero' : ' with-hero';
    }
    heroW = w; heroH = h;
    const rot = frame === 'tape' ? -2.2 : frame === 'polaroid' ? 1.6 : place === 'inset' ? -3 : 0;
    const decor = frame === 'tape' ? '<i class="tape" style="left:-40px;top:-22px;transform:rotate(-24deg)"></i><i class="tape" style="right:-40px;top:-22px;transform:rotate(22deg)"></i>'
      : frame === 'hud' ? '<i class="hud-c" style="left:-8px;top:-8px;border-right:0;border-bottom:0"></i><i class="hud-c" style="right:-8px;top:-8px;border-left:0;border-bottom:0"></i><i class="hud-c" style="left:-8px;bottom:-8px;border-right:0;border-top:0"></i><i class="hud-c" style="right:-8px;bottom:-8px;border-left:0;border-top:0"></i>' : '';
    const cls = `hero hero-${mode}${place === 'background' ? ' hero-bg' : ''}${frame !== 'none' && frame !== 'card' ? ` frame-${frame}` : ''}`;
    heroHtml = `<div class="${cls}" id="hero" style="${box}${mode === 'studio' ? `;background:${hero.edge}` : ''}">${mode === 'cutout' ? '<div class="hero-glow"></div>' : ''}<div class="hero-inner"${mode === 'studio' ? ` style="background:${hero.edge}"` : ''}>${media2}${mode === 'cutout' || place === 'background' ? '' : '<i class="hero-gloss" id="heroGloss"></i>'}</div>${decor}${place === 'background' ? '<div class="shade"></div>' : ''}</div>`;
    if (place === 'background') heroLines.push(`tl.fromTo('#hero',{opacity:0,scale:1.12},{opacity:1,scale:1,duration:.8,ease:'power2.out'},0);tl.to('#heroMedia',{scale:1.06,duration:${D},ease:'none'},0);`);
    else {
      heroLines.push(`tl.fromTo('#hero',{y:90,scale:.84,opacity:0,rotation:${rot - 4},filter:'blur(18px)'},{y:0,scale:1,opacity:1,rotation:${rot},filter:'blur(0px)',duration:.7,ease:'back.out(1.4)'},.04);`);
      heroLines.push(`tl.to('#hero',{y:${land ? -14 : -18},scale:1.035,rotation:${num(rot + (mode === 'cutout' ? 1.2 : .3))},duration:${num(Math.max(1, D - .8))},ease:'sine.inOut'},.75);`);
    }
    if (mode === 'photo' && hero.kind !== 'video') heroLines.push(`tl.fromTo('.hero-fill',{scale:1.25},{scale:1.4,duration:${D},ease:'none'},0);`);
    if (mode === 'cutout') heroLines.push(`tl.fromTo('.hero-glow',{opacity:.4,scale:.9},{opacity:.9,scale:1.1,duration:${num(Math.max(1, D / 2))},ease:'sine.inOut',yoyo:true,repeat:1},0);`);
    else if (place !== 'background') for (let k = 0; k < Math.max(1, Math.floor(D / 4)); k++) heroLines.push(`tl.fromTo('#heroGloss',{xPercent:-160},{xPercent:260,duration:1.1,ease:'power2.inOut',immediateRender:false},${num(.9 + k * 4)});`);
  }

  // ---- Zemin (tema) ----
  const bgLayers = [], bgLines = [];
  const mediaHtml = media?.file && !hero
    ? (media.kind === 'video'
      ? `<video class="media" id="bgmedia" src="${esc(media.file)}" muted playsinline data-start="0" data-duration="${duration}"></video>`
      : `<img class="media" id="bgmedia" src="${esc(media.file)}" alt="">`) + '<div class="shade"></div>'
    : '';
  if (mediaHtml) { bgLayers.push(mediaHtml); bgLines.push(`tl.fromTo('#bgmedia',{scale:1.14,x:-30},{scale:1.02,x:30,duration:${D},ease:'none'},0);`); }
  if (theme.background === 'soft') bgLayers.push('<div class="soft-bg"></div>');
  if (theme.background === 'glow' || has('blobs')) {
    bgLayers.push('<div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>');
    bgLines.push(`tl.fromTo('.b1',{x:-60,y:0,scale:1},{x:120,y:-80,scale:1.18,duration:${D},ease:'sine.inOut'},0);`, `tl.fromTo('.b2',{x:80,y:40,scale:1.1},{x:-140,y:-60,scale:.92,duration:${D},ease:'sine.inOut'},0);`, `tl.fromTo('.b3',{x:0,y:0},{x:160,y:-120,duration:${D},ease:'sine.inOut'},0);`);
  }
  bgLayers.push('<div class="halo"></div>');
  if (theme.background === 'paper') {
    bgLayers.push(`<svg class="paper-tex" width="100%" height="100%"><filter id="pt"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" seed="${index + 3}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .35 0 0 0 0 .3 0 0 0 0 .24 0 0 0 .22 0"/></filter><rect width="100%" height="100%" filter="url(#pt)"/></svg>`);
    bgLayers.push(`<i class="fold" style="left:0;right:0;top:${land ? 48 : 38}%;height:2px"></i><i class="fold" style="top:0;bottom:0;left:${land ? 62 : 70}%;width:2px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.05),transparent)"></i>`);
  }
  if (tornFill) {
    const cx = land ? 1300 : 560, cy = land ? 560 : (hero ? 560 : 860);
    bgLayers.push(`<svg class="torn" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polygon id="torn" points="${tornBlob(random, cx, cy, land ? 640 : 520, land ? 420 : 520)}" fill="${alpha(tornFill, light ? .85 : .35)}"/></svg>`);
    bgLines.push(`tl.fromTo('#torn',{scale:.9,transformOrigin:'50% 50%',opacity:0},{scale:1,opacity:1,duration:.6,ease:'power3.out'},0);`);
  }
  if (theme.background === 'grid') { bgLayers.push('<div class="gridlines"></div>'); bgLines.push(`tl.fromTo('.gridlines',{x:0,y:0},{x:-45,y:-90,duration:${D},ease:'none'},0);`); }
  else if (has('dots')) { bgLayers.push('<div class="dots"></div>'); bgLines.push(`tl.fromTo('.dots',{x:0,y:0},{x:-46,y:-46,duration:${D},ease:'none'},0);`); }
  if (has('halftone')) bgLayers.push(`<div class="halftone" style="${land ? 'right:-120px;bottom:-140px' : 'left:-140px;bottom:120px'}"></div>`);
  if (has('registration')) {
    const mark = `<svg class="regmark" viewBox="0 0 64 64"><circle cx="32" cy="32" r="18"/><path d="M32 2V62M2 32H62"/></svg>`;
    bgLayers.push(`<div style="position:absolute;left:44px;top:44px">${mark}</div><div style="position:absolute;right:44px;bottom:${land ? 60 : 150}px">${mark}</div>`);
  }
  if (has('hud') || theme.background === 'grid') {
    const m = land ? 48 : 46;
    bgLayers.push(`<i class="hud-c" style="left:${m}px;top:${m}px;border-right:0;border-bottom:0"></i><i class="hud-c" style="right:${m}px;top:${m}px;border-left:0;border-bottom:0"></i><i class="hud-c" style="left:${m}px;bottom:${m + (land ? 30 : 80)}px;border-right:0;border-top:0"></i><i class="hud-c" style="right:${m}px;bottom:${m + (land ? 30 : 80)}px;border-left:0;border-top:0"></i>`);
    bgLayers.push(`<div class="hud-label" style="left:${m + 90}px;top:${m + 10}px">SCN ${String(index + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}</div><div class="hud-label" id="hudTime" style="right:${m + 90}px;top:${m + 10}px">● REC</div>`);
    bgLines.push(`tl.fromTo('.hud-c',{opacity:0,scale:1.3},{opacity:1,scale:1,duration:.4,stagger:.05},0);`);
  }
  if (has('scanline')) { bgLayers.push('<i class="scan" id="scan"></i>'); bgLines.push(`tl.fromTo('#scan',{top:'-2%'},{top:'102%',duration:${num(Math.max(1.5, Math.min(3, D / 2)))},ease:'none',repeat:${Math.max(0, Math.floor(D / 3) - 1)}},0);`); }
  if (has('dust')) {
    bgLayers.push(Array.from({ length: 16 }, (_, k) => `<i class="dust" id="d${k}" style="left:${(random() * 100).toFixed(1)}%;top:${(20 + random() * 90).toFixed(1)}%;opacity:${(.15 + random() * .45).toFixed(2)};transform:scale(${(.4 + random() * .9).toFixed(2)})"></i>`).join(''));
    for (let k = 0; k < 16; k++) bgLines.push(`tl.fromTo('#d${k}',{y:0,x:0},{y:-${Math.round(120 + random() * 260)},x:${Math.round(random() * 80 - 40)},duration:${D},ease:'none'},0);`);
  }
  if (has('sweep')) {
    bgLayers.push('<div class="sweep"></div>');
    for (const t0 of sceneBeats.length ? sceneBeats.filter((b, k) => k % 8 === 1 && b < D - 1) : Array.from({ length: Math.max(1, Math.floor(D / 3.2)) }, (_, k) => .8 + k * 3.2)) bgLines.push(`tl.fromTo('.sweep',{x:0},{x:${land ? 3400 : 2300},duration:1.6,ease:'power1.inOut',immediateRender:false},${num(t0)});`);
  }
  if (has('comets')) {
    bgLayers.push([0, 1].map(k => `<i class="comet" id="cm${k}" style="width:${land ? 420 : 340}px;left:-35%;top:${(k ? 64 : 16) + random() * 10}%;transform:rotate(${k ? 16 : -22}deg);background:linear-gradient(90deg,transparent,${k ? accent2 : accent})"></i>`).join(''));
    bgLines.push(`tl.fromTo('#cm0',{x:0,y:0,opacity:0},{x:${land ? 3000 : 2000},y:${land ? 900 : 700},opacity:1,duration:1.9,ease:'power2.inOut'},.15);`);
    if (D > 3) bgLines.push(`tl.fromTo('#cm1',{x:0,y:0,opacity:0},{x:${land ? 3000 : 2000},y:${land ? -600 : -500},opacity:1,duration:2.1,ease:'power2.inOut'},${num(Math.min(D - 2, D * .55))});`);
  }
  if (ghost && !hero) { bgLayers.push(`<div class="ghost">${esc(String(ghost).toLocaleUpperCase('tr').slice(0, 10))}</div>`); bgLines.push(`tl.fromTo('.ghost',{xPercent:-46,opacity:0},{xPercent:-54,opacity:1,duration:${D},ease:'none'},0);`); }
  if (theme.background !== 'paper') bgLayers.push('<div class="vignette"></div>');
  if (has('grain')) bgLayers.push('<div class="grain"></div>');
  // El çizimi ok: görseli veya başlığı işaret eder
  let arrowHtml = '';
  if (has('arrows')) {
    const pos = hero && heroFlow ? 'right:-30px;top:-150px;width:200px;height:146px' : hero && !land ? `left:${W - 330}px;top:${heroBottom - 40}px;width:220px;height:160px` : land ? 'left:44%;top:16%;width:240px;height:170px' : `left:${safe ? safe.left : 70}px;top:${safe ? safe.top + 20 : 300}px;width:220px;height:160px`;
    arrowHtml = `<svg class="arrow" style="${pos}" viewBox="0 0 220 160"><path id="arrowPath" d="M200 20 C150 30 90 60 60 120 M60 120 L58 82 M60 120 L96 108" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1"/></svg>`;
    bgLines.push(`tl.to('#arrowPath',{strokeDashoffset:0,duration:.7,ease:'power2.out'},${num(Math.min(D - .6, 1.2))});`);
  }
  // Logo (tema): köşede, girişte hafifçe belirir
  const logo = o.logo && theme.logo ? theme.logo : null;
  const sx = safe ? safe.left : 48, sr = safe ? safe.right : 48, st = safe ? safe.top : 48, sb = safe ? safe.bottom + 40 : land ? 70 : 150;
  const logoPos = logo ? { 'top-left': `left:${sx}px;top:${st}px`, 'top-right': `right:${sr}px;top:${st}px`, 'bottom-left': `left:${sx}px;bottom:${sb}px`, 'bottom-right': `right:${sr}px;bottom:${sb}px` }[logo.position] : '';
  const logoH = logo ? Math.round(Math.min(safe ? 110 : 999, logo.size * (land ? .8 : 1))) : 0;
  const logoHtml = logo ? `<img class="logo" id="logo" src="${esc(o.logo)}" alt="" style="${logoPos};height:${logoH}px">` : '';
  const wave = waveMode === 'wave' && !audiogram ? `<div class="wave">${'<i></i>'.repeat(40)}</div>` : '';
  const progress = `<div class="progress" style="--c:${accent}">${Array.from({ length: Math.min(total, 24) }, (_, k) => `<span class="${k < index ? 'on' : k === index ? 'now' : ''}"${k === index ? ' id="pnow"' : ''}></span>`).join('')}</div>`;

  // ---- Hareket: enerji (tema) + geçiş (yönetmen/tema) ----
  const push = energy === 'calm' ? 1.03 : energy === 'normal' ? 1.05 : 1.08;
  const enterLines = {
    whip: [`tl.fromTo('.stage',{x:${land ? 220 : 160},filter:'blur(18px)'},{x:0,filter:'blur(0px)',duration:.38,ease:'power3.out'},0);`, `tl.fromTo('.flash',{opacity:${light ? .3 : .55}},{opacity:0,duration:.32,ease:'power2.out'},0);`],
    zoom: [`tl.fromTo('.stage',{scale:1.18,opacity:0,filter:'blur(14px)'},{scale:1,opacity:1,filter:'blur(0px)',duration:.5,ease:'power3.out'},0);`],
    slide: [`tl.fromTo('.stage',{y:${land ? 120 : 160},opacity:0},{y:0,opacity:1,duration:.55,ease:'power3.out'},0);`],
    flash: [`tl.fromTo('.flash',{opacity:1},{opacity:0,duration:.45,ease:'power2.out'},0);`, `tl.fromTo('.stage',{opacity:0},{opacity:1,duration:.2},0);`],
    cut: []
  }[transition];
  const exitLine = D > 1.2 ? {
    whip: `tl.to('.stage',{x:${land ? -260 : -190},filter:'blur(16px)',opacity:0,duration:.26,ease:'power2.in'},${num(exitAt)});`,
    zoom: `tl.to('.stage',{scale:.9,opacity:0,filter:'blur(10px)',duration:.26,ease:'power2.in'},${num(exitAt)});`,
    slide: `tl.to('.stage',{y:${land ? -80 : -110},opacity:0,duration:.26,ease:'power2.in'},${num(exitAt)});`,
    flash: `tl.to('.stage',{opacity:0,duration:.2},${num(exitAt + .06)});`,
    cut: ''
  }[transition] + `tl.to('.captions',{opacity:0,duration:.2},${num(exitAt)});` : '';
  const lines = [
    ...bgLines,
    ...sceneBeats.map((b, k) => `tl.fromTo('.halo',{opacity:1,scale:1.06},{opacity:.62,scale:1,duration:${num(Math.min(.42, beatPeriod * .85))},ease:'power2.out',immediateRender:false},${num(b)});` + (energy !== 'calm' && k % 4 === 0 && b > .4 && b < D - .5 ? `tl.fromTo('.flash',{opacity:.07},{opacity:0,duration:.3,immediateRender:false},${num(b)});` : '')),
    envelope?.length && !sceneBeats.length ? `(function(){var e=${JSON.stringify(envelope)};for(var k=0;k<e.length;k+=2)tl.to('.halo',{opacity:.55+e[k]*.45,duration:.12},k/15);})();` : '',
    // Kamera: sürekli itiş + (sakin değilse) vurgu anlarında kısa sarsıntı
    `tl.fromTo('.camera',{scale:1,y:0,rotation:${energy === 'calm' ? 0 : land ? -.4 : -.6}},{scale:${push},y:${land ? -14 : -24},rotation:${energy === 'calm' ? 0 : land ? .4 : .6},duration:${D},ease:'sine.inOut'},0);`,
    ...(energy === 'calm' ? [] : hits.filter(t => t > .2 && t < D - .4).slice(0, energy === 'punchy' ? 6 : 3).map(t => `tl.to('.stage',{scale:${energy === 'punchy' ? 1.035 : 1.02},duration:.07,ease:'power2.out'},${num(t)});tl.to('.stage',{scale:1,duration:.35,ease:'power2.out'},${num(t + .07)});` + (energy === 'punchy' ? `tl.fromTo('.flash',{opacity:${light ? .08 : .16}},{opacity:0,duration:.35},${num(t)});` : ''))),
    ...enterLines,
    `tl.fromTo('#pnow',{'--p':0},{'--p':1,duration:${D},ease:'none'},0);`,
    logoHtml ? `tl.fromTo('#logo',{opacity:0,y:-10},{opacity:1,y:0,duration:.5},.2);` : '',
    ...heroLines,
    ...anim,
    ...capLayer.lines,
    wave ? waveTimeline('.wave i', envelope, 40) : '',
    exitLine,
    `tl.set({}, {}, ${D});`
  ].filter(Boolean);
  // Ses efekti anları (sahne içi sn): konuşmayla senkron vurgular, seyreltilmiş
  const sfx = [];
  for (const t of [...hits].sort((a, b) => a - b)) if (t > .35 && t < D - .5 && (!sfx.length || t - sfx[sfx.length - 1].t >= .7) && sfx.length < (energy === 'calm' ? 2 : 4)) sfx.push({ t: num(t), kind: 'pop' });
  let safeCss = '';
  if (safe) {
    const capReserve = capLayer.html ? 230 : 0, logoTop = logo && logo.position.startsWith('top') ? logoH + 24 : 0, logoBottom = logo && logo.position.startsWith('bottom') ? logoH + 24 : 0;
    const top = Math.max(safe.top + logoTop, heroBottom ? heroBottom + 50 : 0), bottom = safe.bottom + 40 + capReserve + logoBottom;
    safeCss = `.stage{inset:auto;left:${safe.left}px;right:${safe.right}px;top:${top}px;bottom:${bottom}px;padding:0}
.stage .center{width:100%;zoom:.9}.stage.with-hero .center{zoom:.76}
.captions{bottom:${safe.bottom + 40}px}.cap-group{left:${safe.left}px;right:${safe.right}px}
.progress{left:${safe.left}px;right:${safe.right}px;bottom:${safe.bottom + 8}px}
.ghost,.burst{left:${safe.left + (W - safe.left - safe.right) / 2}px}`;
  }
  const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>Sahne ${index + 1}</title>
<style>${baseCss(W, H, theme, accent, accent2, textAccent)}${safeCss}</style></head>
<body>
<div id="root" data-composition-id="root" data-width="${W}" data-height="${H}" data-start="0" data-duration="${D}">
  <div class="clip bg" data-start="0" data-duration="${D}">${bgLayers.join('')}</div>
  <div class="clip camera" data-start="0" data-duration="${D}">${heroFlow ? '' : heroHtml}<div class="stage${stageClass}"${heroBottom && stageClass === ' with-hero' && !safe ? ` style="padding-top:${heroBottom + 70}px"` : ''}><div class="fit" id="fit">${heroFlow ? `<div class="hero-slot" style="width:${heroW}px;height:${heroH}px">${heroHtml}${arrowHtml}</div>` : ''}${content}</div></div>${heroFlow ? '' : arrowHtml}</div>
  ${capLayer.html}${wave}${progress}${logoHtml}<div class="flash"></div>
</div>
<script src="gsap.min.js"></script>
<script>
// Taşma koruması: içerik sahne kutusuna (güvenli alana) sığmazsa orantılı küçülür
(function(){function fit(){var f=document.getElementById('fit');if(!f)return;f.style.zoom=1;var s=f.parentNode,k=Math.min(1,(s.clientHeight-4)/Math.max(1,f.scrollHeight),(s.clientWidth-4)/Math.max(1,f.scrollWidth));if(k<1)f.style.zoom=k.toFixed(3);}fit();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);})();
var tl = gsap.timeline({ paused: true });
${lines.join('\n')}
window.__timelines = window.__timelines || {}; window.__timelines["root"] = tl;
</script>
</body></html>
`;
  return { html, sfx, transition };
}
function buildSceneHtml(o) { return buildScene(o).html; }

module.exports = { FPS, ACCENTS, VARIANTS, buildScene, buildSceneHtml, envelopeFromPcm, snap, frames, esc, parseNumber, makeFinder, captionLayer };
