// Offline host: runs the authoritative match simulation off the main thread so 99 bots never
// steal frame time from rendering. Speaks the exact same protocol as the online server.

import { Match } from '../sim/match.js';
import { SERVER_TICK } from '../shared/constants.js';

let match = null;
let humanId = 0;
let timer = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.t === 'start') {
    match = new Match({
      seed: (Math.random() * 1e9) | 0,
      mode: m.mode,
      practice: !!m.practice,
      botSkill: m.botSkill ?? 0.5,
      send: (pid, msg) => { if (pid === humanId) self.postMessage(msg); },
    });
    const ids = match.setupSquads([{ members: [{ id: 'local', name: m.name, legend: m.legend }] }]);
    humanId = ids[0].id;
    match.start();
    let last = performance.now();
    let acc = 0;
    const dt = 1 / SERVER_TICK;
    timer = setInterval(() => {
      const now = performance.now();
      acc += (now - last) / 1000;
      last = now;
      let n = 0;
      while (acc >= dt && n < 4) { match.tick(dt); acc -= dt; n++; }
      if (acc > dt * 4) acc = 0;
    }, 1000 / SERVER_TICK / 2);
    return;
  }
  if (m.t === 'ping') { self.postMessage({ t: 'pong', c: m.c }); return; }
  if (match) match.handle(humanId, m);
};
