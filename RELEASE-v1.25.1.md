# v1.25.1 — Podcast Senaryosu Düzeltmesi

## Düzeltmeler
- **Podcast senaryosu artık hata vermiyor:** Anlatımlı Video'da biçim Podcast seçiliyken "Metni hazırla" bazı ağlarda Gemini bağlantı hatasına düşüyordu. Uzun senaryoda model yanıt vermeden önce uzun süre düşünüyor; bu sırada veri akmayan bağlantı bazı modem veya güvenlik yazılımlarınca 60 saniyede kesiliyordu. Senaryo artık parça parça alınıyor ve bağlantı hiç boş kalmıyor.
- **İlerleme görünür:** senaryo hazırlanırken "Gemini senaryoyu planlıyor…" ve ardından yazılan karakter sayısı gösterilir.
- **Podcast uzunluğu hedefe yakın:** podcast anlatımları seçilen süreden kısa kalıyordu; kısa/orta/uzun hedefleri artık daha iyi karşılanıyor.
- **Biçim değişince uyarı:** senaryo hazırlandıktan sonra biçim (Reels/Podcast) veya podcast uzunluğu değiştirilirse uyarı ve "Metni … için yeniden hazırla" düğmesi çıkar; eski biçimin metniyle üretmeden önce onay istenir.

## Doğrulama
Gerçek Gemini ile Reels ve kısa/orta/uzun podcast senaryoları üretildi (23–65 sn). 156 Electron arayüz, 43 medya/IPC, 25 anlatımlı video ve sağlayıcı (akışlı yanıt, güvenlik engeli, yarım yanıt, bağlantı kesilmesi) testleri geçti.
