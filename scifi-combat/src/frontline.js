// Frontline: a Battlefront-style battle against bots, on a map built for the match size.
// URL: ?size=4v4|12v12|32v32|64v64|200v200 (or ?players=N) &seed=N &class=dawnblade &team=0|1 &difficulty=recruit|veteran|elite
//      (&class=commander: the commander's seat, the battle from above: CommandView)
//      &map=trench|city (the trench war, or the city) &planet=scorched|duskcity|nightcity (data/art/palette.json;
//      the city defaults to duskcity, the snowfall at dusk, nightcity is its aurora night)
//      &fx=low|off (post-processing quality)
//
// Client loop: input → FrontlineSession (fixed 60 Hz, the same sim the tests run) → animation
// (rigs, LOD) → HD2 camera → instanced crowd, battlefield, tracers, stratagems → post-processing
// (god rays, bloom, grade) → HUD and audio. The look is the art direction's (docs/ART_DIRECTION.md):
// the planet preset's sky, sun, fog and ground, troopers in their role's kit and faction's paint.

import * as THREE from 'three';
import { bus } from './core/EventBus.js';
import { FixedLoop } from './core/FixedLoop.js';
import { InputManager } from './input/InputManager.js';
import { CameraRig, eyeOf, sightOf, cameraSolid } from './camera/CameraRig.js';
import { FrontlineSession } from './game/FrontlineSession.js';
import { AnimationSystem } from './anim/AnimationSystem.js';
import { CrowdRenderer } from './render/CrowdRenderer.js';
import { BattlefieldRenderer } from './render/BattlefieldRenderer.js';
import { CityRenderer } from './render/CityRenderer.js';
import { CollapseViews } from './vfx/CollapseViews.js';
import { TracerPool } from './render/TracerPool.js';
import { VehicleViews } from './vfx/VehicleViews.js';
import { ZoneDeployableViews } from './vfx/ZoneDeployableViews.js';
import { StratagemViews } from './vfx/StratagemViews.js';
import { StratagemPanel } from './ui/StratagemPanel.js';
import { HitFeedback } from './ui/HitFeedback.js';
import { VisorDamage } from './ui/VisorDamage.js';
import { BattlePointsHud } from './ui/BattlePointsHud.js';
import { MeleeTells } from './ui/MeleeTells.js';
import { BarkVoices } from './ui/BarkVoices.js';
import { GunFx } from './vfx/GunFx.js';
import { AudioDirector } from './audio/AudioDirector.js';
import { SoundEngine } from './audio/SoundEngine.js';
import { FrontlineHud } from './ui/FrontlineHud.js';
import { FireControl } from './ui/FireControl.js';
import { CommandView } from './ui/CommandView.js';
import { ScopeView } from './ui/ScopeView.js';
import { BattleFx } from './vfx/BattleFx.js';
import { FootFx } from './vfx/FootFx.js';
import { silhouetteScale } from './movement/Hitboxes.js';
import { Atmosphere, installFog } from './render/Atmosphere.js';
import { PostFX } from './render/PostFX.js';
import { loadSettings, withUrlOverrides } from './ui/Settings.js';
import { OptionsMenu } from './ui/OptionsMenu.js';
import { kitFor, peopleKit } from './render/TrooperKit.js';
import { DropViews } from './vfx/DropViews.js';
import { CIVILIAN, BANDIT, civilianEngaging } from './combat/Teams.js';

const params = new URLSearchParams(location.search);
// The loading line (index.html #loading): what's being built while the page is busy.
const loading = {
  el: document.getElementById('loading'),
  show(text) { if (this.el) { this.el.textContent = text; this.el.style.display = 'grid'; } },
  hide() { if (this.el) this.el.style.display = 'none'; },
};
const sizeParam = params.get('size'), playersParam = params.get('players');
const requestedPlayers = playersParam ? Math.max(8, Math.min(400, +playersParam)) : null;
const seed = +(params.get('seed') ?? 7);
const myTeam = +(params.get('team') ?? 0) === 1 ? 1 : 0;
const mapTheme = params.get('map') === 'city' ? 'city' : 'trench';

