#!/usr/bin/env python3
"""
film.py — long-form cinematic film renderer (3:2 by default), pure-FFmpeg
pipeline driven by an edit decision list (EDL) in JSON.

Where make_reel.py composites every frame in numpy (great for 60 s reels),
film.py renders each segment with one FFmpeg pass, so a 4–5 minute 1440p film
renders in a fraction of the time:

  segment:  trim ─► vidstab (2-pass) ─► tempo (real / dream 80 % / step-print)
            ─► 3:2 reframe + slow push ─► per-shot baked 3D LUT (the same
            colour science as make_reel.grade, incl. shot matching)
            ─► halation ─► vignette ─► grain ─► 23.976 fps
  assemble: cuts / dissolves / dips to black (xfade chain) ─► title
  audio:    camera (diegetic) audio per segment + score, with ducking

    python film.py films/tyler_sarah_3x2/edit.json            # full render
    python film.py films/tyler_sarah_3x2/edit.json --preview  # 810x540 draft
    python film.py films/tyler_sarah_3x2/edit.json --cues     # print music cues

EDL format: see films/tyler_sarah_3x2/edit.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys

import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_reel as mr  # noqa: E402  (shares the grade / matching code)
sys.path.insert(0, os.path.join(HERE, "tools"))
from grade_shots import apply_cube, read_cube  # noqa: E402

_PRE = {}


def pre_lut():
    """Optional camera LUT (e.g. S-Log3 → LC-709) applied before the look."""
    p = FILM.get("pre_lut")
    if not p:
        return None
    if p not in _PRE:
        _PRE[p] = read_cube(p)
    return _PRE[p]


def out_size(preview):
    A = FILM["width"] / FILM["height"]
    if preview:
        return int(round(540 * A / 2) * 2), 540
    return FILM["width"], FILM["height"]

FILM = {
    "width": 2160, "height": 1440,       # 3:2 master
    "fps": "24000/1001",
    "crf": 17, "preset": "slow",
    "dream_speed": 0.8,                  # 29.97 -> 23.976 conform
    "grain": 7,                          # ffmpeg noise strength (luma)
    "vignette": 0.55,                    # radians-ish angle for ffmpeg vignette
    "halation": 0.14,                    # screen-blend opacity of the glow
    "stabilize": True,
    "lut_size": 33,
    "audio_sr": 48000,
}


def run(cmd, quiet=True):
    r = subprocess.run(cmd, capture_output=quiet, text=True)
    if r.returncode:
        print(r.stderr[-2000:] if quiet else "")
        raise SystemExit(f"ffmpeg failed: {' '.join(cmd[:6])} ...")


def probe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", path], capture_output=True, text=True).stdout
    return float(out.strip() or 0)


# ════════════════════════════════════════════════════════════════════════════
#  Colour: bake make_reel.grade (+ per-shot matching) into a .cube LUT
# ════════════════════════════════════════════════════════════════════════════
def bake_lut(path, match, sat_scale=1.0):
    n = FILM["lut_size"]
    g = np.linspace(0, 1, n, dtype=np.float32)
    # .cube order: red fastest, then green, then blue
    b, gg, r = np.meshgrid(g, g, g, indexing="ij")
    rgb = np.stack([r, gg, b], -1).reshape(n * n, n, 3)
    saved = mr.CONFIG["saturation"]
    mr.CONFIG["saturation"] = saved * sat_scale
    src = rgb
    pre = pre_lut()
    if pre is not None:
        rgb = apply_cube(rgb, pre)
    out = mr.grade(rgb, match).reshape(-1, 3)
    mr.CONFIG["saturation"] = saved
    ch = FILM.get("chroma", 1.0)                # overall colour intensity
    if ch != 1.0:
        luma = (out @ mr.LUMA)[:, None]
        out = luma + (out - luma) * ch
    s = src.reshape(-1, 3)                      # protect true black
    k = np.clip(s.max(1, keepdims=True) / 0.04, 0, 1)
    out = s * (1 - k) + out * k
    with open(path, "w") as f:
        f.write(f"LUT_3D_SIZE {n}\n")
        np.savetxt(f, out, fmt="%.5f")


def sample_frame(path, t):
    """Grab one frame as float RGB (downscaled) for exposure/WB matching."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", path,
                          "-frames:v", "1", "-vf", "scale=480:-2", "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    w = 480
    h = len(raw) // (w * 3)
    return np.frombuffer(raw[: w * h * 3], np.uint8).reshape(h, w, 3).astype(np.float32) / 255


