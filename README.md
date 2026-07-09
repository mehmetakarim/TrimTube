<p align="center">
  <img src="assets/icon.png" width="120" alt="TrimTube ikonu">
</p>

<h1 align="center">TrimTube</h1>

<p align="center">
  YouTube videolarını URL ile indirip istediğiniz aralığı kesen, Shorts için dikey formata dönüştüren ve<br>
  yapay zeka ile <b>kişiyi takip eden akıllı kadraj</b> uygulayabilen masaüstü uygulaması.
</p>

---

## Özellikler

- **URL ile indirme** — `yt-dlp` ile herhangi bir YouTube videosunu indirir; başlık, kanal, süre ve kapak görseli otomatik gelir.
- **Uygulama içi önizleme** — indirmeden önce videoyu izleyip kesim noktalarını "Bu anı başlangıç/bitiş yap" butonlarıyla veya slider ile saniyesi saniyesine seçebilirsiniz.
- **Hassas kesim** — istediğiniz aralık yerelde `ffmpeg` ile kare hassasiyetinde kesilir.
- **Kalite seçimi** — En iyi / 1080p / 720p video ya da sadece MP3 ses.
- **Dikey 9:16 (Shorts) dönüşümü** — videoyu tek tıkla 1080×1920 dikey formata kırpar.
- **🎯 Kişiyi takip eden akıllı kadraj** — dikey formata dönüştürürken kırpma penceresi sabit kalmaz; OpenCV tabanlı yüz tespiti + takip ile kişiyi sahne boyunca izler, sahne değişse bile kişiyi yeniden bulup takibe devam eder.
- **Akıllı önbellek** — aynı videodan ikinci bir klip kesmek istediğinizde video yeniden indirilmez, saniyeler içinde sonuç alırsınız.

## Nasıl çalışır

1. YouTube bağlantısını yapıştırıp **Bilgi Al**'a basın.
2. "Belirli aralığı kes" açıksa uygulama içi oynatıcıdan kesim noktalarını seçin.
3. Format olarak **Orijinal** veya **Dikey 9:16**'yı seçin; dikeyde isterseniz **Kişiyi takip et**'i açıp önizlemede kişiye tıklayarak işaretleyin.
4. Kalite ve kayıt klasörünü ayarlayıp **İndir**'e basın.

Video, `yt-dlp`'nin paralel indiricisiyle tam olarak indirilir; kesme ve dönüştürme yerelde `ffmpeg` ile yapılır. Bu sayede uzun videolarda bile indirme hızlı olur ve aynı videodan alınan ek klipler önbellekten anında kesilir.

Kişi takibi açıkken `tracker.py` (OpenCV CSRT takip + YuNet yüz tespiti + SFace yüz kimliği eşleştirme) videoyu analiz ederek kırpma penceresinin konumlarını üretir; `ffmpeg` bu verilerle dinamik `crop` uygular. Sahne kesmeleri otomatik tespit edilip takip sıfırlanır, kişi yüz kimliğiyle yeniden bulunur ve kamera hareketi titremeyi önlemek için yumuşatılır.

## Kurulum

Sistemde PATH üzerinde şunlar bulunmalı:

- [Node.js](https://nodejs.org)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — `winget install yt-dlp` (403 hatalarına karşı güncel tutun: `yt-dlp -U`)
- [ffmpeg](https://ffmpeg.org) — `winget install Gyan.FFmpeg`
- Python 3 + `pip install opencv-contrib-python` (kişi takibi özelliği için)

```bash
npm install
npm start
```

## Teknik notlar

- Kesme/dönüştürme gereken indirmelerde tam video önbelleğe alınır (`%APPDATA%/trimtube/cache`, son 2 video tutulur).
- Kesim `-ss <başlangıç> -i` + yeniden kodlama ile kare hassasiyetindedir; MP3'te yeniden kodlamasız (`-c copy`) kesilir.
- Önizleme, yt-dlp'den alınan 360p doğrudan akışla yerel `<video>` etiketinde oynar — YouTube embed kısıtlarından bağımsız çalışır.
- Kesit indirme için `yt-dlp --download-sections` denendi; uzun videolarda yavaş ve HTTP 403'e açık olduğu için terk edildi.

## Kullanılan araçlar

[Electron](https://www.electronjs.org/) · [yt-dlp](https://github.com/yt-dlp/yt-dlp) · [ffmpeg](https://ffmpeg.org) · [OpenCV](https://opencv.org/) (CSRT, YuNet, SFace)
