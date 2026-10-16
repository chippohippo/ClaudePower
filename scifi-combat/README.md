# Emberfall: sci-fi flame-sword combat starter (Three.js)

- **Design and plan:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) covers the architecture diagram, folder layout, module contracts, movement and melee deep dives, weapon and class data model, AI, netcode, performance and roadmap.
- **Graybox demo:** serve this folder statically (`npx serve .`) and open `index.html`. It sets up a duel against a Flame Knight bot with vault and climb boxes and a wall-run wall.

| Path | What |
|---|---|
| `src/movement/MovementController.js` | Locomotion FSM: walk/sprint/crouch/prone, slide, dodge with i-frames, vault/climb, wall-run, coyote time and jump buffer. Includes Rapier and flat-ground physics adapters |
| `src/combat/melee/MeleeSystem.js` | Attack FSM (windup/active/recovery), chains, charge specials, guard/perfect block/parry/whiff, counters, heat, poise, guard break, feints |
| `src/ai/MeleeDuelistBrain.js` | Utility AI that sends commands the way a player would, reacts to windups, and learns how often you parry |
| `src/camera/CameraRig.js` | First/third-person blend, shoulder swap, collision, FOV kicks, motion-safe head bob, trauma shake |
| `src/input/InputManager.js` | Keyboard/mouse plus gamepad mapped into one per-tick command, with response curves and rumble |
| `src/net/Prediction.js` | Client prediction and reconciliation with visual error smoothing, and snapshot interpolation |
| `src/combat/weapons/WeaponDefs.js` | Archetype → weapon → attachment stat composition, and damage-matrix math |
| `data/` | All tuning: movement, melee, ballistic and energy weapons, attachments, damage matrix, classes |
