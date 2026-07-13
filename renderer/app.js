const $ = (id) => document.getElementById(id);

let videoDuration = 0;
let busy = false;
let infoLoaded = false;
let currentVideoId = null;
let previewUrl = null;
let currentLocalFile = null; // yerel dosya modu: seçili video dosyasının disk yolu (Faz 8)
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
  invalidateTrackPreview(); // aralık/kesme değişti → kadraj yolu yeniden üretilmeli
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

// İnce ayar penceresi bu süreyi (sn) aşarsa dalga formu istenmez: ffmpeg tüm
// aralığı taramak zorunda kalır (uzun videonun tamamı seçiliyken — ör. henüz
// hiçbir kesim işaretlenmemişken — saatler sürebilir, pratik bir kullanımı da
// yoktur; bu şerit zaten kısa bir kesimi ince ayarlamak içindir).
const WAVEFORM_MAX_WINDOW = 180;

function requestWaveform() {
  const img = $('waveform');
  // Kesme kapalıyken ince ayar şeridi kullanılmıyor — dalga formu üretmenin
  // anlamı yok, kullanıcı "Belirli aralığı kes"i açınca tetiklenir
  if (!$('trimEnable').checked) { img.classList.add('hidden'); return; }
  if (!previewUrl && !currentVideoId) { img.classList.add('hidden'); return; }
  clearTimeout(waveTimer);
  waveTimer = setTimeout(async () => {
    const token = ++waveToken;
    const duration = zoomWin.end - zoomWin.start;
    if (duration <= 0 || duration > WAVEFORM_MAX_WINDOW) { img.classList.add('hidden'); return; }
    let data = null;
    try {
      data = await window.api.getWaveform({ url: previewUrl, start: zoomWin.start, duration, videoId: currentVideoId, localPath: currentLocalFile });
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
  const on = $('trimEnable').checked;
  $('trimControls').classList.toggle('disabled', !on);
  // Kesme açılınca ince ayar penceresi (ve aralık uygunsa dalga formu) hazırlanır;
  // kapanınca requestWaveform kendi içinde görseli gizler
  computeZoomWindow();
});

// ---- bölümler (chapter): hazır kesim önerileri ----

let chapters = [];

function updateChapters(info) {
  chapters = info.chapters || [];
  const sel = $('chapterSelect');
  sel.innerHTML = '<option value="">Bölüm seçin…</option>';
  if (!chapters.length) {
    $('chapterField').classList.add('hidden');
    return;
  }
  chapters.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${fmtTime(c.start)} · ${c.title}`;
    sel.appendChild(o);
  });
  $('chapterField').classList.remove('hidden');
}

$('chapterSelect').addEventListener('change', () => {
  const v = $('chapterSelect').value;
  if (v === '') return;
  const c = chapters[+v];
  if (!c) return;
  // Bölüm seçmek kesmeyi de açar — aralık bölüm sınırlarına ayarlanır
  if (!$('trimEnable').checked) {
    $('trimEnable').checked = true;
    $('trimEnable').dispatchEvent(new Event('change'));
  }
  $('startTime').value = fmtTime(c.start);
  $('endTime').value = fmtTime(Math.min(c.end || videoDuration, videoDuration));
  syncFromInputs();
  computeZoomWindow();
  seekPreview(c.start);
});

// ---- format seçici (çoklu: her seçim ayrı dosya üretir) ----

const selectedFormats = new Set(['original']);

function refreshFormatButtons() {
  document.querySelectorAll('.segmented.multi .seg').forEach(b => {
    b.classList.toggle('active', selectedFormats.has(b.dataset.format));
  });
  const hasVertical = selectedFormats.has('vertical');
  $('trackCard').classList.toggle('hidden', !hasVertical);
  if (!hasVertical) {
    $('trackEnable').checked = false;
    $('trackHint').classList.add('hidden');
    $('trackPreviewRow').classList.add('hidden');
    clearTrackMarker();
    invalidateTrackPreview();
  }
}

for (const btn of document.querySelectorAll('.segmented.multi .seg')) {
  btn.addEventListener('click', () => {
    const f = btn.dataset.format;
    if (selectedFormats.has(f)) {
      if (selectedFormats.size === 1) return; // en az bir format seçili kalmalı
      selectedFormats.delete(f);
    } else {
      selectedFormats.add(f);
    }
    refreshFormatButtons();
  });
}

// Sadece ses seçiliyken format/altyazı/marka anlamsız — kapat
$('quality').addEventListener('change', () => {
  const isAudio = $('quality').value === 'audio';
  document.querySelectorAll('.segmented.multi .seg').forEach(b => { b.disabled = isAudio; });
  if (isAudio) {
    $('trackCard').classList.add('hidden');
    $('trackEnable').checked = false;
    $('trackPreviewRow').classList.add('hidden');
    clearTrackMarker();
    invalidateTrackPreview();
    $('subEnable').checked = false;
    $('subStyles').classList.add('hidden');
    $('brandCard').classList.add('hidden');
  } else {
    refreshFormatButtons();
    if (infoLoaded) $('brandCard').classList.remove('hidden');
  }
  $('subEnable').disabled = isAudio || !subPick;
});

// ---- marka: logo/watermark + başlık ----

let watermarkFile = null;
let watermarkPos = 'sag-ust';

$('wmEnable').addEventListener('change', () => {
  $('wmControls').classList.toggle('hidden', !$('wmEnable').checked);
});
$('wmChooseBtn').addEventListener('click', async () => {
  const f = await window.api.chooseImage();
  if (f) {
    watermarkFile = f;
    $('wmFile').textContent = f.split(/[\\/]/).pop();
  }
});
for (const btn of document.querySelectorAll('#wmPos .wm-pos')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#wmPos .wm-pos').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    watermarkPos = btn.dataset.pos;
  });
}
$('titleEnable').addEventListener('change', () => {
  $('titleText').classList.toggle('hidden', !$('titleEnable').checked);
  if ($('titleEnable').checked) $('titleText').focus();
});

// ---- altyazı ----

let subPick = null; // { source, ... } — video için seçilen altyazı kaynağı
let subStyleValue = 'klasik';
let subModelValue = 'small'; // Whisper model boyutu (yalnızca source==='whisper')

// Kaynak seçimi. Tercih: manuel Türkçe > herhangi bir manuel > otomatik (ASR)
// Türkçe > (hiçbiri yoksa) Whisper ile sesten otomatik oluşturma.
function pickSubtitle(info) {
  const manual = info.subLangs || [];
  const auto = info.autoLangs || [];
  const mTr = manual.find(l => l === 'tr' || l.startsWith('tr-'));
  if (mTr) return { source: 'youtube', lang: mTr, auto: false };
  if (manual.length) return { source: 'youtube', lang: manual[0], auto: false };
  if (auto.length) return { source: 'youtube', lang: auto[0], auto: true };
  return { source: 'whisper' }; // altyazı yok → sesten üret
}

function updateSubCard(info) {
  subPick = pickSubtitle(info);
  $('subCard').classList.remove('hidden');
  $('subEnable').checked = false;
  $('subEnable').disabled = false;
  $('subStyles').classList.add('hidden');
  $('subModels').classList.add('hidden');
  $('subHint').classList.add('hidden');
  if (subPick.source === 'whisper') {
    $('subCardSub').textContent = 'Altyazı yok — konuşmadan otomatik oluştur (Whisper)';
  } else if (subPick.auto) {
    $('subCardSub').textContent = `Otomatik ${subPick.lang.toUpperCase()} altyazısı gömülür (kalitesi değişken)`;
  } else {
    $('subCardSub').textContent = `${subPick.lang.toUpperCase()} altyazısı videoya gömülür`;
  }
}

$('subEnable').addEventListener('change', () => {
  const on = $('subEnable').checked;
  const whisper = subPick && subPick.source === 'whisper';
  $('subStyles').classList.toggle('hidden', !on);
  $('subModels').classList.toggle('hidden', !on || !whisper);
  $('subHint').classList.toggle('hidden', !on || !whisper);
});

for (const btn of document.querySelectorAll('#subStyles .seg')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#subStyles .seg').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    subStyleValue = btn.dataset.substyle;
  });
}

// Whisper model boyutu (hız/kalite dengesi)
for (const btn of document.querySelectorAll('#subModels .seg')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#subModels .seg').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    subModelValue = btn.dataset.submodel;
  });
}

// ---- kişi takibi (akıllı kadraj) ----

function clearTrackMarker() {
  trackPoint = null;
  $('trackMarker').classList.add('hidden');
}

$('trackEnable').addEventListener('change', () => {
  const on = $('trackEnable').checked;
  $('trackHint').classList.toggle('hidden', !on);
  $('trackPreviewRow').classList.toggle('hidden', !on);
  invalidateTrackPreview(); // takip aç/kapa → varsa eski yol geçersiz
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
  invalidateTrackPreview(); // işaret değişti → mevcut kadraj yolu geçersiz
  e.preventDefault();
});

// ---- kadraj yolu önizlemesi (Faz 8) ----
// tracker.py'nin üreteceği 9:16 kırpma penceresini render'a girmeden,
// önizleme videosunun üzerinde canlı bir maske olarak gösterir.
// #preview object-fit varsayılanı (fill) videoyu kutuya yayar; yatay konum
// kesirleri (0-1) doğrudan yüzdeye eşlenir — letterbox hesabı gerekmez.
const tp = { path: null, cropW: 0, clipStart: 0, active: false, raf: 0, generating: false };

function currentRange() {
  if ($('trimEnable').checked) {
    const s = +$('rangeStart').value, e = +$('rangeEnd').value;
    return { start: s, duration: Math.max(1, e - s) };
  }
  return { start: 0, duration: videoDuration };
}

// Kesit-göreli t anındaki pencere sol-kenar kesirini (x) interpolasyonla bulur
function xAt(arr, t) {
  if (t <= arr[0].t) return arr[0].x;
  for (let i = 1; i < arr.length; i++) {
    if (t <= arr[i].t) {
      const a = arr[i - 1], b = arr[i];
      const f = (t - a.t) / ((b.t - a.t) || 1);
      return a.x + (b.x - a.x) * f;
    }
  }
  return arr[arr.length - 1].x;
}

function drawTrackFrame() {
  if (!tp.active) return;
  const v = $('preview');
  const x = xAt(tp.path, v.currentTime - tp.clipStart);
  const leftPct = Math.max(0, Math.min(1 - tp.cropW, x)) * 100;
  const wPct = tp.cropW * 100;
  const ov = $('trackPreviewOverlay');
  ov.querySelector('.tp-left').style.width = leftPct + '%';
  const frame = ov.querySelector('.tp-frame');
  frame.style.left = leftPct + '%';
  frame.style.width = wPct + '%';
  const right = ov.querySelector('.tp-right');
  right.style.left = (leftPct + wPct) + '%';
  right.style.width = Math.max(0, 100 - leftPct - wPct) + '%';
  tp.raf = requestAnimationFrame(drawTrackFrame);
}

function setTrackPreviewBtn(state, text) {
  const btn = $('trackPreviewBtn'), st = $('trackPreviewStatus');
  if (state === 'working') { btn.textContent = 'İptal'; st.textContent = text || ''; }
  else if (state === 'active') { btn.textContent = 'Önizlemeyi durdur'; st.textContent = ''; }
  else { btn.textContent = 'Kadrajı önizle'; st.textContent = ''; }
}

function startTrackOverlay() {
  tp.active = true;
  $('trackPreviewOverlay').classList.remove('hidden');
  setTrackPreviewBtn('active');
  seekPreview(tp.clipStart); // yol baştan izlensin
  const v = $('preview');
  if (v.paused) v.play().catch(() => {});
  drawTrackFrame();
}

function stopTrackPreview() {
  tp.active = false;
  if (tp.raf) { cancelAnimationFrame(tp.raf); tp.raf = 0; }
  $('trackPreviewOverlay').classList.add('hidden');
}

// Yeni kaynak / değişen aralık / değişen işaret → önceki yol artık geçerli değil
function invalidateTrackPreview() {
  stopTrackPreview();
  tp.path = null;
  if (tp.generating) { try { window.api.cancelTrackPreview(); } catch {} tp.generating = false; }
  setTrackPreviewBtn('idle');
}

async function computeTrackPreview() {
  if (busy || tp.generating) return;
  if (tp.active) { stopTrackPreview(); setTrackPreviewBtn('idle'); return; } // aç/kapa
  if (tp.path) { startTrackOverlay(); return; }                              // mevcut yolu yeniden göster
  const r = currentRange();
  tp.generating = true;
  setTrackPreviewBtn('working', 'Hazırlanıyor…');
  let res;
  try {
    res = await window.api.trackPreview({
      url: previewUrl, videoId: currentVideoId, localFile: currentLocalFile,
      start: r.start, duration: r.duration, trackPoint
    });
  } catch (err) {
    tp.generating = false; setTrackPreviewBtn('idle');
    setStatus('err', 'Kadraj önizlemesi başarısız: ' + (err.message || err));
    return;
  }
  tp.generating = false;
  if (res.cancelled) { setTrackPreviewBtn('idle'); return; }
  if (res.error) { setTrackPreviewBtn('idle'); setStatus('err', res.error); return; }
  tp.path = res.path; tp.cropW = res.cropW; tp.clipStart = r.start;
  startTrackOverlay();
}

$('trackPreviewBtn').addEventListener('click', () => {
  if (tp.generating) { window.api.cancelTrackPreview(); return; }
  computeTrackPreview();
});

window.api.onTrackPreviewProgress((p) => {
  if (!tp.generating) return;
  if (p.stage === 'extract') setTrackPreviewBtn('working', 'Aralık hazırlanıyor…');
  else if (p.stage === 'track') setTrackPreviewBtn('working', `Takip: %${p.pct}`);
});

// ---- video bilgisi ----

// URL akışı ve yerel dosya akışı ortak durumu buradan doldurur
function populateFromInfo(info) {
  videoDuration = Math.floor(info.duration || 0);
  currentVideoId = info.id;
  previewUrl = info.previewUrl;
  currentLocalFile = info.localFile || null; // yerel dosya modu (Faz 8)
  infoLoaded = true;
  invalidateTrackPreview(); // yeni kaynak → eski kadraj önizlemesi geçersiz
  updateSubCard(info);
  $('brandCard').classList.toggle('hidden', $('quality').value === 'audio');

  $('title').textContent = info.title;
  $('meta').textContent = currentLocalFile
    ? `Yerel dosya · ${fmtTime(videoDuration)}`
    : `${info.uploader} · ${fmtTime(videoDuration)}`;
  $('videoInfo').classList.remove('hidden');
  if (info.thumbnail) $('preview').poster = info.thumbnail; else $('preview').removeAttribute('poster');

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
  $('addQueueBtn').disabled = false;
  updateChapters(info); // yerel dosyada info.chapters yok → menü gizli
  clearStatus();
  $('progressWrap').classList.add('hidden');
}

async function fetchInfo() {
  const url = $('url').value.trim();
  if (!url) return;
  $('urlError').classList.add('hidden');
  $('fetchBtn').disabled = true;
  $('fetchBtn').textContent = 'Alınıyor…';
  try {
    const info = await window.api.getInfo(url);
    populateFromInfo(info);
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

// ---- yerel dosya kaynağı (Faz 8): sürükle-bırak + dosya seçici ----

function isVideoFile(name) {
  return /\.(mp4|mkv|mov|webm|m4v|avi)$/i.test(name);
}

async function loadLocalFile(filePath) {
  clearStatus();
  $('urlError').classList.add('hidden');
  try {
    const info = await window.api.localInfo(filePath);
    if (info.error) { setStatus('err', info.error); return; }
    $('url').value = ''; // yerel moda geçildi — URL alanı temizlenir
    populateFromInfo(info);
  } catch (err) {
    setStatus('err', 'Dosya yüklenemedi: ' + (err.message || err));
  }
}

$('openFileBtn').addEventListener('click', async () => {
  if (busy) return;
  const p = await window.api.chooseVideo();
  if (p) loadLocalFile(p);
});

const dropOverlay = $('dropOverlay');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (busy) return;
  if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  dropOverlay.classList.remove('hidden');
});
window.addEventListener('dragover', (e) => {
  // 'drop' olayının tetiklenebilmesi için dragover mutlaka preventDefault etmeli;
  // aksi halde tarayıcı dosyaya gitmeye çalışır ve bırakma hiç ateşlenmez
  if (Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.classList.add('hidden');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.add('hidden');
  if (busy) return;
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  if (!isVideoFile(file.name)) {
    setStatus('err', 'Desteklenmeyen dosya türü. MP4, MKV, MOV, WEBM, M4V veya AVI bırakın.');
    return;
  }
  const p = window.api.pathForFile(file);
  if (p) loadLocalFile(p);
});

// ---- klasör seçimi (varsayılan: ayarlardaki son klasör, yoksa İndirilenler) ----

$('folderBtn').addEventListener('click', async () => {
  const f = await window.api.chooseFolder();
  if (f) {
    $('folder').textContent = f;
    window.api.setSettings({ lastFolder: f });
  }
});

// ---- indirme ----

const PHASE_LABELS = {
  download: 'İndiriliyor…',
  convert: 'Kesiliyor / işleniyor…',
  track: 'Kişi takip ediliyor…',
  subtitle: 'Altyazı oluşturuluyor…'
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
  if (on && tp.active) { stopTrackPreview(); setTrackPreviewBtn('idle'); } // indirme sırasında overlay'i gizle
  const btn = $('downloadBtn');
  btn.textContent = on ? 'İptal' : 'İndir';
  btn.classList.toggle('cancel', on);
  $('addQueueBtn').disabled = on || !infoLoaded;
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

// Mevcut arayüz seçimlerinden indirme seçeneklerini kurar; geçersizse error döner
function buildOpts() {
  const opts = {
    url: $('url').value.trim(),
    id: currentVideoId,
    title: $('title').textContent,
    folder: $('folder').textContent,
    quality: $('quality').value,
    localFile: currentLocalFile, // yerel dosya modunda indirme atlanır (Faz 8)
    formats: [...selectedFormats],
    vertical: selectedFormats.has('vertical'),
    track: selectedFormats.has('vertical') && $('trackEnable').checked,
    trackPoint,
    subtitle: ($('subEnable').checked && subPick)
      ? { ...subPick, style: subStyleValue, ...(subPick.source === 'whisper' ? { model: subModelValue } : {}) }
      : null,
    watermark: ($('wmEnable').checked && watermarkFile) ? { file: watermarkFile, position: watermarkPos } : null,
    titleText: ($('titleEnable').checked && $('titleText').value.trim()) ? $('titleText').value.trim() : null,
    duration: videoDuration,
    trim: null
  };

  if ($('trimEnable').checked) {
    const start = parseTime($('startTime').value);
    const end = parseTime($('endTime').value);
    if (start === null || end === null || start >= end) {
      return { error: 'Geçersiz zaman aralığı. Başlangıç bitişten küçük olmalı (örn. 00:01:30).' };
    }
    if (end > videoDuration) {
      return { error: `Bitiş zamanı video süresini (${fmtTime(videoDuration)}) aşıyor.` };
    }
    opts.trim = { start: fmtTime(start), end: fmtTime(end) };
  }
  return { opts };
}

// ---- kuyruk ----
// Her öğe bağımsız bir iş (kendi aralığı/formatları/altyazısı ile). Önbellek
// sayesinde aynı videodan gelen işlerde indirme yalnızca ilkinde yapılır.

const queue = [];

function queueBadges(opts) {
  const fmts = (opts.formats || []).map(f => f === 'vertical' ? '9:16' : f === 'square' ? '1:1' : 'orj').join('+');
  const extras = [
    opts.track ? 'takip' : null,
    opts.subtitle ? (opts.subtitle.source === 'whisper' ? 'oto-altyazı' : 'altyazı') : null,
    opts.watermark ? 'logo' : null,
    opts.titleText ? 'başlık' : null
  ].filter(Boolean).join('·');
  return [opts.quality === 'audio' ? 'mp3' : fmts, extras].filter(Boolean).join(' · ');
}

function renderQueue(activeIndex = -1) {
  $('queueCount').textContent = queue.length;
  $('queueSection').classList.toggle('hidden', !queue.length);
  const list = $('queueList');
  list.innerHTML = '';
  queue.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'queue-item' + (i === activeIndex ? ' active' : '');
    div.innerHTML = '<span class="q-label"></span><span class="q-badges"></span><button class="q-remove" title="Kaldır">×</button>';
    div.querySelector('.q-label').textContent = item.opts.trim
      ? `${item.opts.trim.start} – ${item.opts.trim.end}`
      : 'Tam video';
    div.querySelector('.q-badges').textContent = queueBadges(item.opts);
    div.querySelector('.q-remove').addEventListener('click', () => {
      if (busy) return;
      queue.splice(i, 1);
      renderQueue();
      updateDownloadBtn();
    });
    list.appendChild(div);
  });
}

function updateDownloadBtn() {
  if (busy) return;
  $('downloadBtn').textContent = queue.length ? `Kuyruğu indir (${queue.length})` : 'İndir';
}

$('addQueueBtn').addEventListener('click', () => {
  if (busy || !infoLoaded) return;
  const r = buildOpts();
  if (r.error) { setStatus('err', r.error); return; }
  queue.push({ opts: r.opts });
  clearStatus();
  renderQueue();
  updateDownloadBtn();
});

$('downloadBtn').addEventListener('click', async () => {
  if (busy) { window.api.cancel(); return; }
  if (!infoLoaded && !queue.length) return;

  // Kuyruk doluysa kuyruğu işle; boşsa mevcut seçim tek iş olarak çalışır
  let jobs;
  if (queue.length) {
    jobs = queue.slice();
  } else {
    const r = buildOpts();
    if (r.error) { setStatus('err', r.error); return; }
    jobs = [{ opts: r.opts }];
  }
  const isQueueRun = queue.length > 0;
  const total = jobs.length;

  clearStatus();
  setBusy(true);

  let doneCount = 0;
  let failure = null; // { cancelled } | { message }
  for (let i = 0; i < total; i++) {
    if (isQueueRun) renderQueue(0); // işlenen her zaman kuyruğun başı
    if (total > 1) $('logLine').textContent = `Kuyruk: ${i + 1}/${total}`;

    let result;
    try {
      result = await window.api.download(jobs[i].opts);
    } catch (err) {
      // Ana süreçte beklenmeyen bir hata IPC üzerinden reddedilirse arayüz
      // sonsuza dek "İndiriliyor…" durumunda donmasın — her zaman geri dönülsün
      failure = { message: 'Beklenmeyen bir hata oluştu: ' + (err.message || String(err)) };
      break;
    }
    if (result.cancelled) { failure = { cancelled: true }; break; }
    if (!result.ok) { failure = { message: result.error || 'İndirme başarısız oldu.' }; break; }

    doneCount++;
    if (isQueueRun) { queue.shift(); renderQueue(); } // başarılı iş kuyruktan düşer
  }

  setBusy(false);
  renderQueue();
  updateDownloadBtn();

  if (!failure) {
    // Not: inline style özniteliği CSP (style-src 'self') tarafından engelleniyor —
    // svg genişliği #statusMsg svg CSS kuralıyla sabitlenir
    setStatus('ok',
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
      `<span>${total > 1 ? total + ' iş tamamlandı' : 'İndirme tamamlandı'}</span><a id="openFolderLink">Klasörü aç</a>`);
    document.getElementById('openFolderLink').addEventListener('click', () => {
      window.api.openFolder($('folder').textContent);
    });
  } else if (failure.cancelled) {
    setStatus('err', doneCount > 0
      ? `İptal edildi — ${doneCount}/${total} iş tamamlanmıştı, kalanlar kuyrukta duruyor.`
      : 'İndirme iptal edildi.');
  } else {
    setStatus('err', (total > 1 ? `İş ${doneCount + 1}/${total} başarısız: ` : '') + failure.message);
  }
});

// ---- otomatik güncelleme kartı ----
// Hiçbir şey kullanıcı onayı olmadan indirilmez/kurulmaz: "available" durumunda
// sadece bilgi kartı gösterilir, indirme "Güncelle" butonuna basılınca başlar.

let updateState = 'idle'; // idle | available | downloading | ready | error
const isMac = window.api.platform === 'darwin';

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
    if (isMac) {
      // macOS'ta imzasız oto-kurulum çalışmadığı için elle indirmeye yönlendir
      $('updateSub').textContent = `TrimTube ${opts.version} — indirme sayfasından güncelleyin.`;
      btn.textContent = 'Yeni sürümü indir';
    } else {
      $('updateSub').textContent = `TrimTube ${opts.version} indirilmeye hazır.`;
      btn.textContent = 'Güncelle';
    }
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
  // macOS: oto-kurulum yerine release sayfasını aç (imzasız kurulum çalışmıyor)
  if (isMac && (updateState === 'available' || updateState === 'error')) {
    window.api.openReleasePage();
    setUpdateCard('idle');
    return;
  }
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

// ---- ayarlar & tema ----

let settings = null;

// Tema uygulaması: 'system' ise OS tercihine bakılır (matchMedia), aksi halde
// data-theme öznitelği kök öğeye yazılır — CSS token'ları buna göre değişir.
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(theme) {
  const effective = theme === 'system' ? (darkMq.matches ? 'dark' : 'light') : theme;
  document.documentElement.setAttribute('data-theme', effective);
}
darkMq.addEventListener('change', () => {
  if (settings && settings.theme === 'system') applyTheme('system');
});

function applyDefaultsToUI() {
  // Varsayılan kalite
  if (settings.defaultQuality) {
    $('quality').value = settings.defaultQuality;
    $('quality').dispatchEvent(new Event('change'));
  }
  // Varsayılan formatlar
  if (Array.isArray(settings.defaultFormats) && settings.defaultFormats.length) {
    selectedFormats.clear();
    settings.defaultFormats.forEach(f => selectedFormats.add(f));
    refreshFormatButtons();
  }
  // Klasör: son kullanılan varsa o, yoksa sistem İndirilenler
  if (settings.lastFolder) $('folder').textContent = settings.lastFolder;
  else window.api.getDefaultFolder().then((f) => { if (!$('folder').textContent) $('folder').textContent = f; });
}

async function initSettings() {
  settings = await window.api.getSettings();
  applyTheme(settings.theme);
  applyDefaultsToUI();

  // Modal alanlarını doldur
  $('setQuality').value = settings.defaultQuality || 'best';
  $('setCacheLimit').value = settings.cacheLimit || 2;
  document.querySelectorAll('#themeSeg .seg').forEach(b => {
    b.classList.toggle('active', b.dataset.themeOpt === settings.theme);
  });
  $('settingsVersion').textContent = settings.appVersion ? `TrimTube v${settings.appVersion}` : '';
}

// Tema seçimi
document.querySelectorAll('#themeSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.themeOpt;
    document.querySelectorAll('#themeSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
    settings.theme = t;
    applyTheme(t);
    window.api.setSettings({ theme: t });
  });
});

// Varsayılan kalite (ayarlar modalından) — hem kaydeder hem anlık uygular
$('setQuality').addEventListener('change', () => {
  const q = $('setQuality').value;
  settings.defaultQuality = q;
  window.api.setSettings({ defaultQuality: q });
  $('quality').value = q;
  $('quality').dispatchEvent(new Event('change'));
});

// Önbellek limiti
$('setCacheLimit').addEventListener('change', () => {
  let n = parseInt($('setCacheLimit').value, 10);
  if (isNaN(n) || n < 1) n = 1;
  if (n > 10) n = 10;
  $('setCacheLimit').value = n;
  settings.cacheLimit = n;
  window.api.setSettings({ cacheLimit: n });
});

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function refreshCacheInfo() {
  const info = await window.api.cacheInfo();
  $('cacheInfo').textContent = info.videos
    ? `${info.videos} video · ${fmtBytes(info.bytes)}`
    : `Boş · ${fmtBytes(info.bytes)}`;
}

$('cacheClearBtn').addEventListener('click', async () => {
  $('cacheClearBtn').disabled = true;
  await window.api.cacheClear();
  await refreshCacheInfo();
  $('cacheClearBtn').disabled = false;
});

// Modal aç/kapat
function openSettings() {
  $('settingsOverlay').classList.remove('hidden');
  refreshCacheInfo();
}
function closeSettings() {
  $('settingsOverlay').classList.add('hidden');
  // Varsayılan formatları çıkışta kaydet (kullanıcı ana ekranda değiştirmiş olabilir)
  window.api.setSettings({ defaultFormats: [...selectedFormats] });
}
$('settingsBtn').addEventListener('click', openSettings);
$('settingsClose').addEventListener('click', closeSettings);
$('settingsOverlay').addEventListener('click', (e) => {
  if (e.target === $('settingsOverlay')) closeSettings();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('settingsOverlay').classList.contains('hidden')) closeSettings();
});

initSettings();
