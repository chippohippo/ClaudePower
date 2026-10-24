#!/usr/bin/env python3
"""
build_edit.py — Cortney & Max long trailer (16:9, ~3:27), in the style of the
couple's vertical short: 2-beat (≈0.88 s) detail cuts at 136 BPM, ~1/3 of
b-roll at 80 %, ceremony speech from the lav laid over the real song, which
blends to its instrumental under every line.

Writes edit.json (picture, for film.py) and audio.json (for trailer_audio.py).
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SONG_START = 6.0                      # film time where the song begins
_b = np.array(json.load(open(os.path.join(HERE, "song_beats.json")))["beats"])
_p = float(np.median(np.diff(_b)))           # 60/136 s
# the tracker drops beats in places: fill gaps and extend the grid to the song's end
_g = [_b[0]]
for x in _b[1:]:
    while x - _g[-1] > 1.5 * _p:
        _g.append(_g[-1] + _p)
    _g.append(x)
while _g[-1] < 200.0:
    _g.append(_g[-1] + _p)
beats = np.array(_g) + SONG_START


def snap(t):
    return float(beats[np.argmin(np.abs(beats - t))])


segs = []


def music_block(t0, t1, shots):
    """Fill [t0, t1] with shots cut on the beat. shots: (clip, pick[a,b], beats, kw)."""
    t = t0
    bi = int(np.searchsorted(beats, t0 - 1e-3))
    for k, (clip, rng, nb, kw) in enumerate(shots):
        if t >= t1 - 0.3:
            break
        end = t1 if k == len(shots) - 1 else min(t1, float(beats[min(bi + nb, len(beats) - 1)]))
        bi += nb
        d = round(end - t, 3)
        if d < 0.3:
            continue
        s = dict(clip=clip, dur=d, **kw)
        s["in"] = rng[0]
        if rng[1] > rng[0]:
            s["pick"] = list(rng)
        segs.append(s)
        t = end
    return t


def sync_block(t0, chunks):
    """Speech chunks with lip-synced picture. chunk = (film_at, src_a, src_b, [(dur, kw), ...])."""
    for at, a, b, cuts in chunks:
        t = at
        src = a
        for d, kw in cuts:
            if "clip" in kw:                     # cutaway: speech continues over b-roll
                kw = dict(kw)
                c, rng = kw.pop("clip"), kw.pop("pick")
                segs.append(dict(clip=c, **{"in": rng[0]}, pick=rng, dur=round(d, 3), **kw))
            else:
                segs.append(dict(clip="0543", **{"in": round(src, 3)}, dur=round(d, 3), stab=False,
                                 track=False, **kw))
            t += d
            src += d
    return t


D = dict(tempo="dream")                    # 80 % like the short
W = dict(zoom=0.04)                        # slow push

# ── COLD OPEN: "Today we witness…" over the empty arch ──────────────────────
segs.append(dict(clip="0535", **{"in": 0.0}, pick=[0, 12], dur=SONG_START, zoom=[1.0, 1.06], fade_in=1.2,
                 track=False, couple=False))

# ── INTRO (song 0–15.4): details on the 2-beat grid ─────────────────────────
NC = dict(couple=False, track=False)
t = music_block(SONG_START, snap(SONG_START + 15.4), [
    ("0506", [0, 4], 4, dict(**D, **NC, **W)),
    ("0504", [0, 5], 2, dict(**NC)),
    ("0505", [0, 3], 2, dict(**D, **NC)),
    ("0510", [0, 3], 4, dict(**D, **NC, **W)),
    ("0508", [0, 5], 2, dict(**NC)),
    ("0509", [0, 4], 2, dict(**D, **NC)),
    ("0507", [0, 3], 2, dict(**NC)),
    ("0513", [0, 4], 2, dict(**D, **NC)),
    ("0514", [0, 3], 2, dict(**NC)),
    ("0515", [0, 2.5], 2, dict(**D, **NC)),
    ("0516", [0, 2.5], 2, dict(**NC)),
    ("0518", [0, 4.5], 4, dict(**D, **NC, **W)),
    ("0519", [0, 6], 2, dict(**NC)),
    ("0521", [0, 4.5], 4, dict(**D, **NC)),
])
# ── VERSE 1 (song 15.4–28.3): more details, guests arrive ───────────────────
t = music_block(t, snap(SONG_START + 28.3), [
    ("0520", [0, 5.5], 2, dict(**NC)),
    ("0522", [0, 10], 2, dict(**D, **NC)),
    ("0523", [0, 6], 2, dict(**NC)),
    ("0524", [0, 4.2], 2, dict(**D, **NC)),
    ("0533", [0, 4], 2, dict(**NC)),
    ("0534", [0, 12], 2, dict(**D, **NC)),
    ("0517", [0, 2.5], 2, dict(**NC)),
    ("0525", [0, 7.5], 2, dict(**D, **NC)),
    ("0527", [0, 3.5], 2, dict(**NC)),
    ("0531", [0, 13], 2, dict(**D, **NC)),
    ("0528", [0, 6], 2, dict(couple=False)),
    ("0530", [0, 7.5], 2, dict(couple=False)),
    ("0532", [0, 3.5], 2, dict(**NC)),
    ("0536", [0, 30], 2, dict(couple=False)),
    ("0539", [0, 10], 2, dict(couple=False)),
    ("0540", [0, 9], 2, dict(**D, couple=False)),
    ("0541", [0, 4.5], 2, dict(couple=False)),
])
# ── BUILD (song 28.3–42.8): the processional ─────────────────────────────────
P = dict(couple=False)
t = music_block(t, snap(SONG_START + 42.8), [
    ("0543", [186, 200], 2, dict(**P)),
    ("0543", [228, 240], 2, dict(**P)),
    ("0543", [252, 262], 2, dict(**P)),
    ("0543", [278, 290], 2, dict(**P)),
    ("0543", [306, 318], 2, dict(**P)),
    ("0543", [338, 350], 2, dict(**D, **P)),
    ("0543", [386, 402], 2, dict(**P)),
    ("0543", [507, 517], 4, dict(**D, couple=True, zoom=0.05)),
    ("0543", [518, 526], 2, dict(couple=True)),
    ("0543", [526, 536], 4, dict(**D, couple=True)),
])
# ── CHORUS 1 (song 42.8–72): at the arch; the homily's line on choice ───────
t = music_block(t, 64.0 - 0.6, [
    ("0543", [536, 546], 4, dict(couple=True, zoom=0.05)),
    ("0543", [100, 180], 2, dict(couple=False)),
    ("0526", [0, 10], 2, dict(**D, **NC)),
    ("0543", [546, 556], 4, dict(couple=True, x=0.42, zoom=[1.3, 1.36])),
    ("0543", [180, 186], 2, dict(couple=False)),
    ("0535", [0, 13], 2, dict(**D, **NC)),
    ("0543", [556, 600], 4, dict(couple=True, zoom=0.04)),
    ("0543", [600, 640], 2, dict(x=0.45, zoom=[1.4, 1.44])),
])
t = sync_block(t, [(63.4, 796.42, 803.0, [(2.2, dict(clip="0510", pick=[0, 3], couple=False, track=False, tempo='dream')),
                                         (2.2, dict(clip="0507", pick=[0, 3], couple=False, track=False)),
                                         (2.2, dict(x=0.45, y=0.5, zoom=[1.45, 1.5]))])])
t = music_block(t, 78.5, [
    ("0543", [640, 700], 2, dict(couple=True, x=0.45, zoom=[1.4, 1.44])),
    ("0519", [0, 6], 2, dict(**D, **NC)),
    ("0543", [700, 760], 2, dict(couple=True, zoom=0.04)),
    ("0521", [0, 4.5], 2, dict(**NC)),
    ("0543", [760, 830], 4, dict(couple=True, x=0.47, zoom=[1.35, 1.4])),
])
# ── VERSE 2 → CHORUS 2: the vows (lip-synced, wide ↔ push-in on the speaker)
MAXP = dict(x=0.58, y=0.48, zoom=[1.55, 1.6])
CWP = dict(x=0.42, y=0.48, zoom=[1.55, 1.6])
TWO = dict(x=0.5, y=0.5, zoom=[1.2, 1.24])
t = sync_block(78.5, [
    (78.5, 916.0, 925.2, [(3.4, TWO), (5.8, MAXP)]),                     # laugh / angel
])
t = music_block(t, 88.4, [("0543", [925, 940], 1, dict(couple=True, **TWO))])
t = sync_block(t, [
    (88.4, 943.9, 950.7, [(3.2, MAXP), (1.8, dict(clip="0539", pick=[0, 10], couple=False, track=False)), (1.8, dict(clip="0540", pick=[0, 9], couple=False, track=False))]),   # first person I see
])
t = music_block(t, 96.0, [("0526", [0, 10], 2, dict(**D, **NC))])
t = sync_block(t, [
    (96.0, 1030.25, 1038.55, [(3.6, TWO), (4.7, MAXP)]),                 # I love you Courtney…
])
t = music_block(t, 105.1, [("0543", [1040, 1060], 1, dict(couple=True, zoom=0.03))])
t = sync_block(t, [
    (105.1, 1065.4, 1070.1, [(2.3, CWP), (2.4, dict(clip="0528", pick=[0, 6], couple=False, track=False, tempo='dream'))]),     # when we first met (photo wall)
])
t = music_block(t, 110.6, [("0543", [1080, 1091], 1, dict(couple=True, **TWO))])
t = sync_block(t, [
    (110.6, 1091.35, 1097.0, [(2.6, TWO), (3.05, CWP)]),                 # through all of this
])
t = music_block(t, 116.9, [("0543", [1170, 1187], 1, dict(couple=True, zoom=0.03))])
t = sync_block(t, [
    (116.9, 1187.6, 1194.6, [(3.4, CWP), (3.6, TWO)]),                   # cry happy tears · I love you
])
# breathing room: the chorus plays out — rings passed, glass unity
t = music_block(t, 130.0, [
    ("0543", [1240, 1265], 2, dict(couple=True, zoom=0.04)),
    ("0524", [0, 4.2], 2, dict(**D, **NC)),
    ("0543", [1300, 1330], 2, dict(couple=True, x=0.48, zoom=[1.35, 1.4])),
    ("0543", [1330, 1395], 4, dict(couple=True, **TWO)),
])
# ── BRIDGE: "take a deep breath… imprint on your heart" ──────────────────────
t = sync_block(130.0, [
    (130.0, 1597.6, 1610.8, [(3.0, dict(x=0.48, zoom=[1.0, 1.06])), (2.4, dict(clip="0525", pick=[0, 7.5], couple=False, track=False, tempo='dream')),
                             (2.4, dict(clip="0511", pick=[0, 7], couple=False, track=False, tempo='dream')), (1.6, TWO),
                             (3.8, dict(x=0.47, y=0.47, zoom=[1.5, 1.6]))]),
])
# ── FINAL CHORUS: I do · I do · declare · kiss · presented ────────────────────
t = music_block(t, 144.3, [("0543", [1398, 1425], 1, dict(couple=True, zoom=0.03))])
t = sync_block(t, [(144.3, 1430.9, 1437.4, [(3.5, TWO), (3.0, MAXP)])])
t = music_block(t, 151.6, [("0543", [1440, 1462], 1, dict(couple=True, zoom=0.03))])
t = sync_block(t, [(151.6, 1465.9, 1471.4, [(3.0, TWO), (2.5, CWP)])])
t = music_block(t, 158.0, [("0543", [1580, 1600], 1, dict(couple=True, zoom=0.03))])
t = sync_block(t, [(158.0, 1640.9, 1652.0, [(4.5, TWO), (6.6, dict(x=0.48, y=0.47, zoom=[1.4, 1.55]))])])
t = music_block(t, 170.2, [("0543", [1652, 1668], 2, dict(couple=True, x=0.48, zoom=[1.4, 1.45]))])
t = sync_block(t, [(170.2, 1671.2, 1680.0, [(4.6, dict(x=0.5, zoom=[1.0, 1.05])),
                                            (4.2, dict(x=0.49, zoom=[1.3, 1.36]))])])
# ── RECESSIONAL → after: hugs, the license, the party; bookend on the arch ──
t = music_block(t, 199.5, [
    ("0543", [1700, 1712], 4, dict(**D, couple=True)),
    ("0543", [1712, 1722], 2, dict(couple=True)),
    ("0543", [1735, 1760], 2, dict(couple=False)),
    ("0543", [1760, 1790], 2, dict(couple=True)),
    ("0544", [100, 200], 2, dict(couple=True)),
    ("0544", [200, 280], 2, dict(**D, couple=True)),
    ("0544", [300, 312], 4, dict(couple=True)),
    ("0546", [0, 58], 2, dict(couple=False)),
    ("0538", [0, 24], 2, dict(**D, couple=False)),
    ("0539", [0, 10], 2, dict(couple=False)),
    ("0542", [0, 8], 2, dict(couple=False)),
    ("0540", [0, 9], 2, dict(**D, couple=False)),
    ("0537", [0, 16], 2, dict(couple=False)),
    ("0536", [0, 30], 2, dict(couple=False)),
    ("0543", [1790, 1840], 2, dict(couple=False)),
    ("0541", [0, 4.5], 2, dict(couple=False)),
    ("0544", [312, 330], 4, dict(**D, couple=True)),
])
segs.append(dict(clip="0535", **{"in": 2.0}, dur=8.5, zoom=[1.0, 1.08], track=False, couple=False,
                 in_tr="dissolve:1.0"))                    # bookend: the empty arch, under the title
total = 207.0

edl = dict(media_dir="../../footage/cm_proxy", audio_dir="../../footage/cm_audio",
           analysis_dir="../../footage/cm_analysis", audio_mix="trailer_mix.wav",
           output="../../output/Cortney & Max - Wedding Trailer.mp4",
           film=dict(width=1920, height=1080, fps="30000/1001", crf=16, dream_speed=0.8, grain=4,
                     vignette=0.3, halation=0.10, pre_lut="../../footage/cm_lut.cube"),
           grade=dict(log_footage=False, saturation=1.05, warmth=0.35, contrast=1.1, match_luma=0.42,
                      match_wb=0.5),
           segments=segs,
           titles=[dict(text="Cortney & Max", start=total - 6.0, end=total - 0.8, y=0.47, size=0.06, fade=1.4),
                   dict(text="09 · 05 · 2026", start=total - 5.4, end=total - 0.8, y=0.56, size=0.026, fade=1.4)])
json.dump(edl, open(os.path.join(HERE, "edit.json"), "w"), indent=1)

# ── soundtrack: speech placements must match the sync blocks above ──────────
speech = [
    (0.6, 563.98, 568.88),          # Today we witness the joining…
    (64.0, 797.02, 802.90),         # A marriage is a continual choice…
    (79.0, 916.49, 924.81),         # I love the way you make me laugh… / angel… but kinda
    (88.77, 944.27, 950.37),        # first person I see in a room full of people…
    (96.3, 1030.55, 1038.37),       # I love you Courtney Shannon Murphy…
    (105.38, 1065.68, 1069.84),     # When we first met 10 years ago…
    (110.89, 1091.64, 1096.78),     # …a man that I fell in love with
    (117.2, 1187.90, 1194.38),      # I vow to cry happy tears… I love you
    (130.32, 1597.92, 1610.40),     # take a deep breath… imprint on your heart
    (144.5, 1431.10, 1437.16),      # …for now and forever? I do.
    (151.79, 1466.09, 1471.13),     # …for now and forever. I do.
    (158.24, 1641.14, 1645.40),     # …declare you husband and wife
    (170.34, 1671.34, 1679.30),     # …present to you… Max and Courtney Mulka
]
audio = dict(sr=48000, total=total, song="../../footage/cm_song/song.wav",
             song_instrumental="../../footage/cm_song/no_vocals.wav", song_start=SONG_START,
             music_db=-13, music_under_speech_db=-25, music_fade_out=3.0,
             lav="../../footage/cm_rec/001_260314.wav", lav_safety="../../footage/cm_rec/001_260314_D.wav",
             lav_words="../../footage/cm_lav.json", lav_offset=1875.94, speech_db=-17,
             speech=[dict(at=at, src=[a, b]) for at, a, b in speech],
             cheers=[dict(at=163.6, file="../../footage/cm_audio/0543.wav", src=[1646.9, 1650.3], db=-17, fade=0.5),
                     dict(at=178.3, file="../../footage/cm_audio/0543.wav", src=[1679.3, 1686.0], db=-17)])
json.dump(audio, open(os.path.join(HERE, "audio.json"), "w"), indent=1)
print(f"{len(segs)} segments, picture ends {t:.2f}s, total {total}s")
