// App shell: renderer, menu (legend select, Trios/Sixes, solo queue, friends parties via the
// server, firing range), settings, the main loop and game session lifecycle.

import * as THREE from 'three';
import { io } from 'socket.io-client';
import { LEGENDS, LEGEND_IDS, ROLES, ROLE_IDS, roleTargets } from '../shared/legends.js';
import { ROLE_ICON } from './roleicons.js';
import { applyPalette, setRimStrength } from './palette.js';
import { assets } from './assets.js';
import { STYLE } from './comic.js';
import { Input, settings, saveSettings } from './input.js';
import { HUD } from './hud.js';
import { audio } from './audio.js';
import { Game } from './game.js';
import { WorkerTransport, SocketTransport } from './net.js';
import { NET_VERSION } from '../shared/constants.js';

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
app.assets = assets; // debug / asset tests
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
  renderLegends();
  click();
  pushParty();
}));

function click() { audio.play('ui', null, { vol: 0.5 }); }

// Sixes role picture: who has which role (party members, or just you when solo).
function roleCounts() {
  const picks = state.party ? state.party.members.map((m) => m.legend) : [state.legend];
  const c = { tank: 0, dps: 0, support: 0 };
  for (const l of picks) if (LEGENDS[l]) c[LEGENDS[l].cls]++;
  return c;
}

