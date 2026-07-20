// TrimTube tarayıcı eklentisi — YouTube izleme sayfasına "TrimTube ile Kes"
// butonu ekler. Tıklanınca trimtube://open?v=<id>&t=<saniye> açılır; uygulama
// videoyu yükler ve izlenen anı kesim başlangıcı yapar.
//
// Tasarım notları:
//  * YouTube DOM'u sık değişir → butonun yerleştirileceği kap için SIRALI YEDEK
//    seçiciler denenir; hiçbiri yoksa sessizce vazgeçilir (sayfa asla bozulmaz).
//  * YouTube bir SPA'dır: videolar arası geçişte sayfa yeniden yüklenmez →
//    yt-navigate-finish olayı + MutationObserver ile buton yeniden eklenir.
//  * Çift ekleme koruması: sabit bir id ile varlık kontrolü yapılır.

const BTN_ID = 'trimtube-cut-btn';

// Butonun yerleştirileceği kap için öncelik sırası (ilk bulunan kullanılır)
const CONTAINER_SELECTORS = [
  '#top-level-buttons-computed',              // güncel YouTube eylem çubuğu
  'ytd-menu-renderer #top-level-buttons',     // eski sürüm
  '#actions #menu ytd-menu-renderer',         // alternatif yerleşim
  '#actions-inner #menu'                      // yedek
];

function findContainer() {
  for (const sel of CONTAINER_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// Geçerli sayfadaki video kimliği (yalnız izleme sayfalarında)
function currentVideoId() {
  try {
    const v = new URLSearchParams(location.search).get('v');
    return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

// Oynatıcının o anki konumu (saniye) — kesim başlangıcı olarak gönderilir
function currentTimeSec() {
  const video = document.querySelector('video.html5-main-video, video');
  const t = video && Number.isFinite(video.currentTime) ? Math.floor(video.currentTime) : 0;
  return Math.max(0, t);
}

function openInTrimTube() {
  const id = currentVideoId();
  if (!id) return;
  const t = currentTimeSec();
  // Protokol açma: kullanıcı jestiyle tetiklendiği için tarayıcı izin verir.
  // Uygulama kurulu değilse tarayıcı sessizce yok sayar (sayfa etkilenmez).
  location.href = `trimtube://open?v=${encodeURIComponent(id)}&t=${t}`;
}

function makeButton() {
  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.className = 'trimtube-btn';
  btn.type = 'button';
  btn.title = 'Bu videoyu TrimTube\'da aç — izlediğin an kesim başlangıcı olur';
  btn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>' +
    '<path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/></svg>' +
    '<span>TrimTube ile Kes</span>';
  btn.addEventListener('click', openInTrimTube);
  return btn;
}

function injectButton() {
  // Yalnız izleme sayfasında ve tek kopya
  if (!currentVideoId()) return;
  if (document.getElementById(BTN_ID)) return;
  const container = findContainer();
  if (!container) return;   // DOM henüz hazır değil / yapı değişmiş → sessizce geç
  container.prepend(makeButton());
}

// SPA gezinmesi: YouTube kendi olayını yayar
document.addEventListener('yt-navigate-finish', () => setTimeout(injectButton, 300));

// Eylem çubuğu geç yüklenirse / yeniden çizilirse butonu geri koy
const observer = new MutationObserver(() => {
  if (currentVideoId() && !document.getElementById(BTN_ID)) injectButton();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

injectButton();
