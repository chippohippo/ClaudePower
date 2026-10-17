// Frontline: a Battlefront-style battle against bots, on a map built for the match size.
// URL: ?size=4v4|12v12|32v32|64v64|200v200 (or ?players=N) &seed=N &class=dawnblade &team=0|1 &difficulty=recruit|veteran|elite
//      &planet=scorched (data/art/palette.json) &fx=low|off (post-processing quality)
//
// Client loop: input → FrontlineSession (fixed 60 Hz, the same sim the tests run) → animation
// (rigs, LOD) → HD2 camera → instanced crowd, battlefield, tracers, stratagems → post-processing
// (god rays, bloom, grade) → HUD and audio. The look is the art direction's (docs/ART_DIRECTION.md):
// the planet preset's sky, sun, fog and ground, troopers in their role's kit and faction's paint.

import * as THREE from 'three';
import { bus } from './core/EventBus.js';
import { FixedLoop } from './core/FixedLoop.js';
import { InputManager } from './input/InputManager.js';
import { CameraRig } from './camera/CameraRig.js';
import { FrontlineSession } from './game/FrontlineSession.js';
import { AnimationSystem } from './anim/AnimationSystem.js';
import { CrowdRenderer } from './render/CrowdRenderer.js';
import { BattlefieldRenderer } from './render/BattlefieldRenderer.js';
import { TracerPool } from './render/TracerPool.js';
import { VehicleViews } from './vfx/VehicleViews.js';
import { ZoneDeployableViews } from './vfx/ZoneDeployableViews.js';
import { StratagemViews } from './vfx/StratagemViews.js';
import { StratagemPanel } from './ui/StratagemPanel.js';
import { HitFeedback } from './ui/HitFeedback.js';
import { BattlePointsHud } from './ui/BattlePointsHud.js';
import { MeleeTells } from './ui/MeleeTells.js';
import { GunFx } from './vfx/GunFx.js';
import { AudioDirector, SynthBackend } from './audio/AudioDirector.js';
import { FrontlineHud } from './ui/FrontlineHud.js';
import { FireControl } from './ui/FireControl.js';
import { BattleFx } from './vfx/BattleFx.js';
import { silhouetteScale } from './movement/Hitboxes.js';
import { Atmosphere, installFog } from './render/Atmosphere.js';
import { PostFX } from './render/PostFX.js';
import { kitFor } from './render/TrooperKit.js';

const params = new URLSearchParams(location.search);
const sizeParam = params.get('size'), playersParam = params.get('players');
const requestedPlayers = playersParam ? Math.max(8, Math.min(400, +playersParam)) : null;
const seed = +(params.get('seed') ?? 7);
const myTeam = +(params.get('team') ?? 0) === 1 ? 1 : 0;

const load = (p) => fetch(`./data/${p}`).then((r) => r.json());
const [movement, melee, ballistic, energy, attachments, recoil, damage, statuses, solariKits, voidKits, supers, vehicles, solari, voidC, ai, humanoid, down, palette, trooperKits, rules, stratagems, battlePoints, passives, support] = await Promise.all([
  load('movement.json'), load('weapons/melee.json'), load('weapons/ballistic.json'), load('weapons/energy.json'),
  load('weapons/attachments.json'), load('weapons/recoil.json'), load('damage-matrix.json'), load('abilities/statuses.json'),
  load('abilities/solari.json'), load('abilities/void.json'), load('supers.json'), load('vehicles.json'),
  load('classes/solari.json'), load('classes/void.json'), load('ai/personalities.json'), load('animation/humanoid.json'), load('down.json'),
  load('art/palette.json'), load('art/troopers.json'), load('rules.json'), load('stratagems.json'), load('battle-points.json'),
  load('passives.json'), load('support.json'),
]);
const planet = palette.planets[params.get('planet') ?? 'scorched'] ?? palette.planets.scorched;
installFog(planet);   // before any material compiles
const classes = [solari, voidC];
const myClass = params.get('class') ?? (myTeam === 0 ? 'lancer' : 'reaver');
const data = {
  movement, weaponFiles: [ballistic, energy], attachments: attachments.attachments, recoil: recoil.patterns, statuses: statuses.statuses,
  meleeWeapons: melee.weapons, kits: { ...solariKits.kits, ...voidKits.kits }, classes, damageMatrix: damage.matrix, supers, vehicleDefs: vehicles,
  personalities: ai.personalities, difficulty: ai.difficulty[params.get('difficulty') ?? 'veteran'] ?? ai.difficulty.veteran,
  down, rules, stratagems, battlePoints, passives, support, humanoid,
};
const abilityIndex = new Map();
for (const f of [solariKits, voidKits]) for (const kit of Object.values(f.kits)) for (const a of Object.values(kit)) abilityIndex.set(a.id, { ...a, family: f.soundFamily });

