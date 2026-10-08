/* Anlatımlı video ekranı: kaynak → senaryo (kullanıcı onayı) → seslendirme +
   HyperFrames videosu → kurgu masası. Senaryo düzenlenince yalnız değişen
   sahnelerin sesi/görüntüsü yeniden üretilir (ana süreç içerik özetiyle önbellekler). */
(() => {
  const V = window.VoiceScript;
  const TYPE_LABELS = { title: 'Başlık', statement: 'Vurgu cümlesi', stat: 'İstatistik', bignumber: 'Büyük sayılar', quote: 'Alıntı kartı', list: 'Liste', cta: 'Kapanış / çağrı' };
  const FIELDS = {
    title: [['heading', 'Başlık', 'wide'], ['subheading', 'Alt başlık', 'wide']],
    statement: [['heading', 'Cümle', 'wide'], ['subheading', 'Açıklama', 'wide']],
    stat: [['value', 'Değer (ör. %45)'], ['source', 'Kaynak'], ['label', 'Açıklama', 'wide']],
    bignumber: [['items', 'Sayılar (her satır: değer | açıklama)', 'wide', 'pairs']],
    quote: [['quote', 'Alıntı', 'wide', 'area'], ['author', 'Kim söyledi'], ['source', 'Platform/kurum']],
    list: [['heading', 'Başlık', 'wide'], ['items', 'Maddeler (her satıra bir madde)', 'wide', 'lines']],
    cta: [['heading', 'Başlık', 'wide'], ['subheading', 'Alt satır'], ['button', 'Düğme metni']]
  };
  const state = {
    source: 'text', format: 'reels', length: 'medium', wave: 'none', tts: 'gemini', design: 'template', media: 'off', captions: false,
    script: null, sourceText: '', sourceTitle: '', fromUrl: false, projectId: null, pageImages: [],
    running: null, result: null, producedKey: null, voicesLoaded: false, lastNarration: null
  };
  const DRAFT_KEY = 'trimtube.voiceVideo.draft';

  // ---- tercihler ----
  function prefs() { return { source: state.source, format: state.format, length: state.length, wave: state.wave, tts: state.tts, design: state.design, media: state.media, captions: state.captions }; }
  function savePrefs() { if (settings) { settings.voiceVideo = prefs(); window.api.setSettings({ voiceVideo: prefs() }); } }
  function applyPrefs() {
    const p = settings?.voiceVideo; if (!p || typeof p !== 'object') return;
    for (const [key, allowed] of Object.entries({ source: ['text', 'url'], format: ['reels', 'podcast'], length: ['short', 'medium', 'long'], wave: ['none', 'wave', 'audiogram'], tts: ['gemini', 'eleven'], design: ['template', 'free'], media: ['off', 'image', 'video'] }))
      if (allowed.includes(p[key])) state[key] = p[key];
    state.captions = p.captions === true;
  }
  function saveDraft() {
    try {
      if (!state.script) { localStorage.removeItem(DRAFT_KEY); return; }
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ script: state.script, projectId: state.projectId, sourceText: state.sourceText.slice(0, 40000), sourceTitle: state.sourceTitle, fromUrl: state.fromUrl, pageImages: state.pageImages, design: state.design, format: state.format, tts: state.tts }));
    } catch {}
  }
  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!d?.script?.scenes?.length || !/^[a-z0-9-]{6,48}$/.test(d.projectId || '')) return;
      state.script = { title: String(d.script.title || ''), scenes: d.script.scenes.map(s => V.normalizeScene(s, d.design === 'free' ? 'free' : 'template')) };
      state.projectId = d.projectId; state.sourceText = d.sourceText || ''; state.sourceTitle = d.sourceTitle || ''; state.fromUrl = !!d.fromUrl;
      state.pageImages = (Array.isArray(d.pageImages) ? d.pageImages : []).filter(p => p && /^https?:\/\//i.test(p.url)).slice(0, 24);
    } catch {}
  }

  // ---- seçim düğmeleri ----
  const segments = [['vvSourceSeg', 'vvSource', 'source'], ['vvFormatSeg', 'vvFormat', 'format'], ['vvLengthSeg', 'vvLength', 'length'], ['vvWaveSeg', 'vvWave', 'wave'], ['vvTtsSeg', 'vvTts', 'tts'], ['vvDesignSeg', 'vvDesign', 'design'], ['vvMediaSeg', 'vvMedia', 'media']];
  function syncSegments() {
    for (const [id, data, key] of segments) $(id).querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b.dataset[data] === state[key]));
    $('vvText').classList.toggle('hidden', state.source !== 'text');
    $('vvUrl').classList.toggle('hidden', state.source !== 'url');
    $('vvUrlNote').classList.toggle('hidden', state.source !== 'url');
    $('vvPodcastOpts').classList.toggle('hidden', state.format !== 'podcast');
    $('vvCaptions').checked = state.captions;
    const audiogram = state.format === 'podcast' && state.wave === 'audiogram';
    $('vvMediaSeg').querySelectorAll('.seg').forEach(b => { b.disabled = audiogram && b.dataset.vvMedia !== 'off'; });
    const notes = [];
    if (state.tts === 'eleven') notes.push('ElevenLabs duygu etiketli modeli (Eleven v4/v3) kullanılır; hesabında karakter kredisi gerekir.');
    else notes.push('Gemini TTS mevcut Gemini anahtarınla çalışır; ton ve anlık sesler yeni TTS biçimine çevrilir.');
    if (state.design === 'free') notes.push('Serbest üretimde her sahnenin tasarımını Gemini yazar; render edilemeyen sahne otomatik olarak şablona döner.');
    if (state.media !== 'off' && !audiogram) notes.push('Stok medya Pexels anahtarınla aranır; kaynak listesi videonun yanına yazılır.');
    if (audiogram) notes.push('Audiogram görünümünde stok medya kullanılmaz.');
    $('vvOptionNote').textContent = notes.join(' ');
  }
  for (const [id, data, key] of segments) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('.seg'); if (!b || b.disabled || state.running) return;
      const value = b.dataset[data]; if (state[key] === value) return;
      state[key] = value;
      if (key === 'wave' && value === 'audiogram') state.media = 'off';
      if (key === 'tts') { loadVoices(); if (state.script) renderScenes(); }
      if (key === 'design' && state.script && value === 'template') state.script.scenes.forEach(s => delete s.html);
      syncSegments(); savePrefs(); refresh();
    });
  }

  $('vvCaptions').addEventListener('change', () => { state.captions = $('vvCaptions').checked; savePrefs(); refresh(); });

  // ---- sesler ----
  function loadVoices() {
    const sel = $('vvVoice');
    $('vvVoiceReload').classList.toggle('hidden', state.tts !== 'eleven');
    if (state.tts === 'gemini') {
      sel.innerHTML = '';
      GEMINI_VOICES.forEach(v => { const o = document.createElement('option'); o.value = v.id; o.textContent = v.name; sel.append(o); });
      const saved = settings?.voiceVideoVoiceGemini || settings?.moodVoiceGemini;
      if (GEMINI_VOICES.some(v => v.id === saved)) sel.value = saved;
      return;
    }
    if (!(settings?.elevenKey || '').trim()) { sel.innerHTML = '<option value="">ElevenLabs anahtarı gerekli (Ayarlar)</option>'; return; }
    if (state.voicesLoaded) return;
    sel.innerHTML = '<option value="">Yükleniyor…</option>';
    window.api.moodVoices().then(r => {
      if (state.tts !== 'eleven') return;
      if (r.error) { sel.innerHTML = ''; const o = document.createElement('option'); o.value = ''; o.textContent = r.error.length > 60 ? 'Ses listesi alınamadı' : r.error; sel.append(o); return; }
      state.voicesLoaded = true; sel.innerHTML = '';
      r.voices.forEach(v => { const o = document.createElement('option'); o.value = v.id; o.textContent = v.name; sel.append(o); });
      const saved = settings?.voiceVideoVoiceEleven || settings?.moodVoice;
      if (r.voices.some(v => v.id === saved)) sel.value = saved;
      refresh();
    }).catch(() => { sel.innerHTML = '<option value="">Ses listesi alınamadı</option>'; });
  }
  $('vvVoice').addEventListener('change', () => {
    const v = $('vvVoice').value; if (!v || !settings) return;
    const key = state.tts === 'gemini' ? 'voiceVideoVoiceGemini' : 'voiceVideoVoiceEleven';
    settings[key] = v; window.api.setSettings({ [key]: v }); refresh();
  });
  $('vvVoiceReload').addEventListener('click', () => { state.voicesLoaded = false; loadVoices(); });

  // ---- durum / ilerleme ----
  function showError(msg) { $('vvError').textContent = msg; $('vvError').classList.toggle('hidden', !msg); }
  function setProgress(label, pct) {
    $('vvProgress').classList.remove('hidden');
    $('vvPhaseLabel').textContent = label;
    $('vvProgressFill').style.width = `${Math.max(2, Math.min(100, pct ?? 5))}%`;
    $('vvProgressText').textContent = Number.isFinite(pct) ? `%${Math.round(pct)}` : '';
  }
  function setRunning(kind) {
    state.running = kind;
    $('vvCancelBtn').classList.toggle('hidden', !kind);
    if (!kind) $('vvProgress').classList.add('hidden');
    document.querySelectorAll('#viewVoice textarea, #viewVoice input, #viewVoice select').forEach(el => { el.disabled = !!kind; });
    if (!kind && state.script) renderScenes(); // sahne düğmeleri yeniden etkinleşir
    refresh();
  }
  window.api.onVvProgress(p => {
    if (state.running !== 'produce') return;
    const base = { tts: 0, align: 25, media: 32, engine: 40, render: 45, assemble: 97 }[p.phase] ?? 0;
    const span = { tts: 25, align: 7, media: 8, engine: 5, render: 52, assemble: 3 }[p.phase] ?? 0;
    setProgress(p.message || 'Çalışıyor…', base + span * (Number.isFinite(p.pct) ? p.pct : 0) / 100);
  });

  function keysMissing() {
    const missing = [];
    if (!(settings?.geminiKey || '').trim()) missing.push('Gemini (senaryo' + (state.tts === 'gemini' ? ' ve seslendirme' : '') + ')');
    if (state.tts === 'eleven' && !(settings?.elevenKey || '').trim()) missing.push('ElevenLabs (seslendirme)');
    if (state.media !== 'off' && !(state.format === 'podcast' && state.wave === 'audiogram') && !(settings?.pexelsKey || '').trim()) missing.push('Pexels (stok medya)');
    return missing;
  }
  const productionKey = () => JSON.stringify([state.script, state.format, state.wave, state.tts, $('vvVoice').value, state.design, state.media, state.captions]);
  function refresh() {
    const missing = keysMissing();
    $('vvKeyWarn').classList.toggle('hidden', !missing.length);
    $('vvKeyWarnText').textContent = missing.length ? `Eksik bağlantı: ${missing.join(', ')}. Anahtarları Ayarlar → Bağlantılar bölümünden ekle.` : '';
    const hasSource = state.source === 'text' ? $('vvText').value.trim().length >= 40 : /^https?:\/\/\S+\.\S+/.test($('vvUrl').value.trim());
    const busy = !!state.running;
    $('vvScriptBtn').disabled = busy || !hasSource || !(settings?.geminiKey || '').trim();
    $('vvScriptBtn').textContent = state.script ? 'Metni yeniden hazırla' : 'Metni hazırla';
    $('vvScriptBtn').classList.toggle('btn-primary', !state.script); $('vvScriptBtn').classList.toggle('btn-ghost', !!state.script);
    const hasScript = !!state.script?.scenes?.length;
    $('vvReview').classList.toggle('hidden', !hasScript);
    $('vvProduceBtn').classList.toggle('hidden', !hasScript);
    const stale = state.result && state.producedKey !== productionKey();
    $('vvProduceBtn').textContent = state.result ? (stale ? 'Değişiklikleri uygula' : 'Videoyu yeniden üret') : 'Onayla ve videoyu üret';
    $('vvProduceBtn').disabled = busy || !hasScript || missing.length > 0 || (state.tts === 'eleven' && !$('vvVoice').value) || state.script.scenes.some(s => !V.plainText(s.narration));
    $('vvResult').classList.toggle('hidden', !state.result);
    $('vvToDeskBtn').classList.toggle('hidden', !state.result || stale);
    $('vvOpenFolderBtn').classList.toggle('hidden', !state.result);
    $('vvToDeskBtn').disabled = busy; $('vvAddScene').disabled = busy || (state.script?.scenes.length || 0) >= 40;
    $('vvFootHint').textContent = busy ? 'İşlem sürüyor; bu ekrandan ayrılabilirsin, iş arka planda devam eder.'
      : stale ? 'Senaryo değişti. Uyguladığında yalnız değişen sahnelerin sesi ve görüntüsü yeniden üretilir.'
        : state.result ? 'Video hazır. Kurgu masasında sahne parçaları ve altyazı katmanıyla düzenleyebilirsin.'
          : hasScript ? 'Metni ve etiketleri kontrol et, sahne görsellerini düzenle; onayladığında seslendirilir.'
            : 'Önce metin hazırlanır; onayladığında seslendirilir ve video üretilir.';
  }
  $('vvText').addEventListener('input', refresh);
  $('vvUrl').addEventListener('input', refresh);
  $('vvGoSettings').addEventListener('click', () => switchView('settings'));

  // ---- etiket çipleri ----
  let lastNarration = null;
  function renderTagHelp() {
    const vocab = V.vocabulary(state.tts), box = $('vvTagHelp'); box.replaceChildren();
    const add = (label, list, dict, cls) => {
      const b = document.createElement('b'); b.textContent = label; box.append(b);
      for (const tag of list) {
        const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'vv-chip ' + cls; chip.textContent = `[${tag}]`; chip.title = dict[tag].label + ' — imleç konumuna ekler';
        chip.addEventListener('mousedown', e => e.preventDefault());
        chip.addEventListener('click', () => insertTag(`[${tag}] `));
        box.append(chip);
      }
    };
    add('Ton:', vocab.tones, V.TONES, 'tone'); add('Anlık:', vocab.events, V.EVENTS, 'event');
  }
  function insertTag(tag) {
    const ta = lastNarration && document.body.contains(lastNarration) ? lastNarration : $('vvScenes').querySelector('.vv-narration');
    if (!ta || ta.disabled) return;
    const start = ta.selectionStart ?? ta.value.length, end = ta.selectionEnd ?? start;
    ta.setRangeText(tag, start, end, 'end'); ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---- sahne kartları ----
  const fmtSec = s => s >= 60 ? `${Math.floor(s / 60)} dk ${Math.round(s % 60)} sn` : `${Math.max(1, Math.round(s))} sn`;
  function summary() {
    const total = state.script.scenes.reduce((n, s) => n + V.estimateSeconds(s.narration) + .4, 0);
    const target = state.format === 'reels' ? ' · hedef 45-60 sn' : '';
    $('vvSummary').textContent = `${state.script.scenes.length} sahne · tahmini ~${fmtSec(total)}${target}`;
  }
  function field(scene, [key, label, wide, kind], onChange) {
    const wrap = document.createElement('label'); wrap.className = 'vv-field' + (wide ? ' wide' : ''); wrap.textContent = label;
    let input;
    if (kind === 'pairs' || kind === 'lines' || kind === 'area') {
      input = document.createElement('textarea'); input.rows = kind === 'area' ? 3 : 3;
      input.value = kind === 'pairs' ? scene.visual.items.map(i => `${i.value} | ${i.text}`).join('\n') : kind === 'lines' ? scene.visual.items.map(i => i.text || i.value).join('\n') : scene.visual[key] || '';
    } else { input = document.createElement('input'); input.type = 'text'; input.value = scene.visual[key] || ''; }
    input.addEventListener('input', () => {
      if (kind === 'pairs') scene.visual.items = input.value.split('\n').map(l => l.split('|')).filter(p => p.join('').trim()).slice(0, 3).map(([v, ...t]) => ({ value: v.trim().slice(0, 12), text: t.join('|').trim().slice(0, 60) }));
      else if (kind === 'lines') scene.visual.items = input.value.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 5).map(t => ({ value: '', text: t.slice(0, 60) }));
      else scene.visual[key] = input.value.slice(0, key === 'quote' ? 260 : 140);
      onChange();
    });
    wrap.append(input); return wrap;
  }
  function visualSummary(scene) {
    if (scene.html) return 'Serbest tasarım (Gemini)';
    const v = scene.visual, text = v.heading || v.quote || v.value || v.items?.[0]?.text || '';
    const pic = scene.media ? (scene.media.kind === 'video' ? ' · 🎬 video' : ' · 🖼 görsel') : '';
    return `${TYPE_LABELS[v.type]}${text ? ' · ' + text.slice(0, 40) : ''}${pic}`;
  }
  function changed() { saveDraft(); summary(); refresh(); }
  function renderScenes() {
    const list = $('vvScenes'), scroll = list.scrollTop; list.replaceChildren();
    $('vvTitle').value = state.script.title;
    state.script.scenes.forEach((scene, i) => {
      const card = document.createElement('div'); card.className = 'vv-scene'; card.dataset.id = scene.id;
      const head = document.createElement('div'); head.className = 'vv-scene-head';
      const no = document.createElement('span'); no.className = 'vv-scene-no'; no.textContent = String(i + 1).padStart(2, '0');
      const time = document.createElement('span'); time.className = 'vv-scene-time';
      const spacer = document.createElement('span'); spacer.className = 'spacer';
      const btn = (text, title, disabled, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'vv-icon-btn'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.disabled = disabled || !!state.running; b.addEventListener('click', fn); return b; };
      head.append(no, time, spacer,
        btn('↑', 'Sahneyi yukarı taşı', i === 0, () => { const a = state.script.scenes; [a[i - 1], a[i]] = [a[i], a[i - 1]]; renderScenes(); changed(); }),
        btn('↓', 'Sahneyi aşağı taşı', i === state.script.scenes.length - 1, () => { const a = state.script.scenes; [a[i + 1], a[i]] = [a[i], a[i + 1]]; renderScenes(); changed(); }),
        btn('✕', 'Sahneyi sil', state.script.scenes.length === 1, () => { state.script.scenes.splice(i, 1); renderScenes(); changed(); }));
      const ta = document.createElement('textarea'); ta.className = 'vv-narration'; ta.value = scene.narration; ta.disabled = !!state.running;
      ta.setAttribute('aria-label', `Sahne ${i + 1} anlatım metni`); ta.spellcheck = true;
      const warn = document.createElement('div'); warn.className = 'vv-warn';
      const check = () => {
        const parsed = V.parseNarration(scene.narration, state.tts);
        const notes = [];
        if (parsed.unknown.length) notes.push(`Tanınmayan etiket: ${parsed.unknown.map(t => `[${t}]`).join(', ')} — seslendirmede atlanır.`);
        if (parsed.unsupported.length) notes.push(`${state.tts === 'eleven' ? 'ElevenLabs' : 'Gemini TTS'} bu etiketi desteklemiyor: ${parsed.unsupported.map(t => `[${t}]`).join(', ')} — atlanır.`);
        if (!V.plainText(scene.narration)) notes.push('Seslendirilecek metin yok.');
        warn.textContent = notes.join(' '); warn.classList.toggle('hidden', !notes.length);
        time.textContent = `~${fmtSec(V.estimateSeconds(scene.narration))}`;
      };
      ta.addEventListener('focus', () => { lastNarration = ta; });
      ta.addEventListener('input', () => { scene.narration = ta.value.slice(0, 2400); check(); changed(); });
      check();
      const details = document.createElement('details'); details.className = 'vv-visual';
      const sum = document.createElement('summary'); const b = document.createElement('b'); b.textContent = 'Görsel:'; const st = document.createElement('span'); st.textContent = visualSummary(scene); sum.append(b, st);
      const body = document.createElement('div'); body.className = 'vv-visual-body';
      const onVisual = () => { st.textContent = visualSummary(scene); changed(); };
      const build = () => {
        body.replaceChildren();
        if (scene.html) {
          const note = document.createElement('div'); note.className = 'vv-free-note';
          note.textContent = 'Bu sahnenin tasarımını Gemini yazdı. Metin alanları yedek şablon için kullanılır.';
          const use = document.createElement('button'); use.type = 'button'; use.className = 'btn-ghost small'; use.textContent = 'Şablona çevir';
          use.addEventListener('click', () => { delete scene.html; build(); onVisual(); });
          note.append(use); body.append(note);
        }
        body.append(mediaPicker(scene, () => { build(); onVisual(); }));
        const typeWrap = document.createElement('label'); typeWrap.className = 'vv-field'; typeWrap.textContent = 'Şablon';
        const select = document.createElement('select');
        for (const t of V.VISUAL_TYPES) { const o = document.createElement('option'); o.value = t; o.textContent = TYPE_LABELS[t]; select.append(o); }
        select.value = scene.visual.type;
        select.addEventListener('change', () => { scene.visual.type = select.value; build(); onVisual(); });
        typeWrap.append(select);
        const kw = document.createElement('label'); kw.className = 'vv-field'; kw.textContent = 'Stok medya araması (İngilizce)';
        const kwInput = document.createElement('input'); kwInput.type = 'text'; kwInput.value = scene.keywords || ''; kwInput.maxLength = 80;
        kwInput.addEventListener('input', () => { scene.keywords = kwInput.value; changed(); });
        kw.append(kwInput);
        body.append(typeWrap, kw, ...FIELDS[scene.visual.type].map(f => field(scene, f, onVisual)));
        body.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = !!state.running; });
      };
      build();
      details.append(sum, body);
      card.append(head, ta, warn, details);
      // Karta bırakılan görsel/video bu sahnenin görseli olur
      card.addEventListener('dragover', e => { if (!state.running && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); card.classList.add('drop'); } });
      card.addEventListener('dragleave', e => { if (!card.contains(e.relatedTarget)) card.classList.remove('drop'); });
      card.addEventListener('drop', async e => {
        card.classList.remove('drop'); e.defaultHandled = true;
        const file = e.dataTransfer.files?.[0]; if (!file || state.running) return;
        const p = window.api.pathForFile(file); if (!p) return;
        const r = await window.api.vvMediaInfo(p);
        if (r.error) { showError(r.error); return; }
        showError(''); scene.media = r.media; details.open = true; build(); onVisual();
      });
      list.append(card);
    });
    list.scrollTop = scroll;
    renderTagHelp(); summary();
    $('vvSourceView').classList.toggle('hidden', !state.fromUrl || !state.sourceText);
    $('vvSourceText').textContent = state.fromUrl ? state.sourceText : '';
  }
  // Sahne görseli: sayfadan (Gemini'ın önerdiği veya galeriden) ya da kullanıcı dosyası
  function mediaPicker(scene, onChange) {
    const box = document.createElement('div'); box.className = 'vv-media wide';
    const preview = document.createElement('div'); preview.className = 'vv-media-preview';
    const m = scene.media;
    if (m) {
      const img = document.createElement('img'); img.alt = ''; img.src = m.source === 'page' ? m.url : (m.thumb || '');
      img.referrerPolicy = 'no-referrer'; img.onerror = () => img.replaceWith(Object.assign(document.createElement('span'), { textContent: 'Önizleme yok' }));
      preview.append(img);
      if (m.kind === 'video') preview.append(Object.assign(document.createElement('b'), { className: 'vv-media-badge', textContent: 'VİDEO' }));
    } else preview.append(Object.assign(document.createElement('span'), { textContent: 'Görsel yok' }));
    const side = document.createElement('div'); side.className = 'vv-media-side';
    const label = document.createElement('div'); label.className = 'vv-media-label';
    label.textContent = m ? (m.source === 'page' ? `Sayfa görseli${m.alt ? ' · ' + m.alt : ''}` : 'Senin dosyan · ' + m.path.split(/[\\/]/).pop()) : 'Bu sahnede görsel kullanılmıyor. Dosyayı karta sürükleyip bırakabilirsin.';
    const row = document.createElement('div'); row.className = 'vv-media-actions';
    const btn = (text, fn, disabled) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-ghost small'; b.textContent = text; b.disabled = disabled || !!state.running; b.addEventListener('click', fn); row.append(b); return b; };
    const gallery = document.createElement('div'); gallery.className = 'vv-gallery hidden';
    if (state.pageImages.length) btn(`Sayfadan seç (${state.pageImages.length})`, () => {
      if (!gallery.childElementCount) for (const p of state.pageImages) {
        const g = document.createElement('button'); g.type = 'button'; g.className = 'vv-gallery-item' + (m?.url === p.url ? ' active' : ''); g.title = p.alt || p.url;
        const im = document.createElement('img'); im.src = p.url; im.alt = p.alt || ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.onerror = () => g.remove();
        g.append(im); g.addEventListener('click', () => { scene.media = { source: 'page', kind: 'image', url: p.url, alt: p.alt || '' }; onChange(); });
        gallery.append(g);
      }
      gallery.classList.toggle('hidden');
    });
    btn('Dosya seç…', async () => {
      const r = await window.api.vvChooseMedia();
      if (r.cancelled) return; if (r.error) { showError(r.error); return; }
      showError(''); scene.media = r.media; onChange();
    });
    if (m) btn('Kaldır', () => { delete scene.media; onChange(); });
    side.append(label, row);
    box.append(preview, side, gallery);
    return box;
  }
  window.vvDropOutside = () => showError('Görseli veya videoyu kullanmak istediğin sahnenin kartına bırak.');

  $('vvTitle').addEventListener('input', () => { if (state.script) { state.script.title = $('vvTitle').value.slice(0, 120); changed(); } });
  $('vvAddScene').addEventListener('click', () => {
    if (!state.script || state.script.scenes.length >= 40) return;
    state.script.scenes.push(V.normalizeScene({ narration: '[normal] ', visual: { type: 'statement' } }, 'template'));
    renderScenes(); changed();
    const last = $('vvScenes').lastElementChild?.querySelector('.vv-narration'); last?.focus(); last && (last.selectionStart = last.value.length);
  });

  // ---- 1) metni hazırla ----
  $('vvScriptBtn').addEventListener('click', async () => {
    if (state.running) return;
    if (state.script && !confirm('Mevcut senaryo ve düzenlemelerin yerine yeni bir senaryo hazırlansın mı?')) return;
    showError(''); setRunning('script');
    try {
      let source = $('vvText').value.trim(), title = '', fromUrl = false, images = [];
      if (state.source === 'url') {
        setProgress('Sayfa okunuyor…', 10);
        const page = await window.api.vvSource({ url: $('vvUrl').value.trim() });
        if (page.cancelled) return;
        if (page.error) { showError(page.error); return; }
        source = page.text; title = page.title; fromUrl = true; images = page.images || [];
      }
      setProgress('Senaryo yazılıyor (Gemini)…', fromUrl ? 45 : 25);
      const r = await window.api.vvScript({ source, title, format: state.format, length: state.length, provider: state.tts, design: state.design, fromUrl, images });
      if (r.cancelled) return;
      if (r.error) { showError(r.error); return; }
      state.script = r.script; state.sourceText = source; state.sourceTitle = title; state.fromUrl = fromUrl; state.pageImages = images;
      state.projectId = `vv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      state.result = null; state.producedKey = null; $('vvPreview').removeAttribute('src');
      renderScenes(); saveDraft();
    } catch (err) { showError('Beklenmeyen hata: ' + (err.message || err)); }
    finally { setRunning(null); }
  });

  // ---- 2) seslendir ve üret ----
  const fileUrl = p => 'file:///' + p.replace(/\\/g, '/').split('/')
    .map((seg, i) => i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)).join('/').replace(/^\/+/, '');
  $('vvProduceBtn').addEventListener('click', async () => {
    if (state.running || !state.script) return;
    const empty = state.script.scenes.findIndex(s => !V.plainText(s.narration));
    if (empty >= 0) { showError(`Sahne ${empty + 1} için seslendirilecek metin yok.`); return; }
    showError(''); setRunning('produce'); setProgress('Başlatılıyor…', 1);
    const key = productionKey();
    try {
      const r = await window.api.vvProduce({
        projectId: state.projectId, title: state.script.title, format: state.format, provider: state.tts, voice: $('vvVoice').value,
        design: state.design, waveMode: state.format === 'podcast' ? state.wave : 'none', mediaMode: state.media, captions: state.captions,
        scenes: state.script.scenes, outDir: settings?.lastFolder || $('folder')?.textContent || null
      });
      if (r.cancelled) { showToast('Video üretimi iptal edildi'); return; }
      if (r.error) { showError(r.error + (r.warnings?.length ? '\n' + r.warnings.join('\n') : '')); return; }
      state.result = r; state.producedKey = key; state.result.burned = state.captions;
      const name = r.outFile.split(/[\\/]/).pop();
      $('vvPreview').src = fileUrl(r.outFile) + `?v=${Date.now()}`;
      $('vvResultTitle').textContent = `Video hazır — ${name}`;
      $('vvResultSub').textContent = [`${fmtClock(r.duration)} · ${r.scenes.length} sahne`, r.rendered < r.scenes.length ? `${r.rendered} sahne yeniden üretildi` : '', r.credits ? `${r.credits} Pexels kaynağı listelendi` : '', ...(r.warnings || [])].filter(Boolean).join(' · ');
      showToast('Anlatımlı video hazır');
    } catch (err) { showError('Beklenmeyen hata: ' + (err.message || err)); }
    finally { setRunning(null); }
  });
  $('vvCancelBtn').addEventListener('click', () => { window.api.vvCancel(); setProgress('İptal ediliyor…'); });
  $('vvOpenFolderBtn').addEventListener('click', () => {
    if (!state.result) return;
    const f = state.result.outFile; window.api.openFolder(f.slice(0, f.length - f.split(/[\\/]/).pop().length - 1));
  });

  // ---- 3) kurgu masasına taşı: sahneler parça, altyazı ayrı katman ----
  $('vvToDeskBtn').addEventListener('click', async () => {
    const r = state.result; if (!r || state.running) return;
    switchView('cutter');
    if (!await loadLocalFile(r.outFile)) return;
    const end = videoDuration || r.duration;
    const clips = r.scenes.map(s => ({ id: s.id, start: Math.max(0, s.start), end: Math.min(end, s.end) })).filter(c => c.end - c.start >= .12);
    try { window.sequenceApplyProject?.({ version: 1, enabled: true, clips }); } catch {}
    let cues = 0;
    if (!r.burned && !$('subCard').classList.contains('hidden') && !$('subEnable').disabled) {
      $('subEnable').checked = true; $('subEnable').dispatchEvent(new Event('change'));
      try { cues = window.reviewImportCues?.(r.cues.map(c => ({ ...c, end: Math.min(end, c.end) })).filter(c => c.end > c.start)) || 0; } catch {}
    }
    showToast(`${clips.length} sahne kurgu masasında${cues ? ` · ${cues} altyazı satırı onay bekliyor` : ''}`);
  });

  window.vvRefreshView = () => { syncSegments(); loadVoices(); refresh(); };
  // Başlangıç: tercihler ve taslak, ayarlar yüklendikten sonra uygulanır
  (async function init() {
    for (let i = 0; i < 100 && !settings; i++) await new Promise(r => setTimeout(r, 50));
    applyPrefs(); loadDraft(); syncSegments();
    if (state.script) renderScenes();
    loadVoices(); refresh();
  })();
})();
