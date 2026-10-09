# Yerel seslendirme (EMA Lightning) modelleri

Uygulama, Anlatımlı Video'daki "Yerel (EMA)" seslendirmesi için `resources/ema/` klasörünü
kullanır (paketlenince `<kurulum>/resources/ema`). Bu dosyalar git'e konmaz; derlemeden önce
`node scripts/fetch-ema.js` ile TrimTube deposundaki **ema-models-1** release ekinden indirilir
ve SHA-256 ile doğrulanır (`npm run fetch:*` bunu otomatik yapar).

| Dosya | İçerik |
|---|---|
| `ema_text.onnx` | harf → özellik + süre |
| `ema_sound.onnx` | özellik + kare çizelgesi → latent (4 adım) |
| `ema_decoder.onnx` | latent → 48 kHz ses |
| `ema_config.json` | alfabe, adım zamanları |
| `normalizer_tr.wasm` | Türkçe metin normalleştirici (sayı, tarih, birim okunuşu) |
| `NOTICE.txt` | lisans ve kaynak bildirimi |

## Yeniden üretmek

```bash
python -m venv .ema
.ema/Scripts/pip install ema-lightning==1.0.4 onnx onnxruntime
.ema/Scripts/python tools/ema/export_onnx.py resources/ema
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown --manifest-path tools/ema/normalizer-wasm/Cargo.toml
```

Derlenen `tools/ema/normalizer-wasm/target/wasm32-unknown-unknown/release/ntr_wasm.wasm` dosyası
`normalizer_tr.wasm` adıyla kopyalanır. Dosyalar değişirse yeni bir `ema-models-N` release'i
açılır ve `scripts/fetch-ema.js` içindeki adres/özetler güncellenir (`voice-video.js` içindeki
`EMA_ID` sürüm kimliği de artırılır ki eski önbellekli sesler yenilensin).
