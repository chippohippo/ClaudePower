# Sound

Code: `src/audio/dsp.js` (an offline DSP kit), `SoundBank.js` (every sound, designed in code),
`bankWorker.js` (renders the bank off the main thread), `SoundEngine.js` (plays it in the world),
`AudioDirector.js` (sim events to sounds) · tests: `tests/sound.test.mjs`.

The goal is a battle you can hear and that scares you. The guns and lasers should sound powerful,
each with its own voice, and you should hear how far away everything is.

## The bank: sounds designed from their physics

No sample files: every sound is synthesized in layers, the way a sound designer stacks
recordings. Each one-shot has two or three variants (another seed, a few % of pitch), so nothing
repeats exactly.

| Family | Layers |
|---|---|
| Kinetic guns (coil-assisted slug throwers) | the crack (the muzzle's shock front: a few ms of broadband noise), the thump (a sine falling an octave or two: the punch you feel), the body (low-passed noise: the blast's roar), the bark (a mid band that gives each gun its voice), the action (a click and the ring of its metal), a coil's electric snap (Solari) or a growl and a reversed breath (Void), near reflections off the street. Saturated together so they hit as one. |
| Lasers and plasma | the "slinky" blaster: a dispersive chirp falling from kilohertz to a few hundred hertz, its partials, an FM edge, the emitter's resonant ring, a sub punch, the sizzle of burned air. Solari hard light is bright and glassy; Void plasma is dark and ring-modulated, with a breath drawn in before the shot. |
| Far versions | the crack gone, the body dulled, the city rolling it back (echoes off facades at 0.1 to 1 s, each duller). Mono, rendered at half rate. |
| Near misses | a supersonic crack (an N-wave) past your head, or a bolt buzzing by (its pitch falling as it passes). |
| Explosions | the crack, the sub-bass you feel, the blast's roar sweeping down, crackle, debris raining back down. Far off: the thud and a long rumble rolling back. Four sizes: grenade, vehicle, shell, bomb. |
| Artillery | a howitzer's boom, an AT gun's crack, a rocket leaving its rail, an incoming round's falling whistle, a drop pod's roar, the strike jet. |
| Impacts | concrete (chips, a thud, grit), metal (inharmonic ringing, sometimes a ricochet), dirt and snow (a thud, spray), wood (a knock, splinters), energy (a sizzle and a pop), flesh. |
| You | a round slamming into your armor, ringing off your shield, your shield shattering, going down, a heartbeat. |
| Foley | footsteps by surface (heel and toe; snow crunches), gear rattling at a sprint, cloth, bodies landing, a slide's scrape, magazines, bolts, pumps, the dry click, vents. |
| Vehicles | engine loops (tracks clattering over a diesel's pulses, a hover bike's turbine, a gunship's roar, a car's growl), a burning wreck. |
| Melee | swings (flame blades roar), hits, blocks, guard breaks, the parry (a bell over a punch, sparks: the most satisfying sound in the game), windups (an unblockable one growls). |
| Abilities | built from each ability's signature (its root note and timbre in its data): bells, choirs, sub drops, air, servos, zaps. Solari rise and shine; Void falls, ring-modulated, reversed. |
| UI and call-ins | hit markers (a hit, a headshot, a kill, a plink off armor, a shield broken), the wrist pad, beacons, battle points. |
| Ambience | the city's wind and far hum, the open front's wind. |

`render(id, variant)` is pure (Node runs it in the tests). In the browser a worker renders the
bank in the order the director asks for it: your own guns first, then every gun's near and far
voice, then everything else. A match holds roughly 60 to 85 MB of it.

## The engine: depth

Every positional voice goes through four steps:

1. **Distance.** Level falls with distance, each kind of sound with its own reference distance
   and roll-off (a shell carries further than a rifle). The air takes the highs: a low-pass
   closes with distance. Sound travels at 343 m/s, so a gun 300 m off is heard 0.9 s after its
   flash. The far version takes over from the near one between about 30 and 130 m. The reverb
   send grows, so far away it's mostly the city answering.
2. **Direction.** Panned by its bearing from where you face; behind you, a little duller.
3. **Walls.** A ray from your head: behind cover, duller and a little quieter (cached per 4 m
   cell).
4. **The room.** A convolution reverb from a generated impulse response. The city has walls
   close by, facades across the street slapping back at 0.14 to 0.4 s, and a 2 s tail. The open
   front has the ground, far hills and a darker tail.

The mix: the world passes through a shell-shock filter. A blast close by dulls the world, makes
it quieter and rings your ears at about 4 kHz; it all comes back over seconds. Low health dulls
it too, under a heartbeat. Then a glue compressor and a limiter on the master. The UI is dry on
its own bus.

There are at most 48 voices. A new sound steals the quietest one (as heard where you stand) if
it's louder. Far-off rapid fire is thinned to every other round, since it blurs together at
range anyway.
