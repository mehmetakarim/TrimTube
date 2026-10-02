# v1.19.0 — Kurgu Masası ve Gerçek Çıktı Provası

TrimTube artık tek videodan seçtiğiniz parçaları bölüp, kısaltıp, sürükleyerek sıralayabileceğiniz bir kurgu masası sunuyor. Düzenlemeleri geri alabilir, projeyi otomatik taslaktan kurtarabilir ve dışa aktarmadan önce gerçek işlenmiş çıktıyı kontrol edebilirsiniz.

## Yeni özellikler

- Kaynak seçimi ve Kurgu görünümleri; bölme, kenardan/sayısal trim, sürükle-bırak sıralama, çoğaltma ve silme.
- Video ile birlikte taşınan ses şeridi, kurgu cetveli, yakınlaştırma ve ardışık önizleme.
- Geri al/ileri al, otomatik yerel taslak ve açılışta kurtarma; proje dosyasında kurgu kararları.
- Altyazıyı dışa aktarmadan önce oluşturma, metni düzenleme ve açık onay akışı. Satır bölme/birleştirme ve toplu bul-değiştir.
- Whisper kelime zamanlarını koruma; değiştirilmiş metindeki tahmini kelimeleri gösterme.
- Kadraj ve altyazı kontrol masası; belirli zaman aralığına kadraj düzeltmesi, platform güvenli alan rehberleri ve altyazı yerleşimi.
- Başlangıç ve format seçilerek en fazla 5 saniyelik gerçek çıktı provası: altyazı, logo, başlık ve onaylı kadraj aynı dışa aktarma motoruyla işlenir.
- Yenilenen çalışma ekranları ve API ayarları; Gemini için ayrı metin/TTS model zincirleri, model keşfi, bağlantı testleri ve deneme geçmişi.

## Düzeltmeler

- Animasyonlu altyazı geçişlerinde üst üste binme ve stil önizlemesi.
- Altyazı yazarken boşluk/klavye kısayollarının video kontrolüyle çakışması.
- Kişi takibinde geç giriş, sahne geçişleri, kaybolan kutular ve dar portre sınırları.
- Kesim yapılmayan yerel videonun gerçek MP3'e dönüştürülmesi.
- Başarısız dışa aktarmaların kuyrukta korunması ve yeniden denenmesi.
- Genel ayarlarda atomik kayıt ve yazma hatalarının bildirilmesi.
- Önceki sürümün yt-dlp açılış/donma ve güncelleme düzeltmeleri korunmuştur.

## Kullanım notları

- İlk kurgu sürümü tek kaynaktan en fazla 100 parçayı düzenler. Çoklu video kaynakları, bağımsız müzik kanalları ve geçiş efektleri henüz dahil değildir.
- Whisper altyazısı Python 3 ve `faster-whisper` gerektirir. Kişi takip motoru kurulum paketine dahildir.
- Düzenlenen kelimelerde eşleşme yoksa zamanlama tahminidir; bu sürüm yeni metni sese yeniden hizalayan bir model içermez.
- Beş saniye provanın video süresidir; kaynak indirme ve kurgu hazırlığı ek süre/disk alanı gerektirebilir.
- API anahtarları bu sürümde yerel ayar dosyasında saklanır. İşletim sistemi destekli güvenli saklama henüz eklenmemiştir.
- Güvenli alan maskeleri yaklaşık rehberdir. macOS paketi imzasızdır; mevcut kurulum yönergeleri README'dedir.

## Doğrulama

103 Electron arayüz kontrolü, 34 gerçek medya/IPC kontrolü, 17 altyazı/kadraj, 8 kurgu ve 17 sağlayıcı regresyon kontrolü. Yeniden sıralanan görüntü/ses, prova ile tam çıktı karşılaştırması, iptal, taslak kurtarma ve yeniden deneme test edildi. Yeni Whisper modeli indirilmeden kelime aktarımı yerel önbellek örneğiyle doğrulandı.
