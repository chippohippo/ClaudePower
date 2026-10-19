// The Audio Lab (audio-lab.html): the game's sound away from the game. Every weapon, blast and
// near miss on a board (first person, then out in the world at a few distances), each map's
// atmosphere, and a real battle heard from inside it: a FrontlineSession of bots on both sides,
// through the game's own AudioDirector and SoundEngine, live or recorded offline.
//
//   audio-lab.html                    the board; click to hear (the browser wants a click first)
//   audio-lab.html?render=battle&map=trench&size=32v32&seed=3&warm=25&secs=40
//   audio-lab.html?render=board&map=city&planet=nightcity
//
// An offline recording (tools/audio/listen.mjs drives it in a headless browser) leaves its result
// in window.__audiolab: { done, error, wav (base64, 16-bit stereo), log (what played, when, from
// how far, how loud) }. A battle is heard by one soldier of the first side (his gun is "yours");
// when he falls, the nearest living comrade takes over, as a spectator would.

import { bus } from './core/EventBus.js';
import { FrontlineSession } from './game/FrontlineSession.js';
import { AnimationSystem } from './anim/AnimationSystem.js';
import { AudioDirector } from './audio/AudioDirector.js';
import { SoundEngine } from './audio/SoundEngine.js';
import { Ambience } from './audio/Ambience.js';
import { weaponDesign } from './audio/SoundBank.js';
import { Vector3 } from 'three';

const params = new URLSearchParams(location.search);
const MAPS = {
  trench: { label: 'The Trenches', map: 'trench', planet: 'scorched' },
  dusk: { label: 'Dusk City', map: 'city', planet: 'duskcity' },
  night: { label: 'Night City', map: 'city', planet: 'nightcity' },
};
const mapKey = (m, planet) => (m === 'city' ? (planet === 'nightcity' ? 'night' : 'dusk') : 'trench');
/** The sound's settings for a map: the engine's room, the director's atmosphere. */
export const soundsFor = (key) => ({ environment: key === 'trench' ? 'open' : key === 'night' ? 'night' : 'city', atmosphere: key === 'trench' ? 'trench' : key === 'night' ? 'night' : 'city', snow: key === 'dusk' });

// ---------------------------------------------------------------- data (as the game loads it)
async function loadData() {
  const load = (p) => fetch(`./data/${p}`).then((r) => r.json());
  const [movement, melee, ballistic, energy, attachments, recoil, damage, statuses, solariKits, voidKits, supers, vehicles, solari, voidC, ai, humanoid, down, rules, stratagems, battlePoints, passives, support, barks, civilians] = await Promise.all([
    load('movement.json'), load('weapons/melee.json'), load('weapons/ballistic.json'), load('weapons/energy.json'),
    load('weapons/attachments.json'), load('weapons/recoil.json'), load('damage-matrix.json'), load('abilities/statuses.json'),
    load('abilities/solari.json'), load('abilities/void.json'), load('supers.json'), load('vehicles.json'),
    load('classes/solari.json'), load('classes/void.json'), load('ai/personalities.json'), load('animation/humanoid.json'), load('down.json'),
    load('rules.json'), load('stratagems.json'), load('battle-points.json'), load('passives.json'), load('support.json'), load('ai/barks.json'), load('civilians.json'),
  ]);
  const abilityIndex = new Map();
  for (const f of [solariKits, voidKits]) for (const kit of Object.values(f.kits)) for (const a of Object.values(kit)) abilityIndex.set(a.id, { ...a, family: f.soundFamily });
  return {
    abilityIndex, ballistic, energy, vehicles, supers,
    session: {
      movement, weaponFiles: [ballistic, energy], attachments: attachments.attachments, recoil: recoil.patterns, statuses: statuses.statuses,
      meleeWeapons: melee.weapons, kits: { ...solariKits.kits, ...voidKits.kits }, classes: [solari, voidC], damageMatrix: damage.matrix, supers, vehicleDefs: vehicles,
      personalities: ai.personalities, difficulty: ai.difficulty.veteran, down, rules, stratagems, battlePoints, passives, support, humanoid, barks, civilians,
    },
  };
}

