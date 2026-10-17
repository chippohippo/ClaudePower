# Reel Maker — cinematic 9:16 Instagram Reels from your footage

`make_reel.py` turns a list of clips/photos + optional music + timed text into a
polished **1080×1920, 30 fps, H.264** reel of an exact length (60 s by default).

What it does:

- **Reframing**: picks a 9:16 window out of 16:9 footage. You set where it sits per shot (`x`, `y`).
- **Motion**: slow push-in / pull-out and drift on every shot (Ken Burns on photos), with eased curves.
- **Cuts on the beat**: tracks the music's beats with librosa and snaps each cut to the nearest beat. With no music it uses a BPM grid.
- **Transitions**: eased cross-dissolves, hard cuts, or a soft white "flash" into a shot. You can choose per shot.
- **Colour**: a log→display conversion for S-Log/flat footage (`log_footage`), a filmic S-curve, warm highlights with cool shadows, and a saturation boost.
- **Finish**: a soft vignette and mid-tone film grain.
- **Typography**: Playfair Display italic for titles and Montserrat for body text. Text gets a soft shadow and a faint outline, enters with a fade + rise + scale, stays inside Instagram's UI safe zones, and shrinks automatically to fit.
- **Audio**: music is trimmed, loudness-normalised (no clipping) and faded in/out.
- **Hook and ending**: a fast open from black, and an end card followed by a fade.
- **Feedback**: a live progress bar while rendering. Bitrate is capped (60 s ≈ 50–90 MB).

## Install

```bash
# ffmpeg (system)
sudo apt install ffmpeg            # macOS: brew install ffmpeg   Windows: winget install ffmpeg

pip install "moviepy>=2.1" numpy pillow scipy librosa "opencv-python-headless<5"
```

`librosa` is optional (it's only used for beat detection). The fonts are bundled in `fonts/` under the SIL OFL licence.

## Quick mode: no config file

```bash
python make_reel.py --media a.mp4 b.jpg c.mp4 d.jpg \
    --music song.mp3 \
    --text "Tyler & Sarah" "July 31, 2026" "Forever starts here" \
    -o reel.mp4
```

The first text becomes the opening title, the middle ones become captions, and the last one becomes the end card. Files can also be `https://` URLs.

## Project mode: full control

Describe the edit in JSON (see `projects/tyler_sarah.json`):

```jsonc
{
  "media_dir": "~/footage/tyler_sarah",       // relative paths resolve here
  "music": "music/song.mp3", "music_start": 12.0,
  "output": "tyler_sarah_reel.mp4",
  "config": { "grain": 0.03, "warmth": 1.2 },  // overrides CONFIG in the script
  "shots": [
    {"path": "0477.mp4", "start": 3.0, "length": 2.0, "x": 0.55, "zoom": 0.10},
    {"path": "photo.jpg", "length": 3.0, "zoom": -0.08, "pan": 0.05, "cut": "flash"}
  ],
  "texts": [
    {"text": "Tyler & Sarah", "start": 0.3, "end": 3.0, "style": "title"},
    {"text": "she said yes", "start": 20, "end": 24, "style": "kicker", "tracking": 10}
  ]
}
```

Each **shot** takes these fields:

| field | meaning |
|---|---|
| `start` | in-point inside the source clip, in seconds |
| `length` | desired on-screen length. The lengths are scaled to fill the duration and the cuts snap to beats |
| `x` / `y` | centre of the 9:16 crop (0–1) |
| `zoom` | push-in amount (`0.08` = 8 %). A negative value pulls out |
| `pan` | horizontal drift across the shot |
| `speed` | playback rate (`0.5` = half speed) |
| `cut` | how this shot comes in: `dissolve`, `cut` or `flash` |

Text **styles** are `title`, `kicker` (small spaced caps), `body`, `lower` (lower-third) and `end`. Use `\n` for line breaks, and use `y` (0–1) to move a text.

Run it:

```bash
python make_reel.py projects/tyler_sarah.json                # full quality
python make_reel.py projects/tyler_sarah.json --preview      # fast draft
python make_reel.py projects/tyler_sarah.json --still 1 20 59  # check frames as PNGs
```

## Tuning the look

All the knobs are in the `CONFIG` block at the top of `make_reel.py`:

- **Length and pacing**: `duration`, `crossfade`, `hard_cut_every`, `bpm_fallback`.
- **Style intensity**: `contrast`, `saturation`, `warmth`, `exposure`, `vignette`, `grain`, `push_in`.
- **Log footage**: `log_footage: false` for normal phone or Rec.709 footage. It's on for Sony S-Log, which is flat and grey straight out of the camera.
- **Unified look**: `match_luma` and `match_wb` exposure- and white-balance-match every shot before grading, and a soft highlight shoulder stops vibrant shots from blowing out.
- **Safe zones**: `safe_top`, `safe_bottom`, `safe_side`.

## Big 4K source files

Rendering straight from 4K works, but it's slow. Making 1920-tall proxies first speeds it up a lot:

```bash
for f in *.MP4; do ffmpeg -i "$f" -an -vf "scale=-2:1920,fps=30" -c:v libx264 -crf 19 "proxy/${f%.*}.mp4"; done
```

## Music

`make_music.py` synthesises an original, royalty-free calm, sweet felt-piano + music-box + strings track (F major, 66 BPM, no drums), so the reel has a soundtrack out of the box. To use a trending sound, you can either pass `--music yoursong.mp3`, or post the reel with the music muted and add the sound inside Instagram. Cuts snap to the beats of whatever music you use.
