#!/usr/bin/env python3
"""
make_music.py — synthesise a grand, sweet, joyful orchestral score (royalty-free).

F major, 66 BPM. Arc (fits a 60 s reel):
   0–7 s   felt piano + harp, intimate
   7–29 s  strings enter, violins sing the theme, cellos answer
  29–33 s  cymbal + timpani swell
  33–51 s  full orchestra: horns carry the theme, octave violins, timpani
  51–62 s  settles back to piano, harp and soft strings; final held chord

    python make_music.py -o music/orchestral_66bpm.wav --seconds 62
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
rng = np.random.default_rng(11)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def filt(x, hz, kind="low", order=2):
    return sosfilt(butter(order, hz, kind, fs=SR, output="sos"), x)


def env_asr(n, att, rel, dur):
    t = np.arange(n) / SR
    return np.clip(t / max(att, 1e-3), 0, 1) ** 1.5 * np.clip((dur - t) / max(rel, 1e-3), 0, 1)


# ── instruments ──────────────────────────────────────────────────────────────
def felt_piano(f, dur, vel=0.5):
    t = np.arange(int(dur * SR)) / SR
    e = np.exp(-t * (1.1 + f / 1400)) * (1 - np.exp(-t * 160))
    s = sum((0.45 ** k) * np.sin(2 * np.pi * f * (k + 1) * t) for k in range(5))
    return filt(s * e, 2600) * vel


def harp(f, dur=3.0, vel=0.35):
    t = np.arange(int(dur * SR)) / SR
    s = sum((0.55 ** k) * np.sin(2 * np.pi * f * (k + 1) * t) * np.exp(-t * (1.6 + k * 1.2))
            for k in range(6))
    return s * (1 - np.exp(-t * 900)) * vel


def bowed(f, dur, vel, att=0.5, rel=0.6, bright=3500, n_players=6, vib=0.005):
    """String section: several detuned, vibrato'd sawtooth-ish voices."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for _ in range(n_players):
        det = 2 ** (rng.uniform(-0.09, 0.09) / 12)
        v = 1 + vib * np.sin(2 * np.pi * rng.uniform(4.6, 5.8) * t + rng.uniform(0, 6))
        ph = 2 * np.pi * f * det * np.cumsum(v) / SR + rng.uniform(0, 6)
        out += sum(np.sin(k * ph) / k for k in range(1, 9))
    out = filt(out / n_players, bright)
    out = filt(out, 90, "high")
    return out * env_asr(n, att, rel, dur) * vel


def horn(f, dur, vel, att=0.35):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for det in (-0.05, 0.05, 0.0):
        ph = 2 * np.pi * f * 2 ** (det / 12) * np.cumsum(1 + 0.003 * np.sin(2 * np.pi * 5 * t)) / SR
        out += sum((0.7 ** k) * np.sin((k + 1) * ph) for k in range(7))
    # brightness opens as the note swells
    out = filt(out / 3, 1400)
    return out * env_asr(n, att, 0.5, dur) * vel


def timpani(f, vel=0.6, dur=2.5):
    t = np.arange(int(dur * SR)) / SR
    tone = sum(a * np.sin(2 * np.pi * f * m * t) for a, m in ((1, 1), (0.5, 1.5), (0.3, 1.99)))
    hit = filt(rng.standard_normal(len(t)), 300) * np.exp(-t * 30) * 0.6
    return (tone * np.exp(-t * 2.2) + hit) * vel


def timp_roll(f, dur, vel):
    out = np.zeros(int((dur + 2.5) * SR))
    k, n = 0, int(dur / 0.07)
    for k in range(n):
        g = (k / n) ** 2 * vel
        place(out, timpani(f, g * rng.uniform(0.8, 1.0), 1.5), k * 0.07)
    return out


def cymbal_swell(dur, vel=0.25):
    n = int(dur * SR)
    noise = filt(rng.standard_normal(n), 3000, "high")
    return noise * (np.arange(n) / n) ** 3 * vel