function renderLegends() {
  const sixes = state.mode === 'sixes';
  const counts = roleCounts();
  const target = roleTargets(6);
  // when the player's current pick is counted, ask "would this card's role still be needed?"
  const myRole = LEGENDS[state.legend].cls;
  // nudges only matter once friends are in the party (solo: bots fill everything around you)
  const party = sixes && state.party && state.party.members.length > 1;
  const open = (r) => target[r] - (counts[r] - (r === myRole ? 1 : 0));
  const mostOpen = Math.max(...ROLE_IDS.map(open));
  const needed = (r) => party && open(r) > 0 && open(r) === mostOpen;
  const full = (r) => party && open(r) <= 0;
  $('#role-bar').classList.toggle('hidden', !sixes);
  if (sixes) {
    $('#role-bar').innerHTML = ROLE_IDS.map((r) => {
      const R = ROLES[r], n = counts[r], t = target[r];
      const st = n < t ? 'open' : n > t ? 'over' : 'done';
      const pips = Array.from({ length: t }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
      return `<div class="rslot ${st}" style="--rc:${R.color}"><span class="ricon">${ROLE_ICON[r]}</span><div><b>${R.label}</b><div class="pips">${pips}</div></div><small>${n < t ? `${t - n} OPEN` : n > t ? 'OVER' : 'FILLED'}</small></div>`;
    }).join('') + '<div class="rnote">Sixes plays 2 TANK · 2 DPS · 2 SUPPORT. Pick anything — bots fill the open roles.</div>';
  }
  $('#legend-grid').innerHTML = LEGEND_IDS.map((id) => {
    const L = LEGENDS[id], R = ROLES[L.cls];
    const tag = needed(L.cls) ? '<span class="need">NEEDED</span>' : full(L.cls) && id !== state.legend ? '<span class="full">ROLE FILLED</span>' : '';
    const cls = ['lcard', id === state.legend ? 'sel' : '', needed(L.cls) ? 'needed' : '', full(L.cls) && id !== state.legend ? 'dim' : ''].join(' ');
    return `<div class="${cls}" data-id="${id}" style="--c:${L.color};--rc:${R.color}"><div class="glyph"></div><span class="rchip" title="${R.label}">${ROLE_ICON[L.cls]}</span><div class="nm">${L.name}</div><div class="rl">${R.label} · ${L.role.toUpperCase()}</div>${tag}</div>`;
  }).join('');
  document.querySelectorAll('.lcard').forEach((c) => {
    c.addEventListener('click', () => { state.legend = c.dataset.id; localStorage.setItem('skyfall.legend', state.legend); renderLegends(); click(); pushParty(); });
    c.addEventListener('mouseenter', () => audio.play('ui_hover', null, { vol: 0.4 }));
  });
  const L = LEGENDS[state.legend], R = ROLES[L.cls];
  $('#legend-detail').style.setProperty('--c', L.color);
  $('#legend-detail').innerHTML = `<h3 style="color:${L.color}">${L.name} <span class="drole" style="color:${R.color}">${ROLE_ICON[L.cls]}${R.label}</span></h3><div class="blurb">${L.role.toUpperCase()} — ${L.blurb}</div>
    ${sixes ? `<div class="ab perk" style="--rc:${R.color}"><i>ROLE PERK (SIXES)</i><b>${R.label}</b> — ${R.perk}</div>` : '<div class="ab perk free"><i>TRIOS</i>Free pick — no role limits.</div>'}
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
// friend/foe clarity: colour-vision preset and enemy rim strength apply live
const applyClarity = () => {
  applyPalette(settings.colorVision || 'default');
  setRimStrength(settings.enemyRim ?? 1, STYLE.comic);
};
applyClarity();
assets.load();
$('#s-cv').value = settings.colorVision || 'default';
$('#s-cv').addEventListener('change', (e) => { settings.colorVision = e.target.value; saveSettings(); applyClarity(); });
$('#s-rim').value = String(settings.enemyRim ?? 1);
$('#s-rim').addEventListener('change', (e) => { settings.enemyRim = +e.target.value; saveSettings(); applyClarity(); });
$('#s-art').value = settings.artStyle || 'comic';
$('#s-art').addEventListener('change', (e) => { settings.artStyle = e.target.value; saveSettings(); hud.toast('Art style applies from the next match'); });
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
    audioReady = audio.init().then(() => assets.load()).then(() => audio.useSamples(assets.sounds)).then(() => {
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
  // imported art (public/assets) must be ready before the match builds its scene; messages that
  // arrive meanwhile are queued, not dropped
  let queue = null;
  const handle = (msg) => {
    if (msg.t === 'welcome') {
      if (app.game) app.game.dispose();
      app.game = new Game(app, transport, msg);
      $('#menu').classList.add('hidden');
      input.lock();
      return;
    }
    if (app.game) app.game.onMessage(msg);
  };
  transport.onMessage((msg) => {
    if (assets.done && !queue) return handle(msg);
    if (!queue) { queue = []; assets.load().then(() => { const q = queue; queue = null; q.forEach(handle); }); }
    queue.push(msg);
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

// ------------------------------------------------------------------ online: direct IP connect + hosting
// Any SKYFALL server (npm run server, the desktop app's HOST SERVER, or its dedicated-server mode)
// is reached by address. PLAY queues on the connected server (bots fill the lobby); without one it
// runs offline in a Web Worker.
const desktop = window.skyfallDesktop || null; // preload bridge in the desktop app (desktop/preload.cjs)
const DEFAULT_PORT = 3000;
const params = new URLSearchParams(location.search);
let lastAddr = '';
try { lastAddr = localStorage.getItem('skyfall.server') || ''; } catch { /* storage blocked */ }

// "1.2.3.4" → http://1.2.3.4:3000 · "host:8080" → http://host:8080 · full URLs pass through
function serverUrl(addr) {
  const a = String(addr || '').trim();
  if (!a) return null;
  if (/^https?:\/\//i.test(a)) return a.replace(/\/+$/, '');
  const host = a.replace(/\/+$/, '');
  return /:\d+$/.test(host) || /^\[.*\]:\d+$/.test(host) ? `http://${host}` : `http://${host}:${DEFAULT_PORT}`;
}
const setStatus = (t, cls = '') => { const el = $('#server-status'); el.textContent = t; el.className = cls; };

let current = null; // latest socket, connected or still trying (older attempts are torn down)
function connect(addr, { quiet = false, remember = true } = {}) {
  const url = serverUrl(addr);
  if (!url) return;
  if (current) { current.removeAllListeners(); current.disconnect(); }
  app.socket = null;
  state.party = null;
  renderParty();
  setStatus(`connecting to ${addr}…`);
  const socket = (current = io(url, { transports: ['websocket'], reconnectionAttempts: quiet ? 1 : 5, timeout: 4000, auth: { v: NET_VERSION } }));
  socket.on('connect', () => {
    app.socket = socket;
    setStatus(`connected to ${addr} — PLAY queues here`, 'ok');
    if (remember) { try { localStorage.setItem('skyfall.server', addr); } catch { /* ignore */ } }
  });
  socket.on('connect_error', (e) => {
    const why = /version/i.test(e.message) ? e.message : 'unreachable';
    setStatus(`${addr}: ${why} — PLAY runs offline`, 'bad');
    if (/version/i.test(e.message)) socket.disconnect();
  });
  socket.on('disconnect', () => { if (app.socket === socket) { app.socket = null; setStatus(`disconnected from ${addr}`, 'bad'); } });
  socket.on('party', (p) => { state.party = p; renderParty(); });
  socket.on('party:error', (msg) => hud.toast(msg));
  socket.on('match:starting', () => {
    startSession(new SocketTransport(socket));
    ensureAudio();
    $('#loading').classList.remove('hidden');
    $('#loading .txt').textContent = 'DEPLOYING TO SKYFALL…';
    const wait = setInterval(() => { if (app.game) { clearInterval(wait); $('#loading').classList.add('hidden'); } }, 50);
  });
}

$('#server-addr').value = params.get('server') || lastAddr;
$('#btn-connect').addEventListener('click', () => { click(); connect($('#server-addr').value); });
$('#server-addr').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect($('#server-addr').value); });

