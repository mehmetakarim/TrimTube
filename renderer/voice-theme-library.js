/* Tema kütüphanesi: hazır ve kullanıcı temaları, önizlemeli seçim, düzenleyici
   ve tasarım tarifinden (prompt) Gemini ile tema oluşturma. Anlatımlı Video
   ekranı window.vvThemeLibrary.open(seçiliId, onSeç) ile açar. */
(() => {
  const T = window.VoiceThemes;
  const FONT_GENERIC = f => /Fraunces|Playfair|DM Serif/.test(f) ? 'Georgia,"Times New Roman",serif' : /Mono/.test(f) ? 'Consolas,"Courier New",monospace' : /Caveat|Marker/.test(f) ? '"Segoe Print","Comic Sans MS",cursive' : /Anton|Bebas|Oswald|Archivo/.test(f) ? 'Impact,"Arial Narrow",sans-serif' : '"Segoe UI",Arial,sans-serif';
  const LABELS = {
    background: { glow: 'Koyu ışıltı', paper: 'Kâğıt dokusu', grid: 'Teknik ızgara', soft: 'Yumuşak gradyan' },
    card: { glass: 'Cam', paper: 'Kâğıt', solid: 'Düz', outline: 'Çerçeve' },
    frame: { card: 'Yuvarlak kart', tape: 'Bantlı kolaj', polaroid: 'Polaroid', hud: 'HUD köşeleri', soft: 'Yumuşak gölge' },
    energy: { calm: 'Sakin', normal: 'Dengeli', punchy: 'Enerjik' },
    transition: { whip: 'Savrulma (whip)', zoom: 'Yakınlaşma', slide: 'Kayma', flash: 'Flaş', cut: 'Kesme' },
    emphasis: { marker: 'İşaretleyici', underline: 'El çizimi alt çizgi', circle: 'Karalama daire', color: 'Renk', box: 'Kutu' },
    motifs: { dust: 'Toz', comets: 'Işık izi', sweep: 'Işık süpürmesi', blobs: 'Renk lekeleri', dots: 'Nokta ızgara', tape: 'Maskeleme bandı', arrows: 'El çizimi ok', scribble: 'Karalama', halftone: 'Halftone', registration: 'Hizalama işareti', torn: 'Yırtık kâğıt', hud: 'HUD çizgileri', scanline: 'Tarama ışığı', grain: 'Gren' },
    position: { 'top-left': 'Sol üst', 'top-right': 'Sağ üst', 'bottom-left': 'Sol alt', 'bottom-right': 'Sağ alt' }
  };
  let library = { builtIn: T.BUILT_IN, custom: [] }, onPick = null, currentId = 'neon', editing = null, reference = null, busy = false;
  const all = () => [...library.builtIn, ...library.custom];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // Küçük 9:16 önizleme: zemin, başlık yazı tipi ailesi, vurgu, kart ve motif ipuçları
  function preview(theme, big = false) {
    const c = theme.colors, a = c.accents[0], b2 = c.accents[1] || a;
    const box = el('div', 'vv-tp' + (big ? ' big' : ''));
    const bg = theme.background === 'glow' ? `radial-gradient(circle at 25% 15%,${a}55,transparent 55%),radial-gradient(circle at 85% 90%,${b2}40,transparent 55%),${c.bg}`
      : theme.background === 'soft' ? `radial-gradient(circle at 30% 20%,${c.bg2},transparent 60%),radial-gradient(circle at 80% 85%,${a}38,transparent 55%),${c.bg}`
        : theme.background === 'grid' ? `linear-gradient(${a}22 1px,transparent 1px) 0 0/18px 18px,linear-gradient(90deg,${a}22 1px,transparent 1px) 0 0/18px 18px,${c.bg}`
          : `${c.bg}`;
    box.style.background = bg; box.style.color = c.ink;
    if (theme.motifs.includes('torn')) { const t = el('i', 'vv-tp-torn'); t.style.background = a; box.append(t); }
    if (theme.motifs.includes('hud') || theme.background === 'grid') for (const pos of ['tl', 'tr', 'bl', 'br']) { const h = el('i', 'vv-tp-hud ' + pos); h.style.borderColor = a; box.append(h); }
    if (theme.label) { const l = el('span', 'vv-tp-label', theme.label); l.style.background = a; l.style.color = T.contrast(a, '#ffffff') >= T.contrast(a, '#111111') ? '#fff' : '#111'; l.style.fontFamily = FONT_GENERIC(theme.fonts.label); box.append(l); }
    const h = el('div', 'vv-tp-head');
    h.style.fontFamily = FONT_GENERIC(theme.fonts.display); h.style.fontWeight = theme.type.weight; h.style.textTransform = theme.type.case === 'upper' ? 'uppercase' : 'none';
    const w1 = el('span', '', 'Örnek '), w2 = el('span', 'vv-tp-mark', 'başlık');
    const emph = theme.emphasis[0];
    if (emph === 'marker') w2.style.background = `linear-gradient(transparent 58%,${a}d0 58%)`;
    else if (emph === 'box') { w2.style.background = a; w2.style.color = T.contrast(a, '#ffffff') >= T.contrast(a, '#111111') ? '#fff' : '#111'; }
    else if (emph === 'underline' || emph === 'circle') { w2.style.textDecoration = `underline ${a} 3px`; w2.style.textUnderlineOffset = '4px'; }
    else w2.style.color = a;
    h.append(w1, w2);
    const card = el('div', 'vv-tp-card');
    card.style.background = theme.card === 'outline' ? 'transparent' : c.card; card.style.borderRadius = Math.min(theme.radius, 14) + 'px';
    card.style.border = theme.card === 'outline' ? `2px solid ${a}` : `1px solid ${c.ink}22`; card.style.color = c.ink;
    for (let k = 0; k < 2; k++) { const r = el('i', 'vv-tp-row'); r.style.background = k ? `${c.ink}33` : a; card.append(r); }
    const dots = el('div', 'vv-tp-dots');
    c.accents.slice(0, 4).forEach(x => { const d = el('i'); d.style.background = x; dots.append(d); });
    box.append(h, card, dots);
    if (theme.logo?.thumb) { const lg = el('img', 'vv-tp-logo'); lg.src = theme.logo.thumb; lg.alt = ''; box.append(lg); }
    return box;
  }

  async function load() { try { const r = await window.api.vvThemes(); if (r?.builtIn) library = r; } catch {} }
  const modal = () => document.getElementById('vvThemeModal');
  function status(msg, err) { const s = document.getElementById('vvThemeStatus'); s.textContent = msg || ''; s.classList.toggle('err', !!err); }

  function renderGrid() {
    const grid = document.getElementById('vvThemeGrid'); grid.replaceChildren();
    for (const theme of all()) {
      const card = el('div', 'vv-theme-card' + (theme.id === currentId ? ' active' : ''));
      card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `${theme.name} temasını seç`);
      const meta = el('div', 'vv-theme-meta');
      meta.append(el('b', '', theme.name), el('span', '', theme.builtIn ? 'Hazır tema' : 'Senin teman'), el('p', '', theme.description || ''));
      const actions = el('div', 'vv-theme-actions');
      const btn = (text, fn, primary) => { const b = el('button', primary ? 'btn-primary small' : 'btn-ghost small', text); b.type = 'button'; b.addEventListener('click', e => { e.stopPropagation(); fn(); }); actions.append(b); };
      btn(theme.id === currentId ? 'Seçili' : 'Seç', () => pick(theme), theme.id !== currentId);
      btn(theme.builtIn ? 'Çoğalt' : 'Düzenle', () => edit(theme.builtIn ? { ...JSON.parse(JSON.stringify(theme)), id: undefined, builtIn: false, name: theme.name + ' (kopya)' } : theme));
      if (!theme.builtIn) btn('Sil', async () => { if (!confirm(`“${theme.name}” silinsin mi?`)) return; await window.api.vvThemeDelete(theme.id); if (currentId === theme.id) pick(T.BUILT_IN[0]); await load(); renderGrid(); });
      card.append(preview(theme), meta, actions);
      card.addEventListener('click', () => pick(theme));
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(theme); } });
      grid.append(card);
    }
    const add = el('button', 'vv-theme-card vv-theme-add'); add.type = 'button';
    add.append(el('span', '', '＋'), el('b', '', 'Yeni tema'), el('p', '', 'Tasarım tarifinden (prompt) ya da elle oluştur; renkler, logo ve yazı tipleriyle kendi stilini ekle.'));
    add.addEventListener('click', () => edit(null));
    grid.append(add);
  }
  function pick(theme) { currentId = theme.id; onPick?.(theme); renderGrid(); status(`“${theme.name}” seçildi.`); }
  function view(editor) {
    document.getElementById('vvThemeGrid').classList.toggle('hidden', editor);
    document.getElementById('vvThemeEditor').classList.toggle('hidden', !editor);
    document.getElementById('vvThemeTitle').textContent = editor ? (editing?.id ? 'Temayı düzenle' : 'Yeni tema') : 'Tema kütüphanesi';
    document.getElementById('vvThemeBack').classList.toggle('hidden', !editor);
  }

  // ---- düzenleyici ----
  function edit(theme) {
    editing = T.normalizeTheme(theme || { ...T.BUILT_IN[0], id: undefined, name: 'Yeni tema', description: '' });
    if (theme?.logo?.thumb) editing.logo = { ...editing.logo, thumb: theme.logo.thumb };
    if (theme?.id && !theme.builtIn) editing.id = theme.id; else editing.id = undefined;
    reference = null; renderEditor(); view(true); status('');
  }
  function select(options, value, onChange) {
    const s = el('select');
    for (const [v, label] of Object.entries(options)) { const o = el('option', '', label); o.value = v; s.append(o); }
    s.value = value; s.addEventListener('change', () => onChange(s.value)); return s;
  }
  function row(label, control, wide) { const l = el('label', 'vv-field' + (wide ? ' wide' : '')); l.append(el('span', '', label), control); return l; }
  function colorInput(value, onChange) { const i = el('input'); i.type = 'color'; i.value = value; i.addEventListener('input', () => onChange(i.value)); return i; }
  function renderEditor() {
    const form = document.getElementById('vvThemeForm'); form.replaceChildren();
    const t = editing, c = t.colors;
    const update = () => { const pv = document.getElementById('vvThemePreview'); const n = T.normalizeTheme(t); if (t.logo) n.logo = t.logo; pv.replaceChildren(preview(n, true)); };
    // Prompttan oluştur
    const ai = el('section', 'vv-theme-ai');
    ai.append(el('h3', '', 'Tasarım tarifinden oluştur'), el('p', '', 'Kapak/marka prompt\'unu ya da stil tarifini yapıştır. İstersen örnek bir kapak görseli ekle; Gemini bunu motorun anlayacağı bir temaya çevirir. Ardından aşağıdan düzeltebilirsin.'));
    const ta = el('textarea', 'vv-textarea'); ta.rows = 6; ta.placeholder = 'ör. Renk sistemi sabit: #F9B233 sarı, kömür siyahı, kırık beyaz kâğıt… analog kolaj, maskeleme bandı, el çizimi oklar…'; ta.value = t._prompt || '';
    ta.addEventListener('input', () => { t._prompt = ta.value; });
    const refRow = el('div', 'vv-theme-ref');
    const refLabel = el('span', '', reference ? reference.name : 'Örnek görsel yok');
    const refBtn = el('button', 'btn-ghost small', 'Örnek görsel ekle…'); refBtn.type = 'button';
    refBtn.addEventListener('click', async () => { const r = await window.api.vvChooseImage(); if (r?.ok) { reference = r; refLabel.textContent = r.name; } });
    const go = el('button', 'btn-primary small', 'Gemini ile oluştur'); go.type = 'button';
    go.addEventListener('click', async () => {
      if (busy) return; if ((t._prompt || '').trim().length < 20) { status('Tasarım tarifini yapıştır (en az birkaç cümle).', true); return; }
      busy = true; go.disabled = true; status('Gemini tasarım tarifini inceliyor…');
      try {
        const r = await window.api.vvThemeFromPrompt({ prompt: t._prompt, reference: reference?.path || null });
        if (r.error) { status(r.error, true); return; }
        if (r.cancelled) return;
        const keep = { id: t.id, logo: t.logo, _prompt: t._prompt };
        editing = Object.assign(T.normalizeTheme(r.theme), keep);
        renderEditor(); status('Tema oluşturuldu. Önizlemeyi kontrol et, gerekirse düzelt ve kaydet.');
      } finally { busy = false; go.disabled = false; }
    });
    refRow.append(refLabel, refBtn, go);
    ai.append(ta, refRow);
    form.append(ai);
    // Elle düzenleme
    const grid = el('div', 'vv-theme-fields');
    const name = el('input'); name.type = 'text'; name.maxLength = 40; name.value = t.name; name.addEventListener('input', () => { t.name = name.value; });
    const desc = el('input'); desc.type = 'text'; desc.maxLength = 220; desc.value = t.description; desc.addEventListener('input', () => { t.description = desc.value; });
    grid.append(row('Tema adı', name), row('Açıklama (yönetmene ipucu)', desc, true));
    grid.append(row('Zemin', colorInput(c.bg, v => { c.bg = v; update(); })), row('Yazı', colorInput(c.ink, v => { c.ink = v; update(); })), row('İkincil yazı', colorInput(c.muted, v => { c.muted = v; update(); })), row('Kart', colorInput(c.card, v => { c.card = v; update(); })));
    const acc = el('div', 'vv-theme-accents');
    c.accents.slice(0, 4).forEach((x, k) => acc.append(colorInput(x, v => { c.accents[k] = v; update(); })));
    if (c.accents.length < 4) { const plus = el('button', 'btn-ghost small', '＋ renk'); plus.type = 'button'; plus.addEventListener('click', () => { c.accents.push('#888888'); renderEditor(); }); acc.append(plus); }
    grid.append(row('Vurgu renkleri (ilki ana marka rengi)', acc, true));
    const fonts = Object.fromEntries(T.FONTS.map(f => [f, f]));
    grid.append(row('Başlık yazı tipi', select(fonts, t.fonts.display, v => { t.fonts.display = v; update(); })), row('Metin yazı tipi', select(fonts, t.fonts.body, v => { t.fonts.body = v; })), row('Etiket yazı tipi', select(fonts, t.fonts.label, v => { t.fonts.label = v; update(); })));
    grid.append(row('Başlık kalınlığı', select({ 400: 'İnce', 600: 'Orta', 700: 'Kalın', 800: 'Çok kalın', 900: 'Siyah' }, String(t.type.weight), v => { t.type.weight = +v; update(); })), row('Harf', select({ normal: 'Normal', upper: 'BÜYÜK HARF' }, t.type.case, v => { t.type.case = v; update(); })));
    grid.append(row('Zemin türü', select(LABELS.background, t.background, v => { t.background = v; update(); })), row('Kart', select(LABELS.card, t.card, v => { t.card = v; update(); })), row('Görsel çerçevesi', select(LABELS.frame, t.frame, v => { t.frame = v; })));
    const radius = el('input'); radius.type = 'range'; radius.min = 0; radius.max = 60; radius.value = t.radius; radius.addEventListener('input', () => { t.radius = +radius.value; update(); });
    grid.append(row('Köşe yuvarlaklığı', radius), row('Hareket', select(LABELS.energy, t.energy, v => { t.energy = v; })), row('Varsayılan geçiş', select(LABELS.transition, t.transition, v => { t.transition = v; })), row('Varsayılan vurgu', select(LABELS.emphasis, t.emphasis[0], v => { t.emphasis = [v, ...t.emphasis.filter(x => x !== v)].slice(0, 3); update(); })));
    const label = el('input'); label.type = 'text'; label.maxLength = 24; label.placeholder = 'ör. KARŞILAŞTIRMA'; label.value = t.label || ''; label.addEventListener('input', () => { t.label = label.value; update(); });
    grid.append(row('Başlık etiketi (isteğe bağlı)', label));
    const motifs = el('div', 'vv-theme-motifs');
    for (const m of T.MOTIFS) {
      const l = el('label', 'cmp-check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = t.motifs.includes(m);
      cb.addEventListener('change', () => { t.motifs = cb.checked ? [...t.motifs, m].slice(0, 6) : t.motifs.filter(x => x !== m); renderEditor(); });
      cb.disabled = !cb.checked && t.motifs.length >= 6;
      l.append(cb, document.createTextNode(' ' + LABELS.motifs[m])); motifs.append(l);
    }
    grid.append(row('Dekor motifleri (en fazla 6)', motifs, true));
    // Logo
    const logo = el('div', 'vv-theme-logo');
    if (t.logo?.thumb) { const im = el('img'); im.src = t.logo.thumb; im.alt = ''; logo.append(im); }
    const lb = el('button', 'btn-ghost small', t.logo ? 'Logoyu değiştir…' : 'Logo ekle…'); lb.type = 'button';
    lb.addEventListener('click', async () => { const r = await window.api.vvThemeLogo(); if (r?.error) { status(r.error, true); return; } if (r?.ok) { t.logo = { file: r.file, position: t.logo?.position || 'top-right', size: t.logo?.size || 140, thumb: r.thumb }; renderEditor(); } });
    logo.append(lb);
    if (t.logo) {
      logo.append(select(LABELS.position, t.logo.position, v => { t.logo.position = v; }));
      const rm = el('button', 'btn-ghost small', 'Kaldır'); rm.type = 'button'; rm.addEventListener('click', () => { t.logo = null; renderEditor(); }); logo.append(rm);
    }
    grid.append(row('Logo', logo, true));
    form.append(grid);
    update();
  }
  async function save() {
    const draft = { ...editing }; delete draft._prompt;
    if (draft.logo) { draft.logo = { ...draft.logo }; delete draft.logo.thumb; }
    if (!String(draft.name || '').trim()) { status('Tema adı gerekli.', true); return; }
    const r = await window.api.vvThemeSave(draft);
    if (r.error) { status(r.error, true); return; }
    await load(); const saved = all().find(x => x.id === r.theme.id) || r.theme;
    view(false); pick(saved); status(`“${saved.name}” kaydedildi ve seçildi.`);
  }

  function close() { modal().classList.add('hidden'); document.getElementById('vvThemeOpen')?.focus(); }
  document.getElementById('vvThemeClose').addEventListener('click', close);
  document.getElementById('vvThemeBack').addEventListener('click', () => { view(false); status(''); });
  document.getElementById('vvThemeCancel').addEventListener('click', () => { view(false); status(''); });
  document.getElementById('vvThemeSaveBtn').addEventListener('click', save);
  modal().addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  modal().addEventListener('click', e => { if (e.target === modal()) close(); });

  window.vvThemeLibrary = {
    async open(id, handler) { currentId = id; onPick = handler; await load(); view(false); renderGrid(); status(''); modal().classList.remove('hidden'); document.getElementById('vvThemeClose').focus(); },
    async resolve(id) { await load(); return all().find(t => t.id === id) || T.BUILT_IN[0]; },
    preview
  };
})();