// ---------------------------------------------------------------- a battle, heard from inside it
/**
 * A battle with an ear in it: the session, the rigs (footsteps), the director, a listener who
 * fights in it. step(dt) advances it all one tick.
 */
function battle(data, engine, { key, size, seed, log }) {
  const M = MAPS[key], S = soundsFor(key);
  const session = new FrontlineSession(data.session, { size, seed, map: M.map });
  const { world, map } = session;
  const floorAt = (x, z, near) => {
    const g = map.terrain.height(x, z);
    if (near === undefined) return g;
    const top = map.cover.topAt(x, z, near + 0.45);
    return top > g ? top : g;
  };
  const anim = new AnimationSystem(data.session.humanoid, { getEntity: (id) => world.entity(id), surfaceAt: (x, y, z) => world.surfaceAt(x, y, z), groundY: floorAt, bodies: session.bodies });
  for (const f of session.fighters) if (!f.offField) anim.add(f);
  const _o = new Vector3(), _d = new Vector3();
  engine.occluder = (p) => {
    const L = engine.listener; _o.set(L.x, L.y, L.z); _d.set(p.x - L.x, p.y - L.y, p.z - L.z);
    const len = _d.length(); _d.divideScalar(len || 1);
    return len > 2 && world.raycastStatic(_o, _d, len - 1, { includeWalls: false }) ? 1 : 0;
  };
  // The ear: a soldier of the first side, where the most enemies are within 70 m.
  const onFoot = (f) => f.team === 0 && !f.offField && !f.health.dead && !f.health.downed && !f.vehicle;
  const pick = (near = null) => {
    let best = null, bestScore = -Infinity;
    for (const f of session.fighters) {
      if (!onFoot(f)) continue;
      const p = f.movement.state.position;
      let score = 0;
      if (near) score = -p.distanceTo(near);
      else for (const g of session.fighters) if (g.team === 1 && !g.health.dead && g.movement.state.position.distanceTo(p) < 70) score++;
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best;
  };
  let ear = null, audio = null;
  // (The ear comes in after the warm-up: nothing the battle did before it is heard all at once at 0 s.)
  const hear = () => new AudioDirector(engine, {
    listenerId: -1, abilityIndex: data.abilityIndex, guns: world.vehicles.guns, strats: world.stratagems,
    snow: S.snow, environment: S.atmosphere,
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
  });
  const listen = (f) => { audio ??= hear(); ear = f; audio.listenerId = f?.id ?? -1; anim.focusId = audio.listenerId; };
  let t = 0;
  return {
    session, anim,
    get audio() { return audio; },
    get ear() { return ear; },
    /** Run the battle without listening (the opening: the barrage, the first wave going over). */
    warm(sec) { for (let i = 0; i < sec * 60; i++) { anim.snapshot(); session.step(1 / 60); } listen(pick()); },
    step(dt) {
      if (!ear || !onFoot(ear)) listen(pick(ear?.movement.state.position ?? null) ?? pick());
      const p = ear?.movement.state.position ?? null;
      session.focus[0] = p;
      anim.snapshot();
      session.step(dt);
      anim.update(dt, 1, p ? _o.set(p.x, p.y + 1.6, p.z) : null);
      audio?.update(dt, p, ear?.movement.state.yaw ?? 0);
      t += dt;
      if (log && ear) log.ear.push([+t.toFixed(2), ear.id, +p.x.toFixed(1), +p.z.toFixed(1)]);
    },
    dispose() { audio?.dispose(); session.dispose?.(); },
  };
}

// ---------------------------------------------------------------- the board: each sound on its own
/** Every weapon design in the game, with the weapons that use it. */
function weaponList(data) {
  const specs = [...data.ballistic.weapons, ...data.energy.weapons, ...Object.entries(data.vehicles.weapons).map(([id, w]) => ({ id, ...w })), ...Object.values(data.supers.weapons ?? {})];
  const by = new Map();
  for (const s of specs) {
    const [kind, profile] = weaponDesign(s);
    if (kind === 'beam') continue;
    const k = `${kind}:${profile}`;
    if (!by.has(k)) by.set(k, { kind, profile, names: [], rpm: s.rpm ?? s.fireRate ?? 600, auto: s.mode === 'auto' || (s.rpm ?? 0) > 300 });
    by.get(k).names.push(s.name ?? s.id);
  }
  return [...by.values()];
}
const DISTANCES = [5, 30, 100, 300];
/** A scripted run through the board: every gun first person and at each distance, every blast, the near misses. */
function boardScript(data) {
  const out = [];
  let t = 0.5;
  for (const w of weaponList(data)) {
    out.push({ t, label: `${w.kind}:${w.profile} 1p`, play: (E) => E.play(`${w.kind}:${w.profile}:1p`, { gain: 0.6 }) });
    t += 1.2;
    for (const d of DISTANCES) {
      out.push({ t, label: `${w.kind}:${w.profile} ${d} m`, play: (E) => E.play(`${w.kind}:${w.profile}:near`, { pos: { x: 0, y: 1.5, z: -d }, far: `${w.kind}:${w.profile}:far`, kind: 'gun', gain: 0.85 }) });
      t += 1 + d / 343;
    }
  }
  for (const size of ['grenade', 'vehicle', 'shell', 'bomb']) for (const d of [8, 40, 150, 500]) {
    out.push({ t, label: `boom:${size} ${d} m`, play: (E) => E.play(`boom:${size}:near`, { pos: { x: 3, y: 0, z: -d }, far: `boom:${size}:far`, kind: 'boom', gain: 1 }) });
    t += 2.4 + d / 343;
  }
  for (const k of ['crack', 'whizz:sol', 'whizz:void', 'crack', 'whizz:void']) { out.push({ t, label: k, play: (E) => E.play(k, { pos: { x: 1, y: 1.6, z: -1 }, kind: 'near', gain: 0.8, delay: false }) }); t += 0.8; }
  return { events: out, length: t + 3 };
}

// ---------------------------------------------------------------- recording
/** 16-bit stereo WAV of an AudioBuffer, as base64. */
function wavBase64(buf) {
  const n = buf.length, L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const bytes = new Uint8Array(44 + n * 4), dv = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, buf.sampleRate, true);
  dv.setUint32(28, buf.sampleRate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    dv.setInt16(44 + i * 4, Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), true);
    dv.setInt16(46 + i * 4, Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), true);
  }
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** What the engine played: every play() logged with its time, id, kind, distance and level (`only`/`mute`: regexes of ids, for listening to parts of the mix). */
function logPlays(engine, log, now, { only = null, mute = null } = {}) {
  const play = engine.play.bind(engine), loop = engine.loop.bind(engine);
  const skip = (id) => (only && !only.test(id)) || (mute && mute.test(id));
  engine.loop = (key, id, o) => (skip(id) ? undefined : loop(key, id, o));
  engine.play = (id, o = {}) => {
    if (skip(id)) return null;
    const v = play(id, o);
    const d = o.pos ? engine.relative(o.pos).d : 0;
    log.plays.push([+now().toFixed(3), id, o.kind ?? (o.ui ? 'ui' : '2d'), +d.toFixed(1), v ? +(20 * Math.log10(Math.max(1e-6, v.level))).toFixed(1) : null]);
    return v;
  };
}

