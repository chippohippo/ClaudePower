#!/usr/bin/env python3
"""
grade_shots.py — shot-matched cinematic grade for a finished edit.

Splits the edit at its cuts and, per shot:
  * measures exposure + white balance and pulls it partway to a shared target
    (so the whole piece reads as one afternoon),
  * bakes one 3D LUT = [optional camera LUT, e.g. S-Log3 → LC-709] → shot match
    → the "look" (make_reel.grade: filmic contrast, vibrance with skin
    protection, soft highlight shoulder, warm split tone),
  * adds halation + fine grain,
then concatenates frame-exactly and keeps (or replaces) the audio.
True blacks (letterbox bars, fades) are protected.

    python grade_shots.py in.mp4 out.mp4 [--audio mix.wav] [--still 4 30]
           [--sat 1.2 --warmth 0.55 --contrast 1.15 --match 0.5]
"""
import argparse
import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import make_reel as mr  # noqa: E402
from stabilize_shots import probe, shots  # noqa: E402

N = 33


def read_cube(path):
    size, rows = None, []
    for line in open(path):
        t = line.strip().split()
        if not t or t[0].startswith("#"):
            continue
        if t[0] == "LUT_3D_SIZE":
            size = int(t[1])
        elif len(t) == 3:
            try:
                rows.append([float(v) for v in t])
            except ValueError:
                pass
    return np.array(rows, np.float32).reshape(size, size, size, 3)  # [b][g][r]


def apply_cube(rgb, cube):
    """Trilinear lookup of rgb (…,3 in 0..1) through a .cube table."""
    n = cube.shape[0]
    x = np.clip(rgb, 0, 1) * (n - 1)
    i0 = np.floor(x).astype(int).clip(0, n - 2)
    f = x - i0
    r0, g0, b0 = i0[..., 0], i0[..., 1], i0[..., 2]
    fr, fg, fb = f[..., 0:1], f[..., 1:2], f[..., 2:3]
    out = 0
    for db in (0, 1):
        for dg in (0, 1):
            for dr in (0, 1):
                w = (fr if dr else 1 - fr) * (fg if dg else 1 - fg) * (fb if db else 1 - fb)
                out = out + w * cube[b0 + db, g0 + dg, r0 + dr]
    return out


def identity():
    g = np.linspace(0, 1, N, dtype=np.float32)
    b, gg, r = np.meshgrid(g, g, g, indexing="ij")
    return np.stack([r, gg, b], -1).reshape(N * N, N, 3)


CHROMA = 1.0


def bake(path, match, pre=None):
    src = identity()
    x = apply_cube(src, pre) if pre is not None else src
    out = mr.grade(x, match).reshape(-1, 3)
    if CHROMA != 1.0:                                      # overall colour intensity
        luma = (out @ mr.LUMA)[:, None]
        out = luma + (out - luma) * CHROMA
    s = src.reshape(-1, 3)
    k = np.clip(s.max(1, keepdims=True) / 0.04, 0, 1)      # protect true black
    out = s * (1 - k) + out * k
    with open(path, "w") as f:
        f.write(f"LUT_3D_SIZE {N}\n")
        np.savetxt(f, out, fmt="%.5f")


def frame(src, t, w=480):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", src, "-frames:v", "1",
                          "-vf", f"scale={w}:-2", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True).stdout
    h = len(raw) // (w * 3)
    return np.frombuffer(raw[: w * h * 3], np.uint8).reshape(h, w, 3).astype(np.float32) / 255


def shot_match(src, a, b, fps, pre, strength):
    """Average exposure/WB correction for a shot, scaled by strength."""
    ms = []
    for t in np.linspace(a / fps, b / fps, 5)[1:-1]:
        img = frame(src, t)
        if img.max() < 0.08:                    # fade / black card
            continue
        x = apply_cube(img, pre) if pre is not None else img
        if (x.max(2) < 0.04).mean() > 0.25:     # mostly letterbox: measure picture only
            x = x[x.max(2) >= 0.04][None]
        ms.append(mr.measure(x))
    if not ms:
        return 1.0, np.ones(3, np.float32)
    gain = float(np.exp(np.mean([np.log(m[0]) for m in ms])))
    wb = np.mean([m[1] for m in ms], 0)
    gain = gain ** strength
    wb = 1 + (wb - 1) * strength
    return gain, (wb / (wb @ mr.LUMA)).astype(np.float32)


