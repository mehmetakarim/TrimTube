// Anlatımlı video: sahne başına HyperFrames kompozisyonu (HTML + GSAP).
// Her sahne kendi dosyasında, sesinin süresine göre üretilir; böylece yalnız
// değişen sahne yeniden render edilir. Hareket iki kaynaktan gelir:
//  1) Konuşmayla senkron: başlık kelimeleri, sayılar, liste maddeleri ve alıntı
//     kelimeleri söylendikleri anda girer (Whisper kelime zamanları).
//  2) Sürekli katman: kamera itişi, akan renk lekeleri, toz, ışık süpürmesi,
//     kuyruklu ışık, gren, hayalet kelime; girişte flaşlı whip, çıkışta savrulma.
// Kalıplar HyperFrames kataloğundaki (Apache-2.0) caption-highlight, count-up,
// headline-slam, push-in, light-sweep-pass ve grain-overlay bileşenlerinden
// uyarlanmıştır: tüm değişimler zaman çizelgesine yazılır (ileri/geri sarılabilir).
// Saf modül: dosya yazmaz, süreç başlatmaz (scripts/check-voice-video.cjs).

const FPS = 30;
const ACCENTS = ['#8b7bff', '#4da3ff', '#2fd39a', '#ffb547', '#ff6b8b', '#36d6e7'];
const SECOND = { '#8b7bff': '#ff6bd6', '#4da3ff': '#7a5cff', '#2fd39a': '#2fb4ff', '#ffb547': '#ff5f6d', '#ff6b8b': '#ffb547', '#36d6e7': '#8b7bff' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const frames = seconds => Math.max(1, Math.round(seconds * FPS));
const snap = seconds => frames(seconds) / FPS;
const num = n => +(+n).toFixed(3);
const norm = w => String(w).toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]/gu, '');
function rng(seed) { let s = (seed * 9301 + 49297) % 233280 || 1; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

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
function fitSize(text, steps) {
  const n = String(text || '').length;
  for (const [limit, size] of steps) if (n <= limit) return size;
  return steps[steps.length - 1][1];
}

// ---- Şablonlar: html + konuşma zamanlı animasyon satırları ----
function templateParts(v, ctx) {
  const { land, words, speech, find, accent } = ctx;
  const lines = [], hits = [];
  const items = v.items || [];
  const at = (phrase, fallback, from = 0) => { const f = find(phrase, from); return f ? { t: Math.max(.05, f.t - .12), i: f.i + 1 } : { t: fallback, i: from }; };
  // Başlık kelimeleri: her biri söylendiği an (bulunamazsa hızlı kademeli giriş)
  // Başlık hemen kademeli girer (kanca boş kalmasın); her kelime söylendiği
  // an vurgu rengiyle kısa bir sıçrama yapar.
  const headline = (text, cls, start = .1, step = .07) => {
    const tokens = String(text || '').split(/\s+/).filter(Boolean);
    let from = 0;
    const html = tokens.map((w, k) => `<span class="w ${cls}-w" id="${cls}${k}">${esc(w)}</span>`).join(' ');
    tokens.forEach((w, k) => {
      const t = start + k * step;
      lines.push(`tl.fromTo('#${cls}${k}',{y:80,scale:1.3,opacity:0,filter:'blur(14px)'},{y:0,scale:1,opacity:1,filter:'blur(0px)',duration:.45,ease:'back.out(1.7)'},${num(t)});`);
      const f = find(w, from);
      if (f) from = f.i + 1;
      if (f && f.t > t + .5) {
        lines.push(`tl.fromTo('#${cls}${k}',{scale:1,color:'#ffffff'},{scale:1.14,color:'${accent}',duration:.1,ease:'power2.out'},${num(f.t)});tl.to('#${cls}${k}',{scale:1,color:'#ffffff',duration:.45,ease:'power2.out'},${num(f.t + .12)});`);
        hits.push(f.t);
      }
    });
    return { html, end: start + tokens.length * step + .45 };
  };
  const countUp = (sel, value, t, dur = 1.05) => {
    const n = parseNumber(value);
    if (n && unitOf(n)) n.suffix = '';
    const box = sel.replace(/ \.n$/, '');
    if (!n) return `tl.fromTo('${sel}',{scale:.4,opacity:0},{scale:1,opacity:1,duration:.5,ease:'back.out(1.8)'},${num(t)});`;
    const count = Math.max(6, Math.round(dur * FPS)), ease = k => 1 - Math.pow(1 - k / count, 3);
    const rows = [];
    for (let k = 0; k <= count; k++) rows.push(`${n.prefix}${formatNumber(n.value * ease(k), n.decimals)}${n.suffix}`);
    return `tl.fromTo('${box}',{opacity:0,scale:.82},{opacity:1,scale:1,duration:.3,ease:'power2.out'},${num(t)});(function(){var r=${JSON.stringify(rows)};for(var k=0;k<r.length;k++)tl.set('${sel}',{textContent:r[k]},${num(t)}+k/${FPS});})();tl.to('${box}',{scale:1.09,duration:.12,ease:'power3.out'},${num(t + dur)});tl.to('${box}',{scale:1,duration:.3,ease:'power2.out'},${num(t + dur + .12)});`;
  };
  const sizeHead = text => land ? fitSize(text, [[14, 160], [26, 132], [42, 106], [999, 88]]) : fitSize(text, [[10, 176], [18, 150], [30, 124], [48, 104], [999, 90]]);
  switch (v.type) {
    case 'title': case 'statement': {
      const text = v.heading || v.label || '';
      const h = headline(text, 'h');
      const sub = v.subheading ? at(v.subheading, Math.min(speech - .6, h.end + .25)) : null;
      // Vurgu: başlığın en uzun kelimesinin arkasında işaretleyici bant
      const tokens = text.split(/\s+/).filter(Boolean);
      const key = tokens.reduce((b, w, k) => norm(w).length > norm(tokens[b] || '').length ? k : b, 0);
      const keyHit = find(tokens[key] || '');
      if (tokens.length) { lines.push(`tl.fromTo('#mark',{scaleX:0},{scaleX:1,duration:.45,ease:'power3.inOut'},${num(Math.min(speech, (keyHit ? keyHit.t : h.end) + .1))});`); hits.push(keyHit ? keyHit.t : h.end); }
      if (sub) lines.push(`tl.fromTo('.sub',{y:30,opacity:0,filter:'blur(8px)'},{y:0,opacity:1,filter:'blur(0px)',duration:.5,ease:'power3.out'},${num(Math.max(h.end - .1, sub.t))});`);
      const markWord = esc(tokens[key] || '');
      const html = h.html.replace(`id="h${key}">${markWord}</span>`, `id="h${key}"><span class="mark-wrap"><i id="mark"></i>${markWord}</span></span>`);
      return { html: `<div class="center"><h1 class="${v.type === 'title' ? 'mega' : 'statement'}" style="font-size:${sizeHead(text) * (v.type === 'title' ? 1 : .86)}px">${html}</h1>${v.subheading ? `<p class="sub">${esc(v.subheading)}</p>` : ''}</div>`, lines, hits, ghost: tokens[key] };
    }
    case 'stat': {
      const pct = parseNumber(v.value), ring = pct && /%/.test(v.value) && pct.value > 0 && pct.value <= 100;
      const r = 236, c = +(2 * Math.PI * r).toFixed(1);
      const t = at(v.value, .35).t;
      lines.push(countUp('#statValue .n', v.value, t));
      if (ring) lines.push(`tl.fromTo('.arc',{strokeDashoffset:${c}},{strokeDashoffset:${num(c * (1 - pct.value / 100))},duration:1.15,ease:'power3.out'},${num(t)});tl.fromTo('.ring-glow',{opacity:0,scale:.8},{opacity:1,scale:1.15,duration:.3},${num(t + 1.05)});tl.to('.ring-glow',{opacity:.25,scale:1,duration:.6},${num(t + 1.35)});`);
      const label = v.label ? at(v.label, t + .7) : null;
      if (label) lines.push(`tl.fromTo('.stat-label',{y:34,opacity:0,filter:'blur(8px)'},{y:0,opacity:1,filter:'blur(0px)',duration:.5,ease:'power3.out'},${num(Math.max(t + .35, label.t))});`);
      if (v.source) lines.push(`tl.fromTo('.stat-source',{opacity:0},{opacity:1,duration:.4},${num(Math.min(speech, t + 1.4))});`);
      hits.push(t + 1.05);
      const shownN = parseNumber(v.value), shown = shownN ? shownN.prefix + formatNumber(shownN.value, shownN.decimals) + (unitOf(shownN) ? '' : shownN.suffix) : v.value;
      const valueSize = land ? fitSize(shown, [[4, 260], [6, 220], [9, 170], [99, 130]]) : fitSize(shown, [[4, 290], [6, 240], [9, 185], [99, 140]]);
      return { html: `<div class="center"><div class="ring-wrap">${ring ? `<div class="ring-glow"></div><svg class="ring" viewBox="0 0 520 520"><circle cx="260" cy="260" r="${r}" class="track"/><circle cx="260" cy="260" r="${r}" class="arc" style="stroke-dasharray:${c};stroke-dashoffset:${c}"/></svg>` : ''}<div class="stat-value" id="statValue" style="font-size:${valueSize}px">${numberHtml(v.value)}</div></div>${v.label ? `<p class="stat-label">${esc(v.label)}</p>` : ''}${v.source ? `<p class="stat-source">Kaynak: ${esc(v.source)}</p>` : ''}</div>`, lines, hits, ghost: v.value };
    }
    case 'bignumber': {
      const list = items.length ? items : [{ value: v.value, text: v.label }];
      let from = 0;
      const html = list.map((item, k) => {
        const f = find(item.value || item.text, from); if (f) from = f.i + 1;
        const t = f ? Math.max(.1, f.t - .12) : .2 + k * Math.max(.6, speech / (list.length + 1));
        lines.push(`tl.fromTo('#ni${k}',{y:60,opacity:0},{y:0,opacity:1,duration:.45,ease:'power3.out'},${num(t)});`, countUp(`#nv${k} .n`, item.value, t, .9));
        hits.push(t + .9);
        return `<div class="num-item" id="ni${k}"><div class="num-value" id="nv${k}" style="color:${ACCENTS[(ctx.index + k + 1) % ACCENTS.length]}">${numberHtml(item.value)}</div><div class="num-text">${esc(item.text)}</div></div>`;
      }).join('');
      return { html: `<div class="center numbers ${land ? 'row' : ''}">${html}</div>`, lines, hits, ghost: list[0]?.value };
    }
    case 'quote': {
      const text = v.quote || v.heading || '';
      const qtokens = text.split(/\s+/).filter(Boolean);
      let from = 0;
      const times = qtokens.map((w, k) => { const f = find(w, from); if (f) { from = f.i + 1; return f.t; } return null; });
      const matched = times.filter(t => t !== null).length;
      const html = qtokens.map((w, k) => `<span class="qw" id="q${k}">${esc(w)}</span>`).join(' ');
      lines.push(`tl.fromTo('.quote-card',{y:110,opacity:0,rotation:-2},{y:0,opacity:1,rotation:0,duration:.6,ease:'power3.out'},.08);`);
      qtokens.forEach((w, k) => {
        const t = matched >= qtokens.length * .5 && times[k] !== null ? times[k] : .5 + (speech - .9) * k / Math.max(1, qtokens.length);
        lines.push(`tl.to('#q${k}',{opacity:1,color:'#ffffff',duration:.18},${num(t)});`);
      });
      lines.push(`tl.fromTo('.author',{opacity:0,y:20},{opacity:1,y:0,duration:.4},.55);`);
      return { html: `<div class="center"><div class="card quote-card"><div class="qmark">❝</div><p class="quote" style="font-size:${fitSize(text, land ? [[80, 60], [140, 52], [999, 44]] : [[70, 60], [130, 52], [999, 44]])}px">${html}</p><div class="author"><span class="avatar">${esc((v.author || '?').trim().charAt(0).toUpperCase())}</span><span><b>${esc(v.author)}</b>${v.source ? `<i>${esc(v.source)}</i>` : ''}</span></div></div></div>`, lines, hits, ghost: '❝' };
    }
    case 'list': {
      const h = v.heading ? headline(v.heading, 'lh', .1, .07) : { html: '', end: .2 };
      let from = 0;
      const timesL = items.map((item, k) => {
        const f = find(item.text || item.value, from); if (f) from = f.i + 1;
        return f ? Math.max(h.end - .2, f.t - .15) : Math.max(h.end, .3) + (speech - Math.max(h.end, .3)) * k / Math.max(1, items.length);
      });
      for (let k = 1; k < timesL.length; k++) if (timesL[k] < timesL[k - 1] + .25) timesL[k] = timesL[k - 1] + .25;
      items.forEach((_, k) => {
        lines.push(`tl.fromTo('#li${k}',{x:${land ? -110 : -90},opacity:0,filter:'blur(10px)'},{x:0,opacity:1,filter:'blur(0px)',duration:.45,ease:'power3.out'},${num(timesL[k])});`);
        lines.push(`tl.to('#li${k}',{borderColor:'${accent}',backgroundColor:'rgba(255,255,255,.1)',duration:.2},${num(timesL[k])});`);
        if (k + 1 < items.length) lines.push(`tl.to('#li${k}',{borderColor:'rgba(255,255,255,.09)',backgroundColor:'rgba(255,255,255,.04)',duration:.3},${num(timesL[k + 1])});`);
        hits.push(timesL[k] + .1);
      });
      return { html: `<div class="center list-wrap">${v.heading ? `<h2 class="list-head">${h.html}</h2>` : ''}<ol class="list">${items.map((item, k) => `<li class="li" id="li${k}"><span class="li-num">${String(k + 1).padStart(2, '0')}</span><span>${esc(item.text || item.value)}</span></li>`).join('')}</ol></div>`, lines, hits, ghost: String(items.length).padStart(2, '0') };
    }
    case 'cta': {
      const h = headline(v.heading, 'ch', .15, .1);
      const btn = v.button ? at(v.button, Math.max(h.end + .3, speech * .6)) : null;
      lines.push(`tl.fromTo('.burst i',{scaleX:0,opacity:0},{scaleX:1,opacity:1,duration:.8,ease:'power2.out',stagger:.025},.05);tl.to('.burst',{rotation:25,duration:${num(Math.max(1, speech + 1))},ease:'none'},0);`);
      if (v.subheading) lines.push(`tl.fromTo('.sub',{opacity:0,y:20},{opacity:1,y:0,duration:.4},${num(h.end)});`);
      if (btn) { lines.push(`tl.fromTo('.pill',{scale:.4,opacity:0},{scale:1,opacity:1,duration:.5,ease:'back.out(2.2)'},${num(btn.t)});tl.to('.pill',{scale:1.06,duration:.45,ease:'sine.inOut',yoyo:true,repeat:${Math.max(0, Math.floor((speech - btn.t) / .45))}},${num(btn.t + .5)});`); hits.push(btn.t + .2); }
      return { html: `<div class="burst">${Array.from({ length: 16 }, (_, k) => `<i style="transform:rotate(${(k * 360 / 16).toFixed(1)}deg)"></i>`).join('')}</div><div class="center"><h1 class="mega cta-head" style="font-size:${sizeHead(v.heading)}px">${h.html}</h1>${v.subheading ? `<p class="sub">${esc(v.subheading)}</p>` : ''}${v.button ? `<div class="pill">${esc(v.button)} →</div>` : ''}</div>`, lines, hits, ghost: null };
    }
    default: return templateParts({ ...v, type: 'statement' }, ctx);
  }
}

// Konuşmayla senkron kinetik altyazı (isteğe bağlı; caption-highlight kalıbı)
function captionLayer(words, land, accent) {
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

function baseCss(W, H, accent, second) {
  const land = W > H;
  return `html,body{margin:0;background:#06070d}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#f5f6fb;background:#06070d}
.clip{position:absolute;inset:0}
.blob{position:absolute;border-radius:50%;filter:blur(${land ? 150 : 140}px);opacity:.3}
.b1{width:${land ? 1100 : 1000}px;height:${land ? 1100 : 1000}px;background:${accent};left:${land ? -12 : -48}%;top:${land ? -30 : -14}%}
.b2{width:${land ? 900 : 860}px;height:${land ? 900 : 860}px;background:${second};right:${land ? -14 : -50}%;top:${land ? 40 : 58}%;opacity:.2}
.b3{width:700px;height:700px;background:#14205a;left:22%;bottom:-30%;opacity:.45}
.halo{position:absolute;left:50%;top:${land ? 50 : 42}%;width:${land ? 1100 : 1000}px;height:${land ? 700 : 900}px;transform:translate(-50%,-50%);background:radial-gradient(ellipse,${accent}33,transparent 62%)}
.grid{position:absolute;inset:-60px;background-image:radial-gradient(rgba(255,255,255,.08) 1.6px,transparent 1.7px);background-size:46px 46px;mask-image:radial-gradient(circle at 50% 45%,#000 25%,transparent 72%)}
.dust{position:absolute;width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 12px #fff}
.sweep{position:absolute;top:-30%;left:-60%;width:38%;height:160%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.11),transparent);transform:rotate(18deg);mix-blend-mode:screen}
.comet{position:absolute;height:5px;border-radius:5px;box-shadow:0 0 22px ${accent}}
.grain{position:absolute;inset:-50%;opacity:.045;background-image:radial-gradient(rgba(255,255,255,.9) .7px,transparent .8px),radial-gradient(rgba(0,0,0,.9) .7px,transparent .8px);background-size:5px 5px,7px 7px;background-position:0 0,2px 3px}
@keyframes grain{0%{transform:translate(0,0)}25%{transform:translate(-3%,2%)}50%{transform:translate(2%,-3%)}75%{transform:translate(-2%,-1%)}100%{transform:translate(1%,2%)}}
.vignette{position:absolute;inset:0;background:radial-gradient(circle at 50% 46%,transparent 40%,rgba(0,0,0,.62) 100%)}
.media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,7,13,.5),rgba(6,7,13,.74) 50%,rgba(6,7,13,.92))}
.ghost{position:absolute;left:50%;top:${land ? 50 : 44}%;font-weight:900;font-size:${land ? 520 : 460}px;line-height:1;white-space:nowrap;color:transparent;-webkit-text-stroke:3px rgba(255,255,255,.07);letter-spacing:-10px;transform:translate(-50%,-50%)}
.camera{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transform-origin:50% ${land ? 50 : 44}%}
.stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;${land ? '' : 'padding-bottom:12%;box-sizing:border-box;'}}
.center{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;width:${land ? 80 : 88}%;gap:30px}
.mega,.statement{line-height:1.02;font-weight:900;letter-spacing:-3px;margin:0;text-wrap:balance}
.statement{font-weight:800;letter-spacing:-2px;line-height:1.06}
.w{display:inline-block;will-change:transform,filter}
.mark-wrap{position:relative;display:inline-block}
#mark{position:absolute;left:-4%;right:-4%;bottom:6%;height:34%;background:linear-gradient(90deg,${accent},${second});transform-origin:0 50%;transform:scaleX(0);z-index:-1;border-radius:10px;opacity:.85}
.sub{font-size:${land ? 44 : 54}px;line-height:1.3;color:#cfd2ea;margin:0;font-weight:600;text-wrap:balance}
.ring-wrap{position:relative;width:540px;height:540px;display:flex;align-items:center;justify-content:center}
.ring{position:absolute;inset:0;transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:36;stroke-linecap:round}.ring .track{stroke:rgba(255,255,255,.08)}.ring .arc{stroke:${accent};filter:drop-shadow(0 0 22px ${accent})}
.ring-glow{position:absolute;inset:8%;border-radius:50%;background:radial-gradient(circle,${accent}55,transparent 65%);opacity:0}
.stat-value{font-weight:900;letter-spacing:-6px;line-height:1;text-shadow:0 0 40px ${accent}66}
.n{display:inline-block}.unit{font-size:.36em;letter-spacing:0;margin-left:.12em;opacity:.85;font-weight:800}
.stat-value{white-space:nowrap}
.stat-label{font-size:${land ? 54 : 62}px;font-weight:800;margin:0;line-height:1.18;text-wrap:balance}
.stat-source{font-size:32px;color:#9aa0bd;margin:0}
.numbers{gap:${land ? 90 : 80}px}.numbers.row{flex-direction:row}
.num-value{white-space:nowrap;font-size:${land ? 210 : 250}px;font-weight:900;line-height:1;letter-spacing:-6px}
.num-text{font-size:${land ? 46 : 54}px;color:#d4d7ee;margin-top:10px;font-weight:600}
.card{background:rgba(16,18,32,.82);border:1.5px solid rgba(255,255,255,.12);border-radius:44px;padding:${land ? '70px 80px' : '64px 60px'};box-shadow:0 40px 120px rgba(0,0,0,.5),0 0 0 1px ${accent}22;text-align:left;width:100%;box-sizing:border-box}
.qmark{font-size:140px;line-height:.7;color:${accent};height:80px}
.quote{line-height:1.25;font-weight:800;margin:28px 0 44px}
.qw{display:inline-block;color:rgba(255,255,255,.22)}
.author{display:flex;align-items:center;gap:24px;font-size:34px}.author b{display:block}.author i{display:block;font-style:normal;color:#9aa0bd;font-size:28px}
.avatar{width:84px;height:84px;border-radius:50%;background:${accent};color:#06070d;font-weight:900;font-size:40px;display:flex;align-items:center;justify-content:center;flex:none}
.list-wrap{align-items:flex-start;text-align:left}.list-head{font-size:${land ? 88 : 96}px;font-weight:900;margin:0 0 14px;letter-spacing:-2px;line-height:1.05}
.list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:24px;width:100%}
.li{display:flex;align-items:center;gap:30px;font-size:${land ? 50 : 58}px;font-weight:700;background:rgba(255,255,255,.04);border:2px solid rgba(255,255,255,.09);border-radius:30px;padding:28px 36px;opacity:0}
.li-num{font-size:36px;font-weight:900;color:${accent};min-width:70px}
.burst{position:absolute;left:50%;top:${land ? 50 : 44}%;width:0;height:0}.burst i{position:absolute;left:0;top:-3px;width:${land ? 1000 : 820}px;height:6px;transform-origin:0 50%;background:linear-gradient(90deg,transparent 30%,${accent}aa);border-radius:6px}
.pill{background:linear-gradient(90deg,${accent},${second});color:#06070d;font-weight:900;font-size:44px;padding:24px 56px;border-radius:999px;box-shadow:0 0 50px ${accent}99}
.captions{position:absolute;left:0;right:0;bottom:${land ? 9 : 17}%;height:0}
.cap-group{position:absolute;left:6%;right:6%;bottom:0;display:flex;flex-wrap:wrap;justify-content:center;gap:10px 14px;opacity:0}
.cap-w{position:relative;display:inline-block;padding:6px 16px 10px;font-size:${land ? 64 : 76}px;font-weight:900;letter-spacing:-1px;text-shadow:0 6px 24px rgba(0,0,0,.6)}
.cap-w b{position:relative;z-index:1}.cap-bg{position:absolute;inset:0;border-radius:14px;background:${accent};transform-origin:0 50%;transform:scaleX(0);opacity:0}
.progress{position:absolute;left:${land ? 6 : 8}%;right:${land ? 6 : 8}%;bottom:${land ? 4 : 5}%;display:flex;gap:10px}
.progress span{flex:1;height:7px;border-radius:7px;background:rgba(255,255,255,.14)}.progress span.on{background:var(--c)}
.progress span.now{background:rgba(255,255,255,.14);overflow:hidden;position:relative}.progress span.now:after{content:'';position:absolute;inset:0;background:var(--c);transform-origin:0 50%;transform:scaleX(var(--p,0))}
.wave{position:absolute;left:8%;right:8%;bottom:${land ? 10 : 11}%;height:${land ? 150 : 170}px;display:flex;align-items:flex-end;gap:8px}
.wave i{flex:1;height:100%;border-radius:8px;background:linear-gradient(0deg,${accent},${accent}55);transform-origin:50% 100%;transform:scaleY(.06)}
.audiogram{flex-direction:column;gap:46px}.ag-eyebrow{font-size:30px;letter-spacing:8px;color:${accent};font-weight:800}
.ag-title{font-size:${land ? 76 : 80}px;font-weight:900;line-height:1.08;margin:0;text-align:center;width:84%;text-wrap:balance}
.ag-wave{width:${land ? 74 : 84}%;height:${land ? 300 : 360}px;display:flex;align-items:center;gap:10px}
.ag-wave i{flex:1;height:100%;border-radius:10px;background:linear-gradient(180deg,${accent},${second}aa);transform:scaleY(.05)}
.flash{position:absolute;inset:0;background:radial-gradient(circle at 50% 45%,#fff,${accent}55 60%,transparent);opacity:0;mix-blend-mode:screen}
.free{position:absolute;inset:0;overflow:hidden}
.hero{position:absolute;border-radius:44px;overflow:hidden;box-shadow:0 40px 110px rgba(0,0,0,.55),0 0 0 1.5px rgba(255,255,255,.1)}
.hero-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-studio .hero-media{object-fit:contain;inset:5%;width:90%;height:90%}
.hero-cutout{overflow:visible;box-shadow:none;border-radius:0}
.hero-cutout .hero-media{object-fit:contain;filter:drop-shadow(0 46px 60px rgba(0,0,0,.65))}
.hero-glow{position:absolute;inset:10%;border-radius:50%;background:radial-gradient(circle,${accent}66,transparent 65%);filter:blur(30px)}
.hero-gloss{position:absolute;top:-20%;left:0;width:30%;height:140%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.28),transparent);transform:rotate(16deg);mix-blend-mode:screen;pointer-events:none}
.stage.with-hero{${land ? 'padding-left:46%;padding-bottom:0' : 'align-items:flex-start;padding-bottom:9%'};box-sizing:border-box}
.stage.with-hero .center{zoom:${land ? .74 : .78}}
.stage.with-hero .ring-wrap{width:420px;height:420px}`;
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
 *  scene {visual, html?}, index, total, duration (sn), speech (konuşma süresi),
 *  words [{text,start,end}] (sahne içi), format 'reels'|'podcast',
 *  media {kind, file}, waveMode 'none'|'wave'|'audiogram', envelope, title,
 *  captions (kinetik altyazıyı videoya işle)
 */
function buildSceneHtml(o) {
  const { scene, index = 0, total = 1, format = 'reels', media = null, waveMode = 'none', envelope = null, title = '', captions = false } = o;
  const hero = o.hero && o.hero.file && waveMode !== 'audiogram' && !scene.html ? o.hero : null;
  const duration = snap(o.duration);
  const D = duration, exitAt = Math.max(.3, D - .26);
  const words = Array.isArray(o.words) ? o.words.filter(w => w && Number.isFinite(w.start)) : [];
  const speech = Math.max(.5, Math.min(duration, o.speech || (words.length ? words[words.length - 1].end : duration - .4)));
  const W = format === 'podcast' ? 1920 : 1080, H = format === 'podcast' ? 1080 : 1920, land = W > H;
  const accent = ACCENTS[index % ACCENTS.length], second = SECOND[accent];
  const random = rng(index + 7);
  const find = makeFinder(words);
  const audiogram = waveMode === 'audiogram';
  let content = '', anim = [], hits = [], ghost = null;
  if (audiogram) {
    const v = scene.visual || {};
    const cap = captionLayer(words, land, accent);
    content = `<div class="center audiogram"><div class="ag-eyebrow">PODCAST</div><h1 class="ag-title">${esc(title)}</h1><div class="ag-wave">${'<i></i>'.repeat(land ? 48 : 36)}</div>${!words.length && (v.heading || v.quote) ? `<p class="sub">${esc(v.heading || v.quote)}</p>` : ''}</div>${cap.html}`;
    anim = [waveTimeline('.ag-wave i', envelope, land ? 48 : 36, 15, true), ...cap.lines];
  } else if (scene.html) {
    content = `<div class="free">${scene.html}</div>`;
  } else {
    const t = templateParts(scene.visual || {}, { land, words, speech, find, accent, index });
    content = t.html; anim = t.lines; hits = t.hits; ghost = t.ghost;
  }
  const capLayer = captions && !audiogram ? captionLayer(words, land, accent) : { html: '', lines: [] };
  // Kahraman görsel: şeffaf kesim kartsız ve gölgeli; düz zeminli stüdyo çekimi
  // kenar rengindeki kartta tamamen görünür; fotoğraf/video kartı doldurur.
  let heroHtml = '', heroBottom = 0;
  const heroLines = [];
  if (hero) {
    const mode = hero.cutout ? 'cutout' : hero.edge ? 'studio' : 'photo';
    const inner = hero.kind === 'video'
      ? `<video class="hero-media" id="heroMedia" src="${esc(hero.file)}" muted playsinline data-start="0" data-duration="${D}"></video>`
      : `<img class="hero-media" id="heroMedia" src="${esc(hero.file)}" alt="">`;
    const aspect = Math.min(2.2, Math.max(.62, (hero.w || 16) / (hero.h || 9)));
    let box;
    if (land) { const w = 845, h = Math.min(800, Math.max(420, w / aspect)); box = `left:5%;width:${w}px;top:${Math.round((H - h) / 2 - 20)}px;height:${Math.round(h)}px`; }
    else { const w = 930, h = Math.min(820, Math.max(400, w / aspect)); box = `left:75px;width:${w}px;top:110px;height:${Math.round(h)}px`; heroBottom = 110 + Math.round(h); }
    heroHtml = `<div class="hero hero-${mode}" id="hero" style="${box}${mode === 'studio' ? `;background:${hero.edge}` : ''}">${mode === 'cutout' ? '<div class="hero-glow"></div>' : ''}${inner}${mode === 'cutout' ? '' : '<i class="hero-gloss" id="heroGloss"></i>'}</div>`;
    heroLines.push(`tl.fromTo('#hero',{y:90,scale:.84,opacity:0,filter:'blur(18px)'},{y:0,scale:1,opacity:1,filter:'blur(0px)',duration:.7,ease:'back.out(1.4)'},.04);`);
    heroLines.push(`tl.to('#hero',{y:${land ? -14 : -18},rotation:${mode === 'cutout' ? 1.2 : .4},duration:${num(Math.max(1, D - .8))},ease:'sine.inOut'},.75);`);
    if (mode === 'photo') heroLines.push(`tl.fromTo('#heroMedia',{scale:1.14,xPercent:-2},{scale:1.02,xPercent:2,duration:${D},ease:'none'},0);`);
    else heroLines.push(`tl.fromTo('#heroMedia',{scale:1},{scale:1.05,duration:${D},ease:'sine.inOut'},0);`);
    if (mode === 'cutout') heroLines.push(`tl.fromTo('.hero-glow',{opacity:.4,scale:.9},{opacity:.9,scale:1.1,duration:${num(Math.max(1, D / 2))},ease:'sine.inOut',yoyo:true,repeat:1},0);`);
    else for (let k = 0; k < Math.max(1, Math.floor(D / 4)); k++) heroLines.push(`tl.fromTo('#heroGloss',{xPercent:-160},{xPercent:260,duration:1.1,ease:'power2.inOut',immediateRender:false},${num(.9 + k * 4)});`);
  }
  const mediaHtml = media?.file
    ? (media.kind === 'video'
      ? `<video class="media" id="bgmedia" src="${esc(media.file)}" muted playsinline data-start="0" data-duration="${duration}"></video>`
      : `<img class="media" id="bgmedia" src="${esc(media.file)}" alt="">`) + '<div class="shade"></div>'
    : '';
  const dust = Array.from({ length: 16 }, (_, k) => `<i class="dust" id="d${k}" style="left:${(random() * 100).toFixed(1)}%;top:${(20 + random() * 90).toFixed(1)}%;opacity:${(.15 + random() * .45).toFixed(2)};transform:scale(${(.4 + random() * .9).toFixed(2)})"></i>`).join('');
  const comets = [0, 1].map(k => `<i class="comet" id="cm${k}" style="width:${land ? 420 : 340}px;left:-35%;top:${(k ? 64 : 16) + random() * 10}%;transform:rotate(${k ? 16 : -22}deg);background:linear-gradient(90deg,transparent,${k ? second : accent})"></i>`).join('');
  const wave = waveMode === 'wave' && !audiogram ? `<div class="wave">${'<i></i>'.repeat(40)}</div>` : '';
  const progress = `<div class="progress" style="--c:${accent}">${Array.from({ length: Math.min(total, 24) }, (_, k) => `<span class="${k < index ? 'on' : k === index ? 'now' : ''}"${k === index ? ' id="pnow"' : ''}></span>`).join('')}</div>`;
  const lines = [
    // Sürekli zemin: renk lekeleri, toz, ışık süpürmesi, kuyruklu ışıklar
    `tl.fromTo('.b1',{x:-60,y:0,scale:1},{x:120,y:-80,scale:1.18,duration:${D},ease:'sine.inOut'},0);`,
    `tl.fromTo('.b2',{x:80,y:40,scale:1.1},{x:-140,y:-60,scale:.92,duration:${D},ease:'sine.inOut'},0);`,
    `tl.fromTo('.b3',{x:0,y:0},{x:160,y:-120,duration:${D},ease:'sine.inOut'},0);`,
    `tl.fromTo('.grid',{x:0,y:0},{x:-46,y:-46,duration:${D},ease:'none'},0);`,
    ...Array.from({ length: 16 }, (_, k) => `tl.fromTo('#d${k}',{y:0,x:0},{y:-${Math.round(120 + random() * 260)},x:${Math.round(random() * 80 - 40)},duration:${D},ease:'none'},0);`),
    ...Array.from({ length: Math.max(1, Math.floor(D / 3.2)) }, (_, k) => `tl.fromTo('.sweep',{x:0},{x:${land ? 3400 : 2300},duration:1.6,ease:'power1.inOut',immediateRender:false},${num(.8 + k * 3.2)});`),
    `tl.fromTo('#cm0',{x:0,y:0,opacity:0},{x:${land ? 3000 : 2000},y:${land ? 900 : 700},opacity:1,duration:1.9,ease:'power2.inOut'},.15);`,
    D > 3 ? `tl.fromTo('#cm1',{x:0,y:0,opacity:0},{x:${land ? 3000 : 2000},y:${land ? -600 : -500},opacity:1,duration:2.1,ease:'power2.inOut'},${num(Math.min(D - 2, D * .55))});` : '',
    media?.file ? `tl.fromTo('#bgmedia',{scale:1.14,x:-30},{scale:1.02,x:30,duration:${D},ease:'none'},0);` : '',
    envelope?.length ? `(function(){var e=${JSON.stringify(envelope)};for(var k=0;k<e.length;k+=2)tl.to('.halo',{opacity:.55+e[k]*.45,duration:.12},k/15);})();` : '',
    ghost && !hero ? `tl.fromTo('.ghost',{xPercent:-46,opacity:0},{xPercent:-54,opacity:1,duration:${D},ease:'none'},0);` : '',
    // Kamera: sürekli itiş + vurgu anlarında kısa sarsıntı
    `tl.fromTo('.camera',{scale:1,y:0,rotation:${land ? -.4 : -.6}},{scale:1.08,y:${land ? -14 : -24},rotation:${land ? .4 : .6},duration:${D},ease:'sine.inOut'},0);`,
    ...hits.filter(t => t > .2 && t < D - .4).slice(0, 6).map(t => `tl.to('.stage',{scale:1.035,duration:.07,ease:'power2.out'},${num(t)});tl.to('.stage',{scale:1,duration:.35,ease:'power2.out'},${num(t + .07)});tl.fromTo('.flash',{opacity:.16},{opacity:0,duration:.35},${num(t)});`),
    // Geçişler: flaşlı whip giriş, bulanık savrulma çıkış
    `tl.fromTo('.stage',{x:${land ? 220 : 160},filter:'blur(18px)'},{x:0,filter:'blur(0px)',duration:.38,ease:'power3.out'},0);`,
    `tl.fromTo('.flash',{opacity:.55},{opacity:0,duration:.32,ease:'power2.out'},0);`,
    `tl.fromTo('#pnow',{'--p':0},{'--p':1,duration:${D},ease:'none'},0);`,
    ...heroLines,
    ...anim,
    ...capLayer.lines,
    wave ? waveTimeline('.wave i', envelope, 40) : '',
    D > 1.2 ? `tl.to('.stage',{x:${land ? -260 : -190},filter:'blur(16px)',opacity:0,duration:.26,ease:'power2.in'},${num(exitAt)});tl.to('.captions',{opacity:0,duration:.2},${num(exitAt)});` : '',
    `tl.set({}, {}, ${D});`
  ].filter(Boolean);
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>Sahne ${index + 1}</title>
<style>${baseCss(W, H, accent, second)}</style></head>
<body>
<div id="root" data-composition-id="root" data-width="${W}" data-height="${H}" data-start="0" data-duration="${D}">
  <div class="clip bg" data-start="0" data-duration="${D}">${mediaHtml}<div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="halo"></div>${media?.file ? '' : '<div class="grid"></div>'}${dust}<div class="sweep"></div>${comets}${ghost && !hero ? `<div class="ghost">${esc(String(ghost).toLocaleUpperCase('tr').slice(0, 10))}</div>` : ''}<div class="vignette"></div><div class="grain"></div></div>
  <div class="clip camera" data-start="0" data-duration="${D}">${heroHtml}<div class="stage${hero ? ' with-hero' : ''}"${heroBottom ? ` style="padding-top:${heroBottom + 70}px"` : ''}>${content}</div></div>
  ${capLayer.html}${wave}${progress}<div class="flash"></div>
</div>
<script src="gsap.min.js"></script>
<script>
var tl = gsap.timeline({ paused: true });
${lines.join('\n')}
window.__timelines = window.__timelines || {}; window.__timelines["root"] = tl;
</script>
</body></html>
`;
}

module.exports = { FPS, ACCENTS, buildSceneHtml, envelopeFromPcm, snap, frames, esc, parseNumber, makeFinder, captionLayer };
