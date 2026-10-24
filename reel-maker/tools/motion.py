#!/usr/bin/env python3
"""
motion.py — robust camera-motion estimation and stabilisation.

Camera motion per frame is measured from tracked corner features with a RANSAC
similarity fit, so moving people (who are big in frame at a ceremony) are
treated as outliers and only the background — the camera — is followed.

    shake(frames)            -> score (px at 640 wide): high-frequency jitter + wobble
    trajectory(frames)       -> cumulative (dx, dy, da) per frame
    plan(traj, window, ...)  -> per-frame correction matrices that keep the
                                output window inside the picture
    python motion.py video.mp4 [--cuts t0 t1 ...]   # per-shot shake report
"""
import subprocess
import sys

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d

AW = 640                    # analysis width


def gray_frames(path, ss=None, t=None, width=AW, vf_pre=None):
    cmd = ["ffmpeg", "-v", "error"]
    if ss is not None:
        cmd += ["-ss", f"{ss:.4f}"]
    if t is not None:
        cmd += ["-t", f"{t:.4f}"]
    vf = (vf_pre + "," if vf_pre else "") + f"scale={width}:-2,format=gray"
    out = subprocess.run(cmd + ["-i", path, "-vf", vf, "-f", "rawvideo", "-"], capture_output=True)
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                            "stream=width,height", "-of", "csv=p=0", path], capture_output=True, text=True)
    w0, h0 = map(int, probe.stdout.strip().split(",")[:2])
    h = int(round(h0 * width / w0 / 2) * 2)
    return np.frombuffer(out.stdout, np.uint8)[: (len(out.stdout) // (width * h)) * width * h].reshape(-1, h, width)


def step_motion(frames):
    """Frame-to-frame similarity (dx, dy, da) via LK feature tracking + RANSAC."""
    n = len(frames)
    m = np.zeros((max(n - 1, 0), 3))
    ok = np.ones(max(n - 1, 0), bool)
    for k in range(n - 1):
        a, b = frames[k], frames[k + 1]
        p0 = cv2.goodFeaturesToTrack(a, maxCorners=400, qualityLevel=0.01, minDistance=12, blockSize=7)
        if p0 is None or len(p0) < 12:
            ok[k] = False
            continue
        p1, st, _ = cv2.calcOpticalFlowPyrLK(a, b, p0, None, winSize=(21, 21), maxLevel=3)
        g = st.ravel() == 1
        if g.sum() < 12:
            ok[k] = False
            continue
        M, inl = cv2.estimateAffinePartial2D(p0[g], p1[g], method=cv2.RANSAC, ransacReprojThreshold=1.5,
                                             maxIters=2000, confidence=0.995)
        if M is None or inl.sum() < 10:
            ok[k] = False
            continue
        m[k] = (M[0, 2], M[1, 2], np.arctan2(M[1, 0], M[0, 0]))
    # cuts / failures: fill with neighbours' median so they don't read as shake
    if (~ok).any() and ok.any():
        m[~ok] = np.median(m[ok], 0)
    return m


def smooth_path(x, sigma):
    """Gaussian-smoothed camera path, padded by linear extrapolation of each
    end so a steady pan or gimbal move is kept as it is (plain edge padding
    would read every move as wobble at the shot's ends and freeze it)."""
    n = len(x)
    pad = int(min(3 * sigma, 4 * n)) + 1
    k = max(2, min(n, int(0.3 * 29.97)))
    t = np.arange(n)
    out = []
    for c in range(x.shape[1]):
        a = np.polyfit(t[:k], x[:k, c], 1)
        b = np.polyfit(t[-k:], x[-k:, c], 1)
        pre = np.polyval(a, np.arange(-pad, 0))
        post = np.polyval(b, np.arange(n, n + pad))
        y = gaussian_filter1d(np.r_[pre, x[:, c], post], sigma, mode="nearest")
        out.append(y[pad:pad + n])
    return np.stack(out, 1)


def trajectory(frames):
    s = step_motion(frames)
    return np.vstack([np.zeros((1, 3)), np.cumsum(s, 0)]), s


def shake(frames, fps=29.97):
    """Shake score in px at analysis width: mean |jerk| + rms deviation of the
    camera path from a 0.5 s Gaussian-smoothed path (deliberate pans and
    gimbal moves are smooth and are not penalised; bumps and wobble are)."""
    if len(frames) < 8:
        return 0.0
    tr, s = trajectory(frames)
    xy = tr[:, :2]
    fast = float(np.abs(np.diff(s[:, :2], axis=0)).mean()) if len(s) > 2 else 0.0
    sm = smooth_path(xy, 0.5 * fps)
    wob = float(np.sqrt(((xy - sm) ** 2).sum(1).mean()))
    return fast + wob


def _needed_scale(corr, win, size, scales):
    """Smallest uniform scale (about the window centre) so that the output
    window only samples inside the source picture, for every frame."""
    W, H = size
    x0, y0, x1, y1 = win
    c = np.array([(x0 + x1) / 2, (y0 + y1) / 2])
    corners = np.array([[x0, y0], [x1, y0], [x0, y1], [x1, y1]], float) - c
    for s in scales:
        good = True
        for dx, dy, da in corr:
            # output = s·R·(in − c) + c + t  →  in = c + R⁻¹(q − c − t)/s
            ca, sa = np.cos(-da), np.sin(-da)
            q = (corners - (dx, dy)) / s
            p = np.c_[q[:, 0] * ca - q[:, 1] * sa, q[:, 0] * sa + q[:, 1] * ca] + c
            if (p[:, 0] < 0).any() or (p[:, 0] > W - 1).any() or (p[:, 1] < 0).any() or (p[:, 1] > H - 1).any():
                good = False
                break
        if good:
            return s
    return None


def shake_peak(frames, fps=29.97, win=1.0):
    """Worst 1-second stretch: mean frame-to-frame jerk (deviation of each
    step from the locally smoothed camera speed), px at analysis width."""
    if len(frames) < 8:
        return 0.0
    _, s = trajectory(frames)
    sm = smooth_path(s[:, :2], 0.2 * fps)
    e = np.linalg.norm(s[:, :2] - sm, axis=1)
    k = max(1, min(len(e), int(win * fps)))
    return float(np.convolve(e, np.ones(k) / k, "valid").max())


def plan(traj, scale, win, size, fps=29.97, smax=1.06, locked=False):
    """Choose the smoothest camera path whose corrections fit inside the crop
    margin (plus at most smax extra zoom). traj is in analysis px; scale maps
    analysis px → render px; win = output window (x0, y0, x1, y1) in render px.
    Returns (matrices, label, extra_scale)."""
    tr = traj.copy()
    tr[:, :2] *= scale
    n = len(tr)
    t = np.arange(n)
    cands = []
    if locked:                                              # tripod-like: a straight / gently curving path
        for deg in (0, 1, 2):
            if n > deg + 2:
                cands.append((f"path{deg}", np.stack([np.polyval(np.polyfit(t, tr[:, c], deg), t)
                                                       for c in range(3)], 1)))
    for sg in (2.0, 1.4, 1.0, 0.7, 0.45, 0.3):
        cands.append((f"g{sg}", smooth_path(tr, sg * fps)))
    scales = np.round(np.arange(1.0, smax + 1e-6, 0.005), 3)
    for label, sm in cands:
        corr = sm - tr
        s = _needed_scale(corr, win, size, scales)
        if s is not None:
            return _mats(corr, s, win), label, s
    # nothing fits: lightest smoothing, corrections shrunk frame by frame until they fit
    label, sm = cands[-1]
    corr = sm - tr
    for k in range(n):
        for f in np.linspace(1, 0, 21):
            if _needed_scale(corr[k:k + 1] * f, win, size, [smax]) is not None:
                corr[k] *= f
                break
    return _mats(corr, smax, win), label + "-clip", smax


def _mats(corr, s, win):
    x0, y0, x1, y1 = win
    c = np.array([(x0 + x1) / 2, (y0 + y1) / 2])
    out = []
    for dx, dy, da in corr:
        R = np.array([[np.cos(da), -np.sin(da)], [np.sin(da), np.cos(da)]]) * s
        out.append(np.c_[R, c + (dx, dy) - R @ c])
    return out


def main():
    path = sys.argv[1]
    cuts = [float(v) for v in sys.argv[sys.argv.index("--cuts") + 1:]] if "--cuts" in sys.argv else None
    F = gray_frames(path)
    fps = 30000 / 1001
    if cuts is None:
        cuts = [0, len(F) / fps]
    res = []
    for a, b in zip(cuts[:-1], cuts[1:]):
        fr = F[int(a * fps) + 1: int(b * fps) - 1]
        res.append((a, b, shake_peak(fr, fps), shake(fr, fps)))
    for a, b, p, s in sorted(res, key=lambda r: -r[2]):
        print(f"{a:7.2f}-{b:7.2f}  peak jerk {p:5.2f}  shake {s:5.2f}")


if __name__ == "__main__":
    main()
