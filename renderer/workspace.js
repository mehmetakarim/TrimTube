// Görev odaklı çalışma alanları. Mevcut ID'ler ve işlem/iptal kanalları korunur.
(() => {
  const specs = [
    { view: 'compress', id: 'viewCompress', prefix: 'cmp', label: 'Paylaşmaya hazırla', title: 'Daha küçük dosya, aynı hikâye.',
      source: ['cmpDrop', 'cmpFileCard', 'cmpOptions'], output: ['cmpProgress', 'cmpResult', 'cmpError'],
      hint: 'Kaliteyi koru veya bir dosya boyutu hedefle. İşlem tamamlandığında önceki ve yeni boyutu burada karşılaştır.', result: 'cmpResult', setFile: path => cmpSetFile(path), busy: () => cmpRunning },
    { view: 'smarttrim', id: 'viewSmartTrim', prefix: 'st', label: 'Ritmi düzenle', title: 'Konuşma aksın, boşluklar kısalsın.',
      source: ['stDrop', 'stFileCard', 'stOptions'], output: ['stProgress', 'stResults', 'stResultCard', 'stError'],
      hint: 'Önce sessizlikleri tespit et. Ardından kaldırılacak aralıkları gözden geçir; yalnızca seçtiklerin kesilir.', result: 'stResultCard', setFile: path => stSetFile(path), busy: () => stRunning },
    { view: 'ai', id: 'viewAI', label: 'İçeriği keşfet', title: 'Bir videodan daha fazlasını çıkar.',
      source: ['aiKeyWarn', 'aiNoSource', 'aiSourceCard', 'aiTransGroup'], output: ['aiProgress', 'aiTools', 'aiError'],
      hint: 'Videoyu yükle ve transkripti hazırla. Başlık, konu arama, güçlü anlar ve içerik kontrolü aynı metin üzerinde çalışır.' },
    { view: 'mood', id: 'viewMood', label: 'Hikâyeyi kur', title: 'Sahneleri bir anlatıya dönüştür.',
      source: ['mdKeyWarn', 'mdDrop', 'mdLoadedCard', 'mdFileCard', 'mdOptions'], output: ['mdProgress', 'mdPlan', 'mdResult', 'mdError'],
      hint: 'Anlatım tarzını ve süreyi seç. Önce sahne planını gözden geçir; ardından seslendirme ve videoyu oluştur.' },
    { view: 'broll', id: 'viewBroll', prefix: 'br', label: 'Anlattığını göster', title: 'Konuşmana görüntüler eşlik etsin.',
      source: ['brDrop', 'brFileCard', 'brOptions'], output: ['brProgress', 'brResults', 'brResultCard', 'brError'],
      hint: 'Önerilen stok görüntüleri gözden geçir. Seçtiklerin videonun üzerine yerleşir; özgün ses devam eder.', result: 'brResultCard', setFile: path => brSetFile(path), busy: () => brRunning }
  ];
  const states = [];
  function card(title, desc) {
    const el = document.createElement('section'); el.className = 'workspace-card';
    const head = document.createElement('div'); head.className = 'workspace-card-head';
    const h = document.createElement('h2'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = desc;
    head.append(h, p); el.append(head); return el;
  }
  for (const spec of specs) {
    const view = $(spec.id), inner = view.querySelector('.view-inner');
    inner.classList.add('workspace-inner');
    const heading = inner.querySelector('.view-head');
    const eyebrow = document.createElement('span'); eyebrow.className = 'studio-eyebrow'; eyebrow.textContent = spec.label; heading.prepend(eyebrow);
    heading.querySelector('.view-title').setAttribute('role', 'heading');
    heading.querySelector('.view-title').setAttribute('aria-level', '1');
    heading.querySelector('.view-sub').textContent = spec.title;
    const grid = document.createElement('div'); grid.className = 'workspace-grid';
    const input = card('Kaynak ve seçenekler', 'Neyle çalışacağını ve nasıl işleyeceğini belirle.');
    const output = card(spec.view === 'compress' ? 'Boyut karşılaştırması' : 'Öneriler ve sonuç', spec.hint);
    for (const id of spec.source) input.append($(id));
    const empty = document.createElement('div'); empty.className = 'workspace-empty';
    const glyph = document.createElement('span'); glyph.textContent = spec.view === 'compress' ? '↘' : '▷'; glyph.setAttribute('aria-hidden', 'true');
    const note = document.createElement('p'); note.textContent = spec.view === 'compress' ? 'Sıkıştırma sonucu burada görünecek.' : 'Hazır olduğunda sonuçları burada incele.';
    empty.append(glyph, note); output.append(empty);
    for (const id of spec.output) output.append($(id));
    if (spec.prefix) {
      const reuse = document.createElement('button'); reuse.className = 'reuse-source btn-ghost'; reuse.id = `${spec.prefix}ReuseSource`; reuse.textContent = 'Kurgu masasındaki videoyu kullan';
      input.insertBefore(reuse, input.children[1]);
      reuse.addEventListener('click', async () => {
        if (!currentLocalFile || spec.busy()) return;
        reuse.disabled = true;
        try { await spec.setFile(currentLocalFile); } finally { refresh(); }
      });
    }
    if (spec.view === 'broll') {
      const info = document.createElement('div'); info.className = 'tool-callout';
      info.id = 'brKeysHint'; info.textContent = 'Görsel önerileri için Gemini ve Pexels bağlantıları gerekir.';
      const configure = document.createElement('button'); configure.className = 'btn-ghost small'; configure.textContent = 'Bağlantıları ayarla'; configure.addEventListener('click', () => switchView('settings'));
      info.append(configure); input.append(info);
    }
    grid.append(input, output); inner.append(grid);
    const foot = inner.querySelector('.cmp-foot');
    if (foot) { foot.classList.add('workspace-actions'); inner.append(foot); }
    const observe = new MutationObserver(() => {
      empty.classList.toggle('hidden', spec.output.some(id => !$(id).classList.contains('hidden')));
      refreshReuse();
    });
    spec.output.forEach(id => observe.observe($(id), { attributes: true, attributeFilter: ['class'] }));
    if (spec.result) {
      const edit = document.createElement('button'); edit.className = 'btn-ghost small'; edit.id = `${spec.prefix}EditResult`; edit.textContent = 'Kurgu masasında aç'; edit.hidden = true;
      edit.addEventListener('click', async () => {
        if (!edit.dataset.path) return;
        switchView('cutter'); await loadLocalFile(edit.dataset.path);
      });
      $(spec.result).append(edit);
    }
    states.push(spec);
  }
  // Settings use two distinct areas: local preferences and connected services.
  const settingsInner = $('viewSettings').querySelector('.view-inner');
  settingsInner.classList.add('workspace-inner');
  const groups = [...settingsInner.querySelectorAll(':scope > .setting-group')];
  const prefs = card('Çalışma ortamı', 'Tema, çıktı tercihleri ve indirilen dosyalar.');
  const services = card('Bağlantılar', 'Kullandığın araçların anahtarlarını buradan yönet.');
  groups.forEach(group => (group.querySelector('#setGeminiKey') ? services : prefs).append(group));
  const settingsGrid = document.createElement('div'); settingsGrid.className = 'workspace-grid'; settingsGrid.append(prefs, services);
  settingsInner.insertBefore(settingsGrid, $('settingsVersion'));
  document.querySelectorAll('#viewSettings button').forEach(button => { if (button.textContent === 'Ücretsiz anahtar al') button.textContent = 'Anahtar al'; });

  function refreshReuse() {
    for (const spec of states) if (spec.prefix) {
      const btn = $(`${spec.prefix}ReuseSource`);
      btn.classList.toggle('hidden', !currentLocalFile);
      btn.disabled = !currentLocalFile || spec.busy();
      btn.title = currentLocalFile || '';
    }
  }
  function refresh() {
    refreshReuse();
    if (!brRunning) $('brAnalyzeBtn').disabled = !brFile || !(settings?.geminiKey?.trim() && settings?.pexelsKey?.trim());
    const hint = $('brKeysHint');
    if (hint) hint.classList.toggle('hidden', !!(settings?.geminiKey && settings?.pexelsKey));
    const toolbar = document.querySelector('.toolbar');
    toolbar.classList.toggle('tool-view-toolbar', currentView !== 'cutter');
    $('workspaceBack').classList.toggle('hidden', currentView === 'cutter');
    const selected = document.querySelector(`#sideNav [data-view="${currentView}"]`);
    $('workspaceName').textContent = selected?.textContent.trim() || '';
    $('workspaceName').classList.toggle('hidden', currentView === 'cutter');
  }
  window.workspaceResult = (prefix, file) => {
    const button = $(`${prefix}EditResult`); if (!button) return;
    button.dataset.path = file; button.hidden = false;
  };
  const back = document.createElement('button'); back.id = 'workspaceBack'; back.className = 'btn-ghost hidden'; back.textContent = '← Kurgu masası'; back.addEventListener('click', () => switchView('cutter'));
  const name = document.createElement('span'); name.id = 'workspaceName'; name.className = 'workspace-name hidden';
  document.querySelector('.toolbar').append(name, back);
  window.workspaceRefresh = refresh;
  document.querySelectorAll('#sideNav .nav-item').forEach(button => { button.title = button.textContent.trim(); button.setAttribute('aria-label', button.textContent.trim()); });
  refresh();
})();