async function record(kind, o) {
  const sr = 48000, data = await loadData(), key = mapKey(o.map, o.planet), S = soundsFor(key);
  const secs = kind === 'board' ? boardScript(data).length : o.secs;
  const ctx = new OfflineAudioContext(2, Math.ceil(secs * sr), sr);
  const engine = new SoundEngine({ ctx, environment: S.environment, offline: true });
  if (o.verb != null) engine.reverbOut.gain.value *= +o.verb;     // (listening to the mix without the room, or with more of it)
  await engine.loadAllRecorded();
  const log = { plays: [], ear: [], map: key, kind, secs };
  logPlays(engine, log, () => ctx.currentTime, { only: o.only ? new RegExp(o.only) : null, mute: o.mute ? new RegExp(o.mute) : null });
  if (kind === 'board') {
    const B = boardScript(data);
    for (const ev of B.events) ctx.suspend(ev.t).then(() => { ev.play(engine); log.plays.at(-1)?.push(ev.label); ctx.resume(); });
  } else {
    const B = battle(data, engine, { key, size: o.size, seed: o.seed, log });
    B.warm(o.warm);
    const dt = 1 / 60;
    let i = 0;
    const C = engine.comps;
    log.comp = [];
    const next = () => { i++; if (i * dt < secs - 0.05) ctx.suspend(i * dt).then(() => { B.step(dt); if (C && i % 6 === 0) log.comp.push([+(i * dt).toFixed(2), +C.low.reduction.toFixed(1), 0, +C.limit.reduction.toFixed(1), +engine.bedDuck.gain.value.toFixed(2), +engine.heroDuck.gain.value.toFixed(2)]); next(); ctx.resume(); }); };
    B.step(dt);     // (the first tick, at 0)
    next();
  }
  const buf = await ctx.startRendering();
  log.stats = engine.stats;
  return { wav: wavBase64(buf), log };
}

