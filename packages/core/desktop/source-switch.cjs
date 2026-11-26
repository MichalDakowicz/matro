const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, Menu, session, shell } = require('electron');
const { loadSource, saveSource, findServer, relaunchArgs } = require('./desktop-source.cjs');

function installSourceSwitch(server) {
  const dir = app.getPath('userData'), page = path.resolve(__dirname, '../../../apps/desktop/source.html');
  let settings, requestsWindow, message = '', switching = false, requestMode = false;
  function show(error = '', requests = false) {
    if (settings && !settings.isDestroyed()) { settings.focus(); return; }
    message = error; requestMode = requests;
    const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    settings = new BrowserWindow({ width: 540, height: 420, resizable: false, title: requests ? 'Movie requests' : 'Playback source', backgroundColor: '#161618', parent,
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
  function trustedLocalWindow(event) {
    if (event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith('matro://app/')) throw Error('Untrusted desktop request');
    return BrowserWindow.fromWebContents(event.sender);
  }
  async function openRequests(url, parent) {
    if (requestsWindow) { requestsWindow.focus(); return; }
    const destination = new URL('/?view=movie-requests', url);
    const win = new BrowserWindow({ width: 1120, height: 800, minWidth: 420, minHeight: 480, show: false, title: 'Matro · Movie requests',
      backgroundColor: '#0a0a0b', autoHideMenuBar: true, parent,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    requestsWindow = win;
    win.setMenu(null);
    win.on('closed', () => { requestsWindow = null; });
    const keepOnServer = (event, target) => {
      if (new URL(target).origin !== destination.origin) event.preventDefault();
    };
    win.webContents.on('will-navigate', keepOnServer);
    win.webContents.on('will-redirect', keepOnServer);
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (['http:', 'https:'].includes(new URL(url).protocol)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    try {
      await win.loadURL(destination.href);
      win.show();
    } catch {
      if (win.isDestroyed()) return;
      win.destroy();
      throw Error('Could not open movie requests. Check the Matro server address and connection.');
    }
  }
  async function change(url, enabled) {
    if (switching) return;
    switching = true;
    try { await saveSource(dir, { url, enabled }); }
    catch (error) { switching = false; throw error; }
    delete process.env.MATRO_SERVER_URL;
    app.releaseSingleInstanceLock(); app.relaunch({ args: relaunchArgs(process.argv) }); app.quit();
  }
  ipcMain.handle('desktop:source-open', event => {
    trustedLocalWindow(event);
    show();
  });
  ipcMain.handle('desktop:movie-requests', async event => {
    const parent = trustedLocalWindow(event), { url } = loadSource(dir);
    if (settings && requestMode) return settings.focus();
    if (!url) return show('', true);
    try { await openRequests(url, parent); }
    catch (error) { show(error.message, true); }
  });
  ipcMain.handle('desktop:source-state', event => { trusted(event); return { ...loadSource(dir), ...(server ? { url: server } : {}), active: !!server, message, requests: requestMode }; });
  ipcMain.handle('desktop:source-connect', async (event, input) => {
    trusted(event);
    const sourceWindow = settings, requests = requestMode;
    const url = await findServer(input, (url, options) => session.defaultSession.fetch(url, options));
    if (sourceWindow.isDestroyed()) return;
    if (!requests) return change(url, true);
    await openRequests(url, sourceWindow.getParentWindow());
    if (!loadSource(dir).enabled) await saveSource(dir, { url, enabled: false });
    if (!sourceWindow.isDestroyed()) sourceWindow.close();
  });
  ipcMain.handle('desktop:source-local', async event => { trusted(event); await change(loadSource(dir).url, false); });
  app.whenReady().then(() => Menu.setApplicationMenu(null));
  return { show };
}
module.exports = { installSourceSwitch };
