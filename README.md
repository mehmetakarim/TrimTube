<p align="center">
  <img src="assets/icon.png" width="120" alt="TrimTube ikonu">
</p>

<h1 align="center">TrimTube</h1>

<p align="center">
  YouTube videolarını (veya yerel dosyaları) indirip istediğiniz aralığı kesen, Shorts için dikey formata dönüştüren,<br>
  yapay zeka ile <b>konuşana/kişiye kilitlenen akıllı kadraj</b> ve <b>otomatik altyazı</b> uygulayabilen masaüstü uygulaması.
</p>

---

## İndirme

En son sürümü [Releases](../../releases) sayfasından indirin:

| Platform | Dosya |
|---|---|
| Windows | `TrimTube-Setup-x.y.z.exe` |
| macOS (Apple Silicon — M1/M2/M3/M4) | `TrimTube-x.y.z-arm64.dmg` |
| Linux (Debian/Ubuntu) | `trimtube_x.y.z_amd64.deb` |

> Intel Mac (x64) derlemesi şu an otomatik release sürecinde yok — GitHub'ın Intel Mac build runner'ları kısıtlı kapasiteli olduğu için güvenilir şekilde çalıştırılamıyor. Apple 2020'den beri yalnızca Apple Silicon Mac satıyor, bu yüzden mevcut Mac kullanıcılarının büyük çoğunluğu zaten desteklenen sürümü kullanabilir.

yt-dlp ve ffmpeg pakete gömülüdür, ayrıca bir şey kurmanıza gerek yoktur.

