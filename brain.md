# TrimTube Geliştirme Günlüğü

Bu dosya, farklı ortamlardaki (ev: macOS M-serisi, ofis: Windows 11) geliştirme oturumlarında karşılaşılan problemleri ve uygulanan kalıcı çözümleri barındırır. Her başlık hangi ortama ait olduğunu belirtir — iki ortam arasında hafıza aktarımı bu dosya üzerinden yapılır.

---

## 📍 GÜNCEL DURUM & SIRADAKİ İŞLER (yeni oturum buradan başlasın)

**Yayındaki sürüm:** `v1.17.0` · Windows/macOS(arm64)/Linux · GitHub: mehmetakarim/TrimTube
**Yapılacaklar listesi (asıl kaynak):** proje kökündeki `YOL-HARITASI.md` (onay kutulu, faz faz).

**Tarayıcı Eklentisi Kulvarı — KOD TAMAM (20 Tem 2026), v1.18.0 adayı; saha testi bekliyor. Yol haritasındaki son teknik kulvar.**
- **Protokol altyapısı** ([main.js](main.js)): `requestSingleInstanceLock` (ÖNCEDEN YOKTU — deep-link için şart; yan fayda: uygulama artık iki kez açılmıyor) + `second-instance` (Win/Linux argv yolu) + `open-url` (macOS) + `setAsDefaultProtocolClient`. Soğuk başlatmada bağlantı `pendingDeepLink`'e kuyruklanıp `did-finish-load`'da teslim edilir (yoksa olay kaybolur).
- **GÜVENLİK — `parseDeepLink`**: deep-link GÜVENİLMEYEN girdidir (herhangi bir web sayfası `trimtube://…` açtırabilir). Yalnız `trimtube:` şeması; `v` için katı `/^[A-Za-z0-9_-]{11}$/`; alternatif `url` için host **allowlist** (youtube.com/www/m/music/youtu.be); `t` 0..86400 kelepçesi. **16 birim test** — `evil.com`, `file:///etc/passwd`, bozuk/kısa/uzun id, yanlış şema hepsi reddediliyor. Doğrulanmayan hiçbir şey yt-dlp'ye ulaşmaz.
- **Renderer**: `onDeepLink` → `switchView('cutter')` → URL doldur → `fetchInfo()` → `startSec>0` ise `trimEnable`+`startTime` (mevcut `applyProjectSettings` deseni) + toast.
- **Eklenti** (`extension/`, Manifest V3, **`permissions: []`** — sıfır izin): `content.js` YouTube eylem çubuğuna buton enjekte eder; **sıralı yedek seçiciler** (`#top-level-buttons-computed` → eski/alternatif yerleşimler), hiçbiri yoksa sessizce vazgeçer (sayfa asla bozulmaz). SPA için `yt-navigate-finish` + `MutationObserver`, çift-enjeksiyon koruması (`BTN_ID`). Tıklama → `trimtube://open?v=<id>&t=<currentTime>`. `extension/README.md`'de geliştirici modu kurulumu + gizlilik notu.
- **package.json**: root `build.protocols` (mac.protocols ile BİRLİKTE tanımlayınca Info.plist'e ÇİFT girdi düşüyor — yalnız root bırakıldı, doğrulandı: 1 girdi); `files`'a `!extension/**`.
- **UÇTAN UCA KANITLANDI** (paketli uygulama /Applications'a kurulup gerçek `open` komutuyla): (1) uygulama açıkken `open "trimtube://open?v=dQw4w9WgXcQ&t=42"` → `{"url":"…watch?v=dQw4w9WgXcQ","startSec":42}` renderer'a ulaştı; (2) **tek örnek kilidi** — açıkken 2. başlatmada süreç sayısı değişmedi; (3) **soğuk başlatma** — kapalıyken gönderilen bağlantı da ulaştı. Ayrıca Info.plist `CFBundleURLTypes` kaydı, 16 güvenlik testi, node --check, Electron duman temiz.
- **Test tekniği notu**: paketli uygulama GUI modunda stdout'u terminale bağlamıyor → doğrulama için kurulu paketteki `main.js`'e geçici `appendFileSync('/tmp/…')` izi eklendi (kaynak kod temiz kaldı, `asar:false` sayesinde rebuild gerekmedi). Aynı numara ileride deep-link/IPC teşhisinde kullanılabilir.
- Saha testinde bakılacak: Chrome'a geliştirici modunda yüklenip gerçek YouTube'da buton görünürlüğü, SPA gezinmesinde kalıcılığı, tıklayınca tam akış.

**Bakım — Kurulum boyutu küçültme: KOD TAMAM (20 Tem 2026), v1.17.1 adayı; bakım kulvarının SON kalemi.**
- **Ölçülen dağılım** (yerel macOS build, tracker'sız dmg 161 MB iken yayınlanan 259 MB → aradaki fark tracker): **tracker frozen exe ≈98 MB** (kurulumun en büyük tek parçası; içinde cv2 58 MB + SFace 37 MB) · ffmpeg 45 MB · yt-dlp 37 MB · Electron ~110 MB.
- **Yapılanlar**: (1) `build.compression: "maximum"` → **ölçülen kazanç dmg −9.5 MB (%5.9)**; zip'te etkisiz (%0.3, zaten deflate). (2) `tracker.spec` `strip=True` + excludes genişletme (`unittest, doctest, pydoc, pip, setuptools, wheel, lib2to3, sqlite3`) → yalnız −0.6 MB (macOS wheel'leri zaten strip'li) ama **eski/yeni tracker çıktıları BİREBİR AYNI** doğrulandı (gerçek yüz videosunda iki mod). (3) `files`'a `!*.md`, `!requirements.txt` → geliştirme belgeleri pakete girmiyor.
- **KRİTİK — pakette KALMASI gerekenler** (build'de tek tek doğrulandı): `subtitle.py` (Whisper `__dirname`'den spawn eder), `tracker.py` (frozen ikili bulunamazsa `resolveTracker` fallback'i — 28 KB için güvenlik ağı feda edilmedi), `assets/sfx/*.wav`.
- **Bilinçli olarak YAPILMAYANLAR (kullanıcı kararları — tekrar gündeme gelirse gerekçeler):** SFace int8 (−27 MB) → v1.16.1 kimlik katmanının hassasiyeti riske girmesin; yt-dlp'yi ilk kullanımda indirme (−35 MB) → "kutudan çıktığı gibi çalışsın"; özel minimal ffmpeg (−20-25 MB) → GPU kodlayıcı desteği + 3 platform bakım borcu; `asar: true` → asarUnpack ile dosyalar yine diske açıldığından **net kazanç ~0**, spawn riski var.
- **Gerçekçi toplam beklenti**: ~%6 (CI'da üç platformda doğrulanacak). Mütevazı ama risksiz ve kalıcı.
- **Yerel test ortamı notu**: PyInstaller `--user --break-system-packages` ile kuruldu; yüz testi için OpenCV örnek portresi (`lena.jpg`) kullanıldı — thispersondoesnotexist HTML döndürüyor, işe yaramaz.

**Bakım — yt-dlp kendini güncelleme: v1.17.0 YAYINLANDI (19 Tem 2026); saha testi paketli sürümde yapılacak (dev modda app.isPackaged kapısı nedeniyle etkisi görünmez).**
- Sorun: yt-dlp pakete gömülü ve sabit → YouTube değiştikçe eskiyip indirme son kullanıcıda kırılır (bu tür uygulamaların en sık ölüm nedeni). Apple hesabı GEREKTİRMEZ.
- **Kilit kısıt**: gömülü ikili `process.resourcesPath/bin` altında SALT-OKUNUR (macOS imzalı bundle / Win Program Files / Linux kök). yt-dlp `--update-to` kendini yerinde değiştirir → ikili yazılabilir `userData/bin`'e kopyalanıp oradan çalıştırılır (`ensureYtdlpWritable`, whenReady'de; `YTDLP` artık `let`).
- **Downgrade koruması**: kopya varsa gömülü vs kopya `--version` (tarih-string) karşılaştırılır; gömülü yeniyse (app güncellemesi taze ikili getirmiş olabilir) adopt edilir — asla eskiye düşmez.
- **Motor**: `runYtdlpUpdate` → `spawn(YTDLP, ['--ignore-config','--update-to','stable@latest'])`, kendi proc'u (paylaşılan currentProc'a DOKUNMAZ), 60 sn timeout. **`--ignore-config` ZORUNLU** — kullanıcının global yt-dlp config'i eski ikiliye tanımadığı bayrak (`--js-runtimes` vb.) enjekte edip çökertiyor (self-update testinde canlı yaşandı ve çözüldü).
- **Auto**: günde bir (24h throttle, `ytdlpLastCheck`), açılışta 12 sn gecikmeli, arka planda, SESSİZ (bildirim yok). `app.isPackaged` kapısı — dev'de sistem yt-dlp'sine dokunulmaz.
- **UI**: Ayarlar'da "İndirme motoru" satırı (`ytdlpInfo` sürüm + son kontrol, `ytdlpUpdateBtn` "Şimdi güncelle"); elle güncellemede toast ("X'e güncellendi" / "zaten güncel"). IPC: `ytdlp-info`/`ytdlp-update`.
- **Çıktı ayrıştırma**: `Updated yt-dlp to stable@<VER>` (güncellendi) / `is up to date (stable@<VER>` (güncel).
- **Doğrulanan**: GERÇEK self-update kanıtı — 2025.09.26 standalone ikilisi indirilip `--ignore-config --update-to stable@latest` ile 2026.07.04'e kendini yazılabilir dizinde değiştirdi; ikinci çağrı "up to date" döndü. `ensureYtdlpWritable` 6 dal birim testi (seed/koruma/adopt/gömülü-yok), ayrıştırma+throttle 8 test, sürüm regex gerçek yt-dlp'de, node --check üçlü, Electron duman (dev kapısı atlanıyor, hata yok), id/IPC eşleşme — hepsi temiz.
- Saha testinde bakılacak: paketli sürümde ilk açılışta userData kopyasının seed'lendiği; "Şimdi güncelle" düğmesinin sürümü tazelediği; gerçek indirmenin yazılabilir kopyayla çalıştığı.

**Faz 16 cilası — Konuşmacı modunda yüz imzası: v1.16.1 YAYINLANDI ve SAHA TESTİNDEN GEÇTİ ("daha iyi" — macOS, 18 Tem 2026). İkinci plan döneminin TÜM kalemleri kapandı.**
- Keşif: tek-kişi modu SFace imzasını Faz 10'dan beri kullanıyordu; **konuşmacı modu kullanmıyordu** (izler yalnız en-yakın-merkez). Eklenen kimlik katmanı (yalnız `tracker.py`; SFace zaten pakette, spec/CI/boyut değişmedi):
  - **Kalıcı kimlik kaydı** (`identities`, sahne kesmesinde SIFIRLANMAZ): `assign_identity`/`match_identity`/`identity_seen` — eşik `MATCH_THRESHOLD`, güçlü eşleşmede feat biriktirme (`IDENTITY_STRONG=0.45`), tavan `MAX_IDENTITIES=8` (dolunca en eski geri dönüştürülür, **id değişir** ki eski izler yanlış eşleşmesin).
  - **Takas onarımı**: `REVALIDATE_EVERY`'de görünür izlerin kimlikleri tazelenir; aktif izin kimliği `active_identity`'den saparsa kadraj aynı kimlikli ize geri bağlanır (sahnede yoksa izlenene kilitlenir — boş kadrajdan iyidir).
  - **Olgun-kimlik kapısı**: kadraj çalmak isteyen aday `MATURE_SEEN=3` kimlikli görünme olgunluğuna sahip değilse `SWITCH_HOLD` iki katına çıkar.
  - **Aynı konuşana dönüş**: grace içinde/sonrasında ve sahne kesmesi sonrası ilk seçimde önce `active_identity` aranır.
  - SFace yoksa (`engine.rec is None`) katman tamamen devre dışı — davranış birebir eski hali (`use_ident` bayrağı).
- Doğrulama: gerçek fonksiyonlarla 7 birim test (sahte engine — yeni kimlik/eşleme/olgunluk/tavan geri dönüşümü/None yolu/eşik) GEÇTİ; yüzsüz sentetik videoda iki mod uçtan uca temiz (DONE + merkez kadraj sözleşmesi); `py_compile` temiz.
- Saha testinde bakılacak: çok kişili gerçek görüntüde "Aktif konuşan" — kimlik takası, kaybolup dönüş, kadraj çalma senaryoları; gerekirse `MATURE_SEEN` ince ayarı (Faz 10-A geleneği).

**Faz 16-B — İleri Kurgu II (B-Roll + J-cut + Moodlar stilleri): v1.16.0 OLARAK 16-A İLE BİRLİKTE YAYINLANDI (18 Tem 2026; kullanıcı kararı — otomatik testlerin tamamı geçti, saha testi yayın sonrası).**
- **B-Roll** (yeni ekran, sol nav 7. öğe): `broll-analyze` — `ensureTranscript`(paylaşılan önbellek, kendi `runBrollProc` runner'ı) → Gemini "5-8 görsel an" (TR keyword + EN stok sorgusu + saniye; ≥6 sn aralık zorlanır) → `pexelsSearch` (fetch, `Authorization: key`, ≤1080p mp4 + `image` thumb; hatalar Türkçe `pexelsErrorMessage`). `broll-render` — seçilenler fetch ile tmp'e indirilir (başarısız atlanır), overlay grafiği: klip `scale=W:H:force_original_aspect_ratio=increase,crop,fps=30,setpts=PTS+T/TB` → zincirleme `overlay=enable='between(t,T,T+2.5)':eof_action=pass`; ses `0:a` aynen. Ayarlar'a `pexelsKey` + "Ücretsiz anahtar al" (pexels.com/api). Kendi proc/abort (`brollAbort` fetch iptali dahil — mood deseninin aynısı).
- **J-cut (deneysel)**: `smarttrim-apply`'da `jcut` — video/ses concat'ları ayrıştı (v=1:a=0 + v=0:a=1; bu ayrışma J-cut kapalıyken de eşdeğer). Birleşim j'de ses sınırları `−lead` kaydırılır (lead=0.35; komşu segment <1.2 sn ise 0); toplam süre/senkron matematiksel korunur. SFX zinciri `[outa]` üzerinde değişmeden çalışır.
- **Moodlar stilleri**: mood-render altyazı dalında animasyonlu stil → `buildSceneSrt` çıktısı `srtToWords`'e (orantısal), `writeKaraokeAss(..., 66, 'anim_mood.ass')` (66 = MOOD_SUB_MARGINS MarginV'si), `subFilter='subtitles=anim_mood.ass'`.
- **Otomatik doğrulama (yayın öncesi tamamlandı):** `node --check` üçlüsü temiz; DOM id + IPC kanal eşleşmesi script'le sıfır eksik; **B-roll overlay** piksel-doğrulandı (t=5s saf kırmızı b-roll, t=13s yeşil, dışında özgün desen; süre korunur); **J-cut spektral test** — 880Hz enerjisi lead penceresi öncesi -48.7dB, içinde -5.3dB (sonraki sahnenin sesi görüntüden 0.35 sn önce), toplam süre birebir (20.87s); Electron duman temiz.
- Saha testinde bakılacak: gerçek Pexels anahtarıyla öneri kalitesi + indirme; J-cut kulak testi (0.35 sn lead doğal mı); Moodlar'da animasyonlu stil çıktısı; B-roll geçişlerinin içerikle uyumu.

**Faz 16-A — İleri Kurgu I (Animasyonlu Altyazı + Geçiş SFX): KOD TAMAM (macOS, 17 Tem 2026), saha doğrulaması bekliyor (v1.16.0 adayı). Kapsam kararı: B-Roll + J/L-cut + Moodlar'a stil taşıma → 16-B.**
- **Animasyonlu altyazı**: `subStyles`'a iki stil — `vurgulu` (grup ekranda, aktif kelime sarı `&H00E5FF` + `\t` ile %112 büyüme; kelime başına bir Dialogue olayı) ve `pop` (kelime tek başına, `\fscx55→100` pop girişi). Üretim `writeKaraokeAss(dir, words, style, dims, marginV288, fname)` — PlayRes=çıktı boyutu, MarginV format değerinden (288 ölçeği) gerçek yüksekliğe ölçeklenir; format başına `anim_<fmt>.ass` üretilip `subtitles=` ile gömülür (force_style YOK). Gruplama `groupWords`: ≤4 kelime, ≤2.5sn, >1.2sn boşluk yeni grup.
- **Kelime kaynağı**: Whisper'da `transcribeSubtitle(..., wantWords)` → `subtitle.py --words-out` (Faz 13 altyapısı), `<id>_sub_whisperwords_<model>_<rangeKey>.json` önbelleği (SRT önbelleği var ama kelime yoksa whisper bir kez yeniden çalışır); YouTube'da `srtToWords` — blok süresi kelimelere uzunluk-orantılı (ağırlık=harf+2). Arayüzde `#subAnimHint` tahmini-senkron notu.
- **Geçiş SFX**: `assets/sfx/whoosh.wav`(280ms)/`pop.wav`(130ms) — ffmpeg sentezi (anoisesrc/sine), `loudnorm I=-16:TP=-3` ile tepe -3dB (İLK sürüm -45dB çıkmıştı — duyulmuyordu, normalizasyon şart). `smarttrim-apply`'a `sfx` parametresi: **asar tuzağı** — ffmpeg asar içini okuyamaz, dosya tmp'e `fs.copyFileSync` ile kopyalanıp göreli 'sfx.wav' verilir (Electron fs asar'ı okur). Zincir: `[1:a]aformat=48000:stereo,asplit=N` → `adelay=<joinMs>:all=1,volume=0.5` → `amix=inputs=N+1:duration=first:normalize=0`. >60 birleşimde atlanır. Akıllı Kırpma'da `#stSfxSeg` (Kapalı/Whoosh/Pop).
- **Doğrulanan**: her iki stilin 1080×1920 kare render'ı gözle (aktif kelime sarı+büyük, Türkçe glifler doğru); orantısal bölücü birim testi (blok sınırları korunur); SFX uçtan uca — birleşimlerde -9dB tepe, sessiz bölgede -91dB; asplit=1 uç durumu; Electron duman + DOM id eşleşmesi temiz.
- Saha testinde bakılacak: gerçek videoda iki stilin görünümü/okunabilirliği, YouTube-altyazılı videoda tahmini senkron kabul edilebilirliği, SFX seviyesi kulak testi, Whisper kelime önbelleğinin ikinci kullanımda devreye girdiği.

**⏭ DEVİR NOTU (17 Tem 2026, Windows → ev/macOS):** Faz 15 kapandı. macOS oturumunda dikkat: (1) **API anahtarları makine-yerel** (settings.json) — Gemini/ElevenLabs anahtarlarını Mac'te Ayarlar'a yeniden girmek gerekir; (2) transkript/`_ai_` önbelleği de makine-yerel, ilk kullanımda yeniden üretilir; (3) faster-whisper Mac'e Faz 13 oturumunda `--break-system-packages` ile kurulmuştu (bkz. aşağıdaki macOS notu) — çalışır durumda olmalı.

**Tamamlanan fazlar (detayları aşağıda):**
- Faz 1 (v1.1.0) kesim deneyimi · Faz 2 (v1.2.0) GPU · Faz 3 (v1.3.0) altyazı · Faz 4 (v1.4.0) çoklu üretim · Faz 5 (v1.5.0) cila · Faz 6 (v1.6.0) marka & netlik · v1.6.1 macOS güncelleme geçişi · **Faz 7 + Faz 8 (v1.8.0) Whisper altyazı + yerel dosya & kadraj önizlemesi** · **v1.8.1 kadraj önizleme MODAL revizyonu** — YAYINLANDI

v1.8.2 (YAYINLANDI): kadraj önizleme modalında önizleme **sesi** + **tasarım tutarlılığı** (ayarlar modalıyla aynı dil).

**Faz 9 (v1.9.0) YAYINLANDI:** playlist toplu indirme + arka planda kuyruk.

**Faz 10-A (v1.10.0) YAYINLANDI:** konuşmacı-değişimli takip (aktif konuşana kadraj). Kullanıcı "mükemmel sonuç" dedi; ince ayar sonrası yayınlandı.

**Faz 10-B (v1.11.0) YAYINLANDI:** kurulumsuz takip (PyInstaller). `tracker.py` platforma özel tek dosyaya dondurulup pakete gömüldü → son kullanıcı Python kurmadan takibi kullanır. **CI 3 platformda da (Win/mac-arm64/Linux) freeze + build başarılı** (en büyük risk olan mac/Linux freeze sorunsuz geçti). Kurulum boyutları: Win 233MB / macOS 259MB / Linux 270MB. **Yol haritasının ana planı (Faz 1–10) tamamen tamamlandı.**

**Faz 6 marka arayüzü rötuşları (v1.10.1) YAYINLANDI:** (1) "İndirme tamamlandı · Klasörü aç" kalıcı satır yerine **yüzer toast** — indirme bildirimi `sticky` (yalnız ✕ ile kapanır, kullanıcı isteğiyle 8s otomatik-kapanma kaldırıldı); kısa bilgi mesajları (playlist) otomatik kapanır. (2) Sağ panel boşluk düzeni: **KRİTİK bulgu** — Logo/filigran + Başlık kartları arasındaki `style="margin-top:10px"` inline'ı **CSP `style-src 'self'` tarafından engellenmiş** → yapışıktı. brandCard `.brand-unit` sarmalayıcılarıyla yeniden yapılandırıldı (birimler arası 16px, birim içi 10px). Kullanıcı "kusursuz" dedi. **Ders: inline `style=` her zaman CSP'ye takılır — daima CSS sınıfı kullan.**

**İKİNCİ PLAN DÖNEMİ (15 Tem 2026):** Kullanıcının 16 maddelik özellik notları + saha/kod analizi birleştirilerek Faz 11–16 + kulvarlar `YOL-HARITASI.md`'ye yazıldı (öncelik mantığı ve kapsam kararları orada). Önemli kararlar: Content ID simülasyonu yapılamaz → "reklam dostu" uyarısına daraltıldı; **macOS notarization KAPSAM DIŞI (19 Tem 2026 kullanıcı kararı — "gerek yok")**: sonuçları kabul edildi, macOS'ta `xattr -cr` gereği ve uygulama içi oto-güncellemenin çalışmaması kalıcı; tarayıcı eklentisi `extension/` klasöründe ayrı kulvar.

**Faz 11 — Sıkıştırma + sol navigasyon: TAMAMLANDI, macOS saha testinden geçti ("harika çalışıyor"). Kullanıcı kararı: v1.12.0 YAYINI FAZ 12 İLE BİRLİKTE yapılacak — şimdilik yalnızca yerel commit, tag/release YOK (CI yalnız v* tag'inde tetiklenir, main push'u güvenli).**
- Sorun: render, donanım kodlayıcıyla (NVENC/VideoToolbox) CQ~20 ve **bitrate tavansız** → 1080p'de ~16 Mbps, 3 dk ≈ 350MB. Render kalitesine DOKUNULMADI (kullanıcı şartı); ayrı "Sıkıştır" modalı eklendi.
- Mimari: `main.js` sonunda `compress-video`/`compress-cancel` IPC + `runCompressProc` (kendi proc/iptal — `currentProc`'tan bağımsız, kuyrukla eşzamanlı çalışır); ilerleme ayrı `compress-progress` kanalından. İki mod: **quality** (libx264 slow CRF 18, ses copy; HEVC'de libx265 medium CRF 20 + `-tag:v hvc1`) ve **size** (two-pass, video bitrate = targetMB bütçesi − ses; x264 `-pass/-passlogfile`, x265 `-x265-params pass=N:stats=…` — log dosyaları GÖRELİ adla `cwd=tmpDir`'de: boşluklu yollarda x265-params ayrışma tuzağına karşı).
- Doğrulanan: ffmpeg-static libx265 içeriyor (3 platform aynı build ailesi); two-pass 5MB hedef → 5.02MB (±%0.5); 16 Mbps sentetik kaynakta CRF 18 → %50 küçülme (gerçek çekimde daha fazla beklenir). **Uç durum:** kaynak zaten verimliyse CRF 18 çıktıyı BÜYÜTEBİLİR — arayüz "kaynak zaten verimli" mesajıyla karşılıyor.
- UI: üst çubukta yeni düğme → `compressModal` (ayarlar modalı diliyle); sürükle-bırak modal açıkken ana boru hattı yerine modala yönlenir; indirme-tamamlandı toast'ına ikinci eylem ("Sıkıştır", `toastAction2`) eklendi — `download` IPC'si artık `files:[…]` döndürüyor.
- Saha testinde bakılacak: gerçek 350MB klipte küçülme oranı + gözle A/B; Durdur'un yarım dosyayı sildiği; kuyruk çalışırken ilerleme kanallarının karışmadığı.

**Faz 13 — Kurgu Motoru (Akıllı Kırpma): v1.13.0 YAYINLANDI ve SAHA TESTİNDEN GEÇTİ (macOS: "her şey yolunda" · Windows: "kusursuz" — 16 Tem 2026). Faz 14'e başlandı.**
- Whisper kelime zaman damgaları (`subtitle.py --words-out` — SRT davranışı değişmedi, geriye uyumlu) → sessizlik (eşik: Sıkı 0.4 / Dengeli 0.7 / Gevşek 1.2 sn) + dolgu kelime (`FILLER_WORDS`: yalnız "ıı/eee/hmm" gibi temiz sesler; "yani/şey/işte" bilinçli hariç) adayları → onay kutulu liste → `trim/atrim/concat` filter_complex ile tek geçişte kırpma (`smarttrim-analyze/apply/cancel` IPC; kendi proc/iptal, GPU→CPU düşüşü kendi süreç takibiyle tekrarlandı — `runEncodeWithFallback` KULLANILMADI çünkü paylaşılan `currentProc`'a bağlanıyor).
- **Bu concat zinciri Faz 15 (Moodlar) ve Faz 16'nın (J/L-cut) montaj altyapısının ilk hali.**
- Doğrulanan: concat zinciri 3 segmentte kare-hassas (30sn→20.87sn beklenen 20.85); `say` ile üretilen konuşmada her iki enjekte sessizlik yakalandı (10sn→5.6sn); dolgu normalizasyonu ("eee," → eşleşir, "yani" → eşleşmez); Electron duman + 156 DOM id eşleşmesi temiz.
- Guard'lar: keep<0.12s komşuya katılır; keep boşsa/>200 segmentse açıklayıcı hata; iptal yarım dosyayı siler.
- **macOS dev ortam sorunu (bu oturumda çözüldü):** Akıllı Kırpma "faster-whisper kurulu degil" hatası verdi — Homebrew Python 3.14.5'te paket yoktu (Faz 7 Whisper altyazı da aynı pakete bağlı, bu Mac'te hiç kurulmamış). Çözüm: `python3 -m pip install --user --break-system-packages faster-whisper` (PEP 668/externally-managed nedeniyle düz `pip install` reddediliyor; cp314 arm64 wheel'leri mevcut, sorunsuz kuruldu).

**Faz 14 — AI Altyapısı ve İlk Meyveler: v1.14.0 — SAHA TESTİNDEN GEÇTİ ("testler başarılı", Windows, 16 Tem 2026) ve YAYINLANDI.**
- Yeni **"AI Araçları" ekranı** (sol nav 5. öğe): dört araç ortak bir transkript üzerinde — (1) **Başlık**: 3 Shorts başlığı + açıklama + hashtag, satır satır/tümünü panoya kopyala; (2) **Konu Ara** (semantik): eşleşmeler "Aralığı uygula" ile kesim aralığına yazılıp Video Kes'e döner; (3) **Hook Bul**: transkript + ses enerjisi, 0-100 puanlı en iyi 5 an; (4) **Reklam**: küfür/hassas konu taraması, verdict uygun/sınırlı/riskli + bulgu listesi (Content ID bilinçli kapsam dışı).
- **Gemini main süreçte** (`geminiGenerate`): renderer CSP (`default-src 'self'`) dışa isteği zaten yasaklıyor. Model tek sabitte: `GEMINI_MODEL='gemini-2.5-flash'`. `responseMimeType: application/json` + çit temizleme; 120 sn AbortController; HTTP hataları Türkçeye çevrilir (`geminiErrorMessage`: 400 anahtar geçersiz, 429 kota, 5xx hizmet).
- **Anahtarlar Ayarlar'da** (`geminiKey`, `elevenKey` — ElevenLabs Faz 15 hazırlığı): parola alanı, yalnız settings.json'da yerelde; "Doğrula" → `ai-test-key` (modele GET, üretim maliyeti yok); "Ücretsiz anahtar al" → aistudio.google.com/apikey (shell.openExternal). Transkript hazırlama anahtarsız da çalışır.
- **Transkript** (`ai-transcript`): YouTube altyazısı varsa hızlı yol — `fetchSubtitle`'a `runner` parametresi eklendi (AI kendi `runAiProc`'unu geçirir; paylaşılan `currentProc`'a bağlanmama deseni burada da korundu). Yoksa Whisper: yerel dosya > önbellek videosu > `-f bestaudio` ile `<id>_ai_audio.m4a` indirmesi → 16k WAV → subtitle.py (SRT → segment parse; ASR'ın birebir yinelenen blokları birleştirilir). Sonuç `<id>_ai_transcript_*.json`; **`_ai_` içeren dosyalar pruneCache'ten muaf** (not: uzun videoların _ai_audio dosyaları ancak "Önbelleği temizle" ile gider).
- **Ses enerjisi** (`computeEnergyProfile`): `asetnsamples=16000,astats reset=1` → saniye başına RMS dB (stdout, `pts_time` eşleşmesi; -inf→-90) → videonun kendi dağılımına göre görece üçte birlik eşiklerle düşük/orta/yüksek etiketi → hook prompt'una satır başına eklenir. Yerel medya yoksa (YouTube+altyazı yolu) enerji atlanır, arayüzde not düşülür.
- **Doğrulama:** node --check 3 dosya; 220 HTML id + `window.api` + IPC kanal eşleşmesi script'le sıfır eksik; CDP duman testi (5 nav öğesi, ekran geçişleri, anahtar uyarısı, Esc dönüşü, konsol temiz); **uçtan uca gerçek IPC testi** — System.Speech TTS'ten üretilen 12 sn videoda whisper transkript 11.5 sn/4 segment, ikinci çağrı önbellekten, `ai-hooks`'ta enerji aşaması çalışıp anahtarsız Gemini doğru Türkçe hatayla döndü, boş aralık hatası doğru.
- **Saha testinde bakılacak:** gerçek Gemini anahtarıyla dört aracın çıktı kalitesi (özellikle Türkçe başlıklar ve arama isabeti); YouTube altyazılı videoda hızlı yol; uzun videoda (1 saat+) whisper süresi/iptali; "Aralığı uygula" akışı; 429 kota davranışı.

**Faz 15 — Moodlar & AI Director (zirve özellik): v1.15.0 — SAHA TESTİNDEN GEÇTİ ve YAYINLANDI (17 Tem 2026). Üç saha geri bildirimi turu yayın öncesi işlendi (aşağıda). Google TTS (`gemini-2.5-flash-preview-tts`) gerçek anahtarla sahada doğrulandı ("çalışıyor") — model adı geçerli, boru hattı uçtan uca sağlam.**
- Yeni **"Moodlar" ekranı** (sol nav 6. öğe): kaynak → mood (Komedi/Dram/Gerilim/Duygusal/Özet, `MOODS` ton tarifleri) + hedef süre (30/60/90) + anlatıcı sesi → **"Kurgu planı oluştur"** (transkript + Gemini; plan ekranda sahne listesi olarak önizlenir) → **"Seslendir ve Montajla"** (ElevenLabs TTS + montaj). Yol haritasındaki "Faz 9 kuyruğunda" fikri yerine bilinçli olarak bağımsız-ekran deseni: kendi `mood-progress` kanalı, `runMoodProc`/`moodAbort` iptali; kuyrukla eşzamanlı çalışır.
- **Revizyon turu (3. saha geri bildirimi, yayın öncesi):** (1) **Tam susturma** — anlatım çalarken özgün ses 0.22 yerine `volume=0` (kısık arka plan gürültü gibi duyuluyordu). (2) **Google TTS** — `GEMINI_TTS_MODEL='gemini-2.5-flash-preview-tts'` üzerinden, kullanıcının MEVCUT Gemini anahtarıyla (ek üyelik yok; saha: "herkesin ElevenLabs üyeliği olmayabilir"); yanıt ham PCM (audio/L16, rate mime'dan) → ffmpeg ile MP3 — boru hattı ElevenLabs'la birebir aynı kalır. Sağlayıcı segmenti (Google varsayılan) + sabit `GEMINI_VOICES` listesi (8 ses, TR etiketli); tercih `moodTtsProvider`/`moodVoiceGemini`. (3) **Altyazı gömme** — `mdSubCheck` + stil segmenti; plan transkripti önbellekten geri yüklenip (`trans` parametresi) `buildSceneSrt` ile sahne-kaydırmalı SRT üretilir, concat SONRASI `subtitles=` filtresiyle gömülür; kenar boşlukları `MOOD_SUB_MARGINS` (MarginV=66, MarginL/R=64 — TikTok/Shorts/Reels güvenli alan KESİŞİMİ, Safe Zone şablon ölçüleriyle uyumlu); transkript alınamazsa montaj altyazısız sürer (süs katmanı). (4) **"Videoyu Düzenle"** — üretilen kurgu `loadLocalFile` ile Video Kes'e yüklenir, ince ayar orada sürer. CDP + gerçek render doğrulaması: altyazılı montaj üretildi, düzenle akışı cutter'a taşıdı, Google TTS anahtarsız doğru hata.
- **Altyazı indirme sağlamlaştırması (2. saha bulgusu — dEo-Nacb3Ko vakası):** kullanıcı "YouTube altyazısı indirilemedi" gördü ama aynı komut CLI'da ve CDP'de sorunsuzdu → neden büyük olasılıkla otomatik altyazı uçlarının geçici 429'u; asıl kusur `fetchSubtitle`'ın yt-dlp çıkış kodunu/stderr'i YUTMASI ve tek denemede pes etmesiydi. Düzeltme: `fetchSubtitle` artık `{path}|{error}` döndürür (gerçek neden `extractError` ile Türkçeleşir); `ensureTranscript` istenen dil + alternatif varyantları (`altLangs`, ör. tr-orig ↔ tr — renderer `subAltLangs()` gönderir) iki tur dener; hepsi başarısızsa **Whisper'a otomatik düşer** (aşama etiketleri geçişi gösterir, neden F12 konsoluna düşer). Ayrıca YouTube transkripti istenirken mevcut bir Whisper transkript önbelleği de kabul edilir; önbellek yazımı üretilen gerçek kaynağın anahtarına yapılır. CDP doğrulaması: önbellek isabeti anında; geçersiz altyazı + yerel dosyada subdl→audio→model→transcribe düşüş zinciri çalıştı.
- **Kaynak modu (ilk saha geri bildirimi üzerine eklendi):** açık dosya > Video Kes'te yüklü kaynak > bırakma alanı. Yüklü **YouTube kaynağında transkript, altyazı varsa Whisper'a hiç girmeden YouTube altyazısından** gelir (`ensureTranscript` — ai-transcript ile aynı ortak gövde ve önbellek; `mood-plan`/`ai-transcript` birbirinin transkriptini anında kullanır). Montajda medya çözümü: yerel dosya > önbellekteki tam video (`findCachedVideo`, yalnız .mp4 — `_ai_audio` ses dosyası montaja yetmez) > tam videoyu `_best.mp4` olarak önbelleğe indir (stage `fetch`; sonraki denemeler ve kesim işleri aynı dosyayı kullanır). Çıktı yeri: dosya modunda kaynağın yanı, YouTube modunda kayıt klasörü (`outDir`/`baseName` renderer'dan). Video Kes'e yeni video yüklenince Moodlar'daki eski plan geçersiz kılınır (`mdCutterSourceChanged`); render, planın üretildiği bağlamı kullanır (`mdPlanContext`).
- **Yeniden düzenleme (Faz 14 kodunda):** `geminiGenerate` → `geminiRequest(prompt, temp, setAbort, isCancelled)` — AI araçları ve Moodlar kendi iptal denetleyicisini kaydeder, biri diğerinin isteğini iptal edemez. Whisper adımı `whisperSegments(media, model, tmpDir, runner, sendStage, isCancelled)` yardımcısına çıkarıldı; `ai-transcript` ve `mood-plan` aynı gövdeyi ve **aynı transkript önbelleğini** (`<id>_ai_transcript_<model>.json`) paylaşır.
- **Plan** (`mood-plan`): Gemini prompt'unda "yalnızca güçlü, kendi başına anlaşılır diyaloglu sahneler" kısıtı, 3-6 sahne, kronolojik/örtüşmesiz, ±%20 hedef süre, sahne başına ≤1 cümle anlatım (toplam 2-4; ilk sahnede zorunlu). Doğrulama: sayısal filtre, süre kelepçesi, örtüşme kırpma, ≥1.5 sn sahne, ≤8 sahne, ≤400 karakter anlatım.
- **TTS** (`elevenTts`): `POST /v1/text-to-speech/{voice}?output_format=mp3_44100_128`, model `eleven_multilingual_v2` (Türkçe destekli); hatalar Türkçe (`elevenErrorMessage`: 401 anahtar, 429 sınır, 402/quota kota). `mood-voices` ses listesini getirir; tercih `settings.moodVoice`'ta hatırlanır. Anlatım süreleri `probeDurationPrecise` ile ondalıklı okunur (probeMedia tam-saniye yetmez — ofset/ducking hassasiyeti).
- **Montaj robotu** (`mood-render` + saf `buildMoodFilterGraph`): Faz 13'ün trim/atrim/concat zinciri + anlatım aralıklarında `volume=0.22:enable='between(...)'` ducking + `adelay=<ms>:all=1` + `amix=duration=first:normalize=0`; girişler `aformat=48000:stereo` ile hizalanır (amix örnekleme uyuşmazlığı tuzağına karşı). GPU→CPU düşüşü smarttrim deseninde, kendi süreç takibiyle. Çıktı: `<ad> [mood-<mood>].mp4` (uniquePath).
- **Doğrulama:** graf kurucu birim testi + **gerçek ffmpeg render'ı** (3 sahne + 2 sahte anlatım → tam 10.00 sn çıktı, duck aralıkları/adelay/amix doğrulandı); CDP arayüz testi (6 nav, 5 mood, eksik-anahtar uyarı metni, seçim davranışları); gerçek IPC ile mood-plan'da whisper aşamaları (audio→model→transcribe→plan) çalışıp anahtarsız Gemini'nin doğru hatası; anlatımsız mood-render **gerçek montaj üretti** (2 sahne → 6 sn çıktı, GPU yolu). Konsol temiz.
- **Saha testinde bakılacak:** gerçek anahtarlarla tam akış (plan kalitesi — sahne seçimi/anlatım tonu; TTS Türkçe telaffuz; ducking seviyesi 0.22 kulak testi); uzun bölümde (40 dk+) whisper süresi ve Gemini plan tutarlılığı; iptal davranışı (TTS ortasında / render ortasında); ElevenLabs kota dolunca hata akışı.

**Faz 12 — Hızlı Kazanımlar: TAMAMLANDI, saha testinden geçti; Faz 11 ile birlikte v1.12.0 olarak yayınlandı.**
- **GIF**: format seçicide 4. seçenek (`FORMAT_DEFS.gif`); döngüde özel dal — tek geçiş `palettegen(stats_mode=diff)/paletteuse(bayer)`, 12 fps, 480px, `-an`; altyazı/marka/takip GIF'e uygulanmaz, dosya adı da o etiketleri almaz. 30 sn üstü kesitte `#gifHint` uyarısı (`refreshGifHint` — format/trim/slider değişimlerine bağlı). Test: 6 sn 720p → 1.0MB GIF89a.
- **Safe Zone**: kadraj önizleme modalında `#tpSafeZoneSeg` (Kapalı/TikTok/Shorts/Reels); `#tpSafeZone` katmanı `data-platform`'a göre saf CSS bloklar (üst bar + sağ eylem sütunu + alt açıklama; kırmızı yarı saydam, kesikli çerçeve). Ölçüler platform kılavuzlarına orantısal yaklaşıklık — saha testinde gerçek Shorts ekranıyla karşılaştırılabilir.
- **.trimtube projesi**: `project-save/open/ask-mode` IPC; `buildProject()` ↔ `applyProjectSettings(p, includeTrim)` (renderer). Açılış: sürükle-bırak (her ekrandan), dosya seçici (filtreye eklendi) → yerleşik diyalogla "Tümünü geri yükle / Yalnız ayarları uygula / Vazgeç". Kayıp yollar (`localFileMissing`, `watermark.missing`) main'de işaretlenip uyarıya dönüşür. Kuyruk da kaydedilir/geri gelir.
- **Film şeridi**: `filmstrip` IPC — 12 ayrı `-ss T -i input` girdisi + `scale=160:-2` ×12 + `hstack` → tek PNG (tüm videoyu çözmeden; 60 sn kaynakta anında, 1920×90). Ana kaydırıcının üstünde `#filmstripBand` (44px; 28px'lik kaydırıcının İÇİNE koymak işe yaramazdı — ayrı bant tercih edildi). Süs katmanı: başarısızlık sessiz, yeni video token'la eskiyi geçersiz kılar.

**v1.12.0'a dahil — SOL NAVİGASYON + EKRAN MİMARİSİ (kullanıcı tasarım kararı):** Her özellik tek ana ekrana yığılmasın diye ("çingene pazarı" riski) sol menü + view sistemi kuruldu. Yapı: `.app` flex satır → `#sideNav` (208px, hamburgerla `collapsed`, `width` geçişi; iç sarmalayıcı sabit genişlikte — daralırken içerik kırılmaz) + `.app-main`. Menü: Video Kes / Sıkıştır / (altta) Ayarlar. **Sıkıştır ve Ayarlar modaldan kendi ekranına taşındı** (`viewCompress`, `viewSettings`; `.view-scroll > .view-inner` ~560px ortalanmış sütun); üst çubuktan dişli ve sıkıştırma düğmesi kalktı, hamburger `#navToggle` URL girişinin solunda. `switchView()` app.js'te; ayarlardan çıkışta `defaultFormats` kaydı, girişte `refreshCacheInfo()` (eski modal davranışları). Menü **kapalı başlar**, `settings.sidebarOpen` ile hatırlanır. Kesim kısayolları (Boşluk/I/O/J/L) `currentView !== 'cutter'` iken devre dışı; Esc özellik ekranından ana ekrana döner; sürükle-bırak Sıkıştır ekranındayken sıkıştırmaya yönlenir. Kadraj önizleme + playlist modalları bağlamsal oldukları için modal kaldı. **Gelecek fazlar (GIF, Moodlar…) bu iskelet üzerine yeni `nav-item` + `view` olarak eklenir.** Tarayıcıda statik render ile görsel doğrulandı (koyu/açık tema, üç ekran); Electron duman testi temiz.

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

---

# Windows Oturumu — Faz 10-A: Konuşmacı-Değişimli Takip (v1.10.0, kod hazır)

Sahnede birden fazla yüz varsa o an **konuşanı** otomatik seçip kadrajı ona kaydırır. Kullanıcı Faz 10'un iki kaleminden **A**'yı seçti (B = kurulumsuz/Python-kaldır ertelendi).

## Mimari

- **`tracker.py` yeniden yapılandırıldı** (tek-kişi mantığı BİREBİR korundu): ortak `write_output` (kamera yumuşatma + sendcmd/boxes yazma), `run_single` (mevcut kanıtlı yol), yeni `run_speaker`. `main()` `--speaker` ile dallanır. **Regresyon:** tek-kişi çıktısı bit-bit aynı (aynı klipte 375 satır, önceki testlerle özdeş).
- **`run_speaker`**: her örnekte (~10/s) tüm yüzler (YuNet) → kareler arası **nearest-center eşleme** (kalıcı "track"ler). Her track için **ağız bölgesi hareketi** = ardışık örneklerde 24x16 gri ağız yaması `mean-abs-diff` (EMA ile yumuşatılır). Aktif konuşan = `speaking` iken en çok ağız hareketi olan track. **Histerezis:** yeni aday, mevcut konuşandan `SWITCH_RATIO=1.4` kat fazla hareket + `MOTION_MIN=1.8` üstü + `SWITCH_HOLD=2` örnek (~0.2s) sürerse geçilir → titreme yok. Sahne kesmesinde track'ler sıfırlanır. Kadraj = aktif track merkezi; mevcut kamera yumuşatma (ölü bölge+ease) pan'i yumuşatır.
- **Ses kapısı:** `load_audio_env(wav)` — mono 16k WAV'dan 50ms RMS zarfı, 90. persentile normalize; `env(t) > SPEECH_THRESH=0.16` ise "konuşma var". Ses yoksa (None) yalnız dudak hareketi. **TUZAK (çözüldü):** track dict'leri numpy dizisi (patch/f) içerdiğinden `active not in visible` (`==`) "ambiguous truth" hatası verdi → kimlik (`is`) kontrolüne çevrildi (`any(active is t ...)`).
- **`main.js`**: `opts.speakerMode` ise tracker'a `--speaker` + sesi `-vn -ac 1 -ar 16000 -c:a pcm_s16le` ile wav'a çıkarıp `--audio` geçer. Hem download-tracking (trackClipFile'dan) hem track-preview (480p klipten, zaten sesli) yollarında. Speaker modda `trackPoint` yok sayılır.
- **renderer**: trackCard'a `#trackMode` segmented ("İşaretlenen kişi" / "Aktif konuşan"). Speaker seçilince tek-nokta işaretleme gizli/ilgisiz (preview click = oynat/duraklat), farklı ipucu. `buildOpts.speakerMode`, `computeTrackPreview`'e geçer. queueBadges "konuşan takip". Format-dikey-kaldırma/ses'te mod+ipuçları gizlenir.

## Doğrulama (gerçek video)

- **Regresyon:** tek-kişi modu aynı klipte 375 satır, önceki çıktılarla özdeş → kanıtlı yol bozulmadı.
- **Konuşmacı modu (30s TV dizisi klibi, çok-kişili):** exit 0, kadraj kişiler arası kayıyor (x 341→114→522→104, 5 belirgin pan). **Görsel doğrulama** (6 zaman noktasında aktif-konuşan yeşil kutu + mavi kadraj çerçevesi kaynağa çizildi): tek-kişi sahnelerde kutu doğru kişide; **iki-kişi sahnelerinde (t=7 yaşlı kadın sol, t=23 yaşlı kadın sağ) sistem birini seçip kadrajı ona oturttu**; kutular gerçek yüzlerde. Yoğun geçiş karesinde (t=15) hafif şaşkın — kabul edilebilir.
- **UI wiring (başsız Electron + mock):** yükleme temiz, mod seçici görünür, speaker seçince doğru ipucu, `buildOpts → {track:true, speakerMode:true}`.
- **Sınır:** "tam DOĞRU konuşanı mı seçiyor" — ses+izleme gerektirir, kullanıcı arayüzde yargılayacak (tek-kişi takibindeki gibi). Heuristik; eşikler (SPEECH_THRESH/MOTION_MIN/SWITCH_*) tracker.py başında ayarlanabilir.

## İnce ayar (kullanıcı ilk testi sonrası)

Kullanıcı "mükemmel sonuç" dedi; 3 iyileştirme noktası bildirdi → hepsi **yalnızca konuşmacı modunda** (tek-kişi bozulmadan) yapıldı:
- **Yalpalanma (herkes arkası dönükken):** `run_speaker` seçim mantığına **HOLD** eklendi — aktif konuşanın yüzü kaybolunca `MISSING_GRACE=5` örnek (~0.5s) son konumda beklenir; yeniden seçim ancak gerçekten konuşan (motion>MOTION_MIN) yüz belirince. Yüz yoksa/hareketsizse hiç atlamaz. İlk seçim de hareketli yüzü (yoksa en büyüğü) tercih eder.
- **Titreme:** konuşmacı modunda `write_output(dead_frac=0.13)` (0.10 yerine daha geniş ölü bölge). `write_output` parametrik yapıldı; tek-kişi çağrısı varsayılanlarla (0.10/0.18) **birebir aynı**.
- **Geçişler:** konuşmacı modunda `ease=0.22` (0.18 yerine biraz daha hızlı yetişme).
- Doğrulama: regresyon (tek-kişi 375 satır özdeş) + konuşmacı görsel (6 karenin 5'i doğru konuşan yüzde, kadraj oturmuş; takılmıyor, 5 gerçek pan).

## Kalan / Sıradaki

- Yayın: v1.10.0 (ince ayar sonrası; kullanıcı onayı bekleniyor).
- İleride (gerekirse): dudak hareketi için gerçek ağız-açıklık; ses-dudak korelasyonu; eşikler `tracker.py` başında (SPEECH_THRESH/MOTION_MIN/SWITCH_*/MISSING_GRACE).

---

# Windows Oturumu — Faz 10-B: Kurulumsuz Takip (v1.11.0, PyInstaller)

Kişi takibi artık kullanıcının Python kurmasını gerektirmiyor. `tracker.py` PyInstaller ile platforma özel **tek dosyalık çalıştırılabilir** hale dondurulup pakete gömülüyor. Kullanıcı A/B'den **A**'yı (PyInstaller) seçti; gerekçe: beğendiği takip kalitesi birebir korunur (aynı kod), JS-port'un regresyon riski yok.

## Mimari

- **`tracker.spec`** (yeni): PyInstaller onefile; iki ONNX modeli (`--add-data`/datas) exe'ye gömülür, gereksiz ağır modüller (tkinter/matplotlib/scipy/pandas…) dışlanır. `console=True` (PROGRESS/DONE/ERROR görünmeli).
- **`tracker.py`**: model yolu frozen-uyumlu — `getattr(sys,"frozen",False)` ise `sys._MEIPASS` (PyInstaller açılım dizini), değilse betik klasörü. Takip mantığı DEĞİŞMEDİ.
- **`main.js` `resolveTracker()`**: paketlenmişse `resources/bin/tracker(.exe)` (yt-dlp gibi), değilse `python[3] tracker.py`. `{ cmd, prefix }` döner; iki çağrı yeri (download-tracking + track-preview) `TRACKER.cmd` + `TRACKER.prefix` kullanır. subtitle.py (Whisper) hâlâ sistem Python'ı gerektirir — frozen kapsamı dışında (deps ~500MB+, model runtime indiriyor).
- **`package.json`**: `files`'a `!*.onnx` + `!build/**` + `!tracker.spec` eklendi (modeller artık frozen exe içinde → app bundle'ından 37MB düştü). extraResources zaten `resources/bin/<platform>` → `bin` taşıyor.
- **CI (`release.yml`)**: matrise `bindir`/`trackerout` eklendi; electron-builder öncesi `setup-python@3.12` + `pip install opencv-contrib-python-headless numpy pyinstaller` + `pyinstaller tracker.spec` + çıktıyı `resources/bin/<platform>/`'e kopyalama adımı (shell: bash, tüm platformlarda). **headless OpenCV bilinçli**: tracker GUI kullanmaz → Linux'ta libGL runtime bağımlılığı olmaz, çıktı birebir aynı.
- `.gitignore`'a `build/` eklendi (dist/, resources/bin/ zaten vardı). `tracker.spec` commit'lenir (CI kullanır).

## Doğrulama

- **Windows yerel build**: `pyinstaller tracker.spec` → `dist/tracker.exe` (111MB). Frozen exe hem tek-kişi hem konuşmacı modunda `python tracker.py` ile **`diff` BİREBİR AYNI** çıktı verdi (aynı klip+wav). → algoritma/kalite korunuyor, model gömme + frozen yol çalışıyor.
- main.js/tracker.py sözdizimi OK.
- **RİSK / açık**: mac/Linux frozen build'i yalnız CI'de görülecek (yerelde test edilemez). PyInstaller + opencv-contrib-headless standart; risk orta. İlk yayında CI logları izlenecek. Kurulum boyutu ~100MB artar (kullanıcı onayladı).

## Kalan / Sıradaki

- Yayın: v1.11.0 (kullanıcı onayı + CI mac/Linux build başarısı bekleniyor).
- **Yol haritasının ana planı (Faz 1–10) bitti.** Geriye bilinçli kapsam-dışı fikirler kaldı (diğer platform kaynakları, sosyal paylaşım) + istenirse Whisper'ı da dondurma (pratik değil).
