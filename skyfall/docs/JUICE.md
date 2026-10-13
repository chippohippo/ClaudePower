# Juice checklist

Built from measuring every sound rendered in Chromium (`tools/audio/capture.mjs` + `tools/audio/analyze.py`)
and from headless browser screenshots. Status: ✅ done · ◐ partial · ☐ todo.

## Baseline findings (before this pass)
| Area | Finding | Evidence |
|---|---|---|
| Gunshots | All guns were sub-bass booms with no crack. Classes sounded alike. | Spectral centroid 89–198 Hz on 9 of 10 guns. The 2–8 kHz band was −22 to −27 dB. |
| Gunshots | The hard-clipped body sustained for ~0.3 s, so auto-fire smeared into mud. | Envelope plots; 30 dB decay took 180–290 ms. |
| Gunshots | The revolver had a slow attack. | The peak arrived at 17 ms instead of under 2 ms. |
| Hit flesh | It sounded like a dull thud with no "tick". | Centroid 170 Hz; the high band was −41 dB. |
| Kill / knock | Too close to the hit sounds; no distinct reward layer. | — |
| Footsteps | One surface only, and no occlusion. | — |
| Movement | No vocal effort sounds (mantle, hard land). | — |
| Abilities | One-shots only; no travel, linger or impact loops. | — |
| Ambience | No tension layer, no ring-wall hum, no low-HP or knocked filtering. | — |
| Visuals | Little camera shake or FOV punch on hits taken or dealt. No edge flash, kill flourish or bullet decals. Deaths just vanish. | — |
| Characters | Box people with no legend identity at range. | — |
| Map | Perfectly flat, so slides never get downhill speed. No ziplines. | — |
| Bots | Get stuck in buildings because they steer by probe only. | — |

## Results after the juice pass
| Area | Before | After |
|---|---|---|
| Gunshot attack | 2–17 ms, sub-dominated | ≤ 2 ms on SMGs and pistols. Crack-led with transient shaping (heavy guns peak at 2–20 ms on the 2 ms-smoothed envelope). |
| Auto-fire articulation | Body sustained ~0.3 s, shots smeared together | About 20–25 dB dips between AR/SMG shots at 780–1080 RPM (`scene_*` mixes). Separate tail at burst end. |
| Class distinctness (spectral centroid) | 89–198 Hz for everything | SMG/pistol about 700–940 Hz; AR about 140–200 Hz; LMG, marksman, sniper and shotgun 70–130 Hz (bass-heavy, with a crack transient); energy SMG about 920 Hz with the zap. |
| Bot stuck events (150 s) | about 600 | about 40–60 |
| Bot movement tech (150 s) | — | about 1,300 slides and about 400 wall bounces |

## Checklist (priority order)
1. ✅ **Sound**
   - per-class gunshot recipes (transient crack / snap / body / sub punch / separate tail)
   - burst tails, distance tiers, occlusion, tier-pitched shield hits, armor-segment crack, layered shield break, distinct knock vs kill confirm
   - surface footsteps and slide scrapes, wall-kick, synthesised mantle and land grunts
   - ability activation / travel / linger / impact loops
   - ring-wall hum, tension bed, low-HP / knocked low-pass, explosion tinnitus
2. ✅ **Hit feedback**
   - tunable shake and FOV punch
   - screen-edge flashes, kill-confirm flourish, a shield-break pop
   - better muzzle flash and tracers, bullet decals, ricochets
   - knockdown and death tumble
3. ✅ **Map height**
   - heightfield hills with slope-aware sliding, flattened POI pads
   - ziplines, a ramped jump-pad trajectory
4. ✅ **Character and weapon models**
   - legend silhouettes and accents
   - sights and attachments on guns
5. ◐ **Movement and gunplay tuning** (retuned and covered by automated tests; still needs human playtesting)
   - slide hipfire, slide speed, superglide and wall-bounce windows
6. ✅ **HUD**
   - cooldown rings, compact squad cards, kill feed, end and spectator screens
7. ✅ **Bots**
   - grid A* pathfinding, slide-hop and wall-bounce flair, third-party pushes
