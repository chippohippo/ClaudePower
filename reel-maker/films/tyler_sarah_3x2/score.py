#!/usr/bin/env python3
"""
score.py — original score for "The Garden, Before and After" (royalty-free).

Modern-classical, D♭ major: felt piano + a small string section (cellos carry
the theme; violins only arrive in Act IV), a touch of harp. A four-note motif
rises a third and falls back — a question and its answer.

Cue times come from the edit, so swells / drops / silences land exactly:
    python ../../film.py edit.json --cues > cues.json
    python score.py cues.json -o score.wav
"""

import argparse
import json
import os
import sys

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import make_music as mm  # noqa: E402  (instruments, room, helpers)

SR = mm.SR
BPM = 60
BEAT = 60 / BPM
DB = 49            # D♭3
rng = np.random.default_rng(31)

# I – vi – IV – V  in D♭ (D♭ – B♭m – G♭ – A♭), warm add9 / sus voicings
CHORDS = [
    [DB, DB + 7, DB + 12, DB + 14, DB + 16],
    [DB - 3, DB + 7, DB + 9, DB + 12, DB + 16],
    [DB - 7, DB + 5, DB + 9, DB + 12, DB + 14],
    [DB - 5, DB + 7, DB + 11, DB + 14, DB + 19],
]
# the motif: up a third, up a step, back down — question → answer
MOTIF = [(DB + 24, 1.5), (DB + 28, 1.0), (DB + 30, 1.5), (DB + 28, 2.0)]
ANSWER = [(DB + 31, 1.5), (DB + 30, 1.0), (DB + 28, 1.5), (DB + 24, 2.0)]


def piano_bar(buf, t0, chord, vel, sparse=False):
    mm.place(buf, mm.felt_piano(mm.midi(chord[0] - 12), 5.0, vel * 1.1), t0)
    pattern = [1, 3, 2, 4] if sparse else [1, 2, 3, 4, 3, 2, 3, 4]
    step = BEAT if sparse else BEAT / 2
    for k, i in enumerate(pattern):
        mm.place(buf, mm.felt_piano(mm.midi(chord[i]), 3.2, vel * (0.85 if k % 2 else 1)),
                 t0 + k * step + rng.uniform(-0.015, 0.015))


def melody(buf, t0, phrase, inst, vel, octave=0):
    t = t0
    for note, beats in phrase:
        d = beats * BEAT
        if inst == "piano":
            mm.place(buf, mm.felt_piano(mm.midi(note + octave), d + 2.5, vel), t)
        else:
            mm.place(buf, mm.bowed(mm.midi(note + octave), d + 0.4, vel, att=0.35, rel=0.6,
                                   n_players=8, bright=4200 if octave >= 0 else 2400), t)
        t += d


