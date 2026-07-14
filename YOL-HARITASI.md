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

### Faz 10 — İleri Takip (araştırma) · `v1.10.0`
- [x] **Konuşmacı değişimli çoklu kişi takibi** — sahnedeki yüzler arasından o an konuşanı (ses enerjisi + ağız hareketi + histerezis) otomatik seçip kadrajı ona kaydırma; takip kartında "Aktif konuşan" modu

---

## 🔲 Kalanlar

### Uzun vadeli (araştırma / büyük iş)
- [ ] **Gömülü Python veya WASM takip** — kişi takibini kurulumsuz hale getirme (Python bağımlılığını kaldırma)

### Bilinçli olarak kapsam dışı
- [ ] ~~Diğer platform kaynakları (X, Instagram vb.)~~ — teknik olarak kolay ama ayrı bir ürün yönü; şimdilik YouTube odağı korunuyor
- [ ] ~~Sosyal medyaya doğrudan paylaşım/yükleme~~ — OAuth/API/platform kuralları; bu projenin kapsamı dışında

---

*Son güncelleme: Faz 10 (v1.10.0) — konuşmacı-değişimli takip. Geriye yalnızca "kurulumsuz takip (Python'ı kaldır)" araştırma kalemi kaldı.*
