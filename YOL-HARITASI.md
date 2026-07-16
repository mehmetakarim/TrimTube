# TrimTube — Yol Haritası & Yapılacaklar

Bu dosya, TrimTube'un özellik yol haritasını ve uygulanma durumunu takip eder.

**Durum:** Ana plan (Faz 1–10) tamamlandı (v1.1.0 → v1.11.0). İkinci plan dönemi (Faz 11–16 + kulvarlar), kullanıcının 16 maddelik özellik notları ile saha/kod analizi birleştirilerek 15 Temmuz 2026'da oluşturuldu.

---

## ✅ Tamamlananlar

### Faz 1 — Kesim Deneyimi · `v1.1.0`
- [x] Yakınlaştırılabilir ince ayar şeridi (seçili aralığın etrafına odaklanır)
- [x] Ses dalga formu gösterimi (diyalog/sessizlik sınırını gözle seçme)
- [x] Klavye kısayolları (`Boşluk`/`K`, `I`/`O`, `J`/`L`, `←`/`→`)
- [x] Tahmini kalan süre (ETA) göstergesi
- [x] Sadeleştirilmiş oynatıcı + canlı oynatma kafası (playhead)

### Faz 2 — Performans · `v1.2.0`
- [x] GPU hızlandırmalı kodlama + çözme (NVENC/QuickSync/AMF/VideoToolbox, ~2.5x)

### Faz 3 — Altyazı · `v1.3.0`
- [x] YouTube altyazısını indirip **stilli** gömme (3 stil: Klasik / Kutulu / Dolgun)

### Faz 4 — Çoklu Üretim · `v1.4.0`
- [x] Tek kesimden çoklu format (Orijinal + 9:16 + 1:1 aynı anda)
- [x] Klip kuyruğu (aynı videodan indirmesiz ardışık klipler)
- [x] Bölüm (chapter) algılama ve hazır kesim önerileri

### Faz 5 — Cila · `v1.5.0`
- [x] Ayarlar ekranı (varsayılan kalite/format/klasör hatırlanır)
- [x] Önbellek yönetimi (boyut görüntüleme, temizleme, limit ayarı)
- [x] Karanlık mod (sistem tercihi / açık / koyu)

### Faz 6 — Marka & Netlik · `v1.6.0`
- [x] Logo / watermark bindirme (4 köşe, oransal boyut, çoklu formata uygulanır)
- [x] Başlık metni (ilk 3 sn üst-orta, libass ile Türkçe+tipografik glifler)
- [x] Daha net Türkçe hata mesajları (yaş/gizli/bölge/bağlantı vb.)
  - _Not: ufak arayüz rötuşları sonraya bırakıldı (kullanıcı geri bildirimi)._

### Faz 7 — Otomatik Altyazı · `v1.7.0`
- [x] Whisper ile otomatik altyazı (`subtitle.py`, faster-whisper) — hazır altyazı yoksa kesitin sesi metne çevrilip mevcut stilli-gömme yoluna beslenir; model boyutu Hızlı/Dengeli/En iyi seçilebilir

### Faz 8 — Kaynak & Önizleme · `v1.8.0` (+ v1.8.1/v1.8.2 cila)
- [x] **Yerel dosya sürükle-bırak** — YouTube dışı videolarla da çalışma; dosya sürükle-bırak veya seçici ile alınıp aynı boru hattından (kesme/format/takip/altyazı/marka) geçer, yalnızca indirme atlanır
- [x] **Render öncesi kırpma yolu önizlemesi** — kişi takibinin 9:16 kadraj penceresini ayrı bir modal pencerede gösterme; takip edilen kişi renkli maskeyle vurgulanır, canlı 9:16 çıktı + ses (v1.8.1/v1.8.2)

### Faz 9 — Toplu İşleme · `v1.9.0`
- [x] **Playlist / çoklu URL toplu indirme** — oynatma listesi bağlantısını açıp videoları seçerek kuyruğa alma (modal seçici)
- [x] **Arka planda kuyruk** — render sürerken yeni video hazırlayıp kuyruğa ekleyebilme; canlı kuyruktan işleme, hata olan işi atlayıp devam, "Durdur" ile mevcut işi kesme

### Faz 10 — İleri Takip (araştırma) · `v1.10.0` / `v1.11.0`
- [x] **Konuşmacı değişimli çoklu kişi takibi** (`v1.10.0`) — sahnedeki yüzler arasından o an konuşanı (ses enerjisi + ağız hareketi + histerezis) otomatik seçip kadrajı ona kaydırma; takip kartında "Aktif konuşan" modu
- [x] **Kurulumsuz takip** (`v1.11.0`) — `tracker.py` PyInstaller ile platforma özel tek dosyaya dondurulup pakete gömüldü; son kullanıcı Python kurmadan kişi takibini kullanır (takip kalitesi birebir korunur)

