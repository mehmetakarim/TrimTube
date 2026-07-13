# TrimTube Geliştirme Günlüğü

Bu dosya, farklı ortamlardaki (ev: macOS M-serisi, ofis: Windows 11) geliştirme oturumlarında karşılaşılan problemleri ve uygulanan kalıcı çözümleri barındırır. Her başlık hangi ortama ait olduğunu belirtir — iki ortam arasında hafıza aktarımı bu dosya üzerinden yapılır.

---

## 📍 GÜNCEL DURUM & SIRADAKİ İŞLER (yeni oturum buradan başlasın)

**Yayındaki sürüm:** `v1.9.0` · Windows/macOS(arm64)/Linux · GitHub: mehmetakarim/TrimTube
**Yapılacaklar listesi (asıl kaynak):** proje kökündeki `YOL-HARITASI.md` (onay kutulu, faz faz).

**Tamamlanan fazlar (detayları aşağıda):**
- Faz 1 (v1.1.0) kesim deneyimi · Faz 2 (v1.2.0) GPU · Faz 3 (v1.3.0) altyazı · Faz 4 (v1.4.0) çoklu üretim · Faz 5 (v1.5.0) cila · Faz 6 (v1.6.0) marka & netlik · v1.6.1 macOS güncelleme geçişi · **Faz 7 + Faz 8 (v1.8.0) Whisper altyazı + yerel dosya & kadraj önizlemesi** · **v1.8.1 kadraj önizleme MODAL revizyonu** — YAYINLANDI

v1.8.2 (YAYINLANDI): kadraj önizleme modalında önizleme **sesi** + **tasarım tutarlılığı** (ayarlar modalıyla aynı dil).

**Faz 9 (v1.9.0) YAYINLANDI:** playlist toplu indirme + arka planda kuyruk. Kullanıcı arayüzden test edip "sorunsuz çalışıyor" onayı verdi. Böylece **ana plan (Faz 1-9) tamamen bitti.**

**Kalan fazlar (öncelik sırası):**
- **Faz 10 (araştırma):** gömülü Python/WASM ile kurulumsuz takip + konuşmacı-değişimli çoklu kişi takibi. (Yol haritasının son "büyük iş" kalemi — Faz 9 sonrası ana plan bitiyor.)
- **Bekleyen küçük iş:** Faz 6 (marka) arayüzünde kullanıcının belirteceği ufak rötuşlar (detay henüz verilmedi — sorulacak).
- **Saha testi:** kullanıcı v1.8.1 modalını onayladı; v1.8.2 (ses/tasarım) ve v1.9.0 (playlist/kuyruk) arayüzden uçtan uca test edilmedi (kod + CLI + başsız Electron testleri geçti).

**Release akışı (her faz sonu):** `package.json` sürümü artır → commit → `git tag -a vX.Y.Z` → `git push origin main && git push origin vX.Y.Z` → CI (create-release idempotent + 3 platform) → `gh` ile draft'ı doğrula → `gh api PATCH ... draft=false` ile başlık+not ekleyerek yayınla. gh yolu: `/c/Program Files/GitHub CLI/gh.exe`.

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

**Saha doğrulaması (v1.2.4):** Kullanıcı test etti — dalga formu, kesim akışı ve konsol temizliği sorunsuz onaylandı. v1.2.0 sonrası açılan saha sorunu zinciri (donma, dalga formu, CSP) bu sürümle kapandı.

---

# Windows Oturumu — Faz 3: Stilli Altyazı Gömme (v1.3.0)

Kullanıcının isteği: altyazı "bodoslama" gömülmesin, stil seçenekli şık bir görünüm olsun.

## Mimari

