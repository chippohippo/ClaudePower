# Gameplay plan: feel, readability, agency

What we take from each reference, and the order we build it in. Every number below is a starting
value for data, not a constant in code; every system gets a contract test before it ships.

| From | What players praise | What we take |
|---|---|---|
| Helldivers 2 | Guns with weight (aim that lags the camera, reloads that cost you), call-ins typed under fire, friendly fire that makes every throw a decision, bodies that fly | Ergonomics (done), staged reloads that drop the mag, stratagems, friendly fire (done), physical explosions |
| The Last of Us Part II | Melee you can read, hits that tell you what happened, enemies who talk, flank, search and mourn | Windup tells, hit-stop and dodges in every client; callouts and flanking; search instead of omniscience |
| Star Wars Battlefront II | Classes that feel different in the first ten seconds, battle points spent on bigger toys mid-match, readable chaos at scale | Battle points, support roles that pay, heroes and vehicles as rewards, silhouettes and paint (done in the art pass) |

## Priority order

Feel and readability first, then agency, then breadth. Each tier ships whole.

| Tier | Item | Why now |
|---|---|---|
| P0 | **Stratagems** (call-ins by directional code, thrown beacon, delay, payload) | The signature verb: it turns every fight into a decision about where to put the strike, made with your hands busy while you're being shot |
| P0 | **Hit feedback**: hit markers (armor, headshot, kill, friendly), damage direction, small-arms muzzle and impact effects, hit-stop and flinch in the frontline client | Every shot must say what it did. Today a hit is a sound and nothing else; misses say nothing |
| P0 | **Reloads that cost**: the mag you drop is gone, staged progress you keep, no sprint-reloading | A reload becomes a choice (top up or fight on), and counting mags becomes part of the game |
| P0 | **Friendly fire** with fire discipline and its HUD | **Done** in this pass (below) |
| P1 | **Battle points**: earned for the team-useful things, spent mid-match on stratagem uses, vehicles and heroes | Gives support play a payoff and every match a rising arc |
| P1 | **Support roles that do support**: ammo packs, stims, repairs, the 20 class passives | Class identity in the first ten seconds; reasons to stay near your squad |
| P1 | **Melee in the frontline client**: windup chevrons, hit-stop, swept hits, quick melee for gunners | The swords exist but the big mode can't read them |
| P1 | **Bots that talk and flank**: callouts, a flanking order, search when contact is lost | High-agency enemies, readable through sound |
| P2 | Camera: auto shoulder swap, sphere-cast collision with character fade, hit flinch, melee framing | Polish that removes friction |
| P2 | Encounter director: the front breathes (lulls, surges, preparations keyed to tension) | Pacing on a 400-soldier map |
| P2 | Audio: layered gunshots with distance tails, low-health heartbeat, reload foley | Gunfeel is half sound |

## 1. Gunfeel and feedback

**Exists:** 14 guns, 8 fire modes, recoil patterns with first-shot multipliers and recovery,
stance-scaled spread and bloom, HD2 ergonomics (the gun's aim chases the camera at 4 + 0.22 x
ergonomics deg/s, with a second reticle), ADS blends and FOVs, heat guns with a perfect-vent
minigame, critical-hit ragdolls, camera trauma per shot, audio hit confirms. **Missing:** visual hit
markers, damage direction, small-arms muzzle and impact effects, a reload that costs anything, hit
flinch on the camera, real gunshot audio. Bugs: parries anywhere on the map shake your camera; the
suppressor's audio op throws on string audio ids.

**Upgrade (client: `src/ui/HitMarkers.js`, `src/vfx/BattleFx.js`; sim: `WeaponSystem`):**

