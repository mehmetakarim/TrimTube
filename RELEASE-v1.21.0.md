# v1.21.0 — Anlatımlı Video

## Yenilikler
- **Anlatımlı Video** (yeni ekran): metin veya bir sayfa bağlantısından duygu etiketli Türkçe senaryo yazılır, seslendirilir ve videoya dönüştürülür.
  - Biçim: Reels/Shorts (9:16, 45-60 sn) veya Podcast (16:9; kısa/orta/uzun, isteğe bağlı ses dalgası ya da audiogram).
  - Seslendirmeden önce onay: senaryo, ton/anlık ses etiketleri ve sahne görselleri düzenlenir; tanınmayan veya seçili sesin desteklemediği etiketler uyarılır. Taslak cihazda saklanır.
  - Seslendirme: Gemini TTS (yeni biçim: ton `style`, anlık sesler `<laugh>`) veya ElevenLabs (Eleven v4, yoksa v3). Tek etiket dili, sağlayıcıya göre çevrilir.
  - Konuşmayla senkron hareket: kelime zamanları yerel Whisper ile ölçülür; başlık kelimeleri, sayılar (sayaçla), liste maddeleri ve alıntılar söylendikleri anda vurgulanır. Sürekli kamera ve zemin hareketi, flaşlı geçişler. İsteğe bağlı kinetik altyazı.
  - Gerçek görseller: bağlantıdaki sayfa görselleri otomatik toplanır ve Gemini sahnelere eşler; her sahneye galeriden, dosyadan veya sürükle-bırakla görsel/video eklenebilir. Şeffaf ürün kesimi, düz zeminli ürün çekimi ve fotoğraf ayrı ayrı sunulur. İsteğe bağlı Pexels stok görselleri.
  - Video HyperFrames ile sahne sahne üretilir; düzenlemeden sonra yalnız değişen sahneler yeniden seslendirilir/üretilir.
  - Kurgu masasına aktarım: sahneler kurgu parçası, altyazı onay bekleyen ayrı katman olarak gelir.
- **Yayın ve marka profilleri:** kalite, oranlar, logo, altyazı stili/kenar boşlukları ve başlık süresi adlandırılmış profil olarak kaydedilir ve geri alınabilir şekilde uygulanır.
- **Yayın paketi:** her video için kapak (JPEG), onaylı SRT, yayın başlığı/açıklaması ve paket.json; Orijinal/9:16/1:1 için ayrı altyazı yerleşimi.
- **Güvenli anahtar saklama:** Gemini, ElevenLabs ve Pexels anahtarları işletim sistemi kasasıyla şifrelenir; eski kayıtlar ilk açılışta taşınır.

## Kullanım
Sol menü → Anlatımlı Video. Metni yapıştırın veya bağlantı verin; biçim, ses ve tasarımı seçip “Metni hazırla”ya basın. Senaryoyu ve sahne görsellerini kontrol edin, “Onayla ve videoyu üret”. Hazır olunca “Kurgu masasına taşı”.

## Sınırlar
- İlk render'da video motorunun tarayıcı bileşeni bir kez indirilir (~270 MB, internet gerekir); yazı tipi ilk seferde önbelleğe alınır.
- Kelime zamanları için Python ve faster-whisper gerekir (otomatik altyazıyla aynı); yoksa zamanlar tahmin edilir.
- Serbest üretim (Gemini'ın yazdığı tasarım) deneyseldir; şablon kütüphanesi önerilir.
- Arka plan kaldırma, geçiş sesleri ve müzik bu sürümde yok. Sayfa görsellerinin kullanım hakkı kullanıcının sorumluluğundadır.
- Kurulum boyutu video motoru ve ffprobe nedeniyle büyüdü.

## Doğrulama
134 Electron arayüz, 18 anlatımlı video birim kontrolü ve gerçek HyperFrames uçtan uca render testi (sahne önbelleği dahil) geçti; render testi paketlenmiş Windows uygulamasının içinden de çalıştırıldı. Gemini 3.8 TTS ve Whisper hizalaması gerçek seslendirmeyle sahada denendi. macOS/Linux paketlerinde render ve ElevenLabs v4 sahada denenmedi.
