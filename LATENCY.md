# Where the milliseconds are (2026-11-12)

The question was whether to rebuild AimForge from the ground up for the lowest latency. The answer is no, and this page is the evidence. It also describes what was built in its place: instruments that measure the latency that exists on your PC.

## What is on the pen's path, and what is not

```
pen → USB → Windows → OpenTabletDriver daemon → VMulti → RawAccel → game
                         └ HID read, parse, filters (AimForge's curve lives here), output write
```

- **The AimForge app is not on this path.** It writes settings into OpenTabletDriver and RawAccel, verifies them, and steps aside. Rewriting it changes latency by nothing.
- **AimForge's code that is on the path** is the Cadence Lock filter inside the daemon.

## Measured: what our code costs

`AimForge --path-cost` (cloud machine, a realistic stream with strokes, rests, late and queued reports):

| code | time per report | share of the pen's 2.78 ms interval | memory allocated per report |
|---|---|---|---|
| Cadence Lock core (THE GOAT, drop check 2) | about 90 ns | 0.003% | 0 bytes |
| with the Hand Print recorder | about 125 ns | 0.005% | 0 bytes |

A selftest pins both: zero allocation, and far under a thousandth of the interval. There is nothing here for a rewrite to win.

## Where the time goes

| stage | size | who owns it |
|---|---|---|
| The pen's own sampling | 360 Hz measured, so a movement waits 1.4 ms on average (up to 2.8 ms) before it is reported; firmware delay unknown | the tablet |
| USB delivery | not measured | the tablet and Windows |
| Daemon wake-up, parse, filters | our share is about 0.0001 ms; the rest is OpenTabletDriver and the Windows scheduler | OpenTabletDriver, Windows |
| Output stage (transform → VMulti write) | not measured until now: the path probe below times it on your PC | OpenTabletDriver, VMulti |
| RawAccel | flat on the Cadence Lock engine | RawAccel |
| The game reading input | once per frame: 4.2 ms at 240 fps, 1.9 ms at 540 fps | the game |

The two large terms are the pen's sampling and the game's frame time. Software in between matters in the tail: the rare moments when the PC stalls under load.

## What a ground-up rewrite would be

Replacing OpenTabletDriver with a native daemon of our own.

- **It could win:** no garbage-collector pauses and a tighter loop. That is a tail improvement, likely well under a millisecond and rare.
- **It would cost:**
  - an unknown program injecting input, where OpenTabletDriver and VMulti are known quantities to anti-cheat vendors;
  - OpenTabletDriver's tablet support and tooling;
  - any way to verify it from here: it cannot be tested without your tablet and Windows.
- A custom kernel driver is not on the table: it breaks the project's own rule and is what anti-cheats look for.

So the edge is not in a rewrite. It is in shrinking the tail and in knowing your own numbers.

## What was built instead

### The path probe (inside the Hand Print)

With Hand Print on, the recorder also times, for every report:

- **the output stage:** how long the rest of the daemon took after the curve (transform, output mode, VMulti write);
- **arrival jitter:** how far each plain report arrived from the pen's own clock (USB delivery plus the daemon's wake-up).

Two timestamps per report, taken around the hand-off; the report still leaves before any bookkeeping. **MY HAND** shows the result as "half under / 99% under / 99.9% under / worst".

### The Realtime Lane, now measured

Sessions are kept apart by whether the lane was on. Record a few minutes each way and MY HAND states what the lane changed on your PC: it helps, it does not help, or no measurable difference. Until then its effect is unmeasured.

- **Level 1:** report thread Highest, daemon Above Normal, no power throttling, low-latency garbage collection.
- **Level 2:** daemon High.
- **Level 3 (new):** the report thread also joins the scheduling class Windows gives pro-audio threads (MMCSS "Pro Audio"). That puts it above ordinary game threads. It is the safe way into that range: a thread that hogs the CPU there is demoted by Windows, unlike the raw realtime class. The Hand Print file records `mmcss 1` when it took effect.

### The burst-proof drop check

When stalls happen anyway, reports arrive in a burst; plugin 1.4 prices their speed correctly (see `CADENCE_LOCK.md` section 10).

## When to revisit a native path

If your own recording shows a bad tail that the lane does not fix (for example 99.9% of reports taking over a millisecond in the output stage), that is evidence the daemon is the bottleneck on your PC, and a native output path becomes worth its risk. Without that evidence it is not.

## Outside AimForge, and larger than anything above

- Frame rate: every extra frame per second shortens the wait before the game reads your input.
- NVIDIA Reflex or the game's own low-latency mode, on.
- The game's mouse smoothing, off (The Finals, Helldivers 2).
