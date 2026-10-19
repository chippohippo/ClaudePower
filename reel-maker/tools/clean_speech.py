#!/usr/bin/env python3
"""
clean_speech.py — remove sniffs, breaths and mic handling (scratch/thump)
noise from speech in a finished mix, without touching the music.

Pipeline (run inside a work folder that has mix.wav):
  1. Demucs splits the mix into vocals / no_vocals (do this first:
     python -m demucs --two-stems vocals -n htdemucs -o sep mix.wav)
  2. faster-whisper word timestamps (words.json) mark where speech is.
  3. Only inside the given speech windows:
       voice  : low-cut + de-click + spectral denoise + non-stationary gate,
                sniff detector (unvoiced, breath-band, >80 ms) → −25 dB,
                low-band transient suppressor (mic bumps), word gate
       music  : breath-band / low-band transient spikes clamped to the
                running bed level (leaked sniffs & thumps), music kept
  4. Crossfaded back into the original mix; everything else is untouched.

    python clean_speech.py WORKDIR --windows 11.8-17.3 30.8-40.5 ... --strong 30.6-40.7
"""
import argparse
import json
import os
import subprocess

import noisereduce as nr
import numpy as np
from scipy.io import wavfile
from scipy.ndimage import label, median_filter
from scipy.signal import istft, stft

SR = 44100


def load(p):
    sr, x = wavfile.read(p)
    x = x.astype(np.float32) / (32768 if x.dtype == np.int16 else 1)
    return x if x.ndim == 2 else np.stack([x, x], 1)


def clamp_spikes(x, bands, over, win_s=0.6, hop=221, nper=1024):
    """Per band, limit energy to running median + over dB (keeps the bed)."""
    out = np.zeros_like(x)
    for ch in range(x.shape[1]):
        f, t, Z = stft(x[:, ch], SR, nperseg=nper, noverlap=nper - hop)
        G = np.ones(Z.shape, np.float32)
        P = np.abs(Z) ** 2 + 1e-12
        for (lo, hi), ov in zip(bands, over):
            m = (f >= lo) & (f < hi)
            B = 10 * np.log10(P[m].sum(0))
            med = median_filter(B, int(win_s * SR / hop) | 1)
            g = np.minimum(1, 10 ** ((med + ov - B) / 20))
            G[m] *= np.convolve(g, np.hanning(7) / np.hanning(7).sum(), "same")
        _, y = istft(Z * G, SR, nperseg=nper, noverlap=nper - hop)
        out[:, ch] = y[: len(x)]
    return out


def sniff_gain(mono, cut_db):
    hopn = int(0.01 * SR)
    fr = int(0.02 * SR)
    f, t, Z = stft(mono, SR, nperseg=1024, noverlap=1024 - hopn)
    P = np.abs(Z) ** 2 + 1e-12
    br = P[(f > 1000) & (f < 6000)].sum(0)
    air = P[(f > 6000) & (f < 12000)].sum(0)
    lvl = 10 * np.log10(P.sum(0))
    lvl -= np.percentile(lvl, 95)
    voiced = np.zeros(len(t), bool)
    for i, tt in enumerate(t):
        s = int(tt * SR)
        w = mono[max(0, s - fr): s + fr]
        if len(w) < 2 * fr or np.sqrt((w ** 2).mean()) < 1e-4:
            continue
        ac = np.correlate(w, w, "full")[len(w) - 1:]
        ac /= ac[0] + 1e-9
        voiced[i] = ac[int(SR / 400): int(SR / 80)].max() > 0.45
    lab, k = label((~voiced) & (br > 1.3 * air) & (lvl > -45))
    g = np.ones(len(t), np.float32)
    hits = []
    for j in range(1, k + 1):
        idx = np.where(lab == j)[0]
        if len(idx) * 0.01 >= 0.08:
            g[idx] = 10 ** (-cut_db / 20)
            hits.append(round(float(t[idx[0]]), 2))
    g = np.convolve(g, np.hanning(9) / np.hanning(9).sum(), "same")
    return np.interp(np.arange(len(mono)) / SR, t, g), hits


