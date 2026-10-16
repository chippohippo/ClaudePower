# Abilities, Weapon Firing and Sound Clarity

This is the companion to [ARCHITECTURE.md](ARCHITECTURE.md). It covers the ranged firing model,
the class ability layer and the audio/visual clarity rules that keep a fight readable.

## 1. Weapon firing (`src/combat/weapons/WeaponSystem.js`)

| Feature | How it works |
|---|---|
| Fire modes | `auto`, `semi`, `burst` (burst plus delay), `pump`/`bolt` (separate chamber step with its own sound), `charge` (hold, then release), `spool` (rpm ramps up), `beam` (continuous damage that ramps up while it stays on target) |
| Ammo models | magazine and reserve · **heat** (energy: fire until overheat lockout, passive vent, manual vent with an **active-vent** timing window worth +15% damage) · **battery** (beams drain and recharge) |
| Reloads | tactical vs. empty times · shell-by-shell reloads that firing can interrupt · reloads continue while sprinting · melee hits, stuns and suppression interrupt them |
| Recoil | deterministic per-shot **pattern** (data/weapons/recoil.json) plus seeded jitter, so recoil is learnable. Recovery starts only once you stop firing, so pulling down against the pattern is the skill. ADS, crouch and prone tame it; heat makes it worse |
| Spread | hip↔ADS blend × movement (walking, airborne, sliding) × stance × heat, plus bloom from sustained fire. Pellets use an even disc sample |
| Determinism | all randomness is `rng(entityId, shotIndex)`, so the server reproduces the client's spread exactly for lag-compensated validation |
| Hit types | hitscan (lag-compensated raycast) · projectiles (pooled, swept segment tests so nothing tunnels, drop, fuses, sticky, splash) |
| Interplay | point-blank shotgun pellets flinch melee wind-ups · flame-sword guards deflect `deflectable` energy bolts back at the shooter (costs sword heat) · melee hits cancel reloads and ADS |
| Damage | `base × falloff × hitzone × damageMatrix[ammo][armor]`. Shields count as the `shield` armor type while up, which is why ion weapons strip shields and kinetic rounds finish |
| Events | `weapon:fire/recoil/tracer/hit/impact/reloadStart/reloadEnd/overheat/perfectVent/beam*`. VFX, audio, camera and HUD only listen to these |

## 2. Ability design pillars (inspired by Deadlock and Destiny 2)

1. **Every cast is a commitment.** Abilities have a cast time (the tell), real cooldowns
   (10–60 s) and a short window where the caster is slowed or rooted. Fights become
   *cooldown trades*: "the Monolith burned Grav Plate, so I can push."
2. **Every enemy cast is readable in three ways:** a ground or air telegraph whose shape and size
   come from the ability data, a threat audio cue that starts on the cast's first tick, and an
   animation pose. All three last the full cast time, so a reaction is always possible.
3. **Every ability lists its counterplay in data** (`counterplay` field). If the designer can't
   write one sentence of counterplay, the ability isn't finished. The field also feeds tooltips.
4. **Deadlock tension: interrupts and lockouts.** Suppress, Silence and Stun cancel casts and
   refund half the cooldown (Deadlock interrupt). Silenced players see a locked ability bar and
   hear a "snuff" cue.
5. **Destiny verbs (elemental identity).** Each faction has its own element verbs, and they build
   on each other:
   - **Solari / Radiant:** Scorch (stacks, then Ignite at 100: a 4 m blast), Blind, Radiant
     (+20% weapon damage), Fortify.
   - **Void / Gravitic:** Weaken (+15% damage taken), Suppress (no abilities), Volatile (bursts
     on the next hit), Slow (3 stacks Stun), Pull.
6. **Supers** charge from damage, kills and a slow trickle. An enemy super triggers a 2D
   stinger, a VO line and a HUD direction arrow for everyone within its radius (Destiny's
   "super incoming" moment).
7. **Mid-match upgrades (Deadlock ability points).** Kills and objectives grant **Flux**. Each
   ability has 3 tiers costing 1/2/3 Flux. Tier 3 changes behavior (extra recast, cluster split,
   second turret) rather than only numbers.
