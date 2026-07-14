# Videodaki kisiyi takip edip 9:16 kirpma penceresinin x konumlarini
# ffmpeg sendcmd dosyasi olarak uretir.
#
# Kullanim:
#   python tracker.py klip.mp4 --out cmds.txt [--point 0.42,0.35]
#   python tracker.py klip.mp4 --out cmds.txt --speaker --audio ses.wav
#
# Iki mod:
#  * Tek kisi (varsayilan): --point ile isaretlenen (yoksa en buyuk) yuz takip
#    edilir; sahne kesmelerine dayanikli, yuz kimligiyle yeniden bulma.
#  * Konusmaci (--speaker, Faz 10): sahnedeki yuzler arasindan o an KONUSANI
#    secip kadraji ona kaydirir. Aktif konusan = ses enerjisi (RMS zarfi,
#    --audio wav'dan) konusma gosterirken agiz bolgesi en cok hareket eden yuz;
#    histerezis ile kisiler arasi gereksiz gecis engellenir.
import argparse
import math
import os
import sys

import cv2
import numpy as np

DIR = os.path.dirname(os.path.abspath(__file__))
DET_MODEL = os.path.join(DIR, "face_detection_yunet_2023mar.onnx")
REC_MODEL = os.path.join(DIR, "face_recognition_sface_2021dec.onnx")

MATCH_THRESHOLD = 0.32  # SFace kosinus benzerligi (resmi esik 0.363; TV kadraji icin biraz genis)
CUT_DIFF = 35.0         # sahne kesmesi: kucuk gri karelerin ortalama mutlak farki
REVALIDATE_EVERY = 10   # ~saniyede bir takip dogrulamasi / kimlik kontrolu
MAX_REF_FEATS = 5

# --- Konusmaci modu ayarlari ---
SPEECH_THRESH = 0.16    # normalize ses enerjisi bu esigin ustundeyse "konusma var"
MOTION_MIN = 1.8        # aday konusanin en az agiz hareketi (0-255 gri fark)
SWITCH_RATIO = 1.4      # yeni aday, mevcut konusandan bu kadar cok hareket etmeli
SWITCH_HOLD = 2         # gecis icin gereken ardisik ornek sayisi (~0.2 sn)
TRACK_STALE = 3         # bir yuz kaç ornek görünmezse "track" düşürülür
MISSING_GRACE = 5       # aktif konusanin yuzu kaybolunca kaç ornek beklenir (~0.5 sn)
                        # — arkasi donuk/gecici kayiplarda yalpalanmayi onler


class FaceEngine:
    def __init__(self):
        self.det = cv2.FaceDetectorYN.create(DET_MODEL, "", (320, 320), score_threshold=0.6)
        self.rec = (
            cv2.FaceRecognizerSF.create(REC_MODEL, "")
            if os.path.exists(REC_MODEL)
            else None
        )

    def detect(self, frame):
        self.det.setInputSize((frame.shape[1], frame.shape[0]))
        _, faces = self.det.detect(frame)
        return [] if faces is None else list(faces)

    def embed(self, frame, face):
        if self.rec is None:
            return None
        try:
            return self.rec.feature(self.rec.alignCrop(frame, face))
        except cv2.error:
            return None

    def similarity(self, f1, f2):
        return float(self.rec.match(f1, f2, cv2.FaceRecognizerSF_FR_COSINE))


def make_tracker():
    if hasattr(cv2, "TrackerCSRT_create"):
        return cv2.TrackerCSRT_create()
    return cv2.legacy.TrackerCSRT_create()


