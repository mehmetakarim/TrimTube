# TrimTube geliştirme planı

## 2 Ekim 2026 — kelime zamanları, aralıklı kadraj ve gerçek prova

- Whisper inceleme akışı artık kelime zamanlarını da ister ve döndürür. Belge,
  proje/taslak, animasyon önizlemesi ve dışa aktarma bu veriyi korur. Düzenlenen
  metinle eşleşen kelimeler zamanlarını tutar; eşleşmeyenler tahmini olarak
  işaretlenir. Arayüz ölçülmüş/tahmini kelime sayısını gösterir. Bu işlem yeni
  metni sese yeniden hizalayan bir model değildir; alan kalmazsa satırın tamamı
  tahmini olur ve hiçbir eklenen kelime sessizce düşürülmez.
- Kurgu sırası değiştiğinde kelimelerin zamanları ve altyazı grupları da taşınır.
  Altyazı önbelleği artık kesit başlangıcını/süresini milisaniye hassasiyetinde
  ayırır; eski tam saniye önbellekleri kullanılabilir.
- Kadraj kontrolünde başlangıç/bitiş aralığı ve “Bu andan 5 sn” kolaylığı var.
  Aralığın sonunda önceki takip yoluna dönülür. Onay/geri alma/taslak sözleşmesi
  korunur. Yumuşak interpolasyon ve bağımsız kontrol noktası listesi henüz yok.
- Çıktı panelinden veya kontrol masasından 5 saniyelik gerçek çıktı provası
  oluşturulur. Kaynak/kurgu çıktı zamanı ve seçili oran kullanılır; altyazı,
  logo, başlık ve kadraj normal dışa aktarmayla aynı motor üzerinden işlenir.
  Takipli provada kadrajın önce onaylanması gerekir. Üretim ve prova ortak
  süreç kilidi kullanır; iptal, geç sonuç ve ayar değişikliği korunur. Geçici
  prova dosyaları kapatılırken temizlenir. Kurgu hazırlığı henüz tüm parçaları
  birleştirdiği için prova toplam hazırlık süresini 5 saniyeyle sınırlamaz.

Doğrulama: 103 Electron arayüz, 34 gerçek medya/IPC, 17 altyazı/kadraj veri
ve 8 kurgu veri kontrolü geçti. Prova kareleri tam çıktının aynı anındaki
altyazı/logo/başlık içeren karelerle karşılaştırıldı. Whisper kelime aktarımı
yerel önbellek örneğiyle test edildi; yeni bir konuşma modeli indirilmedi veya
gerçek kayıtta yeniden transkripsiyon çalıştırılmadı. Arayüz ve medya testleri
harici sağlayıcılara istek göndermez.

Sonraki ürün paketi: metinden kurgu, ortak transkript ve yayın/marka profilleri.
Çoklu kaynak ve bağımsız ses kanalları ayrı kurgu geliştirmesi olarak açık.
Güvenli anahtar saklama ve CI bağlantısı önceki teknik planda halen açık.

## 1 Ekim 2026 — onaylanan ürün planı ve kurgu masası ilk paketi

Kullanıcı `URUN-ANALIZI-2026-10-01.md` önerilerini kabul etti; ek öncelik
CapCut benzeri bölme, trim ve parçaları sürükleyerek sıralama oldu.

İlk paket uygulandı:
- Kaynak seçimi ve Kurgu görünümleri; tek kaynağın 100 parçaya kadar boşluksuz
  kurgusu, böl/çoğalt/sil, kenardan ve sayısal trim, fare/klavye ile sıralama,
  ses şeridi, cetvel, yakınlık, ardışık oynatma ve birleşik gerçek çıktı.
- Altyazı ve onaylı kadraj olaylarını parça sırasına taşıyan ortak veri modülü;
  onay aralığı dışına çıkan parçalar için açık hata. Önizleme kaynak sırasını
  gösterir; gerçek efektli çıktı provası sonraki pakettedir.
