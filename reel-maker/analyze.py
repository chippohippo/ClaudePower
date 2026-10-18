#!/usr/bin/env python3
"""
analyze.py — footage analysis for picking clean, couple-centred moments.

For each clip, sampled at --fps, writes <out>/<clip>.json with arrays:
  t       sample time (s)
  sharp   focus/blur score (variance of the Laplacian on a downscaled frame)
  motion  camera-motion score (mean abs difference vs the previous sample)
  subj    [cx, cy, left, right, top] of the detected couple (make_reel), or null

and optionally transcribes speech (faster-whisper) to <out>/<clip>.speech.json.

    python analyze.py footage/proxies --out analysis --fps 4
    python analyze.py footage/audio --speech --out analysis
"""

import argparse
import glob
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_reel as mr  # noqa: E402


def frames(path, fps, t0=0.0, t1=None, w=640):
    """Yield (t, rgb float32) at the given sample rate using one ffmpeg pipe."""
    cmd = ["ffmpeg", "-v", "error", "-ss", str(t0)]
    if t1:
        cmd += ["-t", str(t1 - t0)]
    cmd += ["-i", path, "-vf", f"fps={fps},scale={w}:-2", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    h = None
    i = 0
    while True:
        if h is None:
            out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                                  "stream=width,height", "-of", "csv=p=0", path],
                                 capture_output=True, text=True).stdout.strip().split(",")
            sw, sh = int(out[0]), int(out[1])
            h = int(round(w * sh / sw / 2) * 2)
        buf = p.stdout.read(w * h * 3)
        if len(buf) < w * h * 3:
            break
        yield t0 + i / fps, np.frombuffer(buf, np.uint8).reshape(h, w, 3).astype(np.float32) / 255
        i += 1


def analyze_clip(path, fps, ranges=None):
    import cv2
    res = {"t": [], "sharp": [], "motion": [], "subj": []}
    spans = ranges or [(0.0, None)]
    for a, b in spans:
        prev = None
        for t, img in frames(path, fps, a, b):
            dev = (np.clip(mr.develop(img), 0, 1) * 255).astype(np.uint8)
            g = cv2.cvtColor(dev, cv2.COLOR_RGB2GRAY)
            sharp = float(cv2.Laplacian(g, cv2.CV_64F).var())
            small = cv2.resize(g, (160, 90)).astype(np.float32)
            motion = float(np.abs(small - prev).mean()) if prev is not None else 0.0
            prev = small
            # find_subject expects the full-res proxy frame; it downsamples by 2
            big = cv2.resize(img, (img.shape[1] * 2, img.shape[0] * 2))
            s = mr.find_subject(big)
            res["t"].append(round(t, 3))
            res["sharp"].append(round(sharp, 1))
            res["motion"].append(round(motion, 2))
            res["subj"].append([round(v, 3) for v in s] if s else None)
    return res


def transcribe(path, model):
    from scipy.io import wavfile
    from scipy.signal import resample_poly
    sr, x = wavfile.read(path)
    x = x.astype(np.float32) / 32768
    x = x.mean(1) if x.ndim > 1 else x
    x = resample_poly(x, 16000, sr).astype(np.float32)   # whisper wants 16 kHz mono
    segs, _ = model.transcribe(x, vad_filter=True, word_timestamps=False)
    return [dict(start=round(s.start, 2), end=round(s.end, 2), text=s.text.strip(),
                 logprob=round(s.avg_logprob, 2), nospeech=round(s.no_speech_prob, 2)) for s in segs]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="folder of clips (.mp4) or audio (.wav)")
    ap.add_argument("--out", default="analysis")
    ap.add_argument("--fps", type=float, default=4)
    ap.add_argument("--speech", action="store_true")
    ap.add_argument("--only", nargs="+")
    ap.add_argument("--range", nargs="+", default=[], help="clip:a-b,a-b  limit analysis ranges")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rng = {}
    for r in a.range:
        c, spans = r.split(":")
        rng[c] = [tuple(float(v) for v in s.split("-")) for s in spans.split(",")]
    if a.speech:
        from faster_whisper import WhisperModel
        model = WhisperModel("small.en", device="cpu", compute_type="int8")
    for f in sorted(glob.glob(os.path.join(a.src, "*.wav" if a.speech else "*.mp4"))):
        clip = os.path.splitext(os.path.basename(f))[0]
        if a.only and clip not in a.only:
            continue
        out = os.path.join(a.out, clip + (".speech.json" if a.speech else ".json"))
        if os.path.exists(out):
            continue
        data = transcribe(f, model) if a.speech else analyze_clip(f, a.fps, rng.get(clip))
        json.dump(data, open(out, "w"))
        print(clip, len(data) if a.speech else len(data["t"]), flush=True)
