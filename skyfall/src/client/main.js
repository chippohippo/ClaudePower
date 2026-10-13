// App shell: renderer, menu (legend select, Trios/Sixes, solo queue, friends parties via the
// server, firing range), settings, the main loop and game session lifecycle.

import * as THREE from 'three';
import { io } from 'socket.io-client';
import { LEGENDS, LEGEND_IDS } from '../shared/legends.js';
import { Input, settings, saveSettings } from './input.js';
import { HUD } from './hud.js';
import { audio } from './audio.js';
import { Game } from './game.js';
import { WorkerTransport, SocketTransport } from './net.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#game');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality === 'high', powerPreference: 'high-performance' });
function applyQuality() {
  const q = settings.quality;
  renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 1.5 : q === 'medium' ? 1 : 0.75));
  renderer.shadowMap.enabled = q !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(innerWidth, innerHeight, false);
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
applyQuality();
addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight, false));

const input = new Input(canvas);
const hud = new HUD();
const app = { renderer, input, hud, game: null, transport: null, socket: null };
window.__skyfall = app;
app.audio = audio;

// ------------------------------------------------------------------ menu state
const state = {
  name: localStorage.getItem('skyfall.name') || 'Player' + Math.floor(Math.random() * 900 + 100),
  legend: localStorage.getItem('skyfall.legend') || 'jolt',
  mode: 'trios',
  party: null,
};
if (!LEGENDS[state.legend]) state.legend = 'jolt';
$('#name').value = state.name;
$('#name').addEventListener('input', (e) => { state.name = e.target.value.trim() || 'Player'; localStorage.setItem('skyfall.name', state.name); pushParty(); });

document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => {
  state.mode = b.dataset.mode;
  document.querySelectorAll('.mode').forEach((x) => x.classList.toggle('active', x === b));
  click();
  pushParty();
}));

function click() { audio.play('ui', null, { vol: 0.5 }); }

function renderLegends() {
  $('#legend-grid').innerHTML = LEGEND_IDS.map((id) => {
    const L = LEGENDS[id];
    return `<div class="lcard ${id === state.legend ? 'sel' : ''}" data-id="${id}" style="--c:${L.color}"><div class="glyph"></div><div class="nm">${L.name}</div><div class="rl">${L.role.toUpperCase()}</div></div>`;
  }).join('');
  document.querySelectorAll('.lcard').forEach((c) => {
    c.addEventListener('click', () => { state.legend = c.dataset.id; localStorage.setItem('skyfall.legend', state.legend); renderLegends(); click(); pushParty(); });
    c.addEventListener('mouseenter', () => audio.play('ui_hover', null, { vol: 0.4 }));
  });
  const L = LEGENDS[state.legend];
  $('#legend-detail').style.setProperty('--c', L.color);
  $('#legend-detail').innerHTML = `<h3 style="color:${L.color}">${L.name}</h3><div class="blurb">${L.role.toUpperCase()} — ${L.blurb}</div>
    <div class="ab"><i>PASSIVE</i><b>${L.passive.name}</b> — ${L.passive.desc}</div>
    <div class="ab"><i>TACTICAL [Q]</i><b>${L.tactical.name}</b> — ${L.tactical.desc}</div>
    <div class="ab"><i>ULTIMATE [Z]</i><b>${L.ultimate.name}</b> — ${L.ultimate.desc}</div>`;
}
renderLegends();

