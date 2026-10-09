# EMA Lightning → ONNX (TrimTube yerel seslendirme modelleri)
#
# Hugging Face'teki resmi ağırlıklar (canberkkkkkk/ema-lightning, Apache-2.0) üç ayrı ONNX
# grafiğine çevrilir; uygulama bunları onnxruntime-node ile PyTorch'suz çalıştırır:
#   ema_text.onnx     harf kimlikleri → harf özellikleri + harf süreleri
#   ema_sound.onnx    özellikler + kare çizelgesi + gürültü → 25 Hz latentler (4 adım)
#   ema_decoder.onnx  latentler → 48 kHz ses
# Ayrıca ema_config.json (alfabe, adım zamanları) yazılır. Her grafik aynı girdiyle
# PyTorch çıktısıyla karşılaştırılır.
#
# Kullanım (yalnız modelleri yeniden üretmek için; uygulama için gerekmez):
#   python -m venv .ema && .ema/Scripts/pip install ema-lightning==1.0.4 onnx onnxruntime
#   .ema/Scripts/python tools/ema/export_onnx.py resources/ema
import json
import os
import sys

import numpy as np
import torch
from huggingface_hub import hf_hub_download

from ema_lightning.chunker import chunk
from ema_lightning.decoder import load_decoder
from ema_lightning.frontend import Frontend
from ema_lightning.model import load_acoustic

REPO = "canberkkkkkk/ema-lightning"
OUT = sys.argv[1] if len(sys.argv) > 1 else "resources/ema"
os.makedirs(OUT, exist_ok=True)
torch.expm1 = lambda x: torch.exp(x) - 1  # opset 17 dışa aktarıcısında expm1 yok; eşdeğer

model = load_acoustic(hf_hub_download(REPO, "ema.pt"), "cpu")
decoder = load_decoder(hf_hub_download(REPO, "decoder.pt"), "cpu")


class TextStage(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, ids):
        return self.m.text_stage(ids, ids != 0)


class SoundStage(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, h, dur, cw, wstart, fw, fp, noise):
        mask = torch.ones(h.shape[:2], dtype=torch.bool)
        fmask = torch.ones(fw.shape, dtype=torch.bool)
        return self.m.sound_stage(h, dur, mask, cw, wstart, fw, fp, fmask, noise)


class DecodeStage(torch.nn.Module):
    def __init__(self, d):
        super().__init__()
        self.d = d

    def forward(self, z):
        return self.d(z.transpose(1, 2), None)


# Örnek girdi (ema_lightning.engine ile aynı planlama)
text = Frontend(model.vocab)("Creality K1 mi, K2 mi? Bugün iki yazıcıyı karşılaştırıyoruz; hangisi sana uygun, birlikte bakalım.")
piece = chunk(text, 1.0)[0][0]
ids = [model.stoi.get(ch, 1) for ch in piece]
starts = [i for i, ch in enumerate(piece) if ch != " " and (i == 0 or piece[i - 1] == " ")] or [0]
bounds = [0] + starts[1:] + [len(piece)]
cw, wstart = [], []
for w in range(len(bounds) - 1):
    cw += [w] * (bounds[w + 1] - bounds[w])
    wstart += [bounds[w]] * (bounds[w + 1] - bounds[w])
ids_t, cw_t, ws_t = torch.tensor([ids]), torch.tensor([cw]), torch.tensor([wstart])
with torch.no_grad():
    h, dur = TextStage(model)(ids_t)
    counts = torch.zeros_like(dur).scatter_add_(1, cw_t, dur).round().clamp(1, 250).long()[0, :cw[-1] + 1]
    frames = int(counts.sum())
    fw = torch.repeat_interleave(torch.arange(counts.numel()), counts)[:frames]
    fp = ((torch.arange(frames) - (counts.cumsum(0) - counts)[fw]).double() / counts[fw].double()).float()
    noise = torch.randn(1, len(model.times), frames, model.latent_dim, generator=torch.Generator().manual_seed(7))
    lat = SoundStage(model)(h, dur, cw_t, ws_t, fw[None], fp[None], noise)
    audio = DecodeStage(decoder)(lat)

stages = [
    ("ema_text.onnx", TextStage(model), (ids_t,), ["ids"], ["h", "dur"], {"ids": {1: "L"}, "h": {1: "L"}, "dur": {1: "L"}}),
    ("ema_sound.onnx", SoundStage(model), (h, dur, cw_t, ws_t, fw[None], fp[None], noise),
     ["h", "dur", "cw", "wstart", "fw", "fp", "noise"], ["latents"],
     {"h": {1: "L"}, "dur": {1: "L"}, "cw": {1: "L"}, "wstart": {1: "L"}, "fw": {1: "T"}, "fp": {1: "T"}, "noise": {2: "T"}, "latents": {1: "T"}}),
    ("ema_decoder.onnx", DecodeStage(decoder), (lat,), ["z"], ["audio"], {"z": {1: "T"}, "audio": {1: "S"}}),
]
for name, mod, args, inames, onames, axes in stages:
    torch.onnx.export(mod, args, os.path.join(OUT, name), input_names=inames, output_names=onames,
                      dynamic_axes=axes, opset_version=17, dynamo=False, do_constant_folding=True)
    print("yazıldı", name, round(os.path.getsize(os.path.join(OUT, name)) / 1e6, 1), "MB")

import onnxruntime as ort  # noqa: E402

so = ort.SessionOptions()
so.log_severity_level = 3
run = {n: ort.InferenceSession(os.path.join(OUT, n), so, providers=["CPUExecutionProvider"]) for n, *_ in stages}
oh, od = run["ema_text.onnx"].run(None, {"ids": ids_t.numpy()})
ol, = run["ema_sound.onnx"].run(None, {"h": h.numpy(), "dur": dur.numpy(), "cw": cw_t.numpy(), "wstart": ws_t.numpy(),
                                        "fw": fw[None].numpy(), "fp": fp[None].numpy(), "noise": noise.numpy()})
oa, = run["ema_decoder.onnx"].run(None, {"z": lat.numpy()})
diffs = {"h": np.abs(oh - h.numpy()).max(), "dur": np.abs(od - dur.numpy()).max(),
         "latents": np.abs(ol - lat.numpy()).max(), "audio": np.abs(oa - audio.numpy()).max()}
print("PyTorch farkı:", {k: float(v) for k, v in diffs.items()})
assert all(v < 1e-3 for v in diffs.values()), "ONNX çıktısı PyTorch'tan ayrışıyor"
json.dump({"vocab": model.vocab, "times": model.times, "latent_dim": model.latent_dim, "hop": decoder.hop, "rate": 48000, "fps": 25},
          open(os.path.join(OUT, "ema_config.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("tamam")
