# Sound

Code: `src/audio/SoundEngine.js` (plays it in the world: depth, each map's room, the mix),
`Acoustics.js` (each map's room as an impulse response), `Ambience.js` (each map's atmosphere),
`AudioDirector.js` (sim events to sounds), `SoundBank.js` + `bankWorker.js` + `dsp.js` (whatever is
designed in code at runtime), `audio/` (the forged sounds and `manifest.json`), `tools/audio/`
(the forge that builds them, the listen tool that records the game's sound offline),
`audio-lab.html` (every sound on its own, each map's atmosphere, a battle to listen to) · tests:
`tests/sound.test.mjs`, `tests/audio-forge.test.mjs`.

The goal is a war: a sci-fi battle you hear from inside, with weapons that hit you in the chest,
everything at its distance, each map sounding like its own place, and nothing in it that
grates or repeats. It's judged the way you'd hear it in a match, with everything going off at
once: a real 32 v 32 battle recorded through the game's own engine and measured (the
[Audio Lab](#the-audio-lab-hearing-it-and-measuring-it), below).

## The forge: how the sounds are made

`node tools/audio/forge.mjs <packs dir> [out dir = audio] [--only=gun:ar_sol,boom:,...]` builds every
sound the game plays from recordings and code. The recordings are the packs supplied for the game
(modern firearms and military foley, sci-fi weapons and UI, the 400-sound collections), extracted
into one folder. The result is Ogg Vorbis under `audio/` with `audio/manifest.json`, which the
engine loads: 139 sounds, about 1,230 files, 19 MB. It needs ffmpeg with libvorbis on the PATH. The
build is deterministic and bit-exact, so re-forging a sound whose recipe hasn't changed rewrites
nothing. `--only` rebuilds the ids starting with any of the prefixes and keeps the rest.

The recipes:

| File | What it makes |
|---|---|
| `tools/audio/weapons.mjs` | every gun and energy weapon, in layers, and the far classes |
| `tools/audio/blasts.mjs` | explosions in layers (debris for each kind of ground), the artillery's reports, shells coming in, rounds and bolts going past, the sky (drop pods, the strike jet) |
| `tools/audio/foley.mjs` | handling, brass, bodies, digging, footsteps by surface, hits, melee, the UI and the call-ins |
| `tools/audio/atmos.mjs` | each map's atmosphere: its beds and its spots |
| `tools/audio/lib.mjs` | buffers, ffmpeg in and out, mixing, EQ, a lookahead limiter, levelling by punch |

Whatever has no forged version is designed in code by the SoundBank and rendered in a worker:
engine loops, beams and charges, abilities, structures creaking and coming down, impacts on
concrete, dirt, snow and energy, hits on you, a burning wreck, the heartbeat, melee windups, the
officers' whistles, a few UI pings.

### Guns: a stack of layers, never the same shot twice

A shot isn't one recording. It's four layers played together, each from its own deck of takes:

| Layer | What it is | Takes |
|---|---|---|
| **crack** | the first milliseconds: the muzzle's blast wave (a Friedlander pulse), the ground answering, the supersonic snap; a blaster's discharge. Bright: it tells you a gun just went off, and it's the first thing distance takes. | 8 |
| **body** | the shot itself: the gas roaring out (recorded shots varispeeded per gun), the receiver ringing, the faction's colour (Solari bright and hard, Void dark and growling); for an energy weapon the "pew", a click through a chain of hundreds of allpass stages (the slinky), with its partials falling. | 10 |
| **low** | the punch you feel: a sine dropping an octave and more, warmly saturated so its harmonics carry on small speakers, and a knock of low noise. The heavier the gun, the deeper and longer. | 6 |
| **mech** | the machine: the bolt or the coil cycling, a capacitor's tick, a heat sink's breath. Close up only, and loud in your own hands. | 6 |
| **far** | by class (light, rifle, heavy, shotgun, sniper, cannon, quiet), not by gun: what's left of a shot from 150 m on, a pop and a thump. | 5 |

That's 2,880 different shots per gun before pitch. On top of that, every layer gets its own pitch
(±2.5%) on every shot, and each play its own small rate and level offset. A deck never deals the take
it just played, and deals every take before any repeats. A rifle fired at full auto never loops.

The manifest's `mix` sets each gun's balance between its layers: a sniper's crack is loud, a
suppressor takes the crack away, the cannon's low end leads. Every take of a layer is levelled to the
same punch (the RMS of its loudest few milliseconds), so the mix is the only thing that sets it.
Kinetic guns get a presence lift (+3 dB at 2.8 kHz; +5 dB for snipers, shotguns and cannons) so they
cut through a firefight.

### Blasts, artillery and the air round you

* **Explosions** in four sizes (grenade, vehicle, shell, bomb, plus the EMP), each in layers:
  - **crack**: the blast wave hitting you, as long as the charge is big.
  - **body**: the fireball's roar, short and shaped to hit first.
  - **low**: the pressure in your chest, a sine falling to 20–30 Hz over seconds.
  - **debris**: what comes back down. Earth, stones and clods in the trenches (`debris@open`);
    concrete, glass and steel in the city (`debris@city`).
  - **far**: by size.
* **The artillery's reports**: a howitzer's boom, an AT gun's crack, a rocket leaving its rail (crack,
  low and body, the body carrying furthest).
* **Shells coming in**: the air tearing, a whistle dropping as it falls on you.
* **Near misses**: a supersonic crack past your head (an N-wave); Solari and Void bolts buzzing past.
* **Drop pods and the strike jet**.

### Close-up sounds

Handling (mags out and in, bolts, pumps, swaps, the dry click, vents and overheats), brass (bright on
hard ground, dull in dirt, all but gone in snow), cloth, bodies landing, slides, digging,
footsteps (concrete, dirt, snow, wood, metal), hits on metal, vehicles, wood and flesh, melee
(swings, hits, blocks, parries, deflections, guard breaks), the UI and the call-in codes. Each has
a deck of at least three takes, with more made by varispeeding the recordings a few percent.
Recordings with a whine up at 8–18 kHz are steeply low-passed out of it.

## Depth: where everything is

Every positional sound goes through the same steps (`distanceShape`):

1. **Distance.** Level falls with distance, each kind of sound with its own reference distance and
   roll-off. Past 60 m the ground and the air take 3 dB more per doubling, so a barrage 300 m off is
   a rumble, not a wall. The air takes the highs: a low-pass closes with distance. Sound travels at
   343 m/s, so a gun 300 m off is heard 0.9 s after its flash.
2. **Layers by distance.** Each layer has a window (`LAYERS`), crossfaded at equal power:
   - Up close the mechanism goes first (gone by 15 m), then the crack (by 45 m).
   - The low end lasts to about 100 m.
   - The body lasts longest (to about 220 m).
   - The far layer comes in from 60 m and is whole by 180 m.

   Your own gun (first person) is stereo with more low end and mechanism. Everyone else's is a
   point in the world (mono).
3. **Direction.** Panned by its bearing from where you face.
4. **Walls.** A ray from your head: behind cover, duller and a little quieter.
5. **The room.** Every sound goes into the map's room (below), more of it the further off: 2.4 dB more
   of it at 15 m, 8 dB more at 150 m. The low layers stay out of the room, and its return is
   high-passed at 200 Hz, so it never rumbles.

## Each map's room (Acoustics.js)

One designed impulse response per map, convolved with everything (a single ConvolverNode, unit
energy, so the send levels decide how much you hear):

* **The Trenches (open)**:
  - Earth and sandbags close by, then a few hard echoes off ruins and wrecks.
  - Then the far hills rolling it back for seconds: thunder that swells and fades, dark and low.
* **Dusk City (city)**:
  - The street's walls answering at once, the facades across it slapping back at 0.1–0.6 s.
  - A flutter between them (47 ms), and a tail the snow keeps dull and short.
* **Night City (night)**:
  - Sound carries in cold air: the slaps brighter, the tail longer (2.6 s).
  - The towers far down the avenues answer 0.9, 1.2 and 1.6 s later.

The same rifle sounds different on each map. A test checks that each room answers the way it should
(`tests/sound.test.mjs`).

## Each map's atmosphere (Ambience.js)

What you hear when nobody near you is shooting, and under everything when they are.

* **Beds**: three long stereo loops per map, playing together, each drifting in level on its own
  every few seconds, so they never line up the same way twice.
* **Spots**: one-shot things at a random bearing and distance round you, each kind on its own random
  clock, from three or four takes.
* **The war beyond the map**: barrages walking along the horizon, machine-gun bursts, single blasts
  and rocket salvos, 0.6 to 2.4 km off in every direction. They're played from the guns' and
  blasts' far layers through the map's room, so they arrive late and dull, the way a real front
  sounds from behind the line.

| Map | Beds | Spots | The war beyond |
|---|---|---|---|
| **The Trenches** | hot gusting wind over open ground; the whole front rumbling, barrages swelling and dying in it; ash and embers ticking | gusts, wire and its posts creaking, fires flaring up, a far aircraft droning over | the busiest: barrages every 14–32 s, bursts every 6–14 s, blasts every 8–18 s, rocket salvos |
| **Dusk City** | snowy wind, soft and dark; the megacity's hum and far roar; snow hissing | far sirens, a PA klaxon, patrol drones, neon buzzing, steel groaning, snow sliding off a roof, a dropship passing | quieter, muffled by the snow (barrages every 35–70 s) |
| **Night City** | still cold air; a deeper electric hum; wind singing through the towers | searchlights turning, an air-raid siren, dropships passing, transformers arcing, the klaxon, drones, neon, steel | louder: cold air carries (×1.15) |

Everything in the atmosphere is the bed of the mix: the battle near you ducks it, and what would
only add mush isn't played. On its own it sits around −33 LUFS, about 13 dB under a firefight.

## The mix: everything at once

A battle is dozens of guns, blasts and footsteps at once. Played as they are, they sum into a wall:
the first recording of a real battle sat within 3 to 4 dB of loudness from start to end, and your
own shot didn't rise above it at all. The mix is built to keep the biggest things big:

* **The loudness window (HDR).** Every sound knows how loud it'll be where you stand (its level,
  distance and kind) before it plays. The window's top is the loudest thing going, falling 18 dB a
  second.
  - **Heroes.** A sound louder than −16 dB and within 6 dB of the top is a hero. It plays as it is,
    and a new loudest ducks the rest (up to 12 dB) for as long as it's on top.
  - **Lookahead.** The duck is scheduled with the sound itself, so the hit is never what pumps.
  - **The bed.** After its attack (a shot's first 80 ms, a blast's first 350, a shell coming in for
    600), a hero's body and tail crossfade into the bed with everything else.
  - **Culling.** Anything 30 dB under the loudest isn't played at all: it would be lost anyway.
  - **Lows.** At most three low layers play at once, so piled-up bass can't turn into a drone.
* **Voices.**
  - At most 40, a layered shot counting as one.
  - A new sound takes the quietest voice if it's louder (priority breaks ties toward what matters).
  - Footsteps and handling share at most 10, so a squad's boots never take a gunshot's voice.
  - A layer under 5% isn't played.
* **The director's thinning.**
  - Rapid fire: past 70 m every other round, past 200 m one in three. It blurs together at range
    anyway.
  - Blasts: past 80 m, one landing on another's heels within 0.3 s adds nothing (0.5 s past 200 m).
  - A rocket battery's salvo roars once for every three rockets.
  - Brass: one tink every 90 ms at most, and only within 12 m.
  - Other soldiers' abilities are heard within 45 m (their supers within 120).
* **The master.**
  - It splits at 120 Hz. Below, a compressor with a 20 ms attack lets every punch through first and
    then keeps the low end from swelling. Above, nothing but a limiter touches the sound, so a shot's
    crack stays as sharp as it was made.
  - Chrome's compressors add makeup gain on their own. It's measured and taken back out, so quiet
    stays quiet.
  - The master has headroom built in, so the biggest hits land under the limiter, not in it.
* **Your ears.**
  - A blast close by dulls the world, makes it quieter and rings in your ears (only for a big one;
    no more than once in 6 s). It all comes back over seconds.
  - Rounds cracking past pull the world in a little (suppression).
  - Low health dulls it under a heartbeat.
  - The UI is dry, on its own bus.

What it measures to (45 s of a 32 v 32 battle, seed 3, on each map):

| | Before | After |
|---|---|---|
| Loudness range (momentary, p10 to p95) | 3.4–3.9 dB | 11–12.7 dB |
| Integrated loudness | about −12 LUFS | about −20 LUFS |
| Your own first shot, over what came before it | −0.3 to 1.1 dB | 7.4 to 12.6 dB |
| A blast within 60 m, peak rise (the Trenches) | 8.8 dB | 12.2 dB |
| A round cracking past you, peak rise | 9.9–10.2 dB | 11.7–12.9 dB |
| Punch of each band (crest, p95 over median) | 4–6 dB | 10–13 dB |
| Held whines | at 1.1 and 3.2 kHz (vehicle loops) | none |

## Nothing that grates

* **No held tones.** Engine loops, beams, charges and abilities are built from noise, crackle and
  struck resonances, never a pure tone held on. The atmosphere's spots are built the same way: the
  neon sign and the arcing transformer buzz in noise bursts at the mains' rate; the drone, the
  searchlight's servo and the turbines are bands of noise that glide. The alarms (sirens and the
  klaxon) are meant to be heard as notes, far off, so they're rough horns, never beeps. Tests render
  each of these and fail on any narrow line held over what's round it.
* **No repeats.** Every layer of every gun and blast comes from a shuffled deck with its own pitch on
  every play. Every simple sound has at least three takes, and most have six to ten. The exceptions
  are the call-in tones, the stingers and the beds. Beds drift, spots
  come on random clocks, and the war beyond the map is made from the same decks as the battle.
* **No harshness.** Recordings with a whine at 8–18 kHz are steeply low-passed out of it. The UI is
  low-passed at 9 kHz. Creaks groan on wide resonances instead of squealing.

## The Audio Lab: hearing it and measuring it

`audio-lab.html` plays the game's sound away from the game, through the same SoundEngine and
AudioDirector:

* **The board.** Every weapon first person and out in the world at a few distances, every blast,
  the near misses, the artillery. Click to hear.
* **Each map's atmosphere**, alone.
* **A battle**: a FrontlineSession of bots on both sides, heard from one soldier of the first side.
  When they fall, the nearest living comrade takes over.

With `?render=battle|board|amb` it records offline instead (an OfflineAudioContext, stepping the
battle every 1/60 s) and leaves a WAV and a log in `window.__audiolab`. The log records what played
and when, from how far and how loud, what the compressors did, and the voices in use.
`tools/audio/listen.mjs` drives this in a headless browser:

```
node tools/audio/listen.mjs battle out.wav map=trench planet=scorched size=32v32 seed=3 warm=25 secs=45
node tools/audio/listen.mjs board out.wav map=city planet=nightcity
node tools/audio/listen.mjs amb out.wav map=city planet=duskcity secs=60
```

It needs Playwright and a Chromium (`PLAYWRIGHT_CHROMIUM`). `EMBERFALL_ROOT` records another
checkout, for a before-and-after.