// ------------------------------------------------------------------ settings panel
function bindRange(id, key, fmt = (v) => v) {
  const el = $(id);
  el.value = settings[key];
  el.nextElementSibling.textContent = fmt(settings[key]);
  el.addEventListener('input', () => {
    settings[key] = +el.value;
    el.nextElementSibling.textContent = fmt(settings[key]);
    if (key === 'volume') audio.setVolume(settings.volume);
    saveSettings();
  });
}
bindRange('#s-sens', 'sens', (v) => (+v).toFixed(2));
bindRange('#s-adssens', 'adsSens', (v) => (+v).toFixed(2));
bindRange('#s-fov', 'fov');
bindRange('#s-vol', 'volume', (v) => Math.round(v * 100));
bindRange('#s-shake', 'shake', (v) => Math.round(v * 100) + '%');
for (const [id, key] of [['#s-toggleads', 'toggleAds'], ['#s-invert', 'invertY'], ['#s-fps', 'showFps']]) {
  const el = $(id);
  el.checked = settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); if (app.game) app.game.showStats = settings.showFps; });
}
$('#s-quality').value = settings.quality;
$('#s-quality').addEventListener('change', (e) => { settings.quality = e.target.value; saveSettings(); applyQuality(); });
$('#btn-settings').addEventListener('click', () => { click(); $('#settings').classList.remove('hidden'); });
$('#btn-settings2').addEventListener('click', () => { click(); $('#settings').classList.remove('hidden'); });
$('#btn-settings-close').addEventListener('click', () => { click(); $('#settings').classList.add('hidden'); });
$('#btn-controls').addEventListener('click', () => { click(); $('#controls').classList.remove('hidden'); });
$('#btn-controls-close').addEventListener('click', () => { click(); $('#controls').classList.add('hidden'); });

// ------------------------------------------------------------------ audio unlock + loading
let audioReady = null;
function ensureAudio() {
  if (!audioReady) {
    $('#loading').classList.remove('hidden');
    audioReady = audio.init().then(() => {
      audio.setVolume(settings.volume);
      $('#loading').classList.add('hidden');
    });
  }
  audio.resume();
  return audioReady;
}

// ------------------------------------------------------------------ sessions
function startSession(transport) {
  app.transport = transport;
  transport.onMessage((msg) => {
    if (msg.t === 'welcome') {
      if (app.game) app.game.dispose();
      app.game = new Game(app, transport, msg);
      $('#menu').classList.add('hidden');
      input.lock();
      return;
    }
    if (app.game) app.game.onMessage(msg);
  });
}

async function playOffline(practice = false) {
  click();
  await ensureAudio();
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  startSession(new WorkerTransport(worker));
  worker.postMessage({ t: 'start', mode: state.mode, name: state.name, legend: state.legend, practice });
  $('#loading').classList.remove('hidden');
  $('#loading .txt').textContent = practice ? 'LOADING FIRING RANGE…' : 'DEPLOYING TO SKYFALL…';
  const wait = setInterval(() => { if (app.game) { clearInterval(wait); $('#loading').classList.add('hidden'); } }, 50);
}

$('#btn-play').addEventListener('click', async () => {
  if (state.party && app.socket) return startParty();
  if (app.socket && app.socket.connected) {
    click();
    await ensureAudio();
    app.socket.emit('queue:solo', { name: state.name, legend: state.legend, mode: state.mode });
    $('#loading').classList.remove('hidden');
    $('#loading .txt').textContent = 'MATCHMAKING — FILLING LOBBY WITH BOTS…';
    return;
  }
  playOffline(false);
});
$('#btn-range').addEventListener('click', () => playOffline(true));

function leaveGame() {
  if (app.game) app.game.dispose();
  app.game = null;
  if (app.transport) app.transport.close();
  app.transport = null;
  input.unlock();
  $('#pause').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  if (app.socket && state.party) app.socket.emit('party:rejoin', { code: state.party.code });
}
$('#btn-back').addEventListener('click', () => { click(); leaveGame(); });
$('#btn-spectate').addEventListener('click', () => { click(); if (app.game) app.game.spectate(); });
$('#btn-leave').addEventListener('click', () => { click(); leaveGame(); });
$('#btn-resume').addEventListener('click', () => { click(); $('#pause').classList.add('hidden'); input.lock(); });

