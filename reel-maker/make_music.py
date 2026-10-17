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
    # felt hammer thump + slight string detune shimmer
    hammer = filt(rng.standard_normal(len(t)), 1200) * np.exp(-t * 60) * 0.08
    s = s + 0.25 * np.sin(2 * np.pi * f * 1.0015 * t)
    return filt(s * e + hammer, 2800 + vel * 1500) * vel


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
    # rosin/bow noise: band-limited, follows the note, strongest on the attack
    bow = filt(filt(rng.standard_normal(n), 6000), 1500, "high")
    out = out / n_players + bow * 0.02 * (0.4 + np.exp(-t * 6))
    out = filt(out, bright)
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

    t = np.arange(total) / SR
    # master dynamics arc: intimate -> swell -> grand climax -> gentle resolve
    arc_t = [0, 7, 15, 29, 33, 45, 51, 56, seconds]
    arc_g = [0.30, 0.38, 0.50, 0.62, 1.0, 1.0, 0.62, 0.45, 0.40]
    arc = np.interp(t, arc_t, arc_g)

    # ── stage the orchestra: (gain, pan -1..1, distance 0 near..1 far) ──
    # classic seating: 1st violins + harp left, violas centre-left,
    # cellos centre-right, basses + horns right and further back.
    stage = dict(piano=(0.85, 0.0, 0.15), harp=(0.65, -0.55, 0.35),
                 vln=(0.75, -0.45, 0.4), vla=(0.55, -0.15, 0.45),
                 vc=(0.6, 0.35, 0.45), cb=(0.5, 0.6, 0.55),
                 horn=(0.55, 0.45, 0.75), timp=(0.5, 0.25, 0.85),
                 cym=(0.3, -0.2, 0.8))
    dry = np.zeros((total, 2))
    send = np.zeros((total, 2))
    for k, (g, pan, dist) in stage.items():
        x = parts[k] * g
        # distance: further instruments are darker and quieter in the dry signal
        if dist > 0.3:
            x = filt(x, 9000 - 5000 * dist)
        theta = (pan + 1) * np.pi / 4               # equal-power pan law
        L, R = np.cos(theta), np.sin(theta)
        # Haas micro-delay on the far side for a real sense of position
        d = int(abs(pan) * 0.0006 * SR)
        xl = x if pan <= 0 else np.concatenate([np.zeros(d), x])[:total]
        xr = x if pan >= 0 else np.concatenate([np.zeros(d), x])[:total]
        dry += np.stack([xl * L, xr * R], 1) * (1 - 0.45 * dist)
        send += np.stack([xl * L, xr * R], 1) * (0.35 + 0.65 * dist)
    # piano is recorded as a wide stereo pair (bass left, treble right feel)
    pw = parts["piano"] * stage["piano"][0]
    dry[:, 0] += filt(pw, 700) * 0.12
    dry[:, 1] += filt(pw, 1500, "high") * 0.12

    # ── studio room + hall: decorrelated stereo early reflections & tail ──
    wet = space(send)
    st = dry * 0.72 + wet * 0.55
    # gentle warmth (low-shelf-ish) and air
    st += filt(st, 180) * 0.18
    st += filt(st, 9000, "high") * 0.08
    st *= arc[:, None]
    st *= np.clip(t / 1.5, 0, 1)[:, None] * np.clip((seconds - t) / 3.0, 0, 1)[:, None]
    # transparent bus "glue": slow RMS leveller, no hard clipping
    rms = np.sqrt(fftconvolve((st ** 2).mean(1), np.ones(SR // 2) / (SR // 2), "same")) + 1e-6
    target = np.percentile(rms, 90)
    gain = np.clip((target / rms) ** 0.25, 0.8, 1.6)
    st *= gain[:, None]
    return st / np.abs(st).max() * 0.89


def space(x):
    """Stereo room: 20 ms pre-delay, discrete early reflections (studio walls),
    then a long decorrelated hall tail per channel for a wide soundstage."""
    n_er, n_tail = int(0.09 * SR), int(3.8 * SR)
    out = np.zeros_like(x)
    for ch in range(2):
        r = np.random.default_rng(100 + ch)
        er = np.zeros(n_er)
        for _ in range(14):
            er[r.integers(int(0.008 * SR), n_er)] += r.uniform(-0.6, 0.6)
        tail = r.standard_normal(n_tail) * np.exp(-np.arange(n_tail) / SR * 1.9)
        tail = filt(tail, 6500) * (1 - np.exp(-np.arange(n_tail) / SR * 25))
        ir = np.concatenate([np.zeros(int(0.02 * SR)), er * 1.2, tail * 0.35])
        # cross-feed a little so the stage is wide but not hollow
        src = x[:, ch] * 0.8 + x[:, 1 - ch] * 0.2
        out[:, ch] = fftconvolve(src, ir)[: len(x)]
    return out * (np.abs(x).max() / (np.abs(out).max() + 1e-9))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--output", default="music/orchestral_66bpm.wav")
    ap.add_argument("--seconds", type=float, default=62)
    a = ap.parse_args()
    os.makedirs(os.path.dirname(a.output) or ".", exist_ok=True)
    wavfile.write(a.output, SR, (compose(a.seconds) * 32767).astype(np.int16))
    print("wrote", a.output)
