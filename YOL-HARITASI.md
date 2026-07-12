# TrimTube — Yol Haritası & Yapılacaklar

Bu dosya, [TrimTube Özellik Yol Haritası](https://claude.ai/code/artifact/2fd1bca8-5533-43ec-a1c1-bb1db32d230b) dokümanındaki fikirlerin uygulanma durumunu takip eder.

**Durum:** 5 fazlık ana plan tamamlandı (v1.1.0 → v1.5.0). Aşağıdaki "Kalanlar" bölümü, henüz yapılmamış fikirleri önceliğe göre listeler.

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

---

## 🔲 Kalanlar

### Kısa vadeli (düşük–orta çaba, net fayda)
- [ ] **Logo / watermark bindirme** — kanal logosunu köşeye sabitleme (ffmpeg `overlay`, düşük çaba)
- [ ] **Daha net hata mesajları** — yaş/bölge kısıtı, kaldırılmış video gibi durumları anlaşılır Türkçe karşılıklara çevirme
- [ ] **Başlık / metin kartı** — klip başına 1–2 sn'lik başlık kartı (ffmpeg `drawtext`, Türkçe font dikkat ister)

### Orta vadeli
- [ ] **Whisper ile otomatik altyazı** — altyazısı olmayan videolar için ses→metin (faster-whisper, `subtitle.py`)
- [ ] **Render öncesi kırpma yolu önizlemesi** — kişi takibinin kadraj yolunu render'dan önce önizlemede gösterme
- [ ] **Playlist / çoklu URL toplu indirme** — bir playlist bağlantısını açıp tüm videoları kuyruğa alma
- [ ] **Arka planda kuyruk** — render sürerken yeni video hazırlayabilme (arayüz kilitlenmesin)

### Uzun vadeli (araştırma / büyük iş)
- [ ] **Gömülü Python veya WASM takip** — kişi takibini kurulumsuz hale getirme (Python bağımlılığını kaldırma)
- [ ] **Konuşmacı değişimli çoklu kişi takibi** — sahnede aktif konuşana kadrajı kaydırma (ses + dudak hareketi)
- [ ] **Yerel dosya sürükle-bırak** — YouTube dışı videolarla da çalışma (kapsam genişletir)

### Bilinçli olarak kapsam dışı
- [ ] ~~Diğer platform kaynakları (X, Instagram vb.)~~ — teknik olarak kolay ama ayrı bir ürün yönü; şimdilik YouTube odağı korunuyor
- [ ] ~~Sosyal medyaya doğrudan paylaşım/yükleme~~ — OAuth/API/platform kuralları; bu projenin kapsamı dışında

---

*Son güncelleme: v1.5.0 — 5 fazın tamamı yayında.*
