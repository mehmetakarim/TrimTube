# v1.23.0 — Görsel Stiller, AI Sahne Yönetmeni ve Güvenli Alan

## Yenilikler
- **Görsel stiller (tema kütüphanesi):** "Serbest üretim" kaldırıldı; videonun görünümünü bir temayla seçersin. Hazır temalar: Neon Gece, Editoryal, Teknoloji, Sıcak/Organik. Kütüphane önizlemeli bir pencerede açılır; temaları seçebilir, çoğaltabilir, düzenleyebilir ve silebilirsin.
- **Kendi temanı oluştur:** kapak/marka tasarım tarifini (prompt) yapıştır, istersen örnek bir görsel ekle; Gemini bunu temaya çevirir. Ya da elle oluştur: renkler, yazı tipleri, zemin, kart, görsel çerçevesi (bant, polaroid, HUD…), dekor motifleri (yırtık kâğıt, el çizimi ok, halftone…), hareket enerjisi, geçiş, vurgu tarzı, başlık etiketi ve logo.
- **AI Sahne Yönetmeni:** senaryo yazılırken her sahne için düzen, vurgulanacak kelime ve vurgu tarzı, görsel yerleşimi ve geçiş seçilir. Sahne kartındaki "Sahne yönetmeni" bölümünden değiştirilebilir. İsteğe bağlı **tasarım notu** yönetmene iletilir.
- **Yeni sahne tipleri:** adımlar, teknik özellikler ve karşılaştırma (VS / tablo).
- **Güvenli alan (Reels, Shorts, TikTok):** dikey videolarda yazılar, altyazı, ilerleme çubuğu ve logo platform arayüzünün kapladığı bölgelerin dışında tutulur (varsayılan açık). Önizlemede bu bölgeler isteğe bağlı gösterilir.
- **Dengeli yerleşim:** görselli sahnelerde görsel ve metin birlikte dikey ortalanır; içerik sığmazsa orantılı küçülür, kesilmez.
- **Boş kare yok:** sahnenin iskeleti (kartlar, maddeler, sayı kutuları) ilk saniyede kurulur; öğeler konuşmada anıldığı an parlar.
- **Okunurluk:** vurgu rengi yazı olarak kullanıldığında zemin, kart ve kâğıt yüzeylerinde okunur kalacak şekilde otomatik koyulaştırılır.

## Kullanım
Anlatımlı Video → Görsel stil → kütüphaneden bir tema seç ya da "Yeni tema" ile oluştur. Güvenli alan ayarı aynı sütundadır.

## Sınırlar
- Prompttan tema oluşturmak Gemini anahtarı gerektirir; sonuç düzenleyicide düzeltilebilir.
- Güvenli alan üç platformun ortak arayüz bölgelerine göredir; platformlar arayüzlerini değiştirebilir.

## Doğrulama
146 Electron arayüz, 43 gerçek medya/IPC ve 24 anlatımlı video kontrolü geçti (tema deposu, güvenli alan, sahne zamanlaması ve gerçek HyperFrames render'ı dahil). Gerçek bir Reels projesi önbellekteki seslerle yeniden render edilerek tüm sahnelerin güvenli alanda kaldığı ve boş kare oluşmadığı doğrulandı.
