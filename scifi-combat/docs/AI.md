# Bots: full kits, guns, swords and vehicles

Code: `src/ai/CombatBotBrain.js` · `src/ai/AbilityPlanner.js` · `src/ai/CallInPlanner.js` · `src/ai/VehiclePilot.js` ·
`src/ai/MeleeDuelistBrain.js` (sword sub-brain) · `src/ai/tactics/` (SquadTactics, TacticalMap,
Suppression) · `src/ai/FrontlineCommander.js` · `src/ai/SupportCommand.js`, `src/ai/CrewPilot.js`
(gun crews and truck drivers) · data: `data/ai/personalities.json`, `data/stratagems.json` (`bots`) ·
tests: `tests/ai.test.mjs`, `tests/squads.test.mjs`, `tests/support.test.mjs`, `tests/callin-bots.test.mjs`.

Bots produce the same `Command` a player's InputManager produces. Every system treats them
exactly like players: cooldowns, cast times, recoil, telegraphs, vehicles and counterplay all apply.

## Layers (re-decided every `decisionInterval`)

| Layer | What it does |
|---|---|
| Perception | Targets the nearest enemy (vehicles and turrets included: empty vehicles are deprioritized, a turret firing at the bot comes first), with hysteresis. Line of sight uses cover, walls, smoke and the terrain (nobody sees through a ridge); only the four nearest candidates get a sight ray. Cloaked enemies are invisible beyond 8 m unless Revealed. Incoming damage rate (EMA) gives "under fire"; in a vehicle it's the hull's HP. Who's around (allies, enemies at arm's length, the most hurt teammate) is rescanned every 0.2 s. |
| Vehicles | `VehiclePilot.wantVehicle()` walks to a friendly vehicle and presses interact. Driving per model: hover = point and boost, strafe-pass or ram; tracked = 18–35 m standoff, turret leads and fires only when on target; flyer = gun altitude, circle-strafe, drops passengers low. Gunners aim freely. Bots bail at under 18% hull HP while under fire. |
| Abilities | `AbilityPlanner` (below). Reacts to enemy casts with interrupts and dodges. |
| Guns | Holds the personality's range band, strafes, flanks, and sprints to close or retreat. Tracks at a limited turn rate with wandering error, compensates recoil, controls bursts by range, reloads, vents, aims down sights at range, and swaps to the shotgun up close. |
| Sword | `MeleeDuelistBrain` for close fights: parry and block timing, feints, guard breaks. Duelists switch to the sword under 12 m; others only when an enemy is in their face. |
| Safety | Sidesteps (and rolls) out of telegraphed line and circle casts aimed at it, walks out of hostile zones while they arm, and retreats at low HP. |
| Squad orders (frontline) | Its squad's `SquadTactics` hands it an order (below): move, bound, overwatch, man a trench, hold, stack, enter, grenade, assault or charge. The brain walks there, takes the stance the position allows and fights from it. Without a squad (the arena) it falls back to the commander's objective and free fighting. |
| Downs | Downed: crawls toward help, lies still while being revived, gives up when nobody's coming. Up: revives downed teammates nearby (medics go further), one reviver per patient, and finishes a revive once it's well under way. |
| Shellfire | A round about to land within a few metres (the guns' `incoming` list, the same one the audio whistles from): drop prone until just after it lands. A drop pod about to land on it: sprint out from under it (prone is how you get crushed). |
| Call-ins | `CallInPlanner` (below): strikes, supply drops, smoke and sentries, typed and thrown like a player's. Short of ammo with one of our supply pods within 30 m, it walks over and takes its mags. |
| Duty (frontline, 12v12 and up) | Gun crews and truck drivers (below) get to their gun or truck and take their seat; `CrewPilot` drives it. They fight as infantry only when an enemy is in their face or their vehicle isn't back yet. |

## Squads (`SquadTactics`)

A squad of four has a leader's head: a plan re-thought twice a second (staggered across squads)
from the commander's order, the squad's shared contacts and the map's tactical knowledge. Each bot
gets an order and carries it out with its own aim, cover use and gunplay. One phase at a time,
with hysteresis:

| Phase | When | What the squad does |
|---|---|---|
| advance | no contact, far from the objective | A wedge around the leader along the route: 5 m to each side and 4 m back per rank. The leader slows to a jog when the squad falls behind. No blob, no conga line. |
| jumpoff | attacking across our own trench line | Man its firing positions facing the enemy, near our lane, 4 m apart. Report ready; at the whistle the whole squad goes over the top at once, each man to cover 15–25 m out, climbing straight out rather than walking to an exit. Bounding resumes once they reach cover (or 9 s). Enemies coming at the trench are what manning it is for; only enemies down in it (overrun) make the squad fight for it instead. |
| contact | enemies seen within 75 m, or under fire | Bounding overwatch: two fire teams. One holds cover (or the nearest within 8 m) and suppresses what the squad has seen; the other bounds 12–18 m past the squad's front to cover that faces the threat and gets it closer, 6 m apart (stragglers catch up instead of bounding from where they lag), then they swap. Out of a trench, bounds land clear of it. A pinned moving team waits. While a squadmate is being revived nobody bounds. |
| assault | the objective is within its radius + 22 m | Everyone onto the point, into cover inside its radius. |
| clear | enemies seen in a building near us, or rooms touching the objective during a fight there | Sweep and clear, room by room: the two nearest stack on either side of the doorway (crouched, facing it) while the other two cover the entry from 5 m back; frag out if one has a grenade; the pair goes in through the doorway itself and splits to the near corners; sweep to the middle; the cover pair follows in; the room is marked cleared for the team after 2 s with nobody inside, and the squad moves on through the next doorway. |
| hold | our point, or ordered to defend it | Anchors (two, or one in a small squad) inside the capture radius; the rest a line ~30 m out toward the enemy. That's a trench if one is there (manning the side that faces them), else cover along that line, else they dig in. The line's frame only turns when the threat has really moved round (> 50° for 3 s), so positions and the holes dug at them stay put. Enemies on the point: counter-attack it. |
| hold (a lane) | ordered to hold a stretch of the front (role `line`), within its radius + 15 m (+ 30 m once holding) | No anchors and no point to take: the whole squad strung out across the lane, 5–9 m apart, facing the enemy: in a trench at the lane or just ahead of it if there is one, else in the cover there, else dug in. Getting there is the same as any attack: over the top from our trench with the wave, bounding under contact, clearing rooms on the way. |
| charge | only when desperate | The point we hold is about to fall with none of us on it; the last man standing is hurt and has an enemy within 12 m; or the team is out of tickets, or out of time and losing. Sword fighters close in on enemies within 14 m by themselves, whatever the order: that's their weapon, not a charge. |
| regroup | more than half the squad is 45 m from the leader, and no contact | Close up on the leader, who waits in cover. |
| follow | a human leads the squad | A wedge on you while you move; cover around you (within ~9 m) facing the threat when you stop. |
| fallback | morale: half the squad (at least two) killed within 20 s, while attacking | Everyone sprints back to cover 40 m behind (the trench there if there is one) for 15 s, then regroups and goes again. At most once a minute; holding squads don't break. |

**Flanking.** In contact, a squad pinned for 4 s (its moving team too suppressed to bound, or the
squad as a whole under heavy fire) splits: the second fire team goes round one side, 60° off the
line to the enemy, to cover about as far from him as the squad is (20-40 m), on the side with more
cover there; the first suppresses him. Once there (or after 20 s) the flankers hit him from the
side for 10 s, then the squad goes back to bounding. A three-minute 32v32 sees a few flanks.

**Talk (`Barks`).** Every soldier has a name from his army's list (`data/ai/barks.json`), and
the squad uses it. Bots call out contacts with a direction from their facing ("Contact left!",
"Prey behind!"), a squadmate down by name and their own call for a medic, a revive, reloading
under fire, a grenade they throw, a strike coming down, a call-in they throw, a teammate's
rounds in them ("Watch your fire, Vex!"), a kill now and then, a search and a lost contact, and
the squad's plan: moving and covering as the fire teams swap, flanking and suppressing, falling
back. A soldier says at most one line every 2.5 s and the same kind every 9 s; a squad doesn't
repeat a kind within 4 s. The client speaks them (speech synthesis, a voice per army, quieter
with distance) and subtitles them: your squad at any range, anyone within 40 m (you hear the
enemy's plan). A three-minute 32v32 has a few hundred lines.

**Shared knowledge.** Every member's sightings and whoever shot at a member become squad contacts
(last seen position, 15 s memory). The threat point is a weighted mix of the nearest recent ones, so a
soldier who can't see the enemy still knows where to look, where to suppress and which way cover has
to face. Rooms where enemies were seen are "hot" for the team.

### Carrying out an order (`CombatBotBrain`)

**Search, not omniscience.** A bot remembers where it last saw its target. Out of sight for 0.8 s,
it aims at that spot, not at where he really is; out of sight for 3 s, it searches: walks to the
last seen position, then to up to two pieces of cover near it (where he'd have gone), sweeping its
muzzle, and after 14 s, or with nowhere left to look, calls the contact lost and lets him go.

- **Getting there:** A* waypoints between cover (string-pulled; doorways threaded through their
  centre; never cutting a corner past a costlier cell), the objective's flow field when far, straight
  at it when a formation slot is in plain sight. Orders can spell out waypoints (`via`: through a
  doorway). Arrival also checks height, so a soldier doesn't stop on the sandbags above a trench spot.
- **Feelers** along the way it's actually going, whatever it's aiming at: climb what can be climbed
  (low cover, parapets, crates, rocks, dug positions) with hold-to-climb, slide along anything taller
  following the wall toward where it wanted to go.
- **The ground changing under the plan:** the nav grid hears of everything built, blown away or
  come down (cover, holes, rubble settling: `NavGrid.updateRegion`), keeps a log of what blocked
  ground, and repairs the flow fields that ran through it. A route being walked is checked against
  that log each tick (`NavGrid.cut`): rubble landing across what's left of it (too tall to climb)
  means a new route at once, not a walk into the pile until stuck. Rubble low enough to climb over
  stays a way through.
- **Things coming down:** a building that starts to fall marks the ground it will come down on (under
  it, and round it a third of its height, until it has fallen and settled: `Structures.dangerAt`).
  A soldier standing there gets up and runs out the shortest way, shouting it ("It's coming down,
  move!"), whatever he was doing.
- **Unsticking:** no progress for 1 s, hold climb; 2 s, re-plan the route; 3 s, sidestep out of the
  corner.
- **Stance from the position** (with the player's inputs: crouch tap and hold, prone key, jump):
  crouched behind half cover and in trenches, up to fire over it in bursts and back down to reload or
  when the fire gets heavy; leaning out past a corner from full cover; prone in a crater or when
  pinned in the open. A bot crouched behind cover doesn't fire until its muzzle clears it.
- **Fire discipline:** overwatch and holds engage what they see; movers only what's within 45 m; an
  enemy within 10 m is fought whatever the order (movers stop for him).
- **Suppressive fire:** bursts swept across where the squad last saw the enemy, when the rounds would
  land near them (not in the cover in front), keeping ammunition back for real targets.
- **Grenades through doorways and over parapets:** the ballistic pitch is solved for the throw.
- **Digging in:** holding where the line has no cover, it digs (foxhole, sandbags, a trench to the next
  position) unless an enemy is within 55 m or the fire is heavy.
- **Holding a position**, it doesn't use launch pads or dashes that would throw it out.

### The tactical map (`TacticalMap`)

Built once per match and kept current: cover spots 0.6 m out from every face of every piece of cover
(each knows the direction it protects from and its height: half cover 0.9–1.45 m to fire over, full
cover to hide behind, corner spots that lean out), trench firing positions (covered both ways),
craters (prone cover from everything), dug positions, and ruin rooms with their clearing state. A
16 m grid answers radius queries; spots are reserved per soldier so two never pick the same one.
Destroyed cover takes its spots with it.

### Suppression (`Suppression`)

Rounds cracking past within 2.6 m (a bot's rounds are checked against the soldier it was aiming at
and his neighbours; a human's along their path), hits, impacts and blasts raise a soldier's
suppression (0–1); it bleeds off a moment after the fire stops. Suppressed bots stay low and their aim
wanders up to 2.6× wider; pinned ones (over 0.8) hug the dirt. Squads use it on purpose: the overwatch
team's job is to suppress so the other team can move. The player sees the screen edges darken.

### Fire discipline (`FireDiscipline`)

Friendly fire is on (data/rules.json, Helldivers rules): rounds, blasts, swords, rams, sentries
and burning ground hurt teammates as they hurt enemies. So no bot pulls a trigger through its own
side: before each burst it checks the line from its eye to the target's chest for teammates within
0.9 m of it (re-checked every 0.15 s), and for weapons that burst, the blast radius round the target
too. When the line isn't clean it holds fire and picks a new strafe, stepping aside for a clean shot
like a person would. Grenades aren't thrown into a room with a teammate in it, area abilities aren't
put on a target with teammates round it (or used as a shockwave with teammates round the bot), AT
crews hold the slug while one of ours is between the gun and its target, and fire missions are never
called within 32 m of our own soldiers (`SupportCommand`).

### Call-ins (`CallInPlanner`)

Bots call in stratagems (see [FRONTLINE.md](FRONTLINE.md)) by the player's rules, with the same
buttons. They hold the call-in key and type the code an arrow every 0.16-0.22 s, then aim the lob
(ballistic, the beacon's lift and their own drift taken out, their aim error put in) and throw a
moment later. Rushed by an enemy within 9 m, they let go or put the beacon away. When:

| Call-in | When | Where |
|---|---|---|
| Strike | A cluster it can see: 3+ enemies (a vehicle counts 3; 4+ for a barrage) inside the payload's footprint, within 40 m | The cluster's centre; a strafing run starts 6 m short of it and walks through. Never with a teammate (downed ones too) within 15 m of the footprint, nor the thrower within 5 m; never on a cluster another of our strikes is coming down on |
| Supply drop | Ammo below a third of a full load, no supply pod or beacon of ours within 40 m, no enemy close | 7 m off to a side clear of teammates (a pod crushes), with no wall in the way |
| Smoke | Crossing open ground (move, bound, charge, over the top) under fire with the enemy in sight 20-80 m ahead | 40% of the way to them (at most a throw), the screen across the line of fire |
| Sentry | Holding (man, hold, overwatch) with an enemy in sight 15-45 m out, no turret of its own up | Beside it and a step back |

With the beacon in hand a strike follows its cluster: from where the bot last saw it, one enemy
fewer will do, and 3 m of slack on the teammate check. The bot puts the beacon away if the cluster is
gone or one of ours walks into the danger. A side spends call-ins from a budget that grows with its
size (`bots.every`, s per kind at 32 soldiers a side). In a two-minute 32v32 that comes to about five
strikes, eight sentries, eight smoke screens and a couple of supply drops, with no teammates killed
by them. A 200v200 front sees several times that, at no measurable cost per tick.

Battle points (`bots.buy`): a bot buys an extra use of a strike that's cooling down only if it
keeps 400 points after paying. It buys the hero in a fight within 40 m. On foot with its objective
more than 120 m off, no enemy near and no vehicle of ours within 30 m, a bot that likes vehicles
drops itself the tank if it can keep its reserve, else the recon vehicle, 8 m to a side with no
teammate within reach of the cradle; its pilot (`VehiclePilot`) then boards it like any other.
Since dying halves a bot's points, most never save up; the best ones spend a few times a match.

### Melee

Duelists close to their blade's real reach (`MeleeComponent.reach`: the hand, the blade, a body's
half-width), since a swing lands only where the blade sweeps. A gunner with an enemy within 1.7 m
in front of him drives the rifle butt into him (at most every second or so). A bot with a downed
enemy within 6 m, nobody else standing within 15 m, not under fire and above half health walks
over and finishes him.

### Items (`ItemPlanner`)

Support items (see [FRONTLINE.md](FRONTLINE.md)) with the same key a player presses. A medic with
stims gets a downed teammate up with a stim from 2.5 m instead of kneeling (the revive behaviour
hands over), stims a teammate in reach below half health, and himself below 40% when no enemy is
within 12 m. An engineer drops an ammo pack when he or a squadmate within 12 m is short of ammo
and no enemy is near, one pack of his down at a time; anyone short walks to one of our packs
within 25 m. An engineer with a vehicle or turret of ours below 60% within 25 m, and no fight
close, goes to its hull and holds the dig key until it's whole: he mends a damaged vehicle rather
than boarding it. Passives come with the class: a bot spotter marks what it aims at, a bot
hollow-eye's held shots hit harder. In a three-minute 32v32 the bots stim about twenty times and
repair a few hundred HP; at 200v200 it costs nothing measurable per tick.

### The whistle (`FrontlineCommander`)

Squads ready in a trench report to the commander, who blows one whistle per trench line: 6 s after the
first squad is ready (so others can get in), at most one wave every 18 s. Every squad ready on that
line goes over together; one that arrives within 3 s of the whistle goes with it; a squad left waiting
30 s goes anyway. Your team's whistles and the enemy's are heard and bannered.

### The storm (`SquadTactics.storm`)

A squad attacking a point fights its way up to it cover by cover (bounding, flanking, clearing rooms),
and against men dug in round it that can go on for minutes without anyone reaching the point. A storm
cuts that short: for 20 s, from up to 120 m out, every man goes onto the point (the assault phase:
cover inside its radius, at a sprint, firing as he goes), even over the top in the middle of the
whistle's first rush. The AI commander storms where it has the men up close and the odds (src/ai/
command/Strategist.js); a person in the commander's seat with **G**. The squad leader shouts it.

## Gun crews and supply drivers (`SupportCommand`, `CrewPilot`)

At the start of a match each team sets aside one bot per gun and truck (plus a loader for each
howitzer at 200v200, at most 30% of the team). They leave the infantry squads, start beside their
unit, and redeploy beside it.

- **`SupportCommand`** (one per team, re-plans every second) gives every unit a post and a mission.
  - Posts: batteries in the front sector's artillery park; AT guns 30 m behind the front-line
    trench across the attacked sector's lanes. When the front moves, the posts move up.
  - Missions, highest priority first: SOS, then preparation, counter-battery, observed fire and
    interdiction. See [FRONTLINE.md](FRONTLINE.md#artillery-and-the-supply-war-12v12-and-up).
  - No mission lands within 32 m of a friendly soldier.
  - The preparation barrage holds its whistle back (up to 12 s) and lifts 5 s before it blows.
  - Counter-battery comes from "hearing" enemy guns fire: their muzzle flashes, three shots for a
    fix.
- **`CrewPilot`** sends the same `Command` a player would:
  - **Gun commander:** packs up if the gun is set up somewhere else; pushes or drives it along a
    flow field that covers just this trip (backing out of whatever it sticks on); sets up at the
    post. Then it fires the mission, walking its rounds around the area on a spiral. At an AT gun
    it leads the nearest enemy vehicle it can see (terrain included: no shells into a hill),
    falling back to infantry in the open.
  - **Loader:** sits tight (a loaded gun reloads faster), and takes the commander's seat if it
    stays empty.
  - **Truck driver:** HQ dump → forward depot → dump, stopping inside each until the job is done.
    At 200v200 the trucks leave the dump 14 s apart.

## AbilityPlanner: kits without per-ability code

`profileAbility(def)` reads the effect list and infers intent tags. Every one of the 80
abilities gets at least one tag (a test enforces this), so new abilities written in data are
usable by bots immediately.

| Tag | Inferred from | Used when |
|---|---|---|
| gapCloser | dash ≥ 5 m with damage, blink-behind, damaging leaps | Target within reach, aggressive personality |
| escape | i-frame dash, blink, decoy | Low HP under fire (aims away) |
| pointBlank / skillshot | self-centred area, attached zones, line or cone shapes | Target inside radius or length |
| aoe | aimed area or zone (delayed zones need a slow or rooted target to score high) | In range; ground-aimed |
| grenade | projectile | 4 m to max throw; ballistic arc solved for the drop |
| cc / interrupt | Stun, Suppress, Silence, Root or heavy Slow; fast enough to land mid-cast | Held for enemy casts (Deadlock rule), fired after reaction time |
| heal / tetherAlly | ally heals, healing zones, repair tether | Self or ally below 65% HP |
| tetherEnemy | aimed-enemy zone | In tether range |
| dome / defensive / cover | projectile domes, overshield, Fortify, cleanse, walls | Under fire, hurt, or carrying debuffs |
| setup / trap / charge | turrets, engines, mines, tripwires, recast charges | Engaged; one at a time; recast fires when an enemy reaches the charge |
| buffZone / offenseBuff / meleeBuff | ally-status zones, beacons, weapon buffs, sword buffs | Engaged at the right range |
| stealth / info / mobility | cloak, reveal, haste or launch | Flanking or escaping; target hidden; far from the fight |
| callVehicle | vehicle-drop deployable | Vehicle-minded, none nearby, fight far away |
| superGun / superMelee / superTank | transform forms | Target in the form's range |

`scoreAbility` turns tags and context into a utility (threshold 0.55, randomized ±15%).
`aimAbility` returns the press aim, and the brain re-tracks that aim every tick of the cast so
moving targets don't dodge stale aim. `abilityReach` lets a ready close-range ability pull the
bot's preferred range in, and the bot sprints in to commit (tethers, slams, point-blank supers).

## Personalities and difficulty

`data/ai/personalities.json` maps each class's `ai` key (balanced, anchor, flanker, support,
cautious, aggressiveDuelist, vehicle, aggressive) to a preferred range, aggression, strafe,
melee preference, vehicle use (never / opportunistic / always), ability eagerness and retreat
HP. Opportunists roll once per life for vehicle use and leave second vehicles to others, but
always crew a teammate's gunner seat.

| Difficulty | Reaction | Aim speed | Aim error | Recoil comp | Interrupt chance |
|---|---|---|---|---|---|
| recruit | 0.55 s | 3 rad/s | 3.5° | 30% | 25% |
| veteran | 0.32 s | 5 rad/s | 1.8° | 60% | 60% |
| elite | 0.18 s | 8 rad/s | 0.9° | 85% | 90% |

**Fairness:** bots only "see" an enemy cast through the telegraph event after their reaction
time, never by reading sim state. Their own casts telegraph exactly like a player's.

## Demo

A 4v4 skirmish: you plus Lancer, Skyrider and Lumen bots against Ashsworn, Monolith,
Driftcaller and Hollow-Eye bots. Respawns take 3 s at team spawns, with a killfeed and team
score. The HUD shows the HP, statuses and cooldowns of the enemy under your crosshair.
Use `?difficulty=recruit|veteran|elite`.

## Scale

400 bots (the 200v200 Extreme Warfront) think on a level-of-detail schedule set by distance from
the nearest human camera:

| Distance | Think every | Pipeline (move, shoot, cast) |
|---|---|---|
| < 60 m | tick (60 Hz) | 60 Hz |
| < 160 m | 2nd tick | 60 Hz |
| < 400 m | 4th tick | 30 Hz |
| beyond | 6th tick | 30 Hz |

Between thinks a bot holds its last command. Ragdolled soldiers and vehicle crews always run at
60 Hz. Headless (no camera), bots think every 2nd tick (every 3rd past 128 players). Flow fields
are shared per objective and repaired in place when cover changes (see
[FRONTLINE.md](FRONTLINE.md#scale)).

## Next
- A finer nav (or a navmesh) for trench networks and buildings: the 2 m grid needs portals and
  corner rules to get through doorways and traverses.
- Lock-on launchers so infantry bots have a dedicated anti-vehicle answer.
- Recorded voices to replace the speech synthesis, and a whistle line for the jump-off.
