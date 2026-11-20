const { contextBridge, ipcRenderer } = require('electron');
const ver = ipcRenderer.sendSync('tc-version');
contextBridge.exposeInMainWorld('tcDesktop', {
  version: ver,
  check: () => ipcRenderer.send('tc-check'),
  download: () => ipcRenderer.send('tc-download'),
  install: () => ipcRenderer.send('tc-install'),
  manual: () => ipcRenderer.send('tc-manual'),
  onStatus: (cb) => { ipcRenderer.on('tc-update', (_e, s) => cb(s)); const l = ipcRenderer.sendSync('tc-last'); if (l && l.state !== 'idle') cb(l); },
});
