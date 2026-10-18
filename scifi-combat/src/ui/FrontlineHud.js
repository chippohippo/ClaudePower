// FrontlineHud: the battle HUD for 8 to 400 players, laid out like the reference clips. DOM + one
// canvas, updated at render rate. Colours are relative to you: your side blue, theirs red, the
// city's civilians grey, its gangs orange. Squared display type (Orbitron) for numbers and labels,
// a condensed face (Rajdhani) for names and speech, both shipped in vendor/fonts. Everything sits
// inside the letterbox bars when the planet has them (opts.letterbox).
//  * Top: your side's tickets and bar, the sectors as circles (owner's colour, pulsing while
//    fought over, a ring filling as one falls), the match clock, theirs mirrored. Under it a
//    compass strip: headings, and the capture points at their bearings (your objective marked).
//  * Top left, your squad: callsign and morale (CONFIDENT, SHAKEN, BROKEN), what the squad is
//    doing, the order, then everyone with a role tag, what they're up to and a health line;
//    the leader starred, you last.
//  * Top right: the killfeed (▸ a kill, ◆ a down; teamkills and civilians flagged).
//  * Bottom left: radio chatter (BarkVoices) above your stance, health, shield and stamina, your
//    class passive and items, battle points.
//  * Bottom right: a round minimap, heading up (building footprints, sectors, points, allies,
//    downed teammates, enemies that gave themselves away, depots, guns, trucks, shells landing),
//    the view ([V] first or third person), the weapon, the magazine large and the reserve, and
//    your grenades.
//  * In the world: capture points (owner's colour, capture progress, distance; your squad's one
//    with its order), red crosses over downed teammates, enemies marked (◆ and a name over an
//    enemy a spotter revealed, or an enemy vehicle or gun that just fired), the crosshair and
//    HD2's second reticle where the gun really points (ergonomics drag and recoil make them
//    separate).
//  * Centre: banners (points, sectors, whistles, shortages, friendly fire), downed and respawn
//    states, prompts (revive, finish, dig, repair, stim, crew, push a car over), Mindread.
//  * The supply war (12v12 and up): the forward depot's stock above the minimap, shortages and
//    depot moves as banners; the screen edges darken under heavy fire (suppression).

import * as THREE from 'three';
import { RIGHT_TIME } from '../vehicles/VehicleSystem.js';
import { bus } from '../core/EventBus.js';
import { CIVILIAN, BANDIT, civilianEngaging } from '../combat/Teams.js';

const US = '#5ab4ff', THEM = '#ff4d4d', NEUTRAL = '#aab1bd', AMBER = '#ffc94d', CIV = '#d8d4cc', GANG = '#ff8a4d';
const TEAM_NAME = ['SOLARI', 'VOID'];
/** The weapon panel's silhouettes (side views in outline, like the reference's), by archetype. */
const GUN_ICON = Object.fromEntries(Object.entries({
  rifle: 'M8 22h22l6-5h40l4-3h22v3h40v6h-40v3h-12l-4 3H82l-3 14h-9l2-14H50l-6 6h-8l2-6H22l-8 7H6l3-10z M84 14v-4h20v4',
  smg: 'M20 20h18l4-4h44v3h28v6H86v4H66l-2 16h-8l2-16H48l-5 4h-7l2-5H28l-7 6h-6l3-10z M60 16v-4h16v4',
  shotgun: 'M4 22h24l6-5h36v3h86v6H70v3H62l-3 4H48l2-4H40l-8 7h-9l-1-7H8z M72 27h40v5H72z',
  sniper: 'M4 22h24l6-6h30v3h92v4H64v4H56l-3 13h-7l2-13H40l-8 7H22l-1-7H7z M46 16v-6h36v6 M120 23l8 14 M126 23l-6 14',
  energy: 'M10 24c0-6 6-9 12-9h40l8-5h34c8 0 12 4 12 9v2h34v5h-34v3c0 4-4 6-9 6H80l-3 9h-9l2-9H44l-8 7h-9l3-9h-8c-6 0-12-3-12-9z M78 19h24 M78 26h24',
  blade: 'M10 25h22v-4h8v10h-8v-4H10z M40 23h106l10 3-10 3H40z',
}).map(([k, d]) => [k, `<path d="${d}" fill="currentColor" fill-opacity=".1" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`]));
const ICON_OF = { assaultRifle: 'rifle', smg: 'smg', shotgun: 'shotgun', sniper: 'sniper', pulseRifle: 'energy', beam: 'energy' };
const FIRE_MODE = { auto: 'AUTO', semi: 'SEMI', burst: 'BURST', pump: 'PUMP', bolt: 'BOLT', charge: 'CHARGE', spool: 'SPOOL' };
/** The armour doll (bottom left): a trooper in outline, in the readout's colour. */
const DOLL = `<g fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
  <rect x="22" y="3" width="16" height="15" rx="4"/><path d="M26 11h8"/>
  <path d="M15 24h30l-3 34H18z"/><path d="M22 32h16M23 42h14"/>
  <rect x="6" y="21" width="11" height="10" rx="2"/><rect x="43" y="21" width="11" height="10" rx="2"/>
  <rect x="8" y="33" width="7" height="24" rx="2"/><rect x="45" y="33" width="7" height="24" rx="2"/>
  <rect x="19" y="59" width="22" height="8" rx="1"/>
  <rect x="19" y="69" width="9" height="27" rx="2"/><rect x="32" y="69" width="9" height="27" rx="2"/>
  <rect x="18" y="98" width="10" height="16" rx="2"/><rect x="32" y="98" width="10" height="16" rx="2"/>
</g>`;
const ROLE_TAG = { assault: 'TRP', juggernaut: 'HVY', infiltrator: 'RCN', engineer: 'ENG', medic: 'MED', marksman: 'MKS', flameKnight: 'BLD', pilot: 'PLT', tech: 'TCH', demolitionist: 'DEM' };
const PHASE = { follow: 'ON YOU', advance: 'ADVANCING', contact: 'IN CONTACT · BOUNDING', jumpoff: 'IN THE TRENCH · WAITING', assault: 'ASSAULTING', clear: 'CLEARING A BUILDING', hold: 'HOLDING', charge: 'CHARGE', regroup: 'REGROUPING', down: 'SQUAD DOWN' };
const SHORT = { ammo: 'AMMO', shells: 'SHELLS', sandbags: 'SANDBAGS', tank: 'TANKS', hoverbike: 'BIKES', howitzer: 'GUNS', rockets: 'ROCKETS', at: 'AT GUNS' };
const HEADINGS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const COMPASS_W = 460, COMPASS_SPAN = 150;     // px wide, degrees shown
const MAP_RANGE = 110;                          // m from you to the minimap's rim
const _v = new THREE.Vector3();
const bar = (k, col) => `<span class="pbar"><i style="width:${(Math.min(1, Math.max(0, k)) * 100).toFixed(0)}%;background:${col}"></i></span>`;
const wrap180 = (d) => ((d % 360) + 540) % 360 - 180;
/** Compass heading (degrees clockwise from north = -z) of a direction, and of a view yaw. */
const headingOf = (dx, dz) => (Math.atan2(dx, -dz) * 180) / Math.PI;
const headingOfYaw = (yaw) => (-yaw * 180) / Math.PI;

