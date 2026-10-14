# SKYFALL desktop app, online play and hosting

## Install and play (Windows)

Run `SKYFALL-Setup-<version>.exe`. It installs for the current user, so there is no administrator
prompt. The install goes to `%LOCALAPPDATA%\Programs\SKYFALL`, and you can pick another folder.

The installer adds:

- **SKYFALL**: the game (Start menu, plus the desktop if ticked).
- **SKYFALL Dedicated Server**: a server with a small status window (Start menu).
- **Apps & features** entry and `Uninstall SKYFALL.exe`.

Settings live in `%APPDATA%\SKYFALL` and survive updates and uninstalls. To update, install a newer
setup over the old one.

In the game:

- **F11** toggles fullscreen.
- **Ctrl+Shift+I** opens the developer tools, for bug reports.

## Ways to play

| | How |
|---|---|
| Offline vs bots | **PLAY** while not connected. The whole match runs locally (Web Worker). |
| Firing Range | **FIRING RANGE**. Press **B** to show hitboxes. |
| Join a server | **ONLINE** → type `IP:PORT` (e.g. `203.0.113.7:3000`; the port defaults to 3000) → **CONNECT**. **PLAY** then queues on that server, with bots filling the lobby. |
| Play with friends | All connect to the same server. One clicks **CREATE PARTY** and shares the 5-letter code, the others **JOIN** with it, and the leader clicks **START MATCH**. |
| Host for friends | **HOST SERVER** (choose the port first). Your game connects to it, and the panel lists the addresses friends type in. |

The game reconnects to the last server you joined when it starts.

A server and a client must run the same network protocol (`NET_VERSION` in
`src/shared/constants.js`). A mismatched client is refused with "version mismatch: server N, client M"
rather than desyncing.

Browsers can play too. Every SKYFALL server also serves the web client, so `http://<address>:<port>`
works in Chrome, Edge or Firefox.

## Hosting

**HOST SERVER** in the menu and the **Dedicated Server** shortcut both run the full authoritative
server (`server/server.js`) in a separate process, so a busy match never stalls your game.

| Who joins | Address to give them |
|---|---|
| Same PC | `127.0.0.1:3000` |
| Same network (LAN) | the **LAN** address shown, e.g. `192.168.1.20:3000` |
| Over the internet | the **Internet** address shown, e.g. `203.0.113.7:3000`. Your router must forward the port (below). |

**Router.** On start, the host asks the router to forward the port automatically (UPnP). The panel
says whether that worked.

- If UPnP is off or unsupported, forward **TCP port 3000** (or your chosen port) to the PC's LAN
  address in the router's settings.
- The mapping is removed again when hosting stops.

**Firewall.** The first time you host, Windows asks whether SKYFALL may use the network. Allow
**Private** networks, and **Public** too if you play over the internet.

**Carrier-grade NAT.** If the panel says the router's WAN address differs from your public IP, your
ISP shares one public address between customers, and nobody outside can reach you directly. Use one of
these instead:

- a VPN like Tailscale or ZeroTier (everyone joins your VPN address);
- a dedicated server on a cloud VM.

**Load.** The host runs the full 100-player simulation, bots included, on its CPU, and sends each
connected player 20 snapshots per second. That's about 7 KB each, or roughly 1.1 Mbit/s of upload per
remote player (measured by `tools/nettest.js`). Hosting three friends needs about 3.5 Mbit/s up.

## Dedicated servers

| Where | Command |
|---|---|
| Windows, with a status window | Start menu → **SKYFALL Dedicated Server**, or `SKYFALL.exe --server --port 3000` |
| Windows, no window | `SKYFALL.exe --server --nogui --port 3000` (log in `%APPDATA%\SKYFALL\server.log`) |
| Any OS with Node.js 20+ (VPS, Raspberry Pi…) | `npm ci && npm run build && npm run server` (`PORT=8080` or `--port 8080`) |

Other launch options:

- `SKYFALL.exe --connect 203.0.113.7:3000` starts the game already joining that server.
- `SKYFALL_SELFTEST=<log file>` hosts, waits, quits, and writes what happened. CI uses it.

Health check: `GET http://<server>:<port>/health` returns
`{"ok":true,"version":1,"matches":…,"players":…}`.

## Building

```
npm ci
npm run dist:win      # → release/SKYFALL-Setup-<version>.exe   (Windows installer)
npm run dist:linux    # → release/SKYFALL-<version>.AppImage
npm run desktop       # run the desktop app from source
npm run desktop:host  # … in dedicated-server mode
```

`dist:win` runs in three steps:

1. `vite build`.
2. `electron-builder --win dir` packages Electron, the client, the server and the simulation.
   `build/afterPack.cjs` writes the icon and version info into `SKYFALL.exe` with resedit (pure JS).
3. `tools/desktop/build-installer.mjs` compiles `build/installer.nsi` with NSIS. It downloads NSIS
   if needed. The installer writes its uninstaller at install time.

None of the steps need Wine, so the Windows installer builds on Linux and macOS too.

`.github/workflows/skyfall-desktop.yml` builds the installer on a Windows runner on every push that
touches `skyfall/`, and then:

1. starts the packaged game in self-test mode (it must host and quit cleanly);
2. installs silently, checks the files, shortcuts and registry entry, then uninstalls;
3. uploads the installer as the **SKYFALL-Setup-windows** artifact.

Pushing a tag named `skyfall-v*` also publishes the installer as a GitHub release.

The exe is not code-signed, so Windows SmartScreen shows "unknown publisher" (More info → Run anyway).
To sign it, set a certificate in `electron-builder.yml` (`win.certificateFile` / `CSC_LINK`) and sign
the installer with `signtool` after `build-installer.mjs`.

## How it fits together

| File | Role |
|---|---|
| `desktop/main.cjs` | Electron main process. Serves `dist/` on `http://127.0.0.1:37777`: a secure context that can still open plain `ws://` connections to other machines, with a fixed port so settings persist. Owns the window, hosting, dedicated mode, the public-IP lookup and UPnP. |
| `desktop/host.mjs` | Utility process that runs `server/server.js`. |
| `desktop/upnp.cjs` | Minimal UPnP IGD client: SSDP discovery, AddPortMapping (permanent lease, then 24 h), GetExternalIPAddress, DeletePortMapping. Tested against a mock router by `tools/desktop/upnptest.cjs`. |
| `desktop/preload.cjs` | `window.skyfallDesktop` bridge: host, stopHost, hostStatus, events, copy. |
| `desktop/server.html` | Dedicated-server status window. |
| `server/server.js` | `startServer({ port, dist })`, used by the CLI (`server/index.js`), HOST SERVER and dedicated mode. |
| `src/client/main.js` | ONLINE panel: address normalisation, connect / reconnect, host panel. |
