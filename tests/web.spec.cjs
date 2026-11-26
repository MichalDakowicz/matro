const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixtures } = require('./fixtures.cjs');
const { createApp } = require('../packages/core/server');
const { ffmpeg, run } = require('../packages/core/desktop/media.cjs');

test('a failed browser logout survives reload and a replacement account gets a fresh recovery scope', async () => {
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'matro-logout-ui-'));
  const { app, server, db } = createApp({ dataDir: path.join(root, 'data'), tmdb: { env: {} }, movieRequests: { env: {} } });
  let browser;
  try {
    const viewer = await app.createUser('viewer', 'logout-ui-password', 'viewer');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, MATRO_USER_DATA: path.join(root, 'profile'), MATRO_WEB_URL: base };
    delete env.ELECTRON_RUN_AS_NODE;
    browser = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    const page = await browser.firstWindow();
    const signIn = async () => {
      await page.getByRole('textbox', { name: 'Username', exact: true }).fill('viewer');
      const password = page.getByLabel('Password', { exact: true });
      await password.fill('logout-ui-password');
      await password.press('Enter');
      await expect(page.getByRole('button', { name: 'Profile: viewer' })).toBeVisible();
    };
    await page.setViewportSize({ width: 375, height: 800 });
    await signIn();
    await page.evaluate(() => window.matroTheme.set('light'));
    const originalScope = await page.evaluate(() => window.matro.recoveryScope);
    expect(originalScope).toMatch(/^account-v2:[a-f0-9]{32}$/);
    const originalCookie = (await page.context().cookies(base)).find(cookie => cookie.name === 'matro_session');
    expect(originalCookie.httpOnly).toBe(true);

    await page.route('**/api/logout', route => route.abort());
    await page.getByRole('button', { name: 'Profile: viewer' }).press('Enter');
    await page.getByRole('button', { name: 'Sign out', exact: true }).press('Enter');
    const loginButton = page.getByRole('button', { name: 'Sign in', exact: true });
    await expect(loginButton).toBeVisible();
    expect((await (await page.request.get(base + '/api/status')).json()).user.username).toBe('viewer');
    await page.reload();
    await expect(loginButton).toBeVisible();
    await expect(page.getByRole('button', { name: 'Profile: viewer' })).toHaveCount(0);

    await page.unroute('**/api/logout');
    await page.reload();
    await expect(loginButton).toBeVisible();
    expect((await page.context().cookies(base)).find(cookie => cookie.name === 'matro_session')).toBeUndefined();
    expect(await page.evaluate(() => localStorage.getItem('matro.pending-logout'))).toBeNull();
    const revoked = await fetch(base + '/api/me', { headers: { cookie: `matro_session=${originalCookie.value}` } });
    expect(revoked.status).toBe(401);

    db.prepare('DELETE FROM users WHERE id = ?').run(viewer);
    await app.createUser('viewer', 'logout-ui-password', 'viewer');
    await page.setViewportSize({ width: 1200, height: 850 });
    await signIn();
    await page.evaluate(() => window.matroTheme.set('dark'));
    expect(await page.evaluate(() => window.matro.recoveryScope)).not.toBe(originalScope);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});

