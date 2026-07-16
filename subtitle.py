# subtitle.py — Ses/video dosyasindaki konusmayi faster-whisper ile metne
# cevirip SRT altyazi dosyasi uretir (Faz 7: otomatik altyazi).
#
# Videoda gomulu/indirilebilir altyazi olmadiginda kullanilir. tracker.py ile
# ayni cikti sozlesmesini paylasir; main.js satirlari boyle yorumlar:
#   PROGRESS N     -> yuzde ilerleme (0-100)
#   STATUS model   -> model hazirlaniyor / ilk kullanimda indiriliyor
#   STATUS transcribe -> ses cozumleniyor
#   DONE           -> basariyla bitti
#   ERROR <mesaj>  -> hata (Turkce, kullaniciya gosterilebilir); cikis kodu 1
#
# Kullanim:
#   python subtitle.py girdi.wav --out subs.srt [--model small] [--lang tr] [--model-dir DIR]
#
# --model: whisper model boyutu (tiny/base/small/medium ...). Buyudukce daha
#          dogru ama daha yavas ve daha buyuk indirme.
# --lang:  konusma dili (ISO kodu). Verilmezse otomatik algilanir.
# --model-dir: model indirme/onbellek konumu (uygulama userData'sina yonlendirilir
#          ki her calismada yeniden indirilmesin).
# --words-out: verilirse kelime-duzeyi zaman damgalari {duration, words:[{start,end,
#          word,prob}]} JSON olarak da yazilir (Faz 13: akilli kirpma - sessizlik/
#          dolgu kelime tespiti bu dosyayi kullanir). SRT uretimini etkilemez.
import argparse
import json
import sys


def log(msg):
    print(msg, flush=True)


def fail(msg):
    log(f"ERROR {msg}")
    sys.exit(1)


def fmt_ts(seconds):
    # SRT zaman damgasi: HH:MM:SS,mmm
    if seconds < 0:
        seconds = 0
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="small")
    ap.add_argument("--lang", default=None)
    ap.add_argument("--model-dir", default=None, dest="model_dir")
    ap.add_argument("--words-out", default=None, dest="words_out")
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        fail("faster-whisper kurulu degil. Terminalde: pip install faster-whisper")

    # Model, ilk kullanimda HuggingFace'ten indirilir; download_root ile uygulama
    # onbellegine yonlendirilir. CPU + int8: her makinede calisan guvenli secim
    # (CUDA icin ekstra cuBLAS/cuDNN kitaplilari gerekir, dagitimda garanti degil).
    log("STATUS model")
    log("PROGRESS 0")
    try:
        model = WhisperModel(
            args.model,
            device="cpu",
            compute_type="int8",
            download_root=args.model_dir,
        )
    except Exception as e:
        fail(f"Model yuklenemedi: {e}")

    want_words = args.words_out is not None
    try:
        segments, info = model.transcribe(
            args.input,
            language=args.lang,
            vad_filter=True,   # sessizlikleri atlar: daha iyi zamanlama, daha az halusinasyon
            beam_size=5,
            word_timestamps=want_words,
        )
    except Exception as e:
        fail(f"Ses cozumlenemedi: {e}")

    total = max(0.1, float(getattr(info, "duration", 0) or 0.1))

    log("STATUS transcribe")
    idx = 1
    last_pct = -1
    words = []
    try:
        # segments tembel bir ureteçtir; asil ses cozumleme bu dongude olur.
        with open(args.out, "w", encoding="utf-8") as f:
            for seg in segments:
                text = seg.text.strip()
                if text:
                    f.write(f"{idx}\n{fmt_ts(seg.start)} --> {fmt_ts(seg.end)}\n{text}\n\n")
                    idx += 1
                if want_words and seg.words:
                    for w in seg.words:
                        words.append({
                            "start": round(w.start, 3),
                            "end": round(w.end, 3),
                            "word": w.word.strip(),
                            "prob": round(w.probability, 3),
                        })
                pct = int(min(99, seg.end / total * 100))
                if pct != last_pct:
                    log(f"PROGRESS {pct}")
                    last_pct = pct
    except Exception as e:
        fail(f"Ses cozumlenemedi: {e}")

    if idx == 1:
        fail("Bu klipte konusma bulunamadi.")

    if want_words:
        with open(args.words_out, "w", encoding="utf-8") as f:
            json.dump({"duration": total, "words": words}, f, ensure_ascii=False)

    log("PROGRESS 100")
    log("DONE")


if __name__ == "__main__":
    main()
