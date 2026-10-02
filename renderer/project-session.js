/* Local recovery and bounded undo for editor decisions, never for running jobs. */
(() => {
  const copy = TimelineData.copy;
  let history = [], cursor = -1, applying = false, timer = null, persistTimer = null, source = '', recovery = null, reading = true, writes = Promise.resolve();
  const state = document.createElement('div'); state.id = 'sessionSaveState'; state.className = 'session-save-state'; state.setAttribute('role', 'status'); state.textContent = 'Değişiklikler bu cihazda otomatik saklanır.';
  $('sequenceDesk').append(state);
  const banner = document.createElement('div'); banner.id = 'sessionRecovery'; banner.className = 'session-recovery hidden';
  banner.innerHTML = '<span id="sessionRecoveryText"></span><button id="sessionRestore" class="btn-ghost small">Geri yükle</button><button id="sessionDismiss" class="btn-ghost small">Yeni çalışmayla devam et</button>';
  $('sequenceDesk').before(banner);
  const key = () => JSON.stringify([currentVideoId, currentLocalFile]);
  function snapshot() { const p = copy(buildProject()); delete p.queue; delete p.queueState; return p; }
  function buttons() { $('editUndo').disabled = cursor <= 0; $('editRedo').disabled = cursor >= history.length - 1; $('reviewUndo').disabled = $('editUndo').disabled; $('reviewRedo').disabled = $('editRedo').disabled; }
  function persist() {
    clearTimeout(persistTimer);
    if (applying || reading || recovery || !infoLoaded) return;
    persistTimer = setTimeout(() => {
      if (!infoLoaded || recovery || applying) return;
      const project = copy(buildProject());
      state.textContent = 'Taslak kaydediliyor…';
      writes = writes.catch(() => {}).then(() => window.api.projectDraftSave(project)).then(result => {
        state.textContent = result?.ok ? 'Taslak kaydedildi · bu cihazda' : result?.error || 'Taslak kaydedilemedi. Projeyi dosyaya kaydedin.';
      }).catch(err => { state.textContent = 'Taslak kaydedilemedi: ' + err.message; });
    }, 350);
  }
  function checkpoint() {
    clearTimeout(timer);
    if (applying || !infoLoaded) return;
    if (source !== key()) { source = key(); history = []; cursor = -1; }
    const current = snapshot(), serialized = JSON.stringify(current);
    if (cursor < 0 || serialized !== JSON.stringify(history[cursor])) {
      history = history.slice(0, cursor + 1); history.push(current);
      while (history.length > 1 && (history.length > 50 || JSON.stringify(history).length > 8 * 1024 * 1024)) history.shift();
      cursor = history.length - 1;
    }
    buttons(); persist();
  }
  function restore(index) {
    checkpoint();
    if (index < 0 || index >= history.length || source !== key()) return;
    const project = copy(history[index]), modalOpen = !$('trackPreviewModal').classList.contains('hidden');
    if (modalOpen) {
      const current = snapshot();
      if (JSON.stringify([project.trimEnable, project.trim, project.track, project.subtitle?.source]) !== JSON.stringify([current.trimEnable, current.trim, current.track, current.subtitle?.source])) {
        $('reviewSaveStatus').textContent = 'Kaynak aralığı değişikliğini geri almak için önce kontrol masasını kapat.'; return;
      }
    }
    applying = true;
    try {
      if (modalOpen) {
        subStyleValue = project.subtitle.style;
        document.querySelectorAll('#subStyles .seg').forEach(b => b.classList.toggle('active', b.dataset.substyle === subStyleValue));
        $('reviewStyle').value = subStyleValue;
        window.reviewApplyProject(project.review, true);
      } else applyProjectSettings(project, true);
      window.reviewRefreshCues?.(); cursor = index;
    }
    finally { applying = false; buttons(); persist(); }
  }
  $('editUndo').onclick = () => { checkpoint(); restore(cursor - 1); };
  $('editRedo').onclick = () => restore(cursor + 1);
  window.sessionCheckpoint = checkpoint; window.sessionCommit = checkpoint; window.sessionPersist = persist;
  function schedule(e) {
    if (applying || !infoLoaded || e.target.closest('#sequenceScroll, #sequenceZoom, #sessionRecovery')) return;
    if (!e.target.closest('#viewCutter, #trackPreviewModal')) return;
    clearTimeout(timer); timer = setTimeout(checkpoint, e.type === 'input' ? 400 : 0);
  }
  for (const event of ['input', 'change', 'click', 'pointerup']) document.addEventListener(event, schedule);
  document.addEventListener('keydown', e => {
    if ((!e.ctrlKey && !e.metaKey) || e.altKey || e.isComposing || currentView !== 'cutter') return;
    if (e.target.isContentEditable || e.target.closest('input,textarea,select,[role="textbox"]') || document.querySelector('.modal-overlay:not(.hidden)')) return;
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('editRedo') : $('editUndo')).click(); }
    if (e.key.toLowerCase() === 'y') { e.preventDefault(); $('editRedo').click(); }
  });
  const sourceChanged = window.studioSourceChanged;
  window.studioSourceChanged = (...args) => { clearTimeout(timer); clearTimeout(persistTimer); sourceChanged?.(...args); history = []; cursor = -1; source = key(); buttons(); setTimeout(checkpoint, 0); };
  $('sessionDismiss').onclick = () => { recovery = null; banner.classList.add('hidden'); persist(); };
  $('sessionRestore').onclick = async () => {
    if (queueRunning || tp.generating) { state.textContent = 'Geri yüklemek için devam eden işlemi tamamlayın.'; return; }
    const p = recovery?.project; if (!p) return;
    applying = true; $('sessionRestore').disabled = true;
    try {
      let loaded = false;
      if (p.localFile) loaded = await loadLocalFile(p.localFile);
      else if (p.url) { $('url').value = p.url; loaded = await fetchInfo(); }
      if (!loaded) throw Error('Taslak kaynağı açılamadı. Kaynak dosyayı veya bağlantıyı kontrol edin.');
      applyProjectSettings(p, true);
      queue.splice(0, queue.length, ...(p.queueState || (p.queue || []).map(opts => ({ opts }))).filter(j => j?.opts));
      renderQueue(); updateDownloadBtn(); history = []; cursor = -1; recovery = null; banner.classList.add('hidden');
      showToast('Kurgu ve düzenlemeler taslaktan geri yüklendi');
    } catch (err) { state.textContent = err.message; }
    finally { applying = false; $('sessionRestore').disabled = false; checkpoint(); }
  };
  window.api.projectDraftRead().then(result => {
    if (result?.draft?.app === 'trimtube' && result.draft.project) {
      recovery = result.draft; banner.classList.remove('hidden');
      $('sessionRecoveryText').textContent = `Kaydedilmiş taslak: ${recovery.project.title || 'İsimsiz proje'}. Geri yükle veya yeni çalışmayla devam et.`;
    } else if (result?.error) state.textContent = result.error;
  }).catch(err => { state.textContent = 'Taslak okunamadı: ' + err.message; }).finally(() => { reading = false; if (!recovery) persist(); });
  buttons();
})();
