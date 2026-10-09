# voice_cutout.py — Anlatımlı video: sahne görselinin arka planını kaldırır.
# Genel amaçlı nesne ayırma modeli (ISNet, rembg "isnet-general-use", Apache-2.0)
# onnxruntime ile CPU'da çalışır; görüntü okuma/yazma ffmpeg ile yapılır, ek
# Python paketi gerekmez (onnxruntime + numpy faster-whisper ile zaten gelir).
# Çıktı: konu sınırına kırpılmış, şeffaf zeminli PNG.
#   STATUS model | STATUS infer | DONE {"w","h","coverage"} | ERROR <mesaj> (çıkış 1)
#
# Kullanım:
#   python voice_cutout.py --ffmpeg FFMPEG --model MODEL.onnx --width W --height H IN.png OUT.png
import argparse
import json
import subprocess
import sys

SIZE = 1024      # modelin giriş çözünürlüğü
MAX_SIDE = 2000  # büyük görseller bu boyuta küçültülerek işlenir
PAD = 0.04       # kırpmada konu çevresine bırakılan pay (kısa kenarın oranı)


def log(msg):
    print(msg, flush=True)


def fail(msg):
    log(f"ERROR {msg}")
    sys.exit(1)


def ffmpeg_raw(ffmpeg, src, vf, pix_fmt):
    p = subprocess.run([ffmpeg, "-v", "error", "-i", src, "-frames:v", "1", "-vf", vf, "-f", "rawvideo", "-pix_fmt", pix_fmt, "pipe:1"],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        fail("Görsel okunamadı: " + p.stderr.decode("utf-8", "replace").strip()[-200:])
    return p.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--ffmpeg", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--width", type=int, required=True)
    ap.add_argument("--height", type=int, required=True)
    args = ap.parse_args()

    try:
        import numpy as np
        import onnxruntime as ort
    except Exception:
        fail("Arka plan kaldırma için Python'da onnxruntime ve numpy gerekli (pip install faster-whisper ile birlikte kurulur).")

    k = min(1.0, MAX_SIDE / max(args.width, args.height))
    w, h = max(2, int(args.width * k) // 2 * 2), max(2, int(args.height * k) // 2 * 2)

    log("STATUS model")
    try:
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        sess = ort.InferenceSession(args.model, sess_options=opts, providers=["CPUExecutionProvider"])
    except Exception as e:
        fail(f"Model yüklenemedi: {e}")

    log("STATUS infer")
    small = np.frombuffer(ffmpeg_raw(args.ffmpeg, args.input, f"scale={SIZE}:{SIZE}:flags=bicubic", "rgb24"), dtype=np.uint8)
    if small.size != SIZE * SIZE * 3:
        fail("Görsel çözümlenemedi.")
    x = small.reshape(SIZE, SIZE, 3).astype(np.float32)
    x = x / max(float(x.max()), 1e-6) - 0.5          # rembg ISNet ön işleme: ortalama .5, sapma 1
    x = np.transpose(x, (2, 0, 1))[None]
    pred = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
    lo, hi = float(pred.min()), float(pred.max())
    mask = ((pred - lo) / max(hi - lo, 1e-6) * 255).clip(0, 255).astype(np.uint8)

    # Maske ffmpeg ile özgün boyuta büyütülür (çift doğrusal)
    p = subprocess.run([args.ffmpeg, "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{SIZE}x{SIZE}", "-i", "pipe:0",
                        "-vf", f"scale={w}:{h}:flags=bilinear", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"],
                       input=mask.tobytes(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        fail("Maske ölçeklenemedi.")
    alpha = np.frombuffer(p.stdout, dtype=np.uint8).reshape(h, w).astype(np.float32) / 255
    alpha = ((alpha - 0.08) / 0.84).clip(0, 1)       # zemin artığını sıfırla, kenarı yumuşak bırak

    rgba = np.frombuffer(ffmpeg_raw(args.ffmpeg, args.input, f"scale={w}:{h}:flags=bicubic", "rgba"), dtype=np.uint8).reshape(h, w, 4).copy()
    rgba[..., 3] = (rgba[..., 3].astype(np.float32) * alpha).astype(np.uint8)

    solid = alpha > 0.5
    coverage = float(solid.mean())
    if coverage < 0.01:
        fail("Görselde belirgin bir konu bulunamadı.")
    ys, xs = np.where(alpha > 0.1)
    pad = int(min(w, h) * PAD)
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + 1 + pad)
    x1 -= (x1 - x0) % 2
    y1 -= (y1 - y0) % 2
    crop = np.ascontiguousarray(rgba[y0:y1, x0:x1])
    cw, ch = x1 - x0, y1 - y0

    p = subprocess.run([args.ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{cw}x{ch}", "-i", "pipe:0",
                        "-frames:v", "1", "-pix_fmt", "rgba", args.output], input=crop.tobytes(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        fail("Şeffaf görsel yazılamadı.")
    log("DONE " + json.dumps({"w": int(cw), "h": int(ch), "coverage": round(coverage, 4)}))


if __name__ == "__main__":
    main()