def compose(cues, total):
    n = int((total + 4) * SR)
    P = {k: np.zeros(n) for k in ("piano", "harp", "vln", "vla", "vc", "cb", "horn", "timp", "cym")}
    c = lambda k, d=None: cues.get(k, d)
    bar = 4 * BEAT

    def bars(a, b):
        t = a
        k = 0
        while t < b - 0.5:
            yield k, t
            t += bar
            k += 1

    # I · many hands — single piano notes, then sparse chords
    a, b = c("hands"), c("roses")
    mm.place(P["piano"], mm.felt_piano(mm.midi(DB + 24), 6, 0.35), a)
    for k, t in bars(a + bar, b):
        piano_bar(P["piano"], t, CHORDS[k % 4], 0.22, sparse=True)
    # roses → the motif appears on piano
    a, b = c("roses"), c("wait")
    for k, t in bars(a, b):
        piano_bar(P["piano"], t, CHORDS[k % 4], 0.26)
        if k % 2 == 0:
            melody(P["piano"], t, MOTIF if k % 4 == 0 else ANSWER, "piano", 0.30)
    # the wait — motif stretches, leaves one held cello note, fades
    a, b = c("wait"), c("question")
    mm.place(P["piano"], mm.felt_piano(mm.midi(DB + 24), 6, 0.25), a)
    mm.place(P["vc"], mm.bowed(mm.midi(DB), b - a + 1.0, 0.30, att=2.5, rel=b - a - 2.5,
                               bright=1800), a)
    # the question — SILENCE (diegetic only)
    # everyone — strings enter under the cheer
    a, b = c("everyone"), c("them")
    for k, t in bars(a, b):
        ch = CHORDS[k % 4]
        mm.place(P["vc"], mm.bowed(mm.midi(ch[0]), bar + 0.8, 0.30, att=1.0, bright=2200), t)
        mm.place(P["vla"], mm.bowed(mm.midi(ch[2]), bar + 0.8, 0.20, att=1.2), t)
        mm.place(P["vla"], mm.bowed(mm.midi(ch[3]), bar + 0.8, 0.18, att=1.2), t)
        piano_bar(P["piano"], t, ch, 0.24)
        if k % 2 == 1:
            melody(P["vc"], t, MOTIF, "strings", 0.32, octave=-12)
    # them — full theme: violins arrive, cellos answer, harp
    a, b = c("them"), c("ring")
    for k, t in bars(a, b):
        ch = CHORDS[k % 4]
        piano_bar(P["piano"], t, ch, 0.24)
        mm.place(P["vc"], mm.bowed(mm.midi(ch[0]), bar + 0.8, 0.30, att=0.8, bright=2200), t)
        mm.place(P["cb"], mm.bowed(mm.midi(ch[0] - 12), bar + 0.6, 0.25, att=0.8,
                                   bright=900, n_players=4), t)
        mm.place(P["vla"], mm.bowed(mm.midi(ch[2]), bar + 0.8, 0.22, att=1.0), t)
        melody(P["vln"], t, MOTIF if k % 2 == 0 else ANSWER, "strings", 0.30)
        if k % 2 == 1:
            melody(P["vc"], t + 2 * BEAT, ANSWER, "strings", 0.18, octave=-24)
        for j, i in enumerate([0, 1, 2, 3, 4]):
            mm.place(P["harp"], mm.harp(mm.midi(ch[i] + 12), 3, 0.18), t + j * 0.11)
    # last chord of 'them' rings out under the cut to the ring, then SILENCE
    # family — theme returns brighter (violins up an octave, soft horn)
    a, b = c("family"), c("coda")
    for k, t in bars(a, b):
        ch = CHORDS[k % 4]
        piano_bar(P["piano"], t, ch, 0.26)
        mm.place(P["vc"], mm.bowed(mm.midi(ch[0]), bar + 0.8, 0.32, att=0.6, bright=2400), t)
        mm.place(P["vla"], mm.bowed(mm.midi(ch[3]), bar + 0.8, 0.22, att=0.8), t)
        melody(P["vln"], t, MOTIF if k % 2 == 0 else ANSWER, "strings", 0.30, octave=12)
        melody(P["vln"], t, MOTIF if k % 2 == 0 else ANSWER, "strings", 0.22)
        mm.place(P["horn"], mm.horn(mm.midi(ch[0] + 12), bar + 0.4, 0.14, att=0.9), t)
        for j, i in enumerate([0, 1, 2, 3, 4]):
            mm.place(P["harp"], mm.harp(mm.midi(ch[i] + 12), 3, 0.2), t + j * 0.09)
    # coda — piano alone resolving, final held D♭ chord with soft strings
    a, b = c("coda"), total
    for k, t in bars(a, b - bar):
        piano_bar(P["piano"], t, CHORDS[k % 4], 0.22, sparse=True)
    tend = max(a, b - bar - 1.5)
    melody(P["piano"], tend - 2 * bar, ANSWER, "piano", 0.26)
    for i, nn in enumerate([DB - 12, DB, DB + 7, DB + 12, DB + 16, DB + 19, DB + 24]):
        mm.place(P["harp"], mm.harp(mm.midi(nn + 12), 6, 0.16), tend + i * 0.12)
        mm.place(P["vla"], mm.bowed(mm.midi(nn), 7.5, 0.10, att=2.0, rel=4.0), tend)
    mm.place(P["piano"], mm.felt_piano(mm.midi(DB - 12), 7, 0.4), tend)
    return P, n


def mix(P, n, total, cues):
    t = np.arange(n) / SR
    stage = dict(piano=(0.85, 0.0, 0.15), harp=(0.6, -0.55, 0.35), vln=(0.75, -0.45, 0.4),
                 vla=(0.55, -0.15, 0.45), vc=(0.65, 0.35, 0.4), cb=(0.5, 0.6, 0.55),
                 horn=(0.5, 0.45, 0.75), timp=(0.4, 0.25, 0.85), cym=(0.3, -0.2, 0.8))
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    for k, (g, pan, dist) in stage.items():
        x = P[k] * g
        if dist > 0.3:
            x = mm.filt(x, 9000 - 5000 * dist)
        th = (pan + 1) * np.pi / 4
        d = int(abs(pan) * 0.0006 * SR)
        xl = x if pan <= 0 else np.concatenate([np.zeros(d), x])[:n]
        xr = x if pan >= 0 else np.concatenate([np.zeros(d), x])[:n]
        dry += np.stack([xl * np.cos(th), xr * np.sin(th)], 1) * (1 - 0.45 * dist)
        send += np.stack([xl * np.cos(th), xr * np.sin(th)], 1) * (0.35 + 0.65 * dist)
    st = dry * 0.72 + mm.space(send) * 0.6
    st += mm.filt(st, 180) * 0.15
    # dynamics per act (the silences are hard zero, with short fades)
    q, e, r, f = cues["question"], cues["everyone"], cues["ring"], cues["family"]
    pts = [(0, 0), (cues["hands"] - 0.1, 0), (cues["hands"], 0.55), (cues["roses"], 0.7),
           (cues["wait"], 0.6), (q - 1.5, 0.35), (q, 0.0), (e - 0.05, 0.0), (e + 4, 0.75),
           (cues["them"], 0.9), (r - 1.2, 0.8), (r, 0.0), (f - 0.05, 0.0), (f + 1.5, 1.0),
           (cues["coda"], 0.8), (total - 3, 0.6), (total, 0.0)]
    arc = np.interp(t, [p[0] for p in pts], [p[1] for p in pts])
    st *= arc[:, None]
    return st / (np.abs(st).max() + 1e-9) * 0.9


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cues")
    ap.add_argument("-o", "--output", default="score.wav")
    a = ap.parse_args()
    cues = json.load(open(a.cues))
    total = cues.pop("total")
    P, n = compose(cues, total)
    st = mix(P, n, total, cues)[: int(total * SR)]
    wavfile.write(a.output, SR, (st * 32767).astype(np.int16))
    print("wrote", a.output, f"{total:.1f}s")