test('viewers request a movie and the owner searches for a release without starting a transfer', async () => {
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'matro-request-ui-'));
  const queries = [], hash = 'a'.repeat(40);
  const { app, server, db } = createApp({
    dataDir: path.join(root, 'data'), tmdb: { env: {} }, movieRequests: { env: {} },
    downloads: { catalog: 'https://catalog.example/', fetch: async url => {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/list_movies.json');
      queries.push(parsed.searchParams.get('query_term'));
      return Response.json({ status: 'ok', data: { movie_count: 1, movies: [
        { id: 1, title: 'The Example', year: 2024, torrents: [{ hash, quality: '1080p', seeds: 23 }] },
      ] } });
    } },
  });
  let browser;
  try {
    await app.createUser('head', 'local-recovery-test', 'admin');
    await app.createUser('viewer', 'local-recovery-test', 'viewer');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, MATRO_USER_DATA: path.join(root, 'profile'), MATRO_WEB_URL: base };
    delete env.ELECTRON_RUN_AS_NODE;
    browser = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    const page = await browser.firstWindow();
    async function signIn(name) {
      await page.getByRole('textbox', { name: 'Username', exact: true }).fill(name);
      await page.getByLabel('Password', { exact: true }).fill('local-recovery-test');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    }
    await page.setViewportSize({ width: 375, height: 800 });
    await signIn('viewer');
    await page.evaluate(() => window.matroTheme.set('light'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: 'Downloads', exact: true })).toHaveCount(0);
    const requestTab = page.getByRole('button', { name: 'Request a movie', exact: true });
    await requestTab.focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Movie title').fill('The Example');
    await page.getByLabel('Release year (optional)').fill('2024');
    await page.getByLabel('Release year (optional)').press('Enter');
    await expect(page.getByText('Request sent.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The Example (2024)' })).toBeVisible();
    expect(await page.locator('#movie-requests').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(queries).toEqual([]);

    await page.getByLabel('Movie title').fill('Withdraw this request');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    await page.getByRole('button', { name: 'Remove request for Withdraw this request' }).press('Enter');
    const confirmation = page.getByRole('dialog', { name: 'Remove movie request?' });
    await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirmation.getByRole('button', { name: 'Remove request', exact: true }).press('Enter');
    await expect(page.getByText('Request removed.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Withdraw this request' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Profile: viewer' }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1200, height: 850 });
    await page.goto(base + '/?view=movie-requests');
    await expect(page).toHaveURL(base + '/?view=movie-requests');
    await signIn('head');
    await expect(page.getByRole('heading', { name: 'Movie requests', exact: true })).toBeVisible();
    await page.evaluate(() => window.matroTheme.set('dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Send request' })).toHaveCount(0);
    await expect(page.getByText(/^viewer · /)).toBeVisible();
    await page.getByRole('button', { name: 'Search releases for The Example (2024)' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search movie torrents' })).toHaveValue('The Example');
    await expect(page.getByText('Requested movie · The Example (2024)', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /The Example/ }).first()).toBeVisible();
    expect(queries).toContain('The Example');
    expect((await app.downloads.jobs('server')).length).toBe(0);

    await page.getByRole('button', { name: 'Movie requests', exact: true }).click();
    await page.getByRole('button', { name: 'Mark The Example (2024) handled' }).click();
    await expect(page.getByText('No pending movie requests.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The Example (2024)' })).toBeVisible();
    const removeHandled = page.getByRole('button', { name: 'Remove request for The Example (2024)' });
    await removeHandled.click();
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'The Example (2024)' })).toBeVisible();
    await removeHandled.click();
    await confirmation.getByRole('button', { name: 'Remove request', exact: true }).click();
    await expect(page.getByText('No handled movie requests yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Refresh requests' }).click();
    await expect(page.getByRole('heading', { name: 'The Example (2024)' })).toHaveCount(0);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});

test('an open web library picks up a catalog change without a reload', async () => {
  const f = await fixtures(), root = await fs.mkdtemp(path.join(f.dir, 'live-catalog-'));
  const media = path.join(root, 'media'); await fs.mkdir(media);
  await fs.copyFile(f.mkv, path.join(media, 'Northbound.mkv'));
  const { app, server, db, library } = createApp({ dataDir: path.join(root, 'data'), tmdb: { env: {} } });
  let browser;
  try {
    await app.createUser('head', 'local-catalog-test', 'admin'); await library.addFolder(media);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const env = { ...process.env, MATRO_USER_DATA: path.join(root, 'profile'), MATRO_WEB_URL: `http://127.0.0.1:${server.address().port}` };
    delete env.ELECTRON_RUN_AS_NODE;
    browser = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    const page = await browser.firstWindow();
    await browser.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].show(); });
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('head');
    await page.getByLabel('Password', { exact: true }).fill('local-catalog-test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('.dock [data-tab="movie"]').click();
    await expect(page.getByRole('button', { name: 'Open Northbound', exact: true })).toBeVisible();
    const newTitle = page.getByRole('button', { name: 'Open New Arrival', exact: true });
    await expect(newTitle).toHaveCount(0);
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await fs.copyFile(f.mkv, path.join(media, 'New Arrival.mkv'));
    await library.rescanAll();
    await expect(newTitle).toBeVisible({ timeout: 12000 });
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);

    await page.getByRole('button', { name: 'Folders', exact: true }).press('Enter');
    const note = page.getByText(/Uploaded subtitles are kept too/);
    await page.evaluate(() => window.matroTheme.set('dark'));
    await expect(note).toBeVisible();
    await page.setViewportSize({ width: 390, height: 800 });
    await page.evaluate(() => window.matroTheme.set('light'));
    await expect(note).toBeVisible();
    await fs.rename(media, path.join(root, 'disconnected'));
    await fs.mkdir(media);
    await page.getByRole('button', { name: 'Rescan folders', exact: true }).press('Enter');
    await expect(page.locator('#toast')).toContainText('No media files were found. Existing titles were kept.');
    await expect(page.locator('.source-count')).toHaveText('2 items');
    await page.setViewportSize({ width: 375, height: 800 });
    await page.evaluate(() => window.matroTheme.set('light'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const movies = page.locator('.dock [data-tab="movie"]'), featured = page.locator('.show-title');
    await movies.click();
    await expect(featured).toHaveText(/^(Northbound|New Arrival)$/);
    const start = await featured.textContent(), other = start === 'Northbound' ? 'New Arrival' : 'Northbound';
    await page.locator('#reel').press('ArrowLeft');
    await expect(featured).toHaveText(other);
    await page.reload();
    await expect(featured).toHaveText(other);
  } finally {
    await browser?.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});

