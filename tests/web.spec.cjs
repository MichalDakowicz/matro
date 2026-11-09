const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixtures } = require('./fixtures.cjs');
const { createApp } = require('../packages/core/server');
const { ffmpeg, run } = require('../packages/core/desktop/media.cjs');

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
    await expect.poll(async () => (await durableCheckpoint())?.updated || 0).toBeGreaterThanOrEqual(recoveredAt);
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
    await expect.poll(() => serverProgress()[itemId]?.updated || 0).toBeGreaterThanOrEqual(recoveredAt);
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
    await page.getByRole('button', { name: /^(Play now|Resume)$/ }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.2);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
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
    await expect.poll(() => season.every(i => saved()[i.id]?.some(m => m.type === 'intro' && m.start === 1 && m.end === 3))).toBe(true);
    for (const item of catalog.filter(i => !season.includes(i))) expect(saved()[item.id]?.length || 0).toBe(0);
    await page.getByRole('button', { name: 'Close skip segments' }).click();
    await seek(2); await expect(page.locator('#skip-segment')).toBeVisible();
    await page.locator('#skip-segment').click(); await expect(page.locator('#position')).toHaveText('0:03');
    await page.getByRole('button', { name: 'Skip segment settings' }).click();
    await page.getByRole('button', { name: 'Remove intro marker', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove intro marker', exact: true })).toHaveCount(0);
    const first = season.find(i => i.episode === 1);
    await expect.poll(() => saved()[first.id]?.length).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); app.scanner.close(); app.downloads.close(); app.closePlayback();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
