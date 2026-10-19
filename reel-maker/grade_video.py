#!/usr/bin/env python3
"""
grade_video.py — regrade an already-edited (Rec.709) video with the reel
colour science: vibrance with skin protection, filmic contrast, soft highlight
roll-off (nothing blows out), warm split-tone, halation and fine grain.
True blacks (letterbox bars, fades) are preserved. Optionally swaps in a
cleaned audio track.

    python grade_video.py in.mp4 out.mp4 [--audio clean.wav] [--still 12 40]
"""
import argparse
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_reel as mr  # noqa: E402


def bake(path, n=33, sat=1.0, warmth=1.0, contrast=1.0):
    mr.CONFIG.update(log_footage=False, saturation=sat, warmth=warmth, contrast=contrast)
    g = np.linspace(0, 1, n, dtype=np.float32)
    b, gg, r = np.meshgrid(g, g, g, indexing="ij")
    rgb = np.stack([r, gg, b], -1).reshape(n * n, n, 3)
    out = mr.grade(rgb).reshape(-1, 3)
    src = rgb.reshape(-1, 3)
    # protect true black: below ~4 % input, blend back toward the source
    k = np.clip(src.max(1, keepdims=True) / 0.04, 0, 1)
    out = src * (1 - k) + out * k
    with open(path, "w") as f:
        f.write(f"LUT_3D_SIZE {n}\n")
        np.savetxt(f, out, fmt="%.5f")


def vf(lut, w, halation=0.10, grain=5):
    return (f"lut3d=file={lut}:interp=tetrahedral,"
            f"split[a][b];[b]colorlevels=rimin=0.74:gimin=0.76:bimin=0.80,gblur=sigma={w / 80:.1f},"
            f"colorchannelmixer=rr=1:gg=0.55:bb=0.3[g];[a][g]blend=all_mode=screen:all_opacity={halation},"
            f"noise=c0s={grain}:c0f=t+u,format=yuv420p")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--audio")
    ap.add_argument("--sat", type=float, default=1.0)
    ap.add_argument("--warmth", type=float, default=1.0)
    ap.add_argument("--contrast", type=float, default=1.0)
    ap.add_argument("--still", type=float, nargs="+")
    a = ap.parse_args()
    lut = os.path.splitext(a.out)[0] + ".cube"
    bake(lut, sat=a.sat, warmth=a.warmth, contrast=a.contrast)
    w = int(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                            "stream=width", "-of", "csv=p=0", a.src], capture_output=True, text=True).stdout)
    if a.still:
        for t in a.still:
            p = f"{os.path.splitext(a.out)[0]}_{t:05.1f}.png"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", a.src, "-frames:v", "1",
                            "-filter_complex", vf(lut, w).replace(",format=yuv420p", ""), p], check=True)
            print("wrote", p)
        sys.exit()
    cmd = ["ffmpeg", "-v", "error", "-stats", "-y", "-i", a.src]
    if a.audio:
        cmd += ["-i", a.audio]
    cmd += ["-filter_complex", vf(lut, w) + "[v]", "-map", "[v]", "-map", "1:a" if a.audio else "0:a",
            "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-tune", "film", "-profile:v", "high",
            "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", a.out]
    subprocess.run(cmd, check=True)
    print("✓", a.out)
