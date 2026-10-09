# v1.25.0 — Yerel Türkçe Seslendirme (EMA Lightning)

## Yenilikler
- **Yerel seslendirme (EMA Lightning):** Anlatımlı Video'da Gemini ve ElevenLabs'in yanında üçüncü seçenek "Yerel (EMA)". Türkçe ses bilgisayarında üretilir: ücretsiz, anahtarsız, internetsiz. Uygulamayla birlikte gelir; ayrıca Python veya başka bir kurulum gerekmez.
  - Ses listesi yerine konuşma hızı seçilir (sakin / normal / hızlı).
  - Sayılar, tarihler, para ve ölçü birimleri Türkçe okunuşuyla seslendirilir ("600 mm/s" → "altı yüz milimetre bölü saniye", "K2'yi" → "ke ikiyi").
  - Kelime zamanlarını model kendisi verir; sahne animasyonları ve altyazı konuşmayla senkron kalır (Whisper adımı gerekmez).
  - Bu seçenekte senaryo duygu etiketsiz yazılır; duygu kelime seçimi ve noktalamayla verilir.
- **Tasarım tarifinden tema daha isabetli:** tarifte yazılı marka renkleri (hex) her zaman korunur, örnek görsel rengi kaydırmaz; geçiş ve hareket tarza göre seçilir; içerik türü gibi değişken alanlar temaya yazılmaz.
- **Açık temalarda daha temiz zemin:** koyu vurgu renkleri arka planda gri leke oluşturmaz.

## Kullanım
Anlatımlı Video → Seslendirme → "Yerel (EMA)" → hız seç → Metni hazırla.

## Sınırlar
- Tek Türkçe ses; duygu etiketleri ([excited], [laughs] vb.) okunmaz.
- İlk seslendirmede model yüklenirken kısa bir bekleme olur; sonrası gerçek zamandan çok daha hızlıdır.
- Kurulum boyutu yaklaşık 64 MB artar (çalışma zamanı + model).

## Lisans
EMA Lightning ve normalizer-tr Apache-2.0, ONNX Runtime MIT lisanslıdır. Model dosyaları değiştirilmeden ONNX biçimine çevrilmiştir; kaynak ve yeniden üretim adımları depodaki `tools/ema/` klasöründedir.

## Doğrulama
153 Electron arayüz, 43 gerçek medya/IPC ve 25 anlatımlı video kontrolü geçti. EMA çıktısı PyTorch referansıyla karşılaştırıldı (metin normalleştirme ve kelime zamanları birebir); üretilen ses Whisper ile yazıya dökülerek anlaşılırlığı doğrulandı; paketlenmiş Windows uygulamasından ses üretildi.