# ════════════════════════════════════════════════════════════════════════════
#  Segment rendering
# ════════════════════════════════════════════════════════════════════════════
def stab_filter(trf, mode, nframes):
    base = f"vidstabtransform=input={trf}:optzoom=1:crop=black:interpol=bicubic"
    if mode == "lock":
        return base + ":tripod=1"
    if mode == "heavy":
        return base + f":smoothing={max(30, nframes)}"
    return base + f":smoothing={min(45, max(10, nframes // 2))}"


def _jitter(path):
    """Shake score of a rendered candidate: camera-path wobble + 2 × the worst
    1-second stretch of frame-to-frame jerk (robust feature tracking, so
    moving people don't count as camera shake); and the largest black-corner
    fraction (stabiliser borders)."""
    from motion import gray_frames, shake, shake_peak
    F = gray_frames(path)
    if len(F) < 8:
        return 0.0, 0.0
    score = shake(F) + 2 * shake_peak(F)
    G = F.astype(np.float32)
    c = np.concatenate([G[:, :12, :12], G[:, :12, -12:], G[:, -12:, :12], G[:, -12:, -12:]], 1)
    return score, float((c < 12).mean(axis=(1, 2)).max())


def _window(seg, rw, rh):
    """Output window (x0, y0, x1, y1) in render px at the widest zoom,
    covering the whole pan — what the stabiliser must keep filled."""
    W, H = out_size(False)
    A = W / H
    base_w = min(rw, rh * A)
    z0, z1 = seg.get("zoom", [1.0, 1.06]) if isinstance(seg.get("zoom"), list) \
        else (1.0, 1.0 + seg.get("zoom", 0.06))
    zw = base_w / min(z0, z1)
    zh = zw / A
    xs = [seg.get("x", 0.5), seg.get("x_end", seg.get("x", 0.5))]
    X = [max(0, min(rw - zw, x * rw - zw / 2)) for x in xs]
    Y0 = max(0, min(rh - zh, seg.get("y", 0.5) * rh - zh / 2))
    return min(X), Y0, max(X) + zw, Y0 + zh


def cv_stabilize(seg, src, t_in, src_dur, w, h, out):
    """Feature-tracked stabilisation (motion.py): background-only camera path,
    smoothest path that fits the crop margin, at most a few % extra zoom
    (1.03 on couple framing so shoulders stay in). Writes a stabilised
    intermediate at render height; returns a log label."""
    from motion import gray_frames, trajectory, plan, AW
    rh = FILM["height"]
    rw = int(round(w * rh / h / 2) * 2)
    tr, _ = trajectory(gray_frames(src, t_in, src_dur))
    smax = 1.03 if seg.get("lock") else 1.10
    mats, label, s = plan(tr, rw / AW, _window(seg, rw, rh), (rw, rh), smax=smax,
                          locked=bool(seg.get("lock")))
    import cv2
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{t_in}", "-t", f"{src_dur}", "-i", src,
                            "-vf", f"scale={rw}:{rh}:flags=lanczos", "-f", "rawvideo", "-pix_fmt", "yuvj444p",
                            "-"], stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "yuvj444p",
                            "-s", f"{rw}x{rh}", "-r", FILM["fps"], "-i", "-", "-c:v", "libx264",
                            "-preset", "veryfast", "-crf", "6", "-pix_fmt", "yuvj420p", out],
                           stdin=subprocess.PIPE)
    n = rw * rh * 3
    k = 0
    while True:
        buf = dec.stdout.read(n)
        if len(buf) < n:
            break
        fr = np.frombuffer(buf, np.uint8).reshape(3, rh, rw)
        M = mats[min(k, len(mats) - 1)]
        o = np.stack([cv2.warpAffine(fr[c], M, (rw, rh), flags=cv2.INTER_CUBIC,
                                     borderMode=cv2.BORDER_REFLECT101) for c in range(3)])
        enc.stdin.write(o.tobytes())
        k += 1
    enc.stdin.close()
    dec.wait()
    enc.wait()
    return f"{label} ×{s:.3f}"


