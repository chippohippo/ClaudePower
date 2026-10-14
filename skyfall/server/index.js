// SKYFALL dedicated server (command line). The desktop app can host the same server from its menu.
//
//   npm run server                      serves ./dist if built + the websocket API on :3000
//   PORT=8080 npm run server            or: node server/index.js --port 8080
//
// Players join with the host's address, e.g. 203.0.113.7:3000 (forward that TCP port on the router
// for internet play; LAN players use the LAN address printed at start-up).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const port = +(arg('--port') || process.env.PORT || 3000);

startServer({ port, host: process.env.HOST || '0.0.0.0', dist: path.join(__dirname, '..', 'dist'), queueWait: +(process.env.QUEUE_WAIT || 8) })
  .catch((e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use` : e); process.exit(1); });
