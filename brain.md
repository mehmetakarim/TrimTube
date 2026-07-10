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

---

# Windows Oturumu — Faz 1 Release (v1.1.0)

Özellik yol haritasının (bkz. artifact: TrimTube Özellik Yol Haritası) ilk fazı tamamlanıp **v1.1.0** olarak yayınlandı:

- **İnce ayar şeridi:** ana slider'ın altında, seçili aralığın ±%25'ine (en az 15 sn) yakınlaşan ikinci çift kollu şerit. Uzun videolarda saniye hassasiyetinde kesim.
- **Ses dalga formu:** ince şeridin arka planında, önizleme akışından HTTP range ile üretilir (`ffmpeg showwavespic`, 900x92, `scale=sqrt` — kısık diyalog görünür, sessizlik düz). Debounce 600 ms + bayat istek iptali; `waveformProc` ayrı tutulur, İptal butonunun `currentProc` mantığına karışmaz.
- **Klavye kısayolları:** Boşluk/K, I/O (Türkçe ı/İ dahil), J/L (∓5 sn), ←/→ (∓1 sn).
- **ETA:** indirmede yt-dlp `ETA` alanı, ffmpeg aşamalarında `speed=` alanından hesap.
- **Oynatıcı sadeleştirme:** native `controls` kaldırıldı; özel şerit (oynat/duraklat, süre `fmtClock`, ses) + her iki zaman çizelgesinde canlı playhead. Videoya tıklama = oynat/duraklat (kişi işaretleme modu hariç).

Sıradaki fazlar: Faz 2 (GPU kodlama + hata mesajları), Faz 3 (altyazı), Faz 4 (çoklu üretim), Faz 5 (ayarlar + karanlık mod).

---

# Windows Oturumu — Faz 2: GPU Hızlandırmalı Kodlama (v1.2.0)

Özellik yol haritasının "Performans" bölümünden GPU kodlama uygulandı. Gerçek RTX 5060 donanımında ölçülen sonuçlar, ilk varsayımı düzeltti:

## Ölçüm bulguları (3 dakikalık 4K AV1 kaynak, 9:16 dönüştürme)

| Yöntem | Süre | Not |
|---|---|---|
| CPU çözme + CPU kodlama (eski) | 99.7 sn | — |
| CPU çözme + GPU kodlama (yalnızca `-c:v h264_nvenc`) | 88.3 sn | ~%11 kazanç — **beklenenin çok altında** |
| **GPU çözme + GPU kodlama** (`-hwaccel cuda` + `h264_nvenc`) | **39.4 sn** | **~2.5x kazanç** |

**Kritik bulgu:** Darboğaz kodlama değil, kaynağın (YouTube "best" kalite genelde 4K AV1) **yazılımla çözülmesiydi**. Sadece kodlayıcıyı GPU'ya taşımak neredeyse fark yaratmıyor; asıl kazanç `-hwaccel` ile çözmeyi de GPU'ya vermekten geliyor. Bu yüzden ilk planlanan "sadece `-c:v` değiştir" yaklaşımı genişletildi.

## Mimari

`main.js`:
- `ENCODER_CANDIDATES` (platforma göre): win32/linux → `h264_nvenc, h264_qsv, h264_amf`; darwin → `h264_videotoolbox`.
- `probeEncoder(codec)`: `color=black` sentetik kaynakla küçük bir test kodlaması (`-frames:v 5 -f null -`), 8 sn zaman aşımı. Gerçek donanımda doğrulandı: nvenc exit 0, qsv exit 171 (bu makinede aktif Intel GPU yok) — doğru ayrım yapıyor.
- `getEncoder()`: adayları sırayla probe'lar, ilk başarılıyı **memoize** eder (`encoderPromise`). `app.whenReady()` içinde erkenden tetiklenir, ilk render'ı beklemez.
- `HWACCEL_FOR_ENCODER`: her kodlayıcı için eşleşen çözme bayrağı (`h264_nvenc→cuda`, `h264_qsv→qsv`, `h264_amf→d3d11va` [yalnızca win32], `h264_videotoolbox→videotoolbox`). AMD/Linux ve videotoolbox eşleşmeleri **test edilemedi** (uygun donanım yok) — güvenlik ağı aşağıdaki fallback.
- `videoEncodeArgs(codec, crf)`: her kodlayıcı için 0-51 crf ölçeğine en yakın parametre seti (nvenc: `-rc vbr -cq N -b:v 0`, qsv: `-global_quality N`, amf: `-rc cqp -qp_i N`, videotoolbox: `-q:v` ters orantılı çevrim).
- `runEncodeWithFallback(buildArgs, crf, onLine, cwd)`: probe geçse bile gerçek render başarısız olursa (donanım/sürücü kaynaklı) **tek seferlik tam CPU'ya (libx264, hwaccel'siz) otomatik düşüş** — hem probe hem gerçek iş için çift güvenlik katmanı.

