# TrimTube — ürün ve optimizasyon incelemesi

Tarih: 1 Ekim 2026. Kapsam: mevcut kaynak kod, geliştirme planı, test betikleri ve yayın iş akışı. Bu çalışma uygulama kodunu değiştirmez; yeni performans ölçümü, kullanıcı araştırması veya uçtan uca saha testi değildir. Öncelikler ürün değerlendirmesidir; maliyetler göreli geliştirme kapsamını belirtir.

## Ürün yönü

TrimTube için önerilen odak: **uzun videodan, kullanıcının kontrol ettiği ve farklı mecralara hazırladığı kısa içerikler üretmek.** Mevcut araç sayısı yeterince güçlü. Asıl kazanç; metin, kadraj, ses, destek görüntüsü ve yayın çıktısını aynı proje üzerinden yönetmekte.

GPU kodlama, video önbelleği, çoklu oran çıktısı, konuşmacı takibi, altyazı düzenleme/onay, güvenli alan önizlemesi, sessizlik ayıklama, AI kesit önerileri, hikâye kurgusu ve B-roll zaten var. Bunları yeni özellik olarak tekrar geliştirmek yerine birbirleriyle ilişkilerini güçlendirmek gerekiyor.

## Kodda görülen somut geliştirme alanları

| Bulgu | Kullanıcıya etkisi | Kod dayanağı |
|---|---|---|
| Kuyruk renderer belleğinde tutuluyor; başarılı ve başarısız işler işlemden sonra listeden çıkarılıyor. Manuel proje kaydı kuyruğu içerebiliyor. | Başarısız işi yeniden hazırlama ve kapanış sonrası iş kaybı riski. | `renderer/app.js:1279`, `:1368`, `:1383`, `:1447` |
| Genel ayar yazımı hatayı sessizce yutuyor. Yeni sağlayıcı ayarlarının ayrı, atomik kayıt yolu var. | Bazı ayarlar kaydedilmiş görünüp yeniden açılışta kaybolabilir. | `main.js:67`; `provider-settings-save` |
| API anahtarları ayar dosyasında tutuluyor ve genel ayar yanıtıyla renderer'a dönüyor. | Güvenli saklama ve daha dar IPC sınırı ihtiyacı. | `main.js:58–75` |
| Düzenlenmiş altyazılarda kelime zamanları metinden yeniden tahmin ediliyor. | Doğru metin olsa bile kelime vurgusu konuşmayla tam örtüşmeyebilir. | `renderer/review-data.js:32`, `renderer/review.js:138`, `main.js:1242` |
| Önbellek budaması video adedine göre; altyazı ve AI dosyaları bu sınıra dahil değil. | Disk kullanımı video sayısı ayarıyla tam kontrol edilemiyor. | `main.js:1125` |
| İçerik asistanı/hikâye transkripti paylaşılmış; kesit altyazısı için ayrı önbellek ve üretim yolu var. | Tek kaynak farklı araçlarda yeniden işlenebiliyor; düzenlenmiş metin tek merkezden yayılmıyor. | `main.js:1035`, `:2432` |
| Yayın CI'ında paketleme ve takip ikilisi açılış testi var; mevcut uygulama regresyon betikleri çalıştırılmıyor. | Paketin derlenmesi, kullanıcı akışlarının sağlam olduğunu göstermiyor. | `.github/workflows/release.yml`, `scripts/check-*.cjs` |
| Takip paketlenmiş ikiliyle çalışabilirken Whisper sistem Python'una ve faster-whisper'a bağımlı. | Temiz bilgisayarda altyazı üretiminin ilk kullanımı zorlaşabilir. | `main.js:164–169`, `subtitle.py:59` |
| `main.js` 3.547, `renderer/app.js` 3.193 satır. | Tek başına hata kanıtı değil; farklı araçların süreç ve durum yönetimini değiştirmek zorlaşıyor. | İnceleme tarihindeki dosyalar |

Yerel kaynak kimliği dosya yolu, boyut ve değiştirilme zamanını zaten içeriyor. Bu korumayı yeni öneri olarak saymamak gerekir. Benzer şekilde mevcut takip kimlik katmanını yeniden yazmadan önce gerçek görüntülerde nerede başarısız olduğu ölçülmeli.

## Öncelikli ürün geliştirmeleri

