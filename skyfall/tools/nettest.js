// Online smoke test: two clients form a party, queue, receive the match and stream snapshots.
import { io } from 'socket.io-client';

const URL = process.argv[2] || 'http://localhost:3000';
const a = io(URL, { transports: ['websocket'] });
const b = io(URL, { transports: ['websocket'] });
const stats = { a: { snaps: 0, bytes: 0, welcome: null }, b: { snaps: 0, bytes: 0, welcome: null } };
const hook = (s, k) => s.on('m', (m) => {
  if (m.t === 'welcome') stats[k].welcome = { you: m.you, players: m.players.length, squad: m.players.find((p) => p.id === m.you).squad };
  if (m.t === 'snap') { stats[k].snaps++; stats[k].bytes += JSON.stringify(m).length; stats[k].last = m; }
});
hook(a, 'a'); hook(b, 'b');
a.on('party', (p) => {
  if (!stats.code) { stats.code = p.code; b.emit('party:join', { code: p.code, name: 'Friend', legend: 'halo' }); }
  if (p.members.length === 2 && !stats.started) { stats.started = true; a.emit('party:start'); }
});
a.on('connect', () => a.emit('party:create', { name: 'Leader', legend: 'jolt', mode: 'trios' }));
let seq = 0;
setInterval(() => {
  // both players jump and run forward
  for (const [s, k] of [[a, 'a'], [b, 'b']]) {
    const st = stats[k].last;
    if (!st) continue;
    if (st.me.inShip && st.phase === 'ship' && st.time > 3) s.emit('m', { t: 'act', a: 'jump' });
    s.emit('m', { t: 'in', cmds: [{ seq: ++seq, mx: 0, mz: 1, yaw: 0, pitch: -1, buttons: 4 }] });
  }
}, 1000 / 60);
setTimeout(() => {
  for (const k of ['a', 'b']) {
    const s = stats[k];
    console.log(k, 'welcome', JSON.stringify(s.welcome), 'snaps', s.snaps, 'avg snap bytes', Math.round(s.bytes / Math.max(1, s.snaps)), 'me', s.last && JSON.stringify({ y: s.last.me.ms.y.toFixed(1), mode: s.last.me.ms.mode, alive: s.last.alive, ps: s.last.ps.length }));
  }
  console.log('same squad:', stats.a.welcome && stats.b.welcome && stats.a.welcome.squad === stats.b.welcome.squad);
  process.exit(0);
}, 20000);