const CSS = `
@font-face { font-family: 'HudDisplay'; src: url(./vendor/fonts/Orbitron.woff2) format('woff2'); font-weight: 400 900; font-display: swap; }
@font-face { font-family: 'HudText'; src: url(./vendor/fonts/Rajdhani-SemiBold.woff2) format('woff2'); font-weight: 600; font-display: swap; }
@font-face { font-family: 'HudText'; src: url(./vendor/fonts/Rajdhani-Bold.woff2) format('woff2'); font-weight: 700; font-display: swap; }
#hud { --lb: 0px; --hz: 1; --us: ${US}; --them: ${THEM}; --amber: ${AMBER}; --disp: 'HudDisplay', 'Bahnschrift', 'Arial Narrow', sans-serif;
  --text: 'HudText', 'Bahnschrift SemiCondensed', 'Bahnschrift', 'Arial Narrow', system-ui, sans-serif;
  font-family: var(--text); color: #eef2f8; text-shadow: 0 1px 2px #000c, 0 0 8px #0007; }
#fl-top { position: absolute; top: calc(var(--lb) + 14px); left: 50%; transform: translateX(-50%) scale(var(--hz)); transform-origin: top center; display: flex; align-items: center; gap: 14px; white-space: nowrap; }
#fl-top .side { display: flex; align-items: center; gap: 10px; }
#fl-top .tn { font: 700 12px var(--disp); letter-spacing: 2px; }
#fl-top .sc { font: 800 26px/1 var(--disp); min-width: 60px; }
#fl-top .us .sc { text-align: left; } #fl-top .them .sc { text-align: right; }
#fl-top .tb { width: 170px; height: 3px; background: #ffffff1f; position: relative; }
#fl-top .tb i { position: absolute; top: 0; bottom: 0; }
#fl-top .us .tb i { left: 0; background: var(--us); box-shadow: 0 0 6px var(--us); }
#fl-top .them .tb i { right: 0; background: var(--them); box-shadow: 0 0 6px var(--them); }
#fl-top .clock { font: 600 18px var(--disp); background: #0b0d14cc; padding: 4px 10px; border: 1px solid #ffffff14; letter-spacing: 1px; }
#fl-strip { display: flex; gap: 8px; }
#fl-strip .pt { position: relative; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; box-sizing: border-box;
  font: 700 12px var(--disp); background: #0d0f16c0; border: 2px solid #ffffff24; color: #b9c0cc; }
#fl-strip .pt.hq { font-size: 9px; letter-spacing: -.5px; }
#fl-strip .pt.us { border-color: var(--us); color: var(--us); box-shadow: inset 0 0 8px #5ab4ff40, 0 0 6px #5ab4ff40; }
#fl-strip .pt.them { border-color: var(--them); color: var(--them); box-shadow: inset 0 0 8px #ff4d4d40, 0 0 6px #ff4d4d40; }
#fl-strip .pt.hot { animation: hudpulse 1s infinite; }
#fl-strip .pt u { position: absolute; inset: -5px; border-radius: 50%; -webkit-mask: radial-gradient(circle, transparent 18px, #000 19px); mask: radial-gradient(circle, transparent 18px, #000 19px); }
#fl-strip .pt em { position: absolute; top: -9px; font: 700 8px var(--disp); font-style: normal; }
#fl-strip.many { gap: 4px; } #fl-strip.many .pt { width: 24px; height: 24px; font-size: 10px; } #fl-strip.many .pt.hq { font-size: 7px; }
@keyframes hudpulse { 50% { box-shadow: 0 0 2px #fff4; filter: brightness(1.5); } }
#fl-compass { position: absolute; top: calc(var(--lb) + 14px + 40px * var(--hz)); left: 50%; width: ${COMPASS_W}px; margin-left: -${COMPASS_W / 2}px; height: 36px; overflow: hidden;
  transform: scale(var(--hz)); transform-origin: top center;
  -webkit-mask: linear-gradient(90deg, transparent, #000 16%, #000 84%, transparent); mask: linear-gradient(90deg, transparent, #000 16%, #000 84%, transparent); }
#fl-compass .strip { position: absolute; left: 0; top: 0; height: 100%; will-change: transform; }
#fl-compass .strip span { position: absolute; top: 1px; transform: translateX(-50%); font: 700 14px var(--disp); }
#fl-compass .strip span.n { font: 600 8px var(--disp); color: #ffffff70; top: 5px; }
#fl-compass .strip span.t { width: 1px; height: 5px; background: #ffffff40; top: 18px; }
#fl-compass .mk { position: absolute; top: 20px; margin-left: -7px; width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid currentColor; box-sizing: border-box;
  display: grid; place-items: center; font: 700 6px var(--disp); background: #0b0d14a0; }
#fl-compass .mk.obj { box-shadow: 0 0 0 2px #ffc94d90; }
#fl-squad { position: absolute; left: 24px; top: calc(var(--lb) + 14px + 110px * var(--hz)); width: 260px; font: 600 15px/1.2 var(--text); transform: scale(var(--hz)); transform-origin: top left; }
#fl-squad .cs { font: 700 15px var(--disp); letter-spacing: 3px; color: #d6e6ff; }
#fl-squad .mo { font: 700 8px var(--disp); letter-spacing: 1px; padding: 1px 4px 0; border: 1px solid currentColor; margin-left: 8px; vertical-align: 3px; }
#fl-squad .st { font: 700 12px var(--disp); letter-spacing: 2px; color: var(--amber); margin-top: 4px; }
#fl-squad .od { font: 700 12px var(--text); letter-spacing: 1px; color: var(--amber); opacity: .9; margin: 1px 0 6px; }
#fl-squad .m { margin-top: 5px; }
#fl-squad .m .ld { color: var(--amber); margin-right: 4px; }
#fl-squad .m .tg { font: 700 9px var(--text); letter-spacing: 1px; color: #ffffff78; margin-left: 6px; }
#fl-squad .m .hb { height: 2px; width: 190px; background: #ffffff1a; margin-top: 3px; }
#fl-squad .m .hb i { display: block; height: 100%; background: var(--us); }
#fl-squad .m.down { color: var(--them); } #fl-squad .m.down .hb i { background: var(--them); }
#fl-squad .m.dead { opacity: .35; }
#fl-feed { position: absolute; right: 24px; top: calc(var(--lb) + 14px + 38px * var(--hz)); text-align: right; font: 700 15px/1.55 var(--text); letter-spacing: .5px; transform: scale(var(--hz)); transform-origin: top right; }
#fl-feed .dn { opacity: .8; }
#fl-feed b { font: 700 9px var(--disp); letter-spacing: 1px; margin-left: 6px; }
#fl-markers .mk { position: absolute; left: 0; top: 0; margin: -15px 0 0 -16px; width: 32px; text-align: center; }
#fl-markers .mk i { position: relative; display: grid; place-items: center; width: 26px; height: 26px; margin: 0 auto; border-radius: 50%; border: 2px solid currentColor; box-sizing: border-box;
  font: 700 9px var(--disp); font-style: normal; background: #0b0d14a0; }
#fl-markers .mk u { position: absolute; inset: -6px; border-radius: 50%; -webkit-mask: radial-gradient(circle, transparent 15px, #000 16px); mask: radial-gradient(circle, transparent 15px, #000 16px); }
#fl-markers .mk span { font: 700 9px var(--disp); color: #eef2f8; letter-spacing: 1px; white-space: nowrap; }
#fl-markers .mk em { display: block; font: 700 8px var(--disp); font-style: normal; letter-spacing: 2px; color: var(--amber); white-space: nowrap; margin: 0 -40px 2px; }
#fl-markers .mk.contested i { animation: hudpulse .5s infinite; }
#fl-reticle { position: absolute; left: 50%; top: 50%; width: 0; height: 0; --gap: 4.1vh; --len: 1.2vh; }
#fl-reticle i { position: absolute; background: #ffffffe0; box-shadow: 0 0 0 1px #0008; }
#fl-reticle i:nth-child(1) { left: -1px; top: calc(-1 * (var(--gap) + var(--len))); width: 2px; height: var(--len); }
#fl-reticle i:nth-child(2) { left: -1px; top: var(--gap); width: 2px; height: var(--len); }
#fl-reticle i:nth-child(3) { top: -1px; left: calc(-1 * (var(--gap) + var(--len))); height: 2px; width: var(--len); }
#fl-reticle i:nth-child(4) { top: -1px; left: var(--gap); height: 2px; width: var(--len); }
#fl-reticle b { position: absolute; left: -1.5px; top: -1.5px; width: 3px; height: 3px; background: #fff; border-radius: 50%; box-shadow: 0 0 0 1px #0009; }
#fl-gun { position: absolute; left: 0; top: 0; width: 14px; height: 14px; margin: -7px; border: 1.5px solid #ffffffa0; border-radius: 50%; box-shadow: 0 0 0 1px #0007; }
#fl-status { position: absolute; left: 24px; bottom: calc(var(--lb) + 16px); width: 330px; box-sizing: border-box; transform: scale(var(--hz)); transform-origin: bottom left; display: flex; align-items: flex-end; gap: 14px; --tone: var(--us); background: linear-gradient(180deg, #0a0d16b0, #0a0d16d8); border: 1px solid #ffffff12; border-radius: 4px; padding: 10px 14px 12px; }
#fl-status.mid { --tone: var(--amber); }
#fl-status.low { --tone: #ff3b30; }
#fl-status .doll { width: 46px; height: 92px; color: var(--tone); filter: drop-shadow(0 0 4px color-mix(in srgb, var(--tone) 45%, transparent)); flex: none; }
#fl-status .col { flex: 1; min-width: 0; }
#fl-status .arm { display: flex; align-items: baseline; gap: 10px; }
#fl-status .lbl { font: 700 10px var(--disp); letter-spacing: 3px; color: var(--tone); opacity: .85; }
#fl-status .pct { font: 800 30px/1 var(--disp); color: var(--tone); text-shadow: 0 0 10px color-mix(in srgb, var(--tone) 40%, transparent); }
#fl-status.low .pct { animation: fl-pulse .87s ease-in-out infinite; }
@keyframes fl-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) { #fl-status.low .pct { animation: none; } }
#fl-status .seg { display: flex; gap: 3px; margin: 5px 0 6px; width: 170px; }
#fl-status .seg i { flex: 1; height: 7px; background: #ffffff1a; box-shadow: 0 0 0 1px #0004; }
#fl-status .seg i.on { background: var(--tone); }
#fl-status .seg i.part { background: color-mix(in srgb, var(--tone) 45%, #ffffff10); }
#fl-status .stn { font: 700 10px var(--disp); letter-spacing: 3px; color: #ffffffb0; margin: 2px 0 3px; }
#fl-status .thin { height: 2px; background: #ffffff14; margin-top: 3px; width: 170px; }
#fl-status .thin i { display: block; height: 100%; }
#fl-status .kit { font: 700 11px var(--text); letter-spacing: 1px; color: #9fd3ff; margin-top: 5px; white-space: nowrap; }
#fl-status .kit .bp { color: #ffe14d; }
#fl-right { position: absolute; right: 24px; bottom: calc(var(--lb) + 16px); display: flex; flex-direction: column; align-items: flex-end; transform: scale(var(--hz)); transform-origin: bottom right; }
#fl-map { width: 200px; height: 200px; }
#fl-weapon { width: 330px; margin-top: 10px; background: linear-gradient(180deg, #0a0d16b0, #0a0d16d8); border: 1px solid #ffffff12; border-radius: 4px; padding: 10px 14px 12px; box-sizing: border-box; }
#fl-weapon .top { display: flex; justify-content: space-between; align-items: baseline; }
#fl-weapon .wn { font: 700 11px var(--disp); letter-spacing: 3px; color: #c9d2e3; }
#fl-weapon .fm { font: 700 10px var(--disp); letter-spacing: 3px; color: #ffffffb0; }
#fl-weapon .mid { display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; margin-top: 4px; }
#fl-weapon .gun { width: 150px; height: 46px; color: #e8eef8; flex: none; }
#fl-weapon .am { font: 800 46px/1 var(--disp); text-align: right; white-space: nowrap; }
#fl-weapon .am small { font-size: 18px; color: #9aa3b5; margin-left: 6px; }
#fl-weapon .am.low { color: #ff8a6b; } #fl-weapon .am.out { color: var(--them); }
#fl-weapon .mb { height: 4px; background: #ffffff1a; margin-top: 7px; }
#fl-weapon .mb i { display: block; height: 100%; background: #eef2f8; }
#fl-weapon .mb.low i { background: #ff8a6b; }
#fl-weapon .pov { font: 700 9px var(--disp); letter-spacing: 3px; color: #ffffff5c; margin-top: 5px; text-align: right; }
#fl-weapon .rl { font: 700 10px var(--disp); letter-spacing: 2px; color: var(--amber); text-align: right; margin-top: 3px; }
#fl-weapon .sec { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #ffffff14; margin-top: 9px; padding-top: 8px; }
#fl-weapon .key { font: 700 9px var(--disp); letter-spacing: 2px; color: #ffffff70; }
#fl-weapon .gr { text-align: right; }
#fl-weapon .gr b { display: block; font: 700 10px var(--disp); letter-spacing: 3px; color: var(--amber); }
#fl-weapon .gr i { display: inline-block; width: 11px; height: 17px; margin-left: 4px; margin-top: 5px; background: var(--amber); clip-path: polygon(50% 0, 100% 28%, 100% 100%, 0 100%, 0 28%); }
#fl-weapon .gr i.e { background: none; box-shadow: inset 0 0 0 1.5px #ffffff40; clip-path: none; }
#fl-weapon .gr i { font-style: normal; color: #7fe7ff; margin-left: 4px; letter-spacing: 1px; } #fl-weapon .gr i.e { color: #ffffff30; }
#fl-banner { position: absolute; top: 26%; width: 100%; text-align: center; font: 800 max(15px, 2.4vh) var(--disp); letter-spacing: .2em; text-shadow: 0 0 14px #000, 0 0 3px #000; opacity: 0; transition: opacity .3s; }
#fl-kill { position: absolute; top: 37%; width: 100%; text-align: center; font: 700 max(12px, 1.6vh) var(--disp); letter-spacing: .34em; color: #f2f4fa; text-shadow: 0 0 10px #000c, 0 0 2px #000; opacity: 0; transition: opacity .25s; white-space: nowrap; }
#fl-kill.dn { color: #f2f4fab0; }
#fl-dead { position: absolute; top: 45%; left: 50%; transform: translate(-50%, -50%) scale(calc(var(--hz) * 1.12)); opacity: 0; transition: opacity .25s, transform .3s cubic-bezier(.2, .9, .3, 1); text-align: center; white-space: nowrap; }
#fl-dead.show { opacity: 1; transform: translate(-50%, -50%) scale(var(--hz)); }
#fl-dead .row { display: flex; align-items: center; gap: 12px; }
#fl-dead .bar { width: 84px; height: 14px; background: repeating-linear-gradient(-55deg, #ff4438d0 0 4px, transparent 4px 8px); }
#fl-dead .txt { font: 800 30px/1 var(--disp); letter-spacing: .2em; color: #ffe1dd; background: linear-gradient(90deg, #b3120a90, #d61d12b0, #b3120a90); padding: 7px 10px 7px 16px; text-shadow: 0 0 14px #ff3b30; box-shadow: 0 0 24px #ff3b3040; }
#fl-dead small { display: inline-block; margin-top: 8px; padding: 2px 10px; font: 700 14px var(--text); letter-spacing: 3px; color: #ffd6d1; background: #120607b0; text-shadow: 0 0 6px #000; }
#fl-dead small:empty { display: none; }
#fl-respawn { position: absolute; top: 58%; width: 100%; text-align: center; font: 700 18px var(--disp); letter-spacing: 3px; display: none; }
#fl-respawn small { font: 600 14px var(--text); letter-spacing: 1px; opacity: .85; }
#fl-prompt { position: absolute; top: 64%; width: 100%; text-align: center; font: 700 17px var(--text); letter-spacing: 1.5px; text-transform: uppercase; }
#fl-prompt b, #fl-respawn b { color: var(--amber); }
.pbar { display: inline-block; width: 140px; height: 6px; margin-left: 8px; vertical-align: middle; background: #ffffff26; overflow: hidden; }
.pbar i { display: block; height: 100%; }
#fl-downs .dn { position: absolute; left: 0; top: 0; margin: -14px 0 0 -10px; color: var(--them); font-size: 20px; font-weight: 900; text-align: center; width: 20px; }
#fl-downs .dn span { display: block; font: 700 9px var(--disp); color: #eef2f8; white-space: nowrap; margin-left: -20px; width: 60px; }
#fl-downs .dn.helped { color: #7fffb0; }
#fl-foes .fm { position: absolute; left: 0; top: 0; margin: -26px 0 0 -60px; width: 120px; text-align: center; white-space: nowrap; color: var(--them);
  font: 700 11px var(--disp); letter-spacing: 1.5px; }
#fl-foes .fm i { display: block; font: 700 10px/1 var(--disp); font-style: normal; }
#fl-supply { position: absolute; right: 24px; bottom: calc(var(--lb) + 16px + 384px * var(--hz)); font: 700 13px var(--text); letter-spacing: 1px; line-height: 1.5; text-align: right; transform: scale(var(--hz)); transform-origin: bottom right; }
#fl-supply:empty { display: none; }
#fl-supply b { font-family: var(--disp); }
#fl-suppress { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 45%, #0b0c0ecc 100%); opacity: 0; transition: opacity .15s; }
@media (max-width: 900px) { #fl-compass, #fl-squad { display: none; } #fl-top .tb { width: 60px; } #fl-map { width: 140px; height: 140px; } }
`;

