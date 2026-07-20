const $ = (id) => document.getElementById(id);

let videoDuration = 0;
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

// ---- bildirim toast'u (başarı mesajları) ----
// Kalıcı satır yerine yüzer, kendiliğinden kapanan, elle kapatılabilir bildirim.
const TOAST_OK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
let toastTimer = null;

function showToast(msg, action, opts) {
  opts = opts || {};
  $('toastIcon').innerHTML = TOAST_OK_SVG;
  $('toastMsg').textContent = msg;
  const a = $('toastAction');
  if (action) {
    a.textContent = action.label;
    a.classList.remove('hidden');
    a.onclick = () => { action.onClick(); hideToast(); };
  } else {
    a.classList.add('hidden');
    a.onclick = null;
  }
  // İsteğe bağlı ikinci eylem (ör. "Sıkıştır" — Faz 11)
  const a2 = $('toastAction2');
  if (opts.action2) {
    a2.textContent = opts.action2.label;
    a2.classList.remove('hidden');
    a2.onclick = () => { opts.action2.onClick(); hideToast(); };
  } else {
    a2.classList.add('hidden');
    a2.onclick = null;
  }
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  // sticky: yalnızca ✕ ile kapanır (ör. indirme tamamlandı). Aksi halde birkaç
  // saniye sonra kendiliğinden kapanır (kısa bilgi mesajları için).
  if (!opts.sticky) toastTimer = setTimeout(hideToast, 8000);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('toast').classList.add('hidden');
}

$('toastClose').addEventListener('click', hideToast);

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
  refreshGifHint();
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

// ---- kare önizlemeli film şeridi (Faz 12) ----
// Video yüklenince arka planda bir kez üretilir; başarısızlık sessizce yutulur
// (süs katmanı — akışı asla engellemez). Yeni video eskisinin sonucunu geçersiz kılar.
let stripToken = 0;

function requestFilmstrip() {
  const band = $('filmstripBand');
  band.classList.add('hidden');
  if (!videoDuration || (!previewUrl && !currentLocalFile && !currentVideoId)) return;
  const token = ++stripToken;
  (async () => {
    let data = null;
    try {
      data = await window.api.getFilmstrip({
        url: previewUrl,
        duration: videoDuration,
        videoId: currentVideoId,
        localPath: currentLocalFile
      });
    } catch (err) {
      console.error('[filmstrip]', err.message || err);
    }
    if (token !== stripToken) return; // bu arada başka video yüklendi
    if (data) {
      $('filmstrip').src = data;
      band.classList.remove('hidden');
    }
  })();
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
  // Kesim kısayolları yalnız Video Kes ekranında geçerli (view sistemi)
  if (currentView !== 'cutter') return;
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
  refreshGifHint();
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

// GIF uyarısı: GIF seçili + (aralık kesilmiyor veya kesit 30 sn'den uzun)
function refreshGifHint() {
  const gifOn = selectedFormats.has('gif');
  const clipLen = $('trimEnable').checked
    ? (+$('rangeEnd').value - +$('rangeStart').value)
    : videoDuration;
  $('gifHint').classList.toggle('hidden', !(gifOn && clipLen > 30));
}

function refreshFormatButtons() {
  document.querySelectorAll('.segmented.multi .seg').forEach(b => {
    b.classList.toggle('active', selectedFormats.has(b.dataset.format));
  });
  refreshGifHint();
  const hasVertical = selectedFormats.has('vertical');
  $('trackCard').classList.toggle('hidden', !hasVertical);
  if (!hasVertical) {
    $('trackEnable').checked = false;
    $('trackHint').classList.add('hidden');
    $('trackHintSpeaker').classList.add('hidden');
    $('trackMode').classList.add('hidden');
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
    $('trackMode').classList.add('hidden');
    $('trackHint').classList.add('hidden');
    $('trackHintSpeaker').classList.add('hidden');
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
let subAllLangs = { manual: [], auto: [] }; // videonun tüm altyazı varyantları (alternatif deneme için)
let subStyleValue = 'klasik';
let subModelValue = 'small'; // Whisper model boyutu (yalnızca source==='whisper')

// Seçilen dilin alternatif varyantları (ör. tr-orig ↔ tr): altyazı indirme
// geçici hata verirse main tarafı (ensureTranscript) sırayla bunları da dener
function subAltLangs() {
  if (!subPick || subPick.source !== 'youtube') return [];
  const pool = subPick.auto ? (subAllLangs.auto || []) : (subAllLangs.manual || []);
  return pool.filter(l => l !== subPick.lang);
}

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
  subAllLangs = { manual: info.subLangs || [], auto: info.autoLangs || [] };
  $('subCard').classList.remove('hidden');
  $('subEnable').checked = false;
  $('subEnable').disabled = false;
  $('subStyles').classList.add('hidden');
  $('subModels').classList.add('hidden');
  $('subHint').classList.add('hidden');
  $('subAnimHint').classList.add('hidden');
  if (subPick.source === 'whisper') {
    $('subCardSub').textContent = 'Altyazı yok — konuşmadan otomatik oluştur (Whisper)';
  } else if (subPick.auto) {
    $('subCardSub').textContent = `Otomatik ${subPick.lang.toUpperCase()} altyazısı gömülür (kalitesi değişken)`;
  } else {
    $('subCardSub').textContent = `${subPick.lang.toUpperCase()} altyazısı videoya gömülür`;
  }
}

// Animasyonlu stil (Vurgulu/Pop) notu: yalnız stil seçiliyken görünür; YouTube
// kaynağında kelime zamanlarının tahmini olduğu uyarısını da içerir (Faz 16-A)
const ANIM_SUB_STYLES = new Set(['vurgulu', 'pop']);
function refreshSubAnimHint() {
  const on = $('subEnable').checked && ANIM_SUB_STYLES.has(subStyleValue);
  $('subAnimHint').classList.toggle('hidden', !on);
}

$('subEnable').addEventListener('change', () => {
  const on = $('subEnable').checked;
  const whisper = subPick && subPick.source === 'whisper';
  $('subStyles').classList.toggle('hidden', !on);
  $('subModels').classList.toggle('hidden', !on || !whisper);
  $('subHint').classList.toggle('hidden', !on || !whisper);
  refreshSubAnimHint();
});

for (const btn of document.querySelectorAll('#subStyles .seg')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#subStyles .seg').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    subStyleValue = btn.dataset.substyle;
    refreshSubAnimHint();
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

let trackModeValue = 'single'; // 'single' (işaretlenen kişi) | 'speaker' (aktif konuşan)

function clearTrackMarker() {
  trackPoint = null;
  $('trackMarker').classList.add('hidden');
}

// Takip açıkken moda göre ipuçlarını/işaretleme durumunu düzenler
function refreshTrackMode() {
  const on = $('trackEnable').checked;
  const speaker = trackModeValue === 'speaker';
  $('trackMode').classList.toggle('hidden', !on);
  $('trackPreviewRow').classList.toggle('hidden', !on);
  $('trackHint').classList.toggle('hidden', !on || speaker);
  $('trackHintSpeaker').classList.toggle('hidden', !on || !speaker);
  if (speaker) clearTrackMarker(); // konuşmacı modunda işaretleme kullanılmaz
}

$('trackEnable').addEventListener('change', () => {
  const on = $('trackEnable').checked;
  refreshTrackMode();
  invalidateTrackPreview(); // takip aç/kapa → varsa eski yol geçersiz
  if (!on) clearTrackMarker();
  else if (trackModeValue === 'single' && $('trimEnable').checked) seekPreview(+$('rangeStart').value);
});

for (const btn of document.querySelectorAll('#trackMode .seg')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#trackMode .seg').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    trackModeValue = btn.dataset.trackmode;
    refreshTrackMode();
    invalidateTrackPreview(); // mod değişti → kadraj yolu yeniden üretilmeli
  });
}

$('preview').addEventListener('click', (e) => {
  // Kişi takibi işaretleme modu kapalıyken (veya konuşmacı modunda) tıklama = oynat/duraklat
  if (!$('trackEnable').checked || trackModeValue === 'speaker') { togglePlay(); return; }
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
// tracker.py'nin üreteceği 9:16 kırpma penceresini render'a girmeden ayrı bir
// pencerede (modal) gösterir: solda kaynak klip + takip edilen kişiyi vurgulayan
// yeşil maske + 9:16 kadraj çerçevesi, sağda canlı kırpılmış 9:16 çıktı (canvas).
const tp = {
  path: null, cropW: 0, boxes: null, clipUrl: null,
  open: false, raf: 0, generating: false, muted: false
};

function currentRange() {
  if ($('trimEnable').checked) {
    const s = +$('rangeStart').value, e = +$('rangeEnd').value;
    return { start: s, duration: Math.max(1, e - s) };
  }
  return { start: 0, duration: videoDuration };
}

// t anındaki kadraj penceresi sol-kenar kesirini (x) interpolasyonla bulur
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

// t anındaki takip kutusunu (basamak-tut: t'den küçük/eşit son örnek) döndürür
function boxAt(arr, t) {
  let hit = arr[0];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].t <= t) hit = arr[i]; else break;
  }
  return hit;
}

function tpDrawFrame() {
  if (!tp.open) return;
  const v = $('tpVideo');
  const t = v.currentTime;
  const x = Math.max(0, Math.min(1 - tp.cropW, xAt(tp.path, t)));
  const leftPct = x * 100, wPct = tp.cropW * 100;

  // Kaynak panel: kadraj çerçevesi + iki yan karartma
  $('tpFrame').style.left = leftPct + '%';
  $('tpFrame').style.width = wPct + '%';
  $('tpSourceBox').querySelector('.tp-left').style.width = leftPct + '%';
  const right = $('tpSourceBox').querySelector('.tp-right');
  right.style.left = (leftPct + wPct) + '%';
  right.style.width = Math.max(0, 100 - leftPct - wPct) + '%';

  // Takip edilen kişi maskesi
  const mask = $('tpMask');
  const b = tp.boxes && tp.boxes.length ? boxAt(tp.boxes, t) : null;
  if (b && b.x !== null && b.w > 0) {
    mask.style.display = 'block';
    mask.style.left = (b.x * 100) + '%';
    mask.style.top = (b.y * 100) + '%';
    mask.style.width = (b.w * 100) + '%';
    mask.style.height = (b.h * 100) + '%';
  } else {
    mask.style.display = 'none';
  }

  // Sağ panel: canlı kırpılmış 9:16 çıktı (video karesinin pencere bölgesini çiz)
  const cv = $('tpCanvas');
  const vw = v.videoWidth, vh = v.videoHeight;
  if (vw && vh && cv.width) {
    const ctx = cv._ctx || (cv._ctx = cv.getContext('2d'));
    const sx = x * vw, sw = tp.cropW * vw;
    try { ctx.drawImage(v, sx, 0, sw, vh, 0, 0, cv.width, cv.height); } catch {}
  }
  tp.raf = requestAnimationFrame(tpDrawFrame);
}

function setTrackPreviewBtn(state, text) {
  const btn = $('trackPreviewBtn'), st = $('trackPreviewStatus');
  if (state === 'working') { btn.textContent = 'İptal'; st.textContent = text || ''; }
  else { btn.textContent = 'Kadrajı önizle'; st.textContent = ''; }
}

function openTrackModal() {
  tp.open = true;
  const v = $('tpVideo');
  const cv = $('tpCanvas');
  $('trackPreviewModal').classList.remove('hidden');
  $('tpPlayBtn').textContent = 'Duraklat';
  v.muted = tp.muted;
  $('tpMuteBtn').textContent = tp.muted ? 'Sesi aç' : 'Sesi kapat';
  v.src = tp.clipUrl;
  v.onloadedmetadata = () => {
    // Canvas tamponu, kırpılan çıktının doğal çözünürlüğü (net çizim)
    cv.width = Math.max(2, Math.round(tp.cropW * v.videoWidth));
    cv.height = v.videoHeight;
    v.play().catch(() => {});
    tpDrawFrame();
  };
}

function closeTrackModal() {
  tp.open = false;
  if (tp.raf) { cancelAnimationFrame(tp.raf); tp.raf = 0; }
  const v = $('tpVideo');
  try { v.pause(); } catch {}
  v.removeAttribute('src'); v.onloadedmetadata = null; try { v.load(); } catch {}
  $('trackPreviewModal').classList.add('hidden');
  try { window.api.cleanupTrackPreview(); } catch {}
  tp.path = null; tp.boxes = null; tp.clipUrl = null; // klip silindi, yeniden üretilmeli
}

// Yeni kaynak / değişen aralık / değişen işaret → önceki yol artık geçerli değil
function invalidateTrackPreview() {
  if (tp.open) closeTrackModal();
  tp.path = null; tp.boxes = null; tp.clipUrl = null;
  if (tp.generating) { try { window.api.cancelTrackPreview(); } catch {} tp.generating = false; }
  setTrackPreviewBtn('idle');
}