def seg_filters(seg, src_w, src_h, out_dur, lut, trf, preview):
    W, H = out_size(preview)
    A = W / H
    f = [f"scale=-2:{H}:flags=lanczos"]
    src_w, src_h = src_w * H / src_h, H
    if trf:
        f.append(stab_filter(trf, seg.get("_stab_mode", "lock" if seg.get("lock") else "smooth"),
                             int(out_dur * 30)))
    if FILM.get("denoise", 0) > 0:              # temporal smoothing of sensor noise
        d = FILM["denoise"]
        f.append(f"hqdn3d={d}:{d * 0.75:.2f}:{d * 2:.2f}:{d * 2:.2f}")
    tempo = seg.get("tempo", "real")
    if tempo in ("dream", "step"):
        f.append(f"setpts=PTS/{FILM['dream_speed']}")
    if tempo == "dream":
        # 29.97 fps footage slowed to 80 % would repeat every 4th frame — a
        # visible stutter. Motion-compensated in-between frames keep it fluid.
        f.append(f"minterpolate=fps={FILM['fps']}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none")
    if tempo == "step":
        # Wong Kar-wai step-printing: sample at a low rate, hold, smear-blend
        f.append(f"fps=8,fps={FILM['fps']},tmix=frames=3:weights='1 2 1'")
    f.append(f"fps={FILM['fps']}")
    # 3:2 window: biggest 3:2 that fits, shrunk by zoom (z0 -> z1 over the shot)
    base_w = min(src_w, src_h * A)
    z0, z1 = seg.get("zoom", [1.0, 1.06]) if isinstance(seg.get("zoom"), list) \
        else (1.0, 1.0 + seg.get("zoom", 0.06))
    x, y = seg.get("x", 0.5), seg.get("y", 0.5)
    x1 = seg.get("x_end", x)
    D = max(out_dur, 0.1)
    # sub-pixel zoom/pan: crop can only move in whole pixels, which makes slow
    # push-ins shimmer and jiggle. perspective interpolates the window every
    # frame (bicubic), so moves are perfectly smooth. Time = output frame / fps.
    fps_num = eval(FILM["fps"].replace("/", "/")) if isinstance(FILM["fps"], str) else FILM["fps"]
    p = f"(0.5-0.5*cos(PI*min(on/{fps_num * D:.3f},1)))"           # eased progress
    zw = f"({base_w:.2f}/({z0}+({z1}-{z0})*{p}))"
    zh = f"({zw}/{A:.5f})"
    cx = f"(({x}+({x1}-{x})*{p})*W)"
    X0 = f"max(0,min(W-{zw},{cx}-{zw}/2))"
    Y0 = f"max(0,min(H-{zh},{y}*H-{zh}/2))"
    X1 = f"({X0}+{zw})"
    Y1 = f"({Y0}+{zh})"
    f.append(f"perspective=x0='{X0}':y0='{Y0}':x1='{X1}':y1='{Y0}':x2='{X0}':y2='{Y1}':"
             f"x3='{X1}':y3='{Y1}':interpolation=cubic:sense=source:eval=frame")
    # perspective keeps the input size; the window now fills it. Restore aspect:
    f.append(f"scale={int(round(src_h * A / 2) * 2)}:{int(src_h)}:flags=lanczos")
    f.append(f"scale={W}:{H}:flags=lanczos")
    f.append(f"lut3d=file={lut}:interp=tetrahedral")
    if FILM["halation"] > 0:
        # glow from the brightest areas, warm-tinted, screen-blended back
        f.append(f"split[a][b];[b]colorlevels=rimin=0.72:gimin=0.74:bimin=0.78,"
                 f"gblur=sigma={W / 90:.1f},colorchannelmixer=rr=1:gg=0.55:bb=0.3[g];"
                 f"[a][g]blend=all_mode=screen:all_opacity={FILM['halation']}")
    f.append(f"vignette=angle={FILM['vignette']}:mode=forward")
    f.append(f"noise=c0s={FILM['grain']}:c0f=t+u")
    if seg.get("fade_in"):
        f.append(f"fade=in:st=0:d={seg['fade_in']}")
    f.append("format=yuv420p")
    return ",".join(f)