const load = (p) => fetch(`./data/${p}`).then((r) => r.json());
const [movement, melee, ballistic, energy, attachments, recoil, damage, statuses, solariKits, voidKits, supers, vehicles, solari, voidC, ai, humanoid, down, palette, trooperKits, rules, stratagems, battlePoints, passives, support, barks, civilians] = await Promise.all([
  load('movement.json'), load('weapons/melee.json'), load('weapons/ballistic.json'), load('weapons/energy.json'),
  load('weapons/attachments.json'), load('weapons/recoil.json'), load('damage-matrix.json'), load('abilities/statuses.json'),
  load('abilities/solari.json'), load('abilities/void.json'), load('supers.json'), load('vehicles.json'),
  load('classes/solari.json'), load('classes/void.json'), load('ai/personalities.json'), load('animation/humanoid.json'), load('down.json'),
  load('art/palette.json'), load('art/troopers.json'), load('rules.json'), load('stratagems.json'), load('battle-points.json'),
  load('passives.json'), load('support.json'), load('ai/barks.json'), load('civilians.json'),
]);
const planet = palette.planets[params.get('planet') ?? (mapTheme === 'city' ? 'duskcity' : 'scorched')] ?? palette.planets.scorched;
installFog(planet);   // before any material compiles
// The planet's own paint and effect colours over the shared ones (the dusk city: winter whites, snow kicked up).
for (const [k, paint] of Object.entries(planet.factions ?? {})) if (palette.factions[k]) Object.assign(palette.factions[k], paint);
Object.assign(palette.vfx, planet.vfx ?? {});
const classes = [solari, voidC];
const myClass = params.get('class') ?? (myTeam === 0 ? 'lancer' : 'reaver');
const data = {
  movement, weaponFiles: [ballistic, energy], attachments: attachments.attachments, recoil: recoil.patterns, statuses: statuses.statuses,
  meleeWeapons: melee.weapons, kits: { ...solariKits.kits, ...voidKits.kits }, classes, damageMatrix: damage.matrix, supers, vehicleDefs: vehicles,
  personalities: ai.personalities, difficulty: ai.difficulty[params.get('difficulty') ?? 'veteran'] ?? ai.difficulty.veteran,
  down, rules, stratagems, battlePoints, passives, support, humanoid, barks, civilians,   // (civilians: the city's people)
};
const abilityIndex = new Map();
for (const f of [solariKits, voidKits]) for (const kit of Object.values(f.kits)) for (const a of Object.values(kit)) abilityIndex.set(a.id, { ...a, family: f.soundFamily });

const PLAYER_ID = 1;
loading.show(`Building the ${mapTheme === 'city' ? 'city' : 'front'}…`);
await new Promise((r) => setTimeout(r, 30));          // (let the line paint before the build holds the page)
const session = new FrontlineSession(data, { size: sizeParam ?? (requestedPlayers ? null : '32v32'), players: requestedPlayers, seed, map: mapTheme, humans: [{ id: PLAYER_ID, team: myTeam, classId: myClass }] });
const { world, map, mode } = session;
const players = session.players;
document.title = `Emberfall Frontline · ${map.name} (${session.size})`;
const player = session.fighters.find((f) => f.id === PLAYER_ID);
const commanding = !!player.commander;   // in the commander's seat: no soldier of yours on the field
let commandView = null;                    // (its view: below, with the HUD)
player.name = commanding ? 'Command' : 'You';