8. **Information is visible both ways.** Enemy cooldowns appear on your HUD when you target
   them (Deadlock). Being Revealed always pings the victim. Uncloaking always plays a 3D cue.

## 3. Ability anatomy (data/abilities/*.json)

```jsonc
{
  "id": "solar_charge", "slot": "ability1", "cooldown": 14, "charges": 1,
  "cast": { "time": 0.25, "root": false, "moveMul": 1, "interruptible": true },
  "duration": 0.35,                       // active phase; effects fire at their `at` offset
  "telegraph": { "shape": "line", "length": 8, "width": 1.2 },
  "effects": [ { "type": "dash", ... }, { "type": "area", "at": 0.3, "status": { "id": "scorch", "stacks": 40 } } ],
  "audio": { "sig": { "root": "E3", "timbre": "flame_roar" }, "radius": 45 },
  "counterplay": "...",
  "upgrades": [ { "desc": "-3s cooldown", "ops": [ { "stat": "cooldown", "op": "add", "value": -3 } ] } ]
}
```

Effect primitives (`EFFECTS` in AbilitySystem.js): `dash`, `blink`, `area`, `shape` (line/cone),
`projectile` (fuse, sticky, cluster, on-hit status), `zone` (persistent tick area), `deployable`,
`self` (buffs, overshield, cleanse, weapon buffs), `reveal`, `transform` (roaming supers).
A new ability is normally just data.

## 4. Sound and visual clarity spec

**Cue naming.** Cue IDs derive from the ability ID, so no per-ability audio code is needed:
`<id>.cast` · `<id>.cast_threat` · `<id>.loop` · `<id>.impact` · `<id>.end` · `ui.ready_<slot>`
· `status.<status>.apply|confirm|trigger|burst` · `vo.<voEnemy>`.

| Rule | Implementation |
|---|---|
| Friend vs. foe variants | Enemy casts play `.cast_threat`: +3 dB, a sharper transient and an octave lower in the synth fallback |
| Faction sound families | **Solari:** brass, choir and bells in major intervals, pitch sweeping *up*. **Void:** sub drones, reversed swells and tritones, pitch sweeping *down*. You can tell the faction with your eyes closed |
| Unique signature per ability | `audio.sig.root` and `audio.sig.timbre`. No two abilities in a kit share a root note |
| Priority tiers | 0 THREAT (aimed at you, enemy supers, statuses on you, parries) · 1 COMBAT · 2 WEAPON · 3 AMBIENT. Tier 0 is never stolen and side-chains music (-8 dB) and ambience (-6 dB) |
| Self-state cues stay 2D and quiet | ability ready, super ready, denied (cooldown or silenced), low ammo, perfect vent |
| Hit-confirm language | Distinct confirm sounds for headshot, shield break, flesh, plate and ability hit, so the attacker knows the result without looking |
| Telegraph colors | enemy = red with a faction rim · ally/self = faction gold or violet at 25% opacity. Shapes come from the same data as the hit, so the warning always matches the hitbox |
| Status readability | every status has a **shape icon** (readable without color), a body VFX and a victim-side 2D loop |
| Accessibility | colorblind modes swap the red/gold/violet palette but keep icon shapes. Reduced motion swaps Blind's whiteout for a dim vignette. Subtitled cues name the ability and its direction ("Collapse, behind you") |
| Prototype audio | `SynthBackend` builds each cue from its signature with WebAudio, so readability can be play-tested before any sound assets exist. `HowlerBackend` swaps in real assets and falls back to the synth for any missing cue |

## 5. Faction kits

Faction rule: **Solari shields regenerate** after 4 s out of combat. **Void leech armor** refills
by dealing damage. Mirrored roles, asymmetric verbs.

### Solari Directorate: Radiant

**Lancer**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Sunstrike Dash | 12s ×2 | Short dash; your next 3 shots deal +25% damage. | Tracking the dash direction; the buff is visible as a golden muzzle glow. |
| ability2 | Flare Burst | 24s | Thrown flare that detonates after 0.6s, blinding enemies facing it. | Turn away or break line of sight during the 0.6s fuse; the hiss is the warning. |
| grenade | Solar Frag | 18s | Bouncing frag: 110 damage, 40 Scorch. | A ticking chime speeds up before detonation; dodge out of the ring. |
| super | Lance of Dawn | super | 10s: your rifle becomes a radiant lance. Each hit adds 50 Scorch; two hits Ignite. | A golden beam-line from the muzzle is visible; break line of sight and wait it out. |