// ---------------------------------------------------------------- the page
async function main() {
  const out = (window.__audiolab = { done: false });
  const render = params.get('render');
  if (render) {
    try {
      const r = await record(render, {
        map: params.get('map') ?? 'trench', planet: params.get('planet') ?? '', size: params.get('size') ?? '32v32',
        seed: +(params.get('seed') ?? 3), warm: +(params.get('warm') ?? 25), secs: +(params.get('secs') ?? 30), only: params.get('only'), mute: params.get('mute'), verb: params.get('verb'),
      });
      Object.assign(out, r);
    } catch (e) { out.error = `${e.message}\n${e.stack}`; }
    out.done = true;
    document.body.textContent = out.error ? `failed: ${out.error}` : 'recorded';
    return;
  }
  board(await loadData());
}

/** The live board: click a sound to hear it; a battle to listen to. */
function board(data) {
  const el = document.getElementById('lab');
  let key = 'trench', engine = null, live = null, amb = null, ambTimer = 0;
  const make = () => {
    live?.stop();
    if (amb) { amb.dispose(); clearInterval(ambTimer); amb = null; }
    engine?.ctx.close?.();
    const S = soundsFor(key);
    engine = new SoundEngine({ environment: S.environment });
    window.__audiolab.engine = engine;
  };
  make();
  const go = (fn) => { engine.resume(); fn(engine); };
  const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, attrs); e.append(...kids); return e; };
  const btn = (label, fn) => h('button', { textContent: label, onclick: () => go(fn) });
  const section = (title) => { const s = h('section', {}, h('h2', { textContent: title })); el.append(s); return s; };

  const top = section('Map');
  for (const [k, m] of Object.entries(MAPS)) top.append(h('button', { textContent: m.label, className: k === key ? 'on' : '', onclick: (e) => { key = k; make(); for (const b of top.querySelectorAll('button')) b.classList.toggle('on', b === e.target); } }));
  top.append(btn('Atmosphere on/off', (E) => {
    if (amb) { amb.dispose(); clearInterval(ambTimer); amb = null; return; }
    amb = new Ambience(E, soundsFor(key).atmosphere);
    ambTimer = setInterval(() => amb?.update(0.05), 50);
  }));

  const bat = section('Battle');
  const note = h('p', { textContent: 'A 32 v 32 battle heard from inside it, by a soldier of the Solari (his gun is yours). Takes a few seconds to build.' });
  bat.append(note, h('button', {
    textContent: 'Listen to a battle',
    onclick: async () => {
      engine.resume();
      if (live) { live.stop(); live = null; note.textContent = 'Stopped.'; return; }
      note.textContent = 'Building the battle…';
      await new Promise((r) => setTimeout(r, 30));
      const B = battle(data, engine, { key, size: '32v32', seed: 3 + Math.floor(Math.random() * 100) });
      B.warm(20);
      let acc = 0, last = performance.now(), on = true;
      const tick = () => {
        if (!on) return;
        const now = performance.now(); acc += Math.min(0.25, (now - last) / 1000); last = now;
        while (acc >= 1 / 60) { B.step(1 / 60); acc -= 1 / 60; }
        note.textContent = `Listening as soldier ${B.ear?.id ?? '-'} · ${B.session.time.toFixed(0)} s`;
        requestAnimationFrame(tick);
      };
      live = { stop: () => { on = false; B.dispose(); } };
      tick();
    },
  }));

  const guns = section('Weapons: first person, then at 5, 30, 100 and 300 m');
  for (const w of weaponList(data)) {
    const row = h('div', { className: 'row' }, h('b', { textContent: `${w.kind}:${w.profile}` }), h('small', { textContent: w.names.slice(0, 3).join(', ') }));
    row.append(btn('1P', (E) => E.play(`${w.kind}:${w.profile}:1p`, { gain: 0.6 })));
    for (const d of DISTANCES) row.append(btn(`${d} m`, (E) => E.play(`${w.kind}:${w.profile}:near`, { pos: { x: 0, y: 1.5, z: -d }, far: `${w.kind}:${w.profile}:far`, kind: 'gun', gain: 0.85 })));
    row.append(btn('Burst 1P', (E) => { for (let i = 0; i < 8; i++) setTimeout(() => E.play(`${w.kind}:${w.profile}:1p`, { gain: 0.6 }), (i * 60000) / Math.max(120, w.rpm)); }));
    row.append(btn('Burst 30 m', (E) => { for (let i = 0; i < 8; i++) setTimeout(() => E.play(`${w.kind}:${w.profile}:near`, { pos: { x: 6, y: 1.5, z: -29 }, far: `${w.kind}:${w.profile}:far`, kind: 'gun', gain: 0.85 }), (i * 60000) / Math.max(120, w.rpm)); }));
    guns.append(row);
  }
  const booms = section('Blasts at 8, 40, 150 and 500 m');
  for (const size of ['grenade', 'vehicle', 'shell', 'bomb']) {
    const row = h('div', { className: 'row' }, h('b', { textContent: size }));
    for (const d of [8, 40, 150, 500]) row.append(btn(`${d} m`, (E) => { E.play(`boom:${size}:near`, { pos: { x: 3, y: 0, z: -d }, far: `boom:${size}:far`, kind: 'boom', gain: 1 }); if (d < 30) E.shock(0.6); }));
    booms.append(row);
  }
  const misc = section('Near misses, artillery, the sky');
  for (const [label, fn] of [
    ['Supersonic crack', (E) => E.play('crack', { pos: { x: 1, y: 1.6, z: -1 }, kind: 'near', gain: 0.8, delay: false })],
    ['Solari bolt past', (E) => E.play('whizz:sol', { pos: { x: 1, y: 1.6, z: -1 }, kind: 'near', gain: 0.7, delay: false })],
    ['Void bolt past', (E) => E.play('whizz:void', { pos: { x: 1, y: 1.6, z: -1 }, kind: 'near', gain: 0.7, delay: false })],
    ['Howitzer at 400 m', (E) => E.play('report:howitzer', { pos: { x: -200, y: 0, z: -350 }, kind: 'report', gain: 0.95 })],
    ['AT gun at 150 m', (E) => E.play('report:at', { pos: { x: 80, y: 0, z: -120 }, kind: 'report', gain: 0.95 })],
    ['Rockets at 300 m', (E) => E.play('report:rocket', { pos: { x: 150, y: 0, z: -260 }, kind: 'report', gain: 0.7 })],
    ['Incoming shell', (E) => E.play('incoming', { pos: { x: 10, y: 8, z: -20 }, kind: 'near', offset: 1, gain: 0.8, delay: false, jitter: 0 })],
    ['Drop pod', (E) => E.play('sky:pod', { pos: { x: 10, y: 0, z: -30 }, kind: 'report', gain: 0.9, delay: false })],
    ['Strike jet', (E) => E.play('sky:jet', { pos: { x: -60, y: 40, z: -80 }, kind: 'report', gain: 0.9, delay: false })],
  ]) misc.append(btn(label, fn));
}

main();