| Sıra | Geliştirme | Kullanıcı faydası / ilk kapsam | Efor |
|---|---|---|---|
| 1 | Geri al/ileri al ve otomatik kurtarma | Metin, kesim ve kadraj değişikliklerini geri al; kapanınca son projeyi kurtar. Manuel proje dosyasından ayrı sürümlü taslak kaydı. | Orta |
| 2 | Altyazı zamanlama stüdyosu | Gerçek kelime zamanlarını koru; değişen satırı yeniden hizala; satır böl/birleştir, toplu bul/değiştir, özel isim sözlüğü. | Orta–yüksek |
| 3 | Kadraj yönetmeni | Zaman çizgisinde kadraj kontrol noktaları, yumuşak geçiş, sorunlu aralığı işaretleme ve yalnız o aralıkta kişiyi yeniden seçme. | Yüksek |
| 4 | Gerçek çıktı provası | Seçilen 5–10 saniyeyi dışa aktarmanın aynı altyazı/logo/başlık zinciriyle işle ve göster; değişiklikte provayı geçersiz kıl. | Orta |
| 5 | Metinden kurgu | Transkriptte cümle seçerek klip oluştur; çıkarılan bölümü geri alınabilir kurgu kararı olarak tut. Mevcut semantik arama ve sessizlik tespiti bu akışa bağlansın. | Yüksek |
| 6 | Yayın paketi ve marka profilleri | Mevcut çoklu oran çıktısına format başına yerleşim, kapak karesi, altyazı dosyası, başlık/açıklama ve tutarlı dosya adları ekle. | Orta |
| 7 | Ses kontrolü | Özgün ses/anlatım dengesi, seviye göstergesi, örnek dinleme ve isteğe bağlı ses seviyesi dengeleme. | Orta |

**Altyazı kabul ölçütü:** Değişmeyen kelimelerin zamanları korunmalı; düzenlenen kelimeler önce/sonra dinlenebilmeli. Hızlı okuma, satır taşması ve platform maskesiyle çakışma ayrı uyarılar olmalı. Güvenli alan maskeleri yaklaşık rehberdir; platform arayüzü için kesin garanti sunulmamalı.

**Kadraj kabul ölçütü:** Kullanıcı 12–15. saniyeyi düzelttiğinde sonraki sahne gereksiz değişmemeli. Kontrol noktası silinebilmeli ve geri alınabilmeli. Takibin görünür olduğu süre, doğru kişiyi izleme başarısı diye sunulmamalı. Kesişen kişiler, sahne kesmesi, geç giriş ve geri dönüş içeren sabit bir değerlendirme seti gerekli.

**Prova kabul ölçütü:** Önizleme ile çıktı aynı font, satır kırılımı, vurgulama ve marka yerleşimini kullanmalı. Tarayıcıdaki hızlı önizleme korunurken kısa gerçek render son kontrol olmalı.

Ses dengeleme için FFmpeg'in `loudnorm` filtresi adaydır; mevcut paket filtresi ve ses/görüntü senkronu doğrulanmalı. Tek bir ses hedefini bütün mecralar için zorunlu tutmamak gerekir. [FFmpeg filtre belgeleri](https://ffmpeg.org/ffmpeg-filters.html#loudnorm)

## Ekranları nasıl konumlandırmalı?

Önerilen ana akış: **Kaynak → Kesitler → Düzenle → Yayınla.** Bu, yeni dört bağımsız araç değil; aynı proje durumunun dört görünümü olmalı.

- **Kaynak:** dosya/URL, son projeler, kaynak bilgisi ve transkript hazırlığı.
- **Kesitler:** bölüm, semantik arama, AI önerileri ve elle seçilen kesitler aynı aday listesinde. Her öneri gerekçesi ve kaynak zamanıyla gösterilsin; skorlar izlenme garantisi gibi sunulmasın.
- **Düzenle:** geniş önizleme; video/ses/altyazı şeritleri; sağda seçili öğenin kontrolleri. Kadraj kontrol masası bu alanın ayrıntılı çalışma görünümü olabilir. İlk sürümde sınırsız çok kanallı kurgu yerine kesit sıralama yeterli.
- **Yayınla:** hedef oranlar, marka profili, gerçek prova, dosya hedefi, işler ve hata sonrası yeniden deneme.

Sıkıştırma bağımsız yardımcı araç olarak kalabilir; yayın sonucundan da erişilmeli. Hikâye kurgusu ve destek görüntüleri, üretilmiş videoyu tekrar açmanın yanında düzenlenebilir sahne kararlarını projeye eklemeli. Böylece küçük bir düzeltme için bütün üretim zinciri baştan çalışmaz.

## Teknik optimizasyonlar

