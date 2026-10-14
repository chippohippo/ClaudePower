// SKYFALL desktop app (Electron main process).
//
//   SKYFALL.exe                        the game (offline vs bots, or join any server by IP:PORT)
//   SKYFALL.exe --connect 1.2.3.4:3000 the game, joining that server on start
//   SKYFALL.exe --server [--port 3000] dedicated server with a small status window
//   SKYFALL.exe --server --nogui       dedicated server without a window (log in <userData>/server.log)
//
// The game page is served from the packaged dist/ on http://127.0.0.1 (a secure context that may still
// open plain ws:// connections to other machines, which a custom secure scheme could not). HOST SERVER
// and --server run server/server.js in a utility process, try UPnP to open the port on the router,
// and report the LAN and internet addresses friends join with.

const { app, BrowserWindow, ipcMain, utilityProcess, clipboard, shell, Menu, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const upnp = require('./upnp.cjs');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ICON = path.join(__dirname, 'icon.png');
const argv = process.argv.slice(app.isPackaged ? 1 : 2);
const flag = (k) => argv.includes(k);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const DEDICATED = flag('--server'), NOGUI = flag('--nogui');
const DEFAULT_PORT = +(opt('--port') || 3000);
const UI_PORT = 37777; // fixed so settings (localStorage, per origin) survive restarts

app.setName('SKYFALL');
if (process.platform === 'win32') app.setAppUserModelId('com.skyfall.game');

// ------------------------------------------------------------------ static client
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8',
};
let clientServer = null;
function serveClient() {
  const srv = (clientServer = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }));
  return new Promise((resolve) => {
    srv.once('error', () => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port))); // fixed port taken: any free one
    srv.listen(UI_PORT, '127.0.0.1', () => resolve(srv.address().port));
  });
}

// ------------------------------------------------------------------ hosting
let host = null;          // { proc, state }
const listeners = new Set();
const logFile = () => path.join(app.getPath('userData'), 'server.log');
function emitHost() {
  const st = host ? host.state : null;
  for (const wc of listeners) if (!wc.isDestroyed()) wc.send('host:event', st);
}
function logLine(m) {
  const line = `[${new Date().toISOString()}] ${m}`;
  if (host) { host.state.log.push(line); if (host.state.log.length > 200) host.state.log.shift(); }
  if (DEDICATED) { console.log(line); try { fs.appendFileSync(logFile(), line + '\n'); } catch { /* read-only */ } }
}

async function publicIp() {
  for (const url of ['https://api.ipify.org?format=json', 'https://ifconfig.me/ip']) {
    try {
      const r = await Promise.race([net.fetch(url), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
      const t = (await r.text()).trim();
      const ip = t.startsWith('{') ? JSON.parse(t).ip : t;
      if (/^[\d.]+$|^[0-9a-f:]+$/i.test(ip)) return ip;
    } catch { /* next */ }
  }
  return null;
}

function startHost(port) {
  if (host && host.state.running) return Promise.resolve(host.state);
  return new Promise((resolve) => {
    const proc = utilityProcess.fork(path.join(__dirname, 'host.mjs'), [], { serviceName: 'SKYFALL server', stdio: 'pipe' });
    const state = { running: false, port, lan: [], publicIp: null, upnp: 'pending', cgnat: false, players: 0, matches: 0, error: null, log: [] };
    host = { proc, state };
    proc.stdout && proc.stdout.on('data', (d) => logLine(String(d).trim()));
    proc.stderr && proc.stderr.on('data', (d) => logLine(String(d).trim()));
    proc.on('message', (msg) => {
      if (msg.t === 'ready') {
        Object.assign(state, { running: true, port: msg.port, lan: msg.lan });
        logLine(`hosting on port ${msg.port} — LAN ${msg.lan.map((a) => `${a}:${msg.port}`).join(', ') || 'none'}`);
        resolve(state);
        emitHost();
        // internet reachability: public IP + UPnP port mapping, reported as they arrive
        publicIp().then((ip) => { state.publicIp = ip || false; if (ip) logLine(`public address ${ip}:${msg.port}`); checkCgnat(state); emitHost(); });
        upnp.mapPort(msg.port).then((r) => {
          state.upnp = { ok: true, externalIp: r.externalIp };
          logLine(`UPnP: router forwards TCP ${msg.port} → ${r.localIp}${r.externalIp ? ` (router WAN ${r.externalIp})` : ''}`);
        }).catch((e) => {
          state.upnp = { ok: false, error: e.message };
          logLine(`UPnP unavailable (${e.message}) — forward TCP ${msg.port} to this PC for internet play`);
        }).finally(() => { checkCgnat(state); emitHost(); });
      } else if (msg.t === 'error') {
        state.error = msg.error;
        logLine(`could not host: ${msg.error}`);
        resolve({ running: false, error: msg.error });
        proc.kill();
        host = null;
      } else if (msg.t === 'stats') {
        Object.assign(state, { players: msg.players, matches: msg.matches });
        emitHost();
      } else if (msg.t === 'log') logLine(msg.m);
    });
    proc.on('exit', () => { if (host && host.proc === proc) { host = null; emitHost(); } });
    proc.postMessage({ t: 'start', port, dist: DIST });
  });
}
// a router WAN address that differs from the public one means another NAT (carrier-grade) in between
function checkCgnat(state) {
  const wan = state.upnp && state.upnp.externalIp;
  state.cgnat = !!(wan && state.publicIp && wan !== state.publicIp);
}
// Resolves once the server process has exited (or was killed after 2 s) and the router mapping is gone.
async function stopHost() {
  if (!host) return;
  const { proc, state } = host;
  host = null;
  emitHost();
  const exited = new Promise((done) => { proc.once('exit', done); setTimeout(() => { proc.kill(); done(); }, 2000); });
  proc.postMessage({ t: 'stop' });
  const unmapped = state.running ? Promise.race([upnp.unmapPort(state.port).catch(() => {}), new Promise((d) => setTimeout(d, 2000))]) : null;
  await Promise.all([exited, unmapped]);
  logLine('server stopped');
}

ipcMain.handle('host:start', (_, o) => startHost(+(o && o.port) || DEFAULT_PORT));
ipcMain.handle('host:stop', () => stopHost());
ipcMain.handle('host:status', () => (host ? host.state : null));
ipcMain.handle('clipboard', (_, t) => clipboard.writeText(t));
ipcMain.handle('fullscreen', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setFullScreen(!w.isFullScreen()); });
ipcMain.handle('quit', () => app.quit());

// ------------------------------------------------------------------ windows
function makeWindow(opts) {
  const win = new BrowserWindow({
    backgroundColor: '#0b0f14', icon: ICON, autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false, additionalArguments: [`--skyfall-version=${app.getVersion()}`] },
    ...opts,
  });
  const wc = win.webContents; // win.webContents throws once the window is destroyed
  listeners.add(wc);
  win.on('closed', () => listeners.delete(wc));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
  });
  return win;
}