const PLAYER_ID = 1;
const session = new FrontlineSession(data, { size: sizeParam ?? (requestedPlayers ? null : '32v32'), players: requestedPlayers, seed, humans: [{ id: PLAYER_ID, team: myTeam, classId: myClass }] });
const { world, map, mode } = session;
const players = session.players;
document.title = `Emberfall Frontline · ${map.name} (${session.size})`;
const player = session.fighters.find((f) => f.id === PLAYER_ID);
player.name = 'You';

// ---------------------------------------------------------------- scene
const fxMode = params.get('fx') ?? 'high';
const renderer = new THREE.WebGLRenderer({ antialias: fxMode === 'off', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, fxMode === 'high' ? 1.5 : 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // for the plain path (PostFX tone-maps itself)
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
// The planet: sky dome, the low hard sun and its shadow box, height fog, the sky as fill light,
// falling ash. Then the frame: god rays, bloom, the grade (PostFX).
const atmo = new Atmosphere(scene, planet, { radius: 1100, shadowBox: 45, renderer });
const post = new PostFX(renderer, planet.post, { quality: fxMode === 'low' ? 'low' : 'high' });
post.enabled = fxMode !== 'off';
const sunScreen = new THREE.Vector3();

const battlefield = new BattlefieldRenderer(scene, map, { localTeam: myTeam, anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()), art: { planet, palette } });
const anim = new AnimationSystem(humanoid, { getEntity: (id) => world.entity(id), surfaceAt: (x, y, z) => world.surfaceAt(x, y, z), groundY: (x, z) => map.terrain.height(x, z) });
// Each fighter wears its role's kit in its army's paint, with its own stencilled number.
for (const f of session.fighters) {
  anim.add(f);
  f.look = { team: f.team, status: null, flame: new THREE.Color(), highlight: f === player, kit: kitFor(trooperKits, f.role), number: (f.id * 37 + 11) % 100 };
}
anim.focusId = PLAYER_ID;
const crowd = new CrowdRenderer(scene, { max: players + anim.maxCorpses + 8, palette });
const tracers = new TracerPool(scene, { getEntity: (id) => world.entity(id) });
const vehicleViews = new VehicleViews(scene, world, { localTeam: myTeam, far: Math.min(1100, atmo.reach), palette });
// A stratagem's sentry is drawn on its pod by StratagemViews, not as a class turret.
const zoneViews = new ZoneDeployableViews(scene, world, { localTeam: myTeam, skip: (e) => !!world.stratagems.defs[e.ability] });
const fx = new BattleFx(scene, { fog: scene.fog });
const stratViews = new StratagemViews(scene, world, { palette, fx, anim, groundY: (x, z) => map.terrain.height(x, z) });
const gunFx = new GunFx(scene, { fx, anim, world, player, palette });          // muzzles, impacts, bullet holes

const input = new InputManager(renderer.domElement);
input.yaw = myTeam === 0 ? -Math.PI / 2 : Math.PI / 2; // face the enemy's side of the map
const groundOrCover = (o, d, max) => {
  const a = world.raycastStatic(o, d, max), b = world.raycastGround(o, d, max);
  return !a ? b : !b ? a : a.distance < b.distance ? a : b;
};
const rig = new CameraRig({ raycast: groundOrCover });
rig.camera.far = 1500; rig.camera.updateProjectionMatrix();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); post.setSize(innerWidth, innerHeight); rig.camera.aspect = innerWidth / innerHeight; rig.camera.updateProjectionMatrix(); });

