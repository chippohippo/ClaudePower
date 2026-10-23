#!/usr/bin/env python3
"""
stabilize_shots.py — stabilise a finished edit shot by shot.

Detects the cuts, measures each shot's shake, and runs a two-pass vidstab on
every shaky shot independently (so smoothing never drags across a cut).
Letterboxed / split-screen graphic shots and steady shots are left untouched.
Frame-exact: the output has the same frame count and timing as the input.

    python stabilize_shots.py in.mp4 out.mp4 [--min-shake 0.3]
"""
import argparse
import os
import re
import subprocess
import tempfile

import cv2
import numpy as np


def run(cmd):
    subprocess.run(cmd, check=True)


def probe(src):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-count_frames",
                          "-show_entries", "stream=nb_read_frames,r_frame_rate", "-of", "csv=p=0", src],
                         capture_output=True, text=True).stdout.strip().split(",")
    num, den = map(int, out[0].split("/"))
    return int(out[1]), num / den


def shots(src, fps, n):
    log = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf",
                          "scale=270:480,scdet=threshold=12,metadata=print:file=-", "-an", "-f", "null", "-"],
                         capture_output=True, text=True).stdout
    cuts = sorted({int(round(float(t) * fps)) for t in re.findall(r"lavfi.scd.time=([0-9.]+)", log)})
    b = [0] + [c for c in cuts if 0 < c < n] + [n]
    return list(zip(b[:-1], b[1:]))


def measure(src, ranges):
    w, h = 135, 240
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", f"scale={w}:{h},format=gray",
                          "-f", "rawvideo", "-"], capture_output=True).stdout
    F = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32)
    info = []
    for a, b in ranges:
        fr = F[a + 1:b - 1:3]
        if len(fr) < 4:
            info.append((False, 0.0))
            continue
        bars = fr[:, : int(h * 0.12)].mean() < 8 or fr[:, -int(h * 0.12):].mean() < 8
        sh = np.array([cv2.phaseCorrelate(fr[k], fr[k + 1])[0] for k in range(len(fr) - 1)])
        jit = float(np.abs(np.diff(sh, axis=0)).mean()) if len(sh) > 2 else 0.0
        info.append((bars, jit))
    return info


def borders(cand, src, s, e):
    """True if the stabilised shot shows black corners the original doesn't."""
    def corners(path, sel=None):
        vf = (f"{sel}," if sel else "") + "scale=90:160,format=gray"
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", vf, "-f", "rawvideo", "-"],
                             capture_output=True).stdout
        F = np.frombuffer(raw, np.uint8).reshape(-1, 160, 90).astype(np.float32)
        c = np.concatenate([F[:, :12, :12], F[:, :12, -12:], F[:, -12:, :12], F[:, -12:, -12:]], 1)
        return (c < 10).mean(axis=(1, 2))
    a = corners(cand)
    b = corners(src, f"select='between(n\\,{s}\\,{e - 1})'")
    m = min(len(a), len(b))
    return bool((a[:m] - b[:m] > 0.15).any())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--min-shake", type=float, default=0.3)
    a = ap.parse_args()
    n, fps = probe(a.src)
    rng = shots(a.src, fps, n)
    info = measure(a.src, rng)
    tmp = tempfile.mkdtemp(prefix="stab_")
    parts = []
    for i, ((s, e), (bars, jit)) in enumerate(zip(rng, info)):
        p = os.path.join(tmp, f"s{i:03d}.mkv")
        sel = f"select='between(n\\,{s}\\,{e - 1})',setpts=N/FRAME_RATE/TB"
        do = (not bars) and jit >= a.min_shake and e - s >= 10
        if do:
            # try several stabilisers; keep the steadiest result that is clearly
            # better than the original and shows no black borders
            trf = os.path.join(tmp, f"s{i:03d}.trf")
            run(["ffmpeg", "-v", "error", "-y", "-i", a.src, "-vf",
                 f"{sel},vidstabdetect=shakiness=10:accuracy=15:stepsize=4:mincontrast=0.2:result={trf}",
                 "-f", "null", "-"])
            sm = max(6, min(30, (e - s) // 2))
            base = f"input={trf}:optzoom=1:crop=black:interpol=bicubic"
            cands = {"smooth": f"vidstabtransform={base}:smoothing={sm}:zoomspeed=0.1",
                     "heavy": f"vidstabtransform={base}:smoothing={e - s}",
                     "tripod": f"vidstabtransform={base}:tripod=1"}
            best, best_j = None, jit * 0.85
            for k, vfx in cands.items():
                cp = os.path.join(tmp, f"s{i:03d}_{k}.mkv")
                run(["ffmpeg", "-v", "error", "-y", "-i", a.src, "-vf", f"{sel},{vfx},unsharp=5:5:0.3",
                     "-an", "-c:v", "ffv1", cp])
                j = measure(cp, [(0, e - s)])[0][1]
                if j < best_j and not borders(cp, a.src, s, e):
                    best, best_j = cp, j
            if best:
                os.replace(best, p)
                jit = (jit, best_j)
            else:
                run(["ffmpeg", "-v", "error", "-y", "-i", a.src, "-vf", sel, "-an", "-c:v", "ffv1", p])
                do = None
        else:
            run(["ffmpeg", "-v", "error", "-y", "-i", a.src, "-vf", sel, "-an", "-c:v", "ffv1", p])
        parts.append(p)
        state = ("bars, kept" if bars else "STABILISED" if do else
                 "stabilising didn't help, kept original" if do is None else "steady, kept")
        sh = f"{jit[0]:.2f} → {jit[1]:.2f}" if isinstance(jit, tuple) else f"{jit:.2f}"
        print(f"  shot {i:2d}  {s / fps:6.2f}-{e / fps:6.2f}s  shake {sh}  {state}", flush=True)
    lst = os.path.join(tmp, "list.txt")
    with open(lst, "w") as f:
        f.writelines(f"file '{p}'\n" for p in parts)
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-i", a.src,
         "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-crf", "12", "-preset", "medium",
         "-r", f"{fps}", "-c:a", "copy", a.out])
    print("✓", a.out, probe(a.out)[0], "frames (source", n, ")")


if __name__ == "__main__":
    main()