async function computeTrackPreview() {
  if (queueRunning || tp.generating) return; // render sürerken kaynak çakışmasını önle
  if (tp.clipUrl) { openTrackModal(); return; } // mevcut önizlemeyi yeniden aç
  const r = currentRange();
  tp.generating = true;
  setTrackPreviewBtn('working', 'Hazırlanıyor…');
  let res;
  try {
    res = await window.api.trackPreview({
      url: previewUrl, videoId: currentVideoId, localFile: currentLocalFile,
      start: r.start, duration: r.duration, trackPoint,
      speakerMode: trackModeValue === 'speaker'
    });
  } catch (err) {
    tp.generating = false; setTrackPreviewBtn('idle');
    setStatus('err', 'Kadraj önizlemesi başarısız: ' + (err.message || err));
    return;
  }
  tp.generating = false;
  setTrackPreviewBtn('idle');
  if (res.cancelled) return;
  if (res.error) { setStatus('err', res.error); return; }
  tp.path = res.path; tp.cropW = res.cropW; tp.boxes = res.boxes || []; tp.clipUrl = res.clipUrl;
  openTrackModal();
}

$('trackPreviewBtn').addEventListener('click', () => {
  if (tp.generating) { window.api.cancelTrackPreview(); return; }
  computeTrackPreview();
});
$('tpModalClose').addEventListener('click', closeTrackModal);
$('trackPreviewModal').addEventListener('click', (e) => {
  if (e.target === $('trackPreviewModal')) closeTrackModal(); // dışına tıkla = kapat
});
$('tpPlayBtn').addEventListener('click', () => {
  const v = $('tpVideo');
  if (v.paused) { v.play().catch(() => {}); $('tpPlayBtn').textContent = 'Duraklat'; }
  else { v.pause(); $('tpPlayBtn').textContent = 'Oynat'; }
});
$('tpMuteBtn').addEventListener('click', () => {
  tp.muted = !tp.muted;
  $('tpVideo').muted = tp.muted;
  $('tpMuteBtn').textContent = tp.muted ? 'Sesi aç' : 'Sesi kapat';
});

// Safe Zone maskesi (Faz 12): platform arayüz bölgelerini 9:16 çıktının üstünde
// gösterir; seçim oturum boyunca hatırlanır (modal her açılışta aynı kalır)
let safeZonePlatform = 'off';
document.querySelectorAll('#tpSafeZoneSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    safeZonePlatform = btn.dataset.safezone;
    document.querySelectorAll('#tpSafeZoneSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
    $('tpSafeZone').dataset.platform = safeZonePlatform;
  });
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
  requestFilmstrip(); // ana şeridin kare önizlemesi arka planda üretilir (Faz 12)
  computeZoomWindow();
  loadPlayer();
  clearTrackMarker();

  $('downloadBtn').disabled = false;
  $('addQueueBtn').disabled = false;
  updateChapters(info); // yerel dosyada info.chapters yok → menü gizli
  aiSourceChanged(); // yeni kaynak → eski transkript/AI sonuçları geçersiz (Faz 14)
  mdCutterSourceChanged(); // Moodlar yüklü kaynağı gösteriyorsa planı tazele (Faz 15)
  clearStatus();
  $('progressWrap').classList.add('hidden');
}

async function fetchInfo() {
  const url = $('url').value.trim();
  if (!url) return;
  // Faz 9: saf oynatma listesi bağlantısı (list= var, v= yok) → playlist akışı
  if (isPlaylistUrl(url)) { loadPlaylist(url); return; }
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

// ---- v1.18.0: tarayıcı eklentisinden gelen derin bağlantı ----
// Eklentideki "TrimTube ile Kes" butonu → main'de doğrulanmış {url, startSec}
// gelir: Video Kes ekranına geçilir, bağlantı yüklenir ve izlenen an kesim
// başlangıcı olarak işaretlenir (kullanıcı kararı).
window.api.onDeepLink(async ({ url, startSec }) => {
  if (!url) return;
  switchView('cutter');
  $('url').value = url;
  await fetchInfo();
  if (!infoLoaded) return; // yükleme başarısız — hata zaten ekranda

  if (startSec > 0 && startSec < videoDuration) {
    // Kesim aralığını uygula (applyProjectSettings ile aynı desen: change olayları
    // slider/dalga formu/ince ayar zincirini tetikler)
    if (!$('trimEnable').checked) {
      $('trimEnable').checked = true;
      $('trimEnable').dispatchEvent(new Event('change'));
    }
    $('startTime').value = fmtTime(startSec);
    $('startTime').dispatchEvent(new Event('change'));
    showToast(`YouTube'dan alındı — kesim başlangıcı ${fmtTime(startSec)}`);
  } else {
    showToast("YouTube'dan alındı");
  }
});

// ---- oynatma listesi toplu indirme (Faz 9) ----

// Saf playlist bağlantısı: list= içerir ama tekil video (v=) içermez. Bir videonun
// çalma listesi içindeki bağlantısı (watch?v=…&list=…) tekil video sayılır.
function isPlaylistUrl(u) {
  return /[?&]list=/.test(u) && !/[?&]v=/.test(u);
}

let playlistEntries = [];

async function loadPlaylist(url) {
  $('urlError').classList.add('hidden');
  clearStatus();
  $('fetchBtn').disabled = true;
  $('fetchBtn').textContent = 'Liste alınıyor…';
  try {
    const pl = await window.api.getPlaylist(url);
    if (!pl.entries || !pl.entries.length) {
      setStatus('err', 'Oynatma listesinde video bulunamadı.');
      return;
    }
    playlistEntries = pl.entries;
    openPlaylistModal(pl);
  } catch (err) {
    $('urlError').textContent = err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    $('urlError').classList.remove('hidden');
  } finally {
    $('fetchBtn').disabled = false;
    $('fetchBtn').textContent = 'Bilgi Al';
  }
}

function openPlaylistModal(pl) {
  $('plTitle').textContent = pl.title || 'Oynatma listesi';
  const list = $('plList');
  list.innerHTML = '';
  pl.entries.forEach((en, i) => {
    const row = document.createElement('label');
    row.className = 'pl-item';
    row.innerHTML = '<input type="checkbox" checked><span class="pl-item-title"></span><span class="pl-item-dur"></span>';
    row.querySelector('input').dataset.i = String(i);
    row.querySelector('.pl-item-title').textContent = en.title;
    row.querySelector('.pl-item-dur').textContent = en.duration ? fmtTime(en.duration) : '';
    list.appendChild(row);
  });
  $('plSelectAll').checked = true;
  updatePlCount();
  $('playlistModal').classList.remove('hidden');
}

function updatePlCount() {
  const checks = Array.from($('plList').querySelectorAll('input[type=checkbox]'));
  const n = checks.filter(c => c.checked).length;
  $('plCount').textContent = `${n}/${checks.length} seçili`;
  $('plAddBtn').textContent = n ? `Kuyruğa ekle (${n})` : 'Kuyruğa ekle';
  $('plAddBtn').disabled = n === 0;
  $('plSelectAll').checked = n === checks.length;
  $('plSelectAll').indeterminate = n > 0 && n < checks.length;
}

// Playlist videosu → global ayarlarla (kalite/format/klasör/marka) tam-video kuyruk
// öğesi. Kesim/kişi takibi/altyazı per-video etkileşim gerektirir; toplu işte atlanır.
function buildBatchOpts(entry) {
  const isAudio = $('quality').value === 'audio';
  return {
    url: entry.url,
    id: entry.id,
    title: entry.title,
    folder: $('folder').textContent,
    quality: $('quality').value,
    localFile: null,
    formats: isAudio ? ['original'] : [...selectedFormats],
    vertical: selectedFormats.has('vertical'),
    track: false,
    trackPoint: null,
    subtitle: null,
    watermark: (!isAudio && $('wmEnable').checked && watermarkFile) ? { file: watermarkFile, position: watermarkPos } : null,
    titleText: (!isAudio && $('titleEnable').checked && $('titleText').value.trim()) ? $('titleText').value.trim() : null,
    duration: entry.duration,
    trim: null
  };
}

function closePlaylistModal() { $('playlistModal').classList.add('hidden'); }

$('plList').addEventListener('change', updatePlCount);
$('plSelectAll').addEventListener('change', () => {
  const on = $('plSelectAll').checked;
  $('plList').querySelectorAll('input[type=checkbox]').forEach(c => { c.checked = on; });
  updatePlCount();
});
$('plClose').addEventListener('click', closePlaylistModal);
$('playlistModal').addEventListener('click', (e) => {
  if (e.target === $('playlistModal')) closePlaylistModal();
});
$('plAddBtn').addEventListener('click', () => {
  const checks = Array.from($('plList').querySelectorAll('input[type=checkbox]'));
  const chosen = checks.filter(c => c.checked).map(c => playlistEntries[+c.dataset.i]).filter(Boolean);
  if (!chosen.length) return;
  chosen.forEach(en => queue.push({ opts: buildBatchOpts(en) }));
  closePlaylistModal();
  renderQueue();
  updateDownloadBtn();
  showToast(`${chosen.length} video kuyruğa eklendi — "Kuyruğu indir" ile başlatın`);
});

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
  const p = await window.api.chooseVideo();
  if (!p) return;
  // Seçici videoyla birlikte .trimtube projesini de kabul eder (Faz 12)
  if (/\.trimtube$/i.test(p)) openProjectFile(p);
  else loadLocalFile(p);
});