def look_vf(lut, w, halation, grain):
    return (f"lut3d=file={lut}:interp=tetrahedral,"
            f"split[a][b];[b]colorlevels=rimin=0.74:gimin=0.76:bimin=0.80,gblur=sigma={w / 80:.1f},"
            f"colorchannelmixer=rr=1:gg=0.55:bb=0.3[g];[a][g]blend=all_mode=screen:all_opacity={halation},"
            f"noise=c0s={grain}:c0f=t+u")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--audio")
    ap.add_argument("--pre-lut", help="camera LUT applied first (e.g. S-Log3 → 709)")
    ap.add_argument("--sat", type=float, default=1.2)
    ap.add_argument("--warmth", type=float, default=0.55)
    ap.add_argument("--contrast", type=float, default=1.15)
    ap.add_argument("--match", type=float, default=0.5, help="0 = no shot matching, 1 = full")
    ap.add_argument("--luma", type=float, default=0.42, help="exposure target (median luma)")
    ap.add_argument("--halation", type=float, default=0.10)
    ap.add_argument("--grain", type=int, default=5)
    ap.add_argument("--chroma", type=float, default=1.0, help="overall colour intensity (1 = as graded)")
    ap.add_argument("--still", type=float, nargs="+")
    ap.add_argument("--crf", type=int, default=15)
    a = ap.parse_args()
    mr.CONFIG.update(log_footage=False, saturation=a.sat, warmth=a.warmth, contrast=a.contrast,
                     match_luma=a.luma, match_wb=1.0)
    global CHROMA
    CHROMA = a.chroma
    pre = read_cube(a.pre_lut) if a.pre_lut else None
    n, fps = probe(a.src)
    w = int(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width",
                            "-of", "csv=p=0", a.src], capture_output=True, text=True).stdout)
    rng = shots(a.src, fps, n)
    tmp = tempfile.mkdtemp(prefix="grade_")
    if a.still:
        for t in a.still:
            f = int(t * fps)
            s, e = next((s, e) for s, e in rng if s <= f < e)
            lut = os.path.join(tmp, "still.cube")
            bake(lut, shot_match(a.src, s, e, fps, pre, a.match), pre)
            p = f"{os.path.splitext(a.out)[0]}_{t:05.1f}.png"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t}", "-i", a.src, "-frames:v", "1",
                            "-filter_complex", look_vf(lut, w, a.halation, 0), p], check=True)
            print("wrote", p)
        return
    parts = []
    for i, (s, e) in enumerate(rng):
        lut = os.path.join(tmp, f"s{i:03d}.cube")
        m = shot_match(a.src, s, e, fps, pre, a.match)
        bake(lut, m, pre)
        p = os.path.join(tmp, f"s{i:03d}.mkv")
        vf = look_vf(lut, w, a.halation, a.grain)
        # seek straight to the shot (accurate seek) and take exactly its frames
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{s / fps:.6f}", "-i", a.src,
                        "-filter_complex", vf, "-frames:v", str(e - s), "-an",
                        "-c:v", "ffv1", "-pix_fmt", "yuv420p", p], check=True)
        parts.append(p)
        print(f"  shot {i:3d} {s / fps:7.2f}s  exposure x{m[0]:.2f}  wb {np.round(m[1], 3)}", flush=True)
    lst = os.path.join(tmp, "list.txt")
    with open(lst, "w") as f:
        f.writelines(f"file '{p}'\n" for p in parts)
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst]
    cmd += ["-i", a.audio] if a.audio else ["-i", a.src]
    cmd += ["-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", str(a.crf),
            "-tune", "film", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", f"{fps}",
            "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", a.out]
    subprocess.run(cmd, check=True)
    print("✓", a.out, probe(a.out)[0], "frames (source", n, ")")


if __name__ == "__main__":
    main()
