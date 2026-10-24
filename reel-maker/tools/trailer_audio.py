#!/usr/bin/env python3
"""
trailer_audio.py — build a wedding-trailer soundtrack: the real song + clean
ceremony speech (from a separate lav/recorder) + crowd cheers. Nothing else.

Config (JSON):
{
  "sr": 48000, "total": 207.0,
  "song": "song.wav", "song_instrumental": "no_vocals.wav", "song_start": 6.0,
  "music_db": -12, "music_under_speech_db": -24,
  "lav": "001_260314.wav", "lav_safety": "001_260314_D.wav", "lav_words": "lav.json",
  "lav_offset": 1875.94,            # lav time = ceremony time + offset
  "speech_db": -18,                 # loudness target on words (RMS dBFS)
  "speech": [ {"at": 0.5, "src": [563.98, 568.88]}, ... ],   # ceremony times
  "cheers": [ {"at": 160.2, "file": "cam.wav", "src": [1646, 1652], "db": -16} ]
}
    python trailer_audio.py config.json out.wav
"""
import json
import os
import subprocess
import sys

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clean_speech import clamp_spikes, sniff_gain, word_gate  # noqa: E402
import clean_speech  # noqa: E402


def read(path, sr, a=None, d=None, ch=1):
    cmd = ["ffmpeg", "-v", "error"]
    if a is not None:
        cmd += ["-ss", f"{max(a, 0):.4f}"]
    if d is not None:
        cmd += ["-t", f"{d:.4f}"]
    cmd += ["-i", path, "-ac", str(ch), "-ar", str(sr), "-f", "f32le", "-"]
    x = np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, np.float32).copy()
    return x.reshape(-1, ch) if ch > 1 else x


def ffilter(x, sr, af):
    p = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-",
                        "-af", af, "-f", "f32le", "-"], input=x.astype(np.float32).tobytes(),
                       capture_output=True)
    y = np.frombuffer(p.stdout, np.float32).copy()
    return np.pad(y, (0, max(0, len(x) - len(y))))[: len(x)]


def repair_clipping(x, safety, thr=0.97):
    """Replace clipped runs with the (scaled) safety track."""
    clip = np.abs(x) >= thr
    if not clip.any() or safety is None:
        return x, 0
    ok = (~clip) & (np.abs(x) > 0.05) & (np.abs(safety) > 0.01)
    g = float(np.dot(x[ok], safety[ok]) / (np.dot(safety[ok], safety[ok]) + 1e-9)) if ok.sum() > 100 else 2.5
    grow = np.convolve(clip.astype(float), np.ones(48), "same") > 0
    y = x.copy()
    y[grow] = safety[grow] * g
    return y, int(clip.sum())


def clean_line(cfg, a, b, words, pad=(0.35, 0.45)):
    sr = cfg["sr"]
    off = cfg["lav_offset"]
    t0, t1 = a - pad[0], b + pad[1]
    x = read(cfg["lav"], sr, t0 + off, t1 - t0)
    sx = read(cfg["lav_safety"], sr, t0 + off, t1 - t0) if cfg.get("lav_safety") else None
    if sx is not None:
        sx = np.pad(sx, (0, max(0, len(x) - len(sx))))[: len(x)]
    x, nclip = repair_clipping(x, sx)
    x = ffilter(x, sr, "highpass=f=85:poles=2,lowpass=f=13000,adeclick=w=40:o=75:a=2,"
                       "afftdn=nf=-40:nr=16:tn=1,deesser=i=0.35:m=0.5")
    # breaths / sniffs / coughs: unvoiced breath-band bursts. Inside words only
    # long bursts (>= 0.25 s: coughs, sneezes) count; short ones there are
    # consonants (s, sh, f) and must stay.
    clean_speech.SR = sr
    lw = [(w0 - off - t0, w1 - off - t0, w) for w0, w1, w, *_ in words if a - 0.2 <= w0 - off <= b + 0.2]
    g, _ = sniff_gain(x, 26)
    g = g[: len(x)]
    inword = np.zeros(len(x), bool)
    for w0, w1, _ in lw:
        inword[max(int((w0 - 0.03) * sr), 0): int((w1 + 0.03) * sr)] = True
    low = g < 0.5
    edges = np.flatnonzero(np.diff(np.r_[0, low.astype(int), 0]))
    hits = []
    for r0, r1 in zip(edges[::2], edges[1::2]):
        long_run = (r1 - r0) >= 0.25 * sr
        if inword[r0:r1].mean() > 0.5 and not long_run:
            g[r0:r1] = 1.0                      # consonant: leave it
        else:
            hits.append(round(r0 / sr + t0, 2))
    g = np.convolve(g, np.hanning(481) / np.hanning(481).sum(), "same")
    x = x * g
    # mic bumps & handling: low-band spikes clamped to the running level
    x = clamp_spikes(x[:, None], [(20, 180), (2500, 9000)], [3, 6])[:, 0]
    # word gate (lav words in lav time → line-local time)
    # merge words separated by short pauses (< 0.35 s): the gate only closes in
    # real gaps between phrases, never inside a phrase or on a word onset
    spans = []
    for w0, w1, w in sorted(lw):
        if spans and w0 - spans[-1][1] < 0.35:
            spans[-1][1] = max(spans[-1][1], w1)
        else:
            spans.append([w0, w1])
    gate = word_gate(len(x), [(p, q, "") for p, q in spans], -32, pre=0.14, post=0.18)
    x = x * gate
    # loudness on words
    on = gate > 0.9
    rms = np.sqrt((x[on] ** 2).mean()) + 1e-9 if on.any() else 1e-3
    x *= 10 ** (cfg.get("speech_db", -18) / 20) / rms
    # soft fades at the ends
    f = int(0.06 * sr)
    x[:f] *= np.linspace(0, 1, f)
    x[-f:] *= np.linspace(1, 0, f)
    return x, pad[0], hits, nclip