---

## 📋 İkinci Plan Dönemi (Faz 11–16)

Sıralama mantığı: önce sahadaki somut sorun (çıktı boyutu), sonra hızlı kazanımlar, ardından iki temel yapı taşı — **kurgu/montaj motoru** (Faz 13 → 15/16'nın ön koşulu) ve **AI altyapısı** (Faz 14 → 15'in ön koşulu) — en sonda zirve özellik (Moodlar) ve ileri kurgu.

### Faz 11 — Sıkıştırma (Compress) · `v1.12.0` ✅ (tamamlandı, saha testinden geçti — yayın Faz 12 ile birlikte)
Saha geri bildirimi: 3 dk'lık klip ~350MB çıkabiliyor (donanım kodlayıcı bitrate tavanı olmadan ~16 Mbps üretiyor); sosyal medya paylaşımında sorun. Mevcut render kalitesine DOKUNULMADI — ayrı, isteğe bağlı sıkıştırma aracı eklendi.
- [x] "Sıkıştır" ekranı: dosya seç / sürükle-bırak, dosya bilgisi kartı (ad/boyut/süre/çözünürlük), ilerleme + ETA, önce/sonra boyut raporu
- [x] Görsel kayıpsız mod (libx264 slow CRF 18, ses kayıpsız kopya) — tipik %50–70 küçülme, gözle fark edilmez
- [x] Hedef boyut (MB) modu (two-pass kodlama; testte 5MB hedef → 5.02MB)
- [x] HEVC (H.265) seçeneği — ek ~%30–50 küçülme (modern cihaz uyumu notuyla)
- [x] Render sonrası "tamamlandı" toast'ına "Sıkıştır" kısayolu
- [x] Sol navigasyon menüsü (hamburger) + ekran mimarisi — her özellik kendi ekranında; Sıkıştır ve Ayarlar kendi ekranına taşındı, üst çubuk sadeleşti. Gelecek fazların (GIF, Moodlar…) iskeleti.

### Faz 12 — Hızlı Kazanımlar · `v1.12.0` ✅ (tamamlandı, saha testinden geçti)
- [x] GIF dışa aktarma: format seçicide 4. seçenek — tek geçiş palettegen/paletteuse (12 fps, 480px); 30 sn üstü kesitte boyut uyarısı
- [x] Safe Zone maskesi: kadraj önizleme modalında Kapalı/TikTok/Shorts/Reels seçici; platform arayüz bölgeleri 9:16 çıktının üstünde yarı saydam şablon
- [x] `.trimtube` proje dosyası: kaynak + kesim + kuyruk + stil + marka kaydet/aç; açarken "Tümünü geri yükle" veya "Yalnız ayarları uygula" (şablon)
- [x] Zaman çizelgesine kare önizlemeli şerit: ana kaydırıcının üstünde 12 karelik bant (hızlı sarma ile — uzak akışta da saniyeler içinde)
- _Not: MP3 kesit ve waveform/timeline (Faz 1) zaten yayında._

### Faz 13 — Kurgu Motoru · `v1.13.0` ✅ (tamamlandı, saha testinden geçti)
- [x] Akıllı sessizlik ayıklama: Whisper kelime zaman damgalarından sessizlik tespiti (hassasiyet: Sıkı 0.4 / Dengeli 0.7 / Gevşek 1.2 sn), onay kutulu aday listesi, trim/atrim/concat ile tek geçişte kırpma
- [x] Dolgu kelimesi ayıklama: yalnız temiz dolgu sesleri ("ıı", "eee", "hmm"…) — "yani/şey/işte" yanlış-pozitif riski nedeniyle bilinçli hariç (kullanıcı kararı)
- [x] "Akıllı Kırpma" ekranı sol menüde; bağımsız akış (dosya seç → Tespit et → gözden geçir → Kırp ve Kaydet), kendi ilerleme/iptal kanalı
- _Bu fazın concat/montaj zinciri, Faz 15 ve 16'nın altyapısını kurdu._

### Faz 14 — AI Altyapısı ve İlk Meyveler · `v1.14.0` ✅ (tamamlandı, saha testinden geçti, yayınlandı)
- [x] Ayarlara API anahtarları: Gemini + ElevenLabs (kullanıcının kendi anahtarı — sunucu maliyeti yok; yalnız yerelde saklanır, "Doğrula" düğmesi var)
- [x] Başlık/açıklama/hashtag üretici: transkript → Gemini → 3 Shorts başlığı + caption + hashtag'ler, panoya kopyala
- [x] Semantik arama ile kırpma: "X'ten bahsettiği yerleri bul" → sonuç tek tıkla kesim aralığına uygulanır
- [x] AI Hook Finder: viral potansiyelli anları skorlayıp öne çıkarma (transkript + ses enerjisi analizi)
- [x] "Reklam dostu içerik" uyarısı: transkriptten küfür/hassas kelime taraması
  - _Not: Content ID (telif) simülasyonu teknik olarak yapılamaz — YouTube'un parmak izi veritabanına dış erişim yok; fikir bu şekilde daraltıldı._