- Düzenleme geçmişi, kontrol masasında geri alma, atomik yerel kurtarma taslağı,
  açılışta geri yükleme ve proje dosyasında kurgu kararlarının korunması.
- Başarısız kuyruk işini koruma ve yeniden deneme; genel ayar yazımında sessiz
  başarısızlık yerine atomik kayıt ve hata bildirimi.
- Altyazıda imleçte bölme, satır birleştirme ve toplu bul-değiştir. Bunlar gerçek
  kelime hizalama geliştirmesini tamamlamaz; o madde sonraki pakette kalır.

Doğrulama: 98 gerçek Electron arayüz kontrolü, 30 medya/IPC kontrolü, 8 kurgu
verisi, 12 altyazı ve 17 sağlayıcı regresyon kontrolü geçti. Medya testinde
yeniden sıralanan renkli kareler ve farklı ses frekansları çözümlenerek gerçek
görüntü/ses sırası doğrulandı; sessiz kaynak, MP3, altyazı+kadraj ve iptal de
denendi. Arayüz testinde gerçek fareyle sıralama/trim, undo/redo, uygulama
renderer'ı yeniden yüklenerek taslak kurtarma ve başarısız işi yeniden deneme
doğrulandı. 1280×900 koyu ve 900×640 açık arayüz görüntüleri incelendi.

Sonraki paket: gerçek kelime zamanlarını koruma, aralığa özel kadraj kontrol
noktaları ve kısa gerçek çıktı provası. Daha sonra çoklu kaynak/bağımsız ses
kanalları, ortak transkript ve yayın profilleri. Önceden kabul edilen beş teknik
madde geçerlidir; işletim sistemi destekli anahtar saklama ve CI bağlantısı
henüz tamamlandı sayılmamalı. Kurgu motoru şu an kayıpsız geçici medya kullanır;
disk/süre optimizasyonu ölçüm sonrası ele alınacak.

## Kullanıcı yönlendirmesi — 29 Eylül 2026

Öncelik frontend: kullanıcı mevcut uygulamayı genel olarak beğeniyor. İşlevleri
koruyarak premium, fayda odaklı bir reji masası deneyimi geliştirilecek.
Timeline ve ses dalgası CapCut benzeri görünürlük ve kullanım kolaylığı sunmalı.
Bu dosya sonraki oturumlar için kalıcı proje hafızasıdır.

## Öncelikli çalışma: reji masası

- Geniş önizleme, erişilebilir araç rayı, sağda çıktı ayarları.
- Video kareleri üzerinde kesim kolları, zaman cetveli, sürükleyerek sarma.
- Gerçek ses dalgasında yakınlaştırma ve gezinme; yükleme/hata durumları.
- Seçili kesiti döngüde önizleme, hızlı süre seçimi ve klavye erişimi.
- Açık/koyu tema ve mevcut indirme, kuyruk, proje, takip akışlarını koruma.
- Boş/yüklü durumları ve farklı pencere boyutlarını görsel olarak doğrulama.

Tasarım: soğuk porselen #F2F4F8, gece mavisi #171E2B, panel #202A3A,
kurgu mavisi #4263EB, ses turkuazı #39B7B0, oynatma kafası kehribar #E7AB59.
Başlık: Bahnschrift; arayüz: Segoe UI; zaman: Consolas (sistem yedekleriyle).
İmza öğe: video ve sesin ayrı, açıkça etiketlenmiş şeritlerde görüldüğü kurgu masası.

## Sonraki geliştirmeler — kullanıcı tarafından kabul edilen beş madde

1. **Modülerleştirme:** main.js içinden medya motoru, AI sağlayıcıları, ayarlar
   ve IPC; renderer içinden ekran sorumluluklarını aşamalı ayır.
