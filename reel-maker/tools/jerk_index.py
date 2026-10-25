#!/usr/bin/env python3
"""
jerk_index.py — per-frame camera jerk for every clip, for the shot picker.

Writes <analysis_dir>/<clip>.jerk.json = {"fps": 29.97, "jerk": [...]} where
jerk is each frame's deviation (px at 640 wide) from the locally smoothed
camera speed — high on bumps, handheld jitter and operator grabs, low on
steady tripod / gimbal footage, whatever the subject does.

    python jerk_index.py media_dir analysis_dir [clip ...]
"""
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from motion import gray_frames, smooth_path, step_motion  # noqa: E402


def main():
    media, adir = sys.argv[1], sys.argv[2]
    clips = sys.argv[3:] or sorted(f[:-4] for f in os.listdir(media) if f.endswith(".mp4"))
    for c in clips:
        out = os.path.join(adir, c + ".jerk.json")
        if os.path.exists(out):
            continue
        src = os.path.join(media, c + ".mp4")
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                    "csv=p=0", src], capture_output=True, text=True).stdout)
        jerk = []
        for a in np.arange(0, dur, 60.0):           # in chunks, so long takes fit in memory
            F = gray_frames(src, a, 60.0 + 1 / 29.97)
            s = step_motion(F)
            if len(s) < 3:
                continue
            e = np.linalg.norm(s[:, :2] - smooth_path(s[:, :2], 0.2 * 29.97), axis=1)
            jerk += e[: int(round(60 * 29.97))].round(3).tolist()
        json.dump({"fps": 29.97, "jerk": jerk}, open(out, "w"))
        print(f"{c}: {len(jerk)} frames, median jerk {np.median(jerk):.2f}", flush=True)


if __name__ == "__main__":
    main()
