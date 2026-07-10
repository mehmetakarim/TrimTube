# TrimTube Geliştirme Günlüğü

Bu dosya, farklı ortamlardaki (ev: macOS M-serisi, ofis: Windows 11) geliştirme oturumlarında karşılaşılan problemleri ve uygulanan kalıcı çözümleri barındırır. Her başlık hangi ortama ait olduğunu belirtir — iki ortam arasında hafıza aktarımı bu dosya üzerinden yapılır.

---

# macOS Oturumu (Sorunlar ve Çözümler)

---

## 1. macOS Oturumundaki "Uygulama Hasar Görmüş" Hatası (Gatekeeper Karantinası)

### Sorun:
Uygulama internetten `.dmg` olarak indirilip kurulduktan sonra açılmak istendiğinde şu hata alınıyordu:
> *"“TrimTube” hasar görmüş olduğu için açılamıyor. Onu Çöp Sepeti’ne taşımalısınız."*

### Neden:
macOS, internetten indirilen ve imzalanmamış (notarize edilmemiş) uygulamalara otomatik olarak karantina özniteliği (`com.apple.quarantine`) atar. Bu öznitelik sadece ana uygulamaya değil, uygulamanın içindeki gömülü `yt-dlp` ve `ffmpeg` gibi çalıştırılabilir ikili dosyalara da atanmıştı.

### Çözüm:
Uygulama klasörünün tamamından ve alt dosyalarından karantina bayrağını özyinelemeli (recursive) olarak temizlemek:
```bash
xattr -cr /Applications/TrimTube.app
```
*Not: İnternetten her yeni sürüm (.dmg) indirilip kurulduğunda bu işlem macOS tarafından sıfırlanacağı için komutun tekrar çalıştırılması gerekir.*

---

## 2. macOS Oturumundaki "İndirilen Dosya Bulunamadı" Hatası (Ses ve Video Birleştirme Sorunu)

### Sorun:
Videolar indirilirken veya kesilirken işlem yarıda kalıyor ve `"İndirilen dosya bulunamadı"` uyarısı çıkıyordu. Önbellek (cache) klasöründe video (`.mp4`) ve ses (`.m4a`) dosyalarının birleştirilemeden ayrı ayrı durduğu gözlemlendi.

### Neden:
1. YouTube yüksek kaliteli videoları ses ve görüntü olarak ayrı akışlar halinde sunar. `yt-dlp` bunları birleştirmek için sistemde `ffmpeg` arar. Ancak uygulama macOS Finder (GUI) üzerinden açıldığında sistem `PATH` değişkenini devralmadığı için Homebrew ile kurulu olan `ffmpeg`'i bulamıyordu.
2. `yt-dlp` varsayılan olarak `-N 8` (8 eşzamanlı parça) ile indirme yapıyordu. YouTube, bu çoklu bağlantıları algılayıp bağlantıyı sıfırlayarak `Got error: X bytes read, Y more expected` hatası veriyordu.

### Çözüm (Kaynak Kod Düzeyinde):
`main.js` içerisinde `runYtdlp` fonksiyonu güncellendi:
*   Bağlantının kopmasını önlemek için eşzamanlı parça limiti **`-N 1`** yapıldı.
*   `yt-dlp`'nin sistemdeki ffmpeg'i aramak yerine uygulamanın içine gömülü gelen `ffmpeg`'i doğrudan kullanması için parametrelere **`--ffmpeg-location FFMPEG`** eklendi.

---

## 3. macOS Oturumundaki "spawn python ENOENT" Hatası (Kişi Takibinin Başlatılamaması)

### Sorun:
Kişi takibi özelliği aktif edildiğinde işlem tamamlanırken şu hata oluşuyordu:
> *"Kişi takibi başarısız: spawn python ENOENT"*

### Neden:
1. macOS Finder üzerinden başlatılan Electron uygulaması, kullanıcının terminal profilindeki (`.zshrc`) `PATH` tanımlarını bilmez. Bu yüzden `/opt/homebrew/bin` altında bulunan `python3` yürütülebilir dosyasına erişemiyordu.
2. macOS üzerinde varsayılan Python çağrısı `python` değil, `python3` olmalıdır.

