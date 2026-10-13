// A human that never fights: verifies knockdown, elimination, squad-out, spectating and end-of-match messages.
import { Match } from '../src/sim/match.js';

const got = {};
let lastSnap = null;
const m = new Match({ seed: 7, mode: 'trios', send: (pid, msg) => { got[msg.t] = (got[msg.t] || 0) + 1; if (msg.t === 'snap') lastSnap = msg; if (msg.t === 'squadout' || msg.t === 'end') console.log(msg.t, JSON.stringify(msg)); } });
const ids = m.setupSquads([{ members: [{ id: 'h', name: 'Human', legend: 'echo' }] }]);
const me = m.players.get(ids[0].id);
m.start();
let seq = 0, specSeen = false, downSeen = false;
for (let i = 0; i < 30 * 900 && !m.over; i++) {
  if (m.phase === 'ship' && m.ship.t > 8 && me.inShip) m.handle(me.id, { t: 'act', a: 'jump' });
  if (!me.inShip && me.alive) m.handle(me.id, { t: 'in', cmds: [{ seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: -1.2, buttons: 0 }, { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: -1.2, buttons: 0 }] });
  m.tick(1 / 30);
  if (me.downed) downSeen = true;
  if (lastSnap && lastSnap.spec) specSeen = true;
}
console.log('messages', JSON.stringify(got));
console.log('downed seen', downSeen, 'eliminated', me.eliminated, 'spectate snapshots', specSeen, 'match over', m.over, 'time', m.time.toFixed(0));
