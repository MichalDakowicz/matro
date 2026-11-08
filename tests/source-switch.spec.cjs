const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

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
    await interceptRestart(app);
    const reopened = app.waitForEvent('window');
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('source-settings').click());
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
  } finally { await close(app); }
});