// start-up: ?server= wins; a page served by a SKYFALL server joins it; the dev server tries :3000;
// the desktop app quietly retries the last server it joined
if (params.get('server')) connect(params.get('server'));
else if (location.port === '5173') connect(`${location.hostname}:${DEFAULT_PORT}`, { quiet: true, remember: false });
else if (!desktop && /^https?:$/.test(location.protocol)) connect(location.host, { quiet: true, remember: false });
else if (desktop && lastAddr) connect(lastAddr, { quiet: true });

// hosting (desktop app): the main process runs the same server in a utility process, tries UPnP to
// open the port on the router, and reports LAN / internet addresses to share
if (desktop) {
  document.querySelectorAll('.desktop-only').forEach((e) => e.classList.remove('hidden'));
  const info = $('#host-info');
  const copyBtn = (text) => `<button data-copy="${text}">COPY</button>`;
  const renderHost = (h) => {
    const on = !!(h && h.running);
    $('#btn-host').textContent = on ? 'STOP HOSTING' : 'HOST SERVER';
    $('#btn-host').classList.toggle('on', on);
    info.classList.toggle('hidden', !h || (!on && !h.error));
    if (!h) return;
    if (h.error) { info.innerHTML = `<span class="warn">Could not host: ${h.error}</span>`; return; }
    if (!on) return;
    const lan = (h.lan || []).map((ip) => `<b>${ip}:${h.port}</b>${copyBtn(`${ip}:${h.port}`)}`).join(' ');
    const pub = h.publicIp ? `<b>${h.publicIp}:${h.port}</b>${copyBtn(`${h.publicIp}:${h.port}`)}` : h.publicIp === false ? '<i>could not detect — search "what is my IP" and add :' + h.port + '</i>' : '<i>looking up…</i>';
    const upnp = h.upnp === 'pending' ? 'opening the port on your router (UPnP)…'
      : h.upnp && h.upnp.ok ? `<span class="ok">router port ${h.port} opened automatically (UPnP)</span>`
      : `<span class="warn">forward TCP port ${h.port} on your router to this PC for internet play${h.upnp && h.upnp.error ? ` (UPnP: ${h.upnp.error})` : ''}</span>`;
    const cgnat = h.cgnat ? '<br><span class="warn">your router\'s WAN address differs from your public IP (carrier-grade NAT?) — internet players may not reach you; LAN and VPN (Tailscale, ZeroTier) still work</span>' : '';
    info.innerHTML = `Hosting on port ${h.port} · ${h.players || 0} connected · ${h.matches || 0} matches<br>LAN: ${lan || '—'}<br>Internet: ${pub}<br>${upnp}${cgnat}`;
  };
  info.addEventListener('click', (e) => { const t = e.target.dataset && e.target.dataset.copy; if (t) { desktop.copy(t); hud.toast(`Copied ${t}`); } });
  desktop.onHostEvent((h) => renderHost(h));
  desktop.hostStatus().then(renderHost);
  $('#btn-host').addEventListener('click', async () => {
    click();
    const st = await desktop.hostStatus();
    if (st && st.running) { await desktop.stopHost(); renderHost(null); if (current) { current.removeAllListeners(); current.disconnect(); current = null; } app.socket = null; setStatus('not connected — PLAY runs offline vs bots'); return; }
    const port = Math.max(1, Math.min(65535, +$('#host-port').value || DEFAULT_PORT));
    $('#btn-host').textContent = 'STARTING…';
    const h = await desktop.host({ port });
    renderHost(h);
    if (h && h.running) connect(`127.0.0.1:${h.port}`, { remember: false });
  });
}

function pushParty() {
  if (app.socket && state.party) app.socket.emit('party:update', { name: state.name, legend: state.legend, mode: state.mode });
}

$('#btn-create').addEventListener('click', () => {
  click();
  if (!app.socket) return hud.toast(desktop ? 'Connect to a server or HOST SERVER first' : 'Connect to a server first (enter its IP:PORT)');
  ensureAudio();
  app.socket.emit('party:create', { name: state.name, legend: state.legend, mode: state.mode });
});
$('#btn-join').addEventListener('click', () => {
  click();
  if (!app.socket) return hud.toast('Connect to a server first');
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
  renderLegends();
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