def word_gate(n, words, floor_db, pre=0.05, post=0.10):
    g = np.full(n, 10 ** (floor_db / 20), np.float32)
    for a, b, _ in words:
        g[max(int((a - pre) * SR), 0): int((b + post) * SR)] = 1
    k = int(0.03 * SR)
    ker = np.hanning(2 * k + 1)
    return np.convolve(g, ker / ker.sum(), "same")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("--windows", nargs="+", required=True, help="speech windows a-b (s)")
    ap.add_argument("--strong", nargs="*", default=[], help="windows that get the strong treatment")
    ap.add_argument("-o", "--output", default="mix_clean.wav")
    a = ap.parse_args()
    os.chdir(a.work)
    parse = lambda s: tuple(float(v) for v in s.split("-"))
    wins, strong = [parse(w) for w in a.windows], [parse(w) for w in a.strong]
    # base voice clean (all speech windows)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "sep/htdemucs/mix/vocals.wav", "-af",
                    "highpass=f=90,lowpass=f=12000,adeclick=w=55:o=75:a=2,"
                    "afftdn=nf=-35:nr=14:tn=1,deesser=i=0.4", "voc_base.wav"], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "sep/htdemucs/mix/vocals.wav", "-af",
                    "highpass=f=130:poles=2,highpass=f=110,lowpass=f=11000,"
                    "adeclick=w=40:o=80:a=3:t=1.5,afftdn=nf=-38:nr=20:tn=1,deesser=i=0.5",
                    "voc_strong.wav"], check=True)
    mix, nv = load("mix.wav"), load("sep/htdemucs/mix/no_vocals.wav")
    vb, vs = load("voc_base.wav"), load("voc_strong.wav")
    n = min(map(len, (mix, nv, vb, vs)))
    mix, nv, vb, vs = mix[:n], nv[:n], vb[:n], vs[:n]
    words = [w for s in json.load(open("words.json")) for w in s["words"]]
    voice = vb * word_gate(n, words, -24, 0.06, 0.12)[:, None]
    music = nv.copy()
    for A, B in strong:
        ia, ib = int(A * SR), int(B * SR)
        seg = vs[ia:ib]
        seg = np.stack([nr.reduce_noise(y=seg[:, c], sr=SR, stationary=False, prop_decrease=0.8,
                                        time_mask_smooth_ms=40) for c in range(2)], 1)
        g, hits = sniff_gain(seg.mean(1), 25)
        seg = seg * g[:, None]
        seg = clamp_spikes(seg, [(20, 180)], [3])                  # mic bumps on the voice
        seg = seg * word_gate(n, words, -32, pre=0.0, post=0.08)[ia:ib, None]
        # match the cleaned voice's loudness on words to the original voice
        on = np.zeros(ib - ia, bool)
        for wa, wb, _ in words:
            on[max(int(wa * SR) - ia, 0):max(int(wb * SR) - ia, 0)] = True
        if on.any():
            ref = np.sqrt((vb[ia:ib][on] ** 2).mean()) + 1e-9
            got = np.sqrt((seg[on] ** 2).mean()) + 1e-9
            seg *= min(ref / got, 4.0)
        voice[ia:ib] = seg
        music[ia:ib] = clamp_spikes(nv[ia:ib], [(1000, 6000), (20, 180)], [2, 2])
        print(f"  {A}-{B}s  sniff-like events cut at", [round(A + h, 2) for h in hits])
    w = np.zeros(n, np.float32)
    for A, B in wins:
        w[int(A * SR): int(B * SR)] = 1
    fk = np.hanning(int(0.14 * SR))
    w = np.convolve(w, fk / fk.sum(), "same")
    out = mix * (1 - w[:, None]) + (music + voice * 1.05) * w[:, None]
    out *= min(1, 0.97 / np.abs(out).max())
    wavfile.write(a.output, SR, (out * 32767).astype(np.int16))
    print("wrote", a.output)


if __name__ == "__main__":
    main()
