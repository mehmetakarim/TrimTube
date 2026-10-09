# v1.24.0 — Arka Plan Kaldırma ve Tema Yedekleme

## Yenilikler
- **Arka plan kaldırma:** sahne görselinde "Arka planı kaldır" kutusunu işaretle; ürün ya da kişi zeminden ayrılır ve önizlemede şeffaf zeminde hemen görünür. Videoda kesik görsel kartsız, gölge ve haleyle sahneye yerleşir.
  - Yerel model (ISNet, genel amaçlı nesne ayırma) bilgisayarında çalışır; görsel hiçbir yere gönderilmez. Model ilk kullanımda bir kez indirilir (~180 MB) ve doğrulanır.
  - Bir kez kesilen görsel tekrar işlenmez; önizlemedeki kesim üretimde de kullanılır.
- **Tema dışa/içe aktarma:** kendi temalarını logolarıyla birlikte tek bir `.trimtube-theme` dosyasına kaydet; uygulamayı yeniden kurduğunda ya da başka bir bilgisayarda içe aktar. Tema kütüphanesi başlığında "İçe aktar…" ve "Tümünü dışa aktar…", özel tema kartlarında "Dışa aktar" düğmesi var.

## Kullanım
- Anlatımlı Video → sahne kartı → Görsel → görsel ekle → "Arka planı kaldır".
- Anlatımlı Video → Görsel stil → Kütüphane → "Tümünü dışa aktar…" ile temalarını yedekle.

## Sınırlar
- Arka plan kaldırma Whisper altyazısıyla aynı Python kurulumunu (faster-whisper) kullanır; ek paket gerekmez.
- Kesim kenarlarda üründen küçük parçalar alabilir; kusursuz sonuç gereken yerlerde şeffaf PNG kullan (şeffaf PNG otomatik olarak kesik görsel gibi yerleşir).
- Üzerinde yazı olan kapak/afiş görsellerinde yazılar da konu sayılır; özellik en iyi ürün ve kişi fotoğraflarında çalışır.

## Doğrulama
149 Electron arayüz, 43 gerçek medya/IPC ve 24 anlatımlı video kontrolü geçti. Tema dosyası uçtan uca denendi (logo bayt bayt geri gelir, aynı dosya ikinci kez eklenmez, yabancı dosya reddedilir). Arka plan kaldırma gerçek model indirme, doğrulama, kesim ve render ile yerelde ve sahada denendi.
