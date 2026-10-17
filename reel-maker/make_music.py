#!/usr/bin/env python3
"""
make_music.py — synthesise a calm, sweet, joyful soundtrack (royalty-free).

Soft felt piano, a music-box melody and warm strings in F major at 66 BPM —
no drums. It's a placeholder you can keep, or you can swap in your own song
(--music) / add a trending sound inside Instagram.

    python make_music.py -o music/sweet_piano_66bpm.wav --seconds 62
"""

import argparse
import os

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
BPM = 66
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(3)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def lowpass(x, hz):
    return sosfilt(butter(2, hz, "low", fs=SR, output="sos"), x)


def felt_piano(freq, dur, vel=0.5):
    """Soft, muted piano: few harmonics, quick hammer, slow warm decay."""
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-t * (1.1 + freq / 1400)) * (1 - np.exp(-t * 160))
    sig = sum((0.45 ** k) * np.sin(2 * np.pi * freq * (k + 1) * t * (1 + 0.0003 * k * k))
              for k in range(5))
    return lowpass(sig * env, 2600) * vel


def music_box(freq, dur=2.5, vel=0.25):
    """Glassy, sweet bell: fundamental + inharmonic partials, fast decay."""
    t = np.arange(int(dur * SR)) / SR
    sig = (np.sin(2 * np.pi * freq * t) * np.exp(-t * 2.5)
           + 0.35 * np.sin(2 * np.pi * freq * 3.01 * t) * np.exp(-t * 5)
           + 0.15 * np.sin(2 * np.pi * freq * 5.4 * t) * np.exp(-t * 9))
    return sig * (1 - np.exp(-t * 600)) * vel


def strings(freqs, dur):
    """Warm, slow-attack string pad with gentle vibrato."""
    t = np.arange(int(dur * SR)) / SR
    att = np.clip(t / 1.8, 0, 1) ** 2 * np.clip((dur - t) / 1.5, 0, 1)
    sig = np.zeros_like(t)
    for f in freqs:
        for det in (-0.08, 0.0, 0.07):
            ff = f * 2 ** (det / 12)
            vib = 0.004 * np.sin(2 * np.pi * 5.2 * t + rng.uniform(0, 6))
            ph = 2 * np.pi * ff * np.cumsum(1 + vib) / SR
            sig += np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)
    return lowpass(sig * att / (len(freqs) * 3), 1800)


def place(buf, sig, at):
    i = max(int(at * SR), 0)
    j = min(len(buf), i + len(sig))
    if i < len(buf):
        buf[i:j] += sig[: j - i]


def reverb(x, seconds=3.5, mix=0.38):
    n = int(seconds * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 2.4)
    ir = lowpass(ir, 4500)
    wet = fftconvolve(x, ir)[: len(x)]
    wet *= np.abs(x).max() / (np.abs(wet).max() + 1e-9)
    return x * (1 - mix) + wet * mix


def compose(seconds):
    total = int(seconds * SR)
    pno, box, pad = (np.zeros(total) for _ in range(3))
    F = 53  # F3
    # F – C/E – Dm – B♭  (I – V – vi – IV), voiced with add9 / sus colour
    chords = [
        [F, F + 7, F + 12, F + 14, F + 16],          # Fadd9
        [F - 1, F + 7, F + 11, F + 14, F + 19],      # C/E
        [F - 3, F + 4, F + 9, F + 12, F + 16],       # Dm7
        [F - 7, F + 5, F + 9, F + 12, F + 14],       # B♭add9
    ]
    # sweet, joyful music-box motif per chord (degrees in semitones over F5)
    motif = [[12, 16, 19, 16], [14, 19, 21, 19], [16, 21, 19, 16], [14, 12, 9, 12]]
    bars = int(seconds / BAR) + 1
    for b in range(bars):
        ch = chords[b % 4]
        t0 = b * BAR
        hum = lambda: rng.uniform(-0.012, 0.012)    # human timing
        # bass note + broken chord in gentle eighths
        place(pno, felt_piano(midi(ch[0] - 12), 4.5, 0.45), t0)
        pattern = [1, 2, 3, 4, 3, 2, 3, 4]
        for k, i in enumerate(pattern):
            v = 0.32 if k % 2 else 0.38
            if b < 2:
                v *= 0.85
            place(pno, felt_piano(midi(ch[i]), 3.0, v), t0 + k * BEAT / 2 + hum())
        if b >= 2:   # strings enter
            place(pad, strings([midi(n) for n in ch[1:4]], BAR + 1.6), t0 - 0.4)
        if b >= 4:   # music box sings the joyful motif
            mv = 0.20 if b < 8 else 0.26
            for k, d in enumerate(motif[b % 4]):
                place(box, music_box(midi(F + 12 + d), 2.4, mv), t0 + k * BEAT + hum())
        if b >= 8 and b % 2 == 1:  # little sparkles in the second half
            place(box, music_box(midi(F + 36 + [0, 4, 7][b % 3]), 1.5, 0.08), t0 + 3.5 * BEAT)
    mix = pno * 0.9 + box * 0.75 + pad * 0.42
    mix = reverb(mix)
    t = np.arange(total) / SR
    mix *= np.clip(t / 2.0, 0, 1) * np.clip((seconds - t) / 4.0, 0, 1)
    mix = np.tanh(mix / (np.abs(mix).max() + 1e-9) * 1.1)
    mix = mix / np.abs(mix).max() * 0.88
    right = np.concatenate([np.zeros(int(0.010 * SR)), mix])[:total]
    return np.stack([mix, right * 0.96 + mix * 0.04], 1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--output", default="music/sweet_piano_66bpm.wav")
    ap.add_argument("--seconds", type=float, default=62)
    a = ap.parse_args()
    os.makedirs(os.path.dirname(a.output) or ".", exist_ok=True)
    wavfile.write(a.output, SR, (compose(a.seconds) * 32767).astype(np.int16))
    print("wrote", a.output)