const dropOverlay = $('dropOverlay');
let dragDepth = 0;
// Sıkıştır/Akıllı Kırpma ekranındayken bırakılan dosya ana boru hattına değil
// o ekrana gider; tam ekran katman yerine ekrandaki bırakma alanı vurgulanır.
const onCompressView = () => currentView === 'compress';
const onSmartTrimView = () => currentView === 'smarttrim';
const onMoodView = () => currentView === 'mood';
const onBrollView = () => currentView === 'broll';
const dropTargetEl = () => onCompressView() ? $('cmpDrop') : onSmartTrimView() ? $('stDrop') : onMoodView() ? $('mdDrop') : onBrollView() ? $('brDrop') : null;
window.addEventListener('dragenter', (e) => {
  if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  const dt = dropTargetEl();
  if (dt) dt.classList.add('drag');
  else dropOverlay.classList.remove('hidden');
});
window.addEventListener('dragover', (e) => {
  // 'drop' olayının tetiklenebilmesi için dragover mutlaka preventDefault etmeli;
  // aksi halde tarayıcı dosyaya gitmeye çalışır ve bırakma hiç ateşlenmez
  if (Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    dropOverlay.classList.add('hidden');
    $('cmpDrop').classList.remove('drag');
    $('stDrop').classList.remove('drag');
    $('mdDrop').classList.remove('drag');
    $('brDrop').classList.remove('drag');
  }
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.add('hidden');
  $('cmpDrop').classList.remove('drag');
  $('stDrop').classList.remove('drag');
  $('mdDrop').classList.remove('drag');
  $('brDrop').classList.remove('drag');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  // .trimtube projesi her ekrandan bırakılabilir (Faz 12)
  if (/\.trimtube$/i.test(file.name)) {
    const pp = window.api.pathForFile(file);
    if (pp) openProjectFile(pp);
    return;
  }
  if (!isVideoFile(file.name)) {
    const msg = 'Desteklenmeyen dosya türü. MP4, MKV, MOV, WEBM, M4V veya AVI bırakın.';
    if (onCompressView()) cmpShowError(msg);
    else if (onSmartTrimView()) stShowError(msg);
    else if (onMoodView()) mdShowError(msg);
    else if (onBrollView()) brShowError(msg);
    else setStatus('err', msg);
    return;
  }
  const p = window.api.pathForFile(file);
  if (!p) return;
  if (onCompressView()) cmpSetFile(p);
  else if (onSmartTrimView()) stSetFile(p);
  else if (onMoodView()) mdSetFile(p);
  else if (onBrollView()) brSetFile(p);
  else loadLocalFile(p);
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

// Faz 9: arka planda kuyruk — bir iş işlenirken form kilitlenmez; kullanıcı yeni
// video hazırlayıp kuyruğa ekleyebilir. progressWrap yalnızca ilerlemeyi gösterir.
function showJobProgress() {
  if (tp.open) closeTrackModal(); // önizleme modalı açıksa kapat (kaynak çakışmasın)
  etaText = null;
  $('progressFill').style.width = '0%';
  $('progressText').textContent = '%0';
  $('phaseLabel').textContent = 'Başlatılıyor…';
  $('logLine').textContent = '';
  $('progressWrap').classList.remove('hidden');
}
function hideJobProgress() {
  $('progressWrap').classList.add('hidden');
  if ($('waveform').classList.contains('hidden')) {
    // Ağır iş CPU'yu meşgul edip dalga formu isteğini zaman aşımına uğratmış
    // olabilir — iş bitince sessizce yeniden dene
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
    speakerMode: selectedFormats.has('vertical') && $('trackEnable').checked && trackModeValue === 'speaker',
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
  const fmts = (opts.formats || []).map(f => f === 'vertical' ? '9:16' : f === 'square' ? '1:1' : f === 'gif' ? 'gif' : 'orj').join('+');
  const extras = [
    opts.track ? (opts.speakerMode ? 'konuşan takip' : 'takip') : null,
    opts.subtitle ? (opts.subtitle.source === 'whisper' ? 'oto-altyazı' : 'altyazı') : null,
    opts.watermark ? 'logo' : null,
    opts.titleText ? 'başlık' : null
  ].filter(Boolean).join('·');
  return [opts.quality === 'audio' ? 'mp3' : fmts, extras].filter(Boolean).join(' · ');
}

let queueRunning = false;   // worker aktif mi
let stopRequested = false;  // "Durdur" istendi mi (mevcut işten sonra dur)

// İşlenmekte olan iş her zaman kuyruğun başıdır (queue[0]); worker çalışırken
// baştaki öğe "active" olarak vurgulanır ve kaldırılamaz.
function renderQueue() {
  $('queueCount').textContent = queue.length;
  $('queueSection').classList.toggle('hidden', !queue.length);
  const list = $('queueList');
  list.innerHTML = '';
  queue.forEach((item, i) => {
    const isActive = queueRunning && i === 0;
    const div = document.createElement('div');
    div.className = 'queue-item' + (isActive ? ' active' : '');
    div.innerHTML = '<span class="q-label"></span><span class="q-title"></span><span class="q-badges"></span><button class="q-remove" title="Kaldır">×</button>';
    div.querySelector('.q-label').textContent = item.opts.trim
      ? `${item.opts.trim.start} – ${item.opts.trim.end}`
      : 'Tam video';
    // Hangi video olduğu görünsün (playlist/çoklu işlerde önemli)
    div.querySelector('.q-title').textContent = item.opts.title || '';
    div.querySelector('.q-badges').textContent = queueBadges(item.opts);
    const rm = div.querySelector('.q-remove');
    if (isActive) {
      rm.disabled = true; // işlenen iş kaldırılamaz (Durdur ile iptal edilir)
    } else {
      rm.addEventListener('click', () => {
        queue.splice(i, 1);
        renderQueue();
        updateDownloadBtn();
      });
    }
    list.appendChild(div);
  });
}

function updateDownloadBtn() {
  const btn = $('downloadBtn');
  $('addQueueBtn').disabled = !infoLoaded; // çalışırken de yeni iş eklenebilir
  $('projSaveBtn').disabled = !infoLoaded; // proje = yüklü oturumun anlık görüntüsü
  if (queueRunning) {
    btn.textContent = 'Durdur';
    btn.classList.add('cancel');
    btn.disabled = false;
  } else {
    btn.classList.remove('cancel');
    btn.textContent = queue.length ? `Kuyruğu indir (${queue.length})` : 'İndir';
    btn.disabled = !infoLoaded && !queue.length;
  }
}

$('addQueueBtn').addEventListener('click', () => {
  if (!infoLoaded) return;
  const r = buildOpts();
  if (r.error) { setStatus('err', r.error); return; }
  queue.push({ opts: r.opts });
  clearStatus();
  renderQueue();
  updateDownloadBtn();
});

// Arka planda kuyruk worker'ı: canlı kuyruktan (queue[0]) tek tek işler; çalışırken
// eklenen işler de işlenir. Bir iş başarısız olursa atlanıp devam edilir (bir kötü
// video tüm kuyruğu durdurmasın); "Durdur"/iptal mevcut işi kesip worker'ı bitirir.
async function runQueueWorker() {
  if (queueRunning || !queue.length) return;
  queueRunning = true;
  stopRequested = false;
  clearStatus();
  showJobProgress();
  updateDownloadBtn();

  let done = 0, failed = 0;
  const failures = [];
  const producedFiles = []; // bu turda üretilen dosyalar (toast'taki "Sıkıştır" için)
  let cancelledMid = false;

  while (queue.length && !stopRequested) {
    const job = queue[0];
    renderQueue();               // baştaki iş "active" görünür
    showJobProgress();
    $('logLine').textContent = job.opts.title ? `İşleniyor: ${job.opts.title}` : 'İşleniyor…';

    let result;
    try {
      result = await window.api.download(job.opts);
    } catch (err) {
      result = { ok: false, error: 'Beklenmeyen hata: ' + (err.message || String(err)) };
    }

    if (result.cancelled) { cancelledMid = true; break; } // aktif iş kuyrukta kalır

    queue.shift(); // başarılı/başarısız — işlenen iş kuyruktan düşer
    if (result.ok) {
      done++;
      if (Array.isArray(result.files)) producedFiles.push(...result.files);
    } else { failed++; failures.push(`${job.opts.title || 'video'}: ${result.error || 'hata'}`); }
    renderQueue();
    updateDownloadBtn();
  }

  queueRunning = false;
  hideJobProgress();
  renderQueue();
  updateDownloadBtn();

  if (cancelledMid || stopRequested) {
    setStatus('err', `Durduruldu — ${done} iş tamamlandı, ${queue.length} kuyrukta kaldı.`);
  } else if (failed === 0) {
    // Üretilen son video (mp4) toast'taki "Sıkıştır" kısayoluyla modalda hazır açılır
    const lastMp4 = producedFiles.filter(f => f.toLowerCase().endsWith('.mp4')).pop();
    showToast(done > 1 ? `${done} iş tamamlandı` : 'İndirme tamamlandı', {
      label: 'Klasörü aç',
      onClick: () => window.api.openFolder($('folder').textContent)
    }, {
      sticky: true, // indirme bildirimi kendiliğinden kapanmaz, elle kapatılır
      action2: lastMp4 ? { label: 'Sıkıştır', onClick: () => openCompress(lastMp4) } : null
    });
  } else {
    setStatus('err', `${done} tamamlandı, ${failed} başarısız:\n` + failures.slice(0, 3).join('\n'));
  }
}

$('downloadBtn').addEventListener('click', () => {
  if (queueRunning) { stopRequested = true; window.api.cancel(); return; } // Durdur
  // Başlat: kuyruk boşsa mevcut seçimi tek iş olarak ekle
  if (!queue.length) {
    if (!infoLoaded) return;
    const r = buildOpts();
    if (r.error) { setStatus('err', r.error); return; }
    queue.push({ opts: r.opts });
    renderQueue();
  }
  runQueueWorker();
});

// ---- Faz 12: .trimtube proje dosyası ----
// Oturumun hafif JSON anlık görüntüsü: kaynak, kesim, format, takip, altyazı,
// marka, klasör ve kuyruk. Açılırken "tümü" veya "yalnız ayarlar" (şablon)
// olarak uygulanır; eksik/bozuk alanlar sessizce atlanır.

function buildProject() {
  return {
    title: $('title').textContent || null,
    url: currentLocalFile ? null : ($('url').value.trim() || null),
    localFile: currentLocalFile || null,
    quality: $('quality').value,
    formats: [...selectedFormats],
    trimEnable: $('trimEnable').checked,
    trim: { start: $('startTime').value, end: $('endTime').value },
    track: { enabled: $('trackEnable').checked, mode: trackModeValue, point: trackPoint },
    subtitle: { enabled: $('subEnable').checked, style: subStyleValue, model: subModelValue },
    watermark: { enabled: $('wmEnable').checked, file: watermarkFile, position: watermarkPos },
    titleText: { enabled: $('titleEnable').checked, text: $('titleText').value },
    folder: $('folder').textContent || null,
    queue: queue.map(j => j.opts)
  };
}

// Proje ayarlarını arayüze uygular; kullanıcıya gösterilecek uyarıları döndürür.
// includeTrim=false → şablon davranışı (kaynak/kesime dokunulmaz).
function applyProjectSettings(p, includeTrim) {
  const notes = [];
  if (p.quality) {
    $('quality').value = p.quality;
    $('quality').dispatchEvent(new Event('change'));
  }
  if (Array.isArray(p.formats) && p.formats.length) {
    selectedFormats.clear();
    p.formats.forEach(f => selectedFormats.add(f));
    refreshFormatButtons();
  }
  if (p.track) {
    trackModeValue = p.track.mode === 'speaker' ? 'speaker' : 'single';
    document.querySelectorAll('#trackMode .seg').forEach(b => b.classList.toggle('active', b.dataset.trackmode === trackModeValue));
    $('trackEnable').checked = !!p.track.enabled && selectedFormats.has('vertical');
    refreshTrackMode();
    trackPoint = (p.track.point && typeof p.track.point.x === 'number') ? p.track.point : null;
  }
  if (p.subtitle) {
    if (p.subtitle.style) {
      subStyleValue = p.subtitle.style;
      document.querySelectorAll('#subStyles .seg').forEach(b => b.classList.toggle('active', b.dataset.substyle === subStyleValue));
    }
    if (p.subtitle.model) {
      subModelValue = p.subtitle.model;
      document.querySelectorAll('#subModels .seg').forEach(b => b.classList.toggle('active', b.dataset.submodel === subModelValue));
    }
    // Altyazı anahtarı yalnızca kart görünürken (video için kaynak varsa) açılabilir
    if (p.subtitle.enabled && !$('subCard').classList.contains('hidden')) {
      $('subEnable').checked = true;
      $('subEnable').dispatchEvent(new Event('change'));
    }
  }
  if (p.watermark) {
    if (p.watermark.missing) {
      notes.push('Logo dosyası bulunamadı, filigran kapalı bırakıldı: ' + p.watermark.file);
    } else if (p.watermark.file) {
      watermarkFile = p.watermark.file;
      $('wmFile').textContent = watermarkFile.split(/[\\/]/).pop();
    }
    watermarkPos = p.watermark.position || 'sag-ust';
    document.querySelectorAll('#wmPos .wm-pos').forEach(b => b.classList.toggle('active', b.dataset.pos === watermarkPos));
    $('wmEnable').checked = !!p.watermark.enabled && !!watermarkFile && !p.watermark.missing;
    $('wmEnable').dispatchEvent(new Event('change'));
  }
  if (p.titleText) {
    $('titleText').value = p.titleText.text || '';
    $('titleEnable').checked = !!p.titleText.enabled && !!(p.titleText.text || '').trim();
    $('titleEnable').dispatchEvent(new Event('change'));
  }
  if (p.folder) $('folder').textContent = p.folder;
  if (includeTrim) {
    $('trimEnable').checked = !!p.trimEnable;
    $('trimEnable').dispatchEvent(new Event('change'));
    if (p.trimEnable && p.trim) {
      $('startTime').value = p.trim.start || '00:00:00';
      $('endTime').value = p.trim.end || $('endTime').value;
      $('startTime').dispatchEvent(new Event('change'));
      $('endTime').dispatchEvent(new Event('change'));
    }
  }
  return notes;
}

async function openProjectFile(path) {
  const r = await window.api.projectOpen(path); // path yoksa aç-dialoğu gösterilir
  if (!r || r.cancelled) return;
  if (r.error) { setStatus('err', r.error); return; }
  const p = r.project;

  const mode = await window.api.projectAskMode();
  if (mode === 'cancel') return;

  if (mode === 'settings') {
    const notes = applyProjectSettings(p, false);
    showToast('Proje ayarları uygulandı (şablon)');
    if (notes.length) setStatus('err', notes.join('\n'));
    return;
  }

  // Tümünü geri yükle: önce kaynak, bilgi gelince ayarlar + kuyruk
  if (p.localFile) {
    if (p.localFileMissing) { setStatus('err', 'Projedeki video dosyası bulunamadı: ' + p.localFile); return; }
    await loadLocalFile(p.localFile);
  } else if (p.url) {
    $('url').value = p.url;
    await fetchInfo();
  } else {
    setStatus('err', 'Projede video kaynağı yok.');
    return;
  }
  if (!infoLoaded) return; // yükleme başarısız olduysa hata zaten ekranda

  const notes = applyProjectSettings(p, true);
  if (Array.isArray(p.queue) && p.queue.length) {
    p.queue.forEach(opts => { if (opts && opts.url !== undefined) queue.push({ opts }); });
    renderQueue();
    updateDownloadBtn();
  }
  showToast('Proje geri yüklendi');
  if (notes.length) setStatus('err', notes.join('\n'));
}

$('projSaveBtn').addEventListener('click', async () => {
  const r = await window.api.projectSave(buildProject());
  if (r && r.ok) showToast('Proje kaydedildi');
  else if (r && r.error) setStatus('err', r.error);
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
  // Sol menü: kapalı başlar, kullanıcının son tercihi hatırlanır
  $('sideNav').classList.toggle('collapsed', !settings.sidebarOpen);

  // Modal alanlarını doldur
  $('setQuality').value = settings.defaultQuality || 'best';
  $('setCacheLimit').value = settings.cacheLimit || 2;
  document.querySelectorAll('#themeSeg .seg').forEach(b => {
    b.classList.toggle('active', b.dataset.themeOpt === settings.theme);
  });
  $('settingsVersion').textContent = settings.appVersion ? `TrimTube v${settings.appVersion}` : '';
  // API anahtarları (Faz 14 + 16-B)
  $('setGeminiKey').value = settings.geminiKey || '';
  $('setElevenKey').value = settings.elevenKey || '';
  $('setPexelsKey').value = settings.pexelsKey || '';
  // Moodlar tercihleri (Faz 15)
  mdInitFromSettings();
}

// ---- API anahtarları (Faz 14) ----
// Anahtarlar yalnızca yerelde (settings.json) durur; Gemini'ye/ElevenLabs'e
// doğrudan istekte kullanılır, hiçbir ara sunucudan geçmez.

$('setGeminiKey').addEventListener('change', () => {
  const v = $('setGeminiKey').value.trim();
  settings.geminiKey = v;
  window.api.setSettings({ geminiKey: v });
  $('geminiKeyStatus').textContent = v ? 'Kaydedildi' : 'AI Araçları ekranı için gerekli';
});

$('setElevenKey').addEventListener('change', () => {
  const v = $('setElevenKey').value.trim();
  settings.elevenKey = v;
  window.api.setSettings({ elevenKey: v });
});

// Pexels anahtarı (Faz 16-B: B-Roll stok videoları)
$('setPexelsKey').addEventListener('change', () => {
  const v = $('setPexelsKey').value.trim();
  settings.pexelsKey = v;
  window.api.setSettings({ pexelsKey: v });
});
$('pexelsKeyPageBtn').addEventListener('click', () => window.api.openPexelsKeyPage());

$('geminiKeyPageBtn').addEventListener('click', () => window.api.openGeminiKeyPage());

$('geminiKeyTestBtn').addEventListener('click', async () => {
  const key = $('setGeminiKey').value.trim();
  $('geminiKeyTestBtn').disabled = true;
  $('geminiKeyStatus').textContent = 'Doğrulanıyor…';
  let r;
  try { r = await window.api.aiTestKey(key); }
  catch (err) { r = { error: err.message || String(err) }; }
  $('geminiKeyTestBtn').disabled = false;
  $('geminiKeyStatus').textContent = r.ok ? '✓ Anahtar geçerli' : r.error;
});

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

// ---- v1.17.0: indirme motoru (yt-dlp) sürüm + elle güncelleme ----
function fmtLastCheck(ms) {
  if (!ms) return 'henüz kontrol edilmedi';
  const d = Math.floor((Date.now() - ms) / 60000); // dakika
  if (d < 1) return 'az önce kontrol edildi';
  if (d < 60) return `${d} dk önce kontrol edildi`;
  const h = Math.floor(d / 60);
  if (h < 24) return `${h} saat önce kontrol edildi`;
  return `${Math.floor(h / 24)} gün önce kontrol edildi`;
}

async function refreshYtdlpInfo() {
  const r = await window.api.ytdlpInfo();
  $('ytdlpInfo').textContent = r.version
    ? `yt-dlp ${r.version} · ${fmtLastCheck(r.lastCheck)}`
    : 'yt-dlp sürümü okunamadı';
}

$('ytdlpUpdateBtn').addEventListener('click', async () => {
  const btn = $('ytdlpUpdateBtn');
  btn.disabled = true;
  $('ytdlpInfo').textContent = 'Güncelleniyor…';
  let r;
  try { r = await window.api.ytdlpUpdate(); }
  catch (err) { r = { error: err.message || String(err) }; }
  btn.disabled = false;
  if (r.error) {
    $('ytdlpInfo').textContent = 'Güncelleme başarısız';
    setStatus('err', 'yt-dlp güncellenemedi: ' + r.error);
    return;
  }
  await refreshYtdlpInfo();
  if (r.updated) showToast(`yt-dlp ${r.version} sürümüne güncellendi`);
  else showToast('yt-dlp zaten güncel');
});

// ---- Sol navigasyon + ekran (view) sistemi (v1.12.0) ----
// Her menü öğesi bir ekran gösterir; ana ekran kalabalıklaşmadan yeni özellikler
// (Faz 12+: GIF, Moodlar…) kendi ekranlarıyla eklenir. Ayarlar ve Sıkıştır
// eskiden modaldı, artık birer ekran.
const VIEWS = { cutter: 'viewCutter', compress: 'viewCompress', smarttrim: 'viewSmartTrim', ai: 'viewAI', mood: 'viewMood', broll: 'viewBroll', settings: 'viewSettings' };
let currentView = 'cutter';

function switchView(name) {
  if (!VIEWS[name] || name === currentView) return;
  // Ayarlardan çıkarken varsayılan formatları kaydet (eski closeSettings davranışı)
  if (currentView === 'settings') window.api.setSettings({ defaultFormats: [...selectedFormats] });
  currentView = name;
  Object.entries(VIEWS).forEach(([key, id]) => $(id).classList.toggle('hidden', key !== name));
  document.querySelectorAll('#sideNav .nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'settings') { refreshCacheInfo(); refreshYtdlpInfo(); }
  if (name === 'ai') aiRefreshView(); // anahtar/kaynak durumu her girişte tazelenir
  if (name === 'mood') mdRefreshView();
}

document.querySelectorAll('#sideNav .nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// Hamburger: menüyü aç/kapa; son durum ayarlarda hatırlanır (kapalı başlar)
$('navToggle').addEventListener('click', () => {
  const open = $('sideNav').classList.contains('collapsed');
  $('sideNav').classList.toggle('collapsed', !open);
  if (settings) { settings.sidebarOpen = open; window.api.setSettings({ sidebarOpen: open }); }
});

// Esc: özellik ekranlarından ana ekrana dön
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentView !== 'cutter') switchView('cutter');
});

// ---- Faz 11: Sıkıştırma ekranı ----
// Üretilen (veya herhangi bir yerel) videoyu görsel kayıpsız yeniden kodlayıp
// küçültür. Ana indirme/kuyruk akışından tamamen bağımsızdır: kendi ilerleme
// kanalı (compress-progress) ve kendi iptali vardır; kuyruk çalışırken de
// kullanılabilir (ekrandan ayrılınca iş arkada sürer, dönünce canlı ilerleme
// görünür — öğeler gizliyken de güncellenir). Render kalitesi ayarlarına dokunmaz.

let cmpFile = null;      // seçili dosyanın tam yolu
let cmpRunning = false;
let cmpMode = 'quality'; // quality (görsel kayıpsız) | size (hedef MB)
let cmpEta = null;

// Toast'taki "Sıkıştır" kısayolu buradan geçer: ekrana geç + dosyayı ön seç
function openCompress(presetFile) {
  switchView('compress');
  if (presetFile) cmpSetFile(presetFile);
}

function cmpShowError(msg) {
  const el = $('cmpError');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function cmpClearError() { $('cmpError').classList.add('hidden'); }

async function cmpSetFile(p) {
  if (cmpRunning) return; // iş sürerken dosya değiştirilemez
  cmpClearError();
  $('cmpResult').classList.add('hidden');
  $('cmpOpenFolderBtn').classList.add('hidden');
  const info = await window.api.localInfo(p);
  if (info.error) { cmpShowError(info.error); return; }
  cmpFile = p;
  $('cmpFileName').textContent = p.split(/[\\/]/).pop();
  const parts = [fmtBytes(info.size), fmtClock(info.duration)];
  if (info.w && info.h) parts.push(`${info.w}×${info.h}`);
  $('cmpFileMeta').textContent = parts.join(' · ');
  $('cmpDrop').classList.add('hidden');
  $('cmpFileCard').classList.remove('hidden');
  cmpUpdateStart();
}

function cmpResetFile() {
  if (cmpRunning) return;
  cmpFile = null;
  $('cmpFileCard').classList.add('hidden');
  $('cmpDrop').classList.remove('hidden');
  $('cmpResult').classList.add('hidden');
  $('cmpOpenFolderBtn').classList.add('hidden');
  cmpClearError();
  cmpUpdateStart();
}

$('cmpChooseBtn').addEventListener('click', async () => {
  const p = await window.api.chooseVideo();
  if (p) cmpSetFile(p);
});
$('cmpFileChange').addEventListener('click', cmpResetFile);

// Mod seçimi: hedef boyut satırı yalnızca "size" modunda görünür
document.querySelectorAll('#cmpModeSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    if (cmpRunning) return;
    cmpMode = btn.dataset.cmpMode;
    document.querySelectorAll('#cmpModeSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
    $('cmpSizeRow').classList.toggle('hidden', cmpMode !== 'size');
    cmpUpdateStart();
  });
});

function cmpUpdateStart() {
  const btn = $('cmpStartBtn');
  if (cmpRunning) { btn.disabled = false; btn.textContent = 'Durdur'; return; }
  btn.textContent = 'Sıkıştır';
  btn.disabled = !cmpFile;
}

window.api.onCompressProgress((p) => {
  if (p.eta !== undefined) cmpEta = p.eta;
  $('cmpProgressFill').style.width = p.pct + '%';
  $('cmpProgressText').textContent = '%' + p.pct.toFixed(1) + (cmpEta ? ` · kalan ${cmpEta}` : '');
});

const CMP_OK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

$('cmpStartBtn').addEventListener('click', async () => {
  if (cmpRunning) { window.api.compressCancel(); return; } // Durdur
  if (!cmpFile) return;

  let targetMB = null;
  if (cmpMode === 'size') {
    targetMB = parseInt($('cmpTargetMB').value, 10);
    if (isNaN(targetMB) || targetMB < 5) { cmpShowError('Geçerli bir hedef boyut girin (en az 5 MB).'); return; }
  }

  cmpRunning = true;
  cmpEta = null;
  cmpClearError();
  $('cmpResult').classList.add('hidden');
  $('cmpOpenFolderBtn').classList.add('hidden');
  $('cmpProgressFill').style.width = '0%';
  $('cmpProgressText').textContent = '%0';
  $('cmpProgress').classList.remove('hidden');
  cmpUpdateStart();

  let r;
  try {
    r = await window.api.compressVideo({ file: cmpFile, mode: cmpMode, targetMB, hevc: $('cmpHevc').checked });
  } catch (err) {
    r = { error: 'Beklenmeyen hata: ' + (err.message || String(err)) };
  }

  cmpRunning = false;
  $('cmpProgress').classList.add('hidden');
  cmpUpdateStart();

  if (r.cancelled) return; // sessizce eski duruma dön
  if (r.error) { cmpShowError(r.error); return; }

  const saved = r.beforeBytes > 0 ? Math.round((1 - r.afterBytes / r.beforeBytes) * 100) : 0;
  $('cmpResultIcon').innerHTML = CMP_OK_SVG;
  $('cmpResultTitle').textContent = saved > 0
    ? `%${saved} küçüldü — ${r.outFile.split(/[\\/]/).pop()}`
    : 'Tamamlandı — kaynak dosya zaten verimli kodlanmış';
  $('cmpResultSub').textContent = `${fmtBytes(r.beforeBytes)} → ${fmtBytes(r.afterBytes)}`;
  $('cmpResult').classList.remove('hidden');
  const outDir = r.outFile.slice(0, r.outFile.length - r.outFile.split(/[\\/]/).pop().length - 1);
  $('cmpOpenFolderBtn').onclick = () => window.api.openFolder(outDir);
  $('cmpOpenFolderBtn').classList.remove('hidden');
});

// ---- Faz 13: Akıllı Kırpma (Kurgu Motoru) ----
// Whisper kelime zaman damgalarından sessizlik + dolgu kelime adayı çıkarır;
// kullanıcı onay kutulu listede gözden geçirip yalnızca işaretlileri kırpar.
// Sıkıştır ile aynı bağımsız-ekran/kendi-çıktısı deseni; kendi ilerleme kanalı
// ve iptali vardır, ana kuyruğa dokunmaz.

let stFile = null;
let stDuration = 0;
let stCandidates = []; // {id, type, start, end, text, included}
let stRunning = false;
let stSensValue = 0.7;
let stModelValue = 'small';
let stEta = null;

function stShowError(msg) {
  const el = $('stError');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function stClearError() { $('stError').classList.add('hidden'); }

function stResetResults() {
  stCandidates = [];
  $('stResults').classList.add('hidden');
  $('stList').innerHTML = '';
  $('stApplyBtn').classList.add('hidden');
  $('stAnalyzeBtn').classList.remove('hidden');
  $('stResultCard').classList.add('hidden');
  $('stOpenFolderBtn').classList.add('hidden');
}

async function stSetFile(p) {
  if (stRunning) return; // iş sürerken dosya değiştirilemez
  stClearError();
  stResetResults();
  const info = await window.api.localInfo(p);
  if (info.error) { stShowError(info.error); return; }
  stFile = p;
  stDuration = info.duration;
  $('stFileName').textContent = p.split(/[\\/]/).pop();
  const parts = [fmtBytes(info.size), fmtClock(info.duration)];
  if (info.w && info.h) parts.push(`${info.w}×${info.h}`);
  $('stFileMeta').textContent = parts.join(' · ');
  $('stDrop').classList.add('hidden');
  $('stFileCard').classList.remove('hidden');
  $('stAnalyzeBtn').disabled = false;
}

function stResetFile() {
  if (stRunning) return;
  stFile = null;
  stDuration = 0;
  $('stFileCard').classList.add('hidden');
  $('stDrop').classList.remove('hidden');
  $('stAnalyzeBtn').disabled = true;
  stClearError();
  stResetResults();
}

$('stChooseBtn').addEventListener('click', async () => {
  const p = await window.api.chooseVideo();
  if (p) stSetFile(p);
});
$('stFileChange').addEventListener('click', stResetFile);

document.querySelectorAll('#stSensSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    if (stRunning) return;
    stSensValue = parseFloat(btn.dataset.stSens);
    document.querySelectorAll('#stSensSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
  });
});
document.querySelectorAll('#stModelSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    if (stRunning) return;
    stModelValue = btn.dataset.stModel;
    document.querySelectorAll('#stModelSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
  });
});

