// Runs the SKYFALL game server inside an Electron utility process (its own OS process, so a busy
// 100-player simulation never stalls the game window). Controlled by desktop/main.cjs:
//   → { t: 'start', port, dist }        ← { t: 'ready', port, lan } | { t: 'error', error }
//   → { t: 'stop' }                     ← (process exits)
//                                        ← { t: 'stats', players, matches, inMatch } every 2 s
//                                        ← { t: 'log', m }

import { startServer, lanAddresses } from '../server/server.js';

const port = process.parentPort;
let srv = null, statsTimer = null;

port.on('message', async ({ data }) => {
  if (!data) return;
  if (data.t === 'start' && !srv) {
    try {
      srv = await startServer({ port: data.port, dist: data.dist, name: 'SKYFALL server', log: (m) => port.postMessage({ t: 'log', m }) });
      port.postMessage({ t: 'ready', port: srv.port, lan: lanAddresses() });
      statsTimer = setInterval(() => port.postMessage({ t: 'stats', ...srv.stats() }), 2000);
    } catch (e) {
      port.postMessage({ t: 'error', error: e.code === 'EADDRINUSE' ? `port ${data.port} is already in use` : e.code === 'EACCES' ? `no permission to use port ${data.port}` : String(e.message || e) });
    }
  } else if (data.t === 'stop') {
    clearInterval(statsTimer);
    if (srv) await srv.close();
    process.exit(0);
  }
});