### Çözüm (Kaynak Kod Düzeyinde):
`main.js` dosyası güncellendi:
*   Uygulama macOS üzerinde (`darwin`) başladığında otomatik olarak Homebrew yollarını `PATH`'e ekleyen kod eklendi:
    ```javascript
    if (process.platform === 'darwin') {
      process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`;
    }
    ```
*   Çalıştırılacak Python komutu platforma göre dinamik hale getirildi (Windows için `python`, macOS/Linux için `python3`):
    ```javascript
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    ```

---

## 4. macOS Oturumundaki "ZIP file not provided" Hatası (Otomatik Güncelleme Hatası)

### Sorun:
Uygulama içi otomatik güncelleme butonuna basıldığında şu hata fırlatılıyordu:
> *"Error invoking remote method 'update-download': Error: ZIP file not provided"*

### Neden:
macOS üzerinde `electron-updater`'ın bağlı olduğu **Squirrel.Mac** servisi, arka planda güncellemeyi açıp kurabilmek için `.zip` formatında bir arşive ihtiyaç duyar. Ancak `package.json` içerisindeki macOS derleme hedefi sadece `"dmg"` olarak ayarlanmıştı.

### Çözüm (Kaynak Kod Düzeyinde):
`package.json` altındaki `mac.target` yapılandırması hem DMG hem de ZIP üretecek şekilde güncellendi:
```json
"mac": {
  "target": ["dmg", "zip"]
}
```
*Not: macOS'te uygulamanın tamamen arka planda güncellenebilmesi için (Squirrel.Mac/ShipIt kısıtlamalarından dolayı) uygulamanın geçerli bir Apple Developer ID sertifikası ile imzalanmış olması gerekir. İmzasız durumda güncelleme indirilir ancak imza doğrulama aşamasında (`Code signature did not pass validation`) hata vererek kullanıcıyı manuel indirmeye yönlendirir. Windows'ta ise imzasız olsa bile otomatik güncelleme çalışır.*

---

## 5. macOS Oturumundaki "cv2 has no attribute legacy" Hatası (OpenCV Sürüm ve Paket Sorunu)

### Sorun:
Kişi takibi başlatıldığında şu hata alınıyordu:
> *"AttributeError: module 'cv2' has no attribute 'legacy'"*

### Neden:
Sistemde kurulu olan kütüphane OpenCV'nin temel sürümü olan `opencv-python` idi. Takip algoritmalarını (CSRT vb.) içeren ekstra modüller ise sadece **`opencv-contrib-python`** paketinde yer alır. Yanlış paket kurulduğu için `cv2.TrackerCSRT_create()` bulunamamış, alternatif olarak aranan `legacy` isim uzayı da hata fırlatmıştır.

### Çözüm:
Sistemdeki çakışan temel paket kaldırıldı ve gerekli contrib paketi kuruldu:
```bash
python3 -m pip uninstall -y opencv-python opencv-contrib-python --break-system-packages
python3 -m pip install opencv-contrib-python --break-system-packages
```
*(OpenCV 5.0.0+ sürümü ile `cv2.TrackerCSRT_create()` nesnesinin başarıyla oluşturulduğu teyit edildi).*

---

# Windows Oturumu (10 Temmuz 2026)

## 1. macOS düzeltmelerinin Windows'a etkilerinin gözden geçirilmesi

### `--ffmpeg-location` (macOS düzeltmesi, Windows'a da yarıyor)
macOS oturumunda eklenen `--ffmpeg-location FFMPEG` parametresi, Windows'taki gizli bir hatayı da çözdü: paketlenmiş Windows sürümünde gömülü yt-dlp, ses/video birleştirmek için ffmpeg'i sistem PATH'inde arıyordu. Geliştirme makinesinde ffmpeg kurulu olduğu için fark edilmemişti; ffmpeg'i olmayan kullanıcılarda yüksek kaliteli indirmeler (ayrı ses+video akışları) birleştirilemeden kalacaktı.

**Doğrulama:** PATH'ten ffmpeg tamamen gizlenerek (PATH=system32 ile) birleştirme gerektiren bir indirme test edildi — gömülü `ffmpeg-static` yoluyla birleştirme başarılı. Ek değişiklik gerekmedi.

## 2. `-N` (eşzamanlı parça) sayısının platforma göre ayrılması

### Sorun:
macOS oturumunda bağlantı kopmaları (`Got error: X bytes read, Y more expected`) nedeniyle `-N 8` → `-N 1` yapılmıştı. Ancak bu değişiklik Windows'u da kapsıyordu; Windows'ta `-N 8` sorunsuz çalışıyor ve 2 saat 15 dakikalık bir bölümü ~4 dakikada indiriyor (`-N 1` ile belirgin şekilde yavaş olur).

### Çözüm (Kaynak Kod Düzeyinde):
`main.js > runYtdlp` içinde parça sayısı platforma göre koşullu hale getirildi:
```javascript
const fragments = process.platform === 'win32' ? '8' : '1';
```
Windows: `-N 8` (hızlı, sorun görülmedi) · macOS/Linux: `-N 1` (bağlantı stabilitesi).

## 3. Sürüm eşitlemesi

macOS oturumunda v1.0.5 ve v1.0.6 release'leri alınmış; Windows tarafındaki yerel repo `git fetch --tags` ile eşitlendi. Güncel yayın: **v1.0.6**.