**Bastion**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Aegis Wall | 30s | Deploy a 4m hard-light wall (800 HP) that blocks projectiles both ways for 12s. | Shoot the emitter at its base (2x damage) or flank around the edges. |
| ability2 | Bulwark Charge | 20s | Shield-first charge for 9m. The first enemy hit is Stunned for 1s and knocked back. | The charge is a straight line telegraphed for 0.4s; sidestep it. Stun is cleansable, slow is not. |
| grenade | Fortress Pulse | 25s | Field that grants allies Fortify (-25% damage taken) for 5s. | Area denial with explosives; Fortify does not block statuses. |
| super | Citadel | super | Raise a 9m radiant dome for 10s. Enemy projectiles are blocked and allies inside are Fortified. | Walk inside the dome and melee, since it blocks only projectiles; or retreat and wait. |

**Veil**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Refraction | 22s | 6s of optical camo. Firing, taking damage or using abilities breaks it. | A shimmer is visible within 8m and footsteps still play at half volume; listen for them. |
| ability2 | Mirror Step | 16s | Blink 9m and leave a decoy at your start point that runs forward for 3s. | Decoys have no footstep audio and no nameplate on ping; ping to check. |
| grenade | Glare Mine | 20s | Wall- or floor-stuck mine that blinds and Reveals the first enemy within 4m. | Mines glint with a faint amber light and emit a soft tick within 6m; shoot them. |
| super | Spectral Blades | super | 8s: your melee becomes thrown radiant daggers (3 charges, refill on kill) while cloaked between throws. | Each throw breaks cloak for 0.5s and the daggers whistle; aim at the source. |

**Artificer**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Sentry Turret | 35s | Deploy a turret (350 HP, 14 dps, 30m range) that tracks the nearest enemy. | Turrets turn slowly (90 degrees per second) and the laser sight shows their aim; strafe and shoot the core. |
| ability2 | Repair Tether | 14s | Channel a beam that heals an ally or deployable at 40 HP/s for 4s. | Both ends of the beam are visible; kill the Artificer first. |
| grenade | Arc Snare | 22s | Sticky charge that Roots enemies within 3m for 1.5s after 0.5s. | Blue sparks flash 0.5s before it fires; dodge-roll out. |
| super | Siege Frame | super | Pilot a deployed exo-frame for 15s: 1500 HP, cannon and stomp. | Its ion core on the back takes 3x damage; it can't turn quickly. |

**Lumen**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Mending Light | 10s ×2 | Lob a light orb that heals allies in 4m for 80. | Orbs travel slowly; burst the target before it lands. |
| ability2 | Rally Beacon | 28s | Plant a beacon: allies within 7m get Haste and +25% reload speed for 8s. | The beacon is 150 HP; shoot it. |
| grenade | Halo Grenade | 20s | Burst heals allies 60 and creates a 3s healing field. | Interrupt with explosives; the field is weak to suppression. |
| super | Sunwell | super | Create a 6m well for 10s: 40 HP/s heal, auto-revive downed allies and Radiant buff. | Push the well with Gravitic suppression (Psion, Monolith) or drop explosives inside it. |

**Seraph**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Wing Glide | 14s | Launch upward 4m and glide for 4s with Haste. | Gliders are slow vertically; hitscan punishes the predictable arc. |
| ability2 | Spotter Drone | 26s | Drone pulses 3 times over 6s, Revealing enemies within 18m to your team. | You hear a ping when revealed; the drone (60 HP) hovers 6m up. |
| grenade | Tripwire Lance | 24s | Laser tripwire (10m) that Slows (2 stacks) and Reveals whoever crosses it. | The beam is visible faintly at all times; crouch-slide under it. |
| super | Judgment | super | Channel a sun-lance sniper for 8s: 3 shots of 300 damage that pierce walls. | A red sight-line is visible to targets and a rising tone plays when they are aimed at for over 0.5s; break the line. |