- _Hepsi yeni "AI Araçları" ekranında (sol menü), ortak bir transkript adımı üzerinde: YouTube altyazısı varsa saniyeler, yoksa Whisper._

### Faz 15 — Moodlar & AI Director *(zirve özellik)* · `v1.15.0` (kod tamam — saha testi bekliyor)
- [x] Moodlar sekmesi: bölüm yükle → mood seç (Komedi/Dram/Gerilim/Duygusal/Özet) + hedef süre (30/60/90 sn) → Whisper ile zaman damgalı diyalog haritası → Gemini'den anlatıcılı hikaye kurgusu (JSON: sahne aralıkları + anlatıcı metinleri; plan ekranda önizlenir)
- [x] TTS seslendirme (ElevenLabs `eleven_multilingual_v2`) → dış ses üretimi; ses seçici API'deki seslerden, tercih hatırlanır
- [x] Montaj robotu: kesitler concat + anlatım çalarken audio ducking (`volume enable`) + `adelay`+`amix` bindirme; GPU→CPU düşüşlü
  - _Not: "Faz 9 kuyruğunda" yerine Sıkıştır/Akıllı Kırpma'daki bağımsız-ekran deseni seçildi (kendi kanalı/iptali; kuyrukla eşzamanlı çalışabilir) — kuyruğa taşımak gereksiz bağımlılık yaratıyordu._
- _Tuzaklar: uzun bölüm dökümü için Gemini'nin geniş context'i tercih nedeni; prompt'ta "yalnızca güçlü diyaloglu sahneler" kısıtı; maliyet kullanıcının kendi anahtarında._

### Faz 16 — İleri Kurgu
- [ ] Kelime bazlı animasyonlu altyazı: Shorts tarzı anlık büyüme/renk vurgusu (ASS karaoke)
- [ ] Ses efekti tetikleyicileri: vurgu/sahne geçişinde swoosh/pop gömme
- [ ] Otomatik J-Cut / L-Cut (araştırma — kurgu motorunun üstüne)
- [ ] B-Roll köprüsü: transkript anahtar kelimelerine Pexels/Pixabay API ile overlay önerisi (kullanıcı onaylı)
- [ ] Yüz imzası (face-embedding) ile takip sağlamlaştırma — gürültülü ortamlar için; ihtiyaç doğarsa

### 🔧 Paralel Bakım Kulvarı *(faz sırasından bağımsız, araya alınabilir)*
- [ ] yt-dlp kendini güncelleme: gömülü ikili userData'ya kopyalanır, `--update-to stable` ile güncel tutulur — YouTube kırılmalarına karşı kritik koruma (Apple geliştirici hesabı GEREKTİRMEZ)
- [ ] Kurulum boyutu küçültme (233–270MB)
- [ ] macOS notarization — **beklemede: Apple Developer ID hesabı ($99/yıl) alınırsa** ("hasar görmüş" uyarısı + macOS oto-güncelleme bunun eksikliğinden)

### 🧩 Ayrı Kulvar — Tarayıcı Eklentisi
- [ ] `extension/` klasöründe Chrome eklentisi: YouTube izleme sayfasında "TrimTube ile Kes" butonu
- [ ] Uygulamaya `trimtube://` protokol (deep-link) desteği
- [ ] Test: geliştirici modunda yükleme; mağaza dağıtımı ayrıca konuşulacak

### Bilinçli olarak kapsam dışı
- [ ] ~~Diğer platform kaynakları (X, Instagram vb.)~~ — teknik olarak kolay ama ayrı bir ürün yönü; şimdilik YouTube odağı korunuyor
- [ ] ~~Sosyal medyaya doğrudan paylaşım/yükleme~~ — OAuth/API/platform kuralları; bu projenin kapsamı dışında
- [ ] ~~Content ID / telif simülasyonu~~ — teknik olarak mümkün değil; "reklam dostu içerik" uyarısına daraltıldı (Faz 14)

---

*Son güncelleme: Faz 15 (Moodlar & AI Director) kodu tamamlandı — gerçek anahtarlarla saha testi ve v1.15.0 yayın kararı bekliyor. Sıradaki: Faz 16 (İleri Kurgu).*