2. **Anahtar saklama:** Gemini, ElevenLabs ve Pexels anahtarlarını işletim
   sistemi destekli güvenli depoya taşı; mevcut ayarları kayıpsız geçir.
3. **Regresyon testleri:** kesim, kuyruk/iptal, proje geri yükleme ve medya
   dönüşümlerine tekrar çalıştırılabilir testler ve CI kontrolleri ekle.
4. **Yerel MP3 hatası:** kesim seçilmediğinde kaynak videonun kopyalanması
   yerine MP3 dönüşümü yapılmasını sağla; gerçek dosyayla doğrula.
5. **Dokümantasyon:** README'yi AI kurgu, B-roll, akıllı kırpma ve güncel
   kurulum/bağımlılık kapsamıyla eşleştir.

Bu beş madde unutulmayacak; frontend ilk sıradadır. Kod incelemesi bulguları,
çalışma zamanı testinin yerini tutmaz. Tamamlanma kanıtları bu dosyaya eklenir.

## Frontend ilk uygulaması — tamamlandı

- `renderer/studio.css`: açık/koyu tema, ikon rayı, reji masası yerleşimi,
  küçük pencere düzeni, odak görünürlüğü ve azaltılmış hareket desteği.
- `renderer/studio.js`: zaman cetvelleri, gerçek pointer ile sarma,
  yakınlaştırma/gezinme, 15/30/60 saniye seçimleri, kesit döngüsü.
- Ses dalgasının eski bir isteğe ait sonuçla yeni pencereyi kaplaması engellendi.
- `scripts/check-studio.cjs`: gerçek Electron renderer ve üretilmiş yerel video
  ile 22 kontrol geçti. Harici servisler IPC üzerinden taklit edildi; medya
  oynatma, FFmpeg ile üretilmiş dalga/kare görselleri, fare ve klavye gerçek.
- 1280×900 ve 900×640 pencerelerde, açık/koyu temada ekran görüntüleri incelendi.
  Küçük pencerede açık menüyle timeline taşması giderildi.
- Test: `electron scripts/check-studio.cjs`. Bu Windows test ortamında GPU alt
  süreci başlayamadığından `--no-sandbox --in-process-gpu` bayraklarıyla çalıştı;
  üretim uygulamasının güvenlik ayarları değiştirilmedi.
- Çıktılar `build/studio-qa/` altında (git dışında). İnternet üzerinden indirme,
  AI çağrıları ve gerçek dışa aktarma bu frontend kontrolünün kapsamı dışındadır.

Kullanıcıyla görsel değerlendirme sonrası arayüz ince ayarları yapılabilir.
Bu ilk frontend testi tek başına tam regresyon altyapısı maddesini tamamlamaz.

## Araç denetimi ve tüm ekranlar — 29 Eylül 2026

Kullanıcı mevcut tasarımın korunmasını zorunlu tutmuyor: daha işlevsel erişim ve
konumlandırma tercih edilecek. Video Kes dışındaki ekranlar da kapsama alındı.

Tamamlananlar:

- Video Kes araçları Kadraj / Altyazı / Marka sekmelerine ayrıldı; kalite seçimi
  dışa aktarma alanına taşındı. Takip tüm video formatlarında keşfedilebilir;
  etkinleştirilmesi 9:16 formatını da seçer.
- Kişi seçimi gerçek görüntü koordinatlarında, kesitin başlangıcında yapılır.
  Siyah kenarlıklar reddedilir; başlangıç değişince işaret geçersizleşir.
- Takip: geç gelen yüzü yakalama, aynı izde iki yüzün birleşmesini engelleme,
  sessizlik normalizasyonu, kayıpta yanlış maskeyi kaldırma, sahneler arası
  medyan karışmasını ve dar portrede kadraj taşmasını düzeltme.
- Sakin / Dengeli / Çevik kamera; önizlemede görünür kutu oranı ve kayıp durumu.
  İptal edilen eski analiz sonucu modalı yeniden açamaz. Oran doğruluk puanı değil.
