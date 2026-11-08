// Receiver windows use the server's authenticated browser API. No local media
// services or privileged preload bridge are started in this mode.
function launchReceiver(address, { show = true, onUnavailable, onChooseSource } = {}) {
  const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const errorPage = path.resolve(__dirname, '../../../apps/desktop/receiver-error.html');
  let base;
  try {
    base = new URL(address);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw Error('Use the Matro server origin, for example https://matro.example.com.');
  } catch (error) {
    app.whenReady().then(() => { dialog.showErrorBox('Matro server address', error.message); app.quit(); }); return;
  }
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1440, height: 940, minWidth: 900, minHeight: 640, backgroundColor: '#0a0a0b', title: 'Matro', show: false, frame: false,
      webPreferences: { preload: path.resolve(__dirname, '../../../apps/desktop/receiver-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.setMenu(null); win.setMenuBarVisibility(false);
    const handle = (channel, callback) => ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || (new URL(event.senderFrame.url).origin !== base.origin && event.senderFrame.url !== pathToFileURL(errorPage).href)) throw Error('Untrusted receiver request');
      return callback(...args);
    });
    handle('receiver:window', action => {
      if (!['minimize', 'maximize', 'close', 'fullscreen'].includes(action)) throw Error('Unknown window action');
      if (action === 'minimize') win.minimize();
      if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
      if (action === 'close') win.close();
      if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
    });
    handle('receiver:source', () => onChooseSource?.());
    handle('receiver:fullscreen', () => win.isFullScreen());
    win.on('enter-full-screen', () => win.webContents.send('receiver:fullscreen-changed', true));
    win.on('leave-full-screen', () => win.webContents.send('receiver:fullscreen-changed', false));
    win.on('closed', () => { for (const name of ['receiver:window', 'receiver:source', 'receiver:fullscreen']) ipcMain.removeHandler(name); });
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && win.isFullScreen()) { event.preventDefault(); win.setFullScreen(false); }
    });
    win.once('ready-to-show', () => { if (show) win.show(); });
    win.webContents.setWindowOpenHandler(({ url }) => {
      try { const target = new URL(url); if (['http:', 'https:'].includes(target.protocol)) void shell.openExternal(target.href); } catch {}
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== base.origin) event.preventDefault(); });
    win.webContents.on('will-redirect', (event, url) => { if (new URL(url).origin !== base.origin) event.preventDefault(); });
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    try { await win.loadURL(base.href); }
    catch {
      if (onUnavailable) { await win.loadFile(errorPage); onUnavailable(); }
      else { dialog.showErrorBox('Matro server unavailable', 'Could not reach the Matro server. Check its address and connection.'); app.quit(); }
    }
  });
  app.on('window-all-closed', () => app.quit());
}
module.exports = { launchReceiver };