1. **Kalıcı iş merkezi:** İş kimliği, durum, giriş ayarlarının anlık kopyası ve hata nedeni saklansın. Başarısız işi yeniden dene, bekleyenleri yeniden sırala. Çökme sonrası yarım FFmpeg işini kaldığı byte'tan sürdürmek yerine yarım çıktı doğrulanıp iş güvenli biçimde yeniden başlatılsın.
2. **Ortak kaynak bütçesi:** Ayrı ekranların FFmpeg/Whisper/takip işleri tek zamanlayıcı üzerinden çalışsın. Önizlemeye öncelik verilsin; ağır işlerin eşzamanlılığı CPU/GPU ve belleğe göre sınırlandırılsın. Hız kazancı ölçülmeden yüzde iddiası yapılmamalı.
3. **Ortak medya hazırlığı:** Kaynak başına yeniden kullanılabilir önizleme videosu, dalga verisi ve kare şeridi. Önbellek anahtarı kaynak kimliği + işlem ayarları + şema sürümünü içersin. Mevcut transkript paylaşımı altyazı onay akışına da genişletilsin.
4. **Disk bütçesi:** GB sınırı, son kullanım tarihi, türetilmiş dosyalarla birlikte temizleme; aktif projelerin kullandığı veriyi koruma. Kullanıcı medya dosyası önbellek sanılarak silinmemeli.
5. **Sağlayıcı tanılama:** Mevcut model zinciri korunsun. Bağlantı testi ile gerçek üretim testi ayrıştırılsın; kullanıcı başlatırsa küçük üretim denemesi, kullanılan model, denemeler ve anlaşılır hata nedeni gösterilsin. Ücretli istek otomatik tetiklenmesin.
6. **Güvenilir ayarlar ve anahtarlar:** Genel ayarlar da atomik yazılsın ve hatalar kullanıcıya dönsün. Anahtarları OS destekli şifreli saklamaya taşı; renderer'a varsayılan olarak yalnız kayıt durumu gönder. Eski dosyadan kayıpsız geçiş ve platforma göre koruma kontrolü gerekli. Electron `safeStorage` olası çözüm; Linux arka uçları ve macOS imza davranışı ayrıca değerlendirilmelidir. [Electron belgesi](https://www.electronjs.org/docs/latest/api/safe-storage/)
7. **Kuruluma hazırlık:** Whisper/Python/model durumunu tek ekranda kontrol et; model boyutu ve indirme durumunu açık göster. Temiz Windows kurulumu kabul testi olsun.
8. **Kademeli modülerleştirme ve CI:** Medya işçisi, proje deposu, transkript ve sağlayıcı katmanlarını sorumluluklarına göre ayır. Var olan çevrimdışı regresyonları PR/push CI'ına bağla; paketlenmiş uygulamada kısa gerçek dışa aktarma testi ekle.

## Uygulama sırası ve başarı ölçümü

**İlk paket — güvenli düzenleme:** geri al/otomatik kurtarma, altyazı satır araçları, başarısız işi saklama/yeniden deneme, genel ayar kayıt hatalarını düzeltme. Frontend kazanımı görünür; proje sürümleme temeli sonraki özellikleri taşır.

**İkinci paket — güvenilir çıktı:** kelime zamanlarını koruma, yerel kadraj düzeltmeleri, gerçek çıktı provası ve yayın profilleri. Birlikte değerlendirilecek çünkü ortak zaman çizgisine ihtiyaçları var.

**Üçüncü paket — hızlı üretim:** metinden kurgu, ortak transkript, sahne planının düzenlenebilir tutulması, kaynak bütçesi ve türetilmiş medya önbelleği.

Ölçümler aynı donanımda sabit 1080p/4K örneklerle alınmalı: ilk kullanılabilir önizlemeye süre, ilk onaylı klibe süre, 60 saniyelik çıktının süresi, en yüksek bellek kullanımı, önbellek isabeti, bir çıktı için kullanıcı düzeltme/yeniden render sayısı. Takip için yanlış kişi geçişi; altyazı için kelime zaman sapması ayrıca ölçülmeli. Henüz sayısal taban ölçümü yok; hız hedefi bu ölçümden sonra konmalı.

İlk aşamada otomatik sosyal medya paylaşımı, kapsamlı efekt mağazası ve sınırsız çok kanallı editörü ertelemek uygun. Önce mevcut kaynak → onay → çıktı akışındaki tekrar iş azaltılmalı.

## Önceki beş maddelik planla ilişki

`GELISTIRME-PLANI.md` geçerli kalır. Modülerleştirme ve güvenli anahtar saklama yukarıdaki teknik işleri besler. Test betikleri mevcut; CI bağlantısı tamamlanmalı. Yerel MP3 sorunu önceki çalışmada düzeltildi, yeni özellik gibi tekrar açılmamalı. README güncellenmiş olsa da eski yol haritasındaki altyazı animasyonu/akış açıklamalarının son davranışla eşleştirilmesi gerekir. Bu rapordaki öneriler uygulanmış veya kullanıcı tarafından onaylanmış işler değildir.
