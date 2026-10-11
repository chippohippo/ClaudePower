# Third-person match

Builds tab → **Modes** → **Feel like a first-person game**. It is remembered in `tps.txt`. On the command line it is `--apply <id> --tps on|off`. It changes only Marvel Rivals cards; every first-person card applies exactly as authored.

## Why third person feels harder with a pen

A pen aims by pointing. You learn a fixed amount of hand motion per distance on screen.

- **First person:** the camera turns about your eye. A turn of θ moves every target on screen by θ, near or far. The hand-to-screen mapping is one constant.
- **Third person:** the camera sits on an arm of length L behind the hero and orbits the hero. The aim ray always passes through the hero, but you see the world from the camera. A turn of θ moves a target at distance D by only θ·D/(D+L) on screen.

So the hand motion per on-screen offset is (D+L)/D times the first-person one, and it changes with the target's distance. With a 2.5 m arm it is 1.5× at 5 m, 1.21× at 12 m and 1.1× at 25 m. Near targets feel heavy, and no single mapping is right. A selftest checks this geometry exactly.

## What the match does

No input filter can know how far away a target is. The match picks the distance you fight at, D_ref, and scales the output by k = (D_ref+L)/D_ref. Targets at that distance then move under the pen exactly as in a first-person game, and the mismatch at every other distance shrinks.

With the default settings (2.5 m arm, matched at 12 m, k = 1.21), hand motion per on-screen offset compared with a first-person game:

| target distance | unmatched | matched |
|---|---|---|
| 5 m | 1.50× | 1.24× |
| 12 m | 1.21× | 1.00× |
| 25 m | 1.10× | 0.91× |

It is a pure output scale, written as RawAccel's output multiplier on either engine. So:
- the curve's shape against hand speed is unchanged;
- your in-game sensitivity is unchanged (the sensitivity grid keeps showing the card's value; do not change it);
- the mouse mirror follows it;
- replaying an applied build (Ctrl+Tab, calibration) never applies it twice.

## Setting it

- **Camera arm** is the distance from the camera to your hero. It is an estimate: Marvel Rivals does not publish it, and it differs by hero size. Start at 2.5 m and use about 3.5 m for large heroes.
- **Fight distance** is where most of your shots land. Use 8–10 m for divers and brawlers, and 15–20 m for pokes and hitscan.

Tune it by feel: track a strafing bot at your usual distance. If the crosshair still trails where your pen points, lower the fight distance (a stronger match). If it overshoots, raise it. Then compare with the match off using Ctrl+Tab. The field verdict is pending.
