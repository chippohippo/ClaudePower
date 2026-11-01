#!/usr/bin/env python3
"""The reel's music: the song from Tyler & Sarah's own 3-minute edit, cut to
60 s with one beat-matched splice — its real intro (0–13.31 s), then straight
into the big final section (from 160.68 s) through to the song's own ending.
The splice points were chosen by matching the sound either side (chroma +
timbre, 96 % alike, level within 0.1 dB); a 40 ms equal-power crossfade hides
the join.

    python make_music.py song.wav out.wav
"""
import json
import sys

import numpy as np
from scipy.io import wavfile

A, B, TOTAL, XF = 13.31, 160.68, 60.0, 0.04


def main():
    sr, x = wavfile.read(sys.argv[1])
    x = x.astype(np.float32) / (32768.0 if x.dtype == np.int16 else 1.0)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    a, b, n, xf = int(A * sr), int(B * sr), int(TOTAL * sr), int(XF * sr)
    head = x[:a + xf].copy()
    tail = x[b:b + (n - a)].copy()
    w = np.sin(np.linspace(0, np.pi / 2, xf))[:, None]
    head[-xf:] *= np.cos(np.linspace(0, np.pi / 2, xf))[:, None]
    tail[:xf] *= w
    y = np.concatenate([head[:-xf], head[-xf:] + tail[:xf], tail[xf:]])[:n]
    fo = int(1.2 * sr)
    y[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 2
    wavfile.write(sys.argv[2], sr, y.astype(np.float32))
    print(f"✓ {sys.argv[2]}  {len(y) / sr:.2f}s")


if __name__ == "__main__":
    main()
