// Reji masası: mevcut medya/çıktı akışının üzerinde timeline etkileşimleri.
(() => {
  let looping = false;
  let animation = null;
  const video = $('preview');
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function ruler(id, start, end) {
    const el = $(id);
    const key = `${start}:${end}:${el.clientWidth}`;
    if (el.dataset.range === key) return;
    el.dataset.range = key;
    el.replaceChildren();
    const count = Math.max(2, Math.floor(el.clientWidth / 88));
    for (let i = 0; i <= count; i++) {
      const tick = document.createElement('span');
      tick.textContent = fmtClock(start + (end - start) * i / count);
      el.append(tick);
    }
  }

  function drawPlayheads() {
    const t = video.currentTime || 0;
    for (const [id, start, end] of [['playheadMain', 0, videoDuration], ['playheadFine', zoomWin.start, zoomWin.end]]) {
      $(id).classList.toggle('hidden', !infoLoaded || end <= start || t < start || t > end);
      if (end > start) $(id).style.left = `${clamp((t - start) / (end - start), 0, 1) * 100}%`;
    }
    if (looping && $('trimEnable').checked && !video.paused) {
      const start = +$('rangeStart').value;
      const end = +$('rangeEnd').value;
      if (end > start && (t >= end || t < start)) seekPreview(start);
    }
  }

  function refresh() {
    const s = +$('rangeStart').value;
    const e = +$('rangeEnd').value;
    const enabled = infoLoaded && videoDuration > 0;
    document.querySelectorAll('.duration-preset').forEach(b => { b.disabled = !enabled; });
    $('loopSelection').disabled = !enabled || !previewUrl;
    const trimming = $('trimEnable').checked;
    $('trimControls').classList.toggle('disabled', !enabled);
    $('trimControls').classList.toggle('selection-off', !trimming);
    for (const id of ['rangeStart', 'rangeEnd', 'rangeStartFine', 'rangeEndFine', 'startTime', 'endTime', 'setStartBtn', 'setEndBtn']) {
      $(id).disabled = !enabled || !trimming;
    }
    $('timelineSummary').textContent = enabled
      ? ($('trimEnable').checked ? `${fmtClock(e - s)} seçili / ${fmtClock(videoDuration)}` : `${fmtClock(videoDuration)} · Videonun tamamı`)
      : 'Videonu ekleyerek başla';
    ruler('mainRuler', 0, videoDuration);
    ruler('fineRuler', zoomWin.start, zoomWin.end);
    const len = zoomWin.end - zoomWin.start;
    $('timelinePan').max = Math.max(0, videoDuration - len);
    $('timelinePan').value = zoomWin.start;
    $('timelinePan').disabled = !enabled || !trimming || len >= videoDuration;
    $('zoomIn').disabled = !enabled || !trimming || len <= 5;
    $('zoomOut').disabled = !enabled || !trimming || len >= videoDuration;
    $('zoomFit').disabled = !enabled || !trimming;
    // Keep off-screen endpoints intact; the visible handles represent viewport edges.
    for (const [id, n] of [['rangeStartFine', s], ['rangeEndFine', e]]) {
      $(id).min = zoomWin.start;
      $(id).max = zoomWin.end;
      $(id).value = clamp(n, zoomWin.start, zoomWin.end);
    }
    if (len > 0) {
      const left = clamp((s - zoomWin.start) / len, 0, 1);
      const right = clamp((e - zoomWin.start) / len, 0, 1);
      $('sliderRangeFine').style.left = `${left * 100}%`;
      $('sliderRangeFine').style.width = `${Math.max(0, right - left) * 100}%`;
    }
    drawPlayheads();
  }
  window.studioRefresh = refresh;
  window.studioSourceChanged = (info) => {
    looping = false;
    $('loopSelection').setAttribute('aria-pressed', 'false');
    $('studioTitle').textContent = info.title || 'Yeni video';
    $('studioTitle').title = info.title || '';
    $('sourceBadge').textContent = info.localFile ? 'Yerel video' : 'YouTube';
  };

  function enableTrim() {
    if (!$('trimEnable').checked) {
      $('trimEnable').checked = true;
      $('trimEnable').dispatchEvent(new Event('change'));
    }
  }
  function viewport(start, length) {
    const len = Math.min(videoDuration, Math.max(5, length));
    zoomWin.start = clamp(Math.round(start), 0, Math.max(0, videoDuration - len));
    zoomWin.end = zoomWin.start + len;
    $('zoomLabel').textContent = `${fmtTime(zoomWin.start)} – ${fmtTime(zoomWin.end)}`;
    refresh();
    requestWaveform();
  }
  function zoom(factor) {
    if (!infoLoaded) return;
    const len = zoomWin.end - zoomWin.start;
    const center = video.currentTime >= zoomWin.start && video.currentTime <= zoomWin.end
      ? video.currentTime : (zoomWin.start + zoomWin.end) / 2;
    const next = clamp(Math.round(len * factor), Math.min(5, videoDuration), videoDuration);
    viewport(center - next / 2, next);
  }
  $('zoomIn').addEventListener('click', () => zoom(0.5));
  $('zoomOut').addEventListener('click', () => zoom(2));
  $('zoomFit').addEventListener('click', computeZoomWindow);
  $('timelinePan').addEventListener('input', () => viewport(+$('timelinePan').value, zoomWin.end - zoomWin.start));
  $('studioOpenFile').addEventListener('click', () => $('openFileBtn').click());
  $('trimEnable').addEventListener('change', () => {
    if (!$('trimEnable').checked) {
      looping = false;
      $('loopSelection').setAttribute('aria-pressed', 'false');
    }
    refresh();
  });
  document.querySelectorAll('.duration-preset').forEach(button => {
    button.addEventListener('click', () => {
      if (!infoLoaded) return;
      enableTrim();
      const length = Math.min(+button.dataset.seconds, videoDuration);
      const start = clamp(Math.floor(video.currentTime || 0), 0, videoDuration - length);
      $('rangeStart').value = start;
      $('rangeEnd').value = start + length;
      syncFromSlider();
      computeZoomWindow();
      seekPreview(start);
    });
  });
  $('loopSelection').addEventListener('click', async () => {
    enableTrim();
    looping = !looping;
    $('loopSelection').setAttribute('aria-pressed', String(looping));
    if (looping) {
      seekPreview(+$('rangeStart').value);
      try { await video.play(); } catch { looping = false; $('loopSelection').setAttribute('aria-pressed', 'false'); }
    }
  });

  // Scrub the actual time axis without moving either selection boundary.
  for (const [id, fine] of [['videoTimeline', false], ['audioTimeline', true]]) {
    const track = $(id);
    let dragging = false;
    const scrub = event => {
      const rect = track.getBoundingClientRect();
      const start = fine ? zoomWin.start : 0;
      const end = fine ? zoomWin.end : videoDuration;
      seekPreview(start + clamp((event.clientX - rect.left) / rect.width, 0, 1) * (end - start));
      drawPlayheads();
    };
    track.addEventListener('pointerdown', event => {
      if (!infoLoaded || event.button !== 0 || event.target.matches('input')) return;
      dragging = true;
      track.setPointerCapture(event.pointerId);
      scrub(event);
    });
    track.addEventListener('pointermove', event => { if (dragging) scrub(event); });
    track.addEventListener('pointerup', () => { dragging = false; });
    track.addEventListener('pointercancel', () => { dragging = false; });
  }
  function animate() {
    drawPlayheads();
    animation = video.paused ? null : requestAnimationFrame(animate);
  }
  video.addEventListener('play', () => { if (animation === null) animate(); });
  video.addEventListener('timeupdate', drawPlayheads);
  video.addEventListener('ended', () => {
    if (looping && $('trimEnable').checked) { seekPreview(+$('rangeStart').value); video.play().catch(() => {}); }
  });
  document.querySelectorAll('#sideNav .nav-item').forEach(button => {
    button.title = button.textContent.trim();
    button.setAttribute('aria-label', button.textContent.trim());
  });
  new ResizeObserver(refresh).observe($('viewCutter'));
  refresh();
})();
