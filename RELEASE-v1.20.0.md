# v1.20.0 — Metinden Kurgu ve Ortak Transkript

## Yenilikler
- Kontrol masasında altyazı satırlarını seçerek video parçalarını mevcut kurgunun sonuna ekleme.
- Tümünü seç, seçimi temizle, toplam süre; toplu eklemeyi tek adımda geri al/ileri al.
- AI ekranları ile Video Kes arasında ortak ham transkript deposu. Önceden hazırlanmış tam metinden kesit almak için tekrar Whisper çalıştırılmaz.
- Yeni tam Whisper transkriptlerinde kelime zamanlarını saklama ve kesit başlangıcına göre taşıma.
- Kaynak/model/dil ayrımı, yeni yerel kayıtlarda dosya değişikliği kontrolü ve atomik kayıt.

## Kullanım
Video Kes → Altyazı → Metni ve yerleşimi incele → Altyazı metni. İstediğiniz satırlarda “Kurguya seç”, ardından “Seçilenleri kurguya ekle” kullanın. Parçaları kurgu masasında kırpıp sıralayın. Altyazılı çıktı için metni ayrıca onaylayın.

## Sınırlar
Satır düzeyinde, tek kaynak ve en fazla 100 parça; satır aralarındaki boşluklar alınmaz. Kısmi transkript tam video yerine kullanılmaz. Kullanıcı metin düzeltmeleri projede kalır. Eşzamanlı çözümleme istekleri henüz birleştirilmez. Yayın/marka profilleri bu sürümün kapsamında değildir. Whisper için Python ve faster-whisper gereksinimi sürer.

## Doğrulama
110 Electron arayüz, 36 gerçek medya/IPC, 9 transkript deposu, 17 altyazı/kadraj, 8 kurgu ve 17 sağlayıcı kontrolü geçti. Harici AI çağrısı veya yeni Whisper modeli indirmesi yapılmadı; aktarım yerel örneklerle doğrulandı.