- Altyazı kaynağı/dil seçimi ve stil örneği; Türkçe otomatik altyazı tercihi;
  başarısız altyazı işlemlerinde sessiz atlama yerine açıklayıcı hata.
- Logo boyutu, başlık süresi ve eksik seçim doğrulaması; ASS metin kaçışı.
- Yeni ayarlar proje kaydet/aç akışında korunur; kişi işareti şablonla taşınmaz.
- Diğer ekranlar kaynak/seçenek ve sonuç alanlarına ayrıldı. Yerel kaynağı
  yeniden kullanma, çıktıdan kurgu masasına dönüş, anlaşılır adlar ve eksik
  API anahtarında pahalı analizi önceden engelleme eklendi.
- Geliştirmede `.venv` desteği; OpenCV ve faster-whisper bu ortamda kuruldu.
  Ortam git ve paketlemeye dahil değil.

Doğrulama: 49 Electron arayüz kontrolü, 8 deterministik takip regresyonu,
8 gerçek yerel medya entegrasyon kontrolü geçti (toplam 65). Gerçek FFmpeg ile
altyazı/logo/başlık, MP3, takipli dar portre; gerçek OpenCV ile yüz bulunmayan
kaynak sınandı. Açık/koyu ve küçük pencere görüntüleri gözden geçirildi.
Gerçek konuşmalı sahnelerde kimlik/konuşmacı doğruluğu ile bulut AI yanıtları
bu testler tarafından kanıtlanmış değildir; kullanıcı videolarıyla saha testi gerekir.

Beş maddelik planın güncel durumu:

1. Modülerleştirme: frontend için `editor-tools.js`, `workspace.js` ayrıldı;
   ana süreç/AI modüllerine ayırma hâlâ sırada.
2. Güvenli anahtar saklama: sırada.
3. Regresyon testleri: yerel araçlar eklendi; CI entegrasyonu ve daha geniş
   kuyruk/iptal kapsamı sırada.
4. Yerel MP3 hatası: düzeltildi; gerçek MP3 çıktısıyla doğrulandı.
5. README: güncel ekranlar, AI araçları, bağımlılıklar ve test komutları eklendi.

## Kadraj ve altyazı kontrol masası — tamamlandı (29 Eylül 2026)

- Önizleme zaman sürgüsü, 1/30 saniye adımlama, hız seçimi ve çıktı büyütme.
- Yatay kadrajı seçilen andan sona sabitleme; analiz edilen yola geri dönüş.
  Onaylanan normalize yol dışa aktarmada yeniden takip çalıştırılmadan kullanılır.
- Altyazı dışa aktarmadan önce hazırlanır. Metin/zaman düzenleme, satır ekleme/silme,
  doğrulama ve onay. Kaynak/kesit/model/dil değişince eski onay kullanılamaz.
- TikTok / Shorts / Reels rehberleri üzerinde altyazı metni ve çakışma uyarısı;
  alt/yan boşluk ve platforma yerleştirme. Maskeler yaklaşık, font önizlemesi
  tarayıcıya aittir. Animasyon gösterilmez; kelime süreleri düzenlenen metinden tahmin edilir.
- “Uygula ve dışa aktar” mevcut ayarları kuyruğa ekler. Onaysız eski altyazılı
  kuyruk işleri backend tarafından da reddedilir; sürpriz çözümleme yapılmaz.
- Onaylı metin, tamamlanmamış taslaklar, kadraj yolu ve yerleşim projede saklanır.
  Şablon kullanımı kaynak metnini/kadraj yolunu taşımaz.
- Altyazı oluşturmanın bağımsız süreç ve iptal yönetimi; geç gelen sonuçlar uygulanmaz.