canvas.addEventListener('click', () => {
  audio.resume();
  if (app.game && !app.game.invOpen && !app.game.boxOpen && !app.game.mapOpen && !app.game.ended) input.lock();
});
document.addEventListener('pointerlockchange', () => {
  const g = app.game;
  const endShown = !document.getElementById('endscreen').classList.contains('hidden');
  const showPause = g && !input.locked && !g.invOpen && !g.boxOpen && !g.mapOpen && !g.ended && !endShown;
  $('#pause').classList.toggle('hidden', !showPause);
});
document.addEventListener('keydown', (e) => {
  const g = app.game;
  if (!g) return;
  if (e.code === 'Escape') {
    if (g.boxOpen) g.closeBox();
    else if (g.invOpen) g.toggleInventory();
    else if (g.mapOpen) g.toggleMap();
  }
  // Tab / M / E while a panel is open are handled by the game loop (Input records key presses
  // even without pointer lock), so only the browser default needs suppressing here.
  if (!input.locked && e.code === input.binds.inventory) e.preventDefault();
});
$('#bigmap canvas').addEventListener('click', (e) => {
  const g = app.game;
  if (!g) return;
  const p = hud.bigMapToWorld(e.clientX, e.clientY, e.target.getBoundingClientRect());
  g.pingAt(p.x, p.z);
});

// ------------------------------------------------------------------ online parties
const params = new URLSearchParams(location.search);
const serverUrl = params.get('server') || (location.port === '5173' ? `${location.protocol}//${location.hostname}:3000` : location.origin);
try {
  const socket = io(serverUrl, { transports: ['websocket'], reconnectionAttempts: 3, timeout: 3000 });
  socket.on('connect', () => { app.socket = socket; $('#server-status').textContent = 'server online'; });
  socket.on('connect_error', () => { $('#server-status').textContent = 'offline — solo vs bots only'; });
  socket.on('disconnect', () => { $('#server-status').textContent = 'disconnected'; });
  socket.on('party', (p) => { state.party = p; renderParty(); });
  socket.on('party:error', (msg) => hud.toast(msg));
  socket.on('match:starting', () => {
    startSession(new SocketTransport(socket));
    ensureAudio();
    $('#loading').classList.remove('hidden');
    $('#loading .txt').textContent = 'DEPLOYING TO SKYFALL…';
    const wait = setInterval(() => { if (app.game) { clearInterval(wait); $('#loading').classList.add('hidden'); } }, 50);
  });
} catch (e) {
  $('#server-status').textContent = 'offline — solo vs bots only';
}

function pushParty() {
  if (app.socket && state.party) app.socket.emit('party:update', { name: state.name, legend: state.legend, mode: state.mode });
}

$('#btn-create').addEventListener('click', () => {
  click();
  if (!app.socket) return hud.toast('Server offline — run `npm run server`');
  ensureAudio();
  app.socket.emit('party:create', { name: state.name, legend: state.legend, mode: state.mode });
});
$('#btn-join').addEventListener('click', () => {
  click();
  if (!app.socket) return;
  ensureAudio();
  app.socket.emit('party:join', { code: $('#party-code').value.toUpperCase(), name: state.name, legend: state.legend });
});
$('#btn-party-leave').addEventListener('click', () => {
  click();
  app.socket && app.socket.emit('party:leave');
  state.party = null;
  renderParty();
});
$('#btn-party-start').addEventListener('click', () => startParty());

async function startParty() {
  click();
  await ensureAudio();
  app.socket.emit('party:start');
}

function renderParty() {
  const p = state.party;
  $('#party-panel').classList.toggle('hidden', !p);
  if (!p) return;
  $('#party-id').textContent = p.code;
  $('#party-members').innerHTML = p.members.map((m) => `<div style="color:${LEGENDS[m.legend]?.color || '#fff'}">${m.name} — ${LEGENDS[m.legend]?.name || ''}${m.leader ? ' ★' : ''}</div>`).join('') + `<div style="color:#9aa3ad">${p.mode.toUpperCase()} · ${p.status}</div>`;
  $('#btn-party-start').disabled = !p.isLeader;
  state.mode = p.mode;
  document.querySelectorAll('.mode').forEach((x) => x.classList.toggle('active', x.dataset.mode === p.mode));
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app.game) {
    try { app.game.frame(dt); } catch (e) { console.error(e); }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
