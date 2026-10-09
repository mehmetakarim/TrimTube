// Anlatımlı video: etiket dili, sağlayıcı çevirisi, senaryo doğrulama ve sahne
// kompozisyonu. --render ile gerçek HyperFrames hattı sahte TTS ile uçtan uca
// çalıştırılır (Electron'un Node'u ile: node scripts/test.cjs --integration).
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const V = require('../renderer/voice-script');
const C = require('../voice-compose');
const Beat = require('../beat-detect');
const T = require('../renderer/voice-themes');
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };

const SAMPLE = '[excited] Selam, hoş geldiniz! [laughs] Bugün harika bir konu var.\n\n[sighs] Biliyorum, yorucu. [pauses] Ama bakın.\n[whispering] Bir sır vereyim mi? [normal] Yazmama yardım et özelliği. [foo] son.';

check('Tag vocabulary follows provider capabilities', () => {
  const g = V.vocabulary('gemini'), e = V.vocabulary('eleven');
  assert.ok(g.tones.includes('empathetic') && !g.tones.includes('sarcastic'));
  assert.ok(e.tones.includes('sarcastic') && !e.tones.includes('empathetic') && !e.tones.includes('fast'));
  assert.deepEqual(g.events, e.events);
});
check('Tone tags switch mid-paragraph; unknown and unsupported tags are reported', () => {
  const g = V.parseNarration(SAMPLE, 'gemini');
  assert.deepEqual(g.segments.map(s => s.tone), ['excited', 'whispering', 'normal']);
  assert.deepEqual(g.unknown, ['foo']);
  const e = V.parseNarration('[empathetic] Seni anlıyorum. [fast] Hızlı.', 'eleven');
  assert.deepEqual(e.unsupported.sort(), ['empathetic', 'fast']);
  assert.equal(V.plainText('[empathetic] Seni anlıyorum.'), 'Seni anlıyorum.');
});
check('Gemini 3.x parts carry style metadata and angle-bracket vocalizations', () => {
  const parts = V.geminiParts(V.parseNarration(SAMPLE, 'gemini').segments);
  assert.equal(parts[0].speech_metadata.style, V.TONES.excited.gemini);
  assert.ok(parts[0].text.includes('<laugh>') && parts[0].text.includes('<sigh>') && parts[0].text.includes('<short pause>'));
  assert.equal(parts[1].speech_metadata.style, 'whispers');
  assert.ok(!parts[2].speech_metadata, 'normal tone has no style');
  assert.ok(parts.every(p => !/\[[a-z]/.test(p.text)), 'no square tags reach Gemini 3.x');
});
check('ElevenLabs text uses its own audio tags; pauses become ellipses', () => {
  const text = V.elevenText(V.parseNarration(SAMPLE, 'eleven').segments);
  assert.ok(text.startsWith('[excited] Selam'));
  assert.ok(text.includes('[laughs]') && text.includes('[sighs]') && text.includes('[whispers] Bir sır') && text.includes('…'));
  assert.ok(!text.includes('[foo]') && !text.includes('[normal]') && !text.includes('<'));
});
check('Legacy Gemini 2.x receives untagged text with a natural-language style', () => {
  assert.ok(V.isLegacyGeminiTts('gemini-2.5-flash-preview-tts') && !V.isLegacyGeminiTts('gemini-3.8-flash-tts'));
  const text = V.legacyGeminiText(V.parseNarration(SAMPLE, 'gemini').segments);
  assert.ok(/^Say \w/.test(text) && !/[[<]/.test(text));
});
check('Duration estimate is derived from spoken text only', () => {
  assert.equal(V.estimateSeconds('[excited] ' + 'a'.repeat(150)), 150 / V.CHARS_PER_SECOND);
});
check('Readable page text prefers article content and decodes entities', () => {
  const r = V.extractReadable('<html><head><title>Başlık &amp; Test</title><script>var x=1</script></head><body><nav>menü</nav><article><h1>Merhaba</h1><p>Bir &quot;iki&quot;&nbsp;üç &#304;stanbul.</p><ul><li>madde</li></ul></article><footer>alt</footer></body></html>');
  assert.equal(r.title, 'Başlık & Test');
  assert.ok(r.text.includes('Bir "iki" üç İstanbul.') && r.text.includes('• madde'));
  assert.ok(!r.text.includes('menü') && !r.text.includes('var x') && !r.text.includes('alt'));
});
check('Script normalization clamps fields, drops model HTML and keeps only valid director choices', () => {
  const data = { title: 'T', scenes: [{ narration: '[excited] Merhaba dünya.', visual: { type: 'nope', heading: 'x'.repeat(300), items: ['a', { value: '1234567890123456', text: 'b' }] }, keywords: 'k', html: '<div onclick="x">a</div>', direction: { variant: 'giant', hero: 'side', transition: 'teleport', emphasis: { word: 'dünya', style: 'neon' }, tone: 2 } }, { narration: '[normal]   ', visual: {} }] };
  const t = V.normalizeScript(data);
  assert.equal(t.scenes.length, 1); assert.equal(t.scenes[0].visual.type, 'statement');
  assert.equal(t.scenes[0].visual.heading.length, 90); assert.equal(t.scenes[0].visual.items[1].value.length, 12);
  assert.ok(!('html' in t.scenes[0]), 'model-written HTML never reaches the renderer');
  assert.deepEqual(t.scenes[0].direction, { hero: 'side', emphasis: { word: 'dünya', style: '' }, tone: 2 }, 'variant must fit the type; unknown transition/style dropped');
  assert.throws(() => V.normalizeScript({ scenes: [] }));
  assert.ok(t.scenes[0].id !== V.normalizeScript(data).scenes[0].id, 'scene ids are unique');
  const cmp = V.normalizeVisual({ type: 'comparison', left: { title: 'K1', items: ['a', 'b', 'c', 'd', 'e'] }, right: { title: 'K2', items: [{ text: 'x' }] } });
  assert.equal(cmp.left.items.length, 4); assert.deepEqual(cmp.right.items, ['x']);
  assert.equal(V.normalizeVisual({ type: 'specs', items: [{ text: 'Hacim', value: '350 × 350 × 350 mm' }] }).items[0].value, '350 × 350 × 350 mm');
});
check('Prompt carries provider vocabulary, format rules, director brief, theme and design note; no community branding', () => {
  const g = V.buildScriptPrompt({ source: 'kaynak metin', format: 'reels', provider: 'gemini' });
  assert.ok(g.includes('[empathetic]') && !g.includes('[sarcastic]') && g.includes('45-60') && !/stepperskip/i.test(g) && !g.includes('"html"'));
  assert.ok(g.includes('"comparison"') && g.includes('"specs"') && g.includes('"steps"') && g.includes('"direction"') && g.includes('vs | table'));
  const theme = T.byId([], 'editorial');
  const e = V.buildScriptPrompt({ source: 'kaynak', format: 'podcast', length: 'long', provider: 'eleven', fromUrl: true, theme, designNote: 'sakin olsun, rakamları vurgula' });
  assert.ok(e.includes('[sarcastic]') && !e.includes('[empathetic]') && e.includes('330-480') && e.includes('web sayfasından') && !e.includes('"html"'));
  assert.ok(e.includes(`"${theme.name}"`) && e.includes('rakamları vurgula'));
});
check('Themes: built-ins are distinct; custom themes are clamped, readable and offline-safe', () => {
  assert.deepEqual(T.BUILT_IN.map(t => t.id), ['neon', 'editorial', 'tech', 'warm']);
  assert.equal(new Set(T.BUILT_IN.map(t => t.colors.bg + t.fonts.display + t.background)).size, 4);
  for (const t of T.BUILT_IN) assert.deepEqual(T.normalizeTheme(t), { ...t, builtIn: false, label: t.label || '' }, t.id + ' is already normalized');
  const bad = T.normalizeTheme({ id: '../x', name: 'Y'.repeat(80), colors: { bg: '#ffffff', ink: '#fefefe', muted: '#fafafa', accents: ['#F9B233', 'red', 'url(x)'] }, fonts: { display: 'Comic Sans; @import', body: 'Inter' }, motifs: ['tape', 'tape', 'evil', 'arrows'], logo: { file: '../../secret.png' }, radius: 999 });
  assert.ok(/^custom-[a-z0-9]+$/.test(bad.id) && bad.name.length === 40);
  assert.ok(T.contrast(bad.colors.bg, bad.colors.ink) >= 4.5 && T.contrast(bad.colors.bg, bad.colors.muted) >= 3, 'unreadable text colors are corrected');
  assert.deepEqual(bad.colors.accents, ['#f9b233']); assert.equal(bad.fonts.display, T.BUILT_IN[0].fonts.display);
  assert.deepEqual(bad.motifs, ['tape', 'arrows']); assert.equal(bad.logo, null); assert.equal(bad.radius, 60);
  const p = T.buildThemePrompt('Renk sistemi sabit: #F9B233 sarı, kömür siyahı; analog kolaj, maskeleme bandı', { hasReference: true });
  assert.ok(p.includes('#F9B233') && p.includes('ekteki örnek görsel') && T.FONTS.every(f => p.includes(f)) && T.MOTIFS.every(m => p.includes(m)));
});
check('Director and theme drive the composition: variants, emphasis, hero placement, transitions, logo', () => {
  const ed = T.byId([], 'editorial'), tech = T.byId([], 'tech');
  const cmp = C.buildScene({ scene: { visual: V.normalizeVisual({ type: 'comparison', left: { title: 'K1', items: ['Hızlı'] }, right: { title: 'K2', items: ['Renkli'] } }), direction: { variant: 'vs', transition: 'cut' } }, duration: 3, theme: ed });
  assert.equal(cmp.transition, 'cut'); assert.ok(cmp.html.includes('compare-vs') && cmp.html.includes('side-A') && cmp.html.includes('side-B'));
  assert.ok(cmp.html.includes('Fraunces') && cmp.html.includes('paper-tex') && !/https?:\/\//.test(cmp.html), 'theme fonts by family name, textures inline');
  const title = C.buildSceneHtml({ scene: { visual: { type: 'title', heading: 'K1 mi K2 mi' }, direction: { emphasis: { word: 'K2', style: 'circle' } } }, duration: 3, theme: ed });
  assert.ok(title.includes('ink-circle') && title.includes('mark-wrap'));
  assert.equal(C.buildScene({ scene: { visual: { type: 'title', heading: 'x' } }, duration: 2, theme: tech }).transition, tech.transition, 'theme default transition');
  const hero = { kind: 'image', file: 'media/a.png', w: 1920, h: 1080 };
  const none = C.buildSceneHtml({ scene: { visual: { type: 'title', heading: 'x' }, direction: { hero: 'none' } }, duration: 3, hero });
  assert.ok(!none.includes('id="hero"'), 'hero none hides the picture');
  const bg = C.buildSceneHtml({ scene: { visual: { type: 'title', heading: 'x' }, direction: { hero: 'background' } }, duration: 3, hero });
  assert.ok(bg.includes('id="hero"') && bg !== C.buildSceneHtml({ scene: { visual: { type: 'title', heading: 'x' } }, duration: 3, hero }));
  const branded = { ...ed, logo: { file: 'logo-1.png', position: 'bottom-left', size: 120 } };
  const logo = C.buildSceneHtml({ scene: { visual: { type: 'cta', heading: 'Son' } }, duration: 3, theme: branded, logo: 'media/logo-1.png' });
  assert.ok(logo.includes('<img class="logo" id="logo" src="media/logo-1.png"') && logo.includes('left:70px;bottom:520px') && logo.includes('height:110px'), 'logo stays inside the Reels safe area');
  assert.ok(!C.buildSceneHtml({ scene: { visual: { type: 'cta', heading: 'Son' } }, duration: 3, theme: ed, logo: 'media/x.png' }).includes('class="logo"'), 'no logo without a theme logo');
  for (const theme of T.BUILT_IN) for (const type of V.VISUAL_TYPES) for (const variant of V.VARIANTS[type]) {
    const html = C.buildSceneHtml({ scene: { visual: V.normalizeVisual({ type, heading: 'Başlık', value: '%45', label: 'L', quote: 'Q', items: [{ value: '1', text: 't' }, { value: '2', text: 'u' }], left: { title: 'A', items: ['a'] }, right: { title: 'B', items: ['b'] } }), direction: { variant } }, duration: 2, format: 'reels', theme });
    assert.ok(html.includes('data-width="1080"') && html.includes('window.__timelines["root"]'), `${theme.id}/${type}/${variant}`);
  }
});
check('Caption cues stay inside their scene and in order', () => {
  const cues = V.estimateCues([{ narration: '[excited] Birinci cümle burada. İkinci cümle biraz daha uzun olabilir mi acaba?', start: 0, duration: 5, speech: 4.6 }, { narration: 'Son.', start: 5, duration: 2, speech: 1 }]);
  assert.ok(cues.length >= 3);
  for (let i = 0; i < cues.length; i++) { assert.ok(cues[i].end > cues[i].start); if (i) assert.ok(cues[i].start >= cues[i - 1].end - 1e-6); }
  assert.ok(cues.filter(c => c.start < 5).every(c => c.end <= 5));
  assert.ok(V.captionLines('a '.repeat(60)).every(l => l.length <= 42));
});
check('Scene composition escapes text, snaps duration to frames and registers a timeline', () => {
  const html = C.buildSceneHtml({ scene: { visual: { type: 'title', heading: '<img src=x onerror=alert(1)> Başlık', subheading: 'a & b' } }, index: 1, total: 3, duration: 2.01, format: 'reels' });
  assert.ok(!html.includes('<img src=x') && html.includes('&lt;img'));
  assert.ok(html.includes('data-duration="2"') && html.includes('data-width="1080"') && html.includes('data-height="1920"'));
  assert.ok(html.includes('window.__timelines["root"] = tl') && html.includes('<script src="gsap.min.js">'));
  assert.ok(!/https?:\/\//.test(html), 'composition is offline');
  assert.equal(C.snap(1.0), 1); assert.equal(C.frames(1 / 30 * 7.4), 7);
});
check('Every scene type, wave, audiogram and media produce valid compositions', () => {
  const env = Array.from({ length: 30 }, (_, k) => k % 2 ? .8 : .2);
  for (const type of V.VISUAL_TYPES) {
    const html = C.buildSceneHtml({ scene: { visual: V.normalizeVisual({ type, heading: 'H', value: '%45', label: 'L', quote: 'Q', author: 'A', items: [{ value: '1', text: 't' }] }) }, duration: 2, format: 'podcast' });
    assert.ok(html.includes('data-width="1920"'), type);
  }
  const wave = C.buildSceneHtml({ scene: { visual: { type: 'title', heading: 'x' } }, duration: 2, format: 'podcast', waveMode: 'wave', envelope: env });
  assert.ok(wave.includes('class="wave"') && wave.includes('tl.set(bars'));
  const ag = C.buildSceneHtml({ scene: { visual: { type: 'quote', quote: 'söz' } }, duration: 2, format: 'podcast', waveMode: 'audiogram', envelope: env, title: 'Bölüm' });
  assert.ok(ag.includes('ag-wave') && ag.includes('Bölüm') && ag.includes('söz'));
  const media = C.buildSceneHtml({ scene: { visual: { type: 'title', heading: 'x' } }, duration: 3, media: { kind: 'video', file: 'media/v1.mp4' } });
  assert.ok(media.includes('<video class="media"') && media.includes('muted') && media.includes('data-duration="3"'));
});
check('Audio envelope is normalized to 0..1 at 15 samples per second', () => {
  const rate = 48000, buf = Buffer.alloc(rate * 2 * 2);
  for (let i = 0; i < rate * 2; i++) buf.writeInt16LE(Math.round(Math.sin(i / 20) * (i < rate ? 3000 : 20000)), i * 2);
  const env = C.envelopeFromPcm(buf, rate);
  assert.equal(env.length, 30); assert.ok(env.every(v => v >= 0 && v <= 1)); assert.ok(env[25] > env[5] * 3);
});

check('Measured word times are aligned to the approved script text, gaps interpolated', () => {
  const words = V.alignTimings('[excited] Creality K1 mi yoksa K2 mi? Farklara bakalım.', [{ word: 'Kreality', start: 0, end: .5 }, { word: 'K1', start: .6, end: .9 }, { word: 'mi', start: .9, end: 1 }, { word: 'yoksa', start: 1.1, end: 1.5 }, { word: 'K2', start: 1.6, end: 1.9 }, { word: 'mi?', start: 1.9, end: 2 }, { word: 'bakalım.', start: 3, end: 3.5 }], 3.6);
  assert.deepEqual(words.map(w => w.text), ['Creality', 'K1', 'mi', 'yoksa', 'K2', 'mi?', 'Farklara', 'bakalım.']);
  assert.equal(words[1].start, .6); assert.ok(words[6].start >= 2 && words[6].end <= 3);
  for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].start);
  const est = V.estimateTimings('Bir iki. Üç', 3); assert.equal(est.length, 3); assert.ok(est[2].end <= 3);
  const cues = V.cuesFromTimings([{ start: 10, words }]); assert.ok(cues[0].start >= 10 && cues.every(c => c.end > c.start));
});
check('Numbers count up with units kept small and synced to the spoken word', () => {
  assert.deepEqual(C.parseNumber('600 mm/s'), { prefix: '', value: 600, decimals: 0, suffix: ' mm/s' });
  assert.equal(C.parseNumber('1.250.000 TL').value, 1250000); assert.equal(C.parseNumber('2,5x').decimals, 1);
  const html = C.buildSceneHtml({ scene: { visual: { type: 'stat', value: '600 mm/s', label: 'Hız' } }, duration: 4, speech: 3.5, words: [{ text: 'Saniyede', start: .2, end: .7 }, { text: '600', start: 1.5, end: 1.9 }, { text: 'milimetre', start: 1.9, end: 2.4 }] });
  assert.ok(html.includes('<span class="unit">mm/s</span>') && html.includes("tl.set('#statValue .n',{textContent:r[k]},1.38+k/30)"));
  const title = C.buildSceneHtml({ scene: { visual: { type: 'title', heading: 'K1 vs K2' } }, duration: 6, speech: 5.5, words: [{ text: 'Creality', start: 2.6, end: 3.3 }, { text: 'K1', start: 3.34, end: 3.9 }] });
  assert.ok(title.includes("tl.fromTo('#h0',{y:80") && title.includes("color:'#8b7bff',duration:.1,ease:'power2.out'},3.34)"), 'title enters at once and pops when spoken');
});

check('Page images: og image, article images, lazy and srcset sources; logos, icons and tiny images skipped', () => {
  const html = '<html><head><meta property="og:image" content="https://cdn.x.com/k2-hero.jpg"></head><body><header><img src="/logo.png"></header><article><img src="/img/k1.png" alt="Creality K1" width="800"><img data-src="/img/k2.webp" alt="K2 Plus"><img src="/i/tiny.png" width="40"><img srcset="/a-400.jpg 400w, /a-1200.jpg 1200w" alt="CFS"><img src="/icons/cart-icon.png"><img src="data:image/png;base64,xx"><img src="/x.svg"></article></body></html>';
  const images = V.extractImages(html, 'https://shop.example.com/urun/k1');
  assert.deepEqual(images.map(i => i.url), ['https://cdn.x.com/k2-hero.jpg', 'https://shop.example.com/img/k1.png', 'https://shop.example.com/img/k2.webp', 'https://shop.example.com/a-1200.jpg']);
  assert.equal(images[1].alt, 'Creality K1');
  const prompt = V.buildScriptPrompt({ source: 'x', images });
  assert.ok(prompt.includes('SAYFA GÖRSELLERİ') && prompt.includes('[1] Creality K1') && prompt.includes('"image"'));
  const script = V.normalizeScript({ scenes: [{ narration: 'Bir', image: 1 }, { narration: 'İki', image: 9 }, { narration: 'Üç', media: { source: 'page', url: 'javascript:alert(1)' } }] }, { images });
  assert.equal(script.scenes[0].media.url, 'https://shop.example.com/img/k1.png');
  assert.ok(!script.scenes[1].media && !script.scenes[2].media, 'out-of-range or unsafe picks are dropped');
  assert.equal(V.normalizeMedia({ source: 'local', path: 'C:/x/a.exe' }), null);
  assert.equal(V.normalizeMedia({ source: 'local', kind: 'video', path: 'C:/x/a.mp4' }).kind, 'video');
});
check('Hero media: uncropped 16:9 photo frame with blurred fill, studio and cutout treatments; text starts below', () => {
  const base = { scene: { visual: { type: 'title', heading: 'K1 vs K2' } }, duration: 4, speech: 3 };
  const wide = C.buildSceneHtml({ ...base, hero: { kind: 'image', file: 'media/a.png', w: 1920, h: 1080 } });
  assert.ok(wide.includes('class="hero hero-photo"') && wide.includes('class="hero-slot" style="width:840px;height:473px"'), 'safe-area wide 16:9 card');
  assert.ok(/<div class="fit" id="fit"><div class="hero-slot"[^]*?<div class="center/.test(wide), 'picture and text share one vertically centered stack');
  assert.ok(C.buildSceneHtml({ ...base, safeArea: false, hero: { kind: 'image', file: 'media/a.png', w: 1920, h: 1080 } }).includes('width:960px;height:540px'));
  assert.ok(wide.includes('class="hero-fill"') && /.hero-media{[^}]*object-fit:contain/.test(wide), 'photo is never cropped: contain over a blurred fill');
  const square = C.buildSceneHtml({ ...base, hero: { kind: 'image', file: 'media/s.png', w: 1000, h: 1000 } });
  assert.ok(square.includes('height:473px'), 'every photo uses the standard 16:9 frame');
  const studio = C.buildSceneHtml({ ...base, hero: { kind: 'image', file: 'media/b.png', w: 1000, h: 1000, edge: '#ffffff' } });
  assert.ok(studio.includes('hero-studio') && studio.includes('background:#ffffff'));
  const cut = C.buildSceneHtml({ ...base, hero: { kind: 'image', file: 'media/c.png', w: 800, h: 1000, cutout: true } });
  assert.ok(cut.includes('hero-cutout') && cut.includes('hero-glow') && !cut.includes('class="ghost"'));
  const vid = C.buildSceneHtml({ ...base, format: 'podcast', hero: { kind: 'video', file: 'media/v.mp4', w: 1920, h: 1080 } });
  assert.ok(vid.includes('<video class="hero-media"') && vid.includes('muted') && vid.includes('padding-left:46%'));
  const audiogram = C.buildSceneHtml({ ...base, format: 'podcast', waveMode: 'audiogram', hero: { kind: 'image', file: 'media/a.png', w: 10, h: 10 } });
  assert.ok(!audiogram.includes('id="hero"'), 'audiogram keeps its own layout');
});

check('Reels safe area: content, captions, progress and logo avoid platform UI; overflow shrinks to fit', () => {
  const words = [{ text: 'Selam', start: .2, end: .6 }];
  const html = C.buildSceneHtml({ scene: { visual: { type: 'title', heading: 'Başlık' } }, duration: 3, words, captions: true });
  assert.ok(html.includes('.stage{inset:auto;left:70px;right:170px;top:230px;bottom:750px;padding:0}'), 'captions reserve their own band above the bottom UI');
  assert.ok(html.includes('.captions{bottom:520px}') && html.includes('.progress{left:70px;right:170px;bottom:488px}'));
  assert.ok(html.includes("document.getElementById('fit')") && html.includes('document.fonts.ready.then(fit)'));
  const off = C.buildSceneHtml({ scene: { visual: { type: 'title', heading: 'Başlık' } }, duration: 3, safeArea: false });
  assert.ok(!off.includes('.stage{inset:auto') && !C.buildSceneHtml({ scene: { visual: { type: 'title', heading: 'x' } }, duration: 3, format: 'podcast' }).includes('.stage{inset:auto'), 'opt-out and 16:9 keep the full frame');
});
check('Frames never sit empty: structure enters in the first second, spoken items light up later', () => {
  const late = [{ text: 'şimdi', start: .2, end: .5 }, { text: 'K1', start: 4, end: 4.3 }, { text: 'hızlı', start: 4.5, end: 4.8 }, { text: 'K2', start: 6, end: 6.3 }, { text: 'renkli', start: 6.5, end: 6.9 }];
  const cmp = C.buildSceneHtml({ scene: { visual: V.normalizeVisual({ type: 'comparison', left: { title: 'K1', items: ['hızlı'] }, right: { title: 'K2', items: ['renkli'] } }) }, duration: 8, speech: 7, words: late });
  assert.ok(/tl\.fromTo\('#sideA',[^;]*\},0\.15\)/.test(cmp) && /tl\.fromTo\('#sideB',[^;]*\},0\.45\)/.test(cmp), 'both cards are on screen within half a second');
  assert.ok(/tl\.fromTo\('#sideB',\{scale:1\},\{scale:1\.045[^;]*\},5\.88\)/.test(cmp), 'the card pulses when it is named');
  assert.ok(/tl\.fromTo\('#cA0',\{opacity:0,y:16\},\{opacity:0\.34/.test(cmp) && /tl\.to\('#cA0',\{opacity:1[^;]*\},4\.3/.test(cmp), 'items wait dimmed, then light up on cue');
  const stat = C.buildSceneHtml({ scene: { visual: { type: 'stat', value: '%25', label: 'Fire oranı' } }, duration: 6, speech: 5, words: [{ text: 'fire', start: .3, end: .6 }, { text: 'yüzde', start: 3, end: 3.3 }, { text: '25', start: 3.3, end: 3.6 }] });
  assert.ok(/tl\.fromTo\('#statValue',\{opacity:0[^;]*\},0\.3\)/.test(stat) && /tl\.fromTo\('\.stat-label',[^;]*\},1\.1\)/.test(stat), 'value box and label appear early; the count waits for the spoken number');
});

check('Sound effect cues follow spoken highlights, spaced and capped per scene', () => {
  const words = [{ text: '600', start: .5, end: .9 }, { text: 'bir', start: 1, end: 1.2 }, { text: 'iki', start: 1.3, end: 1.5 }, { text: 'üç', start: 1.6, end: 1.8 }];
  const r = C.buildScene({ scene: { visual: { type: 'list', heading: 'Liste', items: [{ text: 'bir' }, { text: 'iki' }, { text: 'üç' }, { text: 'dört' }, { text: 'beş' }] } }, duration: 6, speech: 5, words });
  assert.ok(r.html.startsWith('<!doctype html>') && r.sfx.length >= 1 && r.sfx.length <= 4);
  for (let i = 1; i < r.sfx.length; i++) assert.ok(r.sfx[i].t - r.sfx[i - 1].t >= .7);
  assert.ok(r.sfx.every(e => e.kind === 'pop' && e.t > .35 && e.t < 5.5));
  assert.equal(C.buildSceneHtml({ scene: { visual: { type: 'title', heading: 'x' } }, duration: 2 }), C.buildScene({ scene: { visual: { type: 'title', heading: 'x' } }, duration: 2 }).html);
});

check('Beat detection finds tempo and phase of a steady track and rejects arrhythmic audio', () => {
  const rate = 11025, seconds = 16, pcm = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i++) {
    const t = i / rate, ph = (t - .1 + 10) % .5; // 120 BPM, ilk vuruş 0,1 sn
    pcm.writeInt16LE(Math.round(26000 * Math.sin(2 * Math.PI * 70 * t) * Math.exp(-28 * ph)), i * 2);
  }
  const r = Beat.detectBeats(pcm, rate);
  assert.ok(Math.abs(r.bpm - 120) < 1.5, 'bpm ' + r.bpm);
  assert.ok(r.beats.every(b => { const d = (b - .1) % .5; return Math.min(d, .5 - d) < .03; }), 'phase');
  const tiled = Beat.tileBeats({ beats: [0, .5, 1, 1.5] }, 2, 5);
  assert.deepEqual(tiled, [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]);
  const noise = Buffer.alloc(rate * 8 * 2); let seed = 7;
  for (let i = 0; i < rate * 8; i++) { seed = (seed * 1103515245 + 12345) % 2147483648; noise.writeInt16LE(Math.round((seed / 2147483648 - .5) * 4000), i * 2); }
  const n = Beat.detectBeats(noise, rate);
  assert.ok(!n || n.confidence < .25, 'noise must not be treated as rhythmic');
  assert.ok(r.confidence >= .25, 'steady track is confidently rhythmic');
});

async function renderPipeline() {
  const handlers = {};
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trimtube-vv-'));
  const sine = seconds => {
    const rate = 24000, n = Math.round(rate * seconds), pcm = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / rate) * 8000 * (0.5 + 0.5 * Math.sin(i / 3000))), i * 2);
    const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([h, pcm]).toString('base64');
  };
  const bodies = [];
  const providerClient = { async generate({ kind, body }) {
    assert.equal(kind, 'tts');
    const request = typeof body === 'function' ? body('gemini-3.8-flash-tts') : body; bodies.push(request);
    const text = request.contents[0].parts.map(p => p.text).join(' ');
    return { audio: { mimeType: 'audio/wav', data: sine(Math.max(0.8, text.length / 25)) }, model: 'gemini-3.8-flash-tts' };
  } };
  require('../voice-video').register({
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, app: { getPath: () => root }, getWin: () => null,
    loadSettings: () => ({ geminiKey: 'x', geminiTtsChain: '' }), providerClient, ffmpeg: require('ffmpeg-static'), procEnv: process.env,
    uniquePath: p => { let c = p, i = 2; while (fs.existsSync(c)) c = p.replace(/\.mp4$/, `-${i++}.mp4`); return c; }, sanitizeName: n => n.replace(/[\\/:*?"<>|]/g, '')
  });
  // Tema deposu: kayıt, listeleme, hazır tema kimliğiyle çakışma, silme
  const saved = await handlers['vv-theme-save']({}, { id: 'tech', name: 'Benim temam', colors: { bg: '#111111', accents: ['#F9B233'] }, logo: { file: 'yok.png' } });
  assert.ok(saved.ok && saved.theme.id !== 'tech' && saved.theme.logo === null, 'built-in ids are never overwritten; missing logos dropped');
  const listed = await handlers['vv-themes']({});
  assert.equal(listed.builtIn.length, 4); assert.deepEqual(listed.custom.map(t => t.name), ['Benim temam']);
  assert.ok((await handlers['vv-theme-delete']({}, saved.theme.id)).ok && !(await handlers['vv-themes']({})).custom.length);
  const scenes = [
    { id: 'a1', narration: '[excited] Birinci sahne. [laughs] Harika!', visual: { type: 'title', heading: 'Birinci' } },
    { id: 'b2', narration: '[whispering] İkinci sahne fısıltıyla.', visual: { type: 'stat', value: '%45', label: 'oran' } },
    { id: 'c3', narration: 'Üçüncü ve son sahne.', visual: { type: 'cta', heading: 'Son', button: 'Yaz' } }
  ];
  const job = { projectId: 'vv-test-001', title: 'Test videosu', format: 'reels', provider: 'gemini', voice: 'Kore', themeId: 'tech', waveMode: 'none', mediaMode: 'off', scenes, outDir: root };
  const first = await handlers['vv-produce']({}, job);
  assert.ok(first.ok, first.error);
  assert.equal(first.rendered, 3);
  assert.ok(bodies[0].contents[0].parts[0].speech_metadata.style.includes('excited') && bodies[0].contents[0].parts[0].text.includes('<laugh>'));
  const lastScene = first.scenes.at(-1);
  assert.ok(Math.floor(first.duration) >= lastScene.start + lastScene.speech, 'whole-second desk duration never cuts speech');
  first.scenes.forEach((s, i) => { if (i) assert.ok(Math.abs(s.start - first.scenes[i - 1].end) < 1e-3); });
  const probe = require('child_process').spawnSync(require('ffmpeg-static'), ['-i', first.outFile], { encoding: 'utf8' }).stderr;
  const m = probe.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  assert.ok(m && Math.abs(+m[2] * 60 + +m[3] - first.duration) < 0.08, 'container duration matches plan: ' + (m && m[0]));
  assert.ok(/Video: h264.*1080x1920/.test(probe) && /Audio: aac/.test(probe));
  // Yalnız değişen sahne yeniden üretilir
  const second = await handlers['vv-produce']({}, { ...job, scenes: scenes.map((s, i) => i === 1 ? { ...s, narration: '[whispering] İkinci sahne değişti, biraz daha uzun.' } : s) });
  assert.ok(second.ok, second.error);
  assert.equal(second.rendered, 1, 'only the edited scene is re-rendered');
  assert.equal(bodies.length, 4, 'only the edited scene is re-voiced');
  assert.notEqual(second.outFile, first.outFile);
  // Müzik + efekt: sahneler yeniden render edilmez, ses karışımı stereo ve uyarısız
  const music = path.join(root, 'music.wav');
  require('child_process').spawnSync(require('ffmpeg-static'), ['-y', '-f', 'lavfi', '-i', "aevalsrc='0.7*sin(2*PI*70*t)*exp(-28*mod(t,0.5))+0.15*sin(2*PI*440*t)':s=44100:d=12", '-ac', '2', music], { windowsHide: true });
  const third = await handlers['vv-produce']({}, { ...job, scenes: scenes.map((s, i) => i === 1 ? { ...s, narration: '[whispering] İkinci sahne değişti, biraz daha uzun.' } : s), sfx: true, music: { path: music, name: 'music.wav', level: .3 } });
  assert.ok(third.ok, third.error); // Whisper (faster-whisper) olmayan ortamda (CI) tahmini zaman uyarısı beklenen davranıştır
  const unexpected = third.warnings.filter(w => !w.startsWith('Kelime zamanları tahmini kullanıldı'));
  assert.deepEqual(unexpected, [], JSON.stringify(third.warnings));
  assert.ok(Math.abs(third.bpm - 120) < 2, 'music tempo ' + third.bpm);
  third.scenes.slice(1).forEach(sc => { const d = sc.start % .5; assert.ok(Math.min(d, .5 - d) < .045, 'scene starts on a beat: ' + sc.start); });
  const probe3 = require('child_process').spawnSync(require('ffmpeg-static'), ['-i', third.outFile], { encoding: 'utf8' }).stderr;
  assert.ok(/Audio: aac.*stereo/.test(probe3), 'music mix is stereo');
  const missing = await handlers['vv-produce']({}, { ...job, music: { path: path.join(root, 'yok.mp3'), name: 'yok.mp3' } });
  assert.ok(missing.ok && missing.warnings.some(w => w.includes('Müzik dosyası bulunamadı')));
  fs.rmSync(root, { recursive: true, force: true });
  checks.push('Theme store and full pipeline: scene TTS, HyperFrames render, lossless join, per-scene cache, SFX and ducked music');
}

(async () => {
  if (process.argv.includes('--render')) await renderPipeline();
  const out = JSON.stringify({ checks }, null, 2);
  if (process.argv.includes('--report')) { fs.mkdirSync('build/voice-video-qa', { recursive: true }); fs.writeFileSync('build/voice-video-qa/results.json', out); }
  console.log(out);
})().catch(err => {
  console.error(err);
  if (process.argv.includes('--report')) { fs.mkdirSync('build/voice-video-qa', { recursive: true }); fs.writeFileSync('build/voice-video-qa/results.json', JSON.stringify({ checks, failure: String(err.stack || err) })); }
  process.exitCode = 1;
});