def main():
    cfg = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    base = os.path.dirname(os.path.abspath(sys.argv[1]))
    for k in ("song", "song_instrumental", "lav", "lav_safety", "lav_words"):
        if cfg.get(k) and not os.path.isabs(cfg[k]):
            cfg[k] = os.path.join(base, cfg[k])
    sr, T = cfg["sr"], cfg["total"]
    n = int(T * sr)
    words = [w for s in json.load(open(cfg["lav_words"])) for w in s["words"]]

    # ── speech ──────────────────────────────────────────────────────────────
    speech = np.zeros(n, np.float32)
    duck = np.zeros(n, np.float32)            # 1 where speech is active
    for s in cfg["speech"]:
        a, b = s["src"]
        x, lead, hits, nclip = clean_line(cfg, a, b, words, tuple(s.get("pad", (0.35, 0.45))))
        x *= 10 ** (s.get("gain_db", 0) / 20)
        i0 = int((s["at"] - lead) * sr)
        m = min(len(x), n - i0)
        speech[i0:i0 + m] += x[:m]
        duck[max(0, int((s["at"] - 0.25) * sr)): int((s["at"] + (b - a) + 0.35) * sr)] = 1
        print(f"  speech @{s['at']:7.2f}s  src {a:.2f}-{b:.2f}  breaths/sniffs cut {len(hits)}  "
              f"clipped samples repaired {nclip}")

    # ── music: full song, blending to the instrumental (and ducking) under speech
    music = np.zeros((n, 2), np.float32)
    if cfg.get("song"):
        full = read(cfg["song"], sr, ch=2)
        inst = read(cfg["song_instrumental"], sr, ch=2) if cfg.get("song_instrumental") else full
        L = min(len(full), len(inst))
        i0 = int(cfg["song_start"] * sr)
        m = min(L, n - i0)
        k = int(0.45 * sr)
        ker = np.hanning(2 * k + 1)
        dz = np.clip(fftconvolve(duck, ker / ker.sum(), "same"), 0, 1)[i0:i0 + m, None]
        g_full = 10 ** (cfg["music_db"] / 20)
        g_under = 10 ** (cfg["music_under_speech_db"] / 20)
        music[i0:i0 + m] = full[:m] * (1 - dz) * g_full + inst[:m] * dz * g_under
        if cfg.get("music_fade_out"):
            fo = int(cfg["music_fade_out"] * sr)
            music[n - fo:] *= np.linspace(1, 0, fo)[:, None]

    # ── cheers ──────────────────────────────────────────────────────────────
    cheer = np.zeros((n, 2), np.float32)
    for c in cfg.get("cheers", []):
        p = c["file"] if os.path.isabs(c["file"]) else os.path.join(base, c["file"])
        a, b = c["src"]
        x = read(p, sr, a, b - a, ch=2)
        x = np.stack([ffilter(x[:, i], sr, "highpass=f=120,adeclick") for i in range(2)], 1)
        f = int(c.get("fade", 0.6) * sr)
        env = np.ones(len(x), np.float32)
        env[:f] = np.linspace(0, 1, f)
        env[-f:] = np.linspace(1, 0, f)
        x = x * env[:, None]
        x *= 10 ** (c.get("db", -18) / 20) / (np.sqrt((x ** 2).mean()) + 1e-9)
        i0 = int(c["at"] * sr)
        m = min(len(x), n - i0)
        cheer[i0:i0 + m] += x[:m]

    mix = music + cheer + speech[:, None]
    tmp = out + ".pre.wav"
    from scipy.io import wavfile
    wavfile.write(tmp, sr, np.clip(mix, -1, 1).astype(np.float32))
    # two-pass loudness normalisation to -14 LUFS, -1 dBTP
    meas = subprocess.run(["ffmpeg", "-hide_banner", "-i", tmp, "-af",
                           "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"],
                          capture_output=True, text=True).stderr
    j = json.loads(meas[meas.rindex("{"): meas.rindex("}") + 1])
    af = (f"loudnorm=I=-14:TP=-1:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:"
          f"measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-af", af, "-ar", str(sr), "-c:a", "pcm_s24le", out],
                   check=True)
    os.remove(tmp)
    print("✓", out, f"(input {j['input_i']} LUFS → -14 LUFS)")


if __name__ == "__main__":
    main()
