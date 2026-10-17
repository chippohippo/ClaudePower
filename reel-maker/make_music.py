#!/usr/bin/env python3
"""
make_music.py — synthesise a soft, romantic piano + pad bed (royalty-free).

Used as a placeholder soundtrack when you don't pass your own music. For the
final post you'll often swap in a trending sound inside Instagram instead;
the reel's cuts follow a 76 BPM grid so most ballads line up nicely.

    python make_music.py -o music/soft_piano_76bpm.wav --seconds 62
"""

import argparse

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
BPM = 76
BEAT = 60 / BPM
BAR = 4 * BEAT


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def piano(freq, dur, vel=0.6):
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-t * (2.2 + freq / 900)) * (1 - np.exp(-t * 400))
    sig = sum((0.6 ** k) * np.sin(2 * np.pi * freq * (k + 1) * t * (1 + 0.0004 * k * k))
              for k in range(6))
    return sig * env * vel


def pad(freqs, dur):
    t = np.arange(int(dur * SR)) / SR
    att = np.clip(t / 1.2, 0, 1) * np.clip((dur - t) / 1.2, 0, 1)
    sig = np.zeros_like(t)
    for f in freqs:
        for det in (-0.12, 0.0, 0.11):          # gentle chorus
            ff = f * 2 ** (det / 12)
            sig += np.sin(2 * np.pi * ff * t + 0.3 * np.sin(2 * np.pi * 0.25 * t))
            sig += 0.3 * np.sin(2 * np.pi * 2 * ff * t)
    return sig * att / (len(freqs) * 3)


def kick(dur=0.5):
    t = np.arange(int(dur * SR)) / SR
    f = 48 + 70 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def place(buf, sig, at):
    i = int(at * SR)
    j = min(len(buf), i + len(sig))
    if i < len(buf):
        buf[i:j] += sig[: j - i]


def reverb(x, seconds=2.8, mix=0.32):
    n = int(seconds * SR)
    rng = np.random.default_rng(1)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 3.2)
    ir = sosfilt(butter(2, 5000, "low", fs=SR, output="sos"), ir)
    wet = fftconvolve(x, ir)[: len(x)]
    wet /= np.abs(wet).max() + 1e-9
    return x * (1 - mix) + wet * mix * np.abs(x).max()


def compose(seconds):
    total = int(seconds * SR)
    mel, harm, drums = (np.zeros(total) for _ in range(3))
    # D major: I – V – vi – IV, then a lifted IV – V – vi – I in the middle
    prog = [[62, 66, 69], [57, 61, 64], [59, 62, 66], [55, 59, 62]]
    lift = [[55, 59, 62], [57, 61, 64], [59, 62, 66], [62, 66, 69]]
    arp = [0, 1, 2, 1, 2, 3, 2, 1]               # pattern over 8 eighths
    bars = int(seconds / BAR) + 1
    for b in range(bars):
        section = "intro" if b < 2 else ("lift" if 8 <= b < 14 else "main")
        chord = (lift if section == "lift" else prog)[b % 4]
        t0 = b * BAR
        notes = chord + [chord[0] + 12]
        for k, a in enumerate(arp):
            vel = 0.42 if section == "intro" else 0.5
            place(mel, piano(midi(notes[a] + 12), 2.2, vel * (1.1 if k == 0 else 0.85)), t0 + k * BEAT / 2)
        place(mel, piano(midi(chord[0] - 12), 3.5, 0.55), t0)          # bass
        if section != "intro":
            place(harm, pad([midi(n) for n in chord], BAR + 1.2), t0 - 0.3)
            for beat in (0, 2):
                place(drums, kick() * (0.55 if section == "lift" else 0.35), t0 + beat * BEAT)
        if section == "lift":                     # little top-line melody
            top = [chord[2] + 12, chord[1] + 12, chord[2] + 14, chord[0] + 24]
            for k, n in enumerate(top):
                place(mel, piano(midi(n + 12), 2.5, 0.32), t0 + k * BEAT + BEAT / 2)
    mix = mel * 0.8 + harm * 0.55
    mix = reverb(mix) + drums * 0.6
    # master: fade, soft clip, normalise
    t = np.arange(total) / SR
    mix *= np.clip(t / 1.5, 0, 1) * np.clip((seconds - t) / 3.0, 0, 1)
    mix = np.tanh(mix / (np.abs(mix).max() + 1e-9) * 1.4)
    mix = mix / np.abs(mix).max() * 0.9
    # subtle stereo: slight delay on right channel
    right = np.concatenate([np.zeros(int(0.012 * SR)), mix])[:total]
    return np.stack([mix, right * 0.97 + mix * 0.03], 1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--output", default="music/soft_piano_76bpm.wav")
    ap.add_argument("--seconds", type=float, default=62)
    a = ap.parse_args()
    import os
    os.makedirs(os.path.dirname(a.output) or ".", exist_ok=True)
    wavfile.write(a.output, SR, (compose(a.seconds) * 32767).astype(np.int16))
    print("wrote", a.output)