| Feedback | Spec |
|---|---|
| Hit marker | Four ticks round the crosshair on `weapon:hit` from you, 90 ms (refreshed per hit, max one new marker per 50 ms). Kill: larger, red, 180 ms. Headshot: gold. Armor that shrugs the round off (damage-matrix multiplier < 0.5): grey and small, with a dull "plink". Friendly: a blue X (and the HUD's FRIENDLY FIRE line, done) |
| Damage direction | A red wedge on a ring round the crosshair pointing at the source, opacity by damage (20 = 0.4, 80+ = 1), fading over 1.2 s; blasts use the burst point |
| Muzzle | Flash on screen for 2 frames (35 ms) on the shooter's barrel; a puff of smoke that hangs 0.6 s; the player's own gun lights the scene for those frames |
| Impacts | Per surface: dirt puff (dust color), sparks on metal and vehicles, splinters on timber, sand spray on sandbags, a dark mist on flesh; pooled bullet-hole decals (256) |
| Hit flinch | Being hit kicks your camera 0.6 deg x damage / 20 (capped at 3 deg) up and toward the source, recovering in 120 ms; it also nudges the gun's aim by half that (ergonomics recovers it) |
| Hit-stop | Frontline gets the arena's hit-stop: melee 1-5 ticks, your kills with a shotgun or sniper 2 ticks |

**Reloads (sim, `WeaponInstance`; data per gun: `reload.stages`, `mags`):**

- **Mags are objects.** Reserve is counted in magazines (AR: 6 x 30). A reload with rounds still in
  the mag throws that mag away with its rounds: you top up only when it's worth it. (Shotguns and
  shell-fed guns keep shell-by-shell loading; heat guns keep venting.)
- **Staged:** two stages (mag out, mag in and chamber): AR 0.9 s + 1.0 s tactical, + 0.6 s to
  chamber from empty (2.5 s). A reload interrupted after stage 1 resumes at stage 2; before it, it
  starts over (the mag is still in).
- **Sprinting pauses a reload** (progress held), walking slows it to x0.85 of walk speed, a hit
  that flinches you pauses it for 0.2 s instead of cancelling it.
- **Resupply** fills whole mags (depots: 1 mag per 0.5 s, unchanged).
- Contract tests: a tactical reload loses the rounds left in the mag; the reserve counts mags;
  stage-2 progress survives an interruption; sprint pauses without losing progress.

## 2. Stratagems (call-ins)

**Exists:** instant-placed supers (Strafing Run, Orbital Lance, Void Rain), vehicle drops, player
artillery through FieldGuns, shells with craters and cover damage. **Missing:** codes, beacons,
uses and rearm, a call-in loadout, supply drops, reinforcements, a HUD.

**Design (`src/combat/Stratagems.js`, `data/stratagems.json`, HUD `src/ui/StratagemPanel.js`):**

- **Input:** hold the call-in key (Tab; pad: hold LB, a tap stays ability 1) and type the code
  with WASD or the arrow keys (pad: D-pad). Ctrl works with the arrow keys too (not WASD: Ctrl+W
  closes a browser tab). While Tab is held you don't walk (WASD types); on a pad the stick still
  moves you. Each arrow is a press; the panel narrows to the codes that still match.
  A wrong arrow buzzes and clears the code. Your left wrist's call-in pad (modeled on every
  trooper) lights up while you type.
- **Beacon:** a full code puts a glowing beacon in your hand; fire throws it (21 m/s, a lob of
  up to about 46 m), it sticks where it lands (ground, cover, vehicles, people). Pressing the call-in key again
  without typing puts it away. A beam of the team's light marks it for everyone.
- **Delay, then the payload**, at the beacon. Strikes walk in from the sky (FieldGuns rounds:
  craters, blown sandbags, scorch marks, bots diving for cover from the incoming list), so they
  hurt everyone (friendly fire) and the danger is readable.
- **Cooldowns and uses** per soldier: orbital strikes have cooldowns; airstrikes have uses that
  rearm all at once.

| Stratagem | Code | Delay | Payload | Cooldown / uses |
|---|---|---|---|---|
| Supply Drop | ↓ ↓ ↑ → | 5 s | A pod with ammo for the squad (4 grabs: 2 mags each); crushes what's under it | 120 s |
| Precision Strike | → → ↑ | 3 s | One heavy shell (splash 7 m, crater) on the beacon | 90 s |
| Orbital Barrage | → ↓ ← ↑ ↑ | 5 s | 12 shells over 8 s, scattered 22 m round the beacon | 180 s |
| Strafing Run | ↑ → → | 1.5 s | 14 small blasts along 32 m, from the thrower out through the beacon | 2 uses, rearm 100 s |
| Airstrike | ↑ → ↓ → | 2.5 s | 5 bombs across 26 m, perpendicular to the throw | 2 uses, rearm 120 s |
| Sentry | ↓ ↑ → → ↑ | 4 s | A machine-gun sentry in a pod (it shoots through whoever walks into its line) | 150 s |
| Smoke Screen | → ↑ ↑ ↓ | 2 s | A 25 m line of smoke that blocks sight for 20 s | 70 s |