// Geçiş sesi (Faz 16-A): birleşim noktalarına whoosh/pop; boş değer = kapalı
let stSfxValue = '';
document.querySelectorAll('#stSfxSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    if (stRunning) return;
    stSfxValue = btn.dataset.stSfx;
    document.querySelectorAll('#stSfxSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
  });
});

const ST_TYPE_LABEL = { silence: 'Sessizlik', filler: 'Dolgu kelime' };
const ST_TYPE_ICON = { silence: '🔇', filler: '💬' };

// Aday listesini ve özet satırını (canlı, onay kutusu her değişince) çizer
function stRenderList() {
  const list = $('stList');
  list.innerHTML = '';
  stCandidates.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'pl-item';
    row.innerHTML = '<input type="checkbox"><span class="pl-item-title"></span><span class="pl-item-dur"></span>';
    row.querySelector('input').checked = c.included;
    row.querySelector('input').addEventListener('change', (e) => {
      c.included = e.target.checked;
      stUpdateSummary();
    });
    const label = c.type === 'filler' ? `${ST_TYPE_ICON.filler} "${c.text}"` : `${ST_TYPE_ICON.silence} ${ST_TYPE_LABEL.silence}`;
    row.querySelector('.pl-item-title').textContent = `${label} · ${fmtClock(c.start)}–${fmtClock(c.end)}`;
    row.querySelector('.pl-item-dur').textContent = fmtClock(c.end - c.start);
    list.appendChild(row);
  });
  stUpdateSummary();
  $('stResults').classList.remove('hidden');
}