// ---------------------------------------------------------------- scene
// The player's options (the [Esc] menu, the start menu's Settings); ?fx=low or ?fx=off override for a run.
const settings = withUrlOverrides(loadSettings(), params);
const fxMode = settings.postOff ? 'off' : settings.preset === 'low' ? 'low' : 'high';
const renderer = new THREE.WebGLRenderer({ antialias: fxMode === 'off', powerPreference: 'high-performance' });
// The canvas at the display's pixel density only on High DPI; the 3D image at the render scale,
// and never more than ~3.7 million pixels a frame whatever the screen (a 4K laptop screen at 150%
// would otherwise ask an integrated GPU for 8 million, every frame, through the post chain).
const pixelRatio = () => Math.min(devicePixelRatio, settings.hiDpi ? 2 : 1);
const renderScale = () => settings.renderScale * Math.min(1, Math.sqrt(3.7e6 / (innerWidth * innerHeight * pixelRatio() ** 2)));
renderer.setPixelRatio(pixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // for the plain path (PostFX tone-maps itself)
renderer.shadowMap.enabled = settings.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
// The planet: sky dome, the low hard sun and its shadow box, height fog, the sky as fill light,
// falling ash. Then the frame: god rays, bloom, the grade (PostFX).
const atmo = new Atmosphere(scene, planet, { radius: 1100, shadowBox: 45, renderer, shadows: settings.shadows });
if (atmo.ash) atmo.ash.visible = settings.particles;
const post = new PostFX(renderer, planet.post, { quality: fxMode === 'low' ? 'low' : 'high', scale: renderScale(), samples: settings.aa });
post.setOptions({ bloom: settings.bloom, rays: settings.rays, ink: settings.ink, letterbox: settings.letterbox, film: settings.film });
post.enabled = fxMode !== 'off';
const sunScreen = new THREE.Vector3();

const battlefield = new BattlefieldRenderer(scene, map, { localTeam: myTeam, anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()), art: { planet, palette } });
const anim = new AnimationSystem(humanoid, { getEntity: (id) => world.entity(id), surfaceAt: (x, y, z) => world.surfaceAt(x, y, z), groundY: (x, z) => map.terrain.height(x, z) });
// Each fighter wears its role's kit in its army's paint, with its own stencilled number. The
// city's people wear street clothes (their number picks their colours; a raider's, his gang's).
for (const f of session.fighters) {
  if (!f.offField) anim.add(f);
  const people = f.team === CIVILIAN ? 'civilian' : f.team === BANDIT ? 'bandit' : null;
  f.look = {
    team: f.team, status: null, flame: new THREE.Color(), highlight: f === player,
    kit: people ? peopleKit(trooperKits, people, f.id) : kitFor(trooperKits, f.role),
    number: f.gang ? f.gang.id * 10 + (f.id % 10) : (f.id * 37 + 11) % 100,
  };
}
anim.focusId = commanding ? null : PLAYER_ID;
const crowd = new CrowdRenderer(scene, { max: players + anim.maxCorpses + 8, palette });
const tracers = new TracerPool(scene, { getEntity: (id) => world.entity(id), look: planet.fx?.bolts, localTeam: myTeam, muzzle: (id, p) => gunFx.muzzleAt(id, p) });   // (gunFx: below)
const fx = new BattleFx(scene, { fog: scene.fog, look: planet.fx });
let viewCam = null;   // (the camera the frame was drawn from: FootFx kicks dust up only near it)
const footFx = new FootFx({ fx, world, camera: () => viewCam, snow: !!planet.snow?.amount });   // dust off feet and falls
const vehicleViews = new VehicleViews(scene, world, { localTeam: myTeam, far: Math.min(1100, atmo.reach), palette, fx });
// The night city: its buildings, streets, lamps, wrecks and neon, and the lights near you.
const city = map.city ? new CityRenderer(scene, map, { planet, palette, fx, anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) }) : null;
const collapse = city ? new CollapseViews(scene, { fx, colorOf: (b) => city.colorOf(b), rigid: session.structures?.rigid, snow: planet.snow, anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) }) : null;   // buildings coming apart
// A stratagem's sentry is drawn on its pod by StratagemViews, not as a class turret.
const zoneViews = new ZoneDeployableViews(scene, world, { localTeam: myTeam, skip: (e) => !!world.stratagems.defs[e.ability] });
const stratViews = new StratagemViews(scene, world, { palette, fx, anim, groundY: (x, z) => map.terrain.height(x, z) });
const gunFx = new GunFx(scene, { fx, anim, world, player, palette });          // muzzles, impacts, bullet holes
const dropViews = new DropViews(scene, world, { kit: crowd.kit, palette, glint: planet.fx?.bolts?.neutral });   // guns lying on the ground