def pick_window(seg, analysis_dir):
    """seg["pick"] = [a, b]: choose the in-point inside [a, b] whose window is
    sharpest and steadiest, with the couple in frame. Avoids blurry / whip-pan
    moments so the edit can simply cut forward past them."""
    rng = seg.get("pick")
    p = os.path.join(analysis_dir or "", seg["clip"] + ".json")
    if not rng or not analysis_dir or not os.path.exists(p):
        return seg
    d = json.load(open(p))
    t = np.array(d["t"])
    sharp = np.array(d["sharp"])
    mot = np.array(d["motion"])
    have = np.array([s is not None for s in d["subj"]], float)
    speed = FILM["dream_speed"] if seg.get("tempo", "real") in ("dream", "step") else 1.0
    L = seg["dur"] * speed
    a, b = rng[0], min(rng[1], t.max()) - L
    # normalise per clip: log sharpness vs clip median; motion vs clip median
    ls = np.log(sharp + 1) - np.log(np.median(sharp) + 1)
    mn = mot / (np.median(mot) + 0.5)
    # camera jerk per frame (tools/jerk_index.py): bumps, jitter, operator grabs
    jp = os.path.join(analysis_dir, seg["clip"] + ".jerk.json")
    jerk = None
    if os.path.exists(jp):
        jd = json.load(open(jp))
        jerk, jfps = np.array(jd["jerk"]), jd["fps"]
        k = max(1, int(0.5 * jfps))
        jroll = np.convolve(jerk, np.ones(k) / k, "same")
    best, best_s = a, -1e9
    for t0 in np.arange(a, max(a, b) + 1e-6, 0.1 if jerk is not None else 0.25):
        k = (t >= t0) & (t <= t0 + L)
        if k.sum() < 2:
            continue
        # the window is judged by its worst moments, not just its average
        score = (np.mean(ls[k]) + 0.5 * np.min(ls[k]) - 0.6 * np.mean(mn[k])
                 - 0.4 * np.max(mn[k]) + (1.2 * np.mean(have[k]) if seg.get("couple", True) else 0))
        if jerk is not None:                    # steadiness dominates the choice
            j0, j1 = int(t0 * jfps), int((t0 + L) * jfps) + 1
            if j1 <= len(jerk) and j1 > j0:
                score -= 3.0 * float(np.mean(jerk[j0:j1])) + 2.0 * float(np.max(jroll[j0:j1]))
        if score > best_s:
            best, best_s = t0, score
    out = dict(seg)
    out["in"] = round(float(best), 2)
    return out


def auto_frame(seg, analysis_dir):
    """Centre the 3:2 window between the bride and groom: x/x_end follow the
    detected couple across the segment, y keeps headroom, and the push-in is
    capped so both heads (plus margin) stay in frame."""
    p = os.path.join(analysis_dir or "", seg["clip"] + ".json")
    if not analysis_dir or not os.path.exists(p) or seg.get("track") is False:
        return seg
    d = json.load(open(p))
    speed = FILM["dream_speed"] if seg.get("tempo", "real") in ("dream", "step") else 1.0
    a, b = seg["in"], seg["in"] + seg["dur"] * speed
    rows = [(t, s) for t, s in zip(d["t"], d["subj"]) if a <= t <= b and s]
    if len(rows) < 3:
        return seg
    t = np.array([r[0] for r in rows])
    S = np.array([r[1] for r in rows])          # cx, cy, left, right, top
    mid = (a + b) / 2
    first, last = S[t <= mid], S[t > mid]
    first = first if len(first) else S
    last = last if len(last) else S
    out = dict(seg)
    out["x"] = round(float(np.median(first[:, 0])), 3)
    out["x_end"] = round(float(np.median(last[:, 0])), 3)
    left, right, top = float(np.percentile(S[:, 2], 10)), float(np.percentile(S[:, 3], 90)), \
        float(np.percentile(S[:, 4], 10))
    span = right - left                                 # in source-width units
    base = min(1.0, (9 / 16) * FILM["width"] / FILM["height"])   # window / 16:9 width
    zmax = max(1.0, base / max(span * 1.45, 1e-3))
    z = seg.get("zoom", 0.06)
    z0, z1 = (z if isinstance(z, list) else (1.0, 1.0 + z))
    out["zoom"] = [round(min(z0, zmax), 3), round(min(z1, zmax), 3)]
    # vertical: faces a bit above centre, top head never cropped
    h = 1 / out["zoom"][1]
    cy = float(np.median(S[:, 1])) + 0.10
    cy = min(cy, top - 0.06 + h / 2)
    out["y"] = round(float(np.clip(cy, h / 2, 1 - h / 2)), 3)
    return out