3 render noktası da (takipli-kırpma ön-kesim, takipli dinamik kırpma, genel dikey dönüştürme) bu yardımcıyı kullanacak şekilde güncellendi. Ses-only (mp3, `-c copy`) yeniden kodlama gerektirmediği için etkilenmedi.

## Doğrulama

- `probeEncoder` mantığı gerçek CLI ile ayrı ayrı test edildi (nvenc başarılı, qsv beklenen şekilde başarısız).
- Tam GPU çözme+kodlama komutu gerçek önbellek dosyasıyla (`_FIIRbzSTGU_best.mp4`, 4K AV1) çalıştırıldı: 51 sn'lik klip 10.9 sn'de bitti, ffmpeg'in kendi bildirdiği hız 4.82x.
- JS'teki argüman dizisi kurgusu (`hwaccel`/`venc`/`inputArgs` sıralaması) ayrı bir Node betiğiyle simüle edilip kanıtlanmış CLI komutuyla birebir eşleştiği doğrulandı.
- Uygulama açılışında konsola `[encoder] h264_nvenc` yazdığı teyit edildi (arka planda erken tespit çalışıyor).

## Bilinçli olarak ertelenenler

- **Arka planda kuyruk:** roadmap'in Performans bölümünde vardı ama Faz 4'teki (çoklu klip/batch) kuyruk mimarisiyle çakıştığı için oraya ertelendi — ikisini ayrı ayrı inşa etmek tekrar iş demek.
- **Anlaşılır hata mesajları:** roadmap'te "Kalite/Güvenilirlik" bölümünde kategorize edilmişti, Faz 2 kapsamına (Performans) dahil edilmedi; Faz 5'te ele alınacak.

---

# Windows Oturumu — v1.2.1 Acil Düzeltme (Faz 2 sonrası saha raporu)

v1.2.0 yayınlandıktan hemen sonra gerçek kullanıcı testinde 3 sorun bildirildi: önizleme/dalga formu açılmıyor, GPU performansı CPU'dan zayıf görünüyor, kişi takibi kapalıyken bile uygulama çöküyor.

## Kod incelemesinde bulunan gerçek açık

`renderer/app.js`'te `await window.api.download(opts)` **try/catch'siz** çağrılıyordu. Ana süreçte beklenmeyen bir istisna (GPU kodlama mimarisi eklenirken oluşmuş olabilir) IPC üzerinden reddedilirse, `setBusy(false)` hiç çalışmıyor — arayüz "İndiriliyor…" durumunda sonsuza dek donuyor. Kullanıcı bunu "uygulama çöktü" olarak yorumlamış olabilir; gerçek bir Electron process crash'i değil, arayüz kilitlenmesi.

## Uygulanan düzeltmeler (v1.2.1)

1. **`window.api.download()` ve `getWaveform()` artık try/catch'li** — herhangi bir beklenmeyen hata artık kullanıcıya görünür bir hata mesajı olarak dönüyor, arayüz donmuyor.
2. **`process.on('uncaughtException'/'unhandledRejection')`** eklendi — Node'un varsayılan davranışı (işlenmemiş hata → süreci sonlandır) artık devre dışı; hata loglanıp uygulama açık kalıyor. `reportFatal()` ile hata render sürecine de (`main-error` IPC) iletiliyor.
3. **F12 ile DevTools açma** eklendi (`before-input-event`) — paketlenmiş uygulamada terminal olmadığı için ana süreç hataları görünmezdi; artık render konsoluna da yansıyor.
4. **Önizleme yükleme hatasında bir kez otomatik yeniden deneme** — ilk `error` olayında `previewRetried` bayrağıyla `v.src` tekrar atanıyor, ikinci denemede de başarısız olursa kalıcı hata gösteriliyor. (Kök neden netleşmedi: aynı URL `curl` ile 200 dönüyor, doğru header'lara sahip — muhtemelen Chromium'un ilk medya yüklemesinde geçici bir hata.)

## Açık kalan sorular (kullanıcıdan bekleniyor)