let audio = null;
renderer.domElement.addEventListener('mousedown', () => {
  if (audio) return;
  audio = new AudioDirector(new SynthBackend(), {
    listenerId: PLAYER_ID, abilityIndex, guns: world.vehicles.guns, strats: world.stratagems,
    getEntity: (id) => { const e = world.entity(id); return e && { team: e.team, position: e.movement.state.position, perks: e.perks }; },
  });
});

const hud = new FrontlineHud(document.getElementById('hud'), session, player);
const callIn = new StratagemPanel(document.getElementById('hud'), { world, player, colors: palette.stratagem });
const hitFx = new HitFeedback(document.getElementById('hud'), { player, rig, world });   // hit markers, damage direction, flinch
const bpHud = new BattlePointsHud(document.getElementById('hud'), { player, world });     // "+100 TAKEDOWN"
const tells = new MeleeTells(document.getElementById('hud'), { player, world });         // chevrons for swings coming at you
// Hit-stop: your melee, and your kills with a shotgun or a sniper rifle, freeze the battle for a
// few ticks (offline only; nobody else's hits stop your game).
let hitStop = 0;
for (const ev of ['melee:parry', 'melee:hit', 'melee:perfectBlock', 'melee:block']) {
  bus.on(ev, (e) => { if (e.defender === PLAYER_ID || e.attacker === PLAYER_ID) hitStop = Math.max(hitStop, Math.min(5 / 60, e.hitStop ?? 1 / 60)); });
}
bus.on('weapon:hit', (e) => { if (e.attacker === PLAYER_ID && e.killed && /^(shotgun|sniper)$/.test(player.weapons.current?.s.archetype ?? '')) hitStop = Math.max(hitStop, 2 / 60); });
const gunPanel = Object.assign(document.createElement('div'), { id: 'fl-gunpanel' });
document.getElementById('hud').appendChild(gunPanel);
const fireControl = new FireControl(scene, { world, map, el: gunPanel, aspect: innerWidth / innerHeight });
const STATUS_GLOW = {
  iframes: new THREE.Color(0.15, 0.25, 1.1), vulnerable: new THREE.Color(1.0, 0.1, 0.1), radiant: new THREE.Color(0.7, 0.45, 0.1),
  void: new THREE.Color(0.35, 0.1, 0.7), mech: new THREE.Color(0.25, 0.25, 0.25), scorch: new THREE.Color(0.5, 0.16, 0), weaken: new THREE.Color(0.22, 0.07, 0.4),
  stim: new THREE.Color(0.1, 0.55, 0.2), revealed: new THREE.Color(0.75, 0.08, 0.05),
};
const LYING = new Set(['dive', 'knockdown', 'ragdoll']);
const _yaw = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