def render_segment(seg, i, media_dir, work, preview):
    H = 540 if preview else FILM["height"]
    src = os.path.join(media_dir, seg["clip"] + ".mp4")
    speed = FILM["dream_speed"] if seg.get("tempo", "real") in ("dream", "step") else 1.0
    out_dur = seg["dur"] + seg.get("_tail", 0.0)
    src_dur = out_dur * speed + 0.2
    t_in = float(seg["in"])
    key = hashlib.sha1(json.dumps([seg, FILM, preview, "stab-v3"] + (["mci"] if seg.get("tempo") == "dream" else []),
                                   sort_keys=True).encode()).hexdigest()[:10]
    out = os.path.join(work, f"seg{i:03d}_{seg['clip']}_{key}.mp4")
    if os.path.exists(out):
        return out
    # match exposure / WB on the middle of the segment, bake the shot's LUT
    lut = os.path.join(work, f"lut_{key}.cube")
    img = sample_frame(src, t_in + src_dur / 2)
    if pre_lut() is not None:
        img = apply_cube(img, pre_lut())
    match = mr.measure(img)
    bake_lut(lut, match, seg.get("saturation", 1.0))
    trf = None
    if FILM["stabilize"] and seg.get("stab", True):
        trf = os.path.join(work, f"stab_{key}.trf")
        run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t_in}", "-t", f"{src_dur}", "-i", src,
             "-vf", f"scale=-2:{H},vidstabdetect=shakiness=8:accuracy=15:stepsize=6:"
             f"result={trf}",
             "-f", "null", "-"])
    w, h = map(int, subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height",
         "-of", "csv=p=0", src], capture_output=True, text=True).stdout.strip().split(","))
    if trf:
        # try stabilisers on this exact segment and keep the steadiest result
        # that shows no black borders: none, vidstab (smooth / heavy) and the
        # feature-tracked stabiliser (cv) that ignores moving people
        cv_key = hashlib.sha1(json.dumps([seg.get(k) for k in ("clip", "in", "dur", "_tail", "tempo", "zoom",
                                                                "x", "x_end", "y", "lock")] + [FILM["height"]],
                                         sort_keys=True).encode()).hexdigest()[:10]
        cv_src = os.path.join(work, f"cvstab_{cv_key}.mp4")
        cv_label = "cached"
        if not os.path.exists(cv_src):
            cv_label = cv_stabilize(seg, src, t_in, src_dur, w, h, cv_src)
        results = {}
        trf_p = trf.replace(".trf", "_p.trf")
        if not os.path.exists(trf_p):           # detection at the preview size for the trial renders
            run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t_in}", "-t", f"{src_dur}", "-i", src,
                 "-vf", "scale=-2:540,vidstabdetect=shakiness=8:accuracy=15:stepsize=6:"
                 f"result={trf_p}", "-f", "null", "-"])
        for m in ["none", "smooth", "heavy", "cv"]:
            cs = dict(seg, _stab_mode=m)
            tmp = os.path.join(work, f"cand_{key}_{m}.mp4")
            inp = ["-i", cv_src] if m == "cv" else ["-ss", f"{t_in}", "-t", f"{src_dur}", "-i", src]
            run(["ffmpeg", "-v", "error", "-y"] + inp +
                ["-filter_complex", seg_filters(cs, w, h, out_dur, lut, trf_p if m in ("smooth", "heavy") else None,
                                                True), "-t", f"{out_dur}",
                 "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24", tmp])
            results[m] = _jitter(tmp)
            os.remove(tmp)
        j0, c0 = results["none"]
        ok = {m: r for m, r in results.items() if m == "none" or r[1] <= c0 + 0.02}
        stab_ok = {m: r for m, r in ok.items() if m != "none"}
        best = min(stab_ok, key=lambda m: stab_ok[m][0]) if stab_ok else "none"
        if best != "none" and ok[best][0] > j0 * 1.02:
            best = "none"                       # stabilising made it worse: leave the shot as shot
        seg = dict(seg, _stab_mode=best)
        print(f"      stab {seg['clip']}: " + "  ".join(f"{m} {r[0]:.2f}" for m, r in results.items())
              + f"  (cv {cv_label})  → {best}", flush=True)
        if best != "cv" and os.path.exists(cv_src):
            os.remove(cv_src)
        if best in ("none", "cv"):
            trf = None
        if best == "cv":
            vf = seg_filters(seg, w, h, out_dur, lut, None, preview)
            run(["ffmpeg", "-v", "error", "-y", "-i", cv_src,
                 "-filter_complex", vf, "-t", f"{out_dur}", "-an",
                 "-c:v", "libx264", "-preset", "veryfast" if preview else "medium",
                 "-crf", "24" if preview else "12", out])
            return out
    vf = seg_filters(seg, w, h, out_dur, lut, trf, preview)
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t_in}", "-t", f"{src_dur}", "-i", src,
         "-filter_complex", vf, "-t", f"{out_dur}", "-an",
         "-c:v", "libx264", "-preset", "veryfast" if preview else "medium",
         "-crf", "24" if preview else "12", out])
    if trf and _jitter(out)[1] > results["none"][1] + 0.02:
        # the full-resolution vidstab pass can differ from the trial: never
        # ship black borders — fall back to the feature-tracked result / none
        alt = "cv" if results["cv"][1] <= results["none"][1] + 0.02 and \
            results["cv"][0] <= results["none"][0] else "none"
        print(f"      ! black borders at full resolution, using {alt}", flush=True)
        seg = dict(seg, _stab_mode=alt)
        if alt == "cv" and not os.path.exists(cv_src):
            cv_stabilize(seg, src, t_in, src_dur, w, h, cv_src)
        inp = ["-i", cv_src] if alt == "cv" else ["-ss", f"{t_in}", "-t", f"{src_dur}", "-i", src]
        run(["ffmpeg", "-v", "error", "-y"] + inp + ["-filter_complex", seg_filters(seg, w, h, out_dur, lut, None, preview),
             "-t", f"{out_dur}", "-an", "-c:v", "libx264", "-preset", "veryfast" if preview else "medium",
             "-crf", "24" if preview else "12", out])
    return out


