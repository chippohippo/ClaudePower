"""Objective audio analysis: loudness, transient, band energy, decay, and a spectrogram sheet.
   python3 tools/audio/analyze.py <dir> [prefix-filter]"""
import sys, os, glob, wave
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

d = sys.argv[1]
flt = sys.argv[2] if len(sys.argv) > 2 else ''
files = sorted(f for f in glob.glob(os.path.join(d, '*.wav')) if os.path.basename(f).startswith(flt))

def load(f):
    w = wave.open(f)
    sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return x, sr

BANDS = [(20, 100, 'sub'), (100, 300, 'low'), (300, 2000, 'mid'), (2000, 8000, 'high'), (8000, 20000, 'air')]
rows = []
for f in files:
    x, sr = load(f)
    if len(x) < 64: continue
    peak = np.max(np.abs(x)) + 1e-9
    rms = np.sqrt(np.mean(x ** 2)) + 1e-9
    env = np.abs(x)
    k = max(1, int(sr * 0.002))
    env_s = np.convolve(env, np.ones(k) / k, mode='same')
    ipk = int(np.argmax(env_s))
    attack_ms = ipk / sr * 1000
    # decay: time for envelope to fall 30 dB after peak
    thr = env_s[ipk] * 10 ** (-30 / 20)
    after = np.where(env_s[ipk:] < thr)[0]
    decay_ms = (after[0] / sr * 1000) if len(after) else len(x) / sr * 1000
    # loudness of the first 100 ms (the "punch" window)
    punch = 20 * np.log10(np.sqrt(np.mean(x[: int(sr * 0.1)] ** 2)) + 1e-9)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    fr = np.fft.rfftfreq(len(x), 1 / sr)
    tot = spec.sum() + 1e-12
    bands = {n: 10 * np.log10(spec[(fr >= a) & (fr < b)].sum() / tot + 1e-12) for a, b, n in BANDS}
    centroid = (fr * spec).sum() / tot
    rows.append((os.path.basename(f)[:-4], len(x) / sr, 20 * np.log10(peak), 20 * np.log10(peak / rms), punch, attack_ms, decay_ms, centroid, bands))

print(f"{'sound':22s} {'dur':>5s} {'pk':>5s} {'crest':>5s} {'punch':>6s} {'att':>5s} {'dec30':>6s} {'cent':>6s}  " + ' '.join(f"{n:>5s}" for _, _, n in BANDS))
for r in rows:
    n, dur, pk, crest, punch, att, dec, cen, b = r
    print(f"{n:22s} {dur:5.2f} {pk:5.1f} {crest:5.1f} {punch:6.1f} {att:5.1f} {dec:6.0f} {cen:6.0f}  " + ' '.join(f"{b[k]:5.1f}" for _, _, k in BANDS))

# spectrogram contact sheet
sel = [f for f in files][:48]
if sel:
    cols = 4
    rws = (len(sel) + cols - 1) // cols
    fig, axs = plt.subplots(rws, cols, figsize=(cols * 4, rws * 2.2))
    axs = np.array(axs).reshape(-1)
    for ax, f in zip(axs, sel):
        x, sr = load(f)
        x = x[: int(sr * (float(os.environ.get('WIN', '1.2'))))]
        ax.specgram(x + 1e-7, NFFT=512, Fs=sr, noverlap=384, cmap='magma', vmin=-120)
        ax.set_ylim(0, 12000)
        t = np.arange(len(x)) / sr
        k = max(1, int(sr * 0.002)); e = np.convolve(np.abs(x), np.ones(k) / k, mode='same'); edb = np.clip(20 * np.log10(e / (e.max() + 1e-9) + 1e-9), -60, 0)
        ax2 = ax.twinx(); ax2.plot(t, edb, color='cyan', lw=0.7); ax2.set_ylim(-60, 2); ax2.set_yticks([])
        ax.set_title(os.path.basename(f)[:-4], fontsize=9); ax.tick_params(labelsize=6)
    for ax in axs[len(sel):]: ax.axis('off')
    plt.tight_layout()
    out = os.path.join(d, f'_sheet_{flt or "all"}.png')
    plt.savefig(out, dpi=70)
    print('sheet', out)
