/* Review desk: the approved transcript and camera path are export inputs. */
(() => {
  const copy = value => JSON.parse(JSON.stringify(value));
  let doc = null, savedFrame = null, stagedFrame = null, draftPath = null, basePath = null, openingKey = '', busy = false, generation = 0;
  let bottom = 24, side = 18, restoreFocus = null;
  const sourceKey = () => JSON.stringify([currentVideoId, currentLocalFile, currentRange()]);
  const textKey = () => JSON.stringify([sourceKey(), subPick, subModelValue]);
  const frameKey = () => JSON.stringify([sourceKey(), $('trackEnable').checked, trackPoint, trackModeValue, $('trackMotion').value]);
  const currentDoc = () => doc && doc.key === textKey() ? doc : null;
  const validFrame = () => savedFrame && savedFrame.key === frameKey() ? savedFrame : null;
  const panel = document.createElement('div'); panel.className = 'review-prepare';
  panel.innerHTML = `<div class="review-eyebrow">ÖNCE METNİ KONTROL ET</div><p>Altyazıyı oluştur, düzelt ve onayla. Çıktıda onayladığın metin kullanılır.</p><div class="review-actions"><button id="reviewGenerate" class="btn-ghost small">Altyazıyı oluştur</button><button id="reviewOpen" class="btn-ghost small">Metni ve yerleşimi incele</button></div><span id="reviewStatus" role="status"></span>`;
  $('subCard').append(panel);
  const modal = $('trackPreviewModal'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Kadraj ve altyazı kontrol masası');
  modal.querySelector('.modal-title').textContent = 'Kadraj ve altyazı · kontrol masası';
  modal.querySelector('.tp-foot-hint').textContent = 'Platform maskeleri yaklaşık rehberdir; çıktıya eklenmez.';
  const controls = document.createElement('div'); controls.className = 'review-controls';
  controls.innerHTML = `<div class="review-transport"><button id="reviewBack" class="btn-ghost small" title="1/30 saniye geri">−1/30 sn</button><input id="reviewSeek" aria-label="Önizleme zamanı" type="range" min="0" max="1" step="0.033333" value="0"><button id="reviewNext" class="btn-ghost small" title="1/30 saniye ileri">+1/30 sn</button><output id="reviewTime">00:00</output><select id="reviewSpeed" aria-label="Oynatma hızı"><option value="0.5">0,5×</option><option value="1" selected>1×</option><option value="1.5">1,5×</option></select></div>
  <div class="review-tuning"><section><strong>Kadrajı düzelt</strong><label>Yatay konum <input id="reviewPan" type="range" min="0" max="100" step="0.1" value="50"></label><p>Bu andan kesitin sonuna kadar sabit kadraj uygular. Sonraki noktada tekrar ayarlayabilirsin.</p><button id="reviewReset" class="btn-ghost small">Analiz edilen kadraja dön</button></section><section><strong>Altyazı yerleşimi · tüm çıktılar</strong><label>Alttan uzaklık <input id="reviewBottom" type="range" min="5" max="45" value="24"><output id="reviewBottomValue">%24</output></label><label>Yan boşluk <input id="reviewSide" type="range" min="3" max="30" value="18"><output id="reviewSideValue">%18</output></label><button id="reviewFit" class="btn-ghost small">Seçili platforma yerleştir</button></section></div>
  <p id="reviewSafety" role="status"></p><p class="review-note">Stil ve kelime geçişleri önizlenir; kelime süreleri satır zamanlarından tahmin edilir.</p>
  <section class="review-transcript"><div class="review-section-head"><strong>Altyazı metni <span id="reviewCueCount"></span></strong><button id="reviewAdd" class="btn-ghost small">Bu ana altyazı ekle</button></div><p>Zamanlar kesitin başlangıcına göredir (saniye). Bir satıra gitmek için zaman düğmesine bas.</p><div id="reviewCues"></div></section>
  <div class="review-save"><span id="reviewSaveStatus" role="status">Değişiklikleri uyguladığında dışa aktarmaya taşınır.</span><button id="reviewSave" class="btn-ghost">Uygula ve onayla</button><button id="reviewExport" class="btn-download">Uygula ve dışa aktar</button></div>`;
  modal.querySelector('.tp-modal-body').after(controls);
  const tabs = document.createElement('div'); tabs.className = 'review-tabs segmented'; tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = '<button id="reviewTabFrame" class="seg active" role="tab" aria-controls="reviewFramePanel">Kadraj ve yerleşim</button><button id="reviewTabText" class="seg" role="tab" aria-controls="reviewTextPanel">Altyazı metni</button>';
  const tuning = controls.querySelector('.review-tuning'), transcript = controls.querySelector('.review-transcript');
  tuning.id = 'reviewFramePanel'; transcript.id = 'reviewTextPanel'; tuning.setAttribute('role', 'tabpanel'); transcript.setAttribute('role', 'tabpanel');
  tuning.before(tabs);
  function selectReviewTab(text) {
    tuning.classList.toggle('hidden', text); transcript.classList.toggle('hidden', !text);
    for (const [id, active] of [['reviewTabFrame', !text], ['reviewTabText', text]]) { $(id).classList.toggle('active', active); $(id).setAttribute('aria-selected', String(active)); $(id).tabIndex = active ? 0 : -1; }
  }
  $('reviewTabFrame').onclick = () => selectReviewTab(false); $('reviewTabText').onclick = () => selectReviewTab(true);
  tabs.onkeydown = e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const text = e.key === 'End' || e.key !== 'Home' && document.activeElement === $('reviewTabFrame'); selectReviewTab(text); (text ? $('reviewTabText') : $('reviewTabFrame')).focus(); } };
  modal.querySelector('.tp-modal-foot').append(controls.querySelector('.review-save'));
  const enlarge = document.createElement('button'); enlarge.className = 'btn-ghost small'; enlarge.id = 'reviewEnlarge'; enlarge.textContent = 'Çıktıyı büyüt'; enlarge.setAttribute('aria-pressed', 'false');
  modal.querySelector('.tp-pane-out > .label').append(enlarge);
  enlarge.onclick = () => { const enlarged = modal.classList.toggle('review-enlarged'); enlarge.textContent = enlarged ? 'Karşılaştırmaya dön' : 'Çıktıyı büyüt'; enlarge.setAttribute('aria-pressed', String(enlarged)); };
  const caption = document.createElement('div'); caption.id = 'reviewCaption'; caption.className = 'review-caption';
  modal.querySelector('.tp-canvas-wrap').append(caption);
  const status = message => { $('reviewStatus').textContent = message; };
  function refresh() {
    panel.classList.toggle('hidden', !$('subEnable').checked);
    $('reviewGenerate').textContent = busy ? 'Oluşturmayı iptal et' : currentDoc() ? 'Yeniden oluştur' : 'Altyazıyı oluştur';
    $('reviewOpen').disabled = busy || !infoLoaded;
    if (!busy) status(currentDoc() ? (doc.approved ? 'Metin onaylandı · dışa aktarmaya hazır' : 'Metin hazır · düzelt ve onayla') : 'Bu kaynak ve kesit için henüz onaylanmış metin yok.');
  }
  const error = message => { $('reviewSaveStatus').textContent = message; status(message); };
  function readCues() {
    return [...$('reviewCues').children].map(row => ({ start: +row.querySelector('[data-start]').value, end: +row.querySelector('[data-end]').value, text: row.querySelector('textarea').value }));
  }
  function syncDoc() { if (currentDoc()) { doc.cues = readCues(); doc.approved = false; refresh(); } }
  function replaceCues(cues) {
    window.sessionCheckpoint?.(); doc.cues = cues; doc.approved = false; renderCues(); refresh(); window.sessionCommit?.();
  }
  const search = document.createElement('div'); search.className = 'review-find';
  search.innerHTML = '<input id="reviewFind" aria-label="Altyazıda bul" placeholder="Bul"><input id="reviewReplace" aria-label="Yeni metin" placeholder="Yerine yaz"><button id="reviewReplaceAll" class="btn-ghost small">Tümünü değiştir</button><button id="reviewUndo" class="btn-ghost small">↶ Geri al</button><button id="reviewRedo" class="btn-ghost small">↷</button>';
  $('reviewCues').before(search);
  $('reviewUndo').onclick = () => $('editUndo')?.click(); $('reviewRedo').onclick = () => $('editRedo')?.click();
  $('reviewReplaceAll').onclick = () => {
    if (!currentDoc() || !$('reviewFind').value) return;
    const find = $('reviewFind').value, replacement = $('reviewReplace').value;
    replaceCues(readCues().map(c => ({ ...c, text: c.text.split(find).join(replacement) })));
    error('Metin değiştirildi. Kontrol edip yeniden onayla.');
  };
  function renderCues() {
    animationCache.cues = null;
    $('reviewCues').replaceChildren();
    const d = currentDoc(); $('reviewCueCount').textContent = d ? `· ${d.cues.length} satır` : '';
    if (!d) { $('reviewCues').textContent = 'Altyazı sekmesinden önce metni oluştur. İstersen bu ana bir satır ekleyerek elle başlayabilirsin.'; return; }
    d.cues.forEach((cue, index) => {
      const row = document.createElement('div'); row.className = 'review-cue';
      const jump = document.createElement('button'); jump.className = 'btn-ghost small'; jump.textContent = `${index + 1} ▶`; jump.title = 'Altyazının başlangıcına git'; jump.onclick = () => { $('tpVideo').currentTime = +start.value; $('tpVideo').pause(); };
      const start = document.createElement('input'); start.type = 'number'; start.min = 0; start.step = .01; start.value = cue.start; start.dataset.start = ''; start.setAttribute('aria-label', `${index + 1}. altyazı başlangıcı`);
      const end = document.createElement('input'); end.type = 'number'; end.min = 0; end.step = .01; end.value = cue.end; end.dataset.end = ''; end.setAttribute('aria-label', `${index + 1}. altyazı bitişi`);
      const text = document.createElement('textarea'); text.rows = 2; text.value = cue.text; text.setAttribute('aria-label', `${index + 1}. altyazı metni`);
      const remove = document.createElement('button'); remove.className = 'btn-ghost small'; remove.textContent = 'Sil'; remove.onclick = () => { row.remove(); syncDoc(); renderCues(); };
      row.append(jump, start, end, text, remove); row.addEventListener('input', syncDoc); $('reviewCues').append(row);
      const actions = document.createElement('div'); actions.className = 'review-cue-actions';
      const split = document.createElement('button'); split.className = 'btn-ghost small'; split.textContent = 'İmleçte böl';
      split.onclick = () => {
        const cues = readCues(), c = cues[index], at = text.selectionStart;
        const left = c.text.slice(0, at).trim(), right = c.text.slice(at).trim();
        if (!left || !right) { error('Metin içinde bölmek istediğin yere imleci yerleştir.'); text.focus(); return; }
        const middle = Math.round((c.start + (c.end - c.start) * at / c.text.length) * 100) / 100;
        if (middle <= c.start || middle >= c.end) { error('Satır bölünemeyecek kadar kısa.'); return; }
        cues.splice(index, 1, { ...c, end: middle, text: left }, { ...c, start: middle, text: right }); replaceCues(cues);
      };
      const merge = document.createElement('button'); merge.className = 'btn-ghost small'; merge.textContent = 'Sonrakiyle birleştir'; merge.disabled = index === d.cues.length - 1;
      merge.onclick = () => { const cues = readCues(), a = cues[index], b = cues[index + 1]; if (!b) return; cues.splice(index, 2, { start: a.start, end: b.end, text: `${a.text.trim()} ${b.text.trim()}` }); replaceCues(cues); };
      actions.append(split, merge); row.append(actions);
    });
  }
  window.api.onSubtitleReviewProgress(p => { if (busy) status(p.message || `Konuşma metne çevriliyor · %${Math.round(p.pct || 0)}`); });
  $('reviewGenerate').onclick = async () => {
    if (busy) { generation++; await window.api.cancelSubtitleReview(); status('İptal ediliyor…'); return; }
    if (queueRunning || tp.generating) { status('Devam eden işlemin tamamlanmasını bekle.'); return; }
    if (!infoLoaded) return;
    if (currentDoc() && !confirm('Mevcut altyazı düzeltmelerinin yerine yeniden oluşturulan metin gelsin mi?')) return;
    const key = textKey(), token = ++generation; busy = true; refresh(); status('Altyazı hazırlanıyor. İlk kullanımda Whisper modeli indirilebilir…');
    try {
      const result = await window.api.subtitleReview({ ...subPick, model: subModelValue, videoId: currentVideoId, localFile: currentLocalFile, url: $('url').value.trim(), previewUrl, ...currentRange() });
      if (token !== generation || key !== textKey()) { status('İşlem iptal edildi veya kaynak/kesit değişti. Metin uygulanmadı.'); return; }
      if (result?.error) throw Error(result.error);
      if (!result || result.cancelled) return;
      doc = { key, cues: ReviewData.parse(result.srt, currentRange().duration), words: result.words || [], approved: false };
      busy = false; refresh(); await computeTrackPreview();
    } catch (err) { status(err.message); }
    finally { busy = false; $('reviewGenerate').textContent = currentDoc() ? 'Yeniden oluştur' : 'Altyazıyı oluştur'; $('reviewOpen').disabled = !infoLoaded; }
  };
  $('reviewOpen').onclick = () => { if (!queueRunning && !busy) computeTrackPreview(); };
  $('reviewSeek').oninput = e => { $('tpVideo').currentTime = +e.target.value; };
  for (const [id, delta] of [['reviewBack', -1 / 30], ['reviewNext', 1 / 30]]) $(id).onclick = () => { const v = $('tpVideo'); v.pause(); v.currentTime = Math.max(0, Math.min(currentRange().duration, v.currentTime + delta)); };
  $('reviewSpeed').onchange = e => { $('tpVideo').playbackRate = +e.target.value; };
  const rangeControls = document.createElement('div'); rangeControls.className='review-range';
  rangeControls.innerHTML='<label>Başlangıç (sn)<input id="reviewRangeStart" type="number" min="0" step="0.01" value="0"></label><label>Bitiş (sn)<input id="reviewRangeEnd" type="number" min="0" step="0.01" value="5"></label><button id="reviewRangeHere" class="btn-ghost small">Bu andan 5 sn</button><button id="reviewRangeApply" class="btn-ghost small">Aralığa uygula</button>';
  const frameSection=$('reviewPan').closest('section'); frameSection.querySelector('p').textContent='Yalnız bu aralık düzeltilir; sonrasında önceki kadraj devam eder.'; frameSection.querySelector('p').after(rangeControls);
  $('reviewRangeHere').onclick=()=> { const t=+$('tpVideo').currentTime.toFixed(2); $('reviewRangeStart').value=t; $('reviewRangeEnd').value=Math.min(currentRange().duration,t+5); };
  function applyRange() {
    if(!draftPath) return;
    try {
      const x=+$('reviewPan').value/100*Math.max(0,1-tp.cropW);
      draftPath=ReviewData.patchPath(draftPath,+$('reviewRangeStart').value,+$('reviewRangeEnd').value,x,currentRange().duration);
      $('reviewSaveStatus').textContent='Seçilen aralık düzeltildi · henüz uygulanmadı';
    } catch(err) { error(err.message); }
  }
  $('reviewRangeApply').onclick=()=> { window.sessionCheckpoint?.(); applyRange(); window.sessionCommit?.(); };
  $('reviewPan').oninput = e => {
    applyRange();
  };
  $('reviewReset').onclick = () => { draftPath = copy(basePath); $('reviewSaveStatus').textContent = 'Analiz edilen kadraj geri alındı · uygula'; };
  function placement() {
    bottom = +$('reviewBottom').value; side = +$('reviewSide').value;
    $('reviewBottomValue').textContent = `%${bottom}`; $('reviewSideValue').textContent = `%${side}`;
    if (currentDoc()) doc.approved = false;
    $('reviewSaveStatus').textContent = 'Yerleşim değişti · uygula ve onayla'; refresh();
  }
  $('reviewBottom').oninput = placement; $('reviewSide').oninput = placement;
  $('reviewFit').onclick = () => {
    const presets = { off: [24, 18], tiktok: [24, 18], shorts: [20, 18], reels: [26, 18] };
    const p = presets[safeZonePlatform]; $('reviewBottom').value = p[0]; $('reviewSide').value = p[1]; placement();
  };
  $('reviewAdd').onclick = () => {
    if (!currentDoc()) doc = { key: textKey(), cues: [], approved: false };
    const start = Math.round($('tpVideo').currentTime * 100) / 100;
    doc.cues.push({ start, end: Math.min(currentRange().duration, start + 2), text: '' }); doc.cues.sort((a, b) => a.start - b.start); doc.approved = false;
    $('subEnable').checked = true; $('subEnable').dispatchEvent(new Event('change')); renderCues();
  };
  window.reviewFrameX = t => draftPath?.length ? xAt(draftPath, t) : null;
  window.reviewOpened = () => {
    restoreFocus = document.activeElement; openingKey = frameKey(); basePath = copy(tp.path); draftPath = copy((stagedFrame?.key === frameKey() ? stagedFrame.path : null) || validFrame()?.path || tp.path);
    $('reviewRangeStart').value=0; $('reviewRangeEnd').value=Math.min(5,currentRange().duration);
    $('reviewRangeStart').max=currentRange().duration; $('reviewRangeEnd').max=currentRange().duration;
    $('reviewSeek').max = currentRange().duration; $('reviewSaveStatus').textContent = 'Kontrol et, ince ayar yap ve uygula.';
    modal.style.setProperty('--source-aspect', $('tpSourceBox').style.aspectRatio || '1.77778');
    renderCues(); selectReviewTab(!!currentDoc()); $('tpModalClose').focus();
  };
  window.reviewClosed = () => { if (draftPath && openingKey === frameKey()) stagedFrame = { key: openingKey, path: copy(draftPath) }; draftPath = null; restoreFocus?.focus(); refresh(); };
  let animationCache = { cues: null, style: null, events: [] };
  const stylePicker = document.createElement('label'); stylePicker.className = 'review-style-picker'; stylePicker.textContent = 'Altyazı stili ';
  const styleSelect = document.createElement('select'); styleSelect.id = 'reviewStyle'; styleSelect.setAttribute('aria-label', 'Altyazı stili');
  for (const button of document.querySelectorAll('#subStyles [data-substyle]')) {
    const option = document.createElement('option'); option.value = button.dataset.substyle; option.textContent = button.textContent; styleSelect.append(option);
  }
  stylePicker.append(styleSelect); controls.querySelector('.review-tabs').after(stylePicker);
  styleSelect.onchange = () => { const button = [...document.querySelectorAll('#subStyles [data-substyle]')].find(b => b.dataset.substyle === styleSelect.value); button?.click(); };
  controls.querySelector('.review-note').textContent = 'Whisper kelime zamanları korunur. Yeni veya eşleşmeyen sözcüklerin süreleri tahmin edilir.';
  window.reviewDraw = t => {
    const v = $('tpVideo'); $('reviewSeek').value = t; $('reviewTime').textContent = `${t.toFixed(2)} / ${currentRange().duration.toFixed(2)} sn`;
    $('tpPlayBtn').textContent = v.paused ? 'Oynat' : 'Duraklat';
    if (document.activeElement !== $('reviewPan')) $('reviewPan').value = (window.reviewFrameX(t) || 0) / Math.max(.001, 1 - tp.cropW) * 100;
    const d = currentDoc();
    const animated = ['vurgulu', 'pop'].includes(subStyleValue);
    if (animationCache.cues !== d?.cues || animationCache.style !== subStyleValue) {
      const words = d ? ReviewData.alignedWords(d.cues,d.words) : [];
      animationCache = { cues: d?.cues, style: subStyleValue, events: animated && d ? ReviewData.animationEvents(words, subStyleValue) : [] };
      const measured = words.filter(w=>!w.estimated).length;
      controls.querySelector('.review-note').textContent = words.length ? `${measured}/${words.length} kelimenin konuşma zamanı korunuyor; ${words.length-measured} kelime tahmini. Gerçek çıktı için prova oluşturabilirsin.` : 'Kelime zamanları metin oluşturulduğunda gösterilir.';
    }
    const cue = $('subEnable').checked && (animated ? animationCache.events : d?.cues)?.find(c => c.start <= t && c.end > t);
    styleSelect.value = subStyleValue;
    caption.replaceChildren(); caption.hidden = !cue;
    if (cue && animated) {
      cue.words.forEach((word, index) => {
        if (index) caption.append(document.createTextNode(' '));
        const span = document.createElement('span'); span.textContent = word;
        span.className = subStyleValue === 'vurgulu' && index === cue.active ? 'review-word-active' : '';
        caption.append(span);
      });
    } else caption.textContent = cue?.text || '';
    caption.style.transformOrigin = 'center bottom';
    caption.style.transform = subStyleValue === 'pop' && cue ? `scale(${.55 + .45 * Math.min(1, Math.max(0, (t - cue.start) / .09))})` : '';
    caption.style.bottom = `${bottom}%`; caption.style.left = `${side}%`; caption.style.right = `${side}%`;
    const h = $('tpCanvas').getBoundingClientRect().height;
    caption.style.fontSize = `${h * (subStyleValue === 'dolgun' ? 17 / 288 : subStyleValue === 'pop' ? .058 : subStyleValue === 'vurgulu' ? .042 : 13 / 288)}px`;
    caption.style.setProperty('--caption-outline', `${h * (animated ? .004 : subStyleValue === 'dolgun' ? 2.8 / 288 : 1.5 / 288)}px`);
    caption.dataset.style = subStyleValue;
    let overlap = false;
    if (cue && safeZonePlatform !== 'off') {
      const r = caption.getBoundingClientRect();
      overlap = [...$('tpSafeZone').children].some(el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top; });
    }
    $('reviewSafety').textContent = !cue ? 'Bu anda altyazı yok.' : safeZonePlatform === 'off' ? 'Güvenli alan kontrolü için TikTok, Shorts veya Reels seç.' : overlap ? 'Bu altyazı platform arayüzüyle çakışabilir. Konumunu veya metin uzunluğunu düzenle.' : 'Bu altyazı, seçili rehberin kapalı bölgelerine taşmıyor.';
    $('reviewSafety').dataset.warning = String(overlap);
    if (!$('trackEnable').checked) { $('tpTrackState').textContent = 'Manuel kadraj · kişi takibi kapalı'; $('tpAssessment').textContent = 'Yatay konumla kadrajı düzenleyebilirsin.'; }
  };
  function save() {
    if (openingKey !== frameKey()) { error('Kaynak veya kadraj ayarları değişti. Önizlemeyi yeniden aç.'); return false; }
    if (!ReviewData.pathValid(draftPath, currentRange().duration)) { error('Kadraj yolu geçersiz. Yeniden önizle.'); return false; }
    if ($('subEnable').checked) {
      if (!currentDoc()) { error('Önce altyazıyı oluştur ve metni kontrol et.'); return false; }
      try { doc.cues = ReviewData.parse(ReviewData.serialize(readCues()), currentRange().duration); doc.approved = true; }
      catch (err) { error(err.message); return false; }
    }
    savedFrame = { key: openingKey, path: copy(draftPath) };
    $('reviewSaveStatus').textContent = 'Kadraj ve altyazı onaylandı. Projeyi kaydet düğmesiyle dosyada saklayabilirsin.'; refresh(); return true;
  }
  $('reviewSave').onclick = save;
  window.reviewApprove = save;
  $('reviewExport').onclick = () => {
    if(window.outputProofBusy) {error('Önce çıktı provasını tamamla veya iptal et.');return;}
    if (queueRunning) { error('Devam eden dışa aktarmanın tamamlanmasını bekle.'); return; }
    if (!save()) return;
    selectedFormats.add('vertical'); refreshFormatButtons();
    const result = buildOpts(); if (result.error) { error(result.error); return; }
    queue.push({ opts: result.opts }); renderQueue(); updateDownloadBtn();
    closeTrackModal(); $('downloadBtn').click();
  };
  window.reviewBuildOpts = opts => {
    if (busy) return 'Altyazı oluşturuluyor. Tamamlanmasını bekleyin veya iptal edin.';
    if (opts.subtitle) {
      const d = currentDoc();
      if (!d?.approved) return 'Altyazı sekmesinden metni oluşturun, kontrol edin ve “Uygula ve onayla” düğmesine basın.';
      try { const cues=ReviewData.parse(ReviewData.serialize(d.cues), currentRange().duration); opts.subtitle = { source: 'edited', style: subStyleValue, srt: ReviewData.serialize(cues), words: ReviewData.alignedWords(cues,d.words), bottom, side }; }
      catch (err) { return err.message; }
    }
    if (validFrame() && opts.formats.includes('vertical')) opts.framingPath = copy(savedFrame.path);
  };
  window.reviewProject = () => ({ doc: currentDoc(), frame: validFrame(), draft: draftPath && openingKey === frameKey() ? { key: openingKey, path: copy(draftPath) } : stagedFrame?.key === frameKey() ? stagedFrame : null, bottom, side, platform: safeZonePlatform });
  window.reviewApplyProject = (data, includeTrim) => {
    doc = null; savedFrame = null; stagedFrame = null;
    if (data) {
      bottom = Math.max(5, Math.min(45, +data.bottom || 24)); side = Math.max(3, Math.min(30, +data.side || 18));
      $('reviewBottom').value = bottom; $('reviewSide').value = side; $('reviewBottomValue').textContent = `%${bottom}`; $('reviewSideValue').textContent = `%${side}`;
      if (includeTrim && data.doc?.key === textKey() && Array.isArray(data.doc.cues) && data.doc.cues.length <= 10000 && data.doc.cues.every(c => Number.isFinite(c.start) && Number.isFinite(c.end) && typeof c.text === 'string')) {
        doc = copy(data.doc);
        try { ReviewData.parse(ReviewData.serialize(doc.cues), currentRange().duration); }
        catch { doc.approved = false; } // Preserve unfinished drafts without approving them.
      }
      if (includeTrim && data.frame?.key === frameKey() && ReviewData.pathValid(data.frame.path, currentRange().duration)) savedFrame = copy(data.frame);
      if (includeTrim && data.draft?.key === frameKey() && ReviewData.pathValid(data.draft.path, currentRange().duration)) stagedFrame = copy(data.draft);
      const button = [...$('tpSafeZoneSeg').children].find(b => b.dataset.safezone === data.platform); button?.click();
    }
    if (!modal.classList.contains('hidden') && openingKey === frameKey()) draftPath = copy(stagedFrame?.path || validFrame()?.path || basePath);
    refresh();
  };
  window.reviewRefreshCues = renderCues;
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeTrackModal(); }
    if (e.key === 'Tab') {
      const buttons = [...modal.querySelectorAll('button, input, textarea, select')].filter(el => !el.disabled && el.getClientRects().length);
      const first = buttons[0], last = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  const sourceChanged = window.studioSourceChanged;
  window.studioSourceChanged = (...args) => { if (busy) { generation++; window.api.cancelSubtitleReview().catch(() => {}); } doc = null; savedFrame = null; stagedFrame = null; sourceChanged?.(...args); refresh(); };
  document.addEventListener('change', refresh); document.addEventListener('click', e => { if (e.target.closest('#subModels')) refresh(); });
  refresh();
})();
