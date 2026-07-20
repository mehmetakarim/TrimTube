# TrimTube Tarayıcı Eklentisi

YouTube'da izlediğin videoyu tek tıkla TrimTube'da açar. **İzlediğin an kesim başlangıcı olarak işaretlenir** — ilginç bir yeri görünce butona basman yeterli.

## Kurulum (geliştirici modu)

Eklenti henüz Chrome Web Mağazası'nda değil; geliştirici modunda yüklenir:

1. Chrome'da `chrome://extensions` adresine git
2. Sağ üstten **Geliştirici modu**nu aç
3. **Paketlenmemiş öğe yükle**'ye tıkla
4. Bu klasörü (`extension/`) seç

Edge ve Brave gibi Chromium tabanlı tarayıcılarda da aynı adımlar geçerlidir.

## Kullanım

Bir YouTube videosu açtığında, oynatıcının altındaki eylem çubuğunda (Beğen/Paylaş yanında) **"TrimTube ile Kes"** butonu belirir. Tıkladığında:

1. TrimTube açılır (kapalıysa başlar, açıksa öne gelir)
2. Video bağlantısı yüklenir ve bilgileri otomatik çekilir
3. Videoyu izlediğin saniye, kesim başlangıcı olarak ayarlanır

## Gereksinimler

- TrimTube **v1.18.0 veya üzeri** kurulu olmalı (`trimtube://` protokol desteği bu sürümle geldi)
- Uygulama kurulu değilse butona tıklamak bir şey yapmaz; tarayıcı bağlantıyı sessizce yok sayar

## Gizlilik

Eklenti hiçbir veri toplamaz, hiçbir sunucuya istek atmaz. Yalnızca YouTube izleme sayfalarında çalışır; yaptığı tek şey butonu eklemek ve tıklandığında video kimliği ile saniye bilgisini yerel `trimtube://` bağlantısı olarak iletmektir. Bu yüzden manifest'te hiçbir özel izin (`permissions`) istenmez.

## Sorun giderme

**Buton görünmüyor:** YouTube arayüzünü zaman zaman değiştiriyor. Sayfayı yenilemeyi dene. Sorun sürerse eklenti sayfayı bozmaz, yalnızca buton eklenmez — durumu bildirebilirsin.

**Butona basınca bir şey olmuyor:** TrimTube'un kurulu ve en az bir kez açılmış olduğundan emin ol (protokol kaydı ilk açılışta yapılır). Tarayıcı "Bu bağlantıyı TrimTube ile aç?" diye sorarsa onayla.
