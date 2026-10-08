# voice_align.py — Anlatımlı video: seslendirilmiş sahnelerin kelime zamanları.
# Metni zaten biliyoruz; Whisper yalnızca hangi kelimenin ne zaman söylendiğini
# ölçmek için çalışır (hizalama main tarafında senaryo metniyle yapılır).
# Model bir kez yüklenir, iş listesindeki tüm sahne sesleri sırayla çözümlenir.
# subtitle.py ile aynı çıktı sözleşmesi:
#   PROGRESS N | STATUS model | STATUS transcribe | DONE | ERROR <mesaj> (çıkış 1)
#
# Kullanım:
#   python voice_align.py jobs.json --model small --model-dir DIR [--lang tr]
# jobs.json: [{"input": "a.wav", "out": "a.json", "prompt": "senaryo metni"}]
# Her out dosyasına {"words": [{"start","end","word"}]} yazılır.
import argparse
import json
import sys


def log(msg):
    print(msg, flush=True)


def fail(msg):
    log(f"ERROR {msg}")
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("jobs")
    ap.add_argument("--model", default="small")
    ap.add_argument("--model-dir", default=None, dest="model_dir")
    ap.add_argument("--lang", default="tr")
    args = ap.parse_args()

    try:
        with open(args.jobs, encoding="utf-8") as f:
            jobs = json.load(f)
    except Exception as e:
        fail(f"İş listesi okunamadı: {e}")

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        fail("faster-whisper kurulu degil. Terminalde: pip install faster-whisper")

    log("STATUS model")
    try:
        model = WhisperModel(args.model, device="cpu", compute_type="int8", download_root=args.model_dir)
    except Exception as e:
        fail(f"Model yuklenemedi: {e}")

    log("STATUS transcribe")
    for i, job in enumerate(jobs):
        words = []
        try:
            segments, _info = model.transcribe(
                job["input"],
                language=args.lang,
                beam_size=5,
                word_timestamps=True,
                vad_filter=False,  # kısa sahne sesi: baştaki/sondaki kelimeler kesilmesin
                condition_on_previous_text=False,
                initial_prompt=(job.get("prompt") or "")[:800] or None,
            )
            for seg in segments:
                for w in seg.words or []:
                    text = w.word.strip()
                    if text:
                        words.append({"start": round(w.start, 3), "end": round(w.end, 3), "word": text})
        except Exception as e:
            fail(f"Ses cozumlenemedi: {e}")
        with open(job["out"], "w", encoding="utf-8") as f:
            json.dump({"words": words}, f, ensure_ascii=False)
        log(f"PROGRESS {int((i + 1) / max(1, len(jobs)) * 100)}")

    log("DONE")


if __name__ == "__main__":
    main()