Codes are our own; the verbs are the genre's. Every soldier gets Supply Drop and Smoke Screen; the
class kit adds two (assault: Precision + Strafing; demolitionist: Barrage + Airstrike; engineer:
Sentry + Supply; and so on in `data/stratagems.json`).

**Bots call in too**, by the same rules (`src/ai/CallInPlanner.js`, [AI.md](AI.md)). They strike
a cluster of 3+ enemies they can see within a throw (40 m; the beacon flies at 21 m/s, about
46 m at most), with no teammate within 15 m of the payload's footprint and themselves outside it.
They drop supplies when short of ammo and fetch from the pod, lay smoke to cross open ground
under fire, and put a sentry down when holding. They take as long to type as a quick human (0.16 s
per arrow), and each side's call-ins are rationed by its size.

**HUD:** a panel left of the crosshair while the key is held: each stratagem's name, its code as
arrows (typed arrows lit, dead codes dimmed), its cooldown or uses; an incoming marker and a
countdown at every beacon; a danger-close ring at the beacon for strikes.

**Contract tests:** codes type, mismatch and reset; the beacon sticks; payloads land after their
delay where the beacon is; strikes hurt teammates (friendly fire) and bots never call one onto
their own; cooldowns and uses hold; the incoming list warns bots in time to dive.

## 3. Friendly fire (done in this pass)

`data/rules.json` + `CombatWorld.harm`: rounds, beams, projectiles and their statuses, blasts,
sword swings, rams, sentries, mine blasts and harmful zones hurt teammates by a share per kind (all
of it by default; your own blasts half). Friendly damage earns no super energy. Bots keep fire
discipline (`src/ai/FireDiscipline.js`): no shot through a teammate (they step aside for a clean
line), no frag into a room with one, no area ability onto friends, AT crews hold, and fire
missions stay 32 m from our own. HUD: teamkills in the feed, FRIENDLY FIRE and WATCH YOUR FIRE
lines. Tests: `tests/friendly-fire.test.mjs`. Next: a teammate's sentry and stratagem kills credited
as teamkills in the end-of-match screen; voice barks ("Check fire!").

## 4. Melee

**Exists:** the Dawnblade with light chains, a hyper-armored heavy, a riposte, a parry window of
0.15 s, perfect blocks, stamina-gated blocking, heat, poise and stagger, feints, energy deflection.
The arena shows the tells (a dot, hit-stop, rumble); the frontline client shows none of them.

**Upgrade:**
- **Frontline readability:** windup chevrons on the screen edge for any enemy winding up at you
  within 6 m (unblockable attacks in red), the blade's heat glow (exists), 1-5 ticks of hit-stop.
- **Quick melee for gunners** (V, pad R3): a rifle-butt shove: 0.12 s windup, 0.25 s recovery,
  35 damage, 0.4 s stagger, 1.8 m reach; it shoves a soldier off a parapet or out of a doorway.
- **Swept hits:** the blade's base-to-tip segment swept between ticks against the hit spheres
  (replacing the cone test), so what you see is what hits.
- **Finishers** on downed enemies from behind (exists as finish-off): a 1.1 s animation, the
  camera framing the pair.
- 9 more melee weapons in `data/weapons/melee.json` (the system is data-driven; only one is
  authored).

## 5. Classes, support and progression

**Exists:** 10 roles per side, 80 abilities, revives (medics faster and stronger), digging
(engineers faster), turrets and repair tethers. **Missing:** the 20 class passives, a resupply role,
stims, any in-match progression; a bug where Sunwell resurrects the dead instead of reviving the
downed.

**Battle points** (`src/game/BattlePoints.js`, `data/battle-points.json`): earned for what helps the
team (kill 100, assist 50, revive 150, resupply a teammate 40 per mag, build 60, repair 2 per HP,
capture 200, defend a point 10/s, deliver supplies 80 per truckload, spot that leads to a kill 30);
spent on the spot from the call-in panel: an extra stratagem use (400), a vehicle drop (800-1200),
a hero (2000: the class super as a timed form with its own kit). Points reset on death by half,
so staying alive with your squad compounds.

