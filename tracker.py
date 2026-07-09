# Videodaki kisiyi takip edip 9:16 kirpma penceresinin x konumlarini
# ffmpeg sendcmd dosyasi olarak uretir.
#
# Kullanim:
#   python tracker.py klip.mp4 --out cmds.txt [--point 0.42,0.35]
#
# --point: takip edilecek kisinin ilk karedeki normalize konumu (0-1).
# Verilmezse ilk karede en buyuk yuz otomatik secilir.
#
# Sahne kesmelerine dayanikli calisir: kesme tespit edildiginde CSRT takibi
# sifirlanir ve kisi, yuz kimligi (SFace embedding) eslesmesiyle yeniden
# bulunur. Kisi sahnede yokken kirpma penceresi son konumunda bekler.
import argparse
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--out", required=True)
    ap.add_argument("--point", default=None)
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

    tracker = None
    lost = True
    ref_feats = []          # hedef kisinin yuz kimlikleri (birden fazla ornek)
    init_point = None
    if args.point:
        px, py = (float(v) for v in args.point.split(","))
        init_point = (px * sw, py * sh)

    centers = []            # (saniye, kaynak cx, segment no)
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
        tiny = cv2.cvtColor(cv2.resize(small, (64, 36)), cv2.COLOR_BGR2GRAY).astype(np.int16)

        # --- sahne kesmesi tespiti ---
        is_cut = prev_tiny is not None and float(np.abs(tiny - prev_tiny).mean()) > CUT_DIFF
        prev_tiny = tiny
        if is_cut:
            segment += 1
            tracker = None
            lost = True

        if first:
            # Ilk kare: isaretli noktaya en yakin yuz, yoksa en buyuk yuz
            faces = engine.detect(small)
            target = None
            if init_point is not None and faces:
                def dist(f):
                    return (f[0] + f[2] / 2 - init_point[0]) ** 2 + (f[1] + f[3] / 2 - init_point[1]) ** 2
                target = min(faces, key=dist)
                # Tiklanan nokta yuzden cok uzaksa (govdeye tiklandiysa) kutuyu noktadan kur
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
            first = False
        elif tracker is not None and not lost:
            ok2, box = tracker.update(small)
            if ok2:
                last_cx = (box[0] + box[2] / 2.0) / scale
            else:
                tracker = None
                lost = True

        # --- kimlik dogrulama / yeniden bulma ---
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
                if score > 0.45 and len(ref_feats) < MAX_REF_FEATS:
                    feat = engine.embed(small, face)
                    if feat is not None:
                        ref_feats.append(feat)
        elif need_check and not ref_feats and tracker is not None and not lost:
            # Kimlik henuz yok (govdeye tiklandi): takip kutusundaki yuzden kimlik cikar
            bx = last_cx * scale
            for face in engine.detect(small):
                if abs(face[0] + face[2] / 2 - bx) < sw * 0.1:
                    feat = engine.embed(small, face)
                    if feat is not None:
                        ref_feats.append(feat)
                    break
        # Kisi bulunamadiysa son konumda bekle (last_cx degismez)

        centers.append((frame_idx / fps, last_cx, segment))
        if sample_idx % 20 == 0:
            print(f"PROGRESS {int(frame_idx * 100 / total)}", flush=True)
        frame_idx += 1
        sample_idx += 1

    cap.release()

    crop_w = src_h * 9.0 / 16.0
    max_x = max(0.0, src_w - crop_w)
    if not centers:
        centers = [(0.0, src_w / 2.0, 0)]

    # Kadraj hareketini "sanal kameraman" gibi yumusat — segment (sahne)
    # sinirlarini asmadan: kesmede kadraj kaymaz, aninda atlar.
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

    # 2) Olu bolge + yumusak izleme: kisi kadraj merkezinden belirli esikten
    #    az saparsa kamera hic kimildamaz; asarsa yumusakca yetisir
    dead = crop_w * 0.10
    ease = 0.18
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

    with open(args.out, "w") as f:
        for (t, _, _), cx in zip(centers, smoothed):
            x = min(max(cx - crop_w / 2.0, 0.0), max_x)
            f.write(f"{t:.2f} crop x {x:.0f};\n")

    print("PROGRESS 100", flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
