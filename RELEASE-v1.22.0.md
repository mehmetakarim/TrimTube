# v1.22.0 — Ses, Müzik ve Ritim

## Yenilikler
- **Ses efektleri:** sahne geçişlerinde whoosh, konuşmayla senkron vurgu anlarında (sayaç bitişi, liste maddesi, düğme) hafif pop. Kapatılabilir.
- **Müzik altlığı:** kendi müzik dosyanı ekle; seviye ayarlanır, başta ve sonda yumuşak geçiş yapar, anlatıcı konuşurken otomatik kısılır (~14 dB).
- **Müzik bölümü:** başlangıç noktasını kaydırıcıyla seç, “Dinle” ile önizle; video müziğin o bölümünden başlar ve gerekirse döngüye girer.
- **Ritim senkronu:** müziğin temposu algılanır; sahne geçişleri vuruşa oturur, arka plan her vuruşta nabız gibi atar, başlık kelimeleri ritimle girer. Ritmi belirsiz müzikte senkron uygulanmaz ve bildirilir.
- **Kırpmasız görseller:** sahne görselleri standart 16:9 kartta tamamen görünür; farklı oranlı görsellerin boş kenarlarını görselin bulanık kopyası doldurur.
- **Yeni ekran düzeni:** Anlatımlı Video üç sütunda — ayarlar, senaryo ve sabit önizleme. Sayfa kaymaz, sütunlar kendi içinde kayar; adım göstergesi eklendi. Dar pencerede iki/tek sütuna geçer.
- Taşınmış/silinmiş görsel ve müzik dosyaları için anlaşılır uyarılar.

## Kullanım
Anlatımlı Video → Kaynak ve seçenekler → Müzik altlığı → “Müzik seç…”. Başlangıcı ve seviyeyi ayarla, “Ritme senkronize et” açık kalsın. Ses efektleri aynı bölümden açılıp kapatılır.

## Sınırlar
- Müzik dosyası kullanıcıdan alınır; uygulama müzik sağlamaz. Telif/kullanım hakkı kullanıcının sorumluluğundadır.
- Ritim algılama sabit tempolu müzik içindir; tempo değişen parçalarda geçişler yaklaşık olur.
- Sahne geçişi en fazla bir vuruş kadar gecikebilir (konuşma hiç kısalmaz).

## Doğrulama
137 Electron arayüz (1680x1000 ve 1280x800 düzen/taşma kontrolleri dahil), 43 gerçek medya/IPC ve 21 anlatımlı video kontrolü geçti; uçtan uca render testi (120 BPM müzikle vuruş hizası, müzik kısma ve efektler) paketlenmiş Windows uygulamasının içinden de çalıştırıldı. Gerçek seslendirme ve kullanıcı müziğiyle sahada denendi: sahne geçişleri vuruşa 3–15 ms içinde oturdu, müzik konuşma altında 14 dB kısıldı.