function stUpdateSummary() {
  const included = stCandidates.filter(c => c.included);
  const cutSec = included.reduce((s, c) => s + (c.end - c.start), 0);
  const afterSec = Math.max(0, stDuration - cutSec);
  $('stSummary').textContent = stCandidates.length
    ? `${included.length}/${stCandidates.length} kesim seçili · ${fmtClock(cutSec)} kısalacak (${fmtClock(stDuration)} → ${fmtClock(afterSec)})`
    : 'Sessizlik veya dolgu kelime bulunamadı.';
  $('stApplyBtn').classList.toggle('hidden', included.length === 0);
}

window.api.onSmartTrimProgress((p) => {
  if (p.eta !== undefined) stEta = p.eta;
  const label = p.stage === 'audio' ? 'Ses çıkarılıyor…'
    : p.stage === 'model' ? 'Model hazırlanıyor…'
    : p.stage === 'transcribe' ? 'Konuşma çözümleniyor…'
    : 'Kırpılıyor…';
  $('stPhaseLabel').textContent = label;
  const pct = p.pct || 0;
  $('stProgressFill').style.width = pct + '%';
  $('stProgressText').textContent = '%' + pct.toFixed(1) + (stEta ? ` · kalan ${stEta}` : '');
});

// İki ayrı eylem (Tespit et / Kırp ve Kaydet) tek seferde biri çalışabilir;
// başlatan düğme "Durdur"a döner, diğeri o sürece kilitlenir (Sıkıştır'daki
// tek-düğme aç/kapa deseninin iki düğmeli hali).
let stActivePhase = null; // 'analyze' | 'apply' | null

function stSetRunning(running, phase) {
  stRunning = running;
  stActivePhase = running ? phase : null;
  const aBtn = $('stAnalyzeBtn');
  aBtn.textContent = (running && phase === 'analyze') ? 'Durdur' : 'Tespit et';
  aBtn.disabled = running ? phase !== 'analyze' : !stFile;
  const pBtn = $('stApplyBtn');
  pBtn.textContent = (running && phase === 'apply') ? 'Durdur' : 'Kırp ve Kaydet';
  pBtn.disabled = running && phase !== 'apply';
  $('stFileChange').disabled = running;
  $('stProgress').classList.toggle('hidden', !running);
}

$('stAnalyzeBtn').addEventListener('click', async () => {
  if (stRunning && stActivePhase === 'analyze') { window.api.smartTrimCancel(); return; }
  if (stRunning || !stFile) return;
  stClearError();
  stResetResults();
  stEta = null;
  $('stProgressFill').style.width = '0%';
  $('stProgressText').textContent = '%0';
  stSetRunning(true, 'analyze');

  let r;
  try {
    r = await window.api.smartTrimAnalyze({
      file: stFile,
      model: stModelValue,
      threshold: stSensValue,
      includeFillers: $('stFillerCheck').checked
    });
  } catch (err) {
    r = { error: 'Beklenmeyen hata: ' + (err.message || String(err)) };
  }

  stSetRunning(false);
  if (r.cancelled) return;
  if (r.error) { stShowError(r.error); return; }

  stDuration = r.duration;
  stCandidates = r.candidates.map(c => ({ ...c, included: true }));
  stRenderList();
});

const ST_OK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

$('stApplyBtn').addEventListener('click', async () => {
  if (stRunning && stActivePhase === 'apply') { window.api.smartTrimCancel(); return; }
  if (stRunning) return;
  const cuts = stCandidates.filter(c => c.included).map(c => ({ start: c.start, end: c.end }));
  if (!cuts.length || !stFile) return;
  stClearError();
  stEta = null;
  $('stProgressFill').style.width = '0%';
  $('stProgressText').textContent = '%0';
  $('stResultCard').classList.add('hidden');
  $('stOpenFolderBtn').classList.add('hidden');
  stSetRunning(true, 'apply');

  let r;
  try {
    r = await window.api.smartTrimApply({ file: stFile, duration: stDuration, cuts, sfx: stSfxValue || null, jcut: $('stJcutCheck').checked });
  } catch (err) {
    r = { error: 'Beklenmeyen hata: ' + (err.message || String(err)) };
  }

  stSetRunning(false);
  if (r.cancelled) return;
  if (r.error) { stShowError(r.error); return; }

  $('stResultIcon').innerHTML = ST_OK_SVG;
  $('stResultTitle').textContent = `Kırpıldı — ${r.outFile.split(/[\\/]/).pop()}`;
  $('stResultSub').textContent = `${fmtClock(r.beforeDuration)} → ${fmtClock(r.afterDuration)}`;
  $('stResultCard').classList.remove('hidden');
  const outDir = r.outFile.slice(0, r.outFile.length - r.outFile.split(/[\\/]/).pop().length - 1);
  $('stOpenFolderBtn').onclick = () => window.api.openFolder(outDir);
  $('stOpenFolderBtn').classList.remove('hidden');
});

// ---- Faz 14: AI Araçları (Gemini) ----
// Dört araç (başlık, konu arama, hook bulucu, reklam kontrolü) Video Kes
// ekranındaki yüklü kaynak üzerinde ve ortak bir transkriptle çalışır. Gemini
// çağrıları ve transkript üretimi main süreçte; burada durum/akış yönetimi var.

let aiSegments = null;      // hazır transkript segmentleri [{start,end,text}]
let aiTransSource = null;   // 'youtube' | 'whisper' — hazır transkriptin kaynağı
let aiModelValue = 'small'; // whisper model boyutu (kaynak whisper ise)
let aiRunning = null;       // 'transcript'|'titles'|'search'|'hooks'|'adcheck'|null
let aiTool = 'titles';

function aiHasKey() { return !!(settings && (settings.geminiKey || '').trim()); }

// Transkript kaynağı kararı: videoda YouTube altyazısı varsa (subPick) onu
// kullan — saniyeler sürer ve API anahtarı gerektirmez; yoksa Whisper.
function aiPlannedSource() {
  if (subPick && subPick.source === 'youtube') {
    return { source: 'youtube', lang: subPick.lang, auto: subPick.auto, altLangs: subAltLangs() };
  }
  return { source: 'whisper', model: aiModelValue };
}

function aiShowError(msg) {
  const el = $('aiError');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function aiClearError() { $('aiError').classList.add('hidden'); }

function aiClearOutputs() {
  for (const id of ['aiTitlesOut', 'aiSearchOut', 'aiHooksOut', 'aiAdOut']) {
    $(id).innerHTML = '';
    $(id).classList.add('hidden');
  }
  $('aiAdVerdict').classList.add('hidden');
  aiClearError();
}

// Yeni video yüklendi → eski transkript ve sonuçlar geçersiz
function aiSourceChanged() {
  aiSegments = null;
  aiTransSource = null;
  aiClearOutputs();
  aiRefreshView();
}

function aiRefreshView() {
  // Anahtar uyarısı: araçlar için gerekli; transkript anahtarsız da hazırlanır
  $('aiKeyWarn').classList.toggle('hidden', aiHasKey());

  $('aiNoSource').classList.toggle('hidden', infoLoaded);
  $('aiSourceCard').classList.toggle('hidden', !infoLoaded);
  $('aiTransGroup').classList.toggle('hidden', !infoLoaded);
  $('aiTools').classList.toggle('hidden', !infoLoaded);
  if (infoLoaded) {
    $('aiSourceName').textContent = $('title').textContent;
    $('aiSourceMeta').textContent = $('meta').textContent;
  }

  const ready = !!aiSegments;
  $('aiTransBadge').textContent = ready ? 'Transkript hazır' : 'Transkript yok';
  $('aiTransBadge').classList.toggle('ready', ready);

  const planned = infoLoaded ? aiPlannedSource() : null;
  $('aiModelSeg').classList.toggle('hidden', !planned || planned.source !== 'whisper');
  if (ready) {
    $('aiTransInfo').textContent = aiTransSource === 'youtube'
      ? `Hazır · YouTube altyazısından · ${aiSegments.length} bölüm`
      : `Hazır · Whisper · ${aiSegments.length} bölüm`;
    $('aiTransNote').textContent = '';
  } else {
    $('aiTransInfo').textContent = 'Hazır değil';
    $('aiTransNote').textContent = !planned ? ''
      : planned.source === 'youtube'
        ? 'Bu videonun YouTube altyazısı var — transkript saniyeler içinde hazırlanır.'
        : 'Altyazı bulunamadı — ses Whisper ile yazıya dökülür (ilk kullanımda model indirilir; süre video uzunluğuyla orantılıdır).';
  }
  aiRefreshButtons();
}

function aiRefreshButtons() {
  const ready = !!aiSegments;
  const tBtn = $('aiTransBtn');
  tBtn.textContent = aiRunning === 'transcript' ? 'Durdur' : (ready ? 'Yenile' : 'Hazırla');
  tBtn.disabled = !infoLoaded || (!!aiRunning && aiRunning !== 'transcript');

  const map = { titles: 'aiTitlesBtn', search: 'aiSearchBtn', hooks: 'aiHooksBtn', adcheck: 'aiAdBtn' };
  const labels = { titles: 'Üret', search: 'Ara', hooks: 'Analiz et', adcheck: 'Tara' };
  for (const [tool, id] of Object.entries(map)) {
    const b = $(id);
    b.textContent = aiRunning === tool ? 'Durdur' : labels[tool];
    b.disabled = aiRunning ? aiRunning !== tool : !ready;
  }
}

const AI_PHASE_LABELS = {
  subdl: 'YouTube altyazısı indiriliyor…',
  download: 'Ses indiriliyor…',
  audio: 'Ses çıkarılıyor…',
  model: 'Model hazırlanıyor…',
  transcribe: 'Konuşma çözümleniyor…',
  energy: 'Ses enerjisi ölçülüyor…',
  think: 'Gemini düşünüyor…'
};

window.api.onAiProgress((p) => {
  if (!aiRunning) return;
  $('aiPhaseLabel').textContent = AI_PHASE_LABELS[p.stage] || 'İşleniyor…';
  const fill = $('aiProgressFill');
  if (typeof p.pct === 'number') {
    fill.classList.remove('indet');
    fill.style.width = p.pct + '%';
    $('aiProgressText').textContent = '%' + Math.round(p.pct);
  } else {
    // Süresi öngörülemeyen aşama (altyazı indirme, Gemini isteği): kayan dolgu
    fill.style.width = '';
    fill.classList.add('indet');
    $('aiProgressText').textContent = '';
  }
});

function aiSetRunning(tool) {
  aiRunning = tool;
  $('aiProgress').classList.toggle('hidden', !tool);
  if (tool) {
    $('aiProgressFill').classList.remove('indet');
    $('aiProgressFill').style.width = '0%';
    $('aiProgressText').textContent = '';
    $('aiPhaseLabel').textContent = 'Hazırlanıyor…';
  }
  aiRefreshButtons();
}

// ---- transkript hazırlama ----

$('aiTransBtn').addEventListener('click', async () => {
  if (aiRunning === 'transcript') { window.api.aiCancel(); return; }
  if (aiRunning || !infoLoaded) return;
  aiClearError();
  aiClearOutputs();
  aiSegments = null;
  aiTransSource = null;
  aiSetRunning('transcript');

  const src = aiPlannedSource();
  let r;
  try {
    r = await window.api.aiTranscript({
      url: $('url').value.trim() || null,
      videoId: currentVideoId,
      localFile: currentLocalFile,
      ...src
    });
  } catch (err) {
    r = { error: 'Beklenmeyen hata: ' + (err.message || String(err)) };
  }
  aiSetRunning(null);
  if (r.cancelled) { aiRefreshView(); return; }
  if (r.error) { aiShowError(r.error); aiRefreshView(); return; }
  aiSegments = r.segments || [];
  aiTransSource = r.source;
  aiRefreshView();
  if (r.cachedHit) showToast('Transkript önbellekten yüklendi');
});

document.querySelectorAll('#aiModelSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    if (aiRunning) return;
    aiModelValue = btn.dataset.aiModel;
    document.querySelectorAll('#aiModelSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
  });
});