export class FrontlineHud {
  /**
   * @param {HTMLElement} root  the HUD layer
   * @param {object} opts  { letterbox: fraction of the screen height each bar covers }
   */
  constructor(root, session, player, { letterbox = 0 } = {}) {
    this.s = session; this.player = player; this.team = player.team;
    this.root = root;
    if (!document.getElementById('fl-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'fl-css', textContent: CSS }));
    this.setLetterbox(letterbox);
    // The corner panels are drawn for 1080p and scale with the window's height (0.8 to 1.5).
    const fit = () => root.style.setProperty('--hz', Math.min(1.5, Math.max(0.8, innerHeight / 1080)).toFixed(3));
    fit(); addEventListener('resize', fit);
    const ny = this.team === 1 ? 1 : 0;
    root.innerHTML = `
      <div id="fl-top">
        <div class="side us"><span class="tn" style="color:${US}">${TEAM_NAME[ny]}</span><span class="sc" id="fl-sc0"></span><span class="tb"><i id="fl-tb0"></i></span></div>
        <div id="fl-strip"></div>
        <div class="clock" id="fl-clock"></div>
        <div class="side them"><span class="tb"><i id="fl-tb1"></i></span><span class="sc" id="fl-sc1"></span><span class="tn" style="color:${THEM}">${TEAM_NAME[1 - ny]}</span></div>
      </div>
      <div id="fl-compass"><div class="strip"></div></div>
      <div id="fl-squad"></div>
      <div id="fl-feed"></div>
      <div id="fl-markers"></div>
      <div id="fl-reticle"><i></i><i></i><i></i><i></i><b></b></div><div id="fl-gun"></div>
      <div id="fl-status"></div>
      <div id="fl-right"><canvas id="fl-map" width="400" height="400"></canvas><div id="fl-weapon"></div></div>
      <div id="fl-banner"></div>
      <div id="fl-kill"></div>
      <div id="fl-dead"><div class="row"><i class="bar"></i><span class="txt">ELIMINATED</span><i class="bar"></i></div><small></small></div>
      <div id="fl-respawn"></div>
      <div id="fl-prompt"></div>
      <div id="fl-downs"></div>
      <div id="fl-foes"></div>
      <div id="fl-supply"></div>
      <div id="fl-suppress"></div>
      <div id="fl-mind"></div>`;
    this.el = Object.fromEntries([...root.querySelectorAll('[id^="fl-"]')].map((e) => [e.id.slice(3), e]));
    this.ctx = this.el.map.getContext('2d');
    this.html = new Map();      // element -> last innerHTML (DOM writes only on change)
    this.markers = session.map.points.map((p) => {
      const d = document.createElement('div');
      d.className = 'mk';
      d.innerHTML = `<em></em><i><u></u>${p.name}</i><span></span>`;
      this.el.markers.appendChild(d);
      return d;
    });
    this.#buildCompass();
    this.footprints = this.#footprints(session.map);
    this.spotted = new Map();   // enemy id -> time (fired recently: shows on the minimap)
    this.impacts = [];          // { x, z, t } artillery rounds landing (minimap flashes)
    this.saidAt = new Map();    // banner kind -> time (shortage banners don't spam)
    this.downMarks = [];        // pooled red crosses over downed teammates
    this.foeMarks = [];         // pooled markers over enemies marked or just heard firing
    this.feed = [];
    this.bannerUntil = 0;
    this.time = 0;
    // Kills by turrets, mines and vehicles credit the owner or driver ("rigger's turret").
    const fighter = (id) => session.fighters.find((f) => f.id === id);
    const name = (id) => {
      const f = fighter(id);
      if (f) return f.name;
      const x = session.world.entity(id);
      if (x?.isDeployable) { const o = fighter(x.ownerId); return o ? `${o.name}'s ${x.kind}` : x.kind; }
      if (x?.isVehicle) { const d = x.seats?.find((st) => st.occupant)?.occupant; return d ? d.name : (x.def?.name ?? 'vehicle'); }
      return '?';
    };
    const teamOf = (id) => fighter(id)?.team ?? session.world.entity(id)?.team ?? -1;
    const who = (id) => (id === player.id ? 'YOU' : id ? name(id) : 'WORLD');
    this.off = [
      bus.on('weapon:fire', (e) => { const f = session.world.entity(e.id); if (f && f.team !== this.team) this.spotted.set(e.id, this.time); }),
      bus.on('gun:fire', (e) => { if (e.team !== this.team) this.spotted.set(e.id, this.time); }),
      bus.on('entity:death', (e) => {
        const vt = teamOf(e.id);
        if (vt < 0) return;
        const kt = teamOf(e.by), tk = kt === vt && e.by && e.by !== e.id && vt !== CIVILIAN;   // friendly fire: a teamkill
        // A civilian who wasn't shooting at the side that killed him.
        const v = fighter(e.id), innocent = vt === CIVILIAN && kt !== CIVILIAN && kt >= 0 && !(v && civilianEngaging(session.world, v, kt));
        this.#feedLine(`<span style="color:${this.col(kt)}">${who(e.by)}</span> ▸ <span style="color:${this.col(vt)}">${who(e.id)}</span>${tk ? `<b style="color:${THEM}">TEAMKILL</b>` : innocent ? `<b style="color:${GANG}">CIVILIAN</b>` : ''}`);
        // Your kills: ELIMINATED and the name, over the crosshair. Your death: the red banner.
        if (e.by === player.id && e.id !== player.id && !tk && !innocent) this.#confirm(`ELIMINATED ${name(e.id).toUpperCase()}`, false);
        if (e.id === player.id) this.killedBy = !e.by ? '' : e.by === player.id ? 'BY YOUR OWN FIRE' : `${tk ? 'TEAMKILLED' : 'KILLED'} BY ${name(e.by).toUpperCase()}`;
        if (tk && e.by === player.id) this.#say('tk', 'TEAMKILL · CHECK YOUR FIRE', THEM, 2, 4);
        if (innocent && e.by === player.id) this.#say('civ', 'CIVILIAN KILLED · CHECK YOUR FIRE', THEM, 2, 4);
      }),
      // Friendly fire: your rounds in a teammate, or a teammate's in you.
      bus.on('weapon:hit', (e) => {
        if (!e.friendly) return;
        if (e.attacker === player.id) this.#say('ff', 'FRIENDLY FIRE', THEM, 1.1, 2.5);
        else if (e.victim === player.id) this.#say('ffIn', `${name(e.attacker).toUpperCase()} · WATCH YOUR FIRE`, GANG, 1.2, 4);
      }),
      bus.on('entity:downed', (e) => {
        const vt = teamOf(e.id);
        if (vt < 0) return;
        const kt = teamOf(e.by);
        this.#feedLine(`<span class="dn"><span style="color:${this.col(kt)}">${who(e.by)}</span> ◆ <span style="color:${this.col(vt)}">${who(e.id)}</span></span>`);
        if (e.by === player.id && e.id !== player.id && kt !== vt && vt !== CIVILIAN) this.#confirm(`DOWNED ${name(e.id).toUpperCase()}`, true);
      }),
      bus.on('mode:point', (e) => {
        const p = session.mode.points[e.point];
        if (e.owner === this.team) this.banner(`${p.name} CAPTURED`, US);
        else if (e.from === this.team) this.banner(`${p.name} LOST`, THEM);
      }),
      bus.on('mode:sector', (e) => {
        const letter = String.fromCharCode(64 + e.sector);
        this.banner(e.team === this.team ? `SECTOR ${letter} TAKEN · THE LINE MOVES UP` : `SECTOR ${letter} LOST · FALL BACK`, e.team === this.team ? US : THEM, 3);
      }),
      bus.on('squad:whistle', (e) => {
        const p = player.movement.state.position, near = Math.hypot(e.x - p.x, e.z - p.z) < 160;
        if (e.team === this.team && (near || e.squads.includes(player.squad?.id))) this.banner('WHISTLES · OVER THE TOP!', US, 2.5);
        else if (e.team !== this.team && near) this.banner('ENEMY WHISTLES · THEY ARE COMING OVER', THEM, 2.5);
      }),
      bus.on('fort:dig', (e) => { if (e.id === player.id) this.dig = { stage: e.stage, k: e.progress, t: this.time }; }),
      bus.on('fort:built', (e) => { const p = player.movement.state.position; if (e.team === this.team && Math.hypot(e.x - p.x, e.z - p.z) < 3) this.dig = { stage: -1, kind: e.kind, t: this.time }; }),
      bus.on('artillery:impact', (e) => { this.impacts.push({ x: e.point[0], z: e.point[2], t: this.time }); if (this.impacts.length > 60) this.impacts.shift(); }),
      bus.on('support:prep', (e) => { if (e.team === this.team) this.#say('prep', 'ARTILLERY PREPARATION · STAND BY FOR THE WHISTLE', US, 2.5, 25); }),
      bus.on('logistics:short', (e) => { if (e.team === this.team) this.#say(`short:${e.what}`, `FRONT SHORT OF ${SHORT[e.what] ?? 'SUPPLIES'} · RUN THE TRUCKS`, AMBER, 2, 30); }),
      bus.on('logistics:moved', (e) => { if (e.team === this.team) this.banner(e.advanced ? 'FORWARD DEPOT MOVED UP' : 'FORWARD DEPOT OVERRUN · FALL BACK', e.advanced ? US : THEM, 2.2); }),
      bus.on('mode:victory', (e) => this.banner(e.team === this.team ? `VICTORY · ${e.reason.toUpperCase()}` : `DEFEAT · ${e.reason.toUpperCase()}`, e.team === this.team ? US : THEM, 999)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  /** The letterbox each bar covers (the options can turn it off): the HUD stays inside it. */
  setLetterbox(f) { this.root.style.setProperty('--lb', `${(f * 100).toFixed(2)}vh`); }

  /** A team's colour as you see it: yours blue, theirs red, the city's people grey, its gangs orange. */
  col(team) {
    if (team === this.team) return US;
    if (team === CIVILIAN) return CIV;
    if (team === BANDIT) return GANG;
    return team === 0 || team === 1 ? THEM : NEUTRAL;
  }

  #set(el, html) { if (this.html.get(el) !== html) { this.html.set(el, html); el.innerHTML = html; } }

  #feedLine(html) {
    this.feed.unshift({ html, t: this.time });
    this.feed.length = Math.min(this.feed.length, 6);
  }

  /** A banner at most once every `every` seconds per kind. */
  #say(kind, text, color, seconds, every) {
    if (this.time - (this.saidAt.get(kind) ?? -1e9) < every) return;
    this.saidAt.set(kind, this.time);
    this.banner(text, color, seconds);
  }

  /** A kill (or a down) of yours, over the crosshair for a moment. */
  #confirm(text, down) {
    this.el.kill.textContent = text; this.el.kill.className = down ? 'dn' : '';
    this.el.kill.style.opacity = 1;
    this.killUntil = this.time + (down ? 1.2 : 1.8);
  }

  banner(text, color, seconds = 2) {
    this.el.banner.textContent = text; this.el.banner.style.color = color; this.el.banner.style.opacity = 1;
    this.bannerUntil = this.time + seconds;
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {object} view  { firstPerson }
   */
  update(dt, camera, view = {}) {
    this.time += dt;
    const s = this.s, mode = s.mode, me = this.player, team = this.team;
    // ---- a gang's turf: said once as you walk into it (they shoot whoever comes in)
    if (s.neutrals?.gangs.length) {
      const p = me.movement.state.position;
      const turf = s.neutrals.gangs.find((g) => Math.hypot(g.x - p.x, g.z - p.z) < g.r && g.members.some((m) => !m.health.dead)) ?? null;
      if (turf && turf !== this.turf && !me.health.dead) this.banner(`${turf.name.toUpperCase()} TURF · THEY SHOOT ON SIGHT`, GANG, 2.5);
      this.turf = turf;
    }
    this.#top(mode);
    const sq = me.squad, mp = me.movement.state.position;
    // The view's yaw (the camera looks down its -z: forward = (-sin yaw, -cos yaw)).
    camera.updateMatrixWorld();
    const camYaw = Math.atan2(camera.matrixWorld.elements[8], camera.matrixWorld.elements[10]);
    this.#compass(mode, sq, mp, camYaw);
    // ---- point markers
    const w = innerWidth, h = innerHeight;
    for (const [i, el] of this.markers.entries()) {
      const p = mode.points[i];
      const live = mode.capturable(p);
      el.style.display = live ? 'block' : 'none';
      if (!live) continue;
      _v.copy(p.pos); _v.y += 4;
      const dist = _v.distanceTo(camera.position);
      _v.project(camera);
      let x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      const behind = _v.z > 1;
      if (behind) { x = w - x; y = h - 30; }
      x = Math.min(w - 30, Math.max(30, x)); y = Math.min(h - 30, Math.max(60, y));
      el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
      el.style.color = p.owner >= 0 ? this.col(p.owner) : NEUTRAL;
      el.classList.toggle('contested', p.contested);
      const mine = sq?.objective === p.id;
      el.firstChild.textContent = mine ? (sq.role === 'attack' ? 'ATTACK' : 'DEFEND') : '';
      // Capture progress: + is team 0's.
      const k = Math.abs(p.progress), by = p.progress >= 0 ? 0 : 1;
      el.querySelector('u').style.background = k > 0.01 ? `conic-gradient(${this.col(by)} ${(k * 360).toFixed(0)}deg, transparent 0)` : 'none';
      el.lastChild.textContent = `${dist.toFixed(0)}m`;
    }
    // ---- minimap
    this.#minimap(camYaw);
    // ---- reticles: camera centre, and where the gun really points
    const wc = me.weapons, gunMode = me.mode === 'gun' && !me.health.dead && !me.health.downed && !me.vehicle && !view.scoped;   // (a scope has its own reticle)
    this.el.reticle.style.display = this.el.gun.style.display = gunMode ? 'block' : 'none';
    if (gunMode) {
      const cy = Math.cos(wc.aimYaw), sy = Math.sin(wc.aimYaw), cp = Math.cos(wc.aimPitch), sp = Math.sin(wc.aimPitch);
      _v.set(mp.x - sy * cp * 60, mp.y + 1.5 + sp * 60, mp.z - cy * cp * 60).project(camera);
      if (_v.z < 1) this.el.gun.style.transform = `translate(${((_v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-_v.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    }
    this.#status(me, s);
    this.#weapon(me, view);
    this.#set(this.el.feed, this.feed.filter((k) => this.time - k.t < 8).map((k) => k.html).join('<br>'));
    // ---- respawn, downed, revives and banners
    const hp = me.health, dead = hp.dead && mode.winner < 0, rv = s.world.revives;
    this.el.respawn.style.display = dead || hp.downed ? 'block' : 'none';
    if (dead) {
      const wait = Math.max(0, me.respawnAt - s.time);
      this.#set(this.el.respawn, wait > 0 ? `REINFORCEMENTS IN <b>${wait.toFixed(1)}</b>` : 'PRESS <b>SPACE</b> TO DEPLOY');
    } else if (hp.downed) {
      const helper = rv.reviverOf(me.id), job = helper && rv.jobOf(helper.id);
      let near = Infinity, medic = false;
      for (const f of s.fighters) if (f !== me && f.team === team && f.health.up) { const d = f.movement.state.position.distanceTo(mp); if (d < near) { near = d; medic = rv.isMedic(f); } }
      this.#set(this.el.respawn, job
        ? `<span style="color:#7fffb0">BEING REVIVED</span> ${bar(job.t / job.need, '#7fffb0')}`
        : `<span style="color:${THEM}">DOWNED</span> · BLEEDING OUT <b>${Math.max(0, hp.bleed).toFixed(0)}</b>S<br><small>${near < 60 ? `${medic ? 'medic' : 'teammate'} ${near.toFixed(0)} m · ` : 'nobody close · '}hold <b>SPACE</b> to give up</small>`);
    }
    const myJob = rv.jobOf(me.id), patient = !hp.downed && !hp.dead && !myJob ? rv.patientFor?.(me) : null;
    const D = this.dig && this.time - this.dig.t < 0.25 ? this.dig : this.dig?.stage === -1 && this.time - this.dig.t < 1.5 ? this.dig : null;
    const sup = s.world.support, fixing = me.repairing?.target;
    const fin = me.reviveJob?.finish ? me.reviveJob : null, victim = !fin && !patient && !myJob && !hp.downed && !hp.dead ? rv.victimFor?.(me) : null;
    // Under something coming down (a tower going, a house front): get clear.
    const ST = s.world.structures, at = me.movement.state.position;
    const under = !hp.dead && ST?.falling.length && ST.dangerAt(at.x, at.z, (this.clear ??= { x: 0, z: 0, set(x, y, z) { this.x = x; this.z = z; return this; } }));
    this.#set(this.el.prompt, under ? `<span style="color:${THEM}">IT'S COMING DOWN</span> · GET CLEAR`
      : myJob ? `REVIVING ${bar(myJob.t / myJob.need, '#7fffb0')}`
      : fin ? `<span style="color:${THEM}">FINISHING</span> ${bar(fin.t / fin.need, THEM)}`
      : victim ? `HOLD <b>X</b> TO FINISH ${(victim.name ?? '').toUpperCase()}`
      : fixing ? `REPAIRING ${bar(fixing.health.hp / fixing.health.max, '#9fd3ff')}`
      : D ? (D.stage === -1 ? `${D.kind === 'foxhole' ? 'FOXHOLE DUG' : D.kind === 'sandbags' ? 'SANDBAGS UP' : 'TRENCH CUT'}` : `${['DIGGING A FOXHOLE', 'FILLING SANDBAGS', 'DIGGING A TRENCH'][D.stage]} ${bar(D.k, '#d9b77a')}`)
      : patient ? `HOLD <b>X</b> TO REVIVE ${patient.name ?? ''}${this.#stimPrompt(me, sup) ? ' · <b>3</b> STIM' : ''}`
      : this.#repairPrompt(me, sup) || this.#stimPrompt(me, sup) || this.#boardPrompt(me) || this.#coverPrompt(me));
    this.#mindread(me, camera, w, h);
    this.#squad(me);
    this.#supply();
    this.el.suppress.style.opacity = Math.min(1, (me.suppression ?? 0) * 1.1).toFixed(2);
    this.#downMarkers(camera, w, h);
    this.#foeMarkers(camera, w, h);
    if (this.time > this.bannerUntil) this.el.banner.style.opacity = 0;
    if (this.time > (this.killUntil ?? 0) && this.el.kill.style.opacity !== '0') this.el.kill.style.opacity = 0;
    // Dead: ELIMINATED, and who did it, until you deploy again.
    const deadNow = hp.dead && mode.winner < 0;
    if (deadNow !== this.deadShown) {
      this.deadShown = deadNow;
      this.el.dead.classList.toggle('show', deadNow);
      if (deadNow) { this.el.dead.lastChild.textContent = this.killedBy ?? ''; this.el.kill.style.opacity = 0; }
    }
  }

  // ---------------------------------------------------------------- top: score, sectors, clock
  #top(mode) {
    const us = this.team === 1 ? 1 : 0, them = 1 - us, max = Math.max(mode.cfg.tickets, mode.tickets[0], mode.tickets[1]);
    this.#set(this.el.sc0, `${mode.tickets[us]}`);
    this.#set(this.el.sc1, `${mode.tickets[them]}`);
    this.el.tb0.style.width = `${((mode.tickets[us] / max) * 100).toFixed(1)}%`;
    this.el.tb1.style.width = `${((mode.tickets[them] / max) * 100).toFixed(1)}%`;
    const left = Math.max(0, mode.cfg.timeLimit - mode.time);
    this.#set(this.el.clock, `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
    // The sectors from your HQ (left) to theirs.
    this.el.strip.classList.toggle('many', mode.sectors.length > 9);   // the Extreme Warfront's thirteen sectors
    const order = mode.sectors.map((_, i) => i);
    if (us === 1) order.reverse();
    this.#set(this.el.strip, order.map((i) => {
      const sec = mode.sectors[i];
      const side = sec.owner === this.team ? 'us' : sec.owner >= 0 ? 'them' : '';
      const attacked = mode.isAttacked(i), fall = Math.max(...sec.secure) / mode.cfg.secureTime;
      const label = sec.kind === 'hq' ? 'HQ' : String.fromCharCode(64 + i);
      const front = mode.front[0] === i || mode.front[1] === i;
      const by = sec.secure[0] >= sec.secure[1] ? 0 : 1;
      return `<div class="pt ${side} ${attacked ? 'hot' : ''} ${sec.kind === 'hq' ? 'hq' : ''}">${label}${front ? `<em style="color:${this.col(mode.front[0] === i ? 0 : 1)}">◆</em>` : ''}${fall > 0.01 ? `<u style="background:conic-gradient(${this.col(by)} ${(fall * 360).toFixed(0)}deg, transparent 0)"></u>` : ''}</div>`;
    }).join(''));
  }

  // ---------------------------------------------------------------- compass
  #buildCompass() {
    const k = COMPASS_W / COMPASS_SPAN, parts = [];
    for (let d = -180; d <= 540; d += 15) {
      const deg = ((d % 360) + 360) % 360, x = (d * k).toFixed(1);
      if (HEADINGS[deg]) parts.push(`<span style="left:${x}px">${HEADINGS[deg]}</span>`);
      else parts.push(`<span class="n" style="left:${x}px">${deg}</span>`);
      parts.push(`<span class="t" style="left:${x}px;transform:none"></span>`);
    }
    this.el.compass.firstChild.innerHTML = parts.join('');
    this.compassMarks = [];
  }

  #compass(mode, sq, mp, yaw) {
    const k = COMPASS_W / COMPASS_SPAN, hd = headingOfYaw(yaw);
    const h0 = ((hd % 360) + 360) % 360;
    this.el.compass.firstChild.style.transform = `translateX(${(COMPASS_W / 2 - h0 * k).toFixed(1)}px)`;
    let n = 0;
    const mark = (p, mine) => {
      const rel = wrap180(headingOf(p.pos.x - mp.x, p.pos.z - mp.z) - hd);
      if (Math.abs(rel) > COMPASS_SPAN / 2 - 6) return;
      const el = this.compassMarks[n] ?? this.el.compass.appendChild(Object.assign(document.createElement('div'), { className: 'mk' }));
      this.compassMarks[n++] = el;
      el.style.display = 'grid';
      el.style.left = `${(COMPASS_W / 2 + rel * k).toFixed(1)}px`;
      el.style.color = p.owner >= 0 ? this.col(p.owner) : NEUTRAL;
      el.classList.toggle('obj', mine);
      if (el.textContent !== p.name) el.textContent = p.name;
    };
    for (const p of mode.points) if (mode.capturable(p)) mark(p, sq?.objective === p.id);
    // Your squad holding a stretch of the front: that lane on the compass too.
    const lane = sq ? this.s.commanders?.[sq.team]?.lanes?.get(sq.objective) : null;
    if (lane) mark(lane, true);
    for (let i = n; i < this.compassMarks.length; i++) this.compassMarks[i].style.display = 'none';
  }

  // ---------------------------------------------------------------- bottom left: you
  #status(me, s) {
    const hp = me.health, st = me.movement.state;
    // Built once: the armour doll, the readout, the segments; then only what changed is written.
    if (!this.st) {
      this.el.status.innerHTML = `<svg class="doll" viewBox="0 0 60 120">${DOLL}</svg><div class="col"><div class="arm"><span class="lbl">ARMOUR</span><span class="pct"></span></div>`
        + `<div class="seg">${'<i></i>'.repeat(10)}</div><div class="sh"></div><div class="stn"></div><div class="thin"><i></i></div><div class="kit"></div></div>`;
      const q = (c) => this.el.status.querySelector(c);
      this.st = { tone: null, pct: q('.pct'), seg: [...q('.seg').children], sh: q('.sh'), stn: q('.stn'), stam: q('.thin i'), kit: q('.kit'), lit: -1 };
    }
    const S = this.st, k = Math.max(0, hp.hp / hp.max);
    const tone = k < 0.3 || hp.downed ? 'low' : k < 0.6 ? 'mid' : '';
    if (S.tone !== tone) { this.el.status.className = tone; S.tone = tone; }
    this.#set(S.pct, `${Math.ceil(k * 100)}%`);
    const lit = Math.round(k * 20);                   // in half segments
    if (lit !== S.lit) { S.lit = lit; S.seg.forEach((e, i) => { e.className = lit >= (i + 1) * 2 ? 'on' : lit === i * 2 + 1 ? 'part' : ''; }); }
    this.#set(S.sh, hp.maxShield ? `<div class="thin"><i style="width:${(hp.shield / hp.maxShield * 100).toFixed(0)}%;background:#7fe7ff"></i></div>` : '');
    this.#set(S.stn, hp.downed ? 'DOWNED' : me.vehicle ? 'IN VEHICLE' : st.mode === 'slide' ? 'SLIDE' : st.mode === 'dive' ? 'DIVE' : st.mode === 'air' ? 'AIRBORNE'
      : st.mode === 'mantle' ? 'CLIMB' : st.sprinting ? 'SPRINT' : st.stance.toUpperCase());
    const w = `${st.stamina.toFixed(0)}%`, c = st.exhausted ? '#ff6b6b' : '#c8d47a';
    if (S.stam.style.width !== w) S.stam.style.width = w;
    if (S.stamC !== c) { S.stamC = c; S.stam.style.background = c; }
    const bp = s.bp ? `<span class="bp">★ ${s.bp.points(me)} BP</span>` : '';
    this.#set(S.kit, [this.#kit(me), bp].filter(Boolean).join(' · '));
  }