- **Çökme gerçekten pencerenin kapanması mı, yoksa arayüzün donması mı?** (F12 → Console'da kırmızı hata var mı?)
- **"GPU zayıf" gözlemi indirme (yt-dlp, ağ bağlı) aşamasında mı yoksa kesme/dönüştürme (ffmpeg, GPU) aşamasında mı?** Ekran görüntüsü indirme aşamasındaydı (%7.2, ETA ağdan geliyor) — GPU ile ilgisi olmayabilir.

GPU kodlama şu an geri alınmadı (probe+fallback güvenlik ağı zaten var); kullanıcıdan netlik gelene kadar mimari korunuyor.

## CI: Release oluşturma yarışı (race condition) — v1.2.1'de keşfedildi

`v1.2.1` build'inde Windows işi "başarılı" (exit 0) bitti ama `TrimTube-Setup-1.2.1.exe` release'e hiç yüklenmedi. Log incelemesi: 3 platform işi paralel çalışıp hepsi `--publish always` ile **aynı anda, ilk kez** `v1.2.1` etiketi için release oluşturmaya çalışıyor — biri release'i oluştururken diğeri de aynı anda oluşturmayı deniyor, kaybeden işin varlık kontrolü/yükleme adımı sessizce (hata fırlatmadan) yarım kalabiliyor.

**Geçici çözüm (o an):** `gh api jobs/{id}/rerun` ile sadece Windows işini yeniden tetikledim — release artık var olduğu için ikinci denemede sorunsuz yükledi.

**Kalıcı çözüm:** `.github/workflows/release.yml`'e `create-release` adında ayrı bir iş eklendi; `gh release create --draft` ile etiket için release'i **matris başlamadan önce** oluşturuyor. 3 platform işi artık `needs: create-release` ile bu işten sonra başlıyor, hepsi zaten var olan release'e yükleme yapıyor — yarış durumu ortadan kalktı.

---

# Windows Oturumu — v1.2.2 (ikinci saha raporu)

v1.2.1 sonrası: dalga formu hâlâ görünmüyor (aynı, daha önce CLI'da defalarca doğrulanmış video: nM5CrkX4lzc), ve indirme/kişi takibi bitince "başlangıç işaretle" gibi bazı özellikler çalışmıyor bildirimi geldi.

## Teori: kaynak çakışması + sessiz hata

`main.js`'teki `waveform` IPC handler'ı hataları **hiç loglamadan** `null` döndürüyordu; renderer da `catch {}` ile sessizce yutuyordu — teşhis imkânsızdı. Muhtemel gerçek neden: kişi takibi (Python/CSRT/YuNet/SFace, frame-frame analiz) CPU'yu dakikalarca doyuruyor; bu sırada tetiklenen dalga formu isteği (ffmpeg spawn) kaynak açlığından 30 sn zaman aşımına takılıp `null` dönüyor, iş bitince de kimse yeniden denemiyor.

CPU'yu yapay olarak doyurup bunu doğrulamaya çalıştım ama Windows'ta `python -c` ile `multiprocessing` spawn semantiği (`__main__.burn` pickle edilemiyor) testi geçersiz kıldı — **kesin kanıtlanamadı**, ama en makul teori bu.

## Uygulanan düzeltmeler (v1.2.2)

1. `main.js > waveform`: her başarısızlık durumunda (timeout, code≠0, spawn hatası, dosya okuma hatası) artık hem `console.error` hem `win.webContents.send('main-error', ...)` ile render sürecine loglanıyor — F12 konsolunda görülebilir.
2. `renderer/app.js`: `getWaveform()` catch bloğu artık `console.error` ile hatayı yazıyor (önceden tamamen sessizdi).
3. `setBusy(false)` (ağır iş bittiğinde) çağrıldığında, dalga formu görseli hâlâ gizliyse **otomatik olarak yeniden deneniyor** — kullanıcının slider'ı elle oynatmasına gerek kalmadan kaynak-çakışması kaynaklı başarısızlıklar kendi kendine düzeliyor.

## Çözülemeyen: "işlem bittikten sonra başlangıç işaretleme çalışmıyor"

Statik kod incelemesiyle kök neden bulunamadı (`setStartBtn`/`setEndBtn` handler'ları, `setBusy`, event listener'lar gözden geçirildi — belirgin bir bug yok). En olası teori: aynı kaynak-çakışması durumu önizleme video akışının kendisini de etkileyip `$('preview').currentTime`'ın donmuş/beklenmeyen bir değer okumasına yol açıyor olabilir — ama bu da kanıtlanamadı. **Kullanıcıdan F12 konsol çıktısı ve tam tekrar adımları bekleniyor.**

---

# Windows Oturumu — v1.2.3 (kök neden bulundu)

Kullanıcının paylaştığı F12 konsol çıktısı sayesinde **kesin teşhis** kondu: `[waveform] başarısız, code: null`.

## Gerçek kök neden

"Bilgi Al" sonrası, henüz hiçbir kesim aralığı işaretlenmemişken `rangeStart`/`rangeEnd` **tüm video** süresine eşit oluyor (ekran görüntüsünde: 00:00:00 – 02:15:37). `computeZoomWindow()` bu tam aralığı baz alıp "ince ayar" penceresini de aynı şekilde tüm videoyu kapsayacak şekilde hesaplıyor, ve `requestWaveform()` bu **2+ saatlik** aralık için ffmpeg'e dalga formu üretimi emri veriyor — bu, pratikte imkânsız (ffmpeg'in saatlerce ses akışını taraması gerekir), 30 saniyelik zaman aşımına kesin takılıyor.

`code: null` ipucu önemliydi: Node'da bir alt süreç `.kill()` ile öldürüldüğünde `close` olayı `code: null` ile tetiklenir (doğal çıkış kodu değil). Bu, sürecin zaman aşımıyla/yeni bir istekle öldürüldüğünü gösteriyordu.

## Uygulanan düzeltmeler (v1.2.3)

1. **`WAVEFORM_MAX_WINDOW = 180` sn sınırı** (`renderer/app.js`): ince ayar penceresi 3 dakikayı aşarsa dalga formu hiç istenmiyor, görsel sessizce gizleniyor. Zaten bu şeridin amacı kısa bir kesimi ince ayarlamak — çok geniş bir aralıkta 900px'e sıkıştırılmış bir dalga formunun görsel değeri de yok.
2. **Yanlış pozitif hata loglaması düzeltildi**: yeni bir dalga formu isteği eskisini `.kill()` ile öldürdüğünde (normal/beklenen debounce iptali), bu artık "hata" olarak raporlanmıyor. `proc.supersededByNewer` bayrağıyla ayırt ediliyor. (v1.2.2'de eklediğim loglama, bu son derece normal durumu da hataymış gibi gösteriyordu — kullanıcının paylaştığı log aslında bu yanlış pozitifti, ama gerçek kök nedene işaret etmesi bakımından faydalı oldu.)

## "Başlangıç işaretleme çalışmıyor" sorunu

Muhtemelen ayrı bir sorun değil — kullanıcı muhtemelen bu dalga formu hatasını (ve/veya ilişkili UI davranışını) "özellik çalışmıyor" olarak yorumlamıştı. v1.2.3 sonrası tekrar test edilecek.

---

# Windows Oturumu — v1.2.4 (dalga formu akış revizyonu, kullanıcı geri bildirimi)

Kullanıcının üç maddelik geri bildirimi üzerine:

1. **Dalga formu artık önce yerel önbellekten üretiliyor** (`findCachedMedia`): video indirilmişse (`%APPDATA%/trimtube/cache/<id>_*.mp4|mp3`) ffmpeg uzak YouTube akışı yerine yerel dosyayı okuyor — ~4 sn (uzakta 10-45+ sn ve YouTube hız kısıtına açıktı). v1.2.3'te "işlem bittikten sonra zaman aşımı" logunun nedeni buydu: iş bitince otomatik yeniden deneme uzak akıştan yapılıyordu, oysa dosya zaten yereldeydi.
2. **Dalga formu yalnızca "Belirli aralığı kes" açıkken tetikleniyor** (kullanıcının akış önerisi): kesme kapalıyken ince ayar şeridi kullanılmadığı için üretim anlamsızdı. Anahtar açılınca `computeZoomWindow()` çağrılıp uygun aralıkta dalga formu geliyor.
3. **Zaman aşımı ayrıştırıldı:** yerel dosya 15 sn, uzak akış 45 sn.
4. **CSP ihlali düzeltildi:** başarı mesajındaki SVG'nin inline `style="flex:none"` özniteliği `style-src 'self'` tarafından engelleniyordu (konsola uyarı düşüyordu); `#statusMsg svg { flex:none }` CSS kuralına taşındı.

**"GPU'ya geçince dalga formu bozuldu" algısı hakkında:** GPU kod yolu (probe/encode) dalga formu üretimine mekanik olarak dokunmuyor — ayrı süreç, ayrı komut. Korelasyonun gerçek nedeni: GPU sürümleriyle eş zamanlı yapılan saha testlerinde dalga formunun bağımsız iki hatası (tüm-video isteği + uzak akış yavaşlığı) art arda ortaya çıktı.