// ---------------------------------------------------------------- loop
const loop = new FixedLoop({
  hz: 60,
  sim(dt, tick) {
    if (hitStop > 0) { hitStop -= dt; return; }        // input waits too: no press is lost
    const cmd = fireControl.command(input.sample(tick, dt), input, player);   // at a gun: the mouse moves the fire mission's mark
    if (cmd.buttons.togglePOV?.pressed) rig.togglePOV();
    if (cmd.buttons.swapShoulder?.pressed) rig.swapShoulder();
    if (cmd.buttons.toggleMelee?.pressed) player.mode = player.mode === 'sword' ? 'gun' : 'sword';
    if (player.health.dead && cmd.buttons.jump?.pressed) session.respawn(PLAYER_ID);
    session.setCommand(PLAYER_ID, cmd);
    session.focus[0] = player.movement.state.position;
    anim.snapshot();
    session.step(dt);
  },
  render(alpha) {
    const dt = 1 / 60;
    for (const f of session.fighters) {
      const s = f.movement.state, st = f.status, tf = f.transform;
      f.look.status = s.invulnerable ? STATUS_GLOW.iframes : f.melee.vulnerable ? STATUS_GLOW.vulnerable : tf ? STATUS_GLOW[tf.def.aura] ?? null
        : st.has('scorch') ? STATUS_GLOW.scorch : st.has('volatile') || st.has('weaken') ? STATUS_GLOW.weaken
        : st.has('stim') ? STATUS_GLOW.stim : f.team !== myTeam && st.has('revealed') ? STATUS_GLOW.revealed : null;   // a spotter's mark: enemies he's revealed glow for us
      f.look.flame.set(f.melee.w.visual?.flameColor ?? (f.team === 0 ? '#ff7a1a' : '#8b5cf6'));
    }
    // At an indirect-fire gun the overhead fire-control view takes over the screen.
    const view = fireControl.active ? fireControl.camera : rig.camera;
    anim.update(dt, alpha, view.position);
    const w = player.weapons, pv = player.vehicle?.veh;
    const lookYaw = input.yaw + (player.mode === 'gun' ? w.recoilYaw : 0);
    const lookPitch = Math.max(-1.45, Math.min(1.45, input.pitch + (player.mode === 'gun' ? w.recoilPitch : 0)));
    rig.update(dt, {
      target: player, pos: anim.record(PLAYER_ID).root, yaw: lookYaw, pitch: lookPitch,
      ads: player.mode === 'gun' ? w.ads : player.melee.guarding ? 0.3 : 0, adsFov: w.current?.s.ads?.fov,
      vehicle: pv ? pv.def.camera : null, scale: silhouetteScale(player),
    });
    const cam = fireControl.update(dt, player, rig.camera);
    crowd.begin(cam);
    for (const r of anim.list) {
      const f = r.e, s = f.movement.state;
      if (f.vehicle && !f.vehicle.exposed) continue;
      if (r.lod < 2) crowd.drawRig(r.h, f.look, r.lod);
      else crowd.drawImpostor(r.root, { yaw: s.bodyYaw, scale: silhouetteScale(f), height: s.stance === 'crouch' ? 1.2 : 1.8, lying: LYING.has(s.mode) || s.stance === 'prone' || s.downed || s.slide?.kind === 'belly' || f.health.dead }, f.look);
    }
    // The fallen stay where they fell after their soldier redeploys.
    for (const c of anim.corpses) {
      const d = c.root.distanceTo(rig.camera.position);
      if (d < 220) crowd.drawRig(c, c.look, d < 70 ? 0 : 1);
      else crowd.drawImpostor(c.root, { yaw: _yaw(c.j.pelvis, c.j.neck), scale: c.scale, height: 1.8, lying: true }, c.look);
    }
    crowd.end();
    const root = anim.record(PLAYER_ID).root;
    atmo.update(dt, cam, fireControl.active ? cam.position : root);
    battlefield.update(mode, session.time, cam.position);
    tracers.update(dt);
    fx.update(dt);
    zoneViews.update(dt);
    stratViews.update(dt, cam, alpha);
    gunFx.update(dt, cam);
    vehicleViews.update(dt, cam);
    post.render(scene, cam, atmo.sunScreen(cam, sunScreen), dt);
    audio?.update(dt, rig.camera.position, player.movement.state.yaw);
    hud.update(dt, cam);
    callIn.update(dt, cam);
    hitFx.update(dt, cam);
    bpHud.update(dt);
    tells.update(dt, cam);
  },
});
window.__frontline = { session, player, anim, crowd, rig, hud, renderer, scene, battlefield, loop, fx, fireControl, input, atmo, post, stratViews, callIn, gunFx, hitFx, bpHud, tells };
loop.start();
bus.emit('frontline:ready', { players, seed });
