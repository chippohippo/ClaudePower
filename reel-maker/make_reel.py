#!/usr/bin/env python3
"""
make_reel.py — cinematic 9:16 Instagram Reel generator.

Takes a list of video clips and/or still images, optional music and optional
timed text, and renders a polished 1080x1920 / 30 fps / H.264 reel of an exact
duration (default 60 s).

Pipeline (all per-frame work is numpy, MoviePy handles decode/encode/audio):

    shots ──► timeline (beat-snapped cut points, cross-dissolves)
          ──► per-shot reframe to 9:16 + slow push-in / pan (Ken Burns)
          ──► colour grade (log -> rec709-ish S-curve, warmth, saturation)
          ──► vignette + film grain
          ──► animated text overlays (fade + scale + slide, soft shadow)
          ──► final fade to an end card
    music ──► trim, loudness-normalise, fade in/out ──► mux

Usage: see README.md, or run `python make_reel.py --help`.
A project is described in a small JSON file (see projects/tyler_sarah.json).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from moviepy import AudioFileClip, VideoClip, VideoFileClip
from moviepy.audio.fx import AudioFadeIn, AudioFadeOut

HERE = os.path.dirname(os.path.abspath(__file__))

# ════════════════════════════════════════════════════════════════════════════
#  CONFIG — tweak freely; every value can also be overridden from the project
#  JSON under a "config" key.
# ════════════════════════════════════════════════════════════════════════════
CONFIG = {
    # Output
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "duration": 60.0,            # exact length in seconds
    "crf": 20,                   # x264 quality (lower = better/bigger)
    "maxrate": "11M",            # bitrate cap keeps 60 s under ~90 MB
    "preset": "medium",

    # Editing
    "crossfade": 0.8,            # dissolve length between shots (s)
    "hard_cut_every": 0,         # >0: every Nth transition is a hard cut (punchier)
    "bpm_fallback": 66,          # rhythmic grid used when no music/beat tracking
    "snap_to_beats": True,
    "push_in": 0.06,             # default Ken Burns zoom amount (0.07 = 7 %)
    "end_card_seconds": 3.0,     # final held title card
    "fade_out_seconds": 1.2,     # fade to black at very end

    # Look
    "log_footage": True,
    "match_luma": 0.40,          # every shot is exposure-matched to this median
    "match_wb": 0.6,             # 0..1 strength of white-balance matching         # True for S-Log/flat footage (Sony FX3 etc.)
    "contrast": 1.0,             # style intensity multipliers (0 = off, 1 = default)
    "saturation": 1.0,
    "warmth": 1.0,
    "exposure": 0.0,             # stops
    "vignette": 0.25,            # 0..1
    "grain": 0.025,              # 0..~0.1
    "grain_size": 2,             # px (1 = fine)

    # Text
    "font_title": "fonts/PlayfairDisplay-Italic-VF.ttf",
    "font_body": "fonts/Montserrat-VF.ttf",
    "text_color": (255, 250, 242),
    "safe_top": 250,             # Instagram UI safe zones (px)
    "safe_bottom": 420,
    "safe_side": 90,

    # Audio
    "music_volume_lufs": -16.0,  # approximate target loudness
    "music_fade_in": 1.0,
    "music_fade_out": 2.5,
    "clip_audio_volume": 0.0,    # >0 mixes in camera audio (ducked under music)
}


# ════════════════════════════════════════════════════════════════════════════
#  Data model
# ════════════════════════════════════════════════════════════════════════════
@dataclass
class Shot:
    path: str
    start: float = 0.0           # in-point inside the source clip (s)
    length: float = 2.5          # desired on-screen length (s); snapped to beats
    x: float = 0.5               # horizontal framing centre (0 = left, 1 = right)
    y: float = 0.5
    zoom: float | None = None    # Ken Burns amount; negative = pull out
    pan: float = 0.0             # horizontal drift over the shot (-0.1..0.1)
    speed: float = 1.0           # <1 slow motion (frame-sampled), >1 speed ramp
    cut: str = "dissolve"        # "dissolve" | "cut" | "flash" (into this shot)
    # filled by the timeline
    t0: float = 0.0
    t1: float = 0.0


@dataclass
class Text:
    text: str
    start: float
    end: float
    style: str = "title"         # "title" | "body" | "lower" | "kicker" | "end"
    size: int | None = None
    y: float | None = None       # 0..1 of frame height (default per style)
    anim: str = "rise"           # "rise" | "fade" | "scale"
    tracking: int = 0            # letter-spacing px (body/kicker look great at 6-12)


@dataclass
class Project:
    shots: list[Shot]
    texts: list[Text] = field(default_factory=list)
    music: str | None = None
    music_start: float = 0.0
    output: str = "reel.mp4"


# ════════════════════════════════════════════════════════════════════════════
#  Media access
# ════════════════════════════════════════════════════════════════════════════
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp", ".tif", ".tiff"}


def fetch_if_url(path: str, cache_dir: str) -> str:
    """Download http(s) media to a local cache so MoviePy can read it."""
    if not path.startswith(("http://", "https://")):
        return path
    import hashlib
    import urllib.request
    os.makedirs(cache_dir, exist_ok=True)
    ext = os.path.splitext(path.split("?")[0])[1] or ".bin"
    local = os.path.join(cache_dir, hashlib.sha1(path.encode()).hexdigest()[:16] + ext)
    if not os.path.exists(local):
        print(f"  downloading {path}")
        urllib.request.urlretrieve(path, local)
    return local


class Source:
    """Uniform frame access for stills and videos (float32 RGB, 0..1)."""

    def __init__(self, path: str):
        self.path = path
        self.is_image = os.path.splitext(path)[1].lower() in IMAGE_EXT
        if self.is_image:
            im = Image.open(path).convert("RGB")
            self.still = np.asarray(im, dtype=np.float32) / 255.0
            self.size = im.size
            self.duration = math.inf
            self.clip = None
        else:
            # readers are opened lazily and closed when idle (see Reel.source):
            # each one holds a decode process + frame buffer, so dozens of
            # open 4K clips would exhaust memory.
            self.clip = None
            self.open()
            self.size = self.clip.size
            self.duration = self.clip.duration

    def open(self):
        if self.clip is None and not self.is_image:
            self.clip = VideoFileClip(self.path, audio=CONFIG["clip_audio_volume"] > 0)

    def close(self):
        if self.clip is not None:
            self.clip.close()
            self.clip = None

    def frame(self, t: float) -> np.ndarray:
        if self.is_image:
            return self.still
        t = min(max(t, 0), self.duration - 1.0 / CONFIG["fps"] - 0.01)
        self.open()
        return self.clip.get_frame(t).astype(np.float32) / 255.0


# ════════════════════════════════════════════════════════════════════════════
#  Timeline
# ════════════════════════════════════════════════════════════════════════════
def beat_grid(music: str | None, music_start: float, total: float) -> np.ndarray:
    """Beat times (s, relative to reel start). Uses librosa if available."""
    if music:
        try:
            import librosa
            y, sr = librosa.load(music, sr=22050, offset=music_start, duration=total + 1)
            _, frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
            beats = librosa.frames_to_time(frames, sr=sr)
            if len(beats) > 8:
                print(f"  beat tracking: {len(beats)} beats, "
                      f"~{60 / np.median(np.diff(beats)):.0f} BPM")
                return beats
        except Exception as e:  # librosa missing or audio odd -> fall back
            print(f"  beat tracking unavailable ({e.__class__.__name__}); using BPM grid")
    step = 60.0 / CONFIG["bpm_fallback"]
    return np.arange(0, total + step, step)


def build_timeline(shots: list[Shot], beats: np.ndarray, total: float) -> None:
    """Assign t0/t1 for each shot so cuts land on beats and the reel is exact.

    Desired lengths are scaled to fill `total`, then each cut point is snapped
    to the nearest beat (never collapsing a shot below ~0.8 s).
    """
    want = np.array([s.length for s in shots], dtype=float)
    want *= total / want.sum()
    cuts = np.concatenate([[0], np.cumsum(want)])
    if CONFIG["snap_to_beats"] and len(beats):
        for i in range(1, len(cuts) - 1):
            nearest = beats[np.argmin(np.abs(beats - cuts[i]))]
            if nearest - cuts[i - 1] > 0.8 and abs(nearest - cuts[i]) < 0.6:
                cuts[i] = nearest
    cuts[-1] = total
    for s, a, b in zip(shots, cuts[:-1], cuts[1:]):
        s.t0, s.t1 = float(a), float(b)
    n_hard = CONFIG["hard_cut_every"]
    if n_hard:
        for i, s in enumerate(shots[1:], 1):
            if i % n_hard == 0 and s.cut == "dissolve":
                s.cut = "cut"


# ════════════════════════════════════════════════════════════════════════════
#  Image ops
# ════════════════════════════════════════════════════════════════════════════
def ease(x: float) -> float:
    """Smooth ease-in-out (cosine)."""
    x = min(max(x, 0.0), 1.0)
    return 0.5 - 0.5 * math.cos(math.pi * x)


def ease_out(x: float) -> float:
    x = min(max(x, 0.0), 1.0)
    return 1 - (1 - x) ** 3


def reframe(img: np.ndarray, shot: Shot, p: float) -> np.ndarray:
    """Crop a 9:16 window from the source (with zoom/pan at progress p)."""
    W, H = CONFIG["width"], CONFIG["height"]
    ih, iw = img.shape[:2]
    z = CONFIG["push_in"] if shot.zoom is None else shot.zoom
    scale = 1.0 + (z * ease(p) if z >= 0 else -z * (1 - ease(p)))
    # biggest 9:16 window that fits, then shrink it by the zoom factor
    base_w = min(iw, ih * W / H)
    cw, ch = base_w / scale, base_w / scale * H / W
    cx = (shot.x + shot.pan * (ease(p) - 0.5)) * iw
    cy = shot.y * ih
    x0 = min(max(cx - cw / 2, 0), iw - cw)
    y0 = min(max(cy - ch / 2, 0), ih - ch)
    pil = Image.fromarray((img * 255).astype(np.uint8))
    out = pil.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch))
    return np.asarray(out, dtype=np.float32) / 255.0


LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def develop(img: np.ndarray) -> np.ndarray:
    """Log -> display-referred base (before per-shot matching)."""
    x = img * (2.0 ** CONFIG["exposure"])
    if CONFIG["log_footage"]:
        # S-Log3-ish flat footage sits ~0.06-0.68: stretch and add gamma
        x = np.clip((x - 0.06) / 0.62, 0, 1.3) ** 1.2
    return x


def measure(img: np.ndarray) -> tuple[float, np.ndarray]:
    """Per-shot exposure gain + white-balance gains that pull every shot to a
    common target, so the reel reads as one unified palette."""
    x = develop(img[::8, ::8])
    luma = x @ LUMA
    gain = CONFIG["match_luma"] / max(float(np.median(luma)), 0.05)
    gain = float(np.clip(gain, 0.7, 1.6))
    # grey-world on mid-tones only (ignores foliage-saturated / clipped pixels)
    m = (luma > 0.15) & (luma < 0.8)
    mean = x[m].mean(axis=0) if m.sum() > 100 else x.reshape(-1, 3).mean(axis=0)
    wb = mean.mean() / np.maximum(mean, 1e-3)
    wb = 1 + (wb - 1) * CONFIG["match_wb"]       # partial: keep some character
    wb = wb / (wb @ LUMA)                        # don't change brightness
    return gain, wb.astype(np.float32)


def grade(img: np.ndarray, match=(1.0, np.ones(3, np.float32))) -> np.ndarray:
    """Bright, warm, vibrant-but-natural grade with highlight protection."""
    c, s, w = CONFIG["contrast"], CONFIG["saturation"], CONFIG["warmth"]
    gain, wb = match
    x = develop(img) * wb * gain
    # gentle S-curve for depth (mostly in the shadows / mids)
    sc = x * x * (3 - 2 * np.clip(x, 0, 1))
    x = x + (sc - x) * (0.35 * c)
    # soft highlight shoulder: everything above 0.72 rolls off smoothly -> no blowouts
    k = 0.72
    over = np.maximum(x - k, 0)
    x = np.minimum(x, k) + (1 - k) * (1 - np.exp(-over / (1 - k) * 1.15))
    # gently lifted blacks: airy, romantic
    x = 0.03 + x * 0.955
    luma = (x @ LUMA)[..., None]
    chroma = x - luma
    sat = np.abs(chroma).max(axis=2, keepdims=True)
    # vibrance: boost muted colours most, saturated ones least (skin stays natural)
    x = luma + chroma * (1.0 + 0.55 * s * np.clip(1 - sat * 2.2, 0.25, 1))
    # foliage: nudge greens toward a warm, soft olive-emerald so they don't dominate
    r, g, b = x[..., 0:1], x[..., 1:2], x[..., 2:3]
    green = np.clip((g - np.maximum(r, b)) * 4, 0, 1)
    x = x + green * np.concatenate([0.03 * g, -0.025 * g, -0.01 * g], axis=2) * w
    # warm golden tone everywhere, creamier in the highlights
    highs = np.clip(luma * 1.6 - 0.6, 0, 1)
    tone = (np.array([0.028, 0.016, -0.018], np.float32) * highs
            + np.array([0.016, 0.006, -0.012], np.float32))
    x = x + tone * w
    # final safety: compress any channel that still tries to clip
    x = np.where(x > 0.96, 0.96 + (x - 0.96) * 0.25, x)
    return np.clip(x, 0, 1)


@lru_cache(maxsize=1)
def vignette_mask() -> np.ndarray:
    W, H = CONFIG["width"], CONFIG["height"]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt(((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H / 2) / (H * 0.62)) ** 2)
    m = 1 - CONFIG["vignette"] * np.clip(d - 0.35, 0, 1) ** 1.6 * 1.4
    return np.clip(m, 0, 1)[..., None]


_rng = np.random.default_rng(7)


def finish(img: np.ndarray) -> np.ndarray:
    """Vignette + film grain."""
    if CONFIG["vignette"] > 0:
        img = img * vignette_mask()
    g = CONFIG["grain"]
    if g > 0:
        W, H, k = CONFIG["width"], CONFIG["height"], CONFIG["grain_size"]
        n = _rng.standard_normal((H // k + 1, W // k + 1), dtype=np.float32)
        if k > 1:
            n = np.repeat(np.repeat(n, k, 0), k, 1)
        n = n[:H, :W, None]
        # grain is strongest in the mid-tones, like real film
        mid = 1 - np.abs(img.mean(axis=2, keepdims=True) * 2 - 1)
        img = img + n * g * (0.4 + 0.6 * mid)
    return np.clip(img, 0, 1)


# ════════════════════════════════════════════════════════════════════════════
#  Text rendering
# ════════════════════════════════════════════════════════════════════════════
STYLE_DEFAULTS = {
    #          font    size  y(0..1)  shadow
    "title":  ("title", 118, 0.40, True),
    "body":   ("body",   56, 0.72, True),
    "kicker": ("body",   38, 0.33, True),
    "lower":  ("body",   40, 0.74, True),
    "end":    ("title", 132, 0.46, True),
}


def _font(kind: str, size: int, weight: int) -> ImageFont.FreeTypeFont:
    path = CONFIG["font_title"] if kind == "title" else CONFIG["font_body"]
    path = path if os.path.isabs(path) else os.path.join(HERE, path)
    try:
        f = ImageFont.truetype(path, size)
        try:  # variable fonts: pick a weight
            f.set_variation_by_axes([weight])
        except Exception:
            pass
        return f
    except OSError:
        return ImageFont.truetype("DejaVuSerif.ttf" if kind == "title" else "DejaVuSans.ttf", size)


@lru_cache(maxsize=64)
def render_text(text: str, style: str, size: int | None, tracking: int) -> np.ndarray:
    """Render text (multi-line ok) to a premultiplied RGBA float array with a
    soft drop-shadow and faint outline for readability on any background."""
    kind, dsize, _, shadow = STYLE_DEFAULTS[style]
    size = size or dsize
    weight = 400 if kind == "title" else (500 if style != "kicker" else 600)
    font = _font(kind, size, weight)
    if style in ("kicker", "lower"):
        text = text.upper()
    lines = text.split("\n")
    max_w = CONFIG["width"] - 2 * CONFIG["safe_side"]

    def line_w(s):
        return sum(font.getlength(ch) + tracking for ch in s) - tracking if tracking else font.getlength(s)

    # shrink to fit safe width
    while max(line_w(l) for l in lines) > max_w and size > 20:
        size = int(size * 0.94)
        font = _font(kind, size, weight)
    asc, desc = font.getmetrics()
    lh = int((asc + desc) * (1.12 if kind == "title" else 1.35))
    pad = 60
    w = int(max(line_w(l) for l in lines)) + pad * 2
    h = lh * len(lines) + pad * 2
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    for i, l in enumerate(lines):
        x = (w - line_w(l)) / 2
        y = pad + i * lh
        if tracking:
            for ch in l:
                d.text((x, y), ch, font=font, fill=255)
                x += font.getlength(ch) + tracking
        else:
            d.text((x, y), l, font=font, fill=255)
    a = np.asarray(mask, np.float32) / 255
    col = np.array(CONFIG["text_color"], np.float32) / 255
    rgb = np.ones((h, w, 3), np.float32) * col
    alpha = a
    if shadow:
        sh = np.asarray(mask.filter(ImageFilter.GaussianBlur(size * 0.18)), np.float32) / 255
        sh = np.roll(sh, (int(size * 0.05), 0), (0, 1)) * 0.55
        edge = np.asarray(mask.filter(ImageFilter.MaxFilter(3)), np.float32) / 255 * 0.25
        dark = np.clip(np.maximum(sh, edge), 0, 1)
        alpha = a + dark * (1 - a)
        rgb = (col * a[..., None] + np.array([0.05, 0.03, 0.02]) * (dark * (1 - a))[..., None]) \
            / np.maximum(alpha, 1e-4)[..., None]
    return np.dstack([rgb * alpha[..., None], alpha]).astype(np.float32)


def overlay_text(frame: np.ndarray, tx: Text, t: float) -> np.ndarray:
    dur_in, dur_out = 0.7, 0.5
    if not (tx.start <= t < tx.end):
        return frame
    pin = ease_out((t - tx.start) / dur_in)
    pout = ease((tx.end - t) / dur_out)
    opacity = min(pin, pout)
    rgba = render_text(tx.text, tx.style, tx.size, tx.tracking)
    scale, dy = 1.0, 0.0
    if tx.anim in ("rise", "scale"):
        scale = 0.94 + 0.06 * pin
    if tx.anim == "rise":
        dy = 34 * (1 - pin)
    # very slow drift keeps static text feeling alive
    scale *= 1 + 0.015 * (t - tx.start) / max(tx.end - tx.start, 0.1)
    h, w = rgba.shape[:2]
    if abs(scale - 1) > 1e-3:
        nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
        chans = [np.asarray(Image.fromarray(rgba[..., c]).resize((nw, nh), Image.BILINEAR))
                 for c in range(4)]
        rgba, (h, w) = np.dstack(chans), (nh, nw)
    W, H = CONFIG["width"], CONFIG["height"]
    yc = (tx.y if tx.y is not None else STYLE_DEFAULTS[tx.style][2]) * H
    yc = min(max(yc, CONFIG["safe_top"] + h / 2 - 60), H - CONFIG["safe_bottom"] - h / 2 + 60)
    x0, y0 = int((W - w) / 2), int(yc - h / 2 + dy)
    # clip to frame
    fx0, fy0 = max(x0, 0), max(y0, 0)
    fx1, fy1 = min(x0 + w, W), min(y0 + h, H)
    if fx1 <= fx0 or fy1 <= fy0:
        return frame
    patch = rgba[fy0 - y0:fy1 - y0, fx0 - x0:fx1 - x0]
    a = patch[..., 3:4] * opacity
    region = frame[fy0:fy1, fx0:fx1]
    frame[fy0:fy1, fx0:fx1] = region * (1 - a) + patch[..., :3] * opacity
    return frame


# ════════════════════════════════════════════════════════════════════════════
#  Compositor
# ════════════════════════════════════════════════════════════════════════════
class Reel:
    def __init__(self, project: Project):
        self.p = project
        total = CONFIG["duration"]
        print("• loading media")
        cache = os.path.join(HERE, ".cache")
        self.sources = {}
        for s in project.shots:
            s.path = fetch_if_url(s.path, cache)
            if s.path not in self.sources:
                self.sources[s.path] = src = Source(s.path)
                src.close()
        self._open = []  # most recently used video sources
        print("• building timeline")
        self.beats = beat_grid(project.music, project.music_start, total)
        build_timeline(project.shots, self.beats, total)
        for i, s in enumerate(project.shots):
            print(f"   {i:2d}  {s.t0:6.2f}–{s.t1:6.2f}s  {os.path.basename(s.path)} @ {s.start:.1f}s")

    def source(self, path: str, keep: int = 3) -> Source:
        src = self.sources[path]
        if path in self._open:
            self._open.remove(path)
        self._open.insert(0, path)
        for old in self._open[keep:]:
            self.sources[old].close()
        del self._open[keep:]
        return src

    def shot_frame(self, s: Shot, t: float) -> np.ndarray:
        src = self.source(s.path)
        xf = CONFIG["crossfade"]
        # progress spans the shot incl. its dissolve tail so motion never stalls
        span = (s.t1 - s.t0) + xf
        p = (t - s.t0) / span
        local = s.start + (t - s.t0) * s.speed
        return reframe(src.frame(local), s, p)

    def match_for(self, s: Shot):
        if not hasattr(s, "_match"):
            mid = s.start + (s.t1 - s.t0) / 2 * s.speed
            s._match = measure(self.source(s.path).frame(mid))
        return s._match

    def make_frame(self, t: float) -> np.ndarray:
        shots, xf = self.p.shots, CONFIG["crossfade"]
        total = CONFIG["duration"]
        idx = next(i for i, s in enumerate(shots) if s.t0 <= t < s.t1 or i == len(shots) - 1)
        cur = shots[idx]
        img = grade(self.shot_frame(cur, t), self.match_for(cur))
        # dissolve: the outgoing shot keeps playing for `xf` seconds into this one
        if idx > 0 and cur.cut == "dissolve" and t - cur.t0 < xf:
            prev = shots[idx - 1]
            a = ease((t - cur.t0) / xf)
            img = grade(self.shot_frame(prev, t), self.match_for(prev)) * (1 - a) + img * a
        if cur.cut == "flash" and t - cur.t0 < 0.25:   # soft white flash
            img = img + (1 - img) * (1 - (t - cur.t0) / 0.25) * 0.85
        if t < 0.6:                                     # open from black fast (hook)
            img = img * ease(t / 0.6)
        img = finish(img)
        for tx in self.p.texts:
            img = overlay_text(img, tx, t)
        fo = CONFIG["fade_out_seconds"]
        if t > total - fo:
            img = img * (1 - ease((t - (total - fo)) / fo) * 0.92)
        return (np.clip(img, 0, 1) * 255).astype(np.uint8)

    def audio(self):
        total = CONFIG["duration"]
        if not self.p.music:
            return None
        m = AudioFileClip(self.p.music)
        end = min(m.duration, self.p.music_start + total)
        m = m.subclipped(self.p.music_start, end)
        # loudness normalise (RMS-based approximation of LUFS)
        arr = m.to_soundarray(fps=22050)
        rms = float(np.sqrt(np.mean(arr ** 2)) + 1e-9)
        gain = 10 ** ((CONFIG["music_volume_lufs"] + 3.0) / 20) / rms
        peak = float(np.abs(arr).max()) * gain
        gain = gain / max(peak / 0.97, 1.0)            # never clip
        m = m.with_volume_scaled(gain)
        m = m.with_effects([AudioFadeIn(CONFIG["music_fade_in"]),
                            AudioFadeOut(CONFIG["music_fade_out"])])
        return m.with_duration(min(total, m.duration))

    def render(self, out: str, preview: bool = False):
        clip = VideoClip(self.make_frame, duration=CONFIG["duration"])
        a = self.audio()
        if a is not None:
            clip = clip.with_audio(a)
        print(f"• rendering {out}")
        clip.write_videofile(
            out, fps=CONFIG["fps"], codec="libx264", audio_codec="aac",
            audio_bitrate="256k", preset="ultrafast" if preview else CONFIG["preset"],
            threads=os.cpu_count(), logger="bar",
            ffmpeg_params=["-crf", str(CONFIG["crf"] + (6 if preview else 0)),
                           "-maxrate", CONFIG["maxrate"], "-bufsize", "22M",
                           "-pix_fmt", "yuv420p", "-profile:v", "high",
                           "-movflags", "+faststart", "-colorspace", "bt709",
                           "-color_primaries", "bt709", "-color_trc", "bt709"],
        )
        mb = os.path.getsize(out) / 1e6
        print(f"✓ done: {out}  ({mb:.1f} MB)")


# ════════════════════════════════════════════════════════════════════════════
#  Project loading / CLI
# ════════════════════════════════════════════════════════════════════════════
def load_project(path: str) -> Project:
    with open(path) as f:
        data = json.load(f)
    base = os.path.dirname(os.path.abspath(path))
    media_dir = os.path.expanduser(data.get("media_dir", base))
    if not os.path.isabs(media_dir):
        media_dir = os.path.join(base, media_dir)
    CONFIG.update({k: tuple(v) if isinstance(v, list) else v
                   for k, v in data.get("config", {}).items()})

    def resolve(p):
        if p.startswith(("http://", "https://")) or os.path.isabs(p):
            return p
        return os.path.join(media_dir, p)

    shots = []
    for s in data["shots"]:
        s = {"path": s} if isinstance(s, str) else dict(s)
        s["path"] = resolve(s["path"])
        shots.append(Shot(**s))
    texts = [Text(**t) for t in data.get("texts", [])]
    music = data.get("music")
    return Project(shots=shots, texts=texts,
                   # music is relative to the project file, not media_dir
                   music=(music if os.path.isabs(music) else os.path.join(base, music)) if music else None,
                   music_start=data.get("music_start", 0.0),
                   output=data.get("output", "reel.mp4"))


def quick_project(media: list[str], music: str | None, texts: list[str]) -> Project:
    """Build a project straight from CLI args: even pacing, auto texts."""
    shots = [Shot(path=m, length=2.4 + (i % 3) * 0.6) for i, m in enumerate(media)]
    total = CONFIG["duration"]
    tx = []
    if texts:
        slot = (total - CONFIG["end_card_seconds"]) / len(texts)
        for i, t in enumerate(texts[:-1] if len(texts) > 1 else texts):
            tx.append(Text(t, 0.4 + i * slot, 0.4 + i * slot + min(slot - 0.5, 4.0),
                           style="title" if i == 0 else "body"))
        if len(texts) > 1:
            tx.append(Text(texts[-1], total - CONFIG["end_card_seconds"] - 0.5, total, "end"))
    return Project(shots=shots, texts=tx, music=music)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", nargs="?", help="project JSON file")
    ap.add_argument("--media", nargs="+", help="quick mode: media files/URLs in order")
    ap.add_argument("--music", help="background music file")
    ap.add_argument("--text", nargs="+", default=[], help="quick mode: overlay texts (last = end card)")
    ap.add_argument("-o", "--output", help="output file")
    ap.add_argument("--duration", type=float, help="override duration (s)")
    ap.add_argument("--preview", action="store_true", help="fast low-quality render")
    ap.add_argument("--still", type=float, nargs="+", help="export PNG frames at these times instead of rendering")
    args = ap.parse_args()

    if args.duration:
        CONFIG["duration"] = args.duration
    if args.project:
        project = load_project(args.project)
        if args.music:
            project.music = args.music
    elif args.media:
        project = quick_project(args.media, args.music, args.text)
    else:
        ap.error("give a project JSON or --media files")
    if args.duration:
        CONFIG["duration"] = args.duration
    out = args.output or project.output

    reel = Reel(project)
    if args.still:
        for t in args.still:
            p = f"{os.path.splitext(out)[0]}_{t:05.1f}.png"
            Image.fromarray(reel.make_frame(t)).save(p)
            print("  wrote", p)
        return
    reel.render(out, preview=args.preview)


if __name__ == "__main__":
    sys.exit(main())
