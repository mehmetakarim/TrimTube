const $ = (id) => document.getElementById(id);

let videoDuration = 0;
let busy = false;
let infoLoaded = false;
let currentVideoId = null;
let previewUrl = null;
let formatValue = 'original';
let trackPoint = null; // önizleme üzerinde normalize (0-1) işaret konumu
let downloadPhase = 'download';

// ---- yardımcılar ----

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

// "90", "1:30", "00:01:30" biçimlerini saniyeye çevirir; geçersizse null
function parseTime(str) {
  const parts = str.trim().split(':').map(p => p.trim());
  if (parts.some(p => p === '' || !/^\d+$/.test(p)) || parts.length > 3) return null;
  return parts.reverse().reduce((acc, p, i) => acc + parseInt(p, 10) * Math.pow(60, i), 0);
}

function setStatus(type, html) {
  const el = $('statusMsg');
  el.className = type;
  el.innerHTML = html;
  el.classList.remove('hidden');
}

function clearStatus() { $('statusMsg').classList.add('hidden'); }

// ---- önizleme oynatıcısı (yt-dlp'den alınan doğrudan stream URL'si) ----

function loadPlayer() {
  const v = $('preview');
  if (!previewUrl) {
    v.classList.add('hidden');
    $('playerEmpty').textContent = 'Bu video için önizleme akışı yok — zaman kutularını kullanabilirsiniz';
    $('playerEmpty').classList.remove('hidden');
    return;
  }
  $('playerEmpty').classList.add('hidden');
  v.classList.remove('hidden');
  if (v.dataset.url !== previewUrl) {
    v.dataset.url = previewUrl;
    v.src = previewUrl;
  }
}

function seekPreview(sec) {
  const v = $('preview');
  if (v.src && !v.classList.contains('hidden')) v.currentTime = sec;
}

$('preview').addEventListener('error', () => {
  $('preview').classList.add('hidden');
  $('playerEmpty').textContent = 'Önizleme akışı oynatılamadı — zaman kutularını kullanabilirsiniz';
  $('playerEmpty').classList.remove('hidden');
});

// ---- slider / zaman girişleri senkronizasyonu ----

function updateSliderVisual() {
  const start = +$('rangeStart').value;
  const end = +$('rangeEnd').value;
  if (videoDuration > 0) {
    $('sliderRange').style.left = (start / videoDuration * 100) + '%';
    $('sliderRange').style.width = ((end - start) / videoDuration * 100) + '%';
  }
  $('clipLen').textContent = fmtTime(end - start);
}

function syncFromSlider() {
  let start = +$('rangeStart').value;
  const end = +$('rangeEnd').value;
  if (start >= end) { // kollar çakışmasın
    start = Math.min(start, end - 1);
    $('rangeStart').value = Math.max(0, start);
    if (+$('rangeStart').value >= end) $('rangeEnd').value = +$('rangeStart').value + 1;
  }
  $('startTime').value = fmtTime(+$('rangeStart').value);
  $('endTime').value = fmtTime(+$('rangeEnd').value);
  updateSliderVisual();
}

function syncFromInputs() {
  const start = parseTime($('startTime').value);
  const end = parseTime($('endTime').value);
  if (start === null || end === null) return;
  $('rangeStart').value = Math.min(start, videoDuration);
  $('rangeEnd').value = Math.min(end, videoDuration);
  updateSliderVisual();
}

$('rangeStart').addEventListener('input', syncFromSlider);
$('rangeEnd').addEventListener('input', syncFromSlider);
$('startTime').addEventListener('change', () => { syncFromInputs(); seekPreview(+$('rangeStart').value); });
$('endTime').addEventListener('change', () => { syncFromInputs(); seekPreview(Math.max(0, +$('rangeEnd').value - 3)); });
// Slider bırakıldığında önizlemeyi o noktaya sar (bitiş için 3 sn öncesine)
$('rangeStart').addEventListener('change', () => seekPreview(+$('rangeStart').value));
$('rangeEnd').addEventListener('change', () => seekPreview(Math.max(0, +$('rangeEnd').value - 3)));

$('setStartBtn').addEventListener('click', () => {
  $('startTime').value = fmtTime(Math.floor($('preview').currentTime));
  syncFromInputs();
});
$('setEndBtn').addEventListener('click', () => {
  $('endTime').value = fmtTime(Math.ceil($('preview').currentTime));
  syncFromInputs();
});

// ---- aralık kesme anahtarı ----

$('trimEnable').addEventListener('change', () => {
  $('trimControls').classList.toggle('disabled', !$('trimEnable').checked);
});

// ---- format segment seçici ----

function setFormat(value) {
  formatValue = value;
  $('btnOriginal').classList.toggle('active', value === 'original');
  $('btnVertical').classList.toggle('active', value === 'vertical');
  $('trackCard').classList.toggle('hidden', value !== 'vertical');
  if (value !== 'vertical') {
    $('trackEnable').checked = false;
    $('trackHint').classList.add('hidden');
    clearTrackMarker();
  }
}
$('btnOriginal').addEventListener('click', () => setFormat('original'));
$('btnVertical').addEventListener('click', () => setFormat('vertical'));

// Sadece ses seçiliyken dikey format anlamsız — kapat
$('quality').addEventListener('change', () => {
  const isAudio = $('quality').value === 'audio';
  $('btnVertical').disabled = isAudio;
  if (isAudio) setFormat('original');
});

