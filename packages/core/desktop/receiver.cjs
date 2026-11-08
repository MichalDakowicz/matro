// Receiver windows use the server's authenticated browser API. No local media
// services or privileged preload bridge are started in this mode.
function launchReceiver(address, { show = true } = {}) {
  const { app, BrowserWindow, dialog, shell } = require('electron');
  let base;
  try {
    base = new URL(address);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw Error('Use the Matro server origin, for example https://matro.example.com.');
  } catch (error) {
    app.whenReady().then(() => { dialog.showErrorBox('Matro server address', error.message); app.quit(); }); return;
  }
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1440, height: 940, minWidth: 900, minHeight: 640, backgroundColor: '#0a0a0b', title: 'Matro', show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.once('ready-to-show', () => { if (show) win.show(); });
    win.webContents.setWindowOpenHandler(({ url }) => {
      try { const target = new URL(url); if (['http:', 'https:'].includes(target.protocol)) void shell.openExternal(target.href); } catch {}
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== base.origin) event.preventDefault(); });
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    try { await win.loadURL(base.href); }
    catch { dialog.showErrorBox('Matro server unavailable', 'Could not reach the Matro server. Check its address and connection.'); app.quit(); }
  });
  app.on('window-all-closed', () => app.quit());
}
module.exports = { launchReceiver };
