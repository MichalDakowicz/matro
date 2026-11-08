const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixtures } = require('./fixtures.cjs');
const { createApp } = require('../packages/core/server');
const { ffmpeg, run } = require('../packages/core/desktop/media.cjs');

test('a renderer crash restores the local movie position even when server saves fail', async () => {
  const f = await fixtures(), root = await fs.mkdtemp(path.join(f.dir, 'crash-ui-'));
  const media = path.join(root, 'media'); await fs.mkdir(media); await fs.copyFile(f.mkv, path.join(media, 'Northbound.mkv'));
  const { app, server, db, library } = createApp({ dataDir: path.join(root, 'data'), tmdb: { env: {} } });
  let browser;
  try {
    const userId = await app.createUser('head', 'local-recovery-test', 'admin'); await library.addFolder(media);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, MATRO_USER_DATA: path.join(root, 'profile'), MATRO_WEB_URL: base, MATRO_METADATA: 'off' }; delete env.ELECTRON_RUN_AS_NODE;
    browser = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    let page = await browser.firstWindow();
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('head');
    await page.getByLabel('Password', { exact: true }).fill('local-recovery-test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: /^(Play now|Resume)$/ }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.2);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    let blockSaves = true;
    const handleRequest = server.listeners('request')[0]; server.removeListener('request', handleRequest);
    server.on('request', (req, res) => {
      if (blockSaves && req.method === 'PUT' && req.url === '/api/state') { req.resume(); res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"test: save unavailable"}'); }
      else handleRequest(req, res);
    });
    const itemId = db.prepare('SELECT id FROM items LIMIT 1').get().id;
    await page.locator('#seek').evaluate(el => { el.value = '6'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    const localCheckpoint = () => page.evaluate(id => Object.keys(localStorage).filter(key => key.startsWith('matro:recovery:v1:') && key.endsWith(':' + id)).map(key => JSON.parse(localStorage.getItem(key))).find(entry => entry.position >= 5.9 && entry.position <= 6.1), itemId);
    await expect.poll(localCheckpoint).toBeTruthy();
    const serverProgress = () => JSON.parse(db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(userId)?.data || '{}').progress || {};
    // The old server position can be ahead of six seconds on a slower machine.
    // Freshness, rather than furthest position, proves the local-only save.
    const recoveredAt = (await localCheckpoint()).updated;
    expect(serverProgress()[itemId]?.updated || 0).toBeLessThan(recoveredAt);
    const crashed = page.waitForEvent('crash');
    await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    await crashed;
    blockSaves = false;
    const reopened = browser.waitForEvent('window');
    await browser.evaluate(async ({ BrowserWindow }, base) => {
      const old = BrowserWindow.getAllWindows()[0];
      const next = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      old.destroy(); await next.loadURL(base);
    }, base);
    page = await reopened;
    await page.getByRole('button', { name: 'Resume watching', exact: true }).click();
    await expect(page.locator('#position')).toHaveText('0:06');
    await expect.poll(() => serverProgress()[itemId]?.updated || 0).toBeGreaterThanOrEqual(recoveredAt);
  } finally {
    await browser?.close(); app.downloads.close(); app.closePlayback();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Vite production UI signs in, plays through the HTTP adapter and saves progress', async () => {
  const f = await fixtures(), root = await fs.mkdtemp(path.join(f.dir, 'web-ui-'));
  const media = path.join(root, 'media'); await fs.mkdir(media);
  await fs.copyFile(f.mkv, path.join(media, 'Northbound.mkv'));
  const { app, server, db, library } = createApp({ dataDir: path.join(root, 'data'), tmdb: { env: {} } });
  let browser;
  try {
    await app.createUser('head', 'native-and-web-test', 'admin');
    await library.addFolder(media);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const env = { ...process.env, MATRO_USER_DATA: path.join(root, 'profile'), MATRO_WEB_URL: `http://127.0.0.1:${server.address().port}`, MATRO_METADATA: 'off' }; delete env.ELECTRON_RUN_AS_NODE;
    browser = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    const page = await browser.firstWindow(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('head');
    await page.getByLabel('Password', { exact: true }).fill('native-and-web-test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: /^(Play now|Resume)$/ }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.2);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    // Pausing the decoder must not stop downloading the rest of the movie.
    await expect(page.locator('video')).toHaveAttribute('data-buffer-complete', 'true');
    expect(await page.locator('video').evaluate(v => v.src.startsWith('blob:'))).toBe(true);
    await page.locator('#seek').evaluate(el => { el.value = '6'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect(page.locator('#position')).toHaveText('0:06');
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    const saved = await page.evaluate(async () => (await (await fetch('/api/library')).json()).progress);
    expect(Object.values(saved).some(p => p.position >= 5.9)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); app.downloads.close(); app.closePlayback();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('direct-play resume survives leaving before metadata arrives and resumes at the saved position', async () => {
  const f = await fixtures(), root = await fs.mkdtemp(path.join(f.dir, 'resume-ui-'));
  const media = path.join(root, 'media'); await fs.mkdir(media);
  await run(ffmpeg, ['-y', '-v', 'error', '-i', f.mkv, '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', path.join(media, 'Northbound.mp4')]);
  const { app, server, db, library } = createApp({ dataDir: path.join(root, 'data'), tmdb: { env: {} } });
  let browser;
  try {
    await app.createUser('head', 'resume-position-test', 'admin'); await library.addFolder(media);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const env = { ...process.env, MATRO_USER_DATA: path.join(root, 'profile'), MATRO_WEB_URL: `http://127.0.0.1:${server.address().port}`, MATRO_METADATA: 'off' }; delete env.ELECTRON_RUN_AS_NODE;
    browser = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    const page = await browser.firstWindow();
    // Exercise progressive fallback separately from the disk-backed MSE path.
    await page.addInitScript(() => { window.MediaSource = undefined; });
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('head');
    await page.getByLabel('Password', { exact: true }).fill('resume-position-test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Northbound', exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const data = await (await fetch('/api/library')).json();
      await fetch('/api/state', { method: 'PUT', headers: { 'x-matro': '1', 'content-type': 'application/json' }, body: JSON.stringify({ progress: { [data.items[0].id]: { position: 6, duration: 12, updated: Date.now() } } }) });
    });
    await page.reload();
    let requested, release;
    const started = new Promise(resolve => { requested = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    await page.route('**/api/items/*/direct', async route => { requested(); await blocked; await route.abort(); });
    await page.getByRole('button', { name: 'Resume watching', exact: true }).click();
    await started;
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    await expect(page.locator('.shell')).toBeVisible();
    release();
    const saved = await page.evaluate(async () => (await (await fetch('/api/library')).json()).progress);
    expect(Object.values(saved)[0].position).toBeGreaterThanOrEqual(5.9);
    await page.unroute('**/api/items/*/direct');
    await page.locator('.continue-card [data-play]').click();
    await expect.poll(() => page.locator('#video').evaluate(v => v.currentTime)).toBeGreaterThanOrEqual(5.9);
  } finally {
    await browser?.close(); app.downloads.close(); app.closePlayback();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