**Dawnblade**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Solar Charge | 14s | 8m gap-closer that ends in a slam: 60 damage, 40 Scorch, parryable. | The windup flare and roar give 0.25s; perfect-parry the slam to stagger the Dawnblade. |
| ability2 | Radiant Guard | 20s | 4s: parry window +60ms, deflected bolts Scorch the shooter, and sword heat is vented. | The gold ring around the sword is visible; use guard break, grabs or explosives. |
| grenade | Ember Brand | 18s | Sticky ember that Ignites after 1.2s; if you hit the target with the sword first, it Ignites instantly. | Stuck players hear a rising sizzle; Mender and Lumen can cleanse it, or dodge into an ally's field. |
| super | Daybreak | super | 12s: flame wings and a radiant greatsword. Heavy attacks launch flame waves (90 damage); glide on jump. | Waves are slow and parryable; parry one to reflect it. The flight path is loud; track it with explosives. |

**Skyrider**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Jet Burst | 10s ×2 | Vertical jet boost (9m/s up) plus a short forward dash. | Airborne riders can't dodge; hitscan punishes it. |
| ability2 | Call Hoverbike | 60s | Drop a hoverbike at the aim point after 2s. | The drop marker is visible to everyone; stand on it to deny the drop. |
| grenade | Chaff Pod | 22s | 8m cloud: blocks Reveal, scrambles enemy minimaps and Silences vehicles inside. | Fight inside it with shotguns or melee; it lasts 6s. |
| super | Strafing Run | super | Call a gunship to strafe a 30m line after 2.5s (400 damage along the line). | The line is painted on the ground for 2.5s with a jet scream; move perpendicular. |

**Prism Adept**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Prism Split | 22s | 6s: energy weapons split into 3 beams, and heat vents 30% faster. | Split beams deal less per beam; close distance or use cover so only one beam connects. |
| ability2 | Dazzle Prism | 26s | Thrown prism that Silences enemies within 4m for 2s after 0.5s. | The prism rings for 0.5s before it bursts; it has 1 HP, so shoot it out of the air. |
| grenade | Refractor Orb | 20s | Slow field (1 stack/s) that refracts enemy bolts that pass through. | Stacks decay quickly; leave the field within 2s to avoid the stun at 3 stacks. |
| super | Spectrum Cascade | super | Channel 6s: 6 prism beams sweep a 12m circle and apply 60 Scorch per hit. | The beams rotate visibly and clockwise; stand in the gaps or interrupt the channel with a stun. |

**Breacher**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Breach Charge | 18s | Sticky charge; recast to detonate (150 damage, destroys cover). | The charge blinks red every 0.5s; shoot it to detonate it early. |
| ability2 | Concussion Slam | 20s | Ground slam: 5m knock-up, 2 stacks of Slow. | A 0.35s crouch windup with a rumble; jump to avoid the knock-up. |
| grenade | Cluster Charge | 22s | Splits into 5 bomblets on impact (40 damage each). | Bomblets scatter predictably forward; backpedal. |
| super | Orbital Lance | super | Mark a point; after 3s an orbital beam deals 600 damage in 6m and lingers for 3s. | A pillar of light marks the spot for 3s with a building whine; get out. |

### Void Collective: Gravitic

**Reaver**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Rift Lunge | 12s ×2 | Lunge 7m through a micro-rift and apply Weaken to the first enemy hit. | The rift opens 0.15s before the lunge with a reversed swell; sidestep. |
| ability2 | Devour | 24s | 8s: kills and final blows heal 80 and make your rounds apply Volatile. | A violet maw aura and gnashing loop are audible; disengage and deny kills. |
| grenade | Vortex Grenade | 20s | Gravity vortex for 4s that pulls enemies in and deals 20 dps. | The pull is weak, about walking speed; sprint or dodge out. |
| super | Event Horizon | super | 10s: your shotgun fires singularity slugs that pull targets together and detonate as Volatile. | Spread out, since clumping feeds it, and keep beyond 15m. |