# ════════════════════════════════════════════════════════════════════════════
#  Timeline
# ════════════════════════════════════════════════════════════════════════════
def layout(edl):
    """Compute each segment's start time. A dissolve of d seconds into segment
    i fades it in over the last d seconds of i-1. A mix of d seconds fades i in
    over its own first d seconds while i-1 plays on underneath (i-1 is
    rendered d seconds longer), so no later shot moves and sync is kept. Dips
    to black are a real black gap."""
    t = 0.0
    segs = edl["segments"]
    for i, s in enumerate(segs):
        tr = s.get("in_tr", "cut")
        d = float(tr.split(":")[1]) if ":" in tr else 0.0
        if tr.startswith("dissolve") and i > 0:
            t -= d          # overlaps the last d seconds of the previous shot
        if tr.startswith("black") and i > 0:
            t += d
        s["_start"] = t
        t += s["dur"]
    return t


def cue_times(edl):
    cues = {}
    for s in edl["segments"]:
        if "cue" in s:
            cues.setdefault(s["cue"], s["_start"])
    return cues


def assemble(edl, files, total, out, preview, work):
    W, H = out_size(preview)
    segs = edl["segments"]
    inputs, filters = [], []
    # black canvas for the full length; every segment is overlaid at its
    # start time with a fade for dissolves — robust for 40+ shots
    filters.append(f"color=c=black:s={W}x{H}:r={FILM['fps']}:d={total:.3f}[base]")
    last = "[base]"
    for i, (s, f) in enumerate(zip(segs, files)):
        inputs += ["-i", f]
        tr = s.get("in_tr", "cut")
        d = float(tr.split(":")[1]) if ":" in tr else 0.0
        # hold the last frame a beat past the cut so frame rounding can never
        # expose the black canvas (the next shot is layered on top anyway)
        chain = (f"[{i}:v]tpad=stop_mode=clone:stop_duration=0.25,"
                 f"setpts=PTS-STARTPTS+{s['_start']:.4f}/TB")
        if tr.startswith(("dissolve", "mix")) and i > 0:
            chain += f",format=yuva420p,fade=in:st={s['_start']:.4f}:d={d}:alpha=1"
        filters.append(chain + f"[v{i}]")
        filters.append(f"{last}[v{i}]overlay=eof_action=pass:enable='between(t,{s['_start']:.3f},"
                       f"{s['_start'] + s['dur'] + s.get('_tail', 0.0) + 0.2:.3f})'[o{i}]")
        last = f"[o{i}]"
    # title(s)
    for k, tx in enumerate(edl.get("titles", [])):
        font = os.path.join(HERE, mr.CONFIG["font_title"])
        a0, a1, fd = tx["start"], tx["end"], tx.get("fade", 1.5)
        alpha = (f"if(lt(t,{a0}),0,if(lt(t,{a0 + fd}),(t-{a0})/{fd},"
                 f"if(lt(t,{a1 - fd}),1,if(lt(t,{a1}),({a1}-t)/{fd},0))))")
        size = int(H * tx.get("size", 0.045))
        txt = tx["text"].replace(":", r"\:").replace("'", r"\'")
        filters.append(f"{last}drawtext=fontfile={font}:text='{txt}':fontsize={size}:"
                       f"fontcolor=0xF3EBDC:alpha='{alpha}':x=(w-text_w)/2:"
                       f"y=h*{tx.get('y', 0.80)}-text_h/2:shadowcolor=0x1C241E@0.55:"
                       f"shadowx=0:shadowy={max(1, size // 18)}[t{k}]")
        last = f"[t{k}]"
    filters.append(f"{last}fade=out:st={total - 2.0:.3f}:d=2.0,format=yuv420p[vout]")
    script = os.path.join(work, "assemble.txt")
    with open(script, "w") as fh:
        fh.write(";\n".join(filters))
    audio = os.path.join(work, "mix.wav")
    cmd = ["ffmpeg", "-v", "error", "-stats", "-y", *inputs, "-i", audio,
           "-filter_complex_script", script, "-map", "[vout]", "-map", f"{len(files)}:a",
           "-t", f"{total:.3f}", "-r", FILM["fps"],
           "-c:v", "libx264", "-preset", "veryfast" if preview else FILM["preset"],
           "-crf", "26" if preview else str(FILM["crf"]), "-pix_fmt", "yuv420p",
           "-profile:v", "high", "-tune", "film",
           "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart",
           "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", out]
    subprocess.run(cmd, check=True)


