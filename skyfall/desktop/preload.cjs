// Bridge between the game page and the desktop shell (contextIsolation on, no Node in the page).
// The page finds it as window.skyfallDesktop (src/client/main.js).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skyfallDesktop', {
  version: (process.argv.find((a) => a.startsWith('--skyfall-version=')) || '').split('=')[1] || '',
  host: (opts) => ipcRenderer.invoke('host:start', opts),
  stopHost: () => ipcRenderer.invoke('host:stop'),
  hostStatus: () => ipcRenderer.invoke('host:status'),
  onHostEvent: (cb) => { ipcRenderer.on('host:event', (_, h) => cb(h)); },
  copy: (text) => ipcRenderer.invoke('clipboard', String(text)),
  toggleFullscreen: () => ipcRenderer.invoke('fullscreen'),
  quit: () => ipcRenderer.invoke('quit'),
});