async function startGame() {
  const port = await serveClient();
  const win = makeWindow({ width: 1600, height: 900, minWidth: 1024, minHeight: 600, title: 'SKYFALL' });
  win.maximize();
  const connect = opt('--connect');
  win.loadURL(`http://127.0.0.1:${port}/${connect ? `?server=${encodeURIComponent(connect)}` : ''}`);
  win.on('closed', () => app.quit());
}

async function startDedicated() {
  const st = await startHost(DEFAULT_PORT);
  if (NOGUI) { if (!st.running) app.exit(1); return; }
  const win = makeWindow({ width: 760, height: 560, title: 'SKYFALL Dedicated Server', resizable: true });
  win.loadFile(path.join(__dirname, 'server.html'), { query: { port: String(DEFAULT_PORT) } });
  win.on('closed', () => app.quit());
}

// ------------------------------------------------------------------ lifecycle
if (!DEDICATED && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    return DEDICATED ? startDedicated() : startGame();
  });
  // stop the hosted server (and remove the router mapping) before the app goes away
  let stopping = false;
  app.on('before-quit', (e) => {
    if (!host || stopping) return;
    e.preventDefault();
    stopping = true;
    stopHost().finally(() => app.quit());
  });
  app.on('window-all-closed', () => { if (!(DEDICATED && NOGUI)) app.quit(); });
  // the page's keep-alive connections to the local client server would otherwise hold shutdown open
  app.on('will-quit', () => { if (clientServer) { clientServer.closeAllConnections(); clientServer.close(); clientServer = null; } });
  // SKYFALL_SELFTEST=1: host, wait, quit — checks start-up and a clean shutdown without a test driver
  if (process.env.SKYFALL_SELFTEST) {
    const t0 = Date.now(), say = (m) => fs.appendFileSync(process.env.SKYFALL_SELFTEST, `[selftest +${Date.now() - t0}ms] ${m}\n`);
    for (const ev of ['before-quit', 'will-quit', 'quit']) app.on(ev, () => say(ev));
    app.whenReady().then(async () => {
      await new Promise((r) => setTimeout(r, 3000));
      const st = process.env.SKYFALL_SELFTEST_NOHOST ? {} : await startHost(DEFAULT_PORT);
      say(`host running=${st.running} port=${st.port} error=${st.error}`);
      await new Promise((r) => setTimeout(r, 3000));
      say(`players=${host && host.state.players} upnp=${JSON.stringify(host && host.state.upnp)}`);
      app.quit();
    });
  }
}
