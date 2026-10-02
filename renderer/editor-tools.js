// Kadraj, altyazı ve marka araçları. Medya koordinatları element kutusundan ayrıdır.
(() => {
  const panel = document.querySelector('#viewCutter .panel');
  const tabs = document.createElement('div');
  tabs.className = 'editor-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Kesit araçları');
  const area = document.createElement('div'); area.className = 'editor-tool-area';
  panel.insertBefore(tabs, $('trackCard'));
  panel.insertBefore(area, $('trackCard'));
  let activeTab = 'frame';
  const panes = {};
  const buttons = {};
  for (const [key, label, ids] of [['frame', 'Kadraj', ['trackCard']], ['subtitle', 'Altyazı', ['subCard']], ['brand', 'Marka', ['brandCard']]]) {
    const button = document.createElement('button');
    button.id = `toolTab-${key}`; button.textContent = label; button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `toolPane-${key}`);
    const pane = document.createElement('section');
    pane.id = `toolPane-${key}`; pane.className = 'editor-tool-pane';
    pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', button.id);
    const empty = document.createElement('p'); empty.className = 'tool-empty';
    empty.textContent = 'Araçları kullanmak için önce bir video aç.'; pane.append(empty);
    for (const id of ids) pane.append($(id));
    button.addEventListener('click', () => { activeTab = key; refresh(); });
    tabs.append(button); area.append(pane); panes[key] = pane; buttons[key] = button;
  }
  // Output quality belongs with save/export, after the creative controls.
  area.after($('quality').closest('.field'));
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const keys = Object.keys(buttons); const i = keys.indexOf(activeTab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
    buttons[keys[next]].click(); buttons[keys[next]].focus();
  });
  let picking = false;
  let anchoredAt = null;

  function contentRect(video) {
    const rect = video.getBoundingClientRect();
    if (!video.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const width = video.videoWidth * scale, height = video.videoHeight * scale;
    return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
  }
  function marker() {
    const video = $('preview'), rect = contentRect(video);
    const shown = trackPoint && rect && $('trackEnable').checked && trackModeValue === 'single' && Math.abs(video.currentTime - currentRange().start) < 0.3;
    $('trackMarker').classList.toggle('hidden', !shown);
    if (shown) {
      const outer = $('playerWrap').getBoundingClientRect();
      $('trackMarker').style.left = `${rect.left - outer.left + trackPoint.x * rect.width}px`;
      $('trackMarker').style.top = `${rect.top - outer.top + trackPoint.y * rect.height}px`;
    }
  }
  function refresh() {
    const audio = $('quality').value === 'audio';
    const gifOnly = selectedFormats.size === 1 && selectedFormats.has('gif');
    const unavailable = !infoLoaded || audio || gifOnly;
    for (const [key, pane] of Object.entries(panes)) {
      pane.classList.toggle('hidden', key !== activeTab);
      buttons[key].setAttribute('aria-selected', String(key === activeTab));
      buttons[key].tabIndex = key === activeTab ? 0 : -1;
      pane.querySelector('.tool-empty').classList.toggle('hidden', !unavailable);
      pane.querySelector('.tool-empty').textContent = !infoLoaded ? 'Araçları kullanmak için önce bir video aç.' : audio ? 'Ses çıktısında görüntü araçları uygulanmaz.' : 'GIF çıktısına takip, altyazı ve marka uygulanmaz. Bu araçlar için bir video formatı da seç.';
    }
    for (const id of ['trackCard', 'subCard', 'brandCard']) $(id).classList.toggle('hidden', unavailable);
    const on = !unavailable && $('trackEnable').checked;
    const start = currentRange().start;
    if (anchoredAt !== null && Math.abs(start - anchoredAt) > 0.1) { trackPoint = null; anchoredAt = null; picking = false; }
    if (!on || trackModeValue === 'speaker') picking = false;
    $('trackTuning').classList.toggle('hidden', !on);
    $('selectPersonBtn').disabled = !on || trackModeValue === 'speaker' || !previewUrl;
    $('clearPersonBtn').disabled = !on || (!trackPoint && !picking);
    $('selectPersonBtn').textContent = picking ? 'Görüntüde kişiye tıkla' : 'Kişi seç';
    $('personStatus').textContent = trackModeValue === 'speaker'
      ? 'Ses ve ağız hareketiyle konuşan seçilir. Sonucu kadraj önizlemesinde kontrol et.'
      : picking ? `Kesit başlangıcı: ${fmtClock(start)}. Görüntüde kişinin yüzüne tıkla.`
      : trackPoint ? 'Kişi işaretlendi. Başlangıç değişirse yeniden seç.' : 'İlk görünen en büyük yüz otomatik seçilir.';
    $('preview').classList.toggle('picking-person', picking);
    $('trackPreviewBtn').disabled = !on || !previewUrl || queueRunning;
    $('subtitleSourceControls').classList.toggle('hidden', unavailable || !$('subEnable').checked);
    $('subtitleSample').classList.toggle('hidden', unavailable || !$('subEnable').checked);
    $('subtitleSample').dataset.style = subStyleValue;
    $('titleTiming').classList.toggle('hidden', !$('titleEnable').checked);
    $('titleCount').textContent = `${$('titleText').value.length} / 80 karakter`;
    $('wmSizeLabel').textContent = `%${$('wmSize').value}`;
    buttons.frame.dataset.enabled = String(on);
    buttons.subtitle.dataset.enabled = String(!unavailable && $('subEnable').checked);
    buttons.brand.dataset.enabled = String(!unavailable && ($('wmEnable').checked || $('titleEnable').checked));
    marker();
  }
  window.editorRefresh = refresh;
  window.editorPickPerson = event => {
    if (!picking) return false;
    const video = $('preview'), rect = contentRect(video);
    if (!rect || video.seeking || Math.abs(video.currentTime - currentRange().start) > 0.3) {
      $('personStatus').textContent = 'Başlangıç karesi henüz hazır değil. Kişi seç düğmesine yeniden bas.';
      return true;
    }
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) { $('personStatus').textContent = 'Siyah boşluğa değil, görüntüdeki kişiye tıkla.'; return true; }
    anchoredAt = currentRange().start;
    trackPoint = { x, y, at: anchoredAt };
    picking = false; invalidateTrackPreview(); refresh();
    event.preventDefault(); return true;
  };
  $('selectPersonBtn').addEventListener('click', () => {
    picking = true; $('preview').pause(); seekPreview(currentRange().start); refresh();
  });
  $('clearPersonBtn').addEventListener('click', () => { picking = false; anchoredAt = null; clearTrackMarker(); invalidateTrackPreview(); refresh(); });
  $('trackMotion').addEventListener('change', invalidateTrackPreview);
  const choiceValue = choice => choice?.source === 'youtube' ? `${choice.auto ? 'auto' : 'manual'}:${choice.lang}` : 'whisper';
  function subtitleSources() {
    const select = $('subtitleSource'); select.replaceChildren();
    for (const [kind, langs] of Object.entries(subAllLangs)) {
      for (const lang of langs) {
        const option = document.createElement('option'); option.value = `${kind}:${lang}`;
        option.textContent = `${lang.toUpperCase()} · ${kind === 'auto' ? 'YouTube otomatik' : 'YouTube hazır'}`; select.append(option);
      }
    }
    const option = document.createElement('option'); option.value = 'whisper'; option.textContent = 'Konuşmadan oluştur · Whisper'; select.append(option);
    select.value = choiceValue(subPick);
  }
  window.editorSubtitleSources = subtitleSources;
  $('subtitleSource').addEventListener('change', () => {
    const value = $('subtitleSource').value;
    if (value === 'whisper') subPick = { source: 'whisper' };
    else { const [kind, lang] = value.split(':'); subPick = { source: 'youtube', lang, auto: kind === 'auto' }; }
    $('subCardSub').textContent = value === 'whisper' ? 'Seçilen kesitin konuşmasından oluşturulur' : `${subPick.lang.toUpperCase()} · YouTube ${subPick.auto ? 'otomatik' : 'hazır'} altyazısı`;
    $('subEnable').dispatchEvent(new Event('change'));
  });
  window.editorApplyProject = (project, includeTrim) => {
    $('trackMotion').value = ['calm', 'responsive'].includes(project.track?.motion) ? project.track.motion : 'balanced';
    $('wmSize').value = Math.max(4, Math.min(20, Number(project.watermark?.size) || 9));
    $('titleSeconds').value = [3, 5, 10].includes(Number(project.titleText?.seconds)) ? project.titleText.seconds : '3';
    const choice = choiceValue(project.subtitle?.source);
    if (project.subtitle?.source && [...$('subtitleSource').options].some(o => o.value === choice)) { $('subtitleSource').value = choice; $('subtitleSource').dispatchEvent(new Event('change')); }
    if (includeTrim && project.track?.point && [project.track.point.x, project.track.point.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
      trackPoint = { ...project.track.point, at: currentRange().start }; anchoredAt = currentRange().start;
    } else { trackPoint = null; anchoredAt = null; }
    refresh();
  };
  for (const id of ['trackEnable', 'subEnable', 'wmEnable', 'titleEnable', 'wmSize', 'titleText', 'quality']) $(id).addEventListener('input', refresh);
  panel.addEventListener('change', refresh);
  panel.addEventListener('click', () => queueMicrotask(refresh));
  $('preview').addEventListener('timeupdate', marker);
  $('preview').addEventListener('loadedmetadata', marker);
  new ResizeObserver(marker).observe($('playerWrap'));
  subtitleSources(); refresh();
})();