# ── helpers ──────────────────────────────────────────────────────────────────
def place(buf, sig, at):
    i = max(int(at * SR), 0)
    j = min(len(buf), i + len(sig))
    if i < len(buf):
        buf[i:j] += sig[: j - i]


def hall(x, seconds=4.5, mix=0.42):
    n = int(seconds * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 1.7)
    ir = filt(ir, 5000)
    wet = fftconvolve(x, ir)[: len(x)]
    wet *= np.abs(x).max() / (np.abs(wet).max() + 1e-9)
    return x * (1 - mix) + wet * mix


# ── score ────────────────────────────────────────────────────────────────────
F = 53  # F3
CHORDS = [  # I – V/3 – vi – IV
    [F, F + 7, F + 12, F + 16, F + 19],
    [F - 1, F + 7, F + 11, F + 14, F + 19],
    [F - 3, F + 9, F + 12, F + 16, F + 21],
    [F - 7, F + 5, F + 9, F + 12, F + 17],
]
# joyful theme (MIDI notes, beats) per chord
THEME = [
    [(72, 2), (74, 1), (76, 1)],
    [(74, 2), (72, 1), (67, 1)],
    [(69, 1), (72, 1), (74, 1), (77, 1)],
    [(76, 2), (74, 1), (72, 1)],
]