const input = new InputManager(renderer.domElement);
input.mouseSens = 0.0022 * settings.sens;
input.yaw = myTeam === 0 ? -Math.PI / 2 : Math.PI / 2; // face the enemy's side of the map
const groundOrCover = (o, d, max) => {
  const a = world.raycastStatic(o, d, max, { filter: cameraSolid }), b = world.raycastGround(o, d, max);
  return !a ? b : !b ? a : a.distance < b.distance ? a : b;
};
const rig = new CameraRig({ raycast: groundOrCover, settings: { baseFov: settings.fov, shakeScale: settings.shake, bobScale: settings.bob, reducedMotion: settings.reducedMotion } });
rig.camera.far = 1500; rig.camera.updateProjectionMatrix();
const resize = () => { renderer.setPixelRatio(pixelRatio()); renderer.setSize(innerWidth, innerHeight); post.setOptions({ scale: renderScale() }); rig.camera.aspect = innerWidth / innerHeight; rig.camera.updateProjectionMatrix(); commandView?.resize(innerWidth / innerHeight); };
addEventListener('resize', resize);
// The graphics driver gave up (a GPU too busy for too long resets, and the page's WebGL with it):
// say so and come back with lighter effects instead of sitting on a frozen frame.
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  loop.stop();
  const next = new URLSearchParams(location.search);
  next.set('fx', fxMode === 'high' ? 'low' : 'off');
  loading.show('The graphics driver reset. Restarting with lighter effects…');
  setTimeout(() => location.replace(`${location.pathname}?${next}`), 1800);
});

// The sound (SoundBank: designed in code, rendered in a worker while you load; SoundEngine: played
// with depth, the city answering, walls muffling). Browsers only let it start on your first click
// or key; until then it's silent.
const _so = new THREE.Vector3(), _sd = new THREE.Vector3(), occCache = new Map();
const sound = new SoundEngine({
  environment: mapTheme === 'city' ? 'city' : 'open',
  // Is there a wall between you and it? (cover only; a cached answer per 4 m cell for a third of a second)
  occluder: (p) => {
    const key = `${Math.round(p.x / 4)}|${Math.round(p.y / 4)}|${Math.round(p.z / 4)}`, now = performance.now(), c = occCache.get(key);
    if (c && now - c.t < 330) return c.v;
    const L = sound.listener; _so.set(L.x, L.y, L.z); _sd.set(p.x - L.x, p.y - L.y, p.z - L.z);
    const len = _sd.length(); _sd.divideScalar(len || 1);
    const v = len > 2 && world.raycastStatic(_so, _sd, len - 1, { includeWalls: false }) ? 1 : 0;
    if (occCache.size > 600) occCache.clear();
    occCache.set(key, { t: now, v });
    return v;
  },
});
const audio = new AudioDirector(sound, {
  listenerId: PLAYER_ID, abilityIndex, guns: world.vehicles.guns, strats: world.stratagems,
  snow: !!planet.snow?.amount, environment: mapTheme === 'city' ? 'city' : 'trench',
  getEntity: (id) => {
    const e = world.entity(id);
    if (!e) return null;
    const v = e.movement.state.velocity, W = e.weapons;
    return {
      team: e.team, position: e.movement.state.position, perks: e.perks, speed: v ? Math.hypot(v.x, v.z) : 0,
      weapon: W?.current?.s ?? null, loadout: W?.loadout?.map((x) => x.s) ?? [], shield: e.health?.shield ?? 0,
      hpFrac: e.health && !e.isVehicle ? e.health.hp / e.health.max : 1, flame: e.mode === 'sword' && !!e.melee?.w?.visual?.flameColor,
    };
  },
  onNearMiss: (k) => rig.addTrauma(k * 0.22),       // a round past your ear: the camera flinches
});
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => sound.resume());
sound.setVolume(settings.volume);

