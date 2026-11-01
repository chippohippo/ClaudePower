#!/usr/bin/env python3
"""
polish_edit.py — improve a finished edit shot by shot, without re-cutting it.

Per shot (cut list given explicitly, so dark or handheld footage can't fool
scene detection):
  * stabilisation: tries none, vidstab smooth / heavy and the feature-tracked
    stabiliser (motion.py: background-only camera path, at most a few % crop)
    and keeps the steadiest result without black borders,
  * grade: one baked 3D LUT per shot = gamma exposure lift + white balance
    from neutral pixels, pulled toward a shared target (strength --match) →
    the look (make_reel.grade), with true blacks protected,
  * finishing: temporal denoise (lifted dusk footage gets noisy), halation,
    fine grain.
A tail range (e.g. a title card) can be passed through untouched. The audio is
kept as is (optionally loudness-normalised).

    python polish_edit.py in.mp4 out.mp4 --cuts 4.37 11.28 ... --keep-from 202.2
           [--still 20 120 ...]  (writes graded stills next to out.mp4)
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import make_reel as mr  # noqa: E402
import grade_shots as gs  # noqa: E402
from motion import AW, gray_frames, plan, shake, shake_peak, trajectory  # noqa: E402


def run(cmd):
    subprocess.run(cmd, check=True)


def probe(src):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                          "stream=width,height,r_frame_rate,nb_frames", "-of", "json", src],
                         capture_output=True, text=True).stdout
    s = json.loads(out)["streams"][0]
    num, den = map(int, s["r_frame_rate"].split("/"))
    return s["width"], s["height"], num / den, s["r_frame_rate"]


def extract(src, a, n, path, fps_s, vf=None):
    """Exactly n frames from frame a (accurate seek), lossless."""
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.6f}", "-i", src, "-frames:v", str(n), "-an"]
    if vf:
        cmd += ["-vf", vf]
    run(cmd + ["-r", fps_s, "-c:v", "ffv1", "-pix_fmt", "yuv420p", path])


def score(path):
    F = gray_frames(path)
    if len(F) < 8:
        return 0.0, 0.0
    G = F.astype(np.float32)
    c = np.concatenate([G[:, :10, :10], G[:, :10, -10:], G[:, -10:, :10], G[:, -10:, -10:]], 1)
    return shake(F) + 2 * shake_peak(F), float((c < 10).mean(axis=(1, 2)).max())


def cv_stab(src, out, W, H, fps_s, smax):
    import cv2
    tr, _ = trajectory(gray_frames(src))
    mats, label, s = plan(tr, W / AW, (0, 0, W, H), (W, H), smax=smax)
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "yuv444p", "-"],
                           stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "yuv444p",
                            "-s", f"{W}x{H}", "-r", fps_s, "-i", "-", "-c:v", "ffv1", "-pix_fmt", "yuv420p", out],
                           stdin=subprocess.PIPE)
    n, k = W * H * 3, 0
    while True:
        buf = dec.stdout.read(n)
        if len(buf) < n:
            break
        fr = np.frombuffer(buf, np.uint8).reshape(3, H, W)
        M = mats[min(k, len(mats) - 1)]
        enc.stdin.write(np.stack([cv2.warpAffine(fr[c], M, (W, H), flags=cv2.INTER_CUBIC,
                                                 borderMode=cv2.BORDER_REFLECT101) for c in range(3)]).tobytes())
        k += 1
    enc.stdin.close()
    dec.wait()
    enc.wait()
    return f"{label} ×{s:.3f}"


def stabilise(raw, tmp, i, W, H, fps_s, nfr, smax):
    """Best of none / vidstab smooth / vidstab heavy / cv; returns (path, label)."""
    res = {"none": (raw, score(raw), "")}
    trf = os.path.join(tmp, f"s{i:03d}.trf")
    run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-vf",
         f"vidstabdetect=shakiness=8:accuracy=15:stepsize=6:result={trf}", "-f", "null", "-"])
    base = f"vidstabtransform=input={trf}:optzoom=1:crop=black:interpol=bicubic"
    for m, vf in (("smooth", f"{base}:smoothing={min(45, max(10, nfr // 2))}"),
                  ("heavy", f"{base}:smoothing={max(30, nfr)}")):
        p = os.path.join(tmp, f"s{i:03d}_{m}.mkv")
        run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-vf", vf, "-c:v", "ffv1", "-pix_fmt", "yuv420p", p])
        res[m] = (p, score(p), "")
    p = os.path.join(tmp, f"s{i:03d}_cv.mkv")
    lab = cv_stab(raw, p, W, H, fps_s, smax)
    res["cv"] = (p, score(p), lab)
    j0, c0 = res["none"][1]
    ok = {m: r for m, r in res.items() if m != "none" and r[1][1] <= c0 + 0.02}
    best = min(ok, key=lambda m: ok[m][1][0]) if ok else "none"
    if best != "none" and ok[best][1][0] > j0 * 0.97:
        best = "none"
    txt = "  ".join(f"{m} {r[1][0]:.2f}" for m, r in res.items())
    for m, r in res.items():
        if m not in ("none", best) and os.path.exists(r[0]):
            os.remove(r[0])
    return res[best][0], f"{txt}  → {best} {res[best][2]}"


def shot_measure(src, s, e, fps, a):
    """Exposure as a gamma (mid-tones lifted to the target, highlights kept)
    and white balance from near-neutral pixels only (white shirt, dress,
    stone, path) — grey-world over a garden would read the foliage as a cast
    and push everything magenta."""
    meds, neut = [], []
    for t in np.linspace(s / fps, e / fps, 6)[1:-1]:
        img = gs.frame(src, t)
        if img.max() < 0.08:
            continue
        L = img @ mr.LUMA
        meds.append(float(np.median(L)))
        mx, mn = img.max(2), img.min(2)
        sat = (mx - mn) / np.maximum(mx, 1e-3)
        m = (sat < 0.18) & (L > 0.12) & (L < 0.9)
        if m.sum() > 200:
            neut.append(img[m].mean(0))
    if not meds:
        return 1.0, np.ones(3, np.float32)
    med = float(np.median(meds))
    # gamma that maps the shot's median luma to the target, partially
    g = np.log(max(med, 0.02)) / np.log(a.luma)
    g = float(np.clip(1 + (g - 1) * a.match, 1.0, a.max_gamma))
    wb = np.ones(3, np.float32)
    if neut:
        mean = np.mean(neut, 0)
        wb = (mean.mean() / np.maximum(mean, 1e-3)).astype(np.float32)
        wb = 1 + (wb - 1) * a.wb
        wb = (wb / (wb @ mr.LUMA)).astype(np.float32)
    return g, wb


def bake(path, g, wb, a):
    """LUT: gamma lift → white balance → the look → chroma → black protection."""
    src = gs.identity()
    x = np.clip(src, 0, 1) ** (1.0 / g)
    x = x * wb
    out = mr.grade(x, (1.0, np.ones(3, np.float32))).reshape(-1, 3)
    if a.chroma != 1.0:
        luma = (out @ mr.LUMA)[:, None]
        out = luma + (out - luma) * a.chroma
    s = src.reshape(-1, 3)
    k = np.clip(s.max(1, keepdims=True) / 0.03, 0, 1)
    out = s * (1 - k) + np.clip(out, 0, 1) * k
    with open(path, "w") as f:
        f.write(f"LUT_3D_SIZE {gs.N}\n")
        np.savetxt(f, out, fmt="%.5f")


def look_vf(lut, W, a):
    d = a.denoise
    pre = f"hqdn3d={d}:{d * 0.8:.2f}:{d * 2.5:.2f}:{d * 2.5:.2f}," if d > 0 else ""
    return (f"{pre}lut3d=file={lut}:interp=tetrahedral,"
            f"split[a][b];[b]colorlevels=rimin=0.70:gimin=0.72:bimin=0.76,gblur=sigma={W / 80:.1f},"
            f"colorchannelmixer=rr=1:gg=0.55:bb=0.3[g];[a][g]blend=all_mode=screen:all_opacity={a.halation},"
            f"vignette=angle={a.vignette}:mode=forward,noise=c0s={a.grain}:c0f=t+u,format=yuv420p")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--cuts", type=float, nargs="+", required=True, help="cut times (s)")
    ap.add_argument("--keep-from", type=float, help="pass this tail through untouched (title card)")
    ap.add_argument("--sat", type=float, default=1.0)
    ap.add_argument("--warmth", type=float, default=0.45)
    ap.add_argument("--contrast", type=float, default=1.1)
    ap.add_argument("--luma", type=float, default=0.32, help="target median luma")
    ap.add_argument("--match", type=float, default=0.7, help="exposure pull toward --luma (0..1)")
    ap.add_argument("--max-gamma", type=float, default=2.0)
    ap.add_argument("--wb", type=float, default=0.6, help="white-balance correction strength")
    ap.add_argument("--chroma", type=float, default=1.0)
    ap.add_argument("--denoise", type=float, default=3.0)
    ap.add_argument("--halation", type=float, default=0.08)
    ap.add_argument("--vignette", type=float, default=0.25)
    ap.add_argument("--grain", type=int, default=3)
    ap.add_argument("--smax", type=float, default=1.06, help="max stabiliser crop")
    ap.add_argument("--no-stab", action="store_true")
    ap.add_argument("--still", type=float, nargs="+")
    ap.add_argument("--crf", type=int, default=17)
    a = ap.parse_args()
    mr.CONFIG.update(log_footage=False, saturation=a.sat, warmth=a.warmth, contrast=a.contrast,
                     match_luma=a.luma, match_wb=1.0)
    gs.CHROMA = a.chroma
    W, H, fps, fps_s = probe(a.src)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                a.src], capture_output=True, text=True).stdout)
    n = int(round(dur * fps))
    end = int(round(a.keep_from * fps)) if a.keep_from else n
    b = [0] + [int(round(t * fps)) for t in sorted(a.cuts) if 0 < t * fps < end] + [end]
    rng = list(zip(b[:-1], b[1:]))
    tmp = tempfile.mkdtemp(prefix="polish_", dir=os.path.dirname(os.path.abspath(a.out)))

    if a.still:
        a.grain = 0
        for t in a.still:
            f = int(t * fps)
            s, e = next((s, e) for s, e in rng if s <= f < e)
            lut = os.path.join(tmp, "still.cube")
            g, wb = shot_measure(a.src, s, e, fps, a)
            bake(lut, g, wb, a)
            print(f"  {t}: gamma {g:.2f} wb {np.round(wb, 3)}")
            p = f"{os.path.splitext(a.out)[0]}_{t:05.1f}.png"
            run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t}", "-i", a.src, "-frames:v", "1",
                 "-filter_complex", look_vf(lut, W, a), p])
            print("wrote", p)
        return

    parts = []
    for i, (s, e) in enumerate(rng):
        raw = os.path.join(tmp, f"s{i:03d}_raw.mkv")
        extract(a.src, s / fps, e - s, raw, fps_s)
        lab = "too short"
        stab = raw
        if not a.no_stab and e - s >= 15:
            stab, lab = stabilise(raw, tmp, i, W, H, fps_s, e - s, a.smax)
        lut = os.path.join(tmp, f"s{i:03d}.cube")
        g, wb = shot_measure(a.src, s, e, fps, a)
        bake(lut, g, wb, a)
        p = os.path.join(tmp, f"s{i:03d}.mkv")
        run(["ffmpeg", "-v", "error", "-y", "-i", stab, "-filter_complex", look_vf(lut, W, a),
             "-frames:v", str(e - s), "-an", "-r", fps_s, "-c:v", "libx264", "-preset", "fast", "-crf", "8",
             "-pix_fmt", "yuv420p", p])
        for q in {raw, stab}:
            if os.path.exists(q):
                os.remove(q)
        parts.append(p)
        print(f"  shot {i:2d} {s / fps:7.2f}-{e / fps:7.2f}s  gamma {g:.2f}  stab: {lab}", flush=True)
    if end < n:
        p = os.path.join(tmp, "tail.mkv")
        extract(a.src, end / fps, n - end, p, fps_s)
        parts.append(p)
    # concat *filter* (not the demuxer): the parts' H.264 headers differ (the
    # passed-through tail especially), which the demuxer can't splice
    ins = sum((["-i", p] for p in parts), [])
    fc = "".join(f"[{k}:v]" for k in range(len(parts))) + f"concat=n={len(parts)}:v=1:a=0[v]"
    run(["ffmpeg", "-v", "error", "-y", *ins, "-i", a.src, "-filter_complex", fc,
         "-map", "[v]", "-map", f"{len(parts)}:a", "-c:v", "libx264", "-preset", "slow", "-crf", str(a.crf),
         "-tune", "film", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", fps_s,
         "-c:a", "copy", "-shortest", "-movflags", "+faststart",
         "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", a.out])
    for p in parts:
        os.remove(p)
    print("✓", a.out)


if __name__ == "__main__":
    main()
