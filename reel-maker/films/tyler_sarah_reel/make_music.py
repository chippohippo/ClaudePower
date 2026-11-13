#!/usr/bin/env python3
"""The reel's music: "Heartwarming" by Kevin MacLeod (incompetech.com),
licensed Creative Commons BY 4.0 — soft piano and strings, no percussion.
Credit line for the post:  Music: "Heartwarming" Kevin MacLeod (incompetech.com),
Licensed under Creative Commons: By Attribution 4.0.

The piece's last chord lands at 60.2 s and rings out; played 5 % faster it
lands at 57.3 s, so the reel ends on the music's own ending (soft fade over
the last 2.5 s of the ring-out). Writes music.wav and beats.json (the beat
grid the cuts sit on).

    python make_music.py
"""
import json
import os
import subprocess

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "../../music/heartwarming_kevin_macleod.mp3")
TEMPO, TOTAL = 1.05, 60.0


def main():
    out = os.path.join(HERE, "music.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", SRC, "-af",
                    f"atempo={TEMPO},loudnorm=I=-13:TP=-1.5:LRA=11,afade=in:st=0:d=0.4,"
                    f"afade=out:st={TOTAL - 2.5}:d=2.5:curve=qsin", "-t", f"{TOTAL}",
                    "-ar", "48000", "-ac", "2", "-c:a", "pcm_f32le", out], check=True)
    # beat grid of the original recording (80.75 BPM, first beat 0.35 s), at the new tempo
    per = 60 / 80.75 / TEMPO
    b = list(np.arange(0.35 / TEMPO, TOTAL, per))
    json.dump(dict(bpm=round(60 / per, 2), beats=[round(t, 3) for t in b]),
              open(os.path.join(HERE, "beats.json"), "w"))
    print(f"✓ music.wav {TOTAL:.0f}s, {60 / per:.1f} BPM, {len(b)} beats, first {b[0]:.2f}")


if __name__ == "__main__":
    main()