> Uygulama henüz kod imzalı değil, bu yüzden ilk açılışta işletim sistemi bir uyarı gösterebilir:
> - **Windows:** "Windows bilgisayarınızı korudu" uyarısında **Diğer bilgiler → Yine de çalıştır**'a tıklayın.
> - **macOS:** Uygulamayı Finder'da sağ tıklayıp **Aç**'ı seçin (Gatekeeper'ın "bilinmeyen geliştirici" uyarısını atlamak için).

🎯 Kişiyi takip eden akıllı kadraj artık **kurulumsuz** çalışır — kurulum paketine platforma özel dondurulmuş bir takip motoru dahildir, Python gerektirmez. 📝 Whisper ile otomatik altyazı ise hâlâ Python 3 + `faster-whisper` gerektirir (bkz. [Kaynaktan çalıştırma](#kaynaktan-çalıştırma-geliştirici)); diğer tüm özellikler kutudan çıktığı gibi çalışır.

### Otomatik güncelleme

Uygulama açılışta GitHub Releases'teki en son sürümü sessizce kontrol eder. Yeni bir sürüm varsa **sağ üstte uygulama içi bir kart** belirir — hiçbir şey kullanıcı onayı olmadan indirilmez veya kurulmaz:

1. **"Güncelle"** butonuna basınca indirme başlar, kart üzerinde ilerleme çubuğu gösterilir.
2. İndirme bitince **"Yeniden başlat ve kur"** butonu belirir; basınca kurulum sihirbazı **görünür şekilde** açılır (sessiz kurulum değildir — bir sorun olursa fark edilebilsin diye bilinçli olarak görünür bırakıldı) ve bitince uygulama otomatik yeniden başlar.

Bu akış yalnızca **Windows**'ta güvenilir çalışır. **macOS**'ta uygulama kod imzalı olmadığı için (Apple Developer sertifikası gerektirir, ücretlidir) indirme/kurulum adımı başarısız olabilir — kart bu durumda hata mesajını gösterir, yeni sürümü Releases sayfasından elle indirmeniz gerekir. **Linux (.deb)** için otomatik güncelleme desteklenmez.

## Özellikler

- **URL ile indirme** — `yt-dlp` ile herhangi bir YouTube videosunu indirir; başlık, kanal, süre ve kapak görseli otomatik gelir.
- **Uygulama içi önizleme** — indirmeden önce videoyu izleyip kesim noktalarını "Bu anı başlangıç/bitiş yap" butonlarıyla veya slider ile saniyesi saniyesine seçebilirsiniz.
- **Hassas kesim** — istediğiniz aralık yerelde `ffmpeg` ile kare hassasiyetinde kesilir.
- **Kalite seçimi** — En iyi / 1080p / 720p video ya da sadece MP3 ses.
- **Dikey 9:16 (Shorts) dönüşümü** — videoyu tek tıkla 1080×1920 dikey formata kırpar.
- **🎯 Kişiyi takip eden akıllı kadraj** — dikey formata dönüştürürken kırpma penceresi sabit kalmaz; OpenCV tabanlı yüz tespiti + takip ile kişiyi sahne boyunca izler, sahne değişse bile kişiyi yeniden bulup takibe devam eder.
- **📝 Otomatik altyazı (Whisper)** — videoda hazır altyazı yoksa, kesitin sesi `faster-whisper` ile metne çevrilip stilli olarak gömülür. Hız/kalite dengesi için model boyutu (Hızlı / Dengeli / En iyi) seçilebilir.
- **📁 Yerel dosya desteği** — YouTube bağlantısı yerine bir video dosyasını (MP4, MKV, MOV, WEBM, M4V, AVI) pencereye sürükleyip bırakabilir ya da dosya seçiciyle açabilirsiniz; kesme, format, kişi takibi, altyazı ve marka özelliklerinin tümü aynen çalışır.
- **🎯 Kadraj yolu önizlemesi** — kişi takibi açıkken, oluşacak 9:16 kırpma penceresini render'dan **önce** ayrı bir pencerede görebilirsiniz; takip edilen kişi renkli maskeyle vurgulanır, yanında canlı 9:16 çıktı ve ses.
- **🗣️ Aktif konuşana kadraj** — sahnede birden fazla kişi varsa, o an konuşanı (ses + dudak hareketi) otomatik seçip kadrajı ona kaydırır. Röportaj/diyalog kliplerinde her konuşmacıyı ayrı ayrı işaretlemeden takip eder.
- **📚 Oynatma listesi toplu indirme** — bir playlist bağlantısı yapıştırıp açtığınızda videoları seçip toplu olarak kuyruğa alabilirsiniz.
- **⏳ Arka planda kuyruk** — kuyruk işlenirken uygulama kilitlenmez; sıradaki videoyu hazırlayıp kuyruğa eklemeye devam edebilirsiniz.
- **Akıllı önbellek** — aynı videodan ikinci bir klip kesmek istediğinizde video yeniden indirilmez, saniyeler içinde sonuç alırsınız.

## Nasıl çalışır

1. YouTube bağlantısını yapıştırıp **Bilgi Al**'a basın — ya da bir video dosyasını pencereye **sürükleyip bırakın**. (Playlist bağlantısında videoları seçip toplu kuyruğa alabilirsiniz.)
2. "Belirli aralığı kes" açıksa uygulama içi oynatıcıdan (dalga formu destekli ince ayar şeridiyle) kesim noktalarını seçin.
3. Format olarak **Orijinal / 9:16 / 1:1** (birden fazla) seçin. Dikeyde **Kişiyi takip et**'i açıp:
   - **İşaretlenen kişi** — önizlemede takip edilecek kişiye tıklayın, veya
   - **Aktif konuşan** — sahnede o an konuşana kadrajı otomatik kaydırır (işaret gerekmez).
   İsterseniz **Kadrajı önizle** ile takibi render'dan önce ayrı pencerede izleyin.
4. İsteğe bağlı: **altyazı** (YouTube'dan veya Whisper ile sesten), **logo/filigran**, **başlık metni** ekleyin.
5. Kalite ve kayıt klasörünü ayarlayıp **İndir** (veya **+ Kuyruk**) deyin. Kuyruk arka planda işlenirken yeni video hazırlamaya devam edebilirsiniz.

Video, `yt-dlp`'nin paralel indiricisiyle tam olarak indirilir; kesme ve dönüştürme yerelde `ffmpeg` ile (uygun donanımda GPU hızlandırmalı: NVENC/QuickSync/AMF/VideoToolbox) yapılır. Bu sayede uzun videolarda bile indirme hızlı olur ve aynı videodan alınan ek klipler önbellekten anında kesilir.

Kişi takibi açıkken `tracker.py` (OpenCV YuNet yüz tespiti + SFace yüz kimliği + CSRT takip) videoyu analiz ederek 9:16 kırpma penceresinin konumlarını üretir; `ffmpeg` bu verilerle dinamik `crop` uygular. Sahne kesmeleri otomatik tespit edilip takip sıfırlanır, kişi yüz kimliğiyle yeniden bulunur ve kamera hareketi titremeyi önlemek için yumuşatılır. **Aktif konuşan** modunda ise sahnedeki yüzler arasından, ses enerjisi + ağız hareketi birleşimiyle o an konuşan seçilir (histerezisle gereksiz geçişler önlenir). Yayınlanan kurulum paketlerinde bu motor PyInstaller ile platforma özel tek dosyaya **dondurulup gömülüdür**, yani son kullanıcı Python kurmaz.

## Kaynaktan çalıştırma (geliştirici)

Sistemde PATH üzerinde şunlar bulunmalı:

- [Node.js](https://nodejs.org)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — `winget install yt-dlp` (403 hatalarına karşı güncel tutun: `yt-dlp -U`)
- Python 3 + `pip install -r requirements.txt` (kaynaktan çalışırken kişi takibi için `opencv-contrib-python`, otomatik altyazı için `faster-whisper`)

ffmpeg ayrıca kurulmasına gerek yok — `ffmpeg-static` paketiyle otomatik gelir.

> **Not:** Yayınlanan kurulum paketlerinde kişi takibi motoru (`tracker.py`) PyInstaller ile platforma özel tek dosyaya dondurulup gömülür (bkz. `tracker.spec` ve CI); son kullanıcı Python kurmadan takibi kullanır. Yukarıdaki Python bağımlılıkları yalnızca **kaynaktan** çalıştıran geliştiriciler içindir. Whisper altyazısı için Python son kullanıcıda da gereklidir.

```bash
npm install
npm start
```

### Kurulum paketi üretmek

```bash
npm run build:win     # Windows .exe (Windows'ta çalıştırılmalı)
npm run build:mac     # macOS .dmg (macOS'ta çalıştırılmalı)
npm run build:linux   # Linux .deb (Linux'ta çalıştırılmalı)
```

Bu komutlar önce ilgili platform için `yt-dlp` ikilisini indirir, sonra `electron-builder` ile paketler. `v*` deseninde bir etiket (ör. `v1.0.1`) push edildiğinde [GitHub Actions](.github/workflows/release.yml) üç ayrı runner'da (Windows, Apple Silicon, Linux) paralel derleme yapıp hepsini aynı GitHub Release'e (taslak olarak) ekler.

## Teknik notlar

- Kesme/dönüştürme gereken indirmelerde tam video önbelleğe alınır (`%APPDATA%/trimtube/cache`); tutulacak video sayısı Ayarlar'dan yapılandırılır (varsayılan 2, 1–10).
- Kesim `-ss <başlangıç> -i` + yeniden kodlama ile kare hassasiyetindedir; MP3'te yeniden kodlamasız (`-c copy`) kesilir.
- Önizleme, yt-dlp'den alınan düşük çözünürlüklü (≤480p) doğrudan akışla yerel `<video>` etiketinde oynar — YouTube embed kısıtlarından bağımsız çalışır. Yerel dosyalar `file://` ile oynatılır.
- Altyazı (YouTube SRT veya Whisper), logo/filigran ve başlık metni libass/`filter_complex` ile gömülür; ayarlar ve karanlık/açık tema `userData/settings.json`'da saklanır.
- Kesit indirme için `yt-dlp --download-sections` denendi; uzun videolarda yavaş ve HTTP 403'e açık olduğu için terk edildi.

## Kullanılan araçlar

[Electron](https://www.electronjs.org/) · [electron-builder](https://www.electron.build/) · [electron-updater](https://www.electron.build/auto-update) · [yt-dlp](https://github.com/yt-dlp/yt-dlp) · [ffmpeg](https://ffmpeg.org) · [OpenCV](https://opencv.org/) (YuNet, SFace, CSRT) · [faster-whisper](https://github.com/SYSTRAN/faster-whisper) · [PyInstaller](https://pyinstaller.org/)
