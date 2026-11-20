const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { createApp } = require('../packages/core/server');

async function launch(profile) {
  const env = { ...process.env, MATRO_USER_DATA: profile, MATRO_METADATA: 'off' }; delete env.ELECTRON_RUN_AS_NODE; delete env.MATRO_SERVER_URL;
  return electron.launch({ args: [path.resolve(__dirname, '..')], env });
}
async function interceptRestart(app) {
  await app.evaluate(({ app }) => {
    global.sourceTest = { quit: app.quit, relaunch: app.relaunch, args: null };
    app.relaunch = args => { global.sourceTest.args = args; }; app.quit = () => {};
  });
}
async function close(app) {
  if (!app) return;
  await app.evaluate(({ app }) => { if (global.sourceTest) { app.quit = global.sourceTest.quit; app.relaunch = global.sourceTest.relaunch; } });
  await app.close();
}

test('the local desktop opens server movie requests without changing playback source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-desktop-requests-'));
  const profile = path.join(root, 'profile');
  const { app: matro, server, db } = createApp({ dataDir: path.join(root, 'server'), movieRequests: { env: {} }, tmdb: { env: {} } });
  let app;
  try {
    await matro.createUser('head', 'local-recovery-test', 'admin');
    await matro.createUser('viewer', 'local-recovery-test', 'viewer');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = `http://127.0.0.1:${server.address().port}`;
    app = await launch(profile);
    const local = await app.firstWindow();
    const shortcut = local.getByRole('button', { name: 'Movie requests', exact: true });
    const settingsOpened = app.waitForEvent('window');
    await shortcut.press('Enter');
    const settings = await settingsOpened;
    await expect(settings.getByRole('heading', { name: 'Movie requests' })).toBeVisible();
    await settings.getByLabel('Matro server address').fill(address + '/wrong-path');
    await settings.getByRole('button', { name: 'Open movie requests' }).click();
    await expect(settings.getByRole('status')).toContainText('without a path');
    await settings.getByLabel('Matro server address').fill(address);
    const requestsOpened = app.waitForEvent('window');
    await settings.getByRole('button', { name: 'Open movie requests' }).click();
    let requests = await requestsOpened;
    await expect(requests).toHaveURL(address + '/?view=movie-requests');
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(profile, 'server.json'), 'utf8').catch(() => 'null'))).toEqual({ url: address, enabled: false });
    expect(local.url()).toBe('matro://app/');
    expect(await requests.evaluate(() => [typeof window.matroSource, typeof window.matroDesktop, typeof require])).toEqual(['undefined', 'undefined', 'undefined']);

    async function signIn(username) {
      await requests.getByLabel('Username', { exact: true }).fill(username);
      await requests.getByLabel('Password', { exact: true }).fill('local-recovery-test');
      await requests.getByRole('button', { name: 'Sign in', exact: true }).click();
    }
    await signIn('viewer');
    await expect(requests.getByRole('heading', { name: 'Request a movie' })).toBeVisible();
    await expect(requests.getByRole('button', { name: 'Downloads', exact: true })).toHaveCount(0);
    await requests.getByLabel('Movie title').fill('Desktop Example');
    await requests.getByRole('button', { name: 'Send request' }).click();
    await expect(requests.getByText('Request sent.', { exact: true })).toBeVisible();
    await requests.getByRole('button', { name: 'Profile: viewer' }).click();
    await requests.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(requests.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await signIn('head');
    await expect(requests.getByRole('heading', { name: 'Movie requests', exact: true })).toBeVisible();
    await expect(requests.getByRole('button', { name: 'Search releases for Desktop Example' })).toBeVisible();
    await expect(requests.getByRole('button', { name: 'Send request' })).toHaveCount(0);

    const closed = requests.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('?view=movie-requests')).close());
    await closed;
    const reopened = app.waitForEvent('window');
    await shortcut.click();
    requests = await reopened;
    await expect(requests.getByRole('heading', { name: 'Movie requests', exact: true })).toBeVisible();
    await expect(local.getByRole('button', { name: 'Playback source', exact: true })).toBeVisible();
  } finally {
    await close(app);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});