**Support roles:** every medic carries 3 stims (heal 60 over 2 s, revive a downed teammate in 1 s
and stand him up at 60%); every engineer 2 ammo packs (each: 2 mags for up to 4 teammates) and
repairs; the 20 class passives from `data/classes/*.json` go live.

## 6. AI and encounters

**Exists:** personalities, difficulty, squads (wedge, bounding overwatch, room clearing, holding and
digging in, charging), cover and peeking, shared contacts, suppression, revives, gun crews, supply
convoys, ducking incoming rounds, and now fire discipline. **Missing:** talk, flanking, search,
morale, a director.

**Upgrade:**
- **Callouts** (`squad:bark` events → voice and subtitles): "Contact front!", "Reloading!",
  "Grenade!", "Man down: Kael!", "Moving up!", "Check fire!". Bots know each other's names; the
  enemy's barks are audible within 40 m (TLOU2: you hear their plan).
- **Flanking order:** a squad pinned for 4 s sends its second fire team round the side (±60° from
  the contact, through the tactical map's cover) while the first suppresses.
- **Search:** contact lost for 3 s turns into a search of the last seen position and the cover
  near it, not a beeline.
- **Morale:** a squad that loses half its men in 20 s falls back to the previous trench.
- **Director:** a tension value per sector from casualties, advances and captures; it times
  whistles, preparatory barrages and reinforcement waves so the front surges and pauses.

## 7. Movement and camera

**Exists:** inertia with sprint ramps, carves, pivots and skids, stamina, stance timings, slide and
slide-to-prone, dives with i-frames, vault and climb, stumbles and ragdolls; the camera's spring
follow, stance framings, FOV kicks, trauma shake, reduced motion, shoulder swap and first person.
**Missing:** automatic shoulder swap, a sphere-cast camera with character fade, hit flinch on the
camera, melee framing, lean.

**Upgrade:** swap shoulders automatically when the near side is blocked for 0.25 s (and back when
it clears); sphere-cast collision (radius 0.25 m) and fade soldiers inside 0.6 m of the lens;
hit flinch (see Gunfeel); in melee, pull the camera 0.4 m out and center the opponent; lean out
of cover by holding ADS next to a wall edge.

## Data-driven identity

Every feel number lives in data, each file owned by one system: guns in `data/weapons/*.json`
(handling, recoil, reload stages, mags), melee in `melee.json`, movement in `movement.json`,
stratagems in `stratagems.json`, rules in `rules.json`, battle points in `battle-points.json`, class
kits in `data/abilities`, looks in `data/art`. Bots read the same data through the same commands.
Each data file has contract tests (the movement feel tests are the model: feel bands, not exact
values).

## Extras that earn praise

- **The wrist pad** lights up arrow by arrow as you type a call-in (it's already on every trooper).
- **Pods that crush:** supply and sentry pods kill whoever stands under them, friend or foe, and
  leave a smoking pod you can take cover behind.
- **Bodies stay** (done) and blasts throw them (done): the battlefield remembers.
- **Propaganda in the world:** our own posters and slogans on village walls, a dispatch voice that
  announces sectors taken and lost.
- **A photo mode** from the art lab's posing and lighting (the hero shot is already a station).
- **Accessibility:** reduced motion (exists), a hold-to-complete option for call-in codes, team
  colors that survive color blindness (hazard yellow against royal purple already does).

## Built in this pass

1. **Friendly fire everywhere**, with fire discipline and its HUD (above).
2. **Stratagems** (P0). Codes on the wrist pad, the call-in panel, beacons that stick and ride,
   and seven payloads: strikes, runs and bombs flown by a strike jet, supply and sentry pods,
   smoke. Cooldowns, uses and rearms. Beams by kind, danger fences, strike streaks, audio. Bots
   call them in carefully, rationed per side (`CallInPlanner`), get out from under pods and
   shoot sentries. The sentry is balanced against a bot battle.
3. **Hit feedback** (P0). Markers by result, each with its own sound. Damage-direction wedges,
   the camera's hit flinch and the gun's aim knock, hit-stop on your own melee and kills.
   Muzzle flashes at the barrel that light the scene, impacts by surface, 256 bullet holes.
4. **Reloads that cost** (P0). Whole-mag reserves, the mag thrown away on a tactical reload, two
   stages with stage 2 kept, sprint holds, hits hold, a slower walk. The HUD shows mag pips, the
   rig drops the mag, and the audio has the out and the in.
5. **Bugs from the survey, fixed.** Parries anywhere no longer shake your camera. The suppressor
   no longer throws, and now shortens how far a shot is heard. The Sunwell revives the downed
   rather than raising the dead.
6. **Battle points** (P1). Earned for takedowns, assists, spots, revives, shared mags, digging
   in, captures, defending and deliveries; lost for teamkills and halved on death. Spent on the
   call-in panel: an extra use (400), a recon vehicle (800) or a tank (1200) dropped in a cradle,
   the hero (2000: your super, charged). Bots earn and spend them too. Sentries now leave downed
   soldiers alone (they were finishing most of their victims, which killed the revive game).
7. **Support roles** (P1). Medics carry three stims (a heal, or a downed teammate up in a second
   without kneeling), engineers two ammo packs and repairs (hold H at a damaged vehicle or turret).
   All twenty class passives are live, each with its numbers in `data/passives.json`. Bots use
   items with the same key and repair before boarding a damaged vehicle. The HUD shows your
   passive, items and prompts; a spotter's marks glow red; Mindread reads cooldowns.
8. **Melee on the front** (P1). Eleven new blades, one per class (spear, saber, cleaver, twin
   daggers, vibroblade, power fist, halberd, knife, hook, cinder edge, the Ashsworn's), built as
   overrides of a base moveset. Hits are the blade swept along the rig's arc against the hit
   spheres. A rifle-butt shove (V) for every gunner, finishers on the downed (hold X), windup
   chevrons round the crosshair; bots use all three.
9. **Bots that talk, flank, search and break** (P1). Every soldier has a name; bots call out
   contacts with a direction, men down, reloads, grenades, strikes, check fire, moves and
   covers, flanks and fall-backs, spoken by the browser's speech synthesis and subtitled (yours at
   any range, the enemy's within 40 m). A pinned squad sends a fire team round the flank; a bot
   that loses sight searches the last seen spot instead of tracking through walls; a squad that
   loses half its men in 20 s falls back.

10. **The vehicle overhaul** (from the same request). The recon cars are now real rigid bodies on
    four sprung wheels, built from research into how the Helldivers 2 recon car drives: soft and
    bouncy, a rear-biased drive that oversteers, a handbrake for slides, about 75 km/h, no air
    control.
    - **Crashes:** they trip on kerbs, roll on bad landings and get turned over by blasts.
      Whoever is exposed is flung out with the speed the car had, and a soldier on foot can push
      a car back over.
    - **Riders:** passengers shoot their own guns from the seats. Bike riders go over the bars in
      hard crashes.
    - **Wrecks:** a killed car burns before it blows.
    - **Bots** drive, circle, run people down, gun in bursts and right their cars.
    - **Docs:** `docs/VEHICLES.md` ("Recon cars").

11. **The night city** (from the same request). A second warfront map, `index.html?map=city`,
    at every size from Overpass (4v4) to The Sprawl (200v200). It is the same front fought
    through a futuristic city at night:
    - **Layout:** avenues running with the front and cross streets; blocks of buildings on raised
      sidewalks; shelled buildings to clear; rubble lots; a park in no-man's-land with the
      fountain on its point.
    - **The war in the streets:** wrecked, burned and overturned vehicles (a few still burning),
      craters and debris, and barricade lines where the trench lines would be.
    - **The night:** street lights, lit windows and neon under a purple aurora.
    - **Docs:** `docs/FRONTLINE.md` ("The night city") and `docs/ART_DIRECTION.md` ("Neon Night").

Next: ragdolls and injuries in the Euphoria style (the user's next request): shot reactions,
stagger and knockdowns, real falls, crawling and scooting while down, and revives into an injured
state. Then, by the priority order: the camera, the director and audio (P2).
