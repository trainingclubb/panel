const { app, BrowserWindow, shell, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let win = null;
let last = { state: 'idle' };
const logFile = () => path.join(app.getPath('userData'), 'actualizaciones.log');
function log(msg) { try { fs.appendFileSync(logFile(), new Date().toISOString() + ' ' + msg + '\n'); } catch (e) {} }
function send(s) { last = s; log(JSON.stringify(s)); if (win && !win.isDestroyed()) win.webContents.send('tc-update', s); }

// No se descarga ni se instala sola: avisa "Actualización pendiente" y la descarga / instala quien usa el panel.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
autoUpdater.on('update-available', (i) => send({ state: 'available', version: i.version }));
autoUpdater.on('update-not-available', () => send({ state: 'latest' }));
autoUpdater.on('download-progress', (p) => send({ state: 'downloading', version: last.version, percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', version: i.version }));
const corto = (e) => String((e && e.message) || e).split(String.fromCharCode(10))[0].slice(0, 200);
// Si falla al descargar, el aviso ofrece "Reintentar" / "Descargar a mano". Si falla al buscar, se sigue usando igual.
autoUpdater.on('error', (e) => send({ state: 'error', message: corto(e), phase: last.state === 'downloading' ? 'download' : 'check', version: last.version }));

let ultimoCheck = 0, instalando = false;
const ocupado = () => instalando || ['checking', 'available', 'downloading', 'ready'].includes(last.state);
function check() {
  if (!app.isPackaged) return send({ state: 'latest' });
  if (ocupado()) return;
  ultimoCheck = Date.now();
  autoUpdater.checkForUpdates().catch((e) => send({ state: 'error', message: corto(e), phase: 'check', version: last.version }));
}
// la descarga empieza solo cuando se toca "Descargar"
function descargar() {
  if (!app.isPackaged || instalando || last.state === 'downloading' || last.state === 'ready') return;
  if (!(last.state === 'available' || (last.state === 'error' && last.phase === 'download'))) return check();
  send({ state: 'downloading', version: last.version, percent: 0 });
  autoUpdater.downloadUpdate().catch((e) => send({ state: 'error', message: corto(e), phase: 'download', version: last.version }));
}
ipcMain.on('tc-download', descargar);

ipcMain.on('tc-check', check);
// Solo cuando se toca "Instalar y reiniciar": instala en silencio, cierra bien el panel y lo vuelve a abrir ya actualizado.
// Si algo falla, abre la página de descarga para instalar a mano.
function instalar() {
  if (instalando || last.state !== 'ready') return; instalando = true;
  log('instalando ' + (last.version || ''));
  send({ state: 'installing', version: last.version, force: true });
  try {
    app.removeAllListeners('window-all-closed');
    BrowserWindow.getAllWindows().forEach((w) => { w.removeAllListeners('close'); w.destroy(); });
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  } catch (e) {
    log('fallo instalar: ' + corto(e));
    instalando = false;
    shell.openExternal('https://github.com/trainingclubb/panel/releases/latest');
  }
}
ipcMain.on('tc-install', instalar);
ipcMain.on('tc-manual', () => shell.openExternal('https://github.com/trainingclubb/panel/releases/latest'));
ipcMain.on('tc-version', (e) => { e.returnValue = app.getVersion(); });
ipcMain.on('tc-last', (e) => { e.returnValue = last; });
// al tocar una notificación del panel, se trae la ventana adelante
ipcMain.on('tc-foco', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

function crear() {
  win = new BrowserWindow({ width: 1180, height: 900, minWidth: 420, minHeight: 640,
    backgroundColor: '#070807', title: 'Training Club', icon: path.join(__dirname, 'app', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') }});
  Menu.setApplicationMenu(null);
  function abrirWeb(url) {
    try { const destino = new URL(url); if (destino.protocol === 'https:') shell.openExternal(destino.href).catch(() => {}); } catch {}
  }
  win.webContents.setWindowOpenHandler(({ url }) => { abrirWeb(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { event.preventDefault(); abrirWeb(url); });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.once('did-finish-load', () => setTimeout(check, 800));
  // al volver a la ventana, si pasaron más de 5 minutos, se vuelve a buscar
  win.on('focus', () => { if (Date.now() - ultimoCheck > 5 * 60 * 1000) check(); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  if (process.platform === 'win32') app.setAppUserModelId('com.adforge.trainingclub');   // para que Windows muestre las notificaciones del panel
  app.whenReady().then(() => { crear(); setInterval(check, 30 * 60 * 1000); });
  app.on('window-all-closed', () => app.quit());
}
