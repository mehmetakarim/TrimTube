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

let previewRetried = false;

function loadPlayer() {
  const v = $('preview');
  if (!previewUrl) {
    v.classList.add('hidden');
    $('playerChrome').classList.add('hidden');
    $('playerEmpty').textContent = 'Bu video için önizleme akışı yok — zaman kutularını kullanabilirsiniz';
    $('playerEmpty').classList.remove('hidden');
    return;
  }
  $('playerEmpty').classList.add('hidden');
  v.classList.remove('hidden');
  $('playerChrome').classList.remove('hidden');
  previewRetried = false;
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
  // İlk yüklemede bazen geçici bir Chromium medya hatası oluşabiliyor
  // (kaynak erişilebilir olsa bile); kalıcı hata göstermeden önce bir kez
  // yeniden dene — çoğu durumda ikinci denemede sorunsuz açılıyor
  if (!previewRetried && previewUrl) {
    previewRetried = true;
    console.warn('[preview] ilk yükleme başarısız, yeniden deneniyor…');
    const v = $('preview');
    v.src = previewUrl;
    return;
  }
  $('preview').classList.add('hidden');
  $('playerChrome').classList.add('hidden');
  $('playerEmpty').textContent = 'Önizleme akışı oynatılamadı — zaman kutularını kullanabilirsiniz';
  $('playerEmpty').classList.remove('hidden');
});

// ---- özel oynatıcı kontrolleri ----

function togglePlay() {
  const v = $('preview');
  if (v.paused) v.play(); else v.pause();
}

$('playBtn').addEventListener('click', togglePlay);
$('preview').addEventListener('play', () => {
  $('playIcon').classList.add('hidden');
  $('pauseIcon').classList.remove('hidden');
});
$('preview').addEventListener('pause', () => {
  $('playIcon').classList.remove('hidden');
  $('pauseIcon').classList.add('hidden');
});

$('muteBtn').addEventListener('click', () => {
  const v = $('preview');
  v.muted = !v.muted;
  $('volOnIcon').classList.toggle('hidden', v.muted);
  $('volOffIcon').classList.toggle('hidden', !v.muted);
});
$('volume').addEventListener('input', () => {
  const v = $('preview');
  v.volume = +$('volume').value;
  if (v.muted && v.volume > 0) $('muteBtn').click();
});

// Kısa süre formatı: 1 saatten kısa videolarda saat hanesi gösterme
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

