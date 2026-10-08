// Anlatımlı video: duygu etiketli senaryo dili ve sağlayıcıya çeviri.
// Ekranda tek bir etiket dili ([excited] ton, [laughs] anlık ses) kullanılır;
// seslendirmeden hemen önce seçilen TTS'in biçimine çevrilir. Gemini 3.x TTS
// sürekli tonu part başına speech_metadata.style ile, anlık sesleri <laugh>
// gibi açılı etiketlerle alır; ElevenLabs v4/v3 köşeli ses etiketleri kullanır;
// eski Gemini 2.x TTS doğal dil ton talimatı alır. Hem ana süreç hem arayüz
// kullanır (timeline-data.js ile aynı UMD deseni); Electron'a bağlı değildir.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoiceScript = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const TONES = {
    excited: { label: 'Heyecanlı', gemini: 'excited, energetic and upbeat', eleven: '[excited]', legacy: 'excitedly' },
    normal: { label: 'Normal', gemini: '', eleven: '', legacy: '' },
    empathetic: { label: 'Empatik', gemini: 'warm, soft and empathetic', eleven: null, legacy: 'warmly and softly' },
    whispering: { label: 'Fısıltı', gemini: 'whispers', eleven: '[whispers]', legacy: 'in a whisper' },
    serious: { label: 'Ciddi', gemini: 'calm, serious and authoritative', eleven: null, legacy: 'seriously' },
    curious: { label: 'Meraklı', gemini: 'curious and intrigued', eleven: '[curious]', legacy: 'curiously' },
    fast: { label: 'Hızlı', gemini: 'fast-paced, punchy and energetic', eleven: null, legacy: 'quickly and energetically' },
    sarcastic: { label: 'İğneleyici', gemini: null, eleven: '[sarcastic]', legacy: null }
  };
  const EVENTS = {
    laughs: { label: 'Gülme', gemini: '<laugh>', eleven: '[laughs]' },
    sighs: { label: 'İç çekme', gemini: '<sigh>', eleven: '[sighs]' },
    pauses: { label: 'Es', gemini: '<short pause>', eleven: '…' },
    breath: { label: 'Nefes', gemini: '<breath>', eleven: '[exhales]' }
  };
  const PROVIDERS = ['gemini', 'eleven'];
  const FORMATS = {
    reels: { width: 1080, height: 1920, label: 'Reels/Shorts' },
    podcast: { width: 1920, height: 1080, label: 'Podcast' }
  };
  const VISUAL_TYPES = ['title', 'statement', 'stat', 'bignumber', 'quote', 'list', 'cta'];
  const PODCAST_LENGTHS = { short: [70, 120], medium: [170, 240], long: [330, 480] };
  const CHARS_PER_SECOND = 15; // Türkçe akıcı anlatım için ölçülü bir ortalama

  function vocabulary(provider) {
    const key = provider === 'eleven' ? 'eleven' : 'gemini';
    return {
      tones: Object.keys(TONES).filter(t => TONES[t][key] !== null),
      events: Object.keys(EVENTS).filter(e => EVENTS[e][key] !== null)
    };
  }

  const TAG_RE = /\[([a-zA-Z][a-zA-Z ]{0,30})\]/g;
  // Metni ton bölümlerine ayırır: bir ton etiketi ([excited], [normal]…) nerede
  // geçerse orada yeni bölüm başlar; satır sonu tonu sıfırlamaz. Bilinmeyen
  // veya sağlayıcının desteklemediği etiketler raporlanır ve atılır.
  function parseNarration(text, provider) {
    const vocab = vocabulary(provider), unknown = new Set(), unsupported = new Set();
    const segments = [];
    let current = { tone: 'normal', tokens: [] };
    const close = () => { if (current.tokens.some(t => t.text && t.text.trim())) segments.push(current); };
    const pushText = value => { if (value) current.tokens.push({ text: value }); };
    const body = String(text || '').replace(/\r/g, '').split(/\n+/).map(l => l.trim()).filter(Boolean).join('\n');
    let last = 0;
    for (const match of body.matchAll(TAG_RE)) {
      const tag = match[1].trim().toLowerCase();
      pushText(body.slice(last, match.index));
      last = match.index + match[0].length;
      if (TONES[tag]) {
        if (!vocab.tones.includes(tag)) { unsupported.add(tag); continue; }
        close(); current = { tone: tag, tokens: [] };
      } else if (EVENTS[tag]) {
        if (vocab.events.includes(tag)) current.tokens.push({ event: tag }); else unsupported.add(tag);
      } else unknown.add(tag);
    }
    pushText(body.slice(last));
    close();
    return { segments, unknown: [...unknown], unsupported: [...unsupported] };
  }

  const join = tokens => tokens.map(t => t.text ?? t.mark).join('')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/ +([,.!?])/g, '$1').trim();
  const spokenOnly = segment => join(segment.tokens.filter(t => t.text));
  function plainText(text) {
    return parseNarration(text, 'gemini').segments.map(spokenOnly).join(' ').replace(/\s+/g, ' ').trim();
  }
  function estimateSeconds(text) { return plainText(text).length / CHARS_PER_SECOND; }

  // Gemini 3.x: aynı tondaki ardışık bölümler tek part olur (doğal akış).
  function geminiParts(segments) {
    const parts = [];
    for (const seg of segments) {
      const text = join(seg.tokens.map(t => t.event ? { mark: ` ${EVENTS[t.event].gemini} ` } : t));
      const style = TONES[seg.tone].gemini || '';
      const prev = parts[parts.length - 1];
      if (prev && (prev.speech_metadata ? prev.speech_metadata.style : '') === style) prev.text += '\n' + text;
      else parts.push(style ? { text, speech_metadata: { style } } : { text });
    }
    return parts;
  }
  // Eski Gemini 2.x TTS: etiket yok; baskın ton doğal dil talimatıyla verilir.
  function legacyGeminiText(segments) {
    const weight = {};
    for (const seg of segments) weight[seg.tone] = (weight[seg.tone] || 0) + spokenOnly(seg).length;
    const tone = Object.entries(weight).sort((a, b) => b[1] - a[1])[0]?.[0] || 'normal';
    const body = segments.map(spokenOnly).join('\n');
    return TONES[tone].legacy ? `Say ${TONES[tone].legacy}: ${body}` : body;
  }
  function elevenText(segments) {
    return segments.map(seg => {
      const lead = TONES[seg.tone].eleven ? TONES[seg.tone].eleven + ' ' : '';
      return lead + join(seg.tokens.map(t => t.event ? { mark: ` ${EVENTS[t.event].eleven} ` } : t));
    }).join('\n');
  }
  const isLegacyGeminiTts = model => /^gemini-[12](?:\.\d+)?-/.test(String(model || ''));

  // ---- Kaynak metin: HTML sayfasından okunabilir gövde ----
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : +code.slice(1);
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
      }
      return ENTITIES[code.toLowerCase()] ?? all;
    });
  }
  function extractReadable(html) {
    let doc = String(html || '').slice(0, 4000000);
    const rawTitle = (doc.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)/i) || doc.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    doc = doc.replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template|iframe|nav|footer|header|aside|form|button|select)\b[\s\S]*?<\/\1>/gi, ' ');
    const articles = doc.match(/<article\b[\s\S]*?<\/article>/gi);
    const scoped = articles ? articles.join('\n') : (doc.match(/<main\b[\s\S]*?<\/main>/i) || [doc])[0];
    const text = decodeEntities(scoped
      .replace(/<\/(p|div|section|li|h[1-6]|blockquote|tr|figcaption)>/gi, '\n')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<[^>]+>/g, ' '))
      .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 1).join('\n');
    return { title: decodeEntities(rawTitle).replace(/\s+/g, ' ').trim().slice(0, 200), text: text.slice(0, 40000) };
  }

  // Sayfadaki içerik görselleri: og/twitter görseli, makale/ana bölümdeki img
  // (tembel yükleme öznitelikleri ve srcset'in en büyüğü dahil). Logo, ikon,
  // takip pikseli, svg/gif ve veri URL'leri elenir; sıra korunur.
  const IMG_SKIP = /(logo|icon|sprite|favicon|avatar|pixel|badge|flag|payment|banner-ad|placeholder|loading|spinner|blank|emoji|social|share|rating|star)[^/]*$/i;
  function extractImages(html, baseUrl, limit = 24) {
    const doc = String(html || '').slice(0, 4000000);
    const out = [], seen = new Set();
    const add = (raw, alt = '') => {
      if (!raw || out.length >= limit) return;
      let url;
      try { url = new URL(decodeEntities(String(raw).trim()), baseUrl); } catch { return; }
      if (!/^https?:$/.test(url.protocol)) return;
      const pathName = url.pathname.toLowerCase();
      if (/\.(svg|gif|ico)(?:$|\?)/.test(pathName) || IMG_SKIP.test(pathName)) return;
      const key = url.origin + url.pathname;
      if (seen.has(key)) return; seen.add(key);
      out.push({ url: url.href, alt: decodeEntities(alt).replace(/\s+/g, ' ').trim().slice(0, 120) });
    };
    for (const m of doc.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/gi)) add((m[0].match(/content=["']([^"']+)/i) || [])[1]);
    const body = doc.replace(/<(script|style|noscript|nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
    const scoped = (body.match(/<article\b[\s\S]*?<\/article>/gi) || []).join('\n') + (body.match(/<main\b[\s\S]*?<\/main>/i) || [''])[0] || body;
    for (const tag of (scoped || body).match(/<img\b[^>]*>/gi) || []) {
      const attr = name => (tag.match(new RegExp(`\\s${name}=["']([^"']+)["']`, 'i')) || [])[1];
      const w = +(attr('width') || 0), h = +(attr('height') || 0);
      if ((w && w < 240) || (h && h < 180)) continue;
      const srcset = attr('data-srcset') || attr('srcset');
      let best = null;
      if (srcset) best = srcset.split(',').map(p => p.trim().split(/\s+/)).map(([u, d]) => ({ u, n: parseFloat(d) || 1 })).sort((a, b) => b.n - a.n)[0]?.u;
      add(best || attr('data-src') || attr('data-lazy-src') || attr('data-original') || attr('src'), attr('alt') || attr('title') || '');
    }
    return out;
  }

  // Sahne medyası: sayfa görseli (https) veya kullanıcının yerel dosyası
  const MEDIA_EXT = /\.(jpe?g|png|webp|avif|bmp|mp4|mov|m4v|webm)$/i;
  function normalizeMedia(m) {
    if (!m || typeof m !== 'object') return null;
    const kind = m.kind === 'video' ? 'video' : 'image';
    if (m.source === 'page' && typeof m.url === 'string' && /^https?:\/\//i.test(m.url) && m.url.length < 2000) return { source: 'page', kind: 'image', url: m.url, alt: clampText(m.alt, 120) };
    if (m.source === 'local' && typeof m.path === 'string' && m.path.length < 1000 && MEDIA_EXT.test(m.path)) {
      const thumb = typeof m.thumb === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(m.thumb) && m.thumb.length < 120000 ? m.thumb : '';
      return { source: 'local', kind, path: m.path, ...(thumb ? { thumb } : {}) };
    }
    return null;
  }

  // ---- Gemini senaryo istemi ----
  function buildScriptPrompt({ source, title = '', format = 'reels', length = 'medium', provider = 'gemini', design = 'template', fromUrl = false, images = [] }) {
    const pics = (Array.isArray(images) ? images : []).slice(0, 24);
    const picList = pics.map((p, i) => `[${i}] ${p.alt || '(açıklama yok)'} — ${String(p.url).split('/').pop().split('?')[0].slice(0, 60)}`).join('\n');
    const vocab = vocabulary(provider);
    const reels = format === 'reels';
    const [minS, maxS] = reels ? [45, 60] : PODCAST_LENGTHS[length] || PODCAST_LENGTHS.medium;
    const tones = vocab.tones.map(t => `[${t}]`).join(', '), events = vocab.events.map(e => `[${e}]`).join(', ');
    const free = design === 'free';
    const size = FORMATS[reels ? 'reels' : 'podcast'];
    const words = s => Math.round(s * 2.1);
    return `Sen deneyimli bir Türkçe metin yazarı ve ses yönetmenisin. Aşağıdaki KAYNAK metni${fromUrl ? ' (kullanıcının verdiği web sayfasından okunmuş gerçek içerik)' : ''}, yapay zekâ seslendirmesi için doğal, duygulu ve insansı bir Türkçe anlatım senaryosuna dönüştür ve sahnelere böl.

KRİTİK: Yalnızca KAYNAK'taki gerçek bilgileri kullan. Kaynakta olmayan özellik, sayı, isim veya alıntı UYDURMA. Emin olmadığın şeyi yazma.

BİÇİM: ${reels
    ? `Reels/Shorts. Çok hızlı, yüksek enerjili, vurucu ve kısa. Toplam anlatım ${minS}-${maxS} saniyede okunacak uzunlukta (yaklaşık ${words(minS)}-${words(maxS)} kelime). İlk cümle izleyiciyi yakalayan çarpıcı bir kanca olsun. Detaya boğulma; konunun en can alıcı tek fikrini ver. Net bir eylem çağrısıyla bitir (ör. "Sen ne düşünüyorsun, yorumlara yaz!"). Uzun duraksamalardan kaçın. 5-8 sahne.`
    : `Podcast. Samimi, derinlemesine, sohbet havasında tek anlatıcı. Toplam anlatım ${minS}-${maxS} saniyede okunacak uzunlukta (yaklaşık ${words(minS)}-${words(maxS)} kelime). Enerjik bir girişle başla, konuyu detaylı incele, artıları ve eksileri tartış, toparlayıcı bir kapanış ve dinleyiciye bir soruyla bitir. Her sahne 15-30 saniyelik anlatım olsun.`}
Kaynakta geçmeyen bir marka, program veya topluluk adı kullanma; kendini bir program adıyla tanıtma.

SESLENDİRME ETİKETLERİ (yalnız bunlar; köşeli ayraç içinde ve İngilizce):
- Ton (cümlenin/paragrafın başına; sonraki ton etiketine kadar geçerli): ${tones}
- Anlık ses (cümlenin içinde, olduğu yerde): ${events}
Bilgilendirici anlatıma dönerken [normal] kullan. Etiketleri ölçülü kullan: paragraf başına en fazla bir ton ve bir-iki anlık ses. Liste dışı etiket YAZMA.
Kurallar: Metin tamamen Türkçe. "İşte metniniz" gibi giriş yok. Cümleler kısa, nefes aralıklarına uygun, akıcı konuşma dilinde. Kısaltmalardan kaçın.

GÖRSELLER: Her sahne için ekranda görünecek kısa görsel içerik seç. Görsel metinler anlatımı tekrar etmesin, özetlesin (en fazla 6-8 kelime).
"visual.type" şunlardan biri:
- "title": büyük kinetik başlık (heading, isteğe bağlı subheading)
- "statement": vurucu tek cümle (heading) + kısa açıklama (subheading)
- "stat": tek istatistik; value ("%45" veya "45"), label, isteğe bağlı source (kaynakta geçen kurum)
- "bignumber": 2-3 büyük sayı; items: [{"value":"20","text":"saat video"}]
- "quote": alıntı kartı; quote, author, source (platform/kurum). YALNIZ kaynakta gerçekten geçen alıntılar.
- "list": başlık + 2-5 kısa madde; heading, items: [{"text":"..."}]
- "cta": kapanış/eylem çağrısı; heading, subheading, button
"keywords": sahneye uygun stok görsel aramak için 2-4 kelimelik İNGİLİZCE arama ifadesi (somut nesne veya ortam; marka adı yok).${pics.length ? `
"image": Aşağıdaki SAYFA GÖRSELLERİ listesinden sahnede anlatılan ürüne/konuya en uygun görselin numarası. Görsel açıklaması ve dosya adı sahneyle gerçekten eşleşmiyorsa null yaz. Ürün sahnelerinde mutlaka uygun ürün görselini seç; mümkünse her görseli bir kez kullan; istatistik ve kapanış sahnelerinde de ilgili ürün görseli olabilir.` : ''}${free ? `
"html": Bu sahne için ÖZGÜN bir görsel tasarım. ${size.width}x${size.height} piksellik tam ekran bir alanın içine girecek HTML+CSS parçası: tek bir <style> bloğu ve gövde öğeleri. Animasyonlar YALNIZ CSS @keyframes ile (sahne başında başlar, girişler ilk 1,5 saniyede tamamlanır). JavaScript, <script>, olay öznitelikleri, dış bağlantı, harici font ve resim URL'si YASAK. Tüm sınıf adlarını "s-" ile başlat. Koyu zemin, canlı vurgu renkleri, büyük okunaklı tipografi (başlıklar en az 64px). Metinleri visual alanlarıyla tutarlı tut.` : ''}

ÇIKTI: Yalnız şu JSON nesnesi:
{"title":"videonun kısa başlığı","scenes":[{"narration":"[excited] ...","visual":{"type":"title","heading":"...","subheading":"..."},"keywords":"..."${pics.length ? ',"image":0' : ''}${free ? ',"html":"..."' : ''}}]}

${pics.length ? `SAYFA GÖRSELLERİ:
${picList}

` : ''}KAYNAK${title ? ` (başlık: ${title})` : ''}:
"""
${String(source || '').slice(0, 40000)}
"""`;
  }

  // ---- Senaryo doğrulama / normalleştirme ----
  const clampText = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  function normalizeVisual(v) {
    v = v && typeof v === 'object' ? v : {};
    const type = VISUAL_TYPES.includes(v.type) ? v.type : 'statement';
    const items = (Array.isArray(v.items) ? v.items : []).slice(0, type === 'bignumber' ? 3 : 5)
      .map(i => typeof i === 'string' ? { value: '', text: clampText(i, 60) } : { value: clampText(i && i.value, 12), text: clampText(i && (i.text ?? i.label), 60) })
      .filter(i => i.text || i.value);
    return {
      type, heading: clampText(v.heading, 90), subheading: clampText(v.subheading, 140), value: clampText(v.value, 12),
      label: clampText(v.label, 90), source: clampText(v.source, 60), quote: clampText(v.quote, 260), author: clampText(v.author, 60),
      button: clampText(v.button, 40), items
    };
  }
  let sceneCounter = 0;
  const sceneId = () => `s${Date.now().toString(36)}${(++sceneCounter).toString(36)}`;
  function normalizeScene(s, design) {
    const scene = { id: typeof s?.id === 'string' && /^[\w-]{1,40}$/.test(s.id) ? s.id : sceneId(),
      narration: String(s?.narration ?? '').replace(/\r/g, '').trim().slice(0, 2400), visual: normalizeVisual(s?.visual), keywords: clampText(s?.keywords, 80) };
    if (design === 'free' && typeof s?.html === 'string' && s.html.trim()) scene.html = sanitizeHtml(s.html);
    const media = normalizeMedia(s?.media);
    if (media) scene.media = media;
    return scene;
  }
  function normalizeScript(data, { design = 'template', images = [] } = {}) {
    if (!data || !Array.isArray(data.scenes) || !data.scenes.length) throw Error('Model sahne listesi döndürmedi. Yeniden deneyin.');
    const scenes = data.scenes.slice(0, 40).map(s => {
      const scene = normalizeScene({ ...s, media: undefined }, design);
      const pick = Number.isInteger(s?.image) ? images[s.image] : null;
      if (pick) scene.media = normalizeMedia({ source: 'page', url: pick.url, alt: pick.alt });
      return scene;
    }).filter(s => plainText(s.narration));
    if (!scenes.length) throw Error('Senaryoda seslendirilecek metin bulunamadı.');
    return { title: clampText(data.title, 120) || 'Anlatımlı video', scenes };
  }

  // Serbest tasarım yalnız HTML+CSS'tir: betik, olay özniteliği ve dış kaynak
  // render sırasında ağ erişimi veya kod çalıştırması için kullanılamaz.
  const PAIRED = 'script|iframe|object|embed|form|frameset|applet|noscript|template|audio|video|picture|textarea|select|button|title';
  const SINGLE = 'script|iframe|object|embed|link|meta|base|form|frame|frameset|applet|html|head|body|img|input|source|track|audio|video|picture|textarea|select|button|title|noscript|template';
  function sanitizeHtml(html) {
    let s = String(html || '').slice(0, 30000);
    s = s.replace(new RegExp(`<\\s*(${PAIRED})\\b[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, 'gi'), '');
    s = s.replace(new RegExp(`<\\s*\\/?\\s*(${SINGLE})\\b[^>]*>`, 'gi'), '');
    s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/\s(src|href|srcset|xlink:href|action|formaction|poster|background|ping|data)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/@import[^;]*;?/gi, '').replace(/url\s*\(([^)]*)\)/gi, 'none').replace(/expression\s*\(/gi, '(').replace(/javascript:/gi, '');
    return s.trim();
  }

  // Altyazı satırları: sahne metni cümlelere/kısa satırlara bölünür, süre
  // karakter oranıyla dağıtılır. Kurgu masasında kullanıcı düzeltip onaylar.
  function captionLines(text, max = 42) {
    const lines = [];
    for (const sentence of plainText(text).split(/(?<=[.!?…])\s+/)) {
      let line = '';
      for (const word of sentence.split(/\s+/).filter(Boolean)) {
        if (line && (line + ' ' + word).length > max) { lines.push(line); line = word; }
        else line = line ? line + ' ' + word : word;
      }
      if (line) lines.push(line);
    }
    return lines;
  }
  // scenes: [{narration, start, duration, speech}] (speech = sesin süresi)
  function estimateCues(scenes) {
    const cues = [];
    for (const s of scenes) {
      const lines = captionLines(s.narration), speech = Math.max(.2, (s.speech ?? s.duration) - .05);
      const total = lines.reduce((n, l) => n + l.length + 4, 0) || 1;
      let t = s.start + .05;
      for (const line of lines) {
        const d = speech * (line.length + 4) / total;
        cues.push({ start: +t.toFixed(3), end: +Math.min(s.start + s.duration, t + d).toFixed(3), text: line }); t += d;
      }
    }
    return cues.filter(c => c.end > c.start);
  }

  // ---- Kelime zamanları (sahne içi, saniye) ----
  // Ekranda senaryodaki (onaylanan) kelimeler görünür; Whisper yalnız ne zaman
  // söylendiklerini ölçer. Eşleşmeyen kelimeler komşu zamanlar arasına, hece
  // ağırlığıyla dağıtılır. Ölçüm yoksa tüm metin aynı ağırlıkla tahmin edilir.
  const normWord = w => String(w).toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]/gu, '');
  const spokenTokens = text => plainText(text).split(/\s+/).filter(Boolean);
  function tokenWeight(tok) {
    const vowels = (tok.match(/[aeıioöuüâîûAEIİOÖUÜ]/g) || []).length;
    const digits = (tok.match(/\d/g) || []).length;
    return Math.max(1, vowels + digits * 1.4) + (/[.!?…]$/.test(tok) ? 1.4 : /[,;:]$/.test(tok) ? .6 : 0);
  }
  function spread(tokens, from, to, out) {
    const total = tokens.reduce((n, t) => n + tokenWeight(t), 0) || 1;
    let t = from;
    for (const tok of tokens) {
      const w = tokenWeight(tok), d = (to - from) * w / total;
      const pause = /[.!?…]$/.test(tok) ? Math.min(d * .35, .35) : /[,;:]$/.test(tok) ? Math.min(d * .2, .15) : 0;
      out.push({ text: tok, start: +t.toFixed(3), end: +(t + d - pause).toFixed(3) }); t += d;
    }
  }
  function estimateTimings(text, speech, lead = .05) {
    const out = []; spread(spokenTokens(text), lead, Math.max(lead + .2, speech - .05), out); return out;
  }
  function alignTimings(text, measured, speech) {
    const tokens = spokenTokens(text);
    const heard = (Array.isArray(measured) ? measured : []).filter(w => w && typeof w.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start && normWord(w.word)).slice(0, 2000);
    if (!tokens.length) return [];
    if (!heard.length || tokens.length > 1500) return estimateTimings(text, speech);
    const a = tokens.map(normWord), b = heard.map(w => normWord(w.word));
    const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
      rows[i][j] = a[i] && a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    const match = new Array(tokens.length).fill(-1);
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
      if (a[i] && a[i] === b[j]) { match[i++] = j++; }
      else if (rows[i + 1][j] >= rows[i][j + 1]) i++; else j++;
    }
    if (!match.some(m => m >= 0)) return estimateTimings(text, speech);
    const out = [];
    for (let i = 0; i < tokens.length;) {
      if (match[i] >= 0) { const w = heard[match[i]]; out.push({ text: tokens[i], start: w.start, end: Math.max(w.start + .06, w.end) }); i++; continue; }
      let k = i; while (k < tokens.length && match[k] < 0) k++;
      const from = out.length ? out[out.length - 1].end : Math.max(0, (k < tokens.length ? heard[match[k]].start : speech) - .25 * (k - i));
      const to = k < tokens.length ? heard[match[k]].start : Math.max(from + .2, speech);
      spread(tokens.slice(i, k), from, Math.max(from + .12 * (k - i), to), out);
      i = k;
    }
    for (let i = 1; i < out.length; i++) if (out[i].start < out[i - 1].start) out[i].start = out[i - 1].start;
    return out.map(w => ({ ...w, start: +Math.max(0, w.start).toFixed(3), end: +Math.max(w.start + .05, w.end).toFixed(3) }));
  }
  // Kelime zamanlarından altyazı satırları (sahne başlangıcına göre kaydırılır)
  function cuesFromTimings(scenes, max = 42) {
    const cues = [];
    for (const s of scenes) {
      let line = [];
      const flush = () => {
        if (!line.length) return;
        cues.push({ start: s.start + line[0].start, end: s.start + line[line.length - 1].end, text: line.map(w => w.text).join(' ') }); line = [];
      };
      for (const w of s.words || []) {
        if (line.length && (line.map(x => x.text).join(' ') + ' ' + w.text).length > max) flush();
        line.push(w);
        if (/[.!?…]$/.test(w.text)) flush();
      }
      flush();
    }
    for (let i = 0; i < cues.length; i++) {
      const next = cues[i + 1]?.start ?? Infinity;
      cues[i].end = +Math.min(next, cues[i].end + .25).toFixed(3); cues[i].start = +cues[i].start.toFixed(3);
    }
    return cues.filter(c => c.end - c.start > .05);
  }

  return {
    normWord, spokenTokens, estimateTimings, alignTimings, cuesFromTimings,
    TONES, EVENTS, PROVIDERS, FORMATS, VISUAL_TYPES, PODCAST_LENGTHS, CHARS_PER_SECOND,
    vocabulary, parseNarration, plainText, estimateSeconds, geminiParts, legacyGeminiText, elevenText, isLegacyGeminiTts,
    extractReadable, extractImages, normalizeMedia, decodeEntities, buildScriptPrompt, normalizeScript, normalizeScene, normalizeVisual, sanitizeHtml, captionLines, estimateCues
  };
});