const hud = new FrontlineHud(document.getElementById('hud'), session, player, { letterbox: post.enabled ? post.letterbox : 0 });
// The commander's seat: the map from above, the squads and their orders (the soldier's panels hide).
if (commanding) commandView = new CommandView(document.getElementById('hud'), { session, team: myTeam, aspect: innerWidth / innerHeight });
// The controls card: up for the first 25 s of the match, F1 hides it or brings it back.
const helpCard = document.getElementById('help');
if (commanding && helpCard) {
  Object.assign(helpCard.style, { zIndex: 6, top: 'auto', bottom: '96px', maxWidth: '440px' });   // above the map, clear of the squad cards
  helpCard.innerHTML = `<b>Command</b> <small style="opacity:.7">(F1 hides and shows this)</small> · you command your side: the squads go where you send them (most of the time: one in a firefight or pinned down may finish it first, and says so). Squads you give no orders follow standing orders; <b>X</b> hands a squad back to them.<br>
    Select: click a squad's marker or card (Shift: several; <b>1</b>-<b>9</b>; Ctrl+A all). <b>Right-click</b> the map: take the point there (hold it, if it's ours), or hold that ground.<br>
    <b>T</b> take · <b>H</b> hold · <b>R</b> scout (one man goes ahead to get eyes on it: the guns can hit what he sees) · <b>B</b> fall back · <b>F</b> fire mission (click the spot; blind where nobody has eyes on it, the rounds scatter) · Esc disarms.<br>
    <b>WASD</b> or the arrows pan, the wheel zooms, the middle button drags the map, <b>Home</b> goes back to the front. Darkened ground: nobody's watched it lately; red rings: where enemies were last seen.`;
}
const helpTimer = setTimeout(() => helpCard?.classList.add('gone'), 25000);
addEventListener('keydown', (e) => { if (e.code !== 'F1' || !helpCard) return; e.preventDefault(); clearTimeout(helpTimer); helpCard.classList.toggle('gone'); });
const callIn = new StratagemPanel(document.getElementById('hud'), { world, player, colors: palette.stratagem });
const hitFx = new HitFeedback(document.getElementById('hud'), { player, rig, world });   // hit markers, damage direction, flinch
const visor = new VisorDamage(document.getElementById('hud'), { player, reducedMotion: settings.reducedMotion });   // red edges, cracks, blood when hurt
const bpHud = new BattlePointsHud(document.getElementById('hud'), { player, world });     // "+100 TAKEDOWN"
const tells = new MeleeTells(document.getElementById('hud'), { player, world });         // chevrons for swings coming at you
const scope = new ScopeView(document.getElementById('hud'));   // the sight picture through a magnified optic
const voices = new BarkVoices(document.getElementById('hud'), { player, world, hear: barks.hear, voices: params.get('voices') !== 'off' && settings.voices });   // the soldiers' callouts

// ---------------------------------------------------------------- options ([Esc]: the battle waits)
// Freeing the mouse (Esc) opens the options and pauses the battle; Resume locks the mouse again.
// Every change applies live (shadows recompile the shaders while paused, so the game never hitches).
let wasLocked = false, started = false;   // (the battle loop is built further down)
const options = new OptionsMenu(document.body, {
  inGame: true,
  onChange: (o, key) => applyOptions(o, key),
  onClose: () => { loop.paused = false; sound.resume(); if (!commanding) renderer.domElement.requestPointerLock?.(); },
  onQuit: () => { location.href = 'start.html'; },
});
const openOptions = () => { if (options.isOpen || !started) return; loop.paused = true; sound.ctx.suspend?.(); options.open(); };
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (wasLocked && !locked && !player.health.dead) openOptions();
  wasLocked = locked;
});
addEventListener('keydown', (e) => { if (e.code === 'Escape' && !document.pointerLockElement) { if (options.isOpen) options.close(); else if (!commandView?.escape()) openOptions(); } });
async function applyOptions(o, key) {
  Object.assign(settings, o);
  rig.settings.baseFov = o.fov; rig.settings.shakeScale = o.shake; rig.settings.bobScale = o.bob; rig.settings.reducedMotion = visor.reducedMotion = o.reducedMotion;
  rig.fov.set(o.fov); rig.camera.fov = o.fov; rig.camera.updateProjectionMatrix();
  input.mouseSens = 0.0022 * o.sens;
  sound.setVolume(o.volume);
  voices.setVoices(o.voices && params.get('voices') !== 'off');
  if (atmo.ash) atmo.ash.visible = o.particles;
  renderer.setPixelRatio(pixelRatio()); renderer.setSize(innerWidth, innerHeight);
  post.setOptions({ scale: renderScale(), samples: o.aa, bloom: o.bloom, rays: o.rays, ink: o.ink, letterbox: o.letterbox, film: o.film });
  hud.setLetterbox(post.enabled ? post.letterbox : 0);
  if (renderer.shadowMap.enabled !== o.shadows) {
    renderer.shadowMap.enabled = o.shadows; atmo.sun.castShadow = o.shadows;
    scene.traverse((x) => { for (const m of [x.material].flat()) if (m) m.needsUpdate = true; });
    loading.show('Compiling shaders');
    await renderer.compileAsync(scene, rig.camera);
    loading.hide();
  }
}
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
const FIRST_PERSON = { head: true, cape: true, rim: true };   // your own head, cape and rim light, from inside the helmet
const _eye = new THREE.Vector3(), _sight = new THREE.Vector3();
const _yaw = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

