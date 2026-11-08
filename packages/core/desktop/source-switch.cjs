const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, Menu, session } = require('electron');
const { loadSource, saveSource, findServer, relaunchArgs } = require('./desktop-source.cjs');

function installSourceSwitch(server) {
  const dir = app.getPath('userData'), page = path.resolve(__dirname, '../../../apps/desktop/source.html');
  let settings, message = '', switching = false;
  function show(error = '') {
    message = error;
    if (settings && !settings.isDestroyed()) { settings.focus(); return; }
    const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    settings = new BrowserWindow({ width: 540, height: 420, resizable: false, title: 'Playback source', backgroundColor: '#161618', parent,
      webPreferences: { preload: path.resolve(__dirname, '../../../apps/desktop/source-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    settings.setMenu(null);
    settings.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    settings.webContents.on('will-navigate', (event, url) => { if (url !== pathToFileURL(page).href) event.preventDefault(); });
    settings.on('closed', () => { settings = null; });
    void settings.loadFile(page);
  }
  function trusted(event) {
    if (!settings || event.sender !== settings.webContents || event.senderFrame !== settings.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(page).href) throw Error('Untrusted source settings request');
  }
  async function change(url, enabled) {
    if (switching) return;
    switching = true;
    try { await saveSource(dir, { url, enabled }); }
    catch (error) { switching = false; throw error; }
    delete process.env.MATRO_SERVER_URL;
    app.relaunch({ args: relaunchArgs(process.argv) }); app.quit();
  }
  ipcMain.handle('desktop:source-open', event => {
    if (event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith('matro://app/')) throw Error('Untrusted source settings request');
    show();
  });
  ipcMain.handle('desktop:source-state', event => { trusted(event); return { ...loadSource(dir), ...(server ? { url: server } : {}), active: !!server, message }; });
  ipcMain.handle('desktop:source-connect', async (event, input) => {
    trusted(event);
    const url = await findServer(input, (url, options) => session.defaultSession.fetch(url, options));
    await change(url, true);
  });
  ipcMain.handle('desktop:source-local', async event => { trusted(event); await change(loadSource(dir).url, false); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Playback source', submenu: [
        { label: 'This PC', type: 'radio', checked: !server, click: () => { void change(loadSource(dir).url, false); } },
        { id: 'source-settings', label: server ? 'Server settings…' : 'Connect to server…', click: () => show() }
      ] },
      { role: 'editMenu' }
    ]));
  });
  return { show };
}
module.exports = { installSourceSwitch };