Doğrulama: 59 Electron arayüz, 16 FFmpeg/OpenCV medya, 8 altyazı/kadraj veri,
8 Python takip kontrolü geçti (toplam 91). Açık/koyu ve 900×640 pencere kontrolleri;
kontrol masası ile gerçek altyazılı çıktı görsel olarak incelendi. Model ağırlıkları
indirilerek yeni Whisper çıkarımı ve canlı YouTube indirmesi bu testlerde yapılmadı;
Whisper önbellek akışı, düzenleme/onay, iptal ve gerçek çıktı yolu doğrulandı.

## Altyazı stil ve geçiş düzeltmesi — 29 Eylül 2026

- Kontrol masasında beş stilin seçimi ve canlı önizlemesi; vurgulu stilde aktif
  kelime sarı, pop stilinde tek kelimelik büyüme animasyonu gösterilir.
- Tarayıcı ve ASS çıktısı ortak kelime/grup çizelgesini kullanır. Zamanlar ASS'ın
  santisaniye hassasiyetindedir. Grup sonundaki bekleme taşması kaldırıldı;
  ardışık gruplar ve satırlar aynı anda gösterilmez. Vurgulu kelime ölçeği sabit
  tutularak geçiş sırasında satır kırılımı değişmesi engellendi.
- 68 Electron arayüz, 18 gerçek medya ve 12 veri kontrolü geçti (98 kontrol).
  Üretilen vurgulu/pop ASS zamanları ve gerçek FFmpeg geçiş çıktıları doğrulandı;
  önizleme stili, sarı vurgu, sarma ve dışa aktarma seçenekleri test edildi.
- Font motorları arasında küçük ölçü farkları hâlâ olabilir; kelime süreleri
  düzenlenmiş altyazı satırlarından tahmin edilir.

## API bağlantıları ve model zinciri — 30 Eylül 2026

- SEO Yöneticisi `src-tauri/core/src/gemini/mod.rs` referansı incelendi: ayarlanabilir
  model sırası, canlı model listesi, hata sınıflandırma ve deneme geçmişi uyarlandı.
- Sabit Gemini 2.5 bağımlılığı kaldırıldı. Metin/TTS ayrı otomatik veya özel zincirler;
  sayfalı `models.list`, 5 dakika ve anahtara özel önbellek; 404/429/geçici sunucu
  hatalarında sıradaki model, yetki/geçersiz anahtarda durma; sınırlı süre ve iptal.
- Yeni metin modellerinde artık gerekmeyen temperature gönderilmez. TTS'nin WAV
  ve PCM yanıtları uygun FFmpeg giriş biçimiyle dönüştürülür.
- Ayarlar: üç sağlayıcı kartı, ayrı kaydet/test/göster kontrolleri; gerçek kaydetme
  sonucu, geç kalan test yanıtını reddetme; gelişmiş model ayarları açılır bölümde.
  API ayarı yazımı geçici dosya + atomik yeniden adlandırmayla yapılır. Anahtarlar
  eskisi gibi yerel ayar dosyasındadır; şifreli saklama planı ayrıca bekliyor.
- Ortak istemci `provider-client.js`; ayarlar arayüzü `renderer/connections.js/css`.

Doğrulama: 77 Electron arayüz, 22 gerçek medya/ana süreç entegrasyonu, 17 API
regresyon kontrolü geçti (116). Kaydedilmiş üç sağlayıcı anahtarıyla canlı liste/
arama kontrolleri başarılı. Küçük gerçek Gemini JSON üretiminde 3.8 Flash ve
3.7 Flash HTTP 503 döndürdü; zincir 3.6 Flash'a geçip HTTP 200 ve geçerli JSON aldı.
Kullanıcı videosu/metni gönderilmedi; ses üretimi yapılmadı. Ses biçimleri sentetik
WAV/PCM API yanıtları ve gerçek FFmpeg dönüşümüyle sınandı.

Kaynaklar: https://ai.google.dev/api/models,
https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts,
https://elevenlabs.io/docs/api-reference/voices/search,
https://www.pexels.com/api/documentation/.