def compose(seconds):
    total = int(seconds * SR)
    parts = {k: np.zeros(total) for k in
             ("piano", "harp", "vln", "vla", "vc", "cb", "horn", "timp", "cym")}
    bars = int(seconds / BAR) + 1
    climax = range(9, 14)
    for b in range(bars):
        ch = CHORDS[b % 4]
        t0 = b * BAR
        last = t0 + BAR > seconds - 6
        # dynamics curve 0..1
        dyn = {0: .25, 1: .3, 2: .4, 3: .45, 4: .55, 5: .6, 6: .65, 7: .7, 8: .8}.get(b, 1.0)
        if b >= 14:
            dyn = max(0.35, 1.0 - (b - 13) * 0.25)

        # piano: always present, carries intimacy (quieter in the climax)
        pv = 0.38 if b not in climax else 0.22
        place(parts["piano"], felt_piano(midi(ch[0] - 12), 4.5, pv + 0.05), t0)
        for k, i in enumerate([1, 2, 3, 4, 3, 2, 3, 4]):
            place(parts["piano"], felt_piano(midi(ch[i]), 3.0, pv * (0.9 if k % 2 else 1)),
                  t0 + k * BEAT / 2 + rng.uniform(-0.01, 0.01))
        # harp glissando-ish arpeggio up every bar
        hv = 0.22 if b < 9 else 0.3
        for k, i in enumerate([0, 1, 2, 3, 4]):
            place(parts["harp"], harp(midi(ch[i] + 12), 3, hv), t0 + k * 0.09)

        if b >= 2:  # strings bed
            d = BAR + 0.6
            place(parts["vla"], bowed(midi(ch[2]), d, 0.25 * dyn, att=0.9), t0 - 0.2)
            place(parts["vla"], bowed(midi(ch[3]), d, 0.22 * dyn, att=0.9), t0 - 0.2)
            place(parts["vc"], bowed(midi(ch[0]), d, 0.35 * dyn, att=0.7, bright=2000), t0 - 0.1)
        if b >= 4:  # violins sing the theme
            tt = t0
            for note, beats in THEME[b % 4]:
                dur = beats * BEAT + 0.25
                v = 0.32 * dyn
                place(parts["vln"], bowed(midi(note), dur, v, att=0.18, rel=0.35, n_players=8), tt)
                if b in climax:  # octave doubling = grandeur
                    place(parts["vln"], bowed(midi(note + 12), dur, v * 0.6, att=0.18, rel=0.35,
                                              n_players=8, bright=5000), tt)
                tt += beats * BEAT
        if b >= 6:
            place(parts["cb"], bowed(midi(ch[0] - 12), BAR + 0.4, 0.35 * dyn, att=0.4,
                                     bright=900, n_players=4), t0)
        if b == 8:  # build into the climax
            place(parts["cym"], cymbal_swell(BAR, 0.3), t0)
            place(parts["timp"], timp_roll(midi(F - 12 + 7), BAR, 0.5), t0)
        if b in climax:
            # horns carry the theme a sixth below, swelling
            tt = t0
            for note, beats in THEME[b % 4]:
                place(parts["horn"], horn(midi(note - 12), beats * BEAT + 0.3, 0.28), tt)
                tt += beats * BEAT
            place(parts["horn"], horn(midi(ch[0]), BAR + 0.3, 0.18, att=0.6), t0)
            place(parts["timp"], timpani(midi(ch[0] % 12 + 41), 0.55), t0)
            place(parts["timp"], timpani(midi(ch[0] % 12 + 41), 0.3), t0 + 2 * BEAT)
            if b == climax[0]:
                place(parts["cym"], filt(rng.standard_normal(int(4 * SR)), 2500, "high")
                      * np.exp(-np.arange(int(4 * SR)) / SR * 1.2) * 0.22, t0)
        if last:
            break

    # final held F major chord (strings + horn + harp roll)
    tend = min(bars * BAR, seconds - 6)
    fin = [F - 12, F, F + 7, F + 12, F + 16, F + 19, F + 24]
    for i, n in enumerate(fin):
        place(parts["harp"], harp(midi(n + 12), 5, 0.25), tend + i * 0.08)
        place(parts["vla"], bowed(midi(n), 6.5, 0.16, att=1.2, rel=3.5), tend)
    place(parts["horn"], horn(midi(F + 12), 5.5, 0.12, att=1.0), tend)
    place(parts["piano"], felt_piano(midi(F - 12), 6, 0.45), tend)

    gains = dict(piano=0.9, harp=0.7, vln=0.75, vla=0.55, vc=0.6, cb=0.5, horn=0.6,
                 timp=0.55, cym=0.35)
    mix = sum(parts[k] * g for k, g in gains.items())
    mix = hall(mix)
    t = np.arange(total) / SR
    # master dynamics arc: intimate -> swell -> grand climax -> gentle resolve
    arc_t = [0, 7, 15, 29, 33, 45, 51, 56, seconds]
    arc_g = [0.30, 0.38, 0.50, 0.62, 1.0, 1.0, 0.62, 0.45, 0.40]
    mix *= np.interp(t, arc_t, arc_g)
    mix *= np.clip(t / 1.5, 0, 1) * np.clip((seconds - t) / 3.0, 0, 1)
    mix = np.tanh(mix / (np.abs(mix).max() + 1e-9) * 1.25)
    mix = mix / np.abs(mix).max() * 0.9
    # orchestral stereo: violins/harp left-ish, cellos/horn right-ish
    left = mix + 0.15 * hall(parts["vln"] * 0.4 + parts["harp"] * 0.3, mix=0.5)
    right = mix + 0.15 * hall(parts["vc"] * 0.4 + parts["horn"] * 0.3, mix=0.5)
    st = np.stack([left, right], 1)
    st *= np.interp(t, arc_t, arc_g)[:, None] ** 0.15
    st *= np.clip(t / 1.5, 0, 1)[:, None] * np.clip((seconds - t) / 3.0, 0, 1)[:, None]
    return st / np.abs(st).max() * 0.9


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--output", default="music/orchestral_66bpm.wav")
    ap.add_argument("--seconds", type=float, default=62)
    a = ap.parse_args()
    os.makedirs(os.path.dirname(a.output) or ".", exist_ok=True)
    wavfile.write(a.output, SR, (compose(a.seconds) * 32767).astype(np.int16))
    print("wrote", a.output)