// Oynatma kafası: ana slider'da her zaman, ince şeritte pencere içindeyse
$('preview').addEventListener('timeupdate', () => {
  const v = $('preview');
  const t = v.currentTime;
  $('timeLabel').textContent = `${fmtClock(t)} / ${fmtClock(videoDuration)}`;

  if (videoDuration > 0) {
    $('playheadMain').style.left = (t / videoDuration * 100) + '%';
    $('playheadMain').classList.remove('hidden');
  }
  const winLen = zoomWin.end - zoomWin.start;
  if (winLen > 0 && t >= zoomWin.start && t <= zoomWin.end) {
    $('playheadFine').style.left = ((t - zoomWin.start) / winLen * 100) + '%';
    $('playheadFine').classList.remove('hidden');
  } else {
    $('playheadFine').classList.add('hidden');
  }
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
$('startTime').addEventListener('change', () => { syncFromInputs(); seekPreview(+$('rangeStart').value); computeZoomWindow(); });
$('endTime').addEventListener('change', () => { syncFromInputs(); seekPreview(Math.max(0, +$('rangeEnd').value - 3)); computeZoomWindow(); });
// Slider bırakıldığında önizlemeyi o noktaya sar (bitiş için 3 sn öncesine)
$('rangeStart').addEventListener('change', () => { seekPreview(+$('rangeStart').value); computeZoomWindow(); });
$('rangeEnd').addEventListener('change', () => { seekPreview(Math.max(0, +$('rangeEnd').value - 3)); computeZoomWindow(); });

// ---- İnce ayar (zoom) şeridi ----
// Ana slider tüm videoyu kapsar; uzun videolarda saniye hassasiyeti imkânsızlaşır.
// Bu şerit, seçili aralığın etrafındaki dar bir pencereye yakınlaşır ve arka
// planında o pencerenin ses dalga formunu gösterir.

const zoomWin = { start: 0, end: 0 };

function updateFineVisual() {
  const winLen = zoomWin.end - zoomWin.start;
  if (winLen <= 0) return;
  const s = +$('rangeStartFine').value;
  const e = +$('rangeEndFine').value;
  $('sliderRangeFine').style.left = ((s - zoomWin.start) / winLen * 100) + '%';
  $('sliderRangeFine').style.width = ((e - s) / winLen * 100) + '%';
}

function computeZoomWindow() {
  if (videoDuration <= 0) return;
  const s = +$('rangeStart').value;
  const e = +$('rangeEnd').value;
  // Pencere: aralığın %25'i kadar (en az 15 sn) kenar payı
  const pad = Math.max(15, Math.round((e - s) * 0.25));
  zoomWin.start = Math.max(0, s - pad);
  zoomWin.end = Math.min(videoDuration, e + pad);
  for (const id of ['rangeStartFine', 'rangeEndFine']) {
    $(id).min = zoomWin.start;
    $(id).max = zoomWin.end;
  }
  $('rangeStartFine').value = s;
  $('rangeEndFine').value = e;
  $('zoomLabel').textContent = `${fmtTime(zoomWin.start)} – ${fmtTime(zoomWin.end)}`;
  updateFineVisual();
  requestWaveform();
}

function syncFromFine() {
  let s = +$('rangeStartFine').value;
  const e = +$('rangeEndFine').value;
  if (s >= e) { // kollar çakışmasın
    s = Math.min(s, e - 1);
    $('rangeStartFine').value = Math.max(zoomWin.start, s);
    if (+$('rangeStartFine').value >= e) $('rangeEndFine').value = +$('rangeStartFine').value + 1;
  }
  $('rangeStart').value = +$('rangeStartFine').value;
  $('rangeEnd').value = +$('rangeEndFine').value;
  $('startTime').value = fmtTime(+$('rangeStart').value);
  $('endTime').value = fmtTime(+$('rangeEnd').value);
  updateSliderVisual();
  updateFineVisual();
}

$('rangeStartFine').addEventListener('input', syncFromFine);
$('rangeEndFine').addEventListener('input', syncFromFine);
$('rangeStartFine').addEventListener('change', () => { seekPreview(+$('rangeStartFine').value); computeZoomWindow(); });
$('rangeEndFine').addEventListener('change', () => { seekPreview(Math.max(0, +$('rangeEndFine').value - 3)); computeZoomWindow(); });

// ---- dalga formu (debounce + eski istekleri yok say) ----

let waveToken = 0;
let waveTimer = null;

function requestWaveform() {
  const img = $('waveform');
  if (!previewUrl) { img.classList.add('hidden'); return; }
  clearTimeout(waveTimer);
  waveTimer = setTimeout(async () => {
    const token = ++waveToken;
    const duration = zoomWin.end - zoomWin.start;
    if (duration <= 0) return;
    let data = null;
    try {
      data = await window.api.getWaveform({ url: previewUrl, start: zoomWin.start, duration });
    } catch (err) {
      // dalga formu isteğe bağlı bir görsel — başarısız olursa gizlenir ama
      // sessiz kalmasın (F12 konsolunda teşhis edilebilsin)
      console.error('[waveform]', err.message || err);
    }
    if (token !== waveToken) return; // bu arada pencere değişti, sonuç bayat
    if (data) {
      img.src = data;
      img.classList.remove('hidden');
    } else {
      img.classList.add('hidden');
    }
  }, 600);
}

$('setStartBtn').addEventListener('click', () => {
  $('startTime').value = fmtTime(Math.floor($('preview').currentTime));
  syncFromInputs();
  computeZoomWindow();
});
$('setEndBtn').addEventListener('click', () => {
  $('endTime').value = fmtTime(Math.ceil($('preview').currentTime));
  syncFromInputs();
  computeZoomWindow();
});

// ---- klavye kısayolları ----
// Boşluk: oynat/duraklat · I/O: başlangıç/bitiş işaretle · J/L: ∓5 sn · ←/→: ∓1 sn

document.addEventListener('keydown', (e) => {
  const t = e.target;
  // Metin girişi veya buton odaktayken kısayollar devre dışı (buton için boşluk = tıklama)
  if (t.matches('input[type="text"], select, button')) return;
  const v = $('preview');
  if (!v.src || v.classList.contains('hidden')) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (v.paused) v.play(); else v.pause();
      break;
    case 'i': case 'I': case 'ı': case 'İ':
      if ($('trimEnable').checked) $('setStartBtn').click();
      break;
    case 'o': case 'O':
      if ($('trimEnable').checked) $('setEndBtn').click();
      break;
    case 'j': case 'J':
      v.currentTime = Math.max(0, v.currentTime - 5);
      break;
    case 'l': case 'L':
      v.currentTime = Math.min(v.duration || videoDuration, v.currentTime + 5);
      break;
    case 'k': case 'K':
      if (v.paused) v.play(); else v.pause();
      break;
    case 'ArrowLeft':
      if (t.type !== 'range') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 1); }
      break;
    case 'ArrowRight':
      if (t.type !== 'range') { e.preventDefault(); v.currentTime = Math.min(v.duration || videoDuration, v.currentTime + 1); }
      break;
  }
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
  // Kişi takibi işaretleme modu kapalıyken tıklama = oynat/duraklat
  if (!$('trackEnable').checked) { togglePlay(); return; }
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
    $('waveform').classList.add('hidden'); // önceki videonun dalga formu kalmasın
    computeZoomWindow();
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

let etaText = null;

window.api.onProgress((p) => {
  $('progressFill').style.width = p + '%';
  $('progressText').textContent = '%' + p.toFixed(1) + (etaText ? ` · kalan ${etaText}` : '');
});
window.api.onEta((eta) => { etaText = eta; });
window.api.onLog((line) => { $('logLine').textContent = line; });
window.api.onPhase((phase) => {
  downloadPhase = phase;
  etaText = null; // her aşama kendi ETA'sını üretir, öncekinden kalmasın
  $('phaseLabel').textContent = PHASE_LABELS[phase] || 'İşleniyor…';
});

function setBusy(on) {
  busy = on;
  const btn = $('downloadBtn');
  btn.textContent = on ? 'İptal' : 'İndir';
  btn.classList.toggle('cancel', on);
  $('progressWrap').classList.toggle('hidden', !on);
  if (on) {
    etaText = null;
    $('progressFill').style.width = '0%';
    $('progressText').textContent = '%0';
    $('phaseLabel').textContent = 'Başlatılıyor…';
    $('logLine').textContent = '';
  } else if ($('waveform').classList.contains('hidden')) {
    // Ağır bir iş (indirme/takip/kodlama) CPU'yu meşgul edip dalga formu
    // isteğini zaman aşımına uğratmış olabilir — iş bitince sessizce yeniden dene
    requestWaveform();
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

  let result;
  try {
    result = await window.api.download(opts);
  } catch (err) {
    // Ana süreçte beklenmeyen bir hata IPC üzerinden reddedilirse arayüz
    // sonsuza dek "İndiriliyor…" durumunda donmasın — her zaman geri dönülsün
    setBusy(false);
    setStatus('err', 'Beklenmeyen bir hata oluştu: ' + (err.message || String(err)));
    return;
  }

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

// ---- otomatik güncelleme kartı ----
// Hiçbir şey kullanıcı onayı olmadan indirilmez/kurulmaz: "available" durumunda
// sadece bilgi kartı gösterilir, indirme "Güncelle" butonuna basılınca başlar.

let updateState = 'idle'; // idle | available | downloading | ready | error

function setUpdateCard(state, opts = {}) {
  updateState = state;
  const card = $('updateCard');
  const btn = $('updateActionBtn');
  const dismiss = $('updateDismissBtn');

  if (state === 'idle') { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  $('updateProgressWrap').classList.toggle('hidden', state !== 'downloading');
  dismiss.classList.toggle('hidden', state === 'downloading');

  if (state === 'available') {
    $('updateTitle').textContent = 'Yeni sürüm mevcut';
    $('updateSub').textContent = `TrimTube ${opts.version} indirilmeye hazır.`;
    btn.textContent = 'Güncelle';
    btn.disabled = false;
  } else if (state === 'downloading') {
    $('updateTitle').textContent = 'Güncelleme indiriliyor…';
    $('updateSub').textContent = '';
    btn.textContent = 'İndiriliyor…';
    btn.disabled = true;
  } else if (state === 'ready') {
    $('updateTitle').textContent = 'Güncelleme hazır';
    $('updateSub').textContent = 'Kurulum sihirbazı açılacak; yönergeleri takip edin.';
    btn.textContent = 'Yeniden başlat ve kur';
    btn.disabled = false;
  } else if (state === 'error') {
    $('updateTitle').textContent = 'Güncelleme başarısız';
    $('updateSub').textContent = opts.message || 'Bilinmeyen hata';
    btn.textContent = 'Tekrar dene';
    btn.disabled = false;
  }
}

window.api.onUpdateAvailable((version) => setUpdateCard('available', { version }));
window.api.onUpdateProgress((percent) => {
  $('updateProgressFill').style.width = percent + '%';
});
window.api.onUpdateReady(() => setUpdateCard('ready'));
window.api.onUpdateError((message) => setUpdateCard('error', { message }));

$('updateActionBtn').addEventListener('click', async () => {
  if (updateState === 'available' || updateState === 'error') {
    setUpdateCard('downloading');
    $('updateProgressFill').style.width = '0%';
    try {
      await window.api.downloadUpdate();
    } catch (err) {
      setUpdateCard('error', { message: err.message });
    }
  } else if (updateState === 'ready') {
    window.api.installUpdate();
  }
});

$('updateDismissBtn').addEventListener('click', () => setUpdateCard('idle'));

// Ana süreçte yakalanan beklenmeyen hatalar buraya düşer — F12 ile DevTools
// açıp konsola bakınca görülebilir (sorun bildirimlerinde teşhis için).
window.api.onMainError((message) => console.error('[main]', message));