async function resumeAfterCrash(page) {
  const username = page.getByRole('textbox', { name: 'Username', exact: true });
  const resume = page.getByRole('button', { name: 'Resume watching', exact: true });
  await expect(username.or(resume).first()).toBeVisible();
  // A replacement window can ask the same account to sign in again.
  if (await username.isVisible()) {
    await username.fill('head');
    await page.getByLabel('Password', { exact: true }).fill('local-recovery-test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await resume.click();
}

async function playAndPauseAfterAdvance(page) {
  // Pause in the renderer as soon as the media clock advances. The play
  // controls can auto-hide before a second Playwright click reaches them.
  await page.evaluate(() => {
    const pauseAfterAdvance = event => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || video.currentTime <= .2) return;
      video.pause();
      document.removeEventListener('timeupdate', pauseAfterAdvance, true);
    };
    document.addEventListener('timeupdate', pauseAfterAdvance, true);
  });
  await page.getByRole('button', { name: /^(Play now|Resume)$/ }).click();
  await expect.poll(() => page.locator('video').evaluate(v => v.paused && v.currentTime > .2 && v.currentTime < 3)).toBe(true);
}

for (const scenario of ['new movie', 'resumed movie', 'rewatching', 'missing media events']) test(`passive playback saves and recovers after a crash: ${scenario}`, async () => {
  const f = await fixtures(), root = await fs.mkdtemp(path.join(f.dir, 'crash-ui-'));
  const media = path.join(root, 'media'); await fs.mkdir(media); await fs.copyFile(f.mkv, path.join(media, 'Northbound.mkv'));
  const { app, server, db, library } = createApp({ dataDir: path.join(root, 'data'), tmdb: { env: {} } });
  let browser;
  try {
    const userId = await app.createUser('head', 'local-recovery-test', 'admin'); await library.addFolder(media);
    if (scenario === 'resumed movie' || scenario === 'rewatching') {
      const id = db.prepare('SELECT id FROM items LIMIT 1').get().id;
      db.prepare('INSERT INTO user_state (user_id, data, updated) VALUES (?, ?, ?)').run(userId, JSON.stringify({ progress: { [id]: { position: scenario === 'rewatching' ? 12 : 2.123, duration: 12, completed: scenario === 'rewatching', updated: Date.now() } } }), Date.now());
    }
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, MATRO_USER_DATA: path.join(root, 'profile'), MATRO_WEB_URL: base, MATRO_METADATA: 'off' }; delete env.ELECTRON_RUN_AS_NODE;
    browser = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    let page = await browser.firstWindow();
    if (scenario === 'missing media events') await page.evaluate(() => {
      const listen = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, ...args) { if (this instanceof HTMLVideoElement && type === 'timeupdate') return; return listen.call(this, type, ...args); };
    });
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('head');
    await page.getByLabel('Password', { exact: true }).fill('local-recovery-test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: /^(Play now|Resume)$/ }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.2);
    const itemId = db.prepare('SELECT id FROM items LIMIT 1').get().id;
    const saved = () => JSON.parse(db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(userId)?.data || '{}').progress?.[itemId];
    const local = () => page.evaluate(id => Object.keys(localStorage).filter(key => key.startsWith('matro:recovery:v1:') && key.endsWith(':' + id)).map(key => JSON.parse(localStorage.getItem(key)))[0], itemId);
    await expect.poll(async () => (await local())?.position || 0).toBeGreaterThan(3);
    await expect.poll(() => saved()?.position || 0).toBeGreaterThan(3);
    // Neither pausing nor seeking has occurred. Now lose the server and let playback advance.
    let blocked = true;
    const handle = server.listeners('request')[0]; server.removeListener('request', handle);
    server.on('request', (req, res) => {
      if (blocked && req.method === 'PUT' && req.url === '/api/state') { req.resume(); res.writeHead(503).end('{}'); }
      else handle(req, res);
    });
    const before = (await local()).position;
    await expect.poll(async () => (await local())?.position || 0).toBeGreaterThan(before + 2);
    const checkpoint = await local();
    expect(checkpoint.updated).toBeGreaterThan(saved().updated);
    expect(checkpoint.completed).toBe(false);
    const crash = page.waitForEvent('crash');
    await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()); await crash;
    blocked = false;
    const opened = browser.waitForEvent('window');
    await browser.evaluate(async ({ BrowserWindow }, base) => {
      const old = BrowserWindow.getAllWindows()[0], next = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      old.destroy(); await next.loadURL(base);
    }, base);
    page = await opened;
    await resumeAfterCrash(page);
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await expect.poll(async () => Number((await page.locator('#position').textContent()).split(':').at(-1))).toBeGreaterThanOrEqual(Math.floor(checkpoint.position));
    await expect.poll(() => saved()?.position || 0).toBeGreaterThanOrEqual(checkpoint.position - .3);
    expect(saved().position).toBeLessThan(checkpoint.position + 3);

  } finally {
    await browser?.close(); app.downloads.close(); app.closePlayback();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});

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
    await playAndPauseAfterAdvance(page);
    const itemId = db.prepare('SELECT id FROM items LIMIT 1').get().id;
    const serverProgress = () => JSON.parse(db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(userId)?.data || '{}').progress?.[itemId];
    await expect.poll(() => serverProgress()?.position || 0).toBeGreaterThan(0);
    let blockSaves = true;
    const handleRequest = server.listeners('request')[0]; server.removeListener('request', handleRequest);
    server.on('request', (req, res) => {
      if (blockSaves && req.method === 'PUT' && req.url === '/api/state') { req.resume(); res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"test: save unavailable"}'); }
      else handleRequest(req, res);
    });
    await page.locator('#seek').evaluate(el => { el.value = '6'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    const localCheckpoint = () => page.evaluate(id => Object.keys(localStorage).filter(key => key.startsWith('matro:recovery:v1:') && key.endsWith(':' + id)).map(key => JSON.parse(localStorage.getItem(key))).find(entry => entry.position >= 5.9 && entry.position <= 6.1), itemId);
    await expect.poll(localCheckpoint).toBeTruthy();
    const recoveredAt = (await localCheckpoint()).updated;
    const durableCheckpoint = () => page.evaluate(id => new Promise((resolve, reject) => {
      const key = Object.keys(localStorage).find(key => key.startsWith('matro:recovery:v1:') && key.endsWith(':' + id));
      const request = indexedDB.open('matro-playback-recovery');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('checkpoints', 'readonly');
        const entry = tx.objectStore('checkpoints').get(key);
        tx.oncomplete = () => { db.close(); resolve(entry.result); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }), itemId);
    await expect.poll(async () => {
      const checkpoint = await durableCheckpoint();
      return {
        nearSeek: checkpoint?.position >= 5.9 && checkpoint.position <= 6.1,
        newer: checkpoint?.updated >= recoveredAt && checkpoint.updated > (serverProgress()?.updated || 0),
        completed: checkpoint?.completed
      };
    }).toEqual({ nearSeek: true, newer: true, completed: false });
    // Model the crash that loses the quick localStorage write before it reaches
    // disk. Recovery must still read the completed IndexedDB transaction.
    await page.evaluate(id => { for (const key of Object.keys(localStorage)) if (key.startsWith('matro:recovery:v1:') && key.endsWith(':' + id)) localStorage.removeItem(key); }, itemId);
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
    await resumeAfterCrash(page);
    await expect(page.locator('#position')).toHaveText('0:06');
    await expect.poll(() => serverProgress()?.updated || 0).toBeGreaterThanOrEqual(recoveredAt);
  } finally {
    await browser?.close(); app.downloads.close(); app.closePlayback();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});

for (const kind of ['movie', 'episode']) test(`leaving playback keeps the latest saved ${kind} position`, async () => {
  const f = await fixtures(), root = await fs.mkdtemp(path.join(f.dir, 'passive-exit-'));
  const media = path.join(root, 'media'); await fs.mkdir(media);
  await fs.copyFile(f.mkv, path.join(media, kind === 'movie' ? 'Northbound.mkv' : 'Northbound.S01E01.mkv'));
  const { app, server, db, library } = createApp({ dataDir: path.join(root, 'data'), tmdb: { env: {} } });
  let browser, releaseStop;
  try {
    const userId = await app.createUser('head', 'passive-exit-test', 'admin');
    await library.addFolder(media);
    const id = db.prepare('SELECT id FROM items LIMIT 1').get().id;
    const saved = () => JSON.parse(db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(userId)?.data || '{}').progress?.[id]?.position || 0;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const env = { ...process.env, MATRO_USER_DATA: path.join(root, 'profile'), MATRO_WEB_URL: `http://127.0.0.1:${server.address().port}`, MATRO_METADATA: 'off' }; delete env.ELECTRON_RUN_AS_NODE;
    browser = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    const page = await browser.firstWindow();
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('head');
    await page.getByLabel('Password', { exact: true }).fill('passive-exit-test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    if (kind === 'episode') {
      let scanner = { message: 'Scanning · Northbound · 35%', ready: 1, total: 3, complete: false };
      await page.route('**/api/segments', route => route.fulfill({ json: { scanner, markers: {} } }));
      await page.getByRole('button', { name: /^Shows/ }).click();
      const scan = page.getByRole('region', { name: 'Intro & outro scanning' });
      await expect(scan.getByText('1 of 3 episodes checked')).toBeVisible();
      await expect(scan.getByText('Scanning · Northbound · 35%')).toBeVisible();
      scanner = { message: 'Checking full episode', ready: 3, total: 3, complete: false };
      await expect(scan.getByText('3 of 3 episodes checked')).toBeVisible({ timeout: 10000 });
      scanner = { message: 'Background scan complete', ready: 3, total: 3, complete: true };
      await expect(scan).toBeHidden({ timeout: 10000 });
    }
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    const clickedPosition = kind === 'movie' ? 4 : 0;
    if (clickedPosition) {
      await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(.2);
      await page.locator('#seek').evaluate((seek, target) => {
        seek.value = target;
        seek.dispatchEvent(new Event('change', { bubbles: true }));
      }, clickedPosition);
    }
    await expect.poll(saved, { timeout: 10000 }).toBeGreaterThan(clickedPosition + 2);
    const before = saved();
    const stop = new Promise(resolve => { releaseStop = resolve; });
    await page.route('**/api/playback/stop', async route => { await stop; await route.continue(); });
    await page.locator('video').evaluate(v => v.addEventListener('emptied', () => { v.dataset.reset = 'true'; }, { once: true }));
    await page.keyboard.press('Escape');
    // Keep the player mounted after load() reset the decoder and delivered its
    // pause/timeupdate events, as happens on a slow connection to the server.
    await expect(page.locator('video')).toHaveAttribute('data-reset', 'true');
    const displayedTime = await page.locator('#position').textContent();
    expect(Number(displayedTime.split(':').at(-1))).toBeGreaterThanOrEqual(Math.floor(before));
    releaseStop();
    await expect(page.locator('video')).toHaveCount(0);
    expect(saved()).toBeGreaterThanOrEqual(before);
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  } finally {
    releaseStop?.(); await browser?.close(); app.downloads.close(); app.closePlayback();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
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
    await page.setViewportSize({ width: 375, height: 800 });
    await page.evaluate(() => window.matroTheme.set('light'));
    await page.getByRole('button', { name: 'Audio and subtitles', exact: true }).click();
    const subtitle = page.locator('[data-subtitle="3"]');
    await subtitle.click();
    await expect(subtitle).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#seek').evaluate(el => { el.value = '6'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect(page.locator('#subtitle-caption')).toHaveText('Subtitles after a seek.');
    await expect.poll(() => page.locator('video').evaluate(v => v.paused)).toBe(true);
    const at = await page.locator('#position').textContent();
    const y = page.getByRole('slider', { name: 'Vertical subtitle position' });
    await y.press('Home');
    await y.press('ArrowRight');
    await expect(y).toHaveValue('1');
    await expect(page.locator('#position')).toHaveText(at);
    await expect(page.locator('#subtitle-caption')).toHaveText('Subtitles after a seek.');
    await page.getByRole('button', { name: 'Close audio and subtitles' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('video')).toHaveCount(0);
    const saved = await page.evaluate(async () => (await (await fetch('/api/library')).json()).progress);
    expect(Object.values(saved).some(p => p.position >= 5.9)).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Resume watching', exact: true }).first().click();
    await page.getByRole('button', { name: 'Audio and subtitles', exact: true }).click();
    await expect(y).toHaveValue('1');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); app.downloads.close(); app.closePlayback();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a receiver plays a saved title after restarting with the server unreachable', async () => {
  const f = await fixtures(), root = await fs.mkdtemp(path.join(f.dir, 'offline-ui-'));
  const media = path.join(root, 'media'); await fs.mkdir(media);
  await fs.copyFile(f.mkv, path.join(media, 'Northbound.mkv'));
  const { app, server, db, library } = createApp({ dataDir: path.join(root, 'data'), tmdb: { env: {} } });
  const respond = server.listeners('request')[0];
  let disconnected = false, browser;
  server.removeListener('request', respond);
  server.on('request', (req, res) => { if (disconnected) req.socket.destroy(); else void respond(req, res); });
  try {
    await app.createUser('head', 'offline-receiver-test', 'admin'); await library.addFolder(media);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const env = { ...process.env, MATRO_USER_DATA: path.join(root, 'profile'), MATRO_METADATA: 'off',
      MATRO_SERVER_URL: `http://127.0.0.1:${server.address().port}` }; delete env.ELECTRON_RUN_AS_NODE;
    const options = { args: [path.resolve(__dirname, '..')], env };
    browser = await electron.launch(options);
    let page = await browser.firstWindow();
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('head');
    await page.getByLabel('Password', { exact: true }).fill('offline-receiver-test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.receiver-account-name')).toHaveText('head');
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Save offline', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved for offline playback.' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await browser.close(); browser = null;

    disconnected = true;
    browser = await electron.launch(options);
    page = await browser.firstWindow();
    await expect(page.getByRole('button', { name: 'Offline · Reconnect' })).toBeVisible();
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.2);
    expect(await page.locator('video').evaluate(v => v.src.startsWith('blob:'))).toBe(true);
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    const queued = page.evaluate(async () => window.matro.loadSubtitle((await window.matro.load()).items[0].id));
    const subtitle = page.getByRole('dialog', { name: 'Add subtitles' });
    await subtitle.locator('input[type=file]').setInputFiles({ name: 'offline.srt', mimeType: 'text/plain',
      buffer: Buffer.from('1\n00:00:00,100 --> 00:00:02,000\nOffline line\n') });
    await subtitle.getByRole('button', { name: 'Add subtitles' }).click();
    expect((await queued).text).toContain('Offline line');
    await page.getByRole('button', { name: 'Profile: head' }).click();
    await page.getByRole('button', { name: 'View offline downloads' }).click();
    const saved = page.getByRole('dialog', { name: 'Saved for offline' });
    await expect(saved.getByText('Northbound', { exact: true })).toBeVisible();
    await expect(saved.getByRole('status')).toContainText('1 subtitle upload');
    await saved.getByRole('button', { name: 'Close', exact: true }).click();
    disconnected = false;
    await page.getByRole('button', { name: 'Offline · Reconnect' }).click();
    await expect(page.getByRole('button', { name: 'Open Northbound', exact: true })).toBeVisible();
    await expect.poll(() => db.prepare('SELECT count(*) AS total FROM subtitles').get().total).toBe(1);
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
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
    await page.route('**/api/items/*/direct?*', async route => { requested(new URL(route.request().url()).searchParams.get('session')); await blocked; await route.abort(); });
    await page.getByRole('button', { name: 'Resume watching', exact: true }).click();
    expect(await started).toMatch(/^[a-f0-9]{32}$/);
    await page.getByRole('button', { name: 'Back to library (Esc)' }).click();
    await expect(page.locator('.shell')).toBeVisible();
    release();
    const saved = await page.evaluate(async () => (await (await fetch('/api/library')).json()).progress);
    expect(Object.values(saved)[0].position).toBeGreaterThanOrEqual(5.9);
    await page.unroute('**/api/items/*/direct?*');
    await page.locator('.continue-card [data-play]').click();
    await expect.poll(() => page.locator('#video').evaluate(v => v.currentTime)).toBeGreaterThanOrEqual(5.9);
  } finally {
    await browser?.close(); app.downloads.close(); app.closePlayback();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('receiver saves manual episode sections, maps the season and removes markers persistently', async () => {
  const f = await fixtures(), root = await fs.mkdtemp(path.join(f.dir, 'markers-ui-')), media = path.join(root, 'media');
  await fs.mkdir(media);
  for (const name of ['North.S01E01', 'North.S01E02', 'North.S02E01', 'South.S01E01']) await fs.copyFile(f.mkv, path.join(media, name + '.mkv'));
  const { app, server, db, library } = createApp({ dataDir: path.join(root, 'data'), tmdb: { env: {} } });
  let browser;
  try {
    const userId = await app.createUser('head', 'manual-markers-test', 'admin'); await library.addFolder(media);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const env = { ...process.env, MATRO_USER_DATA: path.join(root, 'profile'), MATRO_WEB_URL: `http://127.0.0.1:${server.address().port}` }; delete env.ELECTRON_RUN_AS_NODE;
    browser = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    const page = await browser.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('head');
    await page.getByLabel('Password', { exact: true }).fill('manual-markers-test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Open North', exact: true }).click();
    await playAndPauseAfterAdvance(page);
    await expect(page.locator('video')).toHaveAttribute('data-buffer-complete', 'true');
    await page.getByRole('button', { name: 'Skip segment settings' }).click();
    const seek = async at => { await page.locator('#seek').evaluate((el, at) => { el.value = String(at); el.dispatchEvent(new Event('change', { bubbles: true })); }, at); await expect(page.locator('#position')).toHaveText(`0:0${at}`); };
    await seek(1); await page.getByRole('button', { name: 'Mark intro start', exact: true }).click();
    await seek(3); await page.getByRole('button', { name: 'Save end here', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove intro marker', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Apply manual marks to this season', exact: true }).click();
    const catalog = db.prepare('SELECT id, group_title, season, episode FROM items').all();
    const saved = () => JSON.parse(db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(userId).data).markers;
    const season = catalog.filter(i => i.group_title === 'North' && i.season === 1);
    const first = season.find(i => i.episode === 1);
    await expect.poll(() => season.every(i => saved()[i.id]?.some(m => m.type === 'intro' && m.start === 1 && m.end === 3))).toBe(true);
    for (const item of catalog.filter(i => !season.includes(i))) expect(saved()[item.id]?.length || 0).toBe(0);
    await page.getByRole('button', { name: 'Close skip segments' }).click();
    await seek(2); await expect(page.locator('#skip-segment')).toBeVisible();
    await page.locator('#skip-segment').click(); await expect(page.locator('#position')).toHaveText('0:03');
    await page.getByRole('button', { name: 'Skip segment settings' }).click();
    const removal = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/segments/remove'));
    await page.getByRole('button', { name: 'Remove intro marker', exact: true }).click();
    const removed = await removal;
    expect(new URL(removed.url()).pathname).toBe(`/api/items/${first.id}/segments/remove`);
    expect(removed.ok()).toBe(true);
    await expect(page.getByRole('button', { name: 'Remove intro marker', exact: true })).toHaveCount(0);
    await expect.poll(() => saved()[first.id]?.length).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); app.scanner.close(); app.downloads.close(); app.closePlayback();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
