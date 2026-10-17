# Play Emberfall on your PC

Everything the game needs is in this folder, including three.js, so it runs offline. Your
browser plays it from a small web server that runs on your own computer while you play.

## 1. Get the game

Download the project as a zip and extract it anywhere. Use the branch the game is on:
<https://github.com/chippohippo/ClaudePower/archive/refs/heads/ccr-ba969e79-we5sd8.zip>

The game is in the `scifi-combat` folder inside the zip. You only need that folder.
If you were sent `Emberfall-PC.zip`, it holds just that folder (as `Emberfall`): extract it and go on.

## 2. Start it

| Your computer | Do this |
|---|---|
| **Windows 10 / 11** | Double-click **`play.bat`**. Nothing to install: it uses PowerShell, which Windows already has. If Windows SmartScreen asks, choose *More info* → *Run anyway*. |
| **macOS** | Double-click **`play.command`**. The first time, right-click it and choose *Open*. It needs Node.js ([nodejs.org](https://nodejs.org)) or Python 3 ([python.org](https://www.python.org/downloads/)). |
| **Linux** | Run `./play.sh` (uses Node, Python 3 or Ruby, whichever you have). |
| **Any, with Node.js** | Run `npm start` in the folder. |

A window opens saying `Emberfall is running at http://localhost:8765/start.html`, and your browser
opens the start menu. Leave that window open while you play; close it when you're done.

## 3. Pick your battle

In the start menu:

1. Pick the battlefield: **Dusk City** (civilians and gangs included), Night City, or The Trenches.
2. Pick the battle size, your side, your class, the bots' skill, the effects quality and the map seed.
3. Press **Deploy**, or Enter.

Click in the game to capture the mouse; Esc frees it. The controls are on the start menu.

## If something's off

| Problem | Fix |
|---|---|
| It stutters | Pick a smaller battle (12v12 or 32v32) and set Effects to Low. Close other heavy tabs. |
| A blank or black page | Use a current Chrome, Edge or Firefox, with hardware acceleration on (browser settings → System). The game needs WebGL 2. |
| "Port in use" | The launchers take the next free port by themselves. With Python on a Mac, run `PORT=9000 ./play.sh` from a terminal. |
| Opening `index.html` directly shows nothing | Browsers block games opened as files. Use a launcher above. |

Your start-menu choices are remembered in your browser.
