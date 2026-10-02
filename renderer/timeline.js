/* A single-source, non-destructive assembly desk. The source selector stays independent. */
(() => {
  const D = TimelineData, video = $('preview');
  let clips = [], enabled = false, selected = -1, playTime = 0, playing = false, active = 0, seeking = false, raf = null, scale = 18, drag = null;
  const uid = () => crypto.randomUUID();
  const clock = s => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
  const sourceShell = document.querySelector('.timeline-shell');
  const desk = document.createElement('section'); desk.id = 'sequenceDesk'; desk.className = 'sequence-desk'; desk.tabIndex = 0; desk.setAttribute('aria-label', 'Kurgu zaman çizelgesi');
  desk.innerHTML = `<header class="sequence-heading"><div><span class="studio-eyebrow">KURGU MASASI</span><h3>Hikâyenin sırasını sen belirle</h3></div><label class="sequence-toggle"><input id="sequenceEnable" type="checkbox"> Kurguyu dışa aktar</label></header>
    <div class="sequence-tools"><button id="sequenceAdd" class="btn-ghost small">＋ Seçili aralığı ekle</button><button id="sequenceSplit" class="btn-ghost small" title="Oynatma kafasında böl (S)">✂ Böl</button><button id="sequenceDuplicate" class="btn-ghost small">Çoğalt</button><button id="sequenceDelete" class="btn-ghost small">Sil</button><span class="sequence-spacer"></span><button id="editUndo" class="btn-ghost small" title="Geri al (Ctrl+Z)">↶ Geri al</button><button id="editRedo" class="btn-ghost small" title="İleri al (Ctrl+Shift+Z)">↷</button></div>
    <div class="sequence-transport"><button id="sequencePlay" class="btn-ghost small">▶ Kurguyu izle</button><output id="sequenceClock">00:00.00 / 00:00.00</output><span id="sequenceCount">Henüz parça yok</span><label>Yakınlık <input id="sequenceZoom" type="range" min="4" max="100" value="18" aria-label="Kurgu yakınlığı"></label><button id="sequenceFit" class="btn-ghost small">Sığdır</button></div>
    <div id="sequenceScroll" class="sequence-scroll"><div id="sequenceCanvas" class="sequence-canvas"><div id="sequenceRuler" class="sequence-ruler"></div><div id="sequenceClips" class="sequence-clips"></div><div id="sequenceAudio" class="sequence-audio"></div><div id="sequenceHead" class="sequence-head"></div></div><p id="sequenceEmpty">Kaynakta bir aralık seç, buraya ekle. Parçaları böl, kenarlarından kısalt ve sürükleyerek sırala.</p></div>
    <footer class="sequence-inspector"><strong id="sequenceSelection">Parça seçilmedi</strong><label>Kaynak giriş <input id="sequenceIn" type="number" min="0" step="0.01" aria-label="Seçili parçanın kaynak giriş saniyesi"></label><label>Kaynak çıkış <input id="sequenceOut" type="number" min="0" step="0.01" aria-label="Seçili parçanın kaynak çıkış saniyesi"></label><button id="sequenceLeft" class="btn-ghost small" title="Seçili parçayı önceye taşı">←</button><button id="sequenceRight" class="btn-ghost small" title="Seçili parçayı sonraya taşı">→</button></footer>
    <p id="sequenceStatus" class="sequence-note" role="status">Parçalar boşluksuz birleşir. Kaynak dosya değişmez.</p>`;
  sourceShell.before(desk);
  const modes = document.createElement('div'); modes.className = 'sequence-modes';
  modes.innerHTML = '<button id="sequenceSourceTab" class="btn-ghost small active" aria-pressed="true">Kaynak seçimi</button><button id="sequenceEditTab" class="btn-ghost small" aria-pressed="false">Kurgu</button><span class="sequence-spacer"></span>';
  desk.before(modes); modes.append($('sequenceAdd'), $('editUndo'), $('editRedo'));
  let editing = false;
  function mode(value) {
    editing = value; desk.classList.toggle('hidden', !value); sourceShell.classList.toggle('hidden', value);
    $('sequenceSourceTab').classList.toggle('active', !value); $('sequenceEditTab').classList.toggle('active', value);
    $('sequenceSourceTab').setAttribute('aria-pressed', String(!value)); $('sequenceEditTab').setAttribute('aria-pressed', String(value));
    if (!value && playing) stop();
  }
  $('sequenceSourceTab').onclick = () => mode(false); $('sequenceEditTab').onclick = () => { mode(true); render(); };
  mode(false);
  sourceShell.querySelector('.timeline-name').firstChild.textContent = 'Kaynak aralığı ';
  const note = text => $('sequenceStatus').textContent = text;
  const total = () => D.duration(clips);
  function stop() { playing = false; seeking = false; cancelAnimationFrame(raf); video.pause(); $('sequencePlay').textContent = '▶ Kurguyu izle'; }
  function position(time, start = false) {
    const loc = D.locate(clips, time); if (!loc) return;
    playTime = Math.max(0, Math.min(total(), time)); active = loc.index;
    seeking = true; video.currentTime = Math.min(loc.source, clips[active].end - .001);
    if (start) { playing = true; $('sequencePlay').textContent = 'Ⅱ Duraklat'; video.play().catch(() => { stop(); note('Video önizlemesi oynatılamadı. Kaynağı yeniden yükleyin.'); }); tick(); }
    drawHead();
  }
  function drawHead() {
    $('sequenceHead').style.left = `${playTime * scale}px`;
    $('sequenceClock').textContent = `${clock(playTime)} / ${clock(total())}`;
    document.querySelectorAll('.sequence-clip').forEach((el, i) => el.classList.toggle('playing', playing && i === active));
  }
  function tick() {
    if (!playing) return;
    const c = clips[active];
    if (!c) { stop(); return; }
    if (!seeking && !video.seeking) {
      const offset = D.duration(clips.slice(0, active));
      playTime = offset + Math.max(0, Math.min(c.end - c.start, video.currentTime - c.start));
      if (video.currentTime >= c.end - .025 || video.ended) {
        if (active + 1 === clips.length) { playTime = total(); stop(); }
        else { active++; seeking = true; video.currentTime = clips[active].start; video.play().catch(() => stop()); }
      }
      drawHead();
    }
    if (playing) raf = requestAnimationFrame(tick);
  }
  video.addEventListener('seeked', () => { seeking = false; });
  video.addEventListener('pause', () => { if (playing && !video.ended) { playing = false; cancelAnimationFrame(raf); $('sequencePlay').textContent = '▶ Kurguyu izle'; } });
  function edit(next, index = selected) {
    try { if (next.length) next = D.validate(next, videoDuration); }
    catch (err) { note(err.message); return; }
    window.sessionCheckpoint?.(); stop(); clips = next; selected = Math.min(index, clips.length - 1); enabled = clips.length > 0;
    playTime = Math.min(playTime, total()); render(); window.sessionCommit?.();
  }
  function add() {
    if (!infoLoaded) return;
    const start = $('trimEnable').checked ? +$('rangeStart').value : 0, end = $('trimEnable').checked ? +$('rangeEnd').value : videoDuration;
    edit([...clips, { id: uid(), start, end }], clips.length);
    mode(true); render();
    note('Parça eklendi. Tutamakları sürükleyerek kırp; parçanın ortasından tutarak sırasını değiştir.');
  }
  function split() {
    const loc = D.locate(clips, playTime); if (!loc) return;
    try { edit(D.split(clips, loc.index, loc.source, uid()), loc.index + 1); }
    catch (err) { note(err.message); }
  }
  function move(delta) { if (selected < 0 || selected + delta < 0 || selected + delta >= clips.length) return; edit(D.move(clips, selected, selected + delta), selected + delta); }
  function render() {
    const length = total(), width = Math.max($('sequenceScroll').clientWidth - 2, length * scale);
    $('sequenceCanvas').style.width = `${width}px`;
    $('sequenceEnable').checked = enabled; $('sequenceEnable').disabled = !clips.length;
    $('sequenceEmpty').classList.toggle('hidden', !!clips.length);
    $('sequenceCanvas').classList.toggle('hidden', !clips.length);
    $('sequenceCount').textContent = clips.length ? `${clips.length} parça · ${enabled ? 'Çıktı: kurgu' : 'Çıktı: kaynak seçimi'}` : 'Henüz parça yok';
    $('sequenceEditTab').textContent = clips.length ? `Kurgu · ${clips.length}` : 'Kurgu';
    $('downloadBtn').title = enabled ? 'Kurgu şeridindeki parçaları tek video olarak dışa aktar' : 'Kaynak aralığını dışa aktar';
    const trimCard = $('trimEnable').closest('.card-toggle');
    if (trimCard) {
      trimCard.querySelector('.card-title').textContent = enabled ? 'Kaynak aralığı seç' : 'Belirli aralığı kes';
      trimCard.querySelector('.card-sub').textContent = enabled ? 'Kurguna eklenecek aralığı belirle' : 'Sadece seçilen kısım kaydedilir';
    }
    $('sequenceAdd').disabled = !infoLoaded || clips.length >= D.MAX;
    for (const id of ['sequencePlay', 'sequenceSplit', 'sequenceFit']) $(id).disabled = !clips.length;
    const c = clips[selected];
    for (const id of ['sequenceDelete', 'sequenceDuplicate', 'sequenceIn', 'sequenceOut']) $(id).disabled = !c;
    $('sequenceLeft').disabled = !c || selected === 0; $('sequenceRight').disabled = !c || selected === clips.length - 1;
    $('sequenceIn').max = videoDuration; $('sequenceOut').max = videoDuration;
    $('sequenceIn').value = c ? c.start.toFixed(2) : ''; $('sequenceOut').value = c ? c.end.toFixed(2) : '';
    $('sequenceSelection').textContent = c ? `Parça ${selected + 1} · ${clock(c.end - c.start)}` : 'Parça seçilmedi';
    const ruler = $('sequenceRuler'); ruler.replaceChildren();
    const step = Math.max(.5, Math.ceil(70 / scale));
    for (let t = 0; t <= length && t / step < 2000; t += step) { const tick = document.createElement('span'); tick.style.left = `${t * scale}px`; tick.textContent = clock(t); ruler.append(tick); }
    $('sequenceClips').replaceChildren(); $('sequenceAudio').replaceChildren();
    const film = $('filmstrip').getAttribute('src');
    clips.forEach((clip, i) => {
      const el = document.createElement('div'); el.className = 'sequence-clip' + (i === selected ? ' selected' : ''); el.dataset.index = i; el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', `Parça ${i + 1}, ${clock(clip.start)} ile ${clock(clip.end)}. Sürükleyerek sırala.`); el.setAttribute('aria-pressed', String(i === selected));
      el.style.width = `${(clip.end - clip.start) * scale}px`;
      if (film?.startsWith('data:image/')) { el.style.backgroundImage = `url("${film}")`; el.style.backgroundSize = `${videoDuration * scale}px 100%`; el.style.backgroundPosition = `${-clip.start * scale}px center`; }
      const label = document.createElement('span'); label.textContent = `${String(i + 1).padStart(2, '0')} · ${clock(clip.end - clip.start)}`; el.append(label);
      for (const edge of ['start', 'end']) { const handle = document.createElement('span'); handle.className = `sequence-handle ${edge}`; handle.dataset.edge = edge; handle.title = edge === 'start' ? 'Başlangıcı kırp' : 'Bitişi kırp'; el.append(handle); }
      el.addEventListener('pointerdown', e => beginDrag(e, i));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); selected = i; position(D.duration(clips.slice(0, i))); render(); }
        if (e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); selected = i; move(e.key === 'ArrowLeft' ? -1 : 1); $('sequenceClips').children[selected]?.focus(); }
      });
      $('sequenceClips').append(el);
      const audio = document.createElement('div'); audio.className = 'sequence-audio-clip'; audio.style.width = el.style.width; audio.dataset.id = clip.id;
      const cached = waves.get(`${currentVideoId}:${clip.start}:${clip.end}`);
      if (cached) { audio.style.backgroundImage = `url("${cached}")`; audio.title = 'Kaynak sesi · video ile birlikte taşınır'; }
      else audio.textContent = clip.end - clip.start > 180 ? 'Ses · yakın aralık seç' : 'Ses';
      $('sequenceAudio').append(audio);
    });
    drawHead(); updateDownloadBtn();
    clearTimeout(waveTimer); if (!drag) waveTimer = setTimeout(requestWaves, 250);
  }
  const waves = new Map(); let waveGeneration = 0, waveTimer = null;
  async function requestWaves() {
    const generation = ++waveGeneration;
    for (const c of clips) {
      if (generation !== waveGeneration) return;
      const key = `${currentVideoId}:${c.start}:${c.end}`;
      if (waves.has(key) || c.end - c.start > 180) continue;
      let data;
      try { data = await window.api.getWaveform({ url: previewUrl, start: c.start, duration: c.end - c.start, videoId: currentVideoId, localPath: currentLocalFile }); } catch { data = null; }
      if (generation !== waveGeneration) return;
      if (data?.startsWith('data:image/')) { if (waves.size > 100) waves.delete(waves.keys().next().value); waves.set(key, data); }
      const node = [...$('sequenceAudio').children].find(el => el.dataset.id === c.id);
      if (node) { node.textContent = data ? '' : 'Ses dalgası yok'; if (data) node.style.backgroundImage = `url("${data}")`; }
    }
  }
  function beginDrag(e, index) {
    if (e.button !== 0) return;
    e.preventDefault(); stop(); selected = index; window.sessionCheckpoint?.();
    const rect = e.currentTarget.getBoundingClientRect();
    drag = { index, edge: e.target.dataset.edge, x: e.clientX, initial: D.copy(clips), scroll: $('sequenceScroll').scrollLeft, moved: false, target: index, local: Math.max(0, e.clientX - rect.left) / scale };
    desk.setPointerCapture(e.pointerId); desk.focus(); render();
  }
  desk.addEventListener('pointermove', e => {
    if (!drag) return;
    const scroll = $('sequenceScroll'), bounds = scroll.getBoundingClientRect();
    if (e.clientX > bounds.right - 28) scroll.scrollLeft += 12;
    if (e.clientX < bounds.left + 28) scroll.scrollLeft -= 12;
    const delta = (e.clientX - drag.x + scroll.scrollLeft - drag.scroll) / scale;
    drag.moved ||= Math.abs(e.clientX - drag.x) > 3;
    if (drag.edge) {
      const c = drag.initial[drag.index]; clips = D.copy(drag.initial);
      clips[drag.index][drag.edge] = Math.round((drag.edge === 'start' ? Math.max(0, Math.min(c.end - D.MIN, c.start + delta)) : Math.min(videoDuration, Math.max(c.start + D.MIN, c.end + delta))) * 1000) / 1000;
      render();
    } else if (drag.moved) {
      const nodes = [...$('sequenceClips').children]; let target = 0;
      nodes.forEach((el, i) => { const r = el.getBoundingClientRect(); if (e.clientX > r.left + r.width / 2) target = i + 1; });
      drag.target = Math.max(0, Math.min(clips.length - 1, target > drag.index ? target - 1 : target));
      nodes.forEach((el, i) => el.classList.toggle('drop-target', i === drag.target));
      note(`Parça ${drag.index + 1} → ${drag.target + 1}. sıra`);
    }
  });
  function endDrag(cancelled) {
    if (!drag) return; const d = drag; drag = null;
    if (cancelled) clips = d.initial;
    else if (!d.edge && d.moved) { clips = D.move(d.initial, d.index, d.target); selected = d.target; }
    else if (!d.moved) position(D.duration(clips.slice(0, d.index)) + Math.min(d.local, clips[d.index].end - clips[d.index].start));
    render(); if (!cancelled) window.sessionCommit?.();
  }
  desk.addEventListener('pointerup', () => endDrag(false)); desk.addEventListener('pointercancel', () => endDrag(true));
  $('sequenceRuler').onclick = e => { stop(); position((e.clientX - $('sequenceCanvas').getBoundingClientRect().left) / scale); };
  $('sequenceAdd').onclick = add; $('sequenceSplit').onclick = split;
  $('sequenceDuplicate').onclick = () => { if (selected >= 0) { const next = D.copy(clips); next.splice(selected + 1, 0, { ...next[selected], id: uid() }); edit(next, selected + 1); } };
  $('sequenceDelete').onclick = () => { if (selected >= 0) edit(clips.filter((_, i) => i !== selected)); };
  $('sequenceLeft').onclick = () => move(-1); $('sequenceRight').onclick = () => move(1);
  for (const [id, edge] of [['sequenceIn', 'start'], ['sequenceOut', 'end']]) $(id).onchange = () => { if (selected >= 0) { const next = D.copy(clips); next[selected][edge] = +$(id).value; edit(next); } };
  $('sequenceEnable').onchange = () => { window.sessionCheckpoint?.(); enabled = $('sequenceEnable').checked; render(); window.sessionCommit?.(); };
  $('sequencePlay').onclick = () => { if (playing) stop(); else { if ($('loopSelection').getAttribute('aria-pressed') === 'true') $('loopSelection').click(); position(playTime >= total() - .01 ? 0 : playTime, true); } };
  $('sequenceZoom').oninput = () => { scale = +$('sequenceZoom').value; render(); };
  $('sequenceFit').onclick = () => { scale = Math.max(.05, Math.min(100, ($('sequenceScroll').clientWidth - 12) / total())); $('sequenceZoom').value = scale; render(); };
  sourceShell.addEventListener('pointerdown', () => { if (playing) stop(); });
  desk.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select,button') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); $('sequencePlay').click(); }
    if (e.key.toLowerCase() === 's') { e.preventDefault(); split(); }
    if (e.key === 'Delete') { e.preventDefault(); $('sequenceDelete').click(); }
    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); stop(); position(Math.max(0, playTime + (e.key === 'ArrowRight' ? .1 : -.1))); }
  });
  // Validate the entire batch before changing history or existing clips.
  window.sequenceAppendRanges = ranges => {
    if (!infoLoaded || queueRunning) throw Error('Kaynağı aç ve devam eden dışa aktarmanın bitmesini bekle.');
    if (!Array.isArray(ranges) || !ranges.length) throw Error('Kurguya eklemek için metin satırı seç.');
    const next = D.validate([...clips, ...ranges.map(r => ({ id: uid(), start: r.start, end: r.end }))], videoDuration);
    edit(next, clips.length); mode(true); render();
    note(`${ranges.length} metin parçası kurgunun sonuna eklendi. Sıralayabilir, kırpabilir veya geri alabilirsin.`);
    return true;
  };
  window.sequenceProject = () => ({ version: 1, enabled, clips: D.copy(clips) });
  window.sequenceApplyProject = data => {
    stop(); clips = []; enabled = false;
    if (data?.clips?.length) { try { clips = D.validate(data.clips, videoDuration); enabled = !!data.enabled; } catch (err) { note(err.message); } }
    selected = clips.length ? 0 : -1; playTime = 0; mode(!!clips.length); render();
  };
  window.sequenceBuildOpts = opts => {
    if (!enabled || !clips.length) return;
    const start = opts.trim ? parseTime(opts.trim.start) : 0, end = opts.trim ? parseTime(opts.trim.end) : videoDuration;
    if ((opts.subtitle || opts.framingPath) && !D.covered(clips, start, end)) return 'Altyazı/kadraj onayı tüm kurgu parçalarını kapsamalı. Kaynak aralığını genişletip yeniden onayla.';
    opts.sequence = D.copy(clips);
  };
  const changed = window.studioSourceChanged;
  window.studioSourceChanged = (...args) => { stop(); clips = []; enabled = false; selected = -1; playTime = 0; waveGeneration++; waves.clear(); changed?.(...args); mode(false); render(); };
  $('filmstrip').addEventListener('load', render);
  new ResizeObserver(() => { if (!drag) render(); }).observe(desk);
  render();
})();