**Monolith**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Gravity Anchor | 22s | 6m anchor zone for 5s: enemies inside gain a Slow stack every second; 3 stacks Stun. | The ring is drawn on the ground and gets heavier each stack; leave before 3 seconds. |
| ability2 | Crushing Advance | 18s | Advance 8m with hyper-armor, shoving enemies aside (40 damage, knockback). | Hyper-armor ignores flinch, but Suppress and Stun still stop it. |
| grenade | Grav Plate | 24s | Thrown plate that Suppresses (no abilities) enemies within 3.5m for 2.5s. | It hovers for 0.4s with a rising buzz; one shot destroys it. |
| super | Singularity | super | Plant a singularity for 6s: 10m pull, Suppress in the core (3m), and 600 HP of personal overshield. | The pull is visible as bending light; Psion and Prism silence-cleanse counters it, or kill the Monolith to end it. |

**Wraith**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Shadowmeld | 20s | 7s invisibility; your first melee from it is a 2x backstab. | Within 6m the outline distorts and a breathy whisper loop plays. |
| ability2 | Hollow Step | 15s | Blink 8m; if aimed at an enemy within 8m, appear behind them. | A void puff with a 0.1s inhale sound at the destination; turn around. |
| grenade | Null Mine | 22s | Proximity mine that Suppresses and Reveals for 3s. | It hums faintly within 5m; scan corners. |
| super | Nightfall | super | 10s: the area within 25m darkens for enemies. You are invisible beyond 10m and kills extend the duration by 2s. | Nightfall has a hard visual edge. Fight from outside it or pop a Flare (Solari radiant light ends it locally). |

**Rigger**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Leech Turret | 35s | Turret (300 HP, 12 dps) that steals 50% of the damage it deals as healing to you. | A violet tether to the Rigger is visible; break line of sight to stop the heal. |
| ability2 | Grav Lift | 24s | Lift pad that launches allies 10m up for 15s. | The pad is loud and visible; camp the landing zones. |
| grenade | Tether Grenade | 20s | Tethers up to 3 enemies within 5m together: damage to one is shared and they are Slowed. | Tethers have a 6m stretch limit; break it by moving apart. |
| super | Collapse Engine | super | Deploy an engine (1200 HP) that pulses every 2s for 12s: 120 damage plus Weaken in 12m. | Each pulse charges audibly for 1s; kill the engine or break line of sight. |

**Mender**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Siphon Tether | 12s | Tether an enemy for 4s: drain 15 dps and heal the closest ally for twice that. | The tether is a visible beam that breaks beyond 15m or behind cover. |
| ability2 | Shroud | 26s | 7m smoke dome for 6s: allies inside are Fortified and enemies outside can't see in. | Push inside it; Reveal effects pierce it. |
| grenade | Rift Bloom | 20s | Heals allies for 60 and makes them Volatile-immune and cleansed. | The heal fires on impact, so destroy it in the air. |
| super | Well of Night | super | 8m well for 10s: allies heal 35 HP/s and their weapons apply Weaken. | Night Wells silence radiant light. Use explosives and Solari Flares to dispel it. |

**Hollow Eye**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Wallseer | 28s | Pulse that Reveals all enemies within 30m for 3s. | Revealed players hear a ping and see an eye icon; it also Reveals the Hollow-Eye to anyone revealed. |
| ability2 | Grav Jump | 14s | Grav-boosted jump (12m/s up), then hover for 2s at ADS. | Hovering snipers are exposed; counter-snipe them. |
| grenade | Snare Spike | 22s | Spike that Roots the first enemy within 3m and Reveals them. | Spikes glint and tick; shoot them. |
| super | Unmaking Gaze | super | Channel 6s: a piercing void beam (180 dps) that applies Weaken; ramps up while on target. | A violet sightline is visible to the target with a rising whine; break line of sight to reset the ramp. |

**Ashsworn**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Black-Flame Lunge | 14s | 8m lunge with a black-flame slash: 55 damage, Weaken, parryable. | The windup is a black ember swirl with a low growl; parry the slash. |
| ability2 | Ash Ward | 20s | 4s: blocking costs no stamina; parries apply Volatile and Suppress the attacker for 1s. | Don't melee into an Ashsworn with Ash Ward up; shoot them or wait 4s. |
| grenade | Cinder Brand | 18s | Sticky black ember: applies Volatile, and the next hit detonates it. | Stuck targets hear a heartbeat thrum; cleanse it or avoid taking hits for 6s. |
| super | Abyssal Blade | super | 12s: an abyssal greatsword. Every hit Weakens and heavy attacks open 6m rift arcs that pull. | Rift arcs pull toward the Ashsworn; dodge away from the pull, not along it. Arcs are parryable. |

