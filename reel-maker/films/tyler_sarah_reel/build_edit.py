#!/usr/bin/env python3
"""
Tyler & Sarah — 60 s Instagram reel (1080×1920), cut to the song from their
own 3-minute edit (make_music.py: real intro → one beat-matched splice → the
big final section and the song's own ending).

  0–13.3 s   the garden waking up (soft intro): fountain, roses, petals,
             Tyler putting on his jacket, waiting under the trees
  13.3 s     the splice into the big section — Sarah walks in
  …          the proposal: Tyler kneeling with the ring, the embrace
  …          the close moments: the kiss, her hand on his face, tears, the
             forehead, the hand kiss, laughing, the ring
  last 5 s   family and friends together under "Tyler & Sarah"

Couple shots are framed by auto_frame (centred between them, both heads in);
every in-point is picked inside its range for sharpness and steadiness (jerk
index). Grade: Sony S-Log3/S-Gamut3.Cine → LC-709 Type A, then a gamma lift
for the dusk shots and white balance from neutral pixels (no magenta cast
from the foliage).

    python build_edit.py   # writes edit.json next to this file
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
beats = json.load(open(os.path.join(HERE, "beats.json")))["beats"]
SPLICE, TOTAL = 13.31, 60.0

D = dict(tempo="dream")
DET = dict(couple=False, track=False)          # details / scenery
CPL = dict(couple=True)                        # auto-framed between the two of them


def block(t0, t1, shots):
    """Cut shots on the beat grid from t0; the last one runs to t1."""
    out, t = [], t0
    bi = next(i for i, b in enumerate(beats) if b > t0 + 0.05)
    for k, (clip, rng, nb, kw) in enumerate(shots):
        end = t1 if k == len(shots) - 1 else beats[min(bi + nb - 1, len(beats) - 1)]
        if nb == 0:                                  # up to the first beat
            end = beats[bi]
            bi += 1
        else:
            bi += nb
        s = dict(clip=clip, dur=round(end - t, 3), pick=list(rng), **{"in": rng[0]}, **kw)
        out.append(s)
        t = end
    return out


segs = []
# ── the garden waking up ────────────────────────────────────────────────────
segs += block(0.0, SPLICE, [
    ("0437", [2, 15], 0, dict(**D, **DET, x=0.55, zoom=[1.0, 1.05], fade_in=1.0)),   # the fountain
    ("0444", [0, 4], 4, dict(**D, **DET, x=0.58, zoom=[1.04, 1.0])),                  # the roses
    ("0454", [1, 9], 4, dict(**D, **DET, x=0.45, zoom=[1.0, 1.05])),                  # petals on the path
    ("0456", [0, 6], 4, dict(**DET, x=0.47, zoom=[1.0, 1.04])),                       # Tyler, the jacket
    ("0458", [2, 9], 4, dict(**D, **DET, x=0.5, zoom=[1.0, 1.05])),                   # light through the oaks
])
# ── she walks in · the proposal ─────────────────────────────────────────────
segs += block(SPLICE, TOTAL, [
    ("0500", [0, 2.2], 4, dict(**D, **DET, x=0.37, zoom=[1.0, 1.04])),    # Sarah with the bouquet
    ("0502", [0, 7], 4, dict(**DET, x=0.40, zoom=[1.0, 1.04])),         # Tyler on one knee, smiling
    ("0501", [1, 5.5], 4, dict(**DET, x=0.5, zoom=[1.0, 1.03])),          # the ring box
    ("0503", [36, 47], 4, dict(**D, **CPL)),                              # the embrace
    ("0485", [2, 7], 4, dict(**CPL)),                                     # the kiss
    ("0480", [0, 4.5], 4, dict(**D, **CPL)),                              # her hand on his face
    ("0481", [16, 26], 4, dict(**CPL)),                                   # forehead to forehead
    ("0483", [1, 10], 4, dict(**CPL)),                                    # he kisses her hand
    ("0482", [0, 2.4], 4, dict(**D, **CPL)),                              # her hand on his face, close
    ("0489", [0, 2.8], 4, dict(**CPL)),                                   # showing the ring
    ("0490", [0.5, 4], 4, dict(**D, **CPL)),                              # the ring, close
    ("0486", [1, 6.5], 8, dict(**CPL)),                                   # the two of them together
    ("0477", [18, 30], 4, dict(**DET, x=0.5, zoom=[1.0, 1.03])),          # family hugs
    ("0488", [4, 11], 4, dict(**DET, x=0.48, zoom=[1.0, 1.03])),          # with their people
    ("0491", [12, 44], 8, dict(**DET, x=0.47, zoom=[1.0, 1.05])),         # everyone together
])
# soft mixes inside the gentle intro; the big section cuts crisply on the beat
for s in segs[1:5]:
    s["in_tr"] = "mix:0.35"

total = round(sum(s["dur"] for s in segs), 3)
edl = dict(
    media_dir="../../footage/ts_raw", audio_dir="../../footage/ts_raw",
    analysis_dir="../../footage/tyler_sarah_analysis", audio_mix="music.wav",
    output="../../output/Tyler & Sarah - Reel.mp4",
    film=dict(width=1080, height=1920, fps="30000/1001", crf=16, dream_speed=0.8, grain=3, denoise=2.5,
              vignette=0.3, halation=0.08, chroma=1.0, pre_lut="../../footage/ts_lut.cube",
              lift=dict(target=0.36, strength=0.8, max_gamma=2.2), wb="neutral"),
    grade=dict(log_footage=False, saturation=1.0, warmth=0.6, contrast=1.2, match_luma=0.40, match_wb=0.6),
    segments=segs,
    titles=[dict(text="Tyler & Sarah", start=total - 5.2, end=total - 0.4, y=0.16, size=0.034, fade=1.2)],
)
json.dump(edl, open(os.path.join(HERE, "edit.json"), "w"), indent=1)
print(f"{len(segs)} shots, {total:.2f}s")
for s in segs:
    print(f"  {s['clip']} {s['dur']:5.2f}s  {s.get('tempo', 'real')}")