// ---- araç seçici ----

const AI_PANELS = { titles: 'aiPanelTitles', search: 'aiPanelSearch', hooks: 'aiPanelHooks', adcheck: 'aiPanelAdcheck' };
document.querySelectorAll('#aiToolSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    aiTool = btn.dataset.aiTool;
    document.querySelectorAll('#aiToolSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
    Object.entries(AI_PANELS).forEach(([k, id]) => $(id).classList.toggle('hidden', k !== aiTool));
  });
});

// ---- ortak yardımcılar ----

// Başlık/reklam araçları kesim aralığı açıkken yalnızca o aralığı kullanır
function aiCurrentRange() {
  if ($('trimEnable').checked) {
    const s = +$('rangeStart').value, e = +$('rangeEnd').value;
    if (e > s) return { start: s, end: e };
  }
  return null;
}

// Arama/hook sonucunu kesim aralığına uygula ve Video Kes ekranına dön
function aiApplyRange(start, end) {
  start = Math.max(0, Math.floor(start));
  end = Math.min(videoDuration, Math.ceil(end));
  if (end <= start) end = Math.min(videoDuration, start + 1);
  if (!$('trimEnable').checked) {
    $('trimEnable').checked = true;
    $('trimEnable').dispatchEvent(new Event('change'));
  }
  $('startTime').value = fmtTime(start);
  $('endTime').value = fmtTime(end);
  syncFromInputs();
  computeZoomWindow();
  switchView('cutter');
  seekPreview(start);
  showToast(`Aralık uygulandı: ${fmtTime(start)} – ${fmtTime(end)}`);
}

async function aiCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Panoya kopyalandı');
  } catch {
    aiShowError('Panoya kopyalanamadı.');
  }
}

// Ortak araç akışı: aynı düğme Durdur'a döner, hata tek yerde gösterilir
async function aiRunTool(tool, call, render) {
  if (aiRunning === tool) { window.api.aiCancel(); return; }
  if (aiRunning || !aiSegments) return;
  aiClearError();
  aiSetRunning(tool);
  let r;
  try { r = await call(); }
  catch (err) { r = { error: 'Beklenmeyen hata: ' + (err.message || String(err)) }; }
  aiSetRunning(null);
  if (r.cancelled) return;
  if (r.error) { aiShowError(r.error); return; }
  render(r);
}

function aiEmptyNote(wrap, text) {
  const div = document.createElement('div');
  div.className = 'ai-empty';
  div.textContent = text;
  wrap.appendChild(div);
}

// ---- 1) başlık / açıklama / hashtag ----

$('aiTitlesBtn').addEventListener('click', () => aiRunTool('titles',
  () => window.api.aiTitles({ segments: aiSegments, videoTitle: $('title').textContent, range: aiCurrentRange() }),
  (r) => {
    const wrap = $('aiTitlesOut');
    wrap.innerHTML = '';
    const addRow = (label, text) => {
      const row = document.createElement('div');
      row.className = 'ai-item';
      row.innerHTML = '<div class="ai-item-main"><span class="ai-item-label"></span><span class="ai-item-text"></span></div><button class="btn-ghost small">Kopyala</button>';
      row.querySelector('.ai-item-label').textContent = label;
      row.querySelector('.ai-item-text').textContent = text;
      row.querySelector('button').addEventListener('click', () => aiCopy(text));
      wrap.appendChild(row);
    };
    r.titles.forEach((t, i) => addRow(`Başlık ${i + 1}`, t));
    if (r.caption) addRow('Açıklama', r.caption);
    if (r.hashtags.length) addRow('Hashtag', r.hashtags.join(' '));
    const all = document.createElement('button');
    all.className = 'btn-ghost small ai-copy-all';
    all.textContent = 'Tümünü kopyala';
    all.addEventListener('click', () => aiCopy([
      ...r.titles.map((t, i) => `${i + 1}. ${t}`),
      '',
      r.caption,
      '',
      r.hashtags.join(' ')
    ].join('\n').trim()));
    wrap.appendChild(all);
    wrap.classList.remove('hidden');
  }
));

// ---- 2) semantik konu arama ----

$('aiSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('aiSearchBtn').click(); });
$('aiSearchBtn').addEventListener('click', () => {
  const q = $('aiSearchInput').value.trim();
  if (!q && aiRunning !== 'search') { aiShowError('Aranacak bir konu yazın.'); return; }
  aiRunTool('search',
    () => window.api.aiSearch({ segments: aiSegments, query: q }),
    (r) => {
      const wrap = $('aiSearchOut');
      wrap.innerHTML = '';
      if (!r.matches.length) aiEmptyNote(wrap, 'Bu konudan bahsedilen bir bölüm bulunamadı.');
      r.matches.forEach(m => {
        const row = document.createElement('div');
        row.className = 'ai-item';
        row.innerHTML = '<div class="ai-item-main"><span class="ai-item-label"></span><span class="ai-item-text"></span></div><button class="btn-ghost small">Aralığı uygula</button>';
        row.querySelector('.ai-item-label').textContent = `${fmtClock(m.start)} – ${fmtClock(m.end)}`;
        row.querySelector('.ai-item-text').textContent = m.quote ? `"${m.quote}" — ${m.reason}` : m.reason;
        row.querySelector('button').addEventListener('click', () => aiApplyRange(m.start, m.end));
        wrap.appendChild(row);
      });
      wrap.classList.remove('hidden');
    }
  );
});

// ---- 3) hook bulucu ----

$('aiHooksBtn').addEventListener('click', () => aiRunTool('hooks',
  () => window.api.aiHooks({ segments: aiSegments, videoId: currentVideoId, localFile: currentLocalFile }),
  (r) => {
    const wrap = $('aiHooksOut');
    wrap.innerHTML = '';
    if (!r.hooks.length) aiEmptyNote(wrap, 'Öne çıkan bir an bulunamadı.');
    r.hooks.forEach(h => {
      const row = document.createElement('div');
      row.className = 'ai-item';
      row.innerHTML = '<span class="ai-score"></span><div class="ai-item-main"><span class="ai-item-label"></span><span class="ai-item-text"></span></div><button class="btn-ghost small">Aralığı uygula</button>';
      row.querySelector('.ai-score').textContent = h.score;
      row.querySelector('.ai-item-label').textContent = `${h.title} · ${fmtClock(h.start)} – ${fmtClock(h.end)}`;
      row.querySelector('.ai-item-text').textContent = h.reason;
      row.querySelector('button').addEventListener('click', () => aiApplyRange(h.start, h.end));
      wrap.appendChild(row);
    });
    if (r.hooks.length && !r.energyUsed) {
      aiEmptyNote(wrap, 'Not: yerel ses bulunamadığı için puanlama yalnızca transkripte dayanıyor.');
    }
    wrap.classList.remove('hidden');
  }
));

// ---- 4) reklam dostu içerik taraması ----

const AI_VERDICTS = {
  uygun: { label: 'Reklam dostu görünüyor', cls: 'ok' },
  'sınırlı': { label: 'Sınırlı reklam riski', cls: 'warn' },
  riskli: { label: 'Reklam kapatılma riski yüksek', cls: 'bad' }
};

$('aiAdBtn').addEventListener('click', () => aiRunTool('adcheck',
  () => window.api.aiAdCheck({ segments: aiSegments, range: aiCurrentRange() }),
  (r) => {
    const v = AI_VERDICTS[r.verdict] || AI_VERDICTS['sınırlı'];
    const card = $('aiAdVerdict');
    card.classList.remove('hidden', 'ok', 'warn', 'bad');
    card.classList.add(v.cls);
    $('aiAdIcon').textContent = v.cls === 'ok' ? '✓' : '!';
    $('aiAdTitle').textContent = v.label;
    $('aiAdSub').textContent = r.summary || '';
    const wrap = $('aiAdOut');
    wrap.innerHTML = '';
    r.findings.forEach(f => {
      const row = document.createElement('div');
      row.className = 'ai-item';
      row.innerHTML = '<span class="ai-severity"></span><div class="ai-item-main"><span class="ai-item-label"></span><span class="ai-item-text"></span></div>';
      const sev = row.querySelector('.ai-severity');
      sev.textContent = f.severity;
      sev.dataset.sev = f.severity;
      row.querySelector('.ai-item-label').textContent = `${fmtClock(f.start)} – ${fmtClock(f.end)}${f.category ? ' · ' + f.category : ''}`;
      row.querySelector('.ai-item-text').textContent = f.quote ? `"${f.quote}"` : '';
      wrap.appendChild(row);
    });
    wrap.classList.toggle('hidden', !r.findings.length);
  }
));

$('aiGoSettings').addEventListener('click', () => switchView('settings'));
$('aiGoCutter').addEventListener('click', () => switchView('cutter'));

// ---- Faz 15: Moodlar & AI Director ----
// Akış: bölüm dosyası → mood/süre/ses → "Kurgu planı oluştur" (Whisper + Gemini)
// → plan önizlemesi → "Seslendir ve Montajla" (ElevenLabs TTS + montaj robotu).
// Sıkıştır/Akıllı Kırpma ile aynı bağımsız-ekran deseni; kendi kanalı/iptali var.

let mdFile = null;       // açıkça seçilen/bırakılan dosya (yüklü kaynağı geçersiz kılar)
let mdVideoId = null;    // localInfo'nun kararlı kimliği (transkript önbelleği için)
let mdDuration = 0;
let mdMood = 'komedi';
let mdTarget = 60;
let mdPlanData = null;   // { title, scenes:[{start,end,narration}], totalSec, transSource }
let mdPlanContext = null; // planın üretildiği kaynak (render aynı kaynağı kullanır)
let mdRunning = null;    // 'plan' | 'render' | null
let mdVoicesLoaded = false; // ElevenLabs ses listesi (API'den) yüklendi mi
let mdTtsProvider = 'gemini'; // gemini (varsayılan — ek üyelik gerekmez) | eleven
let mdSubStyle = 'kutulu';
let mdOutFile = null;    // son üretilen kurgu ("Videoyu Düzenle" için)

// Google (Gemini) TTS hazır sesleri — API'den liste gerekmez, model sabittir
const GEMINI_VOICES = [
  { id: 'Kore', name: 'Kore — kadın, net' },
  { id: 'Aoede', name: 'Aoede — kadın, sıcak' },
  { id: 'Leda', name: 'Leda — kadın, genç' },
  { id: 'Zephyr', name: 'Zephyr — kadın, parlak' },
  { id: 'Puck', name: 'Puck — erkek, enerjik' },
  { id: 'Charon', name: 'Charon — erkek, derin' },
  { id: 'Fenrir', name: 'Fenrir — erkek, güçlü' },
  { id: 'Enceladus', name: 'Enceladus — erkek, yumuşak' }
];

// Kaynak modu: açık dosya > Video Kes'te yüklü kaynak > yok.
// Yüklü YouTube kaynağında transkript, altyazı varsa Whisper'a hiç girmeden
// YouTube altyazısından gelir (kullanıcı geri bildirimi: gereksiz yük olmasın).
function mdSourceMode() {
  if (mdFile) return 'file';
  if (infoLoaded) return 'loaded';
  return 'none';
}

// Yüklü kaynak için planlanan transkript yolu (AI Araçları ile aynı karar)
function mdLoadedUsesYtSubs() {
  return !currentLocalFile && subPick && subPick.source === 'youtube';
}

function mdShowError(msg) {
  const el = $('mdError');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function mdClearError() { $('mdError').classList.add('hidden'); }

function mdResetPlan() {
  mdPlanData = null;
  mdPlanContext = null;
  mdOutFile = null;
  $('mdPlan').classList.add('hidden');
  $('mdSceneList').innerHTML = '';
  $('mdRenderBtn').classList.add('hidden');
  $('mdResult').classList.add('hidden');
  $('mdOpenFolderBtn').classList.add('hidden');
  $('mdEditBtn').classList.add('hidden');
}

// Anahtar durumu uyarısı: Gemini her zaman gerekli (plan + varsayılan Google
// TTS); ElevenLabs yalnızca o sağlayıcı seçiliyken gerekir
function mdRefreshView() {
  const gemOk = !!(settings && (settings.geminiKey || '').trim());
  const elvOk = !!(settings && (settings.elevenKey || '').trim());
  const needEleven = mdTtsProvider === 'eleven';
  const warn = $('mdKeyWarn');
  if (gemOk && (!needEleven || elvOk)) {
    warn.classList.add('hidden');
  } else {
    const missing = [!gemOk && 'Gemini (kurgu planı + Google sesi)', needEleven && !elvOk && 'ElevenLabs (seslendirme)'].filter(Boolean).join(' ve ');
    $('mdKeyWarnText').textContent = `Eksik API anahtarı: ${missing}. Ayarlar ekranından ekleyin.`;
    warn.classList.remove('hidden');
  }
  mdApplyVoiceUi();

  // Kaynak kartları: açık dosya > yüklü kaynak > bırakma alanı
  const mode = mdSourceMode();
  $('mdDrop').classList.toggle('hidden', mode !== 'none');
  $('mdFileCard').classList.toggle('hidden', mode !== 'file');
  $('mdLoadedCard').classList.toggle('hidden', mode !== 'loaded');
  if (mode === 'loaded') {
    $('mdLoadedName').textContent = $('title').textContent;
    $('mdLoadedMeta').textContent = $('meta').textContent;
    const yt = mdLoadedUsesYtSubs();
    $('mdTransBadge').textContent = yt ? 'YouTube altyazısı — hızlı transkript' : 'Whisper ile çözümlenir';
    $('mdTransBadge').classList.toggle('ready', yt);
  }
  mdRefreshButtons();
}

function mdRefreshButtons() {
  const pBtn = $('mdPlanBtn');
  pBtn.textContent = mdRunning === 'plan' ? 'Durdur' : (mdPlanData ? 'Planı yenile' : 'Kurgu planı oluştur');
  pBtn.disabled = mdRunning ? mdRunning !== 'plan' : mdSourceMode() === 'none';
  const rBtn = $('mdRenderBtn');
  rBtn.textContent = mdRunning === 'render' ? 'Durdur' : 'Seslendir ve Montajla';
  rBtn.disabled = !!mdRunning && mdRunning !== 'render';
  rBtn.classList.toggle('hidden', !mdPlanData);
  $('mdFileChange').disabled = !!mdRunning;
  $('mdUseFileBtn').disabled = !!mdRunning;
  $('mdEditBtn').disabled = !!mdRunning;
}

// Ses seçiciyi sağlayıcıya göre kurar: Google → sabit Gemini ses listesi
// (anında, ağ gerekmez); ElevenLabs → API'den yüklenen liste + Yenile düğmesi
function mdApplyVoiceUi() {
  const sel = $('mdVoice');
  $('mdVoiceReload').classList.toggle('hidden', mdTtsProvider !== 'eleven');
  if (mdTtsProvider === 'gemini') {
    sel.innerHTML = '';
    GEMINI_VOICES.forEach(v => {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.name;
      sel.appendChild(o);
    });
    if (settings && settings.moodVoiceGemini && GEMINI_VOICES.some(v => v.id === settings.moodVoiceGemini)) {
      sel.value = settings.moodVoiceGemini;
    }
  } else {
    const elvOk = !!(settings && (settings.elevenKey || '').trim());
    if (elvOk && !mdVoicesLoaded) mdLoadVoices();
    else if (!elvOk) sel.innerHTML = '<option value="">ElevenLabs anahtarı gerekli (Ayarlar)</option>';
  }
}

// Video Kes'e yeni kaynak yüklendi: açık dosya seçilmediyse Moodlar artık o
// kaynağı gösterir — eski plan geçersiz (populateFromInfo çağırır)
function mdCutterSourceChanged() {
  if (!mdFile) {
    mdResetPlan();
    mdClearError();
  }
  mdRefreshView();
}

async function mdLoadVoices() {
  const sel = $('mdVoice');
  sel.innerHTML = '<option value="">Yükleniyor…</option>';
  let r;
  try { r = await window.api.moodVoices(); }
  catch (err) { r = { error: err.message || String(err) }; }
  if (r.error) {
    sel.innerHTML = `<option value="">${r.error.length > 60 ? 'Ses listesi alınamadı' : r.error}</option>`;
    mdVoicesLoaded = false;
    return;
  }
  mdVoicesLoaded = true;
  sel.innerHTML = '';
  r.voices.forEach(v => {
    const o = document.createElement('option');
    o.value = v.id;
    o.textContent = v.name;
    sel.appendChild(o);
  });
  // Son kullanılan ses hatırlanır
  if (settings.moodVoice && r.voices.some(v => v.id === settings.moodVoice)) sel.value = settings.moodVoice;
}

$('mdVoice').addEventListener('change', () => {
  const v = $('mdVoice').value;
  if (!v) return;
  // Tercih sağlayıcı bazında hatırlanır (Google ↔ ElevenLabs geçişinde korunur)
  if (mdTtsProvider === 'gemini') {
    settings.moodVoiceGemini = v;
    window.api.setSettings({ moodVoiceGemini: v });
  } else {
    settings.moodVoice = v;
    window.api.setSettings({ moodVoice: v });
  }
});
$('mdVoiceReload').addEventListener('click', () => { mdVoicesLoaded = false; mdLoadVoices(); });

// TTS sağlayıcı seçimi
document.querySelectorAll('#mdTtsSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    if (mdRunning) return;
    mdTtsProvider = btn.dataset.mdTts;
    document.querySelectorAll('#mdTtsSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
    settings.moodTtsProvider = mdTtsProvider;
    window.api.setSettings({ moodTtsProvider: mdTtsProvider });
    mdRefreshView();
  });
});

