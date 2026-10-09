// Anlatımlı video: görsel temalar. Tema, motorun her sahneyi nasıl çizeceğini
// belirleyen tasarım dilidir (renkler, yazı tipleri, zemin, kart, görsel
// çerçevesi, dekor motifleri, hareket enerjisi, geçiş, logo). Gemini HTML
// yazmaz; hem hazır hem kullanıcı temaları bu şemaya uyar ve doğrulanır.
// Hem ana süreç hem arayüz kullanır (UMD; Electron'a bağlı değildir).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoiceThemes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  // HyperFrames derleyicisi yazı tiplerini adıyla Google Fonts'tan bir kez çekip önbelleğe alır
  const FONTS = ['Inter', 'Manrope', 'Montserrat', 'Poppins', 'Space Grotesk', 'Archivo Black', 'Anton', 'Bebas Neue', 'Oswald',
    'Fraunces', 'Playfair Display', 'DM Serif Display', 'Nunito', 'JetBrains Mono', 'IBM Plex Mono', 'Caveat', 'Permanent Marker'];
  const BACKGROUNDS = ['glow', 'paper', 'grid', 'soft'];
  const CARDS = ['glass', 'paper', 'solid', 'outline'];
  const FRAMES = ['card', 'tape', 'polaroid', 'hud', 'soft'];
  const MOTIFS = ['dust', 'comets', 'sweep', 'blobs', 'dots', 'tape', 'arrows', 'scribble', 'halftone', 'registration', 'torn', 'hud', 'scanline', 'grain'];
  const ENERGY = ['calm', 'normal', 'punchy'];
  const TRANSITIONS = ['whip', 'zoom', 'slide', 'flash', 'cut'];
  const EMPHASIS = ['marker', 'underline', 'circle', 'color', 'box'];

  const BUILT_IN = [
    {
      id: 'neon', name: 'Neon Gece', builtIn: true, description: 'Koyu zemin, canlı neon vurgular, ışık izleri ve toz. Teknoloji ve ürün tanıtımları için enerjik.',
      colors: { bg: '#06070d', bg2: '#14205a', ink: '#f5f6fb', muted: '#c9cbe0', card: '#101220', accents: ['#8b7bff', '#4da3ff', '#2fd39a', '#ffb547', '#ff6b8b', '#36d6e7'] },
      fonts: { display: 'Inter', body: 'Inter', label: 'Inter' }, type: { weight: 900, case: 'normal', tracking: -3 },
      background: 'glow', card: 'glass', frame: 'card', radius: 44, motifs: ['blobs', 'dust', 'comets', 'sweep', 'dots', 'grain'],
      energy: 'punchy', transition: 'whip', emphasis: ['marker', 'color'], logo: null
    },
    {
      id: 'editorial', name: 'Editoryal', builtIn: true, description: 'Açık kâğıt zemin, güçlü serif başlıklar, sakin ve okunaklı. Dergi/blog havası.',
      colors: { bg: '#f4f0e8', bg2: '#e8e1d3', ink: '#141414', muted: '#4a4741', card: '#ffffff', accents: ['#d93a2b', '#1f4fd1', '#141414'] },
      fonts: { display: 'Fraunces', body: 'Inter', label: 'IBM Plex Mono' }, type: { weight: 800, case: 'normal', tracking: -2 },
      background: 'paper', card: 'paper', frame: 'polaroid', radius: 6, motifs: ['grain', 'registration'],
      energy: 'calm', transition: 'slide', emphasis: ['underline', 'marker'], logo: null
    },
    {
      id: 'tech', name: 'Teknoloji', builtIn: true, description: 'Izgara, HUD köşe çizgileri, mono etiketler ve tarama ışığı. Teknik inceleme ve veri için.',
      colors: { bg: '#050b10', bg2: '#0b2230', ink: '#e8fbff', muted: '#8fb3c2', card: '#08141c', accents: ['#25e3ff', '#7cff6b', '#ffcc33'] },
      fonts: { display: 'Space Grotesk', body: 'Space Grotesk', label: 'JetBrains Mono' }, type: { weight: 700, case: 'upper', tracking: -1 },
      background: 'grid', card: 'outline', frame: 'hud', radius: 4, motifs: ['hud', 'scanline', 'dots'],
      energy: 'normal', transition: 'zoom', emphasis: ['box', 'underline'], logo: null
    },
    {
      id: 'warm', name: 'Sıcak / Organik', builtIn: true, description: 'Krem ve terrakota tonları, yumuşak köşeler, sakin hareket. Yaşam tarzı ve hikâye anlatımı için.',
      colors: { bg: '#f3e6d6', bg2: '#e9c9a6', ink: '#3b2418', muted: '#6e4d3a', card: '#fbf3ea', accents: ['#c8553d', '#5b8c5a', '#e0a458'] },
      fonts: { display: 'DM Serif Display', body: 'Nunito', label: 'Nunito' }, type: { weight: 400, case: 'normal', tracking: -1 },
      background: 'soft', card: 'solid', frame: 'soft', radius: 36, motifs: ['blobs', 'grain'],
      energy: 'calm', transition: 'zoom', emphasis: ['marker', 'circle'], logo: null
    }
  ];

  const HEX = /^#[0-9a-f]{6}$/i;
  const pick = (v, list, fallback) => list.includes(v) ? v : fallback;
  const color = (v, fallback) => HEX.test(String(v || '').trim()) ? String(v).trim().toLowerCase() : fallback;
  const text = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  // Okunabilirlik: göreli parlaklık ve karşıtlık oranı (WCAG)
  function luminance(hex) {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4));
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  }
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const isLight = hex => luminance(hex) > .45;

  function normalizeTheme(t, base = BUILT_IN[0]) {
    t = t && typeof t === 'object' ? t : {};
    const c = t.colors || {};
    const bg = color(c.bg, base.colors.bg);
    let ink = color(c.ink, isLight(bg) ? '#141414' : '#f5f6fb');
    if (contrast(bg, ink) < 4.5) ink = isLight(bg) ? '#141414' : '#f5f6fb'; // okunmayan yazı rengini düzelt
    let muted = color(c.muted, ink);
    if (contrast(bg, muted) < 3) muted = ink;
    const accents = (Array.isArray(c.accents) ? c.accents : []).map(a => color(a, null)).filter(Boolean).slice(0, 6);
    const f = t.fonts || {}, ty = t.type || {};
    const motifs = [...new Set((Array.isArray(t.motifs) ? t.motifs : base.motifs).filter(m => MOTIFS.includes(m)))].slice(0, 6);
    const emphasis = [...new Set((Array.isArray(t.emphasis) ? t.emphasis : base.emphasis).filter(e => EMPHASIS.includes(e)))].slice(0, 3);
    const logo = t.logo && typeof t.logo.file === 'string' && /^[\w.-]{1,80}$/.test(t.logo.file)
      ? { file: t.logo.file, position: pick(t.logo.position, ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 'top-right'), size: Math.max(60, Math.min(260, +t.logo.size || 140)) } : null;
    return {
      id: typeof t.id === 'string' && /^[a-z0-9-]{2,40}$/.test(t.id) ? t.id : 'custom-' + Math.random().toString(36).slice(2, 10),
      name: text(t.name, 40) || 'Özel tema', description: text(t.description, 220), builtIn: false,
      colors: { bg, bg2: color(c.bg2, base.colors.bg2), ink, muted, card: color(c.card, base.colors.card), accents: accents.length ? accents : base.colors.accents.slice() },
      fonts: { display: pick(f.display, FONTS, base.fonts.display), body: pick(f.body, FONTS, base.fonts.body), label: pick(f.label, FONTS, base.fonts.label) },
      type: { weight: [400, 500, 600, 700, 800, 900].includes(+ty.weight) ? +ty.weight : base.type.weight, case: pick(ty.case, ['normal', 'upper'], base.type.case), tracking: Math.max(-6, Math.min(4, Number.isFinite(+ty.tracking) ? +ty.tracking : base.type.tracking)) },
      background: pick(t.background, BACKGROUNDS, base.background), card: pick(t.card, CARDS, base.card), frame: pick(t.frame, FRAMES, base.frame),
      radius: Math.max(0, Math.min(60, Number.isFinite(+t.radius) ? +t.radius : base.radius)), motifs, emphasis: emphasis.length ? emphasis : base.emphasis.slice(),
      energy: pick(t.energy, ENERGY, base.energy), transition: pick(t.transition, TRANSITIONS, base.transition),
      label: text(t.label, 24), logo
    };
  }
  // Tarifte açıkça yazılmış marka renkleri (hex) modelin yorumundan önce gelir:
  // ilk hex ana vurgu olur, diğer yazılı hex'ler sırayla vurgulara eklenir.
  function pinBrandColors(theme, description) {
    const hexes = [...new Set((String(description || '').match(/#[0-9a-f]{6}(?![0-9a-f])/gi) || []).map(h => h.toLowerCase()))].slice(0, 4);
    if (!hexes.length) return theme;
    const rest = theme.colors.accents.filter(a => !hexes.includes(a.toLowerCase()) && contrast(a, hexes[0]) > 1.25);
    return normalizeTheme({ ...theme, colors: { ...theme.colors, accents: [...hexes, ...rest].slice(0, 6) } });
  }
  const byId = (themes, id) => (themes || []).find(t => t.id === id) || BUILT_IN.find(t => t.id === id) || BUILT_IN[0];

  // Kullanıcının tasarım tarifinden (ör. kapak görseli prompt'u) tema çıkarma istemi
  function buildThemePrompt(description, { hasReference = false } = {}) {
    return `Sen bir video tasarım sistemi uzmanısın. Kullanıcının aşağıdaki TASARIM TARİFİ${hasReference ? ' ve ekteki örnek görseli' : ''}, anlatımlı kısa videolar (Reels/Shorts ve podcast) için tutarlı bir görsel TEMAYA çevir.
Bu bir kapak görseli değil; aynı marka dilini hareketli video sahnelerine taşıyan bir tema. Ürün sadakati, ölçek, kompozisyon gibi tek kareye özgü kuralları değil; renk, tipografi, doku, motif ve hareket karakterini çıkar.

Yalnız şu JSON nesnesini döndür (alan değerleri listelerden seçilmeli):
{
 "name": "kısa tema adı (Türkçe, en fazla 3 kelime)",
 "description": "tek cümle Türkçe açıklama",
 "colors": { "bg": "#rrggbb zemin", "bg2": "#rrggbb ikincil zemin/doku", "ink": "#rrggbb ana yazı", "muted": "#rrggbb ikincil yazı", "card": "#rrggbb kart zemini", "accents": ["#rrggbb", "..." ] },
 "fonts": { "display": "${FONTS.join('|')}", "body": "...", "label": "..." },
 "type": { "weight": 400|500|600|700|800|900, "case": "normal|upper", "tracking": -6..4 },
 "background": "${BACKGROUNDS.join('|')}",
 "card": "${CARDS.join('|')}",
 "frame": "${FRAMES.join('|')}",
 "radius": 0..60,
 "motifs": [en fazla 6: ${MOTIFS.join(', ')}],
 "emphasis": [en fazla 3: ${EMPHASIS.join(', ')}],
 "energy": "${ENERGY.join('|')}",
 "transition": "${TRANSITIONS.join('|')}",
 "label": "boş bırak; yalnız tarif HER videoda aynı kalacak sabit bir seri/marka etiketi veriyorsa onu yaz"
}
Anlamlar: background glow=koyu ışıklı, paper=kâğıt dokulu açık zemin, grid=teknik ızgara, soft=yumuşak gradyan. frame (sahne görseli çerçevesi) card=yuvarlak kart, tape=maskeleme bantlı kolaj, polaroid=beyaz çerçeveli fotoğraf, hud=köşe çizgili teknik çerçeve, soft=yumuşak gölgeli. Geçişler: whip=hızlı savrulma (enerjik, sosyal medya), zoom=yakınlaşarak giriş (dinamik), slide=kâğıt gibi kayarak giriş (kolaj/editoryal), flash=parlama (gösterişli), cut=sert kesme (yalnız çok sade/belgesel dil). Enerji: calm=sakin, normal=dengeli, punchy=hızlı ve vurgulu. Motifler: tape=maskeleme bandı, arrows=el çizimi ok, scribble=karalama daire/çizgi, halftone=nokta raster, registration=baskı hizalama işareti, torn=yırtık kâğıt renk lekesi, hud=teknik köşe çizgileri, scanline=tarama ışığı, dots=nokta ızgara, blobs=yumuşak renk lekeleri, dust=parçacık, comets=ışık izi, sweep=ışık süpürmesi, grain=film greni.
Tarifte sabit renkler (hex) varsa birebir kullan; örnek görseldeki tonlar tarifteki hex'i geçersiz kılmaz. Tarifteki değişken alanlar ({...} yer tutucuları, içerik türü listeleri) temaya yazılmaz; tema her içerik türünde aynı kalmalı. Ana marka rengi accents dizisinin İLK elemanı olsun. Yazı rengi zeminle yüksek karşıtlıkta olsun.

TASARIM TARİFİ:
"""
${String(description || '').slice(0, 12000)}
"""`;
  }

  return { FONTS, BACKGROUNDS, CARDS, FRAMES, MOTIFS, ENERGY, TRANSITIONS, EMPHASIS, BUILT_IN, normalizeTheme, byId, buildThemePrompt, pinBrandColors, contrast, isLight };
});