test('the visible switch connects, remembers receiver mode, preserves remote isolation and returns to the local library', async () => {
  const root = path.resolve(__dirname, '../.test-media', `source-switch-${Date.now()}`); await fs.mkdir(root, { recursive: true });
  const progress = { demo: { position: 120, duration: 1000, updated: 1 } };
  await fs.writeFile(path.join(root, 'library.json'), JSON.stringify({ libraryVersion: 2, folders: [], items: [], progress, queue: [], preferences: { autoplay: true, volume: .5 } }));
  const server = http.createServer((req, res) => { res.setHeader('content-type', req.url === '/api/status' ? 'application/json' : 'text/html'); res.end(req.url === '/api/status' ? '{"setup":false,"user":null}' : '<h1>Server library</h1>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  let app;
  try {
    app = await launch(root); let page = await app.firstWindow(); await interceptRestart(app);
    const opened = app.waitForEvent('window'); await page.getByRole('button', { name: 'Playback source', exact: true }).click();
    let settings = await opened;
    await settings.getByLabel('Matro server address').fill(address + '/wrong-path');
    await settings.getByRole('button', { name: 'Use server', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('without a path');
    await settings.getByLabel('Matro server address').fill(address);
    await settings.getByRole('button', { name: 'Use server', exact: true }).click();
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(root, 'server.json'), 'utf8').catch(() => 'null'))).toEqual({ url: address, enabled: true });
    expect(await app.evaluate(() => global.sourceTest.args !== null)).toBe(true);
    await close(app); app = await launch(root); page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Server library' })).toBeVisible();
    expect(await page.evaluate(() => [typeof window.matro, typeof window.matroSource, typeof require])).toEqual(['undefined', 'undefined', 'undefined']);
    expect(await app.evaluate(({ BrowserWindow, Menu }) => [BrowserWindow.getAllWindows()[0].isMenuBarVisible(), Menu.getApplicationMenu()])).toEqual([false, null]);
    await interceptRestart(app);
    const reopened = app.waitForEvent('window');
    await page.evaluate(() => window.matroDesktop.chooseSource());
    settings = await reopened;
    await expect(settings.getByLabel('Matro server address')).toHaveValue(address);
    await settings.getByRole('button', { name: 'Use this PC', exact: true }).click();
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(root, 'server.json'), 'utf8').catch(() => 'null'))).toEqual({ url: address, enabled: false });
    await close(app); app = await launch(root); page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Playback source', exact: true })).toBeVisible();
    expect((await page.evaluate(() => window.matro.load())).progress).toEqual(progress);
  } finally { await close(app); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('an unreachable remembered server leaves the source settings available', async () => {
  const root = path.resolve(__dirname, '../.test-media', `offline-source-${Date.now()}`); await fs.mkdir(root, { recursive: true });
  const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(root, 'server.json'), JSON.stringify({ url: `http://127.0.0.1:${port}`, enabled: true }));
  const app = await launch(root);
  try {
    await expect.poll(() => app.windows().length).toBe(2);
    const settings = app.windows().find(page => page.url().endsWith('/source.html'));
    await expect(settings.getByRole('status')).toContainText('Could not reach the saved server');
    await expect(settings.getByRole('button', { name: 'Use this PC', exact: true })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/source.html')).close());
    const fallback = app.windows().find(page => page.url().endsWith('/receiver-error.html'));
    const reopened = app.waitForEvent('window'); await fallback.getByRole('button', { name: 'Server settings', exact: true }).click();
    await expect((await reopened).getByRole('button', { name: 'Use this PC', exact: true })).toBeVisible();
  } finally { await close(app); }
});
