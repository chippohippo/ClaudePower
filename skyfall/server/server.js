// SKYFALL authoritative game server as a module: static hosting of the built client, parties
// (private lobbies via 5-letter codes), Trios/Sixes matchmaking with bot fill, and 30 Hz match
// simulation with 20 Hz snapshots. Started by the CLI (server/index.js), by the desktop app's
// HOST button and by its dedicated-server mode (desktop/main.cjs).

import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { Server } from 'socket.io';
import { Match } from '../src/sim/match.js';
import { Bot } from '../src/sim/bot.js';
import { MODES, SERVER_TICK, NET_VERSION } from '../src/shared/constants.js';

// LAN addresses players on the same network can join with
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

// Resolves once listening: { port, close(), stats() }. Rejects when the port is taken.
export function startServer({ port = 3000, host = '0.0.0.0', dist = null, log = console.log, queueWait = 8, name = 'SKYFALL server' } = {}) {
  const QUEUE_WAIT = queueWait; // seconds to gather parties before launching
  const app = express();
  if (dist && fs.existsSync(dist)) app.use(express.static(dist));
  app.get('/health', (_, res) => res.json({ ok: true, name, version: NET_VERSION, matches: matches.size, players: io.engine.clientsCount }));

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' }, perMessageDeflate: { threshold: 1024 } });
  // clients built from a different protocol version would desync: refuse them with a clear reason
  io.use((socket, next) => {
    const v = socket.handshake.auth && socket.handshake.auth.v;
    if (v !== undefined && v !== NET_VERSION) return next(new Error(`version mismatch: server ${NET_VERSION}, client ${v}`));
    next();
  });

  const parties = new Map(); // code -> party
  const queues = { trios: [], sixes: [] };
  const queueTimers = { trios: null, sixes: null };
  const matches = new Map();
  let nextMatch = 1;

  const code = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

  function partyView(p, sid) {
    return {
      code: p.code, mode: p.mode, status: p.status,
      members: p.members.map((m) => ({ name: m.name, legend: m.legend, leader: m.id === p.leader })),
      isLeader: p.leader === sid,
    };
  }

  function broadcastParty(p) {
    for (const m of p.members) io.to(m.id).emit('party', partyView(p, m.id));
  }

  function leaveParty(socket) {
    const p = socket.data.party;
    if (!p) return;
    p.members = p.members.filter((m) => m.id !== socket.id);
    socket.data.party = null;
    if (!p.members.length) {
      parties.delete(p.code);
      for (const q of Object.values(queues)) { const i = q.indexOf(p); if (i >= 0) q.splice(i, 1); }
      return;
    }
    if (p.leader === socket.id) p.leader = p.members[0].id;
    broadcastParty(p);
  }

  function enqueue(p) {
    if (p.status === 'queued' || p.status === 'in match') return;
    p.status = 'queued';
    broadcastParty(p);
    const q = queues[p.mode];
    q.push(p);
    const humans = q.reduce((s, x) => s + x.members.length, 0);
    if (humans >= 100) return launch(p.mode);
    if (!queueTimers[p.mode]) queueTimers[p.mode] = setTimeout(() => launch(p.mode), QUEUE_WAIT * 1000);
  }

  function launch(mode) {
    clearTimeout(queueTimers[mode]);
    queueTimers[mode] = null;
    const q = queues[mode].splice(0);
    if (!q.length) return;
    const size = MODES[mode].squadSize;
    // pack parties into squads: full parties first, then fill partial squads with solo/duo parties
    const squads = [];
    for (const p of [...q].sort((a, b) => b.members.length - a.members.length)) {
      const members = p.members.slice(0, size);
      const fit = squads.find((s) => s.members.length + members.length <= size && p.fill !== false);
      if (fit && members.length < size) fit.members.push(...members);
      else squads.push({ members: [...members] });
    }
    const id = nextMatch++;
    const sockets = new Map();
    const match = new Match({
      mode,
      send: (pid, msg) => { const s = sockets.get(pid); if (s) s.emit('m', msg); },
    });
    const ids = match.setupSquads(squads.map((s) => ({ members: s.members.map((m) => ({ id: m.id, name: m.name, legend: m.legend })) })));
    for (const { clientId, id: pid } of ids) {
      const s = io.sockets.sockets.get(clientId);
      if (!s) continue;
      sockets.set(pid, s);
      s.data.match = { id, pid };
      s.emit('match:starting', { mode });
    }
    for (const p of q) { p.status = 'in match'; broadcastParty(p); }
    const entry = { id, match, sockets, created: Date.now(), overAt: 0 };
    matches.set(id, entry);
    log(`[match ${id}] ${mode} started with ${ids.length} humans, ${match.list.length - ids.length} bots`);
    setTimeout(() => match.start(), 1500);
  }

  io.on('connection', (socket) => {
    socket.data.party = null;

    socket.on('party:create', ({ name, legend, mode }) => {
      leaveParty(socket);
      const p = { code: code(), mode: MODES[mode] ? mode : 'trios', leader: socket.id, members: [{ id: socket.id, name: String(name || 'Player').slice(0, 16), legend }], status: 'lobby' };
      parties.set(p.code, p);
      socket.data.party = p;
      broadcastParty(p);
    });

    socket.on('party:join', ({ code: c, name, legend }) => {
      const p = parties.get(String(c || '').toUpperCase());
      if (!p) return socket.emit('party:error', 'Party not found');
      if (p.members.length >= MODES[p.mode].squadSize) return socket.emit('party:error', 'Party is full');
      if (p.status !== 'lobby') return socket.emit('party:error', 'Party is already in a match');
      leaveParty(socket);
      p.members.push({ id: socket.id, name: String(name || 'Player').slice(0, 16), legend });
      socket.data.party = p;
      broadcastParty(p);
    });

    socket.on('party:update', ({ name, legend, mode }) => {
      const p = socket.data.party;
      if (!p) return;
      const m = p.members.find((x) => x.id === socket.id);
      if (m) { m.name = String(name || m.name).slice(0, 16); m.legend = legend || m.legend; }
      if (p.leader === socket.id && MODES[mode] && p.status === 'lobby') p.mode = mode;
      broadcastParty(p);
    });

    socket.on('party:leave', () => leaveParty(socket));
    socket.on('party:rejoin', () => { const p = socket.data.party; if (p && p.status === 'in match') { p.status = 'lobby'; broadcastParty(p); } });

    socket.on('party:start', () => {
      const p = socket.data.party;
      if (!p || p.leader !== socket.id) return;
      enqueue(p);
    });

    socket.on('queue:solo', ({ name, legend, mode }) => {
      leaveParty(socket);
      const p = { code: code(), mode: MODES[mode] ? mode : 'trios', leader: socket.id, members: [{ id: socket.id, name: String(name || 'Player').slice(0, 16), legend }], status: 'lobby' };
      parties.set(p.code, p);
      socket.data.party = p;
      enqueue(p);
    });

    socket.on('m', (msg) => {
      const mm = socket.data.match;
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'ping') return socket.emit('m', { t: 'pong', c: msg.c });
      if (!mm) return;
      const entry = matches.get(mm.id);
      if (entry) entry.match.handle(mm.pid, msg);
    });

    const dropFromMatch = () => {
      const mm = socket.data.match;
      if (!mm) return;
      const entry = matches.get(mm.id);
      socket.data.match = null;
      if (!entry) return;
      entry.sockets.delete(mm.pid);
      // a bot takes over for the disconnected player so their squad isn't left a player down
      const p = entry.match.players.get(mm.pid);
      if (p && !p.isBot) { p.isBot = true; p.bot = new Bot(entry.match, p); }
    };
    socket.on('leave', dropFromMatch);
    socket.on('disconnect', () => { dropFromMatch(); leaveParty(socket); });
  });

  // fixed-rate simulation of all matches
  const DT = 1 / SERVER_TICK;
  let last = performance.now(), acc = 0;
  const tickTimer = setInterval(() => {
    const now = performance.now();
    acc += (now - last) / 1000;
    last = now;
    let n = 0;
    while (acc >= DT && n < 5) {
      for (const [id, e] of matches) {
        e.match.tick(DT);
        if (e.match.over && !e.overAt) e.overAt = Date.now();
        if ((e.overAt && Date.now() - e.overAt > 30000) || (!e.sockets.size && Date.now() - e.created > 10000)) {
          matches.delete(id);
          log(`[match ${id}] closed`);
        }
      }
      acc -= DT;
      n++;
    }
    if (acc > DT * 5) acc = 0;
  }, 1000 / SERVER_TICK / 2);


  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const actual = server.address().port;
      log(`${name} listening on port ${actual} (${[host === '0.0.0.0' ? 'all interfaces' : host, ...lanAddresses()].join(', ')})`);
      resolve({
        port: actual,
        stats: () => ({ players: io.engine.clientsCount, matches: matches.size, inMatch: [...matches.values()].reduce((n, e) => n + e.sockets.size, 0) }),
        close: () => new Promise((done) => {
          clearInterval(tickTimer);
          for (const t of Object.values(queueTimers)) clearTimeout(t);
          io.close();
          server.close(() => done());
          setTimeout(done, 1500);
        }),
      });
    });
  });
}
