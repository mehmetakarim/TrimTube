/* Anlatımlı video ekranı: kaynak → senaryo (kullanıcı onayı) → seslendirme +
   HyperFrames videosu → kurgu masası. Senaryo düzenlenince yalnız değişen
   sahnelerin sesi/görüntüsü yeniden üretilir (ana süreç içerik özetiyle önbellekler). */
(() => {
  const V = window.VoiceScript;
  const TYPE_LABELS = { title: 'Başlık', statement: 'Vurgu cümlesi', stat: 'İstatistik', bignumber: 'Büyük sayılar', quote: 'Alıntı kartı', list: 'Liste', steps: 'Adımlar', specs: 'Teknik özellikler', comparison: 'Karşılaştırma', cta: 'Kapanış / çağrı' };
  const VARIANT_LABELS = { kinetic: 'Kinetik', stacked: 'Üst üste', label: 'Etiketli', center: 'Ortalı', left: 'Sola yaslı', ring: 'Halka', giant: 'Dev rakam', bar: 'Çubuk', auto: 'Otomatik', card: 'Kart', big: 'Büyük tırnak', cards: 'Kartlar', checklist: 'Onay listesi', numbers: 'Numaralı', timeline: 'Zaman çizgisi', rows: 'Satırlar', vs: 'VS', table: 'Tablo', burst: 'Patlama', clean: 'Sade' };
  const HERO_LABELS = { auto: 'Otomatik', top: 'Üstte', side: 'Yanda', background: 'Arka plan', inset: 'Küçük kart', none: 'Görsel yok' };
  const TRANSITION_LABELS = { whip: 'Savrulma', zoom: 'Yakınlaşma', slide: 'Kayma', flash: 'Flaş', cut: 'Kesme' };
  const EMPHASIS_LABELS = { marker: 'İşaretleyici', underline: 'Alt çizgi', circle: 'Daire', color: 'Renk', box: 'Kutu' };
  const FIELDS = {
    title: [['heading', 'Başlık', 'wide'], ['subheading', 'Alt başlık', 'wide']],
    statement: [['heading', 'Cümle', 'wide'], ['subheading', 'Açıklama', 'wide']],
    stat: [['value', 'Değer (ör. %45)'], ['source', 'Kaynak'], ['label', 'Açıklama', 'wide']],
    bignumber: [['items', 'Sayılar (her satır: değer | açıklama)', 'wide', 'pairs']],
    quote: [['quote', 'Alıntı', 'wide', 'area'], ['author', 'Kim söyledi'], ['source', 'Platform/kurum']],
    list: [['heading', 'Başlık', 'wide'], ['items', 'Maddeler (her satıra bir madde)', 'wide', 'lines']],
    steps: [['heading', 'Başlık', 'wide'], ['items', 'Adımlar (her satıra bir adım)', 'wide', 'lines']],
    specs: [['heading', 'Başlık', 'wide'], ['items', 'Özellikler (her satır: özellik | değer)', 'wide', 'specs']],
    comparison: [['heading', 'Başlık (isteğe bağlı)', 'wide'], ['left', 'Sol taraf', 'wide', 'side'], ['right', 'Sağ taraf', 'wide', 'side']],
    cta: [['heading', 'Başlık', 'wide'], ['subheading', 'Alt satır'], ['button', 'Düğme metni']]
  };
  const state = {
    source: 'text', format: 'reels', length: 'medium', wave: 'none', tts: 'gemini', themeId: 'neon', theme: null, designNote: '', media: 'off', captions: false, safeArea: true, sfx: true, music: null,
    script: null, sourceText: '', sourceTitle: '', fromUrl: false, projectId: null, pageImages: [],
    running: null, result: null, producedKey: null, voicesLoaded: false, lastNarration: null
  };
  const DRAFT_KEY = 'trimtube.voiceVideo.draft';

  // ---- tercihler ----
  function prefs() { return { source: state.source, format: state.format, length: state.length, wave: state.wave, tts: state.tts, themeId: state.themeId, designNote: state.designNote, media: state.media, captions: state.captions, safeArea: state.safeArea, sfx: state.sfx, music: state.music }; }
  function savePrefs() { if (settings) { settings.voiceVideo = prefs(); window.api.setSettings({ voiceVideo: prefs() }); } }
  function applyPrefs() {
    const p = settings?.voiceVideo; if (!p || typeof p !== 'object') return;
    for (const [key, allowed] of Object.entries({ source: ['text', 'url'], format: ['reels', 'podcast'], length: ['short', 'medium', 'long'], wave: ['none', 'wave', 'audiogram'], tts: ['gemini', 'eleven', 'ema'], media: ['off', 'image', 'video'] }))
      if (allowed.includes(p[key])) state[key] = p[key];
    state.designNote = String(p.designNote || '').slice(0, 600);
    if (typeof p.themeId === 'string' && /^[a-z0-9-]{2,40}$/.test(p.themeId)) state.themeId = p.themeId;
    state.captions = p.captions === true;
    state.safeArea = p.safeArea !== false;
    state.sfx = p.sfx !== false;
    state.music = p.music && typeof p.music.path === 'string' ? { path: p.music.path, name: String(p.music.name || ''), level: Math.max(.1, Math.min(.6, +p.music.level || .3)), start: Math.max(0, +p.music.start || 0), duration: +p.music.duration || 0, bpm: +p.music.bpm || null, beatSync: p.music.beatSync !== false } : null;
  }
  function saveDraft() {
    try {
      if (!state.script) { localStorage.removeItem(DRAFT_KEY); return; }
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ script: state.script, projectId: state.projectId, sourceText: state.sourceText.slice(0, 40000), sourceTitle: state.sourceTitle, fromUrl: state.fromUrl, pageImages: state.pageImages, format: state.format, tts: state.tts }));
    } catch {}
  }
  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!d?.script?.scenes?.length || !/^[a-z0-9-]{6,48}$/.test(d.projectId || '')) return;
      state.script = { title: String(d.script.title || ''), scenes: d.script.scenes.map(s => V.normalizeScene(s)), ...(['reels', 'podcast'].includes(d.script.format) ? { format: d.script.format, length: ['short', 'medium', 'long'].includes(d.script.length) ? d.script.length : 'medium' } : {}) };
      state.projectId = d.projectId; state.sourceText = d.sourceText || ''; state.sourceTitle = d.sourceTitle || ''; state.fromUrl = !!d.fromUrl;
      state.pageImages = (Array.isArray(d.pageImages) ? d.pageImages : []).filter(p => p && /^https?:\/\//i.test(p.url)).slice(0, 24);
    } catch {}
  }

  // ---- seçim düğmeleri ----
  const segments = [['vvSourceSeg', 'vvSource', 'source'], ['vvFormatSeg', 'vvFormat', 'format'], ['vvLengthSeg', 'vvLength', 'length'], ['vvWaveSeg', 'vvWave', 'wave'], ['vvTtsSeg', 'vvTts', 'tts'], ['vvMediaSeg', 'vvMedia', 'media']];
  function syncSegments() {
    for (const [id, data, key] of segments) $(id).querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b.dataset[data] === state[key]));
    $('vvText').classList.toggle('hidden', state.source !== 'text');
    $('vvUrl').classList.toggle('hidden', state.source !== 'url');
    $('vvUrlNote').classList.toggle('hidden', state.source !== 'url');
    $('vvPodcastOpts').classList.toggle('hidden', state.format !== 'podcast');
    $('vvCaptions').checked = state.captions;
    $('vvSafeArea').checked = state.safeArea;
    $('vvSafeRow').classList.toggle('hidden', state.format !== 'reels');
    $('vvGuideRow').classList.toggle('hidden', state.format !== 'reels');
    $('vvSafeGuide').classList.toggle('hidden', state.format !== 'reels' || !$('vvShowGuide').checked);
    $('vvSfx').checked = state.sfx;
    $('vvMusicName').textContent = state.music ? state.music.name : 'Müzik yok';
    $('vvMusicName').title = state.music ? state.music.path : '';
    $('vvMusicClear').classList.toggle('hidden', !state.music);
    $('vvMusicOpts').classList.toggle('hidden', !state.music);
    if (state.music) {
      const m = state.music, max = Math.max(0, (m.duration || 60) - 5);
      $('vvMusicLevel').value = Math.round(m.level * 100); $('vvMusicLevelValue').textContent = `%${Math.round(m.level * 100)}`;
      $('vvMusicStart').max = max; $('vvMusicStart').value = Math.min(m.start, max); $('vvMusicStartValue').textContent = clock(m.start);
      $('vvBeatSync').checked = m.beatSync !== false;
      $('vvBpm').textContent = m.bpm ? `(algılanan tempo: ${Math.round(m.bpm)} BPM)` : '(ritim algılanamazsa normal geçiş kullanılır)';
    }
    $('vvStage').dataset.format = state.format;
    const audiogram = state.format === 'podcast' && state.wave === 'audiogram';
    $('vvMediaSeg').querySelectorAll('.seg').forEach(b => { b.disabled = audiogram && b.dataset.vvMedia !== 'off'; });
    const notes = [];
    if (state.tts === 'ema') notes.push('Yerel seslendirme (EMA Lightning) bilgisayarında çalışır: ücretsiz, anahtarsız ve internetsiz. Tek Türkçe ses; duygu etiketlerini okumaz, senaryo etiketsiz yazılır.');
    else if (state.tts === 'eleven') notes.push('ElevenLabs duygu etiketli modeli (Eleven v4/v3) kullanılır; hesabında karakter kredisi gerekir.');
    else notes.push('Gemini TTS mevcut Gemini anahtarınla çalışır; ton ve anlık sesler yeni TTS biçimine çevrilir.');
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
      syncSegments(); savePrefs(); refresh();
    });
  }

  // ---- görsel stil (tema kütüphanesi) ----
  function showTheme() {
    const t = state.theme; if (!t) return;
    $('vvThemeName').textContent = t.name; $('vvThemeDesc').textContent = t.description || '';
    $('vvThemeThumb').replaceChildren(window.vvThemeLibrary.preview(t));
    $('vvThemeOpen').title = `${t.name} — tema kütüphanesini aç`;
  }
  async function loadTheme() {
    state.theme = await window.vvThemeLibrary.resolve(state.themeId);
    if (state.theme.id !== state.themeId) { state.themeId = state.theme.id; savePrefs(); }
    showTheme(); refresh();
  }
  $('vvThemeOpen').addEventListener('click', () => {
    if (state.running) return;
    window.vvThemeLibrary.open(state.themeId, t => { state.themeId = t.id; state.theme = t; showTheme(); savePrefs(); refresh(); });
  });
  $('vvDesignNote').addEventListener('input', () => { state.designNote = $('vvDesignNote').value.slice(0, 600); });
  $('vvDesignNote').addEventListener('change', savePrefs);

  $('vvSafeArea').addEventListener('change', () => { state.safeArea = $('vvSafeArea').checked; savePrefs(); refresh(); });
  $('vvShowGuide').addEventListener('change', syncSegments);
  $('vvCaptions').addEventListener('change', () => { state.captions = $('vvCaptions').checked; savePrefs(); refresh(); });
  $('vvSfx').addEventListener('change', () => { state.sfx = $('vvSfx').checked; savePrefs(); refresh(); });
  $('vvMusicPick').addEventListener('click', async () => {
    if (state.running) return;
    const r = await window.api.vvChooseMusic();
    if (r.cancelled) return; if (r.error) { showError(r.error); return; }
    showError(''); state.music = { path: r.music.path, name: r.music.name, level: state.music?.level || .3, start: 0, duration: r.music.duration || 0, bpm: r.music.bpm || null, beatSync: state.music?.beatSync !== false };
    syncSegments(); savePrefs(); refresh();
  });
  $('vvMusicClear').addEventListener('click', () => { stopListen(); state.music = null; syncSegments(); savePrefs(); refresh(); });
  // Müziğin kullanılacak bölümü: başlangıç kaydırıcısı + kısa dinleme
  const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  let listenTimer = null;
  function stopListen() { clearTimeout(listenTimer); const a = $('vvMusicAudio'); a.pause(); $('vvMusicListen').textContent = '▶ Dinle'; }
  $('vvMusicStart').addEventListener('input', () => { if (!state.music) return; state.music.start = +$('vvMusicStart').value; $('vvMusicStartValue').textContent = clock(state.music.start); });
  $('vvMusicStart').addEventListener('change', () => { savePrefs(); refresh(); if (!$('vvMusicAudio').paused) { stopListen(); $('vvMusicListen').click(); } });
  $('vvMusicListen').addEventListener('click', () => {
    const a = $('vvMusicAudio');
    if (!state.music) return;
    if (!a.paused) { stopListen(); return; }
    const url = fileUrl(state.music.path);
    if (a.dataset.src !== url) { a.src = url; a.dataset.src = url; }
    const play = () => { a.currentTime = state.music.start; a.volume = .8; a.play().then(() => { $('vvMusicListen').textContent = '■ Durdur'; listenTimer = setTimeout(stopListen, 12000); }).catch(() => showError('Müzik önizlemesi oynatılamadı.')); };
    if (a.readyState >= 1) play(); else { a.addEventListener('loadedmetadata', play, { once: true }); a.load(); }
  });
  $('vvBeatSync').addEventListener('change', () => { if (!state.music) return; state.music.beatSync = $('vvBeatSync').checked; savePrefs(); refresh(); });
  $('vvMusicLevel').addEventListener('input', () => { if (!state.music) return; state.music.level = +$('vvMusicLevel').value / 100; $('vvMusicLevelValue').textContent = `%${$('vvMusicLevel').value}`; });
  $('vvMusicLevel').addEventListener('change', () => { savePrefs(); refresh(); });

  // ---- sesler ----
  function loadVoices() {
    const sel = $('vvVoice');
    $('vvVoiceReload').classList.toggle('hidden', state.tts !== 'eleven');
    if (state.tts === 'ema') {
      // Tek ses; seçim konuşma hızıdır (değer, üretimde voice alanıyla gider)
      sel.innerHTML = '';
      for (const [v, t] of [['0.9', 'Türkçe anlatıcı · sakin'], ['1', 'Türkçe anlatıcı · normal'], ['1.1', 'Türkçe anlatıcı · hızlı']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); }
      sel.value = ['0.9', '1', '1.1'].includes(settings?.voiceVideoVoiceEma) ? settings.voiceVideoVoiceEma : '1';
      return;
    }
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
    const key = { gemini: 'voiceVideoVoiceGemini', eleven: 'voiceVideoVoiceEleven', ema: 'voiceVideoVoiceEma' }[state.tts];
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
    if (state.running === 'script' && p.phase === 'script') {
      // Akışla gelen senaryo: yazılan karakter sayısı (podcast için yaklaşık 6-12 bin)
      const goal = state.format === 'podcast' ? { short: 5000, medium: 8000, long: 11000 }[state.length] : 5000;
      if (!p.chars) setProgress(`Gemini senaryoyu planlıyor…${p.thoughts ? ` (${p.thoughts}. adım)` : ''}`, Math.min(40, 25 + p.thoughts));
      else setProgress(`Senaryo yazılıyor (Gemini)… ${p.chars.toLocaleString('tr-TR')} karakter`, Math.min(95, 40 + 55 * p.chars / goal));
      return;
    }
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
  const productionKey = () => JSON.stringify([state.script, state.format, state.wave, state.tts, $('vvVoice').value, state.theme, state.media, state.captions, state.format === 'reels' && state.safeArea, state.sfx, state.music]);
  // Senaryo hangi biçim (ve podcast uzunluğu) için yazıldı? Seçim sonradan değişirse uyarılır
  const FORMAT_NAMES = { reels: 'Reels/Shorts', podcast: 'Podcast' }, LENGTH_NAMES = { short: 'kısa', medium: 'orta', long: 'uzun' };
  function scriptMismatch() {
    const s = state.script;
    if (!s?.format) return null;
    if (s.format !== state.format) return `Bu senaryo ${FORMAT_NAMES[s.format]} için yazıldı; seçili biçim ${FORMAT_NAMES[state.format]}.`;
    if (s.format === 'podcast' && s.length !== state.length) return `Bu senaryo ${LENGTH_NAMES[s.length]} podcast için yazıldı; seçili uzunluk ${LENGTH_NAMES[state.length]}.`;
    return null;
  }
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
    const mismatch = hasScript ? scriptMismatch() : null;
    $('vvFormatWarn').classList.toggle('hidden', !mismatch);
    $('vvFormatWarnText').textContent = mismatch || '';
    $('vvFormatRedo').textContent = `Metni ${FORMAT_NAMES[state.format]} için yeniden hazırla`;
    $('vvFormatRedo').disabled = busy || $('vvScriptBtn').disabled;
    $('vvScriptEmpty').classList.toggle('hidden', hasScript);
    $('vvStage').classList.toggle('has-video', !!state.result);
    const step = state.result ? 3 : hasScript ? 2 : 1;
    document.querySelectorAll('#vvSteps li').forEach(li => { const n = +li.dataset.step; li.classList.toggle('active', n === step); li.classList.toggle('done', n < step); });
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
  $('vvFormatRedo').addEventListener('click', () => $('vvScriptBtn').click());
  $('vvUrl').addEventListener('input', refresh);
  $('vvGoSettings').addEventListener('click', () => switchView('settings'));

  // ---- etiket çipleri ----
  let lastNarration = null;
  function renderTagHelp() {
    const vocab = V.vocabulary(state.tts), box = $('vvTagHelp'); box.replaceChildren();
    if (state.tts === 'ema') { const n = document.createElement('span'); n.className = 'vv-tag-note'; n.textContent = 'Yerel seslendirme duygu etiketi okumaz; metindeki etiketler atlanır. Duyguyu kelime ve noktalamayla ver.'; box.append(n); return; }
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
    if (kind === 'side') {
      const sideVal = scene.visual[key] || (scene.visual[key] = { title: '', items: [] });
      const t = document.createElement('input'); t.type = 'text'; t.placeholder = 'Taraf adı (ör. K1)'; t.value = sideVal.title; t.maxLength = 40;
      const list = document.createElement('textarea'); list.rows = 3; list.placeholder = 'Her satıra bir madde (en fazla 4)'; list.value = sideVal.items.join('\n');
      t.addEventListener('input', () => { sideVal.title = t.value.slice(0, 40); onChange(); });
      list.addEventListener('input', () => { sideVal.items = list.value.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 4).map(x => x.slice(0, 50)); onChange(); });
      wrap.append(t, list); return wrap;
    }
    if (kind === 'pairs' || kind === 'lines' || kind === 'area' || kind === 'specs') {
      input = document.createElement('textarea'); input.rows = 3;
      input.value = kind === 'pairs' ? scene.visual.items.map(i => `${i.value} | ${i.text}`).join('\n') : kind === 'specs' ? scene.visual.items.map(i => `${i.text} | ${i.value}`).join('\n') : kind === 'lines' ? scene.visual.items.map(i => i.text || i.value).join('\n') : scene.visual[key] || '';
    } else { input = document.createElement('input'); input.type = 'text'; input.value = scene.visual[key] || ''; }
    input.addEventListener('input', () => {
      if (kind === 'pairs') scene.visual.items = input.value.split('\n').map(l => l.split('|')).filter(p => p.join('').trim()).slice(0, 3).map(([v, ...t]) => ({ value: v.trim().slice(0, 12), text: t.join('|').trim().slice(0, 60) }));
      else if (kind === 'specs') scene.visual.items = input.value.split('\n').map(l => l.split('|')).filter(p => p.join('').trim()).slice(0, 5).map(([t, ...v]) => ({ text: t.trim().slice(0, 60), value: v.join('|').trim().slice(0, 24) }));
      else if (kind === 'lines') scene.visual.items = input.value.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 5).map(t => ({ value: '', text: t.slice(0, 60) }));
      else scene.visual[key] = input.value.slice(0, key === 'quote' ? 260 : 140);
      onChange();
    });
    wrap.append(input); return wrap;
  }
  function visualSummary(scene) {
    const v = scene.visual, text = v.heading || v.quote || v.value || (v.type === 'comparison' && v.left?.title ? `${v.left.title} vs ${v.right?.title || '…'}` : '') || v.items?.[0]?.text || '';
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
        if (parsed.unknown.length && state.tts !== 'ema') notes.push(`Tanınmayan etiket: ${parsed.unknown.map(t => `[${t}]`).join(', ')} — seslendirmede atlanır.`);
        if (parsed.unsupported.length && state.tts !== 'ema') notes.push(`${state.tts === 'eleven' ? 'ElevenLabs' : 'Gemini TTS'} bu etiketi desteklemiyor: ${parsed.unsupported.map(t => `[${t}]`).join(', ')} — atlanır.`);
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
        body.append(mediaPicker(scene, () => { build(); onVisual(); }));
        const typeWrap = document.createElement('label'); typeWrap.className = 'vv-field'; typeWrap.textContent = 'Sahne tipi';
        const select = document.createElement('select');
        for (const t of V.VISUAL_TYPES) { const o = document.createElement('option'); o.value = t; o.textContent = TYPE_LABELS[t]; select.append(o); }
        select.value = scene.visual.type;
        select.addEventListener('change', () => {
          scene.visual.type = select.value;
          if (select.value === 'comparison') { scene.visual.left = scene.visual.left || { title: '', items: [] }; scene.visual.right = scene.visual.right || { title: '', items: [] }; }
          if (scene.direction?.variant && !V.VARIANTS[select.value].includes(scene.direction.variant)) delete scene.direction.variant;
          build(); onVisual();
        });
        typeWrap.append(select);
        const kw = document.createElement('label'); kw.className = 'vv-field'; kw.textContent = 'Stok medya araması (İngilizce)';
        const kwInput = document.createElement('input'); kwInput.type = 'text'; kwInput.value = scene.keywords || ''; kwInput.maxLength = 80;
        kwInput.addEventListener('input', () => { scene.keywords = kwInput.value; changed(); });
        kw.append(kwInput);
        body.append(typeWrap, kw, ...FIELDS[scene.visual.type].map(f => field(scene, f, onVisual)), directionBox(scene, onVisual));
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
  // AI Sahne Yönetmeni kararları: boş seçim = temanın/yönetmenin varsayılanı
  function directionBox(scene, onChange) {
    const d = scene.direction || (scene.direction = {});
    const box = document.createElement('fieldset'); box.className = 'vv-direction wide';
    const legend = document.createElement('legend'); legend.textContent = 'Sahne yönetmeni'; box.append(legend);
    const sel = (label, options, value, set) => {
      const wrap = document.createElement('label'); wrap.className = 'vv-field'; wrap.textContent = label;
      const s = document.createElement('select');
      const def = document.createElement('option'); def.value = ''; def.textContent = 'Tema varsayılanı'; s.append(def);
      for (const [v, t] of options) { const o = document.createElement('option'); o.value = v; o.textContent = t; s.append(o); }
      s.value = value || ''; s.addEventListener('change', () => { set(s.value); onChange(); });
      wrap.append(s); return wrap;
    };
    const variants = V.VARIANTS[scene.visual.type] || [];
    if (variants.length > 1) box.append(sel('Düzen', variants.map(v => [v, VARIANT_LABELS[v] || v]), d.variant, v => { if (v) d.variant = v; else delete d.variant; }));
    box.append(sel('Görsel yerleşimi', V.DIRECTION.hero.map(v => [v, HERO_LABELS[v]]), d.hero, v => { if (v) d.hero = v; else delete d.hero; }));
    box.append(sel('Geçiş', V.DIRECTION.transition.map(v => [v, TRANSITION_LABELS[v]]), d.transition, v => { if (v) d.transition = v; else delete d.transition; }));
    const ew = document.createElement('label'); ew.className = 'vv-field'; ew.textContent = 'Vurgulanan kelime';
    const wi = document.createElement('input'); wi.type = 'text'; wi.maxLength = 40; wi.placeholder = 'Başlıktan bir kelime'; wi.value = d.emphasis?.word || '';
    wi.addEventListener('input', () => { const word = wi.value.trim(); d.emphasis = { word, style: d.emphasis?.style || '' }; if (!word && !d.emphasis.style) delete d.emphasis; onChange(); });
    ew.append(wi); box.append(ew);
    box.append(sel('Vurgu tarzı', V.DIRECTION.emphasis.map(v => [v, EMPHASIS_LABELS[v]]), d.emphasis?.style, v => { d.emphasis = { word: d.emphasis?.word || '', style: v }; if (!d.emphasis.word && !v) delete d.emphasis; }));
    return box;
  }
  // Sahne görseli: sayfadan (Gemini'ın önerdiği veya galeriden) ya da kullanıcı dosyası
  function mediaPicker(scene, onChange) {
    const box = document.createElement('div'); box.className = 'vv-media wide';
    const preview = document.createElement('div'); preview.className = 'vv-media-preview';
    const m = scene.media;
    if (m) {
      const cut = m.cutout && m.cutThumb;
      if (cut) preview.classList.add('cut');
      const img = document.createElement('img'); img.alt = ''; img.src = cut ? m.cutThumb : m.source === 'page' ? m.url : (m.thumb || '');
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
    // Arka planı kaldır: ürün/kişi zeminden ayrılır, sahnede kartsız ve gölgeli durur
    if (m && m.kind === 'image') {
      const cutRow = document.createElement('label'); cutRow.className = 'cmp-check vv-cut-row';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!m.cutout; cb.disabled = !!state.running;
      const status = document.createElement('span'); status.className = 'cmp-check-sub vv-cut-status';
      status.textContent = m.cutout ? (m.cutThumb ? '(hazır)' : '(üretimde uygulanır)') : '(ürün veya kişi fotoğraflarında en iyi sonucu verir)';
      cb.addEventListener('change', async () => {
        if (!cb.checked) { delete m.cutout; delete m.cutThumb; onChange(); return; }
        cb.disabled = true; status.dataset.busy = '1'; status.textContent = '(arka plan kaldırılıyor…)';
        const r = await window.api.vvCutout(m);
        delete status.dataset.busy;
        if (scene.media !== m) return; // bu sırada görsel değiştirildi
        if (r.error) { cb.checked = false; cb.disabled = false; status.textContent = ''; showError(r.error); return; }
        showError(''); m.cutout = true; m.cutThumb = r.thumb || undefined; if (!m.cutThumb) delete m.cutThumb; onChange();
      });
      cutRow.append(cb, document.createTextNode(' Arka planı kaldır '), status);
      side.append(cutRow);
    }
    box.append(preview, side, gallery);
    return box;
  }
  window.api.onVvCutoutProgress?.(pct => document.querySelectorAll('.vv-cut-status[data-busy]').forEach(el => { el.textContent = `(model indiriliyor, bir kerelik ~180 MB: %${pct})`; }));
  window.vvDropOutside = () => showError('Görseli veya videoyu kullanmak istediğin sahnenin kartına bırak.');

  $('vvTitle').addEventListener('input', () => { if (state.script) { state.script.title = $('vvTitle').value.slice(0, 120); changed(); } });
  $('vvAddScene').addEventListener('click', () => {
    if (!state.script || state.script.scenes.length >= 40) return;
    state.script.scenes.push(V.normalizeScene({ narration: '[normal] ', visual: { type: 'statement' } }));
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
      setProgress(state.format === 'podcast' ? 'Senaryo yazılıyor (Gemini)… podcast senaryosu 1-2 dakika sürebilir' : 'Senaryo yazılıyor (Gemini)…', fromUrl ? 30 : 25);
      const r = await window.api.vvScript({ source, title, format: state.format, length: state.length, provider: state.tts, themeId: state.themeId, designNote: state.designNote, fromUrl, images });
      if (r.cancelled) return;
      if (r.error) { showError(r.error); return; }
      state.script = { ...r.script, format: state.format, length: state.length }; state.sourceText = source; state.sourceTitle = title; state.fromUrl = fromUrl; state.pageImages = images;
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
    const mismatch = scriptMismatch();
    if (mismatch && !confirm(`${mismatch}
Video bu senaryoyla ${FORMAT_NAMES[state.format]} biçiminde üretilsin mi? (Uygun metin için önce "Metni yeniden hazırla".)`)) return;
    const empty = state.script.scenes.findIndex(s => !V.plainText(s.narration));
    if (empty >= 0) { showError(`Sahne ${empty + 1} için seslendirilecek metin yok.`); return; }
    showError(''); setRunning('produce'); setProgress('Başlatılıyor…', 1);
    const key = productionKey();
    try {
      const r = await window.api.vvProduce({
        projectId: state.projectId, title: state.script.title, format: state.format, provider: state.tts, voice: $('vvVoice').value,
        themeId: state.themeId, waveMode: state.format === 'podcast' ? state.wave : 'none', mediaMode: state.media, captions: state.captions, safeArea: state.format !== 'reels' || state.safeArea, sfx: state.sfx, music: state.music,
        scenes: state.script.scenes, outDir: settings?.lastFolder || $('folder')?.textContent || null
      });
      if (r.cancelled) { showToast('Video üretimi iptal edildi'); return; }
      if (r.error) { showError(r.error + (r.warnings?.length ? '\n' + r.warnings.join('\n') : '')); return; }
      state.result = r; state.producedKey = key; state.result.burned = state.captions;
      const name = r.outFile.split(/[\\/]/).pop();
      $('vvPreview').src = fileUrl(r.outFile) + `?v=${Date.now()}`;
      $('vvResultTitle').textContent = `Video hazır — ${name}`;
      $('vvResultSub').textContent = [`${fmtClock(r.duration)} · ${r.scenes.length} sahne`, r.bpm ? `geçişler ${Math.round(r.bpm)} BPM ritme oturtuldu` : '', r.rendered < r.scenes.length ? `${r.rendered} sahne yeniden üretildi` : '', r.credits ? `${r.credits} Pexels kaynağı listelendi` : '', ...(r.warnings || [])].filter(Boolean).join(' · ');
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
    $('vvDesignNote').value = state.designNote;
    loadTheme();
    if (state.script) renderScenes();
    loadVoices(); refresh();
  })();
})();