// ---- kişi takibi (akıllı kadraj) ----

function clearTrackMarker() {
  trackPoint = null;
  $('trackMarker').classList.add('hidden');
}

$('trackEnable').addEventListener('change', () => {
  const on = $('trackEnable').checked;
  $('trackHint').classList.toggle('hidden', !on);
  if (!on) clearTrackMarker();
  else if ($('trimEnable').checked) seekPreview(+$('rangeStart').value); // işaretleme başlangıç karesinde yapılmalı
});

$('preview').addEventListener('click', (e) => {
  if (!$('trackEnable').checked) return;
  const v = $('preview');
  const rect = v.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  trackPoint = { x, y };
  const m = $('trackMarker');
  m.style.left = (e.clientX - rect.left) + 'px';
  m.style.top = (e.clientY - rect.top) + 'px';
  m.classList.remove('hidden');
  e.preventDefault();
});

// ---- video bilgisi ----

async function fetchInfo() {
  const url = $('url').value.trim();
  if (!url) return;
  $('urlError').classList.add('hidden');
  $('fetchBtn').disabled = true;
  $('fetchBtn').textContent = 'Alınıyor…';
  try {
    const info = await window.api.getInfo(url);
    videoDuration = Math.floor(info.duration || 0);
    currentVideoId = info.id;
    previewUrl = info.previewUrl;
    infoLoaded = true;

    $('title').textContent = info.title;
    $('meta').textContent = `${info.uploader} · ${fmtTime(videoDuration)}`;
    $('videoInfo').classList.remove('hidden');
    if (info.thumbnail) $('preview').poster = info.thumbnail;

    $('rangeStart').max = videoDuration;
    $('rangeEnd').max = videoDuration;
    $('rangeStart').value = 0;
    $('rangeEnd').value = videoDuration;
    syncFromSlider();
    loadPlayer();
    clearTrackMarker();

    $('downloadBtn').disabled = false;
    clearStatus();
    $('progressWrap').classList.add('hidden');
  } catch (err) {
    $('urlError').textContent = err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    $('urlError').classList.remove('hidden');
  } finally {
    $('fetchBtn').disabled = false;
    $('fetchBtn').textContent = 'Bilgi Al';
  }
}

$('fetchBtn').addEventListener('click', fetchInfo);
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchInfo(); });

// ---- klasör seçimi ----

window.api.getDefaultFolder().then((f) => { $('folder').textContent = f; });

$('folderBtn').addEventListener('click', async () => {
  const f = await window.api.chooseFolder();
  if (f) $('folder').textContent = f;
});

// ---- indirme ----

const PHASE_LABELS = {
  download: 'İndiriliyor…',
  convert: 'Kesiliyor / işleniyor…',
  track: 'Kişi takip ediliyor…'
};

window.api.onProgress((p) => {
  $('progressFill').style.width = p + '%';
  $('progressText').textContent = '%' + p.toFixed(1);
});
window.api.onLog((line) => { $('logLine').textContent = line; });
window.api.onPhase((phase) => {
  downloadPhase = phase;
  $('phaseLabel').textContent = PHASE_LABELS[phase] || 'İşleniyor…';
});

function setBusy(on) {
  busy = on;
  const btn = $('downloadBtn');
  btn.textContent = on ? 'İptal' : 'İndir';
  btn.classList.toggle('cancel', on);
  $('progressWrap').classList.toggle('hidden', !on);
  if (on) {
    $('progressFill').style.width = '0%';
    $('progressText').textContent = '%0';
    $('phaseLabel').textContent = 'Başlatılıyor…';
    $('logLine').textContent = '';
  }
}

$('downloadBtn').addEventListener('click', async () => {
  if (busy) { window.api.cancel(); return; }
  if (!infoLoaded) return;

  const opts = {
    url: $('url').value.trim(),
    id: currentVideoId,
    title: $('title').textContent,
    folder: $('folder').textContent,
    quality: $('quality').value,
    vertical: formatValue === 'vertical',
    track: formatValue === 'vertical' && $('trackEnable').checked,
    trackPoint,
    duration: videoDuration,
    trim: null
  };

  if ($('trimEnable').checked) {
    const start = parseTime($('startTime').value);
    const end = parseTime($('endTime').value);
    if (start === null || end === null || start >= end) {
      setStatus('err', 'Geçersiz zaman aralığı. Başlangıç bitişten küçük olmalı (örn. 00:01:30).');
      return;
    }
    if (end > videoDuration) {
      setStatus('err', `Bitiş zamanı video süresini (${fmtTime(videoDuration)}) aşıyor.`);
      return;
    }
    opts.trim = { start: fmtTime(start), end: fmtTime(end) };
  }

  clearStatus();
  setBusy(true);

  const result = await window.api.download(opts);

  setBusy(false);

  if (result.ok) {
    setStatus('ok',
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="M20 6 9 17l-5-5"/></svg>' +
      '<span>İndirme tamamlandı</span><a id="openFolderLink">Klasörü aç</a>');
    document.getElementById('openFolderLink').addEventListener('click', () => {
      window.api.openFolder($('folder').textContent);
    });
  } else if (result.cancelled) {
    setStatus('err', 'İndirme iptal edildi.');
  } else {
    setStatus('err', result.error || 'İndirme başarısız oldu.');
  }
});