def body_box(face, sw, sh):
    # Yuz kutusunu govdeyi de kapsayacak sekilde genislet (CSRT icin daha stabil)
    x, y, w, h = (int(v) for v in face[:4])
    bx = max(0, x - w)
    by = max(0, y - h // 2)
    return (bx, by, min(w * 3, sw - bx), min(h * 4, sh - by))


def best_face_match(engine, small, ref_feats):
    """Karedeki yuzler icinden referans kimlige en cok benzeyeni dondurur."""
    best, best_score = None, 0.0
    for face in engine.detect(small):
        feat = engine.embed(small, face)
        if feat is None:
            continue
        score = max(engine.similarity(rf, feat) for rf in ref_feats)
        if score > best_score:
            best, best_score = face, score
    if best is not None and best_score >= MATCH_THRESHOLD:
        return best, best_score
    return None, 0.0


def detect_scene_cut(small, prev_tiny):
    """(is_cut, tiny) — kucuk gri kare ortalama farkiyla sahne kesmesi."""
    tiny = cv2.cvtColor(cv2.resize(small, (64, 36)), cv2.COLOR_BGR2GRAY).astype(np.int16)
    is_cut = prev_tiny is not None and float(np.abs(tiny - prev_tiny).mean()) > CUT_DIFF
    return is_cut, tiny


# ----------------------------------------------------------------------------
# Ses enerjisi zarfi (konusmaci modu icin)
# ----------------------------------------------------------------------------
def load_audio_env(path):
    """WAV'dan 50 ms'lik pencerelerde RMS zarfi; env(t)->0..~3 (90. persentile normalize).
    Ses yoksa None (o zaman yalnizca dudak hareketi kullanilir)."""
    if not path or not os.path.exists(path):
        return None
    try:
        import wave
        wf = wave.open(path, "rb")
        sr = wf.getframerate() or 16000
        raw = wf.readframes(wf.getnframes())
        wf.close()
        a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        if a.size == 0:
            return None
        bin_n = max(1, int(sr * 0.05))
        nb = a.size // bin_n
        if nb == 0:
            return None
        rms = np.sqrt((a[: nb * bin_n].reshape(nb, bin_n) ** 2).mean(axis=1) + 1e-9)
        norm = float(np.percentile(rms, 90)) or 1.0
        env = np.clip(rms / (norm + 1e-9), 0.0, 3.0)

        def q(t):
            i = int(t / 0.05)
            return float(env[min(max(i, 0), env.size - 1)])

        return q
    except Exception:
        return None


def mouth_patch(face, gray, sw, sh):
    """Yuzun agiz bolgesinden 24x16 gri yama (kareler arasi hareket olcumu icin)."""
    mx = (face[10] + face[12]) / 2.0
    my = (face[11] + face[13]) / 2.0
    eye = math.hypot(face[4] - face[6], face[5] - face[7]) or (face[2] * 0.4)
    hw = max(4.0, eye * 0.6)
    hh = max(3.0, eye * 0.4)
    x0, x1 = int(max(0, mx - hw)), int(min(sw, mx + hw))
    y0, y1 = int(max(0, my - hh)), int(min(sh, my + hh))
    if x1 <= x0 or y1 <= y0:
        return None
    return cv2.resize(gray[y0:y1, x0:x1], (24, 16)).astype(np.int16)


# ----------------------------------------------------------------------------
# Mod 1: tek kisi takibi (mevcut/kanitlanmis yol)
# ----------------------------------------------------------------------------
def run_single(cap, engine, scale, sw, sh, src_w, src_h, fps, step, total, init_point):
    tracker = None
    lost = True
    ref_feats = []
    centers = []
    boxes = []
    last_box = None
    last_cx = src_w / 2.0
    segment = 0
    prev_tiny = None
    frame_idx = 0
    sample_idx = 0
    first = True

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_idx % step != 0:
            frame_idx += 1
            continue
        small = cv2.resize(frame, (sw, sh))
        is_cut, prev_tiny = detect_scene_cut(small, prev_tiny)
        if is_cut:
            segment += 1
            tracker = None
            lost = True

        cur_box = None

        if first:
            faces = engine.detect(small)
            target = None
            if init_point is not None and faces:
                def dist(f):
                    return (f[0] + f[2] / 2 - init_point[0]) ** 2 + (f[1] + f[3] / 2 - init_point[1]) ** 2
                target = min(faces, key=dist)
                if dist(target) > (sw * 0.25) ** 2:
                    target = None
            elif faces:
                target = max(faces, key=lambda f: f[2] * f[3])

            if target is not None:
                feat = engine.embed(small, target)
                if feat is not None:
                    ref_feats.append(feat)
                box = body_box(target, sw, sh)
            elif init_point is not None:
                bw, bh = int(sw * 0.18), int(sh * 0.40)
                box = (
                    max(0, int(init_point[0] - bw / 2)),
                    max(0, int(init_point[1] - bh / 2)),
                    bw,
                    bh,
                )
            else:
                print("WARN yuz bulunamadi, merkez kullanilacak", flush=True)
                box = None

            if box is not None:
                tracker = make_tracker()
                tracker.init(small, box)
                last_cx = (box[0] + box[2] / 2.0) / scale
                lost = False
                cur_box = box
            first = False
        elif tracker is not None and not lost:
            ok2, box = tracker.update(small)
            if ok2:
                last_cx = (box[0] + box[2] / 2.0) / scale
                cur_box = box
            else:
                tracker = None
                lost = True

        need_check = lost or (sample_idx % REVALIDATE_EVERY == 0)
        if need_check and ref_feats:
            face, score = best_face_match(engine, small, ref_feats)
            if face is not None:
                fcx = (face[0] + face[2] / 2.0) / scale
                drifted = (not lost) and abs(fcx - last_cx) > (src_h * 9 / 16) * 0.5
                if lost or drifted:
                    box = body_box(face, sw, sh)
                    tracker = make_tracker()
                    tracker.init(small, box)
                    last_cx = fcx
                    lost = False
                    cur_box = box
                if score > 0.45 and len(ref_feats) < MAX_REF_FEATS:
                    feat = engine.embed(small, face)
                    if feat is not None:
                        ref_feats.append(feat)
        elif need_check and not ref_feats and tracker is not None and not lost:
            bx = last_cx * scale
            for face in engine.detect(small):
                if abs(face[0] + face[2] / 2 - bx) < sw * 0.1:
                    feat = engine.embed(small, face)
                    if feat is not None:
                        ref_feats.append(feat)
                    break

        centers.append((frame_idx / fps, last_cx, segment))
        if cur_box is not None:
            last_box = cur_box
        boxes.append((frame_idx / fps, _norm_box(last_box, sw, sh)))
        if sample_idx % 20 == 0:
            print(f"PROGRESS {int(frame_idx * 100 / total)}", flush=True)
        frame_idx += 1
        sample_idx += 1

    return centers, boxes


# ----------------------------------------------------------------------------
# Mod 2: konusmaci-degisimli takip (Faz 10)
# ----------------------------------------------------------------------------
def run_speaker(cap, engine, scale, sw, sh, src_w, src_h, fps, step, total, audio_env):
    centers = []
    boxes = []
    tracks = []          # her yuz icin kalici iz: {cx,cy,w,patch,motion,seen,f}
    active = None        # o an secili konusan track
    active_cx = src_w / 2.0
    active_box_norm = None
    active_missing = 0   # aktif konusanin yuzu kaç ornektir görünmüyor
    pending = None
    pending_n = 0
    segment = 0
    prev_tiny = None
    frame_idx = 0
    sample_idx = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_idx % step != 0:
            frame_idx += 1
            continue
        small = cv2.resize(frame, (sw, sh))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        is_cut, prev_tiny = detect_scene_cut(small, prev_tiny)
        if is_cut:
            segment += 1
            tracks = []
            active = None
            active_missing = 0
            pending = None
            pending_n = 0

        # yuzleri tespit et + agiz yamasi hesapla
        dets = []
        for f in engine.detect(small):
            dets.append({
                "f": f,
                "cx": float(f[0] + f[2] / 2),
                "cy": float(f[1] + f[3] / 2),
                "w": float(f[2]),
                "patch": mouth_patch(f, gray, sw, sh),
            })

        # tespitleri mevcut izlere esle (en yakin merkez); yoksa yeni iz
        for d in dets:
            best_t, best_dd = None, 1e9
            for t in tracks:
                dd = abs(t["cx"] - d["cx"]) + abs(t["cy"] - d["cy"])
                if dd < best_dd:
                    best_dd, best_t = dd, t
            if best_t is not None and best_dd < max(d["w"], 20.0) * 1.5:
                if d["patch"] is not None and best_t["patch"] is not None:
                    m = float(np.abs(d["patch"] - best_t["patch"]).mean())
                    best_t["motion"] = 0.5 * best_t["motion"] + 0.5 * m
                best_t.update(patch=d["patch"], cx=d["cx"], cy=d["cy"], w=d["w"], f=d["f"], seen=sample_idx)
            else:
                tracks.append({**d, "motion": 0.0, "seen": sample_idx})

        tracks = [t for t in tracks if sample_idx - t["seen"] <= TRACK_STALE]
        visible = [t for t in tracks if t["seen"] == sample_idx]
        speaking = True if audio_env is None else (audio_env(frame_idx / fps) > SPEECH_THRESH)

        # kimlik (is) ile kontrol: track dict'leri numpy dizisi icerdiginden
        # 'in'/'==' belirsizlik hatasi verir
        best = max(visible, key=lambda t: t["motion"]) if visible else None
        active_visible = active is not None and any(active is t for t in visible)

        if active_visible:
            active_missing = 0
            # aktif konusan gorunur: baskin bir aday konusuyorsa histerezisle gec
            if speaking and best is not active and best["motion"] > active["motion"] * SWITCH_RATIO and best["motion"] > MOTION_MIN:
                pending_n = pending_n + 1 if pending is best else 1
                pending = best
                if pending_n >= SWITCH_HOLD:
                    active = best
                    pending, pending_n = None, 0
            else:
                pending, pending_n = None, 0
        else:
            # aktif konusan bu karede gorunmuyor (arkasi donuk / gecici kayip / sahne)
            pending, pending_n = None, 0
            if active is None:
                # ilk seciM: konusan (hareketli) yuz varsa onu, yoksa en buyugu
                if best is not None:
                    active = best if best["motion"] > MOTION_MIN else max(visible, key=lambda t: t["w"])
                    active_missing = 0
            else:
                active_missing += 1
                # kisa sure son konumda BEKLE (yalpalanmayi onler); ancak gercekten
                # konusan baska bir yuz belirdi ve grace doldu ise yeniden sec
                if active_missing > MISSING_GRACE and best is not None and best["motion"] > MOTION_MIN:
                    active = best
                    active_missing = 0

        # Kadraji yalnizca aktif konusan bu karede gorunurken guncelle; degilse
        # son konumda bekle (active_cx / active_box_norm korunur)
        if active is not None and any(active is t for t in visible):
            active_cx = active["cx"] / scale
            active_box_norm = _norm_box(body_box(active["f"], sw, sh), sw, sh)

        centers.append((frame_idx / fps, active_cx, segment))
        boxes.append((frame_idx / fps, active_box_norm))
        if sample_idx % 20 == 0:
            print(f"PROGRESS {int(frame_idx * 100 / total)}", flush=True)
        frame_idx += 1
        sample_idx += 1

    return centers, boxes


def _norm_box(box, sw, sh):
    if box is None:
        return None
    bx, by, bw, bh = (float(v) for v in box[:4])
    return (
        min(max(bx / sw, 0.0), 1.0),
        min(max(by / sh, 0.0), 1.0),
        min(max(bw / sw, 0.0), 1.0),
        min(max(bh / sh, 0.0), 1.0),
    )


# ----------------------------------------------------------------------------
# Ortak cikti: kamera yumusatma + sendcmd/boxes yazma
# ----------------------------------------------------------------------------
def write_output(centers, boxes, out_path, boxes_out, src_w, src_h, dead_frac=0.10, ease=0.18):
    crop_w = src_h * 9.0 / 16.0
    max_x = max(0.0, src_w - crop_w)
    if not centers:
        centers = [(0.0, src_w / 2.0, 0)]

    xs = [c[1] for c in centers]
    segs = [c[2] for c in centers]

    # 1) Medyan filtre: tek ornekten kaynaklanan sicramalari at
    med = []
    for i in range(len(xs)):
        lo, hi = i, i + 1
        while lo > 0 and i - lo < 2 and segs[lo - 1] == segs[i]:
            lo -= 1
        while hi < len(xs) and hi - i <= 2 and segs[hi - 1] == segs[i]:
            hi += 1
        med.append(sorted(xs[lo:hi])[(hi - lo) // 2])

    # 2) Olu bolge + yumusak izleme: kucuk sapmada kamera kimildamaz, buyukte yetisir.
    #    Konusmaci modu daha genis olu bolge (titreme az) + biraz hizli ease (geciş) kullanir.
    dead = crop_w * dead_frac
    smoothed = []
    cam = med[0]
    for i in range(len(med)):
        if i > 0 and segs[i] != segs[i - 1]:
            cam = med[i]  # sahne kesmesi: aninda yeni konuma atla
        else:
            err = med[i] - cam
            if abs(err) > dead:
                cam += (err - (dead if err > 0 else -dead)) * ease
        smoothed.append(cam)

    with open(out_path, "w") as f:
        for (t, _, _), cx in zip(centers, smoothed):
            x = min(max(cx - crop_w / 2.0, 0.0), max_x)
            f.write(f"{t:.2f} crop x {x:.0f};\n")

    if boxes_out:
        with open(boxes_out, "w") as f:
            for t, b in boxes:
                if b is None:
                    f.write(f"{t:.2f} -\n")
                else:
                    f.write(f"{t:.2f} {b[0]:.4f} {b[1]:.4f} {b[2]:.4f} {b[3]:.4f}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--out", required=True)
    ap.add_argument("--point", default=None)
    # Faz 8 onizleme: takip edilen kisinin normalize kutu yolu (render vermez)
    ap.add_argument("--boxes-out", default=None, dest="boxes_out")
    # Faz 10 konusmaci modu: aktif konusana kadraj; --audio ses enerjisi kapisi
    ap.add_argument("--speaker", action="store_true")
    ap.add_argument("--audio", default=None)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print("ERROR video acilamadi", flush=True)
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1

    scale = min(1.0, 480.0 / src_h)
    sw, sh = int(src_w * scale), int(src_h * scale)

    engine = FaceEngine()
    step = max(1, round(fps / 10))  # saniyede ~10 ornek

    if args.speaker:
        audio_env = load_audio_env(args.audio)
        centers, boxes = run_speaker(cap, engine, scale, sw, sh, src_w, src_h, fps, step, total, audio_env)
    else:
        init_point = None
        if args.point:
            px, py = (float(v) for v in args.point.split(","))
            init_point = (px * sw, py * sh)
        centers, boxes = run_single(cap, engine, scale, sw, sh, src_w, src_h, fps, step, total, init_point)

    cap.release()
    if args.speaker:
        # Konusmaci modu: biraz genis olu bolge (titreme az) + biraz hizli ease (geciş)
        write_output(centers, boxes, args.out, args.boxes_out, src_w, src_h, dead_frac=0.13, ease=0.22)
    else:
        write_output(centers, boxes, args.out, args.boxes_out, src_w, src_h)
    print("PROGRESS 100", flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