// Altyazı gömme tercihi + stil
$('mdSubCheck').addEventListener('change', () => {
  $('mdSubStyleSeg').classList.toggle('hidden', !$('mdSubCheck').checked);
  settings.moodSubtitle = $('mdSubCheck').checked;
  window.api.setSettings({ moodSubtitle: settings.moodSubtitle });
});
document.querySelectorAll('#mdSubStyleSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    if (mdRunning) return;
    mdSubStyle = btn.dataset.mdSubstyle;
    document.querySelectorAll('#mdSubStyleSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
  });
});

// Kalıcı tercihleri arayüze uygula (initSettings çağırır)
function mdInitFromSettings() {
  mdTtsProvider = settings.moodTtsProvider === 'eleven' ? 'eleven' : 'gemini';
  document.querySelectorAll('#mdTtsSeg .seg').forEach(b => b.classList.toggle('active', b.dataset.mdTts === mdTtsProvider));
  $('mdSubCheck').checked = !!settings.moodSubtitle;
  $('mdSubStyleSeg').classList.toggle('hidden', !settings.moodSubtitle);
}

async function mdSetFile(p) {
  if (mdRunning) return;
  mdClearError();
  mdResetPlan();
  const info = await window.api.localInfo(p);
  if (info.error) { mdShowError(info.error); return; }
  mdFile = p;
  mdVideoId = info.id;
  mdDuration = info.duration;
  $('mdFileName').textContent = p.split(/[\\/]/).pop();
  const parts = [fmtBytes(info.size), fmtClock(info.duration)];
  if (info.w && info.h) parts.push(`${info.w}×${info.h}`);
  $('mdFileMeta').textContent = parts.join(' · ');
  mdRefreshView();
}

// "Değiştir": açık dosyayı bırak — yüklü kaynak varsa ona, yoksa bırakma alanına döner
function mdResetFile() {
  if (mdRunning) return;
  mdFile = null;
  mdVideoId = null;
  mdDuration = 0;
  mdClearError();
  mdResetPlan();
  mdRefreshView();
}

$('mdChooseBtn').addEventListener('click', async () => {
  const p = await window.api.chooseVideo();
  if (p) mdSetFile(p);
});
$('mdUseFileBtn').addEventListener('click', async () => {
  const p = await window.api.chooseVideo();
  if (p) mdSetFile(p);
});
$('mdFileChange').addEventListener('click', mdResetFile);

document.querySelectorAll('#mdMoodSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    if (mdRunning) return;
    mdMood = btn.dataset.mdMood;
    document.querySelectorAll('#mdMoodSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
  });
});
document.querySelectorAll('#mdTargetSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    if (mdRunning) return;
    mdTarget = +btn.dataset.mdTarget;
    document.querySelectorAll('#mdTargetSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
  });
});

const MD_PHASE_LABELS = {
  subdl: 'YouTube altyazısı indiriliyor…',
  download: 'Ses indiriliyor…',
  fetch: 'Video önbelleğe indiriliyor…',
  audio: 'Ses çıkarılıyor…',
  model: 'Model hazırlanıyor…',
  transcribe: 'Diyalog haritası çıkarılıyor…',
  plan: 'Gemini kurguyu tasarlıyor…',
  tts: 'Anlatıcı seslendiriliyor…',
  render: 'Montajlanıyor…'
};
let mdEta = null;

window.api.onMoodProgress((p) => {
  if (!mdRunning) return;
  if (p.eta !== undefined) mdEta = p.eta;
  let label = MD_PHASE_LABELS[p.stage] || 'İşleniyor…';
  if (p.stage === 'tts' && p.total) label = `Anlatıcı seslendiriliyor… (${p.idx}/${p.total})`;
  $('mdPhaseLabel').textContent = label;
  const fill = $('mdProgressFill');
  if (typeof p.pct === 'number') {
    fill.classList.remove('indet');
    fill.style.width = p.pct + '%';
    $('mdProgressText').textContent = '%' + Math.round(p.pct) + (mdEta ? ` · kalan ${mdEta}` : '');
  } else {
    fill.style.width = '';
    fill.classList.add('indet');
    $('mdProgressText').textContent = '';
  }
});

function mdSetRunning(phase) {
  mdRunning = phase;
  $('mdProgress').classList.toggle('hidden', !phase);
  if (phase) {
    mdEta = null;
    $('mdProgressFill').classList.remove('indet');
    $('mdProgressFill').style.width = '0%';
    $('mdProgressText').textContent = '';
    $('mdPhaseLabel').textContent = 'Hazırlanıyor…';
  }
  mdRefreshButtons();
}

const MD_MOOD_LABELS = { komedi: 'Komedi', dram: 'Dram', gerilim: 'Gerilim', duygusal: 'Duygusal', ozet: 'Özet' };

function mdRenderPlan() {
  const p = mdPlanData;
  $('mdPlanTitle').textContent = p.title ? `"${p.title}" · ${MD_MOOD_LABELS[mdMood] || mdMood}` : (MD_MOOD_LABELS[mdMood] || mdMood);
  const narrCount = p.scenes.filter(s => s.narration).length;
  const src = p.transSource === 'youtube' ? ' · transkript: YouTube altyazısı' : '';
  $('mdPlanSummary').textContent = `${p.scenes.length} sahne · ${narrCount} anlatım · ~${fmtClock(p.totalSec)}${src}`;
  const list = $('mdSceneList');
  list.innerHTML = '';
  p.scenes.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'ai-item';
    row.innerHTML = '<span class="md-scene-no"></span><div class="ai-item-main"><span class="ai-item-label"></span><span class="ai-item-text md-scene-narr"></span></div><span class="pl-item-dur"></span>';
    row.querySelector('.md-scene-no').textContent = i + 1;
    row.querySelector('.ai-item-label').textContent = `${fmtClock(s.start)} – ${fmtClock(s.end)}`;
    row.querySelector('.md-scene-narr').textContent = s.narration ? `🎙 ${s.narration}` : '';
    row.querySelector('.pl-item-dur').textContent = fmtClock(s.end - s.start);
    list.appendChild(row);
  });
  $('mdPlan').classList.remove('hidden');
}