// ---------------------------------------------------------------- loop
const loop = new FixedLoop({
  hz: 60,
  sim(dt, tick) {
    if (commanding) {
      // The commander's seat: the orders given since the last tick go out, the battle goes on.
      commandView.tick();
      session.focus[0] = commandView.target;
      anim.snapshot();
      session.step(dt);
      return;
    }
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
    // Paused behind the options: the frame as it stands (the options' changes show on it live).
    if (loop.paused) { const c = commanding ? commandView.camera : fireControl.active ? fireControl.camera : rig.camera; post.render(scene, c, atmo.sunScreen(c, sunScreen), 0); return; }
    const dt = loop.frameDt;   // the real frame time: the camera, the animation and the effects keep their timing at any refresh rate
    for (const f of session.fighters) {
      if (f.offField) continue;
      const s = f.movement.state, st = f.status, tf = f.transform;
      f.look.status = s.invulnerable ? STATUS_GLOW.iframes : f.melee.vulnerable ? STATUS_GLOW.vulnerable : tf ? STATUS_GLOW[tf.def.aura] ?? null
        : st.has('scorch') ? STATUS_GLOW.scorch : st.has('volatile') || st.has('weaken') ? STATUS_GLOW.weaken
        : st.has('stim') ? STATUS_GLOW.stim : f.team !== myTeam && st.has('revealed') ? STATUS_GLOW.revealed : null;   // a spotter's mark: enemies he's revealed glow for us
      f.look.flame.set(f.melee.w.visual?.flameColor ?? (f.team === 0 ? '#ff7a1a' : '#8b5cf6'));
      // A civilian's rim is neutral, red while he's fighting your side.
      if (f.team === CIVILIAN) f.look.rim = civilianEngaging(world, f, myTeam) ? crowd.rimHostile : null;
    }
    // At an indirect-fire gun the overhead fire-control view takes over the screen; in the commander's seat, the command view.
    if (commanding) commandView.update(dt);
    const view = commanding ? commandView.camera : fireControl.active ? fireControl.camera : rig.camera;
    anim.update(dt, alpha, view.position);
    let cam = view, scoped = 0;
    if (!commanding) {
      const w = player.weapons, pv = player.vehicle?.veh;
      // A magnified optic up: the eye goes to it (third person too), the gun isn't drawn, the screen is the sight picture.
      scoped = scope.update(dt, { scoped: player.mode === 'gun' && !pv && !player.health.dead && !player.health.downed && !fireControl.active && ScopeView.scoped(w.current), ads: w.ads });
      const lookYaw = input.yaw + (player.mode === 'gun' ? w.recoilYaw : 0);
      const lookPitch = Math.max(-1.45, Math.min(1.45, input.pitch + (player.mode === 'gun' ? w.recoilPitch : 0)));
      const ph = anim.get(PLAYER_ID);
      rig.update(dt, {
        target: player, pos: anim.record(PLAYER_ID).root, yaw: lookYaw, pitch: lookPitch,
        ads: player.mode === 'gun' ? w.ads : player.melee.guarding ? 0.3 : 0, adsFov: w.current?.s.ads?.fov,
        vehicle: pv ? pv.def.camera : null, scale: silhouetteScale(player),
        eye: ph ? eyeOf(ph, _eye) : null, sight: ph?.prop.kind === 'gun' ? sightOf(ph, _sight) : null,
        thirdPerson: player.health.dead || player.movement.state.mode === 'ragdoll', scope: scoped,
      });
      cam = fireControl.update(dt, player, rig.camera);
    }
    viewCam = cam;
    crowd.begin(cam);
    for (const r of anim.list) {
      const f = r.e, s = f.movement.state;
      if (f.vehicle && !f.vehicle.exposed && !f.vehicle.shown) continue;   // inside a hull: unseen (an open car's driver is seen)
      if (commanding && !commandView.shows(f)) continue;                  // the commander's fog of war: enemies only while we see them
      if (f === player && scoped > 0.5) continue;                          // looking down a scope: no gun, no arms in the way
      if (r.lod < 2) crowd.drawRig(r.h, f.look, r.lod, f === player && rig.firstPerson ? FIRST_PERSON : null);
      else crowd.drawImpostor(r.root, { yaw: s.bodyYaw, scale: silhouetteScale(f), height: s.stance === 'crouch' ? 1.2 : 1.8, lying: LYING.has(s.mode) || s.stance === 'prone' || s.downed || s.slide?.kind === 'belly' || f.health.dead }, f.look);
    }
    // The fallen stay where they fell after their soldier redeploys.
    for (const c of anim.corpses) {
      const d = c.root.distanceTo(rig.camera.position);
      if (d < 220) crowd.drawRig(c, c.look, d < 70 ? 0 : 1);
      else crowd.drawImpostor(c.root, { yaw: _yaw(c.j.pelvis, c.j.neck), scale: c.scale, height: 1.8, lying: true }, c.look);
    }
    crowd.end();
    const root = commanding ? commandView.target : anim.record(PLAYER_ID).root;
    atmo.update(dt, cam, fireControl.active ? cam.position : root);
    battlefield.update(mode, session.time, cam.position);
    city?.update(dt, cam, root);
    tracers.update(dt);
    fx.update(dt);
    zoneViews.update(dt);
    stratViews.update(dt, cam, alpha);
    gunFx.update(dt, cam);
    dropViews.update(dt);
    collapse?.update(dt, alpha);
    vehicleViews.update(dt, cam);
    post.render(scene, cam, atmo.sunScreen(cam, sunScreen), dt);
    audio.update(dt, commanding ? commandView.target : player.movement.state.position, commanding ? commandView.listenYaw : input.yaw);
    hud.update(dt, cam, { firstPerson: rig.firstPerson && !fireControl.active && !commanding, scoped: scoped > 0.5 });
    if (commanding) return;
    callIn.update(dt, cam);
    hitFx.update(dt, cam);
    visor.update(dt, cam);
    bpHud.update(dt);
    tells.update(dt, cam);
    voices.update(dt);
  },
});
window.__frontline = { session, player, commandView, footFx, scope, anim, crowd, rig, hud, renderer, scene, battlefield, city, collapse, loop, fx, tracers, fireControl, input, atmo, post, stratViews, callIn, gunFx, hitFx, visor, bpHud, tells, voices, dropViews, sound, audio, bus };
// Every shader compiled now, before the battle starts: a material drawn for the first time mid-fight
// stalls the game while the driver compiles it (on Windows, up to seconds). Then one frame drawn
// through the whole post chain, so its passes and the shadow pass are compiled too.
loading.show(`Compiling shaders · ${map.name}`);
await new Promise((r) => setTimeout(r, 30));
await renderer.compileAsync(scene, rig.camera);
loop.render(0, performance.now() / 1000);
loading.hide();
loop.start();
started = true;
bus.emit('frontline:ready', { players, seed });