- **`get-info`** artık `subLangs` (manuel altyazı dilleri) ve `autoLangs` (yalnızca Türkçe ASR varyantları — tam liste yüzlerce çeviri içerir) döndürüyor.
- **Tercih sırası** (renderer `pickSubtitle`): manuel TR > herhangi bir manuel > otomatik TR. Altyazı yoksa kart devre dışı ("Bu videoda altyazı bulunamadı").
- **`fetchSubtitle`**: yt-dlp `--skip-download --write-subs --sub-langs <lang> --convert-subs srt` ile indirir, `<id>_sub_<lang>.srt` olarak önbelleğe alır (pruneCache `_sub` dosyalarını atlar).
- **`shiftSrt`**: SRT'yi kesim penceresine kaydırır — pencere dışı bloklar atılır, zamanlar klip başına sıfırlanır. Gerçek SRT ile test edildi (51 sn pencereye 28 blok).
- **3 stil** (`SUBTITLE_STYLES`, libass `force_style`): `klasik` (beyaz + ince kontur), `kutulu` (BorderStyle=4 yarı saydam koyu kutu — gömülü libass'ta çalıştığı doğrulandı), `dolgun` (Arial Black kalın, Shorts tarzı). Üçü de gerçek 1080x1920 çıktıda kare yakalanıp gözle doğrulandı; Türkçe karakterler sorunsuz.
- **Filtre zinciri**: altyazı her zaman zincirin SONUNDA (`pad`'den sonra) — konum nihai kareye göre. MarginV: dikey 55 / yatay 25 (PlayRes 288 ölçeği).
- **Yol/escape sorunu yok**: `subtitles=subs.srt` göreli adla, ffmpeg `cwd=tmpDir` ile çalışır (sendcmd'deki desenin aynısı).
- Altyazı seçiliyken `needPost=true` (gömme yeniden kodlama gerektirir); dosya adına ` [altyazılı]` eki gelir. MP3'te devre dışı.

## Doğrulama

- Uygulamanın kuracağı komutun birebiri (GPU decode+encode + dikey + kutulu stil + cwd/göreli srt) gerçek önbellek dosyasıyla çalıştırıldı: 10 sn klip 9.9x hızla sorunsuz üretildi.

---

# Windows Oturumu — v1.3.0 yayın sorunları (11 Temmuz 2026)

## 1. gh CLI token'ının bozulması
Oturum ortasında `gh auth status` "token invalid" vermeye başladı; okuma çağrıları aralıklı çalışırken yazma (POST/PATCH/DELETE) tutarlı 401 verdi. Bu durum yanlış teşhise yol açtı: draft release'ler yalnızca yazma yetkili token'la görünür — bozuk token'la yapılan listelemede v1.3.0 draft'ları "silinmiş" gibi göründü. Kullanıcı `gh auth login` ile yeniden giriş yapınca düzeldi. **Ders: gh listelerinde draft'lar eksikse önce auth'u doğrula.**

## 2. Aynı etikete çift draft
v1.3.0 run'ında aynı saniyede İKİ draft oluştu; electron-builder işleri hangisini bulduysa ona yükledi → dosyalar bölündü (5+10). Geçici çözüm: yarım draft API ile silindi, eksiksiz olan yayınlandı. Kalıcı çözüm: `create-release` işi idempotent yapıldı — draft yoksa oluşturur, birden fazlaysa ilkini tutup fazlalıkları siler.

## 3. v1.2.1 ve v1.2.2 release'lerinin kaybolması (açıklanamadı)
Yayınlanmış v1.2.1/v1.2.2 release'leri GitHub'dan silinmiş durumda (etiketler duruyor). electron-builder'ın yayınlanmış release silme davranışı bilinmiyor; büyük olasılıkla manuel temizlik. Güncel sürüm zinciri etkilenmiyor (updater yalnızca en son sürüme bakar). Kullanıcıya soruldu.

**Saha doğrulaması (v1.3.0):** Kullanıcı güncelleyip test etti — stilli altyazı gömme sorunsuz onaylandı. v1.2.1/v1.2.2 release'lerinin kaybı da açıklandı: kullanıcı manuel temizlemiş (etiketler duruyor, işlevsel etki yok). Faz 3 kapandı.

---

# Windows Oturumu — Faz 4: Çoklu Üretim (v1.4.0)

Yol haritasının "Çoklu üretim" fazı. Üç özellik:

## 1. Çoklu format (tek kesimden çoklu dosya)
- `FORMAT_DEFS` (main.js): `original` (vf yok), `vertical` (9:16, MarginV 55), `square` (1:1, MarginV 35). Her formatın kendi crop/scale/pad zinciri ve altyazı MarginV değeri.
- `download` handler artık `opts.formats` dizisi alıyor (geriye uyum: yoksa eski `vertical` bayrağından türetiliyor). Ses (mp3) tek çıktı olarak ayrıldı.
- Format döngüsü: indirme + kişi takibi (varsa) bir kez yapılır, sonra her format ayrı ffmpeg render'ıyla ayrı dosya üretir. Kişi takibi YALNIZCA 9:16'ya uygulanır (sendcmd verisi o kırpma genişliği için); 1:1 ve orijinal merkez kadraj. Takipli çıktı önceden kesilmiş tmp klipten okur, diğerleri önbellekten -ss ile.
- Dosya adı ekleri: `[9x16]`/`[9x16 takipli]`/`[1x1]`, altyazılıysa `[altyazılı]`.
- Renderer: `selectedFormats` Set'i, `.segmented.multi` çoklu seçim (en az bir seçili kalır). `formatValue` tekil değişkeni kaldırıldı.

## 2. Klip kuyruğu
- Renderer'da `queue[]` dizisi; her öğe bağımsız `opts` (kendi url/aralık/format/altyazı). "+ Kuyruk" butonu mevcut seçimi ekler, İndir butonu kuyruk doluysa "Kuyruğu indir (N)" olur.
- Ardışık işlenir; başarılı iş kuyruktan düşer (`queue.shift()`), iptal/hata kalanları kuyrukta bırakır. Önbellek sayesinde aynı videodan işlerde indirme yalnızca ilkinde.
- `buildOpts()` arayüz seçimlerinden opts kurar (hem anlık indirme hem kuyruğa ekleme kullanır).

## 3. Bölüm (chapter) önerileri
- `get-info` artık `chapters` (title/start/end) döndürüyor. Renderer'da video bölümlüyse "Bölümden seç" menüsü belirir; seçince kesme açılır, aralık bölüm sınırlarına kurulur, önizleme oraya sarar. Bölümsüz videolarda menü gizli.

## Doğrulama
- 1:1 crop filtresi gerçek render'da tam 1080x1080 üretti (nvenc+cuda).
- Bölüm çıkarımı gerçek bölümlü videoda (8jPQjjsBbIc, 4 bölüm) doğrulandı; bölümsüzde boş dizi.
- Kullanıcı arayüzden uçtan uca test etti (çoklu format + kuyruk + bölüm) — sorunsuz onayladı.

---

# Windows Oturumu — Faz 5: Cila (v1.5.0)

Yol haritasının son fazı. Ayarlar + önbellek yönetimi + karanlık mod.

## Ayarlar (kalıcı, userData/settings.json)
- electron-store bağımlılığı EKLENMEDİ; basit JSON store (`loadSettings`/`saveSettings`, tembel yükleme). Şema: theme, cacheLimit, defaultQuality, defaultFormats, lastFolder.
- IPC: `get-settings` (appVersion de ekler), `set-settings`, `cache-info`, `cache-clear`.
- Modal: Görünüm (Sistem/Açık/Koyu segment), Varsayılan kalite, Önbellek (boyut+video sayısı, Temizle, tutulacak video sayısı 1-10), sürüm notu.
- Varsayılanlar açılışta UI'a uygulanıyor (`applyDefaultsToUI`): kalite, formatlar, son klasör. Klasör değişince `lastFolder` kaydediliyor.
- `pruneCache` artık sabit 2 yerine `cacheLimit` kullanıyor.

## Karanlık mod
- `:root` token seti + `:root[data-theme="dark"]` override + `@media (prefers-color-scheme: dark) :root:not([data-theme])` fallback (JS öncesi beyaz parlamayı önler).
- 12 sabit `#fff` → `var(--surface)` (kartlar/input'lar); slider topuzları + switch knob beyaz kaldı. Sabit `#e5e5ea` track'ler → `var(--fill-hover)`, `#48484a` metin → `var(--muted)`.
- JS: `applyTheme(theme)` — 'system' ise `matchMedia` ile OS tercihi, aksi halde data-theme yazar. `darkMq` change dinleniyor.

## ÖNEMLİ: select açılır listesi (dark popup) sorunu
İki tur yanlış deneme oldu:
1. `color-scheme: dark` (:root'ta) — TEK BAŞINA YETMEDİ. Sebep: select'lerde `appearance:none` olduğu için Chromium/Electron color-scheme'i açılır listeye (option popup) uygulamıyor. Kapalı kutu koyulaştı ama açılan liste beyaz kaldı.
2. **Kesin çözüm:** `.select-wrap select option { background: var(--surface); color: var(--text); }` — option'ları doğrudan boyamak. Ayrıca `select:hover` sabit `#f7f7f9` idi (koyuda kutuyu beyaza çeviriyordu) → `var(--fill)`.
- Ders: appearance:none select'lerde koyu tema için color-scheme yetmez, option'ları elle boya + tüm hover renklerini token yap.

## Doğrulama
- Native Electron penceresi programatik görülemedi; kullanıcı görsel doğruladı (koyu tema + düzeltilmiş dropdown "çok güzel oldu").

---

# Windows Oturumu — Faz 6: Marka & Netlik (v1.6.0)

Yol haritasının kalan "kısa vadeli" üç maddesi. Üçü de gerçek ffmpeg ile doğrulandı.

## 1. Anlaşılır hata mesajları
`extractError` başına `ERROR_PATTERNS` regex tablosu: yaş kısıtı, gizli video, üye-only, kaldırılmış, bölge kısıtı, canlı/prömiyer, bot doğrulama, ağ hatası, geçersiz URL, 429. Eşleşme yoksa ham ERROR satırı. Birim test edildi.

## 2. Logo / watermark
- IPC `choose-image` (png/jpg/webp/gif).
- Filtre: `[0:v]BASE[base];[1:v]scale=-1:LOGOH[wm];[base][wm]overlay=POS[out]` + `-map [out] -map 0:a?`. Yani watermark VARSA `-vf` yerine `-filter_complex` + ikinci girdi (`-i logo`).
- LOGOH = outH*0.09, PAD = outW*0.03, 4 köşe (`watermarkOverlayExpr`).
- **KRİTİK TUZAK:** filtre grafiği değil, `-t`'nin konumu. `-ss X -i main -t Y -i logo` yazınca `-t Y` LOGO girdisine uygulanıp ana video sonuna kadar (saatlerce) okunuyor → kilitlenme + devasa dosya. Çözüm: `-t` HER ZAMAN çıktı seçeneği olarak (venc'ten sonra, target'tan önce, `durArg`). Tracked path zaten kesilmiş klipten okuduğu için `-t` yok.
- `scale2ref` denendi ve terk edildi (tek-kare görsel + çok-kareli video arasında sorun); logoyu sabit piksel yüksekliğe ölçeklemek daha sağlam.

## 3. Başlık metni
- **drawtext KULLANILMADI:** ffmpeg-static'te fontconfig yok ("Cannot load default config file"), `font=`/`fontfile=` yok sayılıp glif-eksik sistem fontuna (Windows'ta MingLiU) düşüyor → ĞİŞ, —, • tofu. `fontfile=` bu build'de honor edilmiyor.
- **Çözüm: libass** (altyazıdaki kanıtlanmış yol). `writeTitleAss` → PlayResX/Y=çıktı boyutu, FontSize=outH*0.05, MarginV=outH*0.045, Alignment=8 (üst-orta), BorderStyle=4 (yarı saydam kutu). `subtitles=title.ass` (cwd=tmpDir ile göreli). Türkçe + « » — hepsi doğru.
- **ASS tuzağı:** `[Events]` Format satırı TAM standart alan listesini içermeli (`Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`), yoksa Dialogue alan değerleri (`,0,0,0,,`) metne sızıyor.
- İndirdiğim DejaVuSans.ttf gereksiz çıktı (libass fontu kendi çözüyor), assets/fonts silindi.

## Ortak: probeDims
ffprobe pakete dahil değil; `probeDims(file)` = `ffmpeg -i file` stderr'inden `\d+x\d+` ayıklar. Orijinal format için watermark/başlık oransal ölçeği bir kez sorgulanır (vertical=1080x1920, square=1080x1080 sabit).

## Açık kalan
Kullanıcı test etti, "ufak düzeltmelere ihtiyacı var ama şimdinin konusu değil" dedi (detay verilmedi) — bir sonraki turda sorulacak. v1.6.0 bu haliyle yayınlandı.

---

# Windows Oturumu — v1.6.1: macOS güncelleme zarif geçişi

macOS'ta imzasız uygulamada oto-güncelleme kurulum aşamasında (Squirrel.Mac imza doğrulaması) başarısız oluyordu — bilinen kısıt (bkz. macOS oturumu #4). Kullanıcı onayıyla "zarif geçiş" eklendi:
- `preload`: `platform: process.platform` + `openReleasePage()`.
- `main.js`: `open-release-page` IPC → `shell.openExternal('.../releases/latest')`.
- `renderer`: `isMac` ise güncelleme kartı 'available' durumunda "Yeni sürümü indir" gösterir; tıklayınca release sayfasını tarayıcıda açar (indir→kur→imza-hatası çıkmazı yerine). Windows/Linux akışı değişmedi.
- Apple Developer ID imzalama (~99$/yıl) alternatifi kullanıcıya sunuldu, "şimdilik" tercih edilmedi.

---

# Windows Oturumu — Faz 7: Whisper Otomatik Altyazı (v1.7.0, kod hazır)

Videoda gömülü/indirilebilir altyazı yoksa, kesitin sesi `faster-whisper` ile metne çevrilip **mevcut stilli altyazı-gömme yoluna** (Faz 3) beslenir. Kutudan çıkmaz — Python 3 + `faster-whisper` gerektirir (tıpkı kişi takibi + opencv gibi).

## Mimari

- **`subtitle.py`** (yeni): `tracker.py` ile aynı çıktı sözleşmesi — `PROGRESS N` / `STATUS model|transcribe` / `DONE` / `ERROR <mesaj>` (exit 1). `WhisperModel(model, device="cpu", compute_type="int8", download_root=...)`, `transcribe(vad_filter=True, beam_size=5)`. Segmentler üzerinden SRT yazar, `info.duration` ile ilerleme. **CPU/int8 bilinçli seçim**: CUDA için ekstra cuBLAS/cuDNN DLL gerekir, dağıtımda garanti değil → güvenli taraf CPU.
- **`main.js > transcribeSubtitle(mediaFile, videoId, model, trim, clipSec, tmpDir)`** (yeni): (1) ffmpeg ile **yalnızca kesim aralığının** sesini 16kHz mono WAV'a çıkarır (tüm 2 saatlik videoyu değil — kritik: CPU whisper yavaş, sadece gerekeni çözümle). (2) `subtitle.py`'yi çalıştırır. Üretilen SRT **zaten klip başına göre (0'dan) zamanlı** → `shiftSrt` GEREKMEZ. Sonuç `${id}_sub_whisper_${model}_${startSec}_${durSec}.srt` olarak önbelleğe alınır (pruneCache `_sub` atlar).
- **`wantSubs` bloğu**: `subtitle.source === 'whisper'` ise transcribeSubtitle (hard-fail: hata → tüm iş durur, net mesaj), aksi halde eski `fetchSubtitle`+`shiftSrt` (soft-fail: altyazısız devam). Model dizini `userData/whisper-models`.
- **Renderer**: `pickSubtitle` artık altyazı hiç yoksa `{source:'whisper'}` döner (eskiden `null` → kart kapalıydı). Kart artık her videoda açık. Whisper seçilince `#subModels` (Hızlı=base / Dengeli=small(vars.) / En iyi=medium) + `#subHint` görünür. `buildOpts` whisper'da `model: subModelValue` ekler. `subtitle.source` etiketiyle YouTube/whisper ayrılır (queueBadges 'oto-altyazı').
- **Faz göstergesi**: `subtitle: 'Altyazı oluşturuluyor…'`.

## Ortam / Bağımlılık

- **Python 3.14.4** bu makinede kurulu. faster-whisper 1.2.1 + ctranslate2 4.8.1 + onnxruntime 1.27 → **cp314 tekerlekleri MEVCUT**, sorunsuz kuruldu (endişe edilen 3.14 uyumu doğrulandı). cv2 5.0.0 (contrib) aynı Python'da (tracker ile paylaşılıyor).
- `requirements.txt` (yeni) eklendi: `opencv-contrib-python` + `faster-whisper`. README güncellendi (özellik maddesi + geliştirici bağımlılığı + `pip install -r requirements.txt`).
- package.json değişmedi: `files:["**/*"]` + `asar:false` → `subtitle.py` otomatik paketlenir (tracker.py gibi).

## Doğrulama (gerçek)

- `subtitle.py` gerçek önbellek videosunun (nM5CrkX4lzc) 300-330sn aralığından çıkarılan sesle çalıştırıldı: PROGRESS akışı + DONE + exit 0, **klip-göreli** (00:00:00'dan) Türkçe SRT üretildi (`tiny` model; dil otomatik `tr` algılandı).
- **Uçtan uca gömme**: transcribeSubtitle'ın birebir yaptığı gibi — aralık sesi çıkar → subtitle.py → uygulamanın gerçek dikey+altyazı ffmpeg komutu (NVENC/cuda, cwd=tmp, göreli subs.srt, kutulu stil MarginV=55). exit 0, **1080x1920** çıktı; kare yakalandı: yarı saydam kutu + Türkçe glifler (ç/ü/ş/ı) doğru, zamanlama klip başına oturuyor.
- **App varsayılanı `small` de gerçek indirilip çalıştırıldı** (Python 3.14, exit 0): "…ne kadar güzeli yaşanmıştıklar bunlar." — `tiny`'den ("bir kadar") belirgin daha doğru, Türkçe glifler tam. Faz 3'te kanıtlanmış gömme yolu değişmedi.

## Kalan / Sıradaki

- **Kullanıcı arayüzden uçtan uca test etmedi** (native Electron programatik görülemiyor — Faz 5/6'daki gibi).
- **YAYINLANDI: Faz 8 ile birlikte v1.8.0** (kullanıcı "birlikte" dedi). CI 3 platform başarılı, gh ile yayımlandı.
- Bilinçli sınır: GPU (CUDA) whisper eklenmedi (cuDNN dağıtım riski). İleride hız için düşünülebilir. `medium` (~1.5GB) CPU'da uzun sürer — kullanıcı "En iyi"yi seçerse kısa kesit önerilir (arayüzde `#subHint` uyarısı var).

---

# Windows Oturumu — Faz 8: Kaynak & Önizleme (v1.8.0, kod hazır)

İki özellik: (1) YouTube dışı **yerel video dosyalarıyla** çalışma, (2) kişi takibinin üreteceği 9:16 kadraj penceresini **render'dan önce** önizlemede canlı gösterme.

## 1. Yerel dosya kaynağı

- **Fikir:** Yerel dosya, YouTube akışıyla AYNI boru hattından geçer — yalnızca indirme adımı atlanır. Kesme, format, kişi takibi, Whisper altyazısı, marka aynen çalışır.
- **`main.js`**: `probeMedia(file)` (ffmpeg -i stderr'inden süre+boyut — ffprobe pakette yok). `local-info` IPC: uzantı doğrula (mp4/mkv/mov/webm/m4v/avi), probe, **kararlı kimlik** `local_<md5(yol|boyut|mtime)[:12]>` (dosya değişirse kimlik değişir → dalga formu/Whisper önbelleği doğru ayrışır). `choose-video` IPC (dosya seçici). `previewUrl = pathToFileURL(file).href` (file://).
- **download handler**: `localFile = opts.localFile` varsa: `cacheFile = localFile` (indirme yok, dosya doğrudan işlenir; önbelleğe KOPYALANMAZ). needPost yoksa dosya olduğu gibi hedefe `copyFileSync`. MP3'te yerel kaynak `-vn -c:a libmp3lame -q:a 2` (yt-dlp mp3 çıktısı ise eskisi gibi `-c copy`). `waveform` handler'ı `localPath` alıyor (dalga formu doğrudan dosyadan).
- **preload**: `localInfo`, `chooseVideo`, **`pathForFile(file)` = `webUtils.getPathForFile(file)`** (Electron'da `File.path` kaldırıldı; sürükle-bırakta gerçek disk yolunu bu verir).
- **renderer**: `fetchInfo` ortak `populateFromInfo(info)`'ya bölündü; hem URL hem yerel akış onu doldurur. `currentLocalFile` durumu; buildOpts'a `localFile` eklendi. Sürükle-bırak: tam ekran `#dropOverlay`, `dragenter/over/leave` sayaçlı (dragDepth), `drop`'ta `pathForFile` ile yol → `loadLocalFile`. Toolbar'a "Yerel video aç" ikon butonu. **KRİTİK:** `dragover` mutlaka `preventDefault` (Files tipinde) yoksa `drop` hiç ateşlenmez, tarayıcı dosyaya gider.
- **CSP**: `media-src https:` → `media-src https: file:` (yerel önizleme file:// ile oynatılır). **DOĞRULANDI:** başsız Electron testiyle (uygulamanın gerçek CSP'si + varsayılan webSecurity) file:// video yüklendi (1280x720, dur 8137 okundu). Olmasaydı çözüm özel protokol (`protocol.handle` + `net.fetch(pathToFileURL)` — range/seek destekli) idi; gerekmedi.

## 2. Kadraj yolu önizlemesi (MODAL — kullanıcı geri bildirimiyle revize edildi)

**İlk sürüm ana oynatıcı üzerine maske bindiriyordu; kullanıcı "ayrı pencere + takip edilen kişiyi boyalı maske ile göster" istedi.** Yeni tasarım: ayrı **modal** pencere, iki panel — solda kaynak (takip kutusu yeşil maske + 9:16 kadraj çerçevesi + yan karartma), sağda **canlı kırpılmış 9:16 çıktı** (canvas).

- **`tracker.py`**: opsiyonel `--boxes-out FILE` eklendi → her örnekte takip edilen kişinin **normalize kutusu** (`t x y w h`, 0-1) veya `t -` (görünmüyor). `--out` (cmds.txt) formatı DEĞİŞMEDİ → render güvenli. `cur_box`/`last_box` ile izlenir (kutu varsa güncelle, yoksa son bilineni tut).
- **`main.js` `track-preview`**: 480p klip artık `-pix_fmt yuv420p -movflags +faststart` ile (tarayıcı file:// oynatması için). `--boxes-out` geçilir, boxes parse edilir. Klip **silinmez** — `trackPrevTmpDir`'de tutulur, `clipUrl = pathToFileURL(clip).href` döner. `track-preview-cleanup` IPC (modal kapanınca siler); yeni istekte üstte `cleanupTrackPrevTmp`. Dönen: `{ path, cropW, boxes, clipUrl }`.
- **renderer**: `#trackPreviewModal` (`.modal-overlay` yeniden kullanılır, tema-uyumlu). `#tpVideo` klibi file:// ile döngüde oynatır. rAF `tpDrawFrame`: sol panelde `xAt(path,t)` ile kadraj çerçevesi + yan karartma, `boxAt(boxes,t)` (basamak-tut) ile yeşil maske; sağ panelde `ctx.drawImage(video, x·vw,0, cropW·vw,vh, 0,0, canvas)` ile canlı 9:16 çıktı. Canvas tamponu `onloadedmetadata`'da `cropW·vw × vh` (net). `invalidateTrackPreview` modalı kapatır + clipUrl'ı sıfırlar (klip silinmiş olur); tetikleyiciler öncekiyle aynı (aralık/işaret/format/ses/takip + setBusy).

## Doğrulama (kadraj önizleme modalı)

- `tracker.py --boxes-out`: 12s/480p klipte cmds=150 & boxes=150 satır (eşit); cmds.txt formatı bit-bit değişmedi (render güvenli).
- `boxAt`/`xAt` gerçek veriyle: kutu zamanla doğru kayıyor (x 0.42→0.09, kişi sola gidiyor).
- **Başsız Electron**: file:// klip oynadı (854x480, t ilerledi), `drawImage`→canvas hatasız (270x480 çıktı).
- **Başsız Electron ekran görüntüsü** (t=6, gerçek klip+veri): yeşil maske takip edilen kişinin (kadın) tam üzerinde, mavi 9:16 çerçeve ona ortalı, yanlar kararmış, sağ canvas doğru kırpılmış dikey çıktıyı gösteriyor. **Görsel kanıtlandı.**
- TUZAK (test): CSP `style-src 'self'` inline `<style>`'ı engeller → test HTML'inde harici stylesheet kullanılmalı (gerçek app zaten `style.css` kullanıyor, sorun yok).

## Doğrulama (gerçek, CLI)

- `probeMedia`: önbellek mp4'ünde (AV1 1280x720, 02:15:36) süre+boyut doğru ayrıştırıldı.
- **track-preview pipeline birebir**: 300-330sn → 480p klip (854x480, exit 0) → tracker.py (DONE, exit 0) → cmds parse: **375 kayıt**, cropW=0.3162, x∈[0.406, 0.448], hepsi `[0, 1-cropW]` içinde. Overlay matematiği (leftPct=x·100, wPct=cropW·100) tutuyor.
- Yerel MP3 çıkarma (`-vn -c:a libmp3lame -q:a 2`): AV1 mp4'ten exit 0, geçerli mp3.
- Yerel video → dikey/format dönüşümü ayrıca test edilmedi ama YouTube "best" zaten AV1 → aynı kod yolu (Faz 2'de kanıtlı, probe+CPU fallback var).

## Kalan / Sıradaki

- **Görsel test (kullanıcı):** file:// önizleme oynuyor mu? Sürükle-bırak akışı, kadraj maskesi doğru mu? (native Electron programatik görülemiyor.)
- Yerel dosyada bölüm (chapter) yok, altyazı YouTube'dan gelmiyor → Whisper otomatik devreye giriyor (pickSubtitle `whisper` döner). Beklenen davranış.

---

# Windows Oturumu — Faz 9: Toplu İşleme (v1.9.0, kod hazır)

İki özellik: (1) **oynatma listesi** toplu indirme, (2) **arka planda kuyruk** (render sürerken yeni video hazırlama, arayüz kilitlenmesin).

## 1. Playlist toplu indirme

- **`main.js` `get-playlist` IPC**: `yt-dlp --flat-playlist -J` (indirmeden liste) → `{title, count, entries:[{id,title,url,duration}]}`. `ie_key==='YoutubeTab'` (alt-liste) filtrelenir. preload `getPlaylist`.
- **renderer**: `isPlaylistUrl(u)` = `list=` var **ve** `v=` yok (saf playlist; watch?v=…&list=… tekil video sayılır). `fetchInfo` başında algılanır → `loadPlaylist` → `#playlistModal` (checkbox'lı liste, "Tümünü seç", "Kuyruğa ekle (N)"). Seçilenler `buildBatchOpts(entry)` ile **tam-video** kuyruk öğesine dönüşür: global kalite/format/klasör/marka uygulanır; kesim/kişi-takip/altyazı per-video etkileşim gerektirdiği için toplu işte atlanır (`trim:null, track:false, subtitle:null`).

## 2. Arka planda kuyruk (worker modeli)

**Eski:** `downloadBtn` bloklayan bir döngü çalıştırıyor, `setBusy(true)` `addQueueBtn`'i kapatıyordu → çalışırken kuyruğa iş eklenemiyordu.
**Yeni:** `runQueueWorker()` — **canlı** kuyruktan (`while(queue.length && !stopRequested){ job=queue[0]; await download; ... }`) tek tek işler. Çalışırken eklenen işler otomatik işlenir.
- `busy` değişkeni **tamamen kaldırıldı**; yerine `queueRunning` (worker aktif) + `stopRequested`. `setBusy` → `showJobProgress`/`hideJobProgress` (yalnız ilerleme; formu kilitlemez).
- **Form kilitlenmez:** `openFileBtn`/`dragenter`/`drop`'tan `busy` guard'ları kaldırıldı → render sürerken yeni video yüklenebilir. `addQueueBtn.disabled = !infoLoaded` (çalışırken de aktif). Track preview `queueRunning` iken bloklu (GPU çakışması).
- **downloadBtn:** çalışmıyorsa "İndir"/"Kuyruğu indir (N)" → başlat (kuyruk boşsa mevcut seçimi ekle). Çalışıyorsa "Durdur" → `stopRequested=true`+`cancel()` (mevcut işi kesip worker'ı bitirir; kalan işler kuyrukta durur).
- **Hata-devam:** bir iş `ok:false` (iptal değil) → kuyruktan düşer, `failed++`, sonrakiyle devam (bir kötü video tüm batch'i durdurmasın). İptal → aktif iş kuyrukta kalır, worker durur. Sonda özet: "N tamamlandı, M başarısız/kuyrukta kaldı".
- **renderQueue:** aktif iş (queue[0], çalışırken) `.active` vurgulu + `×` (kaldır) devre dışı. `.q-title` (video başlığı, ellipsis) eklendi — playlist işlerinde hangi video olduğu görünür.

## Doğrulama (başsız Electron, gerçek renderer + sahte window.api)

- **Yükleme temiz** (JSERROR yok), `runQueueWorker` mevcut.
- **Drenaj:** 3 iş → hepsi işlendi, kuyruk boşaldı, "3 iş tamamlandı".
- **Canlı ekleme:** worker çalışırken eklenen "LIVE" işi işlendi (`calls=[A,B,LIVE]`) — arka plan kuyruğun asıl özelliği çalışıyor.
- **Hata-devam:** ilk iş fail → iki iş de çağrıldı, kuyruk boşaldı.
- **İptal-durma:** cancel → yalnız ilk iş çağrıldı, 3 iş kuyrukta kaldı, `queueRunning=false`.
- **Playlist modalı:** `getComputedStyle` ile doğrulandı — overlay `grid/z-200/fixed`, panel opak `rgb(28,29,34)`, 520px, ortalı. (Başsız `capturePage` fixed-overlay'i şeffaf yakalıyor = artefakt; ayarlar/kadraj modallarıyla aynı `.modal` iskeleti.)
- `get-playlist` mantığı `ytsearch3` ile: title + 3 entry (id/başlık/süre/url) doğru ayrıştı.

## Kalan / Sıradaki

- **Ana plan bitti** (Faz 1-9). Geriye yalnızca Faz 10 (araştırma: gömülü Python/WASM, konuşmacı-değişimli takip) kaldı.
- Playlist batch'te altyazı/kişi-takip yok (bilinçli — per-video etkileşim gerekir). İstenirse ileride "her videoya Whisper" seçeneği eklenebilir.
