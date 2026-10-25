#!/usr/bin/env python3
"""
build_edit.py — Cortney & Max long trailer (16:9, ~3:13), in the style of the
couple's vertical short: 2-beat (≈0.88 s) detail cuts at 136 BPM, ~1/3 of
b-roll at 80 %, ceremony speech from the lav laid over the real song, which
blends to its instrumental under every line.

v2 notes (client feedback): less saturated; no exposed lav line at the very
start (the officiant now speaks over the processional, under the music); every
couple shot is centred *between* bride and groom with both full bodies
(shoulders included) in frame; no single-speaker push-ins; ceremony shots
tripod-locked; empty-venue holds removed; road/cars shot removed.

Writes edit.json (picture, for film.py) and audio.json (for trailer_audio.py).
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SONG_START = 0.0                      # the song starts on frame one
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

# ── where the couple stands in the locked-off ceremony angle ────────────────
# (source time → [bride's outer edge, groom's outer edge], fractions of frame
# width, read off the footage at every camera framing)
COUPLE = {548: (.38, .56), 575: (.41, .60), 610: (.30, .58), 640: (.40, .73), 645: (.27, .73),
          675: (.39, .63), 700: (.35, .65),
          760: (.39, .57), 797: (.40, .58), 830: (.27, .53), 918: (.30, .63), 946: (.29, .73),
          1032: (.24, .67), 1067: (.30, .78), 1094: (.24, .73), 1190: (.29, .84), 1250: (.38, .61),
          1300: (.33, .67), 1350: (.35, .65), 1434: (.35, .62), 1469: (.35, .60), 1600: (.33, .62),
          1643: (.35, .62), 1650: (.35, .56), 1660: (.40, .58), 1674: (.36, .57)}
_ck = np.array(sorted(COUPLE))


def couple(src_t, push=0.03, zmax=1.3):
    """Framing centred between the couple, wide enough for both full bodies
    (with even breathing room each side), with a gentle push-in."""
    k = int(_ck[np.argmin(np.abs(_ck - src_t))])
    L, R = COUPLE[k]
    margin = 0.08                              # shoulders + breathing room, each side
    need = (R - L) + 2 * margin
    zcap = float(np.clip(1.0 / need, 1.0, zmax))
    z0 = max(1.0, zcap / (1 + push))
    cx = (L + R) / 2
    return dict(x=round(cx, 3), y=0.47, zoom=[round(z0, 3), round(zcap, 3)], lock=True, track=False)


def snap(t):
    return float(beats[np.argmin(np.abs(beats - t))])


segs = []
_t_end = None


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
        if kw.pop("_couple", False):           # ceremony angle: centre between the couple
            kw = dict(kw, **couple(rng[0]))
        s = dict(clip=clip, dur=d, **kw)
        s["in"] = rng[0]
        if rng[1] > rng[0]:
            s["pick"] = list(rng)
        segs.append(s)
        t = end
    global _t_end
    _t_end = t
    return t


def sync_block(chunks):
    """Speech chunks with lip-synced picture.
    chunk = (film_at, src_a, src_b, [(dur, kw), ...]); kw None = couple framing."""
    t = None
    global _t_end
    for at, a, b, cuts in chunks:
        if segs and _t_end is not None and at > _t_end + 1e-6:
            segs[-1]["dur"] = round(segs[-1]["dur"] + (at - _t_end), 3)   # hold into the next line
        t = at
        src = a
        for d, kw in cuts:
            if kw and "clip" in kw:              # cutaway: speech continues over b-roll
                kw = dict(kw)
                c, rng = kw.pop("clip"), kw.pop("pick")
                segs.append(dict(clip=c, **{"in": rng[0]}, pick=rng, dur=round(d, 3), **kw))
            else:
                segs.append(dict(clip="0543", **{"in": round(src, 3)}, dur=round(d, 3),
                                 **couple(src + d / 2)))
            t += d
            src += d
        _t_end = t
    return t


D = dict(tempo="dream")                    # 80 % like the short
W = dict(zoom=0.04)                        # slow push
NC = dict(couple=False, track=False)
C = dict(_couple=True)                     # ceremony angle, couple-centred
B = lambda c, a, b, **k: dict(clip=c, pick=[a, b], couple=False, track=False, **k)

# ceremony-camera cutaways for the speeches (steady windows, checked with the
# jerk index): guests watching, the groomsmen, the bridesmaids, the crowd
CROWD = lambda a=560.5, b=570: B("0543", a, b, x=0.5, y=0.5, zoom=[1.0, 1.04])
GROOMSMEN = lambda: B("0543", 816.5, 829.5, x=0.75, y=0.5, zoom=[1.68, 1.72])
BRIDESMAIDS = lambda: B("0543", 1266, 1278, x=0.26, y=0.5, zoom=[1.88, 1.92])

# ── INTRO (song 0–15.4): details on the 2-beat grid, from black ─────────────
t = music_block(0.0, snap(15.4), [
    ("0506", [0, 4], 4, dict(**D, **NC, **W, fade_in=0.8)),
    ("0504", [0, 5], 2, dict(**NC)),
    ("0505", [0, 3], 2, dict(**D, **NC)),
    ("0510", [0, 3], 4, dict(**D, **NC, **W)),
    ("0508", [0, 5], 2, dict(**NC)),
    ("0511", [0, 7.5], 2, dict(**D, **NC)),   # steady sweetheart chairs (0509 was jittery)
    ("0507", [0, 3], 2, dict(**NC)),
    ("0535", [0, 13.5], 2, dict(**D, **NC)),  # smooth walk to the arch (0513 was jittery)
    ("0514", [0, 3], 2, dict(**NC)),
    ("0512", [0, 5], 2, dict(**D, **NC)),     # steady table sweep (0515 was jittery)
    ("0516", [0, 2.5], 2, dict(**NC)),
    ("0518", [0, 4.5], 4, dict(**D, **NC, **W)),
    ("0519", [0, 6], 2, dict(**NC)),
    ("0525", [0, 8.5], 4, dict(**D, **NC)),   # reception tables (0521 was jittery)
])
# ── VERSE 1 (song 15.4–28.3): details, then guests arrive ───────────────────
t = music_block(t, snap(28.3), [
    ("0520", [0, 5.5], 2, dict(**NC)),
    ("0522", [0, 10], 2, dict(**D, **NC)),
    ("0523", [0, 6], 2, dict(**NC)),
    ("0524", [0, 4.2], 2, dict(**D, **NC)),
    ("0527", [0, 4.5], 2, dict(**NC)),        # steady reception tables (0533 was jittery)
    ("0526", [0, 10.5], 2, dict(**D, **NC)),  # the arch reveal (0534 was jittery)
    ("0517", [0, 2.5], 2, dict(**NC)),
    ("0531", [9, 14.5], 2, dict(**NC)),       # tables & arch (0528 was inside the house)
    ("0530", [0, 7.5], 2, dict(couple=False)),
    ("0532", [0, 3.5], 2, dict(**NC)),
    ("0536", [0, 30], 2, dict(couple=False)),
    ("0539", [0, 10], 2, dict(couple=False)),
    ("0540", [0, 9], 2, dict(**D, couple=False)),
    ("0541", [0, 4.5], 2, dict(couple=False)),
    ("0538", [0, 18], 2, dict(couple=False)),  # (0530 end was bumpy)
])
# ── BUILD (song 28.3–42.8): the processional · "Today we witness…" ──────────
P = dict(couple=False)
t = music_block(t, snap(42.8), [
    ("0543", [186, 200], 2, dict(**P)),
    ("0543", [228, 240], 2, dict(**P)),
    ("0543", [252, 262], 2, dict(**P)),
    ("0543", [278, 290], 2, dict(**P)),
    ("0543", [306, 318], 2, dict(**P)),
    ("0543", [338, 350], 2, dict(**D, **P)),
    ("0543", [386, 402], 2, dict(**P)),
    ("0543", [507, 517], 4, dict(**D, couple=True)),
    ("0543", [518, 526], 2, dict(couple=True)),
    ("0543", [526, 536], 4, dict(**D, couple=True)),
])
# ── CHORUS 1 (song 42.8–58): the couple at the arch ─────────────────────────
t = music_block(t, 57.4, [
    ("0543", [548, 556], 4, dict(**C)),
    ("0543", [120, 180], 2, dict(couple=False)),
    ("0543", [575, 600], 4, dict(**C)),
    ("0510", [0, 3], 2, dict(**D, **NC)),
    ("0543", [610, 630], 4, dict(**C)),
    ("0543", [644, 647.6], 6, dict(**C)),      # steady, before the operator's zoom-out at 648
    ("0543", [667, 685], 4, dict(**C)),        # settled wide of the whole arch
])
t = sync_block([(57.4, 796.42, 803.0, [(3.4, None), (3.2, CROWD())])])   # camera pans at 800 → guests               # a marriage is a continual choice
t = music_block(t, 72.0, [
    ("0543", [700, 720], 4, dict(**C)),
    ("0519", [0, 6], 2, dict(**D, **NC)),
    ("0543", [760, 780], 4, dict(**C)),
    ("0543", [830, 845], 4, dict(**C)),
])
# ── VOWS (verse 2 → chorus 2), lip-synced, always both of them in frame ─────
t = sync_block([
    (72.0, 916.0, 925.2, [(9.2, None)]),                                         # laugh · angel
    (81.8, 943.9, 950.7, [(2.9, GROOMSMEN()), (3.9, None)]),                    # first person (camera reframes 944–946.5)
    (89.2, 1030.25, 1038.55, [(8.3, None)]),                                     # I love you Courtney…
    (98.1, 1065.4, 1070.1, [(4.7, None)]),                                       # when we first met
    (103.1, 1091.35, 1097.0, [(5.65, None)]),                                    # through all of this
    (109.4, 1187.6, 1194.6, [(7.0, None)]),                                      # cry happy tears · I love you
])
# the chorus plays out: rings passed, the glass unity pour
t = music_block(t, snap(123.3), [
    ("0543", [1295, 1330], 4, dict(**C)),
    ("0524", [0, 4.2], 2, dict(**D, **NC)),
    ("0543", [1340, 1365], 4, dict(**C)),
    ("0543", [1250, 1265], 4, dict(**C)),
])
# ── BRIDGE: "take a deep breath… imprint on your heart" ──────────────────────
b0 = t
t = sync_block([(b0, 1597.6, 1610.8, [(4.4, None), (3.6, BRIDESMAIDS()), (5.2, None)])])   # "look around"
# ── FINAL CHORUS: I do · I do · declare · kiss · presented ────────────────────
t = sync_block([(t + 0.5, 1430.9, 1437.4, [(6.5, None)]),
                (t + 7.6, 1465.9, 1471.4, [(5.5, None)])])
t = sync_block([(t + 0.6, 1640.9, 1652.0, [(4.5, None), (6.6, couple(1650, push=0.06))])])
t_present = t + 0.6
t = sync_block([(t_present, 1671.2, 1680.0, [(6.6, None)])])
# ── RECESSIONAL: down the aisle through the clapping, the dip kiss ───────────
# (camera follows them from the arch; steady stretches from the jerk index)
WALK = dict(couple=False, track=False, y=0.5)
t = music_block(t, t + 15.0, [
    ("0543", [1680.6, 1686.6], 8, dict(**WALK, x=0.5, zoom=[1.0, 1.05])),     # walking out, everyone clapping
    ("0543", [1688.8, 1693.6], 8, dict(**WALK, x=0.49, zoom=[1.08, 1.13])),   # hand in hand down the aisle
    ("0543", [1693.3, 1695.5], 4, dict(**WALK, x=0.48, zoom=[1.1, 1.13])),    # bouquet up
    ("0543", [1695.45, 1698.4], 8, dict(**D, **WALK, x=0.48, zoom=[1.12, 1.16])),  # the dip kiss
    ("0543", [1699.0, 1712.0], 6, dict(**D, **WALK, x=0.55, zoom=[1.0, 1.04])),    # walking on toward us
])
# ── THE LICENSE: little moments, no talking — signing, laughing, holding it up
t = music_block(t, t + 7.9, [
    ("0544", [141, 147], 4, dict(couple=False, track=False)),                 # the signature
    ("0544", [251, 257], 4, dict(couple=True)),                               # "you're married!"
    ("0544", [217, 227], 4, dict(couple=True)),                               # laughing together
    ("0544", [304.5, 312], 6, dict(couple=True)),                             # holding it up
])
# final image: the kiss behind the signed license, under the title
segs.append(dict(clip="0544", **{"in": 316.8}, pick=[316.6, 323.2], dur=6.0, couple=True, zoom=[1.0, 1.05],
                 in_tr="dissolve:0.6"))
total = round(t - 0.6 + 6.0, 2)

edl = dict(media_dir="../../footage/cm_proxy", audio_dir="../../footage/cm_audio",
           analysis_dir="../../footage/cm_analysis", audio_mix="trailer_mix.wav",
           output="../../output/Cortney & Max - Wedding Trailer.mp4",
           film=dict(width=1920, height=1080, fps="30000/1001", crf=16, dream_speed=0.8, grain=2,
                     denoise=2.0, vignette=0.25, halation=0.08, chroma=0.85,
                     pre_lut="../../footage/cm_lut.cube"),
           grade=dict(log_footage=False, saturation=0.6, warmth=0.3, contrast=1.08, match_luma=0.42,
                      match_wb=0.5),
           segments=segs,
           titles=[dict(text="Cortney & Max", start=total - 5.4, end=total - 0.5, y=0.16, size=0.055, fade=1.2),
                   dict(text="09 · 05 · 2026", start=total - 5.0, end=total - 0.5, y=0.23, size=0.024, fade=1.2)])
json.dump(edl, open(os.path.join(HERE, "edit.json"), "w"), indent=1)

# ── soundtrack: speech placements follow the sync chunks above ──────────────
def at(chunk_at, chunk_src, line_src):
    return round(chunk_at + (line_src - chunk_src), 3)


speech = [
    (37.6, 563.98, 568.88),                       # Today we witness… (over the processional)
    (at(57.4, 796.42, 797.02), 797.02, 802.90),   # A marriage is a continual choice…
    (at(72.0, 916.0, 916.49), 916.49, 924.81),    # make me laugh… angel… but kinda
    (at(81.8, 943.9, 944.27), 944.27, 950.37),    # first person I see…
    (at(89.2, 1030.25, 1030.55), 1030.55, 1038.37),  # I love you Courtney Shannon Murphy…
    (at(98.1, 1065.4, 1065.68), 1065.68, 1069.84),   # When we first met…
    (at(103.1, 1091.35, 1091.64), 1091.64, 1096.78), # …a man that I fell in love with
    (at(109.4, 1187.6, 1187.90), 1187.90, 1194.38),  # I vow to cry happy tears… I love you
    (at(b0, 1597.6, 1597.92), 1597.92, 1610.40),     # take a deep breath… imprint on your heart
]
# the final-chorus chunks were placed relative to t; recompute from segments
def chunk_start(src_a):
    tt = 0.0
    for s in segs:
        if s["clip"] == "0543" and abs(s["in"] - src_a) < 1e-3:
            return tt
        tt += s["dur"] - (float(s["in_tr"].split(":")[1]) if s.get("in_tr", "").startswith("dissolve") else 0)
    raise KeyError(src_a)


for a_src, line_a, line_b in ((1430.9, 1431.10, 1437.16), (1465.9, 1466.09, 1471.13),
                              (1640.9, 1641.14, 1645.40), (1671.2, 1671.34, 1679.30)):
    speech.append((at(chunk_start(a_src), a_src, line_a), line_a, line_b))
# per-line repairs from review (ceremony time): high band ducked where a
# breath / sniff / rustle burst sits on the words; trimmed line tails
LINE_FIX = {
    1065.68: dict(pad=[0.35, 0.28], ducks=[[1067.75, 1068.25, -12], [1069.15, 1069.45, -12]]),  # 1:40–1:42
    1187.9: dict(ducks=[[1192.56, 1192.96, -16]]),                                               # sniff 1:54
}
kiss_t = chunk_start(1640.9)
audio = dict(sr=48000, total=total, song="../../footage/cm_song/song.wav",
             song_instrumental="../../footage/cm_song/no_vocals.wav", song_start=SONG_START,
             music_db=-13, music_under_speech_db=-25, music_fade_out=3.0,
             lav="../../footage/cm_rec/001_260314.wav", lav_safety="../../footage/cm_rec/001_260314_D.wav",
             lav_words="../../footage/cm_lav.json", lav_offset=1875.94, speech_db=-17,
             speech=[dict(at=a, src=[x, y], **LINE_FIX.get(round(x, 2), {})) for a, x, y in speech],
             cheers=[dict(at=round(kiss_t + (1646.9 - 1640.9), 3), file="../../footage/cm_audio/0543.wav",
                          src=[1646.9, 1650.3], db=-17, fade=0.5),
                     dict(at=round(chunk_start(1671.2) + (1679.3 - 1671.2), 3),     # clapping through the walk
                          file="../../footage/cm_audio/0543.wav", src=[1679.3, 1699.5], db=-18, fade=1.2)])
json.dump(audio, open(os.path.join(HERE, "audio.json"), "w"), indent=1)
print(f"{len(segs)} segments, total {total}s")
for a, x, y in speech:
    print(f"  speech at {a:7.2f}s  src {x}-{y}")
