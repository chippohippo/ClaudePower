// Emberfall's static file server for playing on your own computer: `node tools/serve.mjs [port]`
// (nothing to install but Node). Serves this folder on http://localhost:<port>/ to this computer
// only, takes the next port if that one's busy, and opens the start menu in your browser
// (--no-open to skip that). play.sh / play.command use it when Node is there.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};
const args = process.argv.slice(2), open = !args.includes('--no-open');
const first = +(args.find((a) => /^\d+$/.test(a)) ?? process.env.PORT ?? 8765);

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(ROOT, `.${path}`);
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) { res.writeHead(302, { Location: `${path}/` }).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

let port = first;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < first + 20) { port++; server.listen(port, '127.0.0.1'); return; }
  console.error(`Emberfall: could not start the server (${e.message})`);
  process.exit(1);
});
server.on('listening', () => {
  const url = `http://localhost:${port}/start.html`;
  console.log(`Emberfall is running at ${url}\n(this computer only; Ctrl+C or close this window to stop)`);
  if (!open) return;
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
});
server.listen(port, '127.0.0.1');