**Driftcaller**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Phase Thruster | 10s ×2 | Phase dash (5m) with 0.2s i-frames. | The i-frames end before the dash does; shoot at the exit point. |
| ability2 | Call Wraith-Skiff | 60s | Summon a void skiff at the aim point after 2s. | The drop marker is visible; stand on it to deny the drop. |
| grenade | Gravity Flak | 22s | Airburst that Suppresses vehicles and pulls jetpackers and gliders to the ground. | It does little to grounded infantry. |
| super | Void Rain | super | Paint a 12m area: after 2s, gravity bombs rain for 4s (90 damage per second plus Slow). | The area is painted with falling streaks before impact; leave it. |

**Psion**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Mind Lance | 14s | Psionic bolt that Silences for 2s and cancels channels. | The bolt is slow (40m/s), glowing and parryable by flame swords. |
| ability2 | Psychic Barrier | 22s | 4s frontal barrier that absorbs 400 damage and reflects 25% of it as Weaken pulses. | The barrier covers only the front 120 degrees; flank it. |
| grenade | Neural Spike | 24s | Burst that Suppresses within 4m and inverts the minimap for 3s. | It has a long fuse (1s) with a whispering crescendo; dodge out. |
| super | Thoughtstorm | super | Channel 5s, levitating: a 14m storm Suppresses everything inside each second and deals 60 dps. | The Psion is airborne and visible above the storm; a single stun or Mind-Lance-style silence interrupts it. |

**Riftbreaker**

| Slot | Ability | CD | What it does | Counterplay |
|---|---|---|---|---|
| ability1 | Rift Charge | 18s | Sticky rift charge; recast to implode it (pull 6m, 120 damage, destroys cover). | It pulses violet every 0.5s; shoot it. |
| ability2 | Seismic Slam | 20s | Leap and slam: 6m Suppress for 1.5s and knock-up. | The leap arc is visible and there is a 0.4s hang time; dodge sideways when they peak. |
| grenade | Volatile Cluster | 22s | Cluster of 4 bomblets that apply Volatile. | Bomblets are slow to arm (0.5s); clear the area. |
| super | Collapse | super | Throw a collapse bomb: after a 1.5s 15m pull it implodes for 500 damage in 6m. | The pull is the warning. Sprint directly away and dodge at the end; the inner 6m is lethal. |

## 6. Counter web (what beats what)

| Threat | Hard counter | Soft counter |
|---|---|---|
| Channels and supers (Thoughtstorm, Spectrum Cascade, Judgment) | Stun, Silence or Suppress interrupts them, with a 50% refund to the caster | Break line of sight |
| Flame knights (Dawnblade, Ashsworn) | Shotgun point-blank flinch, Guard Break, Concussion Slam | Kite with beams; Slow stacks |
| Turrets and deployables | Breach or Rift Charge, ion ammo | Flank outside their turn rate |
| Cloak (Veil, Wraith) | Reveal (Spotter Drone, Wallseer, Glare/Null Mine) | Listen for footsteps and the uncloak cue |
| Healing zones (Sunwell, Well of Night) | Suppress the healer; Collapse or Orbital Lance | Explosives into the zone |
| Gravity pulls (Singularity, Vortex, Collapse) | Dash or phase i-frames, Monolith's Mass passive | Sprint perpendicular |

## 7. Next steps
- Zone and deployable simulation (`ZoneSystem`, `DeployableSystem`); the effects are already defined in data.
- `transform` supers need their temporary weapon and moveset definitions (`super_lance`, `daybreak_greatsword`, ...).
- Bot ability usage beyond the gap-closer: a utility score per ability from its `counterplay` tags.
- Server: validate casts (cooldown, silence, range) and replay effects authoritatively. Clients predict only self-movement abilities (dash, blink).
