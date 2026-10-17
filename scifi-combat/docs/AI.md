# Bots: full kits, guns, swords and vehicles

Code: `src/ai/CombatBotBrain.js` · `src/ai/AbilityPlanner.js` · `src/ai/VehiclePilot.js` ·
`src/ai/MeleeDuelistBrain.js` (sword sub-brain) · data: `data/ai/personalities.json` ·
tests: `tests/ai.test.mjs`.

Bots produce the same `Command` a player's InputManager produces. Every system treats them
exactly like players: cooldowns, cast times, recoil, telegraphs, vehicles and counterplay all apply.

## Layers (re-decided every `decisionInterval`)

| Layer | What it does |
|---|---|
| Perception | Targets the nearest enemy (vehicles included; empty vehicles are deprioritized), with hysteresis. Line of sight uses cover, walls and smoke. Cloaked enemies are invisible beyond 8 m unless Revealed. Incoming damage rate (EMA) gives "under fire"; in a vehicle it's the hull's HP. |
| Vehicles | `VehiclePilot.wantVehicle()` walks to a friendly vehicle and presses interact. Driving per model: hover = point and boost, strafe-pass or ram; tracked = 18–35 m standoff, turret leads and fires only when on target; flyer = gun altitude, circle-strafe, drops passengers low. Gunners aim freely. Bots bail at under 18% hull HP while under fire. |
| Abilities | `AbilityPlanner` (below). Reacts to enemy casts with interrupts and dodges. |
| Guns | Holds the personality's range band, strafes, flanks, and sprints to close or retreat. Tracks at a limited turn rate with wandering error, compensates recoil, controls bursts by range, reloads, vents, aims down sights at range, and swaps to the shotgun up close. |
| Sword | `MeleeDuelistBrain` for close fights: parry and block timing, feints, guard breaks. Duelists switch to the sword under 12 m; others only when an enemy is in their face. |
| Safety | Sidesteps (and rolls) out of telegraphed line and circle casts aimed at it, walks out of hostile zones while they arm, and retreats at low HP. |
| Orders (frontline) | With an objective from `FrontlineCommander`, the bot follows that point's flow field and shoots on the move. It only stops to fight in three cases: an enemy within 18 m, being shot from within 30 m, or an enemy holding its point. On the point it holds its slot ([FRONTLINE.md](FRONTLINE.md)). |

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

## Next
- Objectives (capture points, payload), with SquadDirector roles (anchor, flanker, pusher) and callouts.
- A navmesh. Current steering uses feelers plus auto-vault, which is fine on open maps.
- Lock-on launchers so infantry bots have a dedicated anti-vehicle answer.