// Kaynak moduna göre plan/render bağlamını kurar. Render, planın üretildiği
// kaynağı kullanır (arada Video Kes'te başka video yüklense bile tutarlı kalır).
function mdBuildContext() {
  const mode = mdSourceMode();
  if (mode === 'file') {
    const name = mdFile.split(/[\\/]/).pop();
    return {
      file: mdFile, url: null, videoId: mdVideoId, duration: mdDuration,
      source: 'whisper',
      outDir: mdFile.slice(0, mdFile.length - name.length - 1),
      baseName: name.replace(/\.[^.]+$/, '')
    };
  }
  if (mode === 'loaded') {
    if (currentLocalFile) {
      const name = currentLocalFile.split(/[\\/]/).pop();
      return {
        file: currentLocalFile, url: null, videoId: currentVideoId, duration: videoDuration,
        source: 'whisper',
        outDir: currentLocalFile.slice(0, currentLocalFile.length - name.length - 1),
        baseName: name.replace(/\.[^.]+$/, '')
      };
    }
    const yt = mdLoadedUsesYtSubs();
    return {
      file: null, url: $('url').value.trim() || null, videoId: currentVideoId, duration: videoDuration,
      source: yt ? 'youtube' : 'whisper',
      lang: yt ? subPick.lang : undefined,
      auto: yt ? subPick.auto : undefined,
      altLangs: yt ? subAltLangs() : undefined,
      outDir: $('folder').textContent || null, // kayıt klasörü (indirme çıktılarıyla aynı yer)
      baseName: $('title').textContent || 'kurgu'
    };
  }
  return null;
}

$('mdPlanBtn').addEventListener('click', async () => {
  if (mdRunning === 'plan') { window.api.moodCancel(); return; }
  if (mdRunning) return;
  const ctx = mdBuildContext();
  if (!ctx) return;
  mdClearError();
  mdResetPlan();
  mdSetRunning('plan');

  let r;
  try {
    r = await window.api.moodPlan({
      file: ctx.file, url: ctx.url, videoId: ctx.videoId, duration: ctx.duration,
      source: ctx.source, lang: ctx.lang, auto: ctx.auto, altLangs: ctx.altLangs,
      mood: mdMood, targetSec: mdTarget, model: 'small'
    });
  } catch (err) {
    r = { error: 'Beklenmeyen hata: ' + (err.message || String(err)) };
  }
  mdSetRunning(null);
  if (r.cancelled) return;
  if (r.error) { mdShowError(r.error); return; }
  mdPlanData = { title: r.title, scenes: r.scenes, totalSec: r.totalSec, transSource: r.transSource };
  mdPlanContext = ctx;
  mdRenderPlan();
  mdRefreshButtons();
});

const MD_OK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

$('mdRenderBtn').addEventListener('click', async () => {
  if (mdRunning === 'render') { window.api.moodCancel(); return; }
  if (mdRunning || !mdPlanData || !mdPlanContext) return;
  const ctx = mdPlanContext;
  const needVoice = mdPlanData.scenes.some(s => s.narration);
  // Google sağlayıcısında ses her zaman seçilidir (sabit liste, varsayılan Kore);
  // ElevenLabs'ta liste yüklenememişse boş kalabilir
  const voiceId = $('mdVoice').value || (mdTtsProvider === 'gemini' ? 'Kore' : '');
  if (needVoice && !voiceId) {
    mdShowError('Anlatıcı sesi seçilmedi — ElevenLabs anahtarını girip ses listesini yenileyin.');
    return;
  }
  mdClearError();
  $('mdResult').classList.add('hidden');
  $('mdOpenFolderBtn').classList.add('hidden');
  $('mdEditBtn').classList.add('hidden');
  mdSetRunning('render');

  let r;
  try {
    r = await window.api.moodRender({
      file: ctx.file, url: ctx.url, videoId: ctx.videoId,
      outDir: ctx.outDir, baseName: ctx.baseName,
      scenes: mdPlanData.scenes, voiceId, ttsProvider: mdTtsProvider, mood: mdMood,
      subtitle: $('mdSubCheck').checked ? { style: mdSubStyle } : null,
      // Altyazı için plan transkripti önbellekten geri yüklenir (aynı anahtar)
      trans: { source: ctx.source, lang: ctx.lang, auto: ctx.auto, altLangs: ctx.altLangs, model: 'small' }
    });
  } catch (err) {
    r = { error: 'Beklenmeyen hata: ' + (err.message || String(err)) };
  }
  mdSetRunning(null);
  if (r.cancelled) return;
  if (r.error) { mdShowError(r.error); return; }

  mdOutFile = r.outFile;
  $('mdResultIcon').innerHTML = MD_OK_SVG;
  $('mdResultTitle').textContent = `Kurgu hazır — ${r.outFile.split(/[\\/]/).pop()}`;
  $('mdResultSub').textContent = `~${fmtClock(r.duration)} · ${r.narrated} anlatım${$('mdSubCheck').checked ? ' · altyazılı' : ''}`;
  $('mdResult').classList.remove('hidden');
  const outDir = r.outFile.slice(0, r.outFile.length - r.outFile.split(/[\\/]/).pop().length - 1);
  $('mdOpenFolderBtn').onclick = () => window.api.openFolder(outDir);
  $('mdOpenFolderBtn').classList.remove('hidden');
  $('mdEditBtn').classList.remove('hidden');
});

// Videoyu Düzenle: üretilen kurgu Video Kes ekranına yüklenir — kesim/format/
// marka gibi ince ayarlar oradan sürdürülür (altyazı seçildiyse zaten gömülü)
$('mdEditBtn').addEventListener('click', async () => {
  if (!mdOutFile || mdRunning) return;
  await loadLocalFile(mdOutFile);
  switchView('cutter');
});

$('mdGoSettings').addEventListener('click', () => switchView('settings'));

// ---- Faz 16-B: B-Roll ekranı ----
// Transkriptten Gemini ile "görsel an" tespiti → Pexels stok önerileri
// (thumbnail'lı onay listesi) → seçilenler indirilip tam kare kısa kesit
// olarak gömülür. Akıllı Kırpma ile aynı bağımsız desen: kendi ilerleme
// kanalı ve iptali, ana kuyruğa dokunmaz.

let brFile = null;
let brFileId = null;
let brItems = []; // {id, time, keyword, query, thumb, videoUrl, included}
let brRunning = false;
let brModelValue = 'small';
let brActivePhase = null; // 'analyze' | 'apply' | null

function brShowError(msg) {
  const el = $('brError');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function brClearError() { $('brError').classList.add('hidden'); }

function brResetResults() {
  brItems = [];
  $('brResults').classList.add('hidden');
  $('brList').innerHTML = '';
  $('brApplyBtn').classList.add('hidden');
  $('brResultCard').classList.add('hidden');
  $('brOpenFolderBtn').classList.add('hidden');
}

async function brSetFile(p) {
  if (brRunning) return;
  brClearError();
  brResetResults();
  const info = await window.api.localInfo(p);
  if (info.error) { brShowError(info.error); return; }
  brFile = p;
  brFileId = info.id;
  $('brFileName').textContent = p.split(/[\\/]/).pop();
  const parts = [fmtBytes(info.size), fmtClock(info.duration)];
  if (info.w && info.h) parts.push(`${info.w}×${info.h}`);
  $('brFileMeta').textContent = parts.join(' · ');
  $('brDrop').classList.add('hidden');
  $('brFileCard').classList.remove('hidden');
  $('brAnalyzeBtn').disabled = false;
}

function brResetFile() {
  if (brRunning) return;
  brFile = null;
  brFileId = null;
  $('brFileCard').classList.add('hidden');
  $('brDrop').classList.remove('hidden');
  $('brAnalyzeBtn').disabled = true;
  brClearError();
  brResetResults();
}

$('brChooseBtn').addEventListener('click', async () => {
  const p = await window.api.chooseVideo();
  if (!p) return;
  if (/\.trimtube$/i.test(p)) { openProjectFile(p); return; }
  brSetFile(p);
});
$('brFileChange').addEventListener('click', brResetFile);

document.querySelectorAll('#brModelSeg .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    if (brRunning) return;
    brModelValue = btn.dataset.brModel;
    document.querySelectorAll('#brModelSeg .seg').forEach(b => b.classList.toggle('active', b === btn));
  });
});

function brRenderList() {
  const list = $('brList');
  list.innerHTML = '';
  brItems.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'pl-item';
    row.innerHTML = '<input type="checkbox"><img class="br-thumb" alt=""><span class="pl-item-title"></span><span class="pl-item-dur"></span>';
    row.querySelector('input').checked = it.included;
    row.querySelector('input').addEventListener('change', (ev) => {
      it.included = ev.target.checked;
      brUpdateSummary();
    });
    row.querySelector('.br-thumb').src = it.thumb || '';
    row.querySelector('.pl-item-title').textContent = `${it.keyword} · "${it.query}"`;
    row.querySelector('.pl-item-dur').textContent = fmtClock(it.time) + ' anında';
    list.appendChild(row);
  });
  brUpdateSummary();
  $('brResults').classList.remove('hidden');
}

function brUpdateSummary() {
  const n = brItems.filter(i => i.included).length;
  $('brSummary').textContent = brItems.length
    ? `${n}/${brItems.length} öneri seçili · her biri ~2.5 sn tam kare gömülür`
    : 'Öneri bulunamadı.';
  $('brApplyBtn').classList.toggle('hidden', n === 0);
}

window.api.onBrollProgress((p) => {
  const label = p.stage === 'audio' ? 'Ses çıkarılıyor…'
    : p.stage === 'model' ? 'Model hazırlanıyor…'
    : p.stage === 'transcribe' ? 'Konuşma çözümleniyor…'
    : p.stage === 'gemini' ? 'Görsel anlar seçiliyor…'
    : p.stage === 'search' ? 'Pexels\'ta aranıyor…'
    : p.stage === 'download' ? 'Klipler indiriliyor…'
    : p.stage === 'render' ? 'Gömülüyor…'
    : 'İşleniyor…';
  $('brPhaseLabel').textContent = label;
  const pct = p.pct || 0;
  $('brProgressFill').style.width = pct + '%';
  $('brProgressText').textContent = '%' + pct.toFixed(1) + (p.eta ? ` · kalan ${p.eta}` : '');
});

function brSetRunning(running, phase) {
  brRunning = running;
  brActivePhase = running ? phase : null;
  const aBtn = $('brAnalyzeBtn');
  aBtn.textContent = (running && phase === 'analyze') ? 'Durdur' : 'Önerileri getir';
  aBtn.disabled = running ? phase !== 'analyze' : !brFile;
  const pBtn = $('brApplyBtn');
  pBtn.textContent = (running && phase === 'apply') ? 'Durdur' : 'B-Roll\'u Göm';
  pBtn.disabled = running && phase !== 'apply';
  $('brFileChange').disabled = running;
  $('brProgress').classList.toggle('hidden', !running);
}

$('brAnalyzeBtn').addEventListener('click', async () => {
  if (brRunning && brActivePhase === 'analyze') { window.api.brollCancel(); return; }
  if (brRunning || !brFile) return;
  brClearError();
  brResetResults();
  $('brProgressFill').style.width = '0%';
  $('brProgressText').textContent = '%0';
  brSetRunning(true, 'analyze');

  let r;
  try {
    r = await window.api.brollAnalyze({ file: brFile, videoId: brFileId, model: brModelValue });
  } catch (err) {
    r = { error: 'Beklenmeyen hata: ' + (err.message || String(err)) };
  }

  brSetRunning(false);
  if (r.cancelled) return;
  if (r.error) { brShowError(r.error); return; }

  brItems = r.items.map(i => ({ ...i, included: true }));
  brRenderList();
});

const BR_OK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

$('brApplyBtn').addEventListener('click', async () => {
  if (brRunning && brActivePhase === 'apply') { window.api.brollCancel(); return; }
  if (brRunning) return;
  const picks = brItems.filter(i => i.included).map(i => ({ time: i.time, videoUrl: i.videoUrl }));
  if (!picks.length || !brFile) return;
  brClearError();
  $('brProgressFill').style.width = '0%';
  $('brProgressText').textContent = '%0';
  $('brResultCard').classList.add('hidden');
  $('brOpenFolderBtn').classList.add('hidden');
  brSetRunning(true, 'apply');

  let r;
  try {
    r = await window.api.brollRender({ file: brFile, items: picks });
  } catch (err) {
    r = { error: 'Beklenmeyen hata: ' + (err.message || String(err)) };
  }

  brSetRunning(false);
  if (r.cancelled) return;
  if (r.error) { brShowError(r.error); return; }

  $('brResultIcon').innerHTML = BR_OK_SVG;
  $('brResultTitle').textContent = `Gömüldü — ${r.outFile.split(/[\\/]/).pop()}`;
  $('brResultSub').textContent = `${r.count} b-roll kesiti eklendi`;
  $('brResultCard').classList.remove('hidden');
  const outDir = r.outFile.slice(0, r.outFile.length - r.outFile.split(/[\\/]/).pop().length - 1);
  $('brOpenFolderBtn').onclick = () => window.api.openFolder(outDir);
  $('brOpenFolderBtn').classList.remove('hidden');
});

initSettings();