  /** Your class passive and your items (stims, ammo packs). */
  #kit(me) {
    const P = me.passive ? this.s.world.passives.defs[me.passive]?.name : null, I = me.items;
    if (!P && !I) return '';
    const items = I ? `${I.kind === 'stim' ? 'STIMS' : 'AMMO PACKS'} ${'✚'.repeat(I.left)}${'·'.repeat(Math.max(0, I.max - I.left))} [3]` : '';
    return `${P ? P.toUpperCase() : ''}${P && I ? ' · ' : ''}${items}`;
  }

  // ---------------------------------------------------------------- bottom right: the gun
  #weapon(me, view) {
    const w = me.weapons, cw = w.current, st = me.movement.state;
    const pov = `<div class="pov">${view.firstPerson ? '1ST' : '3RD'} PERSON [V]</div>`;
    const g = me.abilities?.slots?.grenade, nades = g ? Math.max(1, g.maxCharges ?? g.def?.charges ?? 1) : 0;
    const gren = g ? `<div class="sec"><span class="key">[G]</span><span class="gr"><b>${g.charges > 0 ? 'GRENADES READY' : 'GRENADES OUT'}</b>${Array.from({ length: nades }, (_, i) => `<i class="${i < g.charges ? '' : 'e'}"></i>`).join('')}</span></div>` : '';
    if (me.mode !== 'gun') {
      const m = me.melee;
      this.#set(this.el.weapon, `<div class="top"><span class="wn">${(m.w.name ?? 'SWORD').toUpperCase()}</span><span class="fm">BLADE</span></div><div class="mid"><svg class="gun" viewBox="0 0 160 50">${GUN_ICON.blade}</svg><div class="am">${m.heat.toFixed(0)}<small>HEAT</small></div></div>${pov}${gren}`);
      return;
    }
    if (!cw) { this.#set(this.el.weapon, `${pov}${gren}`); return; }
    const per = cw.s.mag ?? 30;
    let big, small, cls = '', frac;
    if (cw.usesHeat) { big = `${cw.heat.toFixed(0)}`; small = '% HEAT'; cls = cw.heat > 80 ? 'low' : ''; frac = 1 - cw.heat / 100; }
    else if (cw.usesBattery) { big = `${cw.battery.toFixed(0)}`; small = '%'; cls = cw.battery < 20 ? 'low' : ''; frac = cw.battery / 100; }
    else { big = cw.magOut ? '--' : `${cw.mag}`; small = `${cw.reserve}`; cls = cw.mag === 0 ? 'out' : cw.mag <= per * 0.25 ? 'low' : ''; frac = cw.magOut ? 0 : cw.mag / per; }
    const reloading = w.phase === 'reloading' ? `<div class="rl">${st.sprinting ? 'RELOAD HELD' : `RELOADING ${Math.min(99, Math.round((w.phaseTime / Math.max(0.01, w.phaseDuration)) * 100))}%`}</div>` : '';
    const icon = GUN_ICON[ICON_OF[cw.s.archetype] ?? (cw.usesHeat || cw.usesBattery ? 'energy' : 'rifle')];
    this.#set(this.el.weapon, `<div class="top"><span class="wn">${(cw.s.name ?? '').toUpperCase()}</span><span class="fm">${FIRE_MODE[cw.s.fireMode] ?? 'AUTO'}</span></div>`
      + `<div class="mid"><svg class="gun" viewBox="0 0 160 50">${icon}</svg><div class="am ${cls}">${big}<small>${small}</small></div></div>`
      + `<div class="mb ${cls ? 'low' : ''}"><i style="width:${(Math.max(0, Math.min(1, frac)) * 100).toFixed(0)}%"></i></div>${reloading}${pov}${gren}`);
  }

  /** A medic with stims facing a hurt or downed teammate in reach. */
  #stimPrompt(me, sup) {
    if (me.items?.kind !== 'stim' || me.items.left <= 0 || !me.health.up || me.vehicle) return '';
    const t = sup.stimTarget(me, me.movement.state.yaw);
    return t ? `<b>3</b> STIM ${(t.name ?? '').toUpperCase()}${t.health.downed ? ' (UP IN 1 S)' : ''}` : '';
  }

  /** An engineer beside a damaged friendly vehicle or turret. */
  #repairPrompt(me, sup) {
    if (!sup.data?.repair?.roles.includes(me.role) || !me.health.up || me.vehicle) return '';
    const t = sup.repairTarget(me);
    return t ? `HOLD <b>H</b> TO REPAIR THE ${(t.def?.name ?? t.kind ?? 'turret').toUpperCase()} ${bar(t.health.hp / t.health.max, '#9fd3ff')}` : '';
  }

  /** Mindread: the abilities of the enemy you've held in your sights, beside him on screen. */
  #mindread(me, camera, w, h) {
    const M = me.mindread, el = this.el.mind;
    const t = M && M.until > this.s.world.passives.time ? this.s.world.entity(M.id) : null;
    if (!t || t.health?.dead || !t.abilities) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
    _v.copy(t.movement.state.position); _v.y += 2.3; _v.project(camera);
    if (_v.z > 1) { el.style.display = 'none'; return; }
    const keys = { ability1: 'Q', ability2: 'E', grenade: 'G' };
    const parts = Object.entries(keys).filter(([k]) => t.abilities.slots[k]).map(([k, key]) => { const s = t.abilities.slots[k]; return `${key} ${s.charges > 0 ? '<b style="color:#7fffb0">READY</b>' : `${Math.ceil(s.cooldown)}s`}`; });
    const sup = Math.round((t.abilities.superEnergy / Math.max(1, t.abilities.superCost)) * 100);
    parts.push(`SUPER ${sup >= 100 ? `<b style="color:${THEM}">READY</b>` : `${sup}%`}`);
    el.style.cssText = `position:absolute;left:${((_v.x * 0.5 + 0.5) * w).toFixed(0)}px;top:${((-_v.y * 0.5 + 0.5) * h).toFixed(0)}px;transform:translate(-50%,-100%);font:700 13px var(--text);color:#c9b6ff;white-space:nowrap;pointer-events:none;letter-spacing:.05em`;
    el.innerHTML = `${(t.name ?? '').toUpperCase()} · ${parts.join(' · ')}`;
  }

  /**
   * "X: crew the Sunhammer Field Gun" beside a vehicle you could take; "HOLD X" beside one of our
   * cars on its roof (with how far over it is); in a car, its controls.
   */
  /** Cover: offered when you're up against something to take it behind; in it, how to come out. */
  #coverPrompt(me) {
    const s = me.movement.state;
    if (me.health.dead || me.health.downed || me.vehicle) return '';
    if (s.mode === 'cover') return s.cover.out > 0.3 ? '' : `IN COVER · <b>RMB</b> ${s.cover.high ? 'AIM ROUND THE CORNER' : 'AIM OVER'} · <b>T</b> LEAVE`;
    if ((this.coverAsk = (this.coverAsk ?? 0) + 1) % 6) return this.coverWas ?? '';   // (asked every 6th frame)
    const c = s.speed < 4.5 ? me.movement.coverHere?.() : null;
    return (this.coverWas = c && c.d < 1.4 ? `<b>T</b> TAKE COVER` : '');
  }

  #boardPrompt(me) {
    if (me.health.dead || me.health.downed) return '';
    if (me.vehicle) {
      const v = me.vehicle.veh, role = v.seats[me.vehicle.seat].def.role;
      if (!v.car) return '';
      if (v.wreck) return `<span style="color:${THEM}">ON FIRE: GET OUT</span> · <b>X</b>`;
      return role === 'driver' ? '<b>W S</b> DRIVE · <b>A D</b> STEER · <b>SPACE</b> HANDBRAKE · <b>X</b> GET OUT' : '<b>X</b> GET OUT (AT SPEED YOU TUMBLE)';
    }
    const flipped = this.s.world.vehicles.flippedNear(me);
    if (flipped) {
      const k = me.righting?.car === flipped ? me.righting.t / RIGHT_TIME : 0;
      return `HOLD <b>X</b> TO PUSH THE ${flipped.def.name.toUpperCase()} BACK OVER${k > 0 ? ` ${bar(k, '#d9b77a')}` : ''}`;
    }
    const v = this.s.world.vehicles.nearestEnterable(me);
    if (!v) return '';
    const crew = !!v.def.gun && v.def.model === 'gun';
    return `<b>X</b> ${crew ? 'CREW' : 'TAKE'} THE ${v.def.name.toUpperCase()}`;
  }

  /** Supply: the forward depot's stock (and the HQ dump's), and the trucks on the road. */
  #supply() {
    const L = this.s.logistics;
    if (!L) { this.#set(this.el.supply, ''); return; }
    if (this.supplyT && this.time - this.supplyT < 0.25) return;
    this.supplyT = this.time;
    const snap = L.snapshot(this.team), k = snap.front / snap.frontCap;
    const loaded = snap.trucks.filter((t) => t.cargo > 0).length;
    this.#set(this.el.supply, `SUPPLY <b style="color:${k < 0.1 ? THEM : '#d9b77a'}">${snap.front}</b>${bar(k, k < 0.1 ? THEM : '#d9b77a')}<br>HQ DUMP ${snap.hq} · ${snap.trucks.length} TRUCKS (${loaded} LOADED)`);
  }

  // ---------------------------------------------------------------- top left: your squad
  #squad(me) {
    const sq = me.squad;
    if (!sq || sq.members.length < 2) { this.#set(this.el.squad, ''); return; }
    if (this.squadT && this.time - this.squadT < 0.2) return;   // 5 Hz is plenty for text
    this.squadT = this.time;
    const T = sq.tactics, mode = this.s.mode, obj = sq.objective !== null && sq.objective !== undefined ? this.s.commanders?.[sq.team]?.target(sq.objective) ?? mode.points[sq.objective] : null;
    const name = (sq.callsign ?? '').toUpperCase();   // (the squads' callsigns: FrontlineCommander's)
    const now = T?.time ?? 0, recent = T ? T.losses.filter((t) => now - t < 20).length : 0;
    const morale = T?.broken ? ['BROKEN', THEM] : recent ? ['SHAKEN', AMBER] : ['CONFIDENT', '#6bd88f'];
    const phase = T?.broken ? 'FALLING BACK' : `${PHASE[T?.phase] ?? ''}${obj && /^(ADVANCING|ASSAULTING|HOLDING)$/.test(PHASE[T?.phase] ?? '') ? ` ${obj.name}` : ''}`;
    const mp = me.movement.state.position;
    const order = obj ? `ORDER: ${sq.role === 'attack' ? 'TAKE' : 'HOLD'} ${obj.name} · ${mp.distanceTo(obj.pos).toFixed(0)} M` : '';   // a lane reads HOLD LINE 3
    const leader = sq.leader;
    const row = (m) => {
      const h = m.health, o = m.brain?.order, you = m === me;
      const state = h.dead ? 'dead' : h.downed ? 'down' : '';
      const what = h.dead ? 'REDEPLOYING' : h.downed ? 'DOWN' : m.vehicle ? 'IN A VEHICLE' : you ? '' : (o?.why ?? '').toUpperCase();
      const tag = [ROLE_TAG[m.role] ?? 'TRP', what].filter(Boolean).join(' · ');
      return `<div class="m ${state}">${m === leader ? '<span class="ld">★</span>' : ''}${you ? 'YOU' : m.name}<span class="tg">${tag}</span><div class="hb"><i style="width:${h.dead ? 0 : ((h.hp / h.max) * 100).toFixed(0)}%"></i></div></div>`;
    };
    const rows = sq.members.filter((m) => m !== me).map(row).join('') + row(me);
    this.#set(this.el.squad, `<div class="cs">${name}<span class="mo" style="color:${morale[1]}">${morale[0]}</span></div><div class="st">${phase}</div>${order ? `<div class="od">${order}</div>` : ''}${rows}`);
  }

  /** Red crosses over downed teammates within 60 m (pooled DOM nodes). */
  #downMarkers(camera, w, h) {
    const me = this.player, mp = me.movement.state.position;
    let n = 0;
    for (const f of this.s.fighters) {
      if (f === me || f.team !== this.team || !f.health.downed) continue;
      const p = f.movement.state.position, d = p.distanceTo(mp);
      if (d > 60) continue;
      _v.copy(p); _v.y += 1.0; _v.project(camera);
      if (_v.z > 1) continue;
      const el = this.downMarks[n] ?? this.el.downs.appendChild(Object.assign(document.createElement('div'), { className: 'dn' }));
      this.downMarks[n++] = el;
      el.style.display = 'block';
      el.style.transform = `translate(${((_v.x * 0.5 + 0.5) * w).toFixed(0)}px, ${((-_v.y * 0.5 + 0.5) * h).toFixed(0)}px)`;
      el.innerHTML = `✚<span>${d.toFixed(0)}M · ${Math.max(0, f.health.bleed).toFixed(0)}S</span>`;
      el.classList.toggle('helped', f.health.reviving > 0);
    }
    for (let i = n; i < this.downMarks.length; i++) this.downMarks[i].style.display = 'none';
  }

  /**
   * ◆ and a name over enemies within 150 m that are marked: one a spotter revealed, an enemy
   * vehicle or gun that fired in the last 4 s (pooled DOM nodes).
   */
  #foeMarkers(camera, w, h) {
    const me = this.player, mp = me.movement.state.position, W = this.s.world;
    let n = 0;
    const mark = (p, lift, label) => {
      if (n >= 12 || p.distanceTo(mp) > 150) return;
      _v.copy(p); _v.y += lift; _v.project(camera);
      if (_v.z > 1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) return;
      const el = this.foeMarks[n] ?? this.el.foes.appendChild(Object.assign(document.createElement('div'), { className: 'fm' }));
      this.foeMarks[n++] = el;
      el.style.display = 'block';
      el.style.transform = `translate(${((_v.x * 0.5 + 0.5) * w).toFixed(0)}px, ${((-_v.y * 0.5 + 0.5) * h).toFixed(0)}px)`;
      const html = `◆ ${label}<i>▾</i>`;
      if (el.innerHTML !== html) el.innerHTML = html;
    };
    if (!me.health.dead) {
      for (const f of this.s.fighters) {
        if (f.team === this.team || f.team > 1 || f.health.dead || f.vehicle || !f.status?.has('revealed')) continue;
        mark(f.movement.state.position, 2.2, (f.name ?? '').toUpperCase());
      }
      for (const v of W.vehicles.list) {
        if (v.removed || v.wreck || v.team === this.team || v.team < 0) continue;
        if (this.time - (this.spotted.get(v.id) ?? -99) > 4 && !v.seats?.some((st) => st.occupant && this.time - (this.spotted.get(st.occupant.id) ?? -99) < 4)) continue;
        mark(v.movement.state.position, (v.def.height ?? 2.5) + 0.8, (v.def.short ?? v.def.name ?? 'VEHICLE').toUpperCase());
      }
    }
    for (let i = n; i < this.foeMarks.length; i++) this.foeMarks[i].style.display = 'none';
  }

  // ---------------------------------------------------------------- the round minimap
  /** The map's walls and buildings seen from above, drawn once (the minimap turns and moves it). */
  #footprints(map) {
    const b = map.bounds, W = b.maxX - b.minX, H = b.maxZ - b.minZ;
    const ppm = Math.min(2, 4096 / Math.max(W, H));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(W * ppm)); cv.height = Math.max(1, Math.ceil(H * ppm));
    const c = cv.getContext('2d');
    for (const box of map.cover?.list ?? []) {
      const ht = box.max.y - box.min.y;
      if (ht < 0.9) continue;
      c.fillStyle = ht > 6 ? '#b4c2dc80' : ht > 2.4 ? '#b4c2dc5c' : '#b4c2dc40';
      c.fillRect((box.min.x - b.minX) * ppm, (box.min.z - b.minZ) * ppm, Math.max(1, (box.max.x - box.min.x) * ppm), Math.max(1, (box.max.z - box.min.z) * ppm));
    }
    return { canvas: cv, ppm };
  }

  #minimap(camYaw) {
    const c = this.ctx, s = this.s, mode = s.mode, b = s.map.bounds;
    const W = c.canvas.width, R = W / 2, k = R / MAP_RANGE;   // px per m
    const me = this.player, mp = me.movement.state.position;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#0b0e16c8'; c.fillRect(0, 0, W, W);
    // World → map: you at the centre, heading up.
    c.translate(R, R); c.rotate(camYaw); c.scale(k, k); c.translate(-mp.x, -mp.z);
    for (const sec of s.map.sectors) {
      const owner = mode.sectors[sec.index].owner;
      if (owner < 0) continue;
      c.fillStyle = owner === this.team ? '#5ab4ff14' : '#ff4d4d14';
      c.fillRect(sec.x0, b.minZ, sec.x1 - sec.x0, b.maxZ - b.minZ);
    }
    const F = this.footprints;
    c.drawImage(F.canvas, b.minX, b.minZ, F.canvas.width / F.ppm, F.canvas.height / F.ppm);
    for (const sec of s.map.sectors) {
      c.strokeStyle = mode.isAttacked(sec.index) ? '#ffffff40' : '#ffffff14'; c.lineWidth = 1 / k;
      c.beginPath(); c.moveTo(sec.x0, b.minZ); c.lineTo(sec.x0, b.maxZ); c.stroke();
    }
    c.restore();
    // Things at fixed size, placed by where they are.
    const cs = Math.cos(camYaw), sn = Math.sin(camYaw);
    const at = (x, z) => { const dx = (x - mp.x) * k, dz = (z - mp.z) * k; return [R + dx * cs - dz * sn, R + dx * sn + dz * cs]; };
    const inside = (px, py, m = 4) => (px - R) ** 2 + (py - R) ** 2 < (R - m) ** 2;
    c.save();
    c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.clip();
    // The supply war: our depots, guns and trucks; enemy guns we've located; rounds landing.
    const L = s.logistics;
    if (L) {
      for (const d of L.depots) {
        if (d.team !== this.team) continue;
        const [x, y] = at(d.pos.x, d.pos.z);
        c.strokeStyle = c.fillStyle = '#d9b77a';
        if (d.kind === 'front') c.fillRect(x - 5, y - 5, 10, 10); else c.strokeRect(x - 6, y - 6, 12, 12);
      }
      for (const v of s.world.vehicles.list) {
        if (v.removed || v.team !== this.team || !(v.def.gun || v.def.cargo)) continue;
        const q = v.movement.state.position, [x, y] = at(q.x, q.z);
        c.fillStyle = v.def.cargo ? '#d9b77a' : US;
        if (v.def.cargo) c.fillRect(x - 4, y - 2, 8, 4);
        else { c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x + 5, y + 4); c.lineTo(x - 5, y + 4); c.closePath(); c.fill(); }
      }
      c.strokeStyle = THEM; c.lineWidth = 2.5;
      for (const [id, g] of s.support?.[this.team]?.enemyGuns ?? []) {
        const v = s.world.entity(id);
        if (!v || v.removed || g.shots < 2) continue;
        const q = v.movement.state.position, [x, y] = at(q.x, q.z);
        c.beginPath(); c.moveTo(x - 6, y - 6); c.lineTo(x + 6, y + 6); c.moveTo(x + 6, y - 6); c.lineTo(x - 6, y + 6); c.stroke();
      }
      c.lineWidth = 1;
    }
    for (const im of this.impacts) {
      const age = this.time - im.t;
      if (age > 1.5) continue;
      const [x, y] = at(im.x, im.z);
      c.strokeStyle = `rgba(255,150,70,${(1 - age / 1.5).toFixed(2)})`; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 4 + age * 12, 0, Math.PI * 2); c.stroke();
    }
    c.lineWidth = 1;
    // People: allies, downed allies, enemies that gave themselves away, civilians near you.
    for (const f of s.fighters) {
      if (f.health.dead || f === me) continue;
      const ally = f.team === this.team, p = f.movement.state.position;
      const [x, y] = at(p.x, p.z);
      if (!inside(x, y)) continue;
      if (f.team === CIVILIAN) {
        const hostile = civilianEngaging(s.world, f, this.team);
        c.fillStyle = hostile ? THEM : '#cfd4dc88';
        c.fillRect(x - 2, y - 2, 4, 4);
        continue;
      }
      const marked = !ally && f.status?.has('revealed');           // a spotter's mark: shown while it lasts
      if (!ally && !marked && this.time - (this.spotted.get(f.id) ?? -99) > 2) continue;
      if (marked) { c.strokeStyle = THEM; c.lineWidth = 1.5; c.strokeRect(x - 5, y - 5, 10, 10); }
      if (ally && f.health.downed) {
        c.fillStyle = THEM;
        c.fillRect(x - 5, y - 1.5, 10, 3); c.fillRect(x - 1.5, y - 5, 3, 10);
        continue;
      }
      c.fillStyle = ally ? US : f.team === BANDIT ? GANG : THEM;
      c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill();
    }
    // Capture points: a circle with the point's name, pinned to the rim when out of range.
    c.font = '700 13px HudDisplay, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const p of mode.points) {
      let [x, y] = at(p.pos.x, p.pos.z);
      const dx = x - R, dy = y - R, d = Math.hypot(dx, dy), max = R - 16;
      if (d > max) { x = R + (dx / d) * max; y = R + (dy / d) * max; }
      const col = p.owner >= 0 ? this.col(p.owner) : NEUTRAL;
      c.globalAlpha = mode.capturable(p) ? 1 : 0.45;
      c.fillStyle = '#0b0d14d0'; c.strokeStyle = col; c.lineWidth = 2.5;
      c.beginPath(); c.arc(x, y, 12, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = col; c.fillText(p.name, x, y + 1);
    }
    c.globalAlpha = 1;
    c.restore();
    // You: an arrow at the centre, pointing where you look; the rim and north on it.
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(R, R - 10); c.lineTo(R + 7, R + 8); c.lineTo(R, R + 4); c.lineTo(R - 7, R + 8); c.closePath(); c.fill();
    c.strokeStyle = '#ffffff40'; c.lineWidth = 2;
    c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.stroke();
    // North (-z) on the rim, turned with the map.
    const qx = R + sn * (R - 16), qy = R - cs * (R - 16);
    c.fillStyle = '#0b0d14'; c.beginPath(); c.arc(qx, qy, 11, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#eef2f8'; c.font = '800 14px HudDisplay, sans-serif'; c.fillText('N', qx, qy + 1);
  }
}