# ════════════════════════════════════════════════════════════════════════════
#  Audio: camera sound per segment + score, ducked
# ════════════════════════════════════════════════════════════════════════════
def load_wav(path):
    sr, x = wavfile.read(path)
    x = x.astype(np.float32) / (32768.0 if x.dtype == np.int16 else 1.0)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    if sr != FILM["audio_sr"]:
        import scipy.signal as ss
        x = ss.resample_poly(x, FILM["audio_sr"], sr, axis=0).astype(np.float32)
    return x


def build_audio(edl, total, audio_dir, score_path, work):
    sr = FILM["audio_sr"]
    n = int((total + 1) * sr)
    dia = np.zeros((n, 2), np.float32)
    for s in edl["segments"]:
        g_db = s.get("audio", None)
        if g_db is None:
            continue
        src = os.path.join(audio_dir, s["clip"] + ".wav")
        if not os.path.exists(src):
            continue
        x = load_wav(src)
        speed = FILM["dream_speed"] if s.get("tempo", "real") in ("dream", "step") else 1.0
        a = int(s["in"] * sr)
        seg_len = s["dur"] + s.get("_tail", 0)
        b = a + int(seg_len * speed * sr)
        piece = x[a:b]
        if speed != 1.0:  # dreamy: slowed (pitch drops, like memory)
            import scipy.signal as ss
            piece = ss.resample(piece, int(len(piece) / speed)).astype(np.float32)
        # high-pass rumble, gentle fades so cuts never click
        import scipy.signal as ss
        sos = ss.butter(2, 90, "high", fs=sr, output="sos")
        piece = ss.sosfilt(sos, piece, axis=0).astype(np.float32)
        fl = min(int(s.get("afade", 0.25) * sr), len(piece) // 2)
        env = np.ones(len(piece), np.float32)
        if fl > 0:
            env[:fl] = np.linspace(0, 1, fl)
            env[-fl:] = np.linspace(1, 0, fl)
        i0 = int(s["_start"] * sr)
        m = min(len(piece), n - i0)
        dia[i0:i0 + m] += piece[:m] * env[:m, None] * 10 ** (g_db / 20)
    mus = np.zeros_like(dia)
    if score_path and os.path.exists(score_path):
        x = load_wav(score_path)
        m = min(len(x), n)
        mus[:m] = x[:m]
    # duck the score under loud diegetic moments (voices, cheering)
    env = np.sqrt(np.convolve((dia ** 2).mean(1), np.ones(sr // 4) / (sr // 4), "same"))
    duck = 1 - 0.5 * np.clip((20 * np.log10(env + 1e-6) + 40) / 20, 0, 1)
    mix = dia + mus * duck[:, None]
    # master: normalise to about -16 LUFS-ish RMS, -1 dB peak
    rms = np.sqrt((mix ** 2).mean()) + 1e-9
    mix *= min(10 ** (-17 / 20) / rms, 0.89 / (np.abs(mix).max() + 1e-9))
    out = os.path.join(work, "mix.wav")
    wavfile.write(out, sr, (np.clip(mix, -1, 1) * 32767).astype(np.int16))
    return out


# ════════════════════════════════════════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("edl")
    ap.add_argument("-o", "--output")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--cues", action="store_true", help="print music cue times and exit")
    ap.add_argument("--only", type=int, nargs="+", help="render only these segment indices")
    args = ap.parse_args()

    with open(args.edl) as f:
        edl = json.load(f)
    base = os.path.dirname(os.path.abspath(args.edl))
    FILM.update(edl.get("film", {}))
    if FILM.get("pre_lut") and not os.path.isabs(FILM["pre_lut"]):
        FILM["pre_lut"] = os.path.normpath(os.path.join(base, FILM["pre_lut"]))
    mr.CONFIG.update(edl.get("grade", {}))
    rel = lambda p: p if os.path.isabs(p) else os.path.normpath(os.path.join(base, p))
    media, audio_dir = rel(edl["media_dir"]), rel(edl["audio_dir"])
    total = layout(edl)
    if args.cues:
        print(json.dumps({"total": round(total, 2), **{k: round(v, 2) for k, v in cue_times(edl).items()}}, indent=1))
        return
    work = os.path.join(base, ".work" + ("_preview" if args.preview else ""))
    os.makedirs(work, exist_ok=True)
    print(f"• {len(edl['segments'])} segments, {total // 60:.0f}:{total % 60:04.1f}")
    files = []
    adir = rel(edl["analysis_dir"]) if edl.get("analysis_dir") else None
    edl["segments"] = [auto_frame(pick_window(s, adir), adir) for s in edl["segments"]]
    for i in range(1, len(edl["segments"])):   # a mix needs the outgoing shot to run on underneath
        tr = edl["segments"][i].get("in_tr", "cut")
        if tr.startswith("mix"):
            edl["segments"][i - 1]["_tail"] = float(tr.split(":")[1])
    for i, s in enumerate(edl["segments"]):
        if args.only and i not in args.only:
            continue
        print(f"  [{i + 1:2d}/{len(edl['segments'])}] {s['clip']} @{s['in']}s  "
              f"{s['dur']}s  {s.get('tempo', 'real')}  t={s['_start']:.1f}  "
              f"x={s.get('x', .5)}→{s.get('x_end', s.get('x', .5))} y={s.get('y', .5)} "
              f"z={s.get('zoom')}", flush=True)
        files.append(render_segment(s, i, media, work, args.preview))
    if args.only:
        return
    print("• audio")
    if edl.get("audio_mix"):            # soundtrack built elsewhere (music + speech)
        import shutil
        shutil.copy(rel(edl["audio_mix"]), os.path.join(work, "mix.wav"))
    else:
        build_audio(edl, total, audio_dir, rel(edl["score"]) if edl.get("score") else None, work)
    out = args.output or rel(edl.get("output", "film.mp4"))
    print(f"• assembling {out}")
    assemble(edl, files, total, out, args.preview, work)
    print(f"✓ {out}  ({os.path.getsize(out) / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
