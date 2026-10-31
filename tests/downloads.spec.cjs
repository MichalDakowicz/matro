const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

test('movie browser searches explicitly, saves encrypted destinations, and sends selected releases to local or server', async () => {
  const profile = path.resolve('.test-media', `downloads-${Date.now()}`);
  await fs.mkdir(profile, { recursive: true });
  const hash = '1234567890abcdef1234567890abcdef12345678';
  const added = [], existing = new Map(); let searches = 0, failSearch = false;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw), route = req.url.split('?')[0], destination = route.split('/')[1];
    if (route === '/catalog/list_movies.json') {
      searches++; res.setHeader('Content-Type', 'application/json');
      if (failSearch) { res.statusCode = 503; res.end('{}'); return; }
      res.end(JSON.stringify({ status: 'ok', data: { movie_count: 1, movies: [{ id: 42, title: 'A Movie <script>window.injected = true</script>', year: 1968, language: 'en', summary: 'A fixture movie for testing the browser.', torrents: [{ hash, quality: '1080p', type: 'bluray', size: '1.5 GB', seeds: 12, peers: 2 }] }] } })); return;
    }
    if (route.endsWith('/auth/login')) {
      if (form.get('password') !== 'fixture-password') { res.end('Fails.'); return; }
      res.setHeader('Set-Cookie', 'SID=fixture; path=/'); res.end('Ok.'); return;
    }
    if (req.headers.cookie !== 'SID=fixture') { res.statusCode = 403; res.end(); return; }
    if (route.endsWith('/app/version')) { res.end('v5.1.4'); return; }
    if (route.endsWith('/torrents/info')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(existing.get(destination) || [])); return; }
    if (route.endsWith('/torrents/add')) {
      added.push({ destination, savePath: form.get('savepath'), magnet: form.get('urls') });
      existing.set(destination, [{ hash, name: 'Fixture download', tags: form.get('tags'), progress: .25, state: 'downloading', dlspeed: 1024, save_path: form.get('savepath') }]);
      res.end('Ok.'); return;
    }
    if (route.endsWith('/torrents/files')) { res.setHeader('Content-Type', 'application/json'); res.end('[]'); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, MATRO_USER_DATA: profile, MATRO_METADATA: 'off', MATRO_TORRENT_API: base + '/catalog/' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [path.resolve('.')], env });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: 'Downloads', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Download settings', exact: true })).toBeVisible();
    expect(searches).toBe(0); expect(added).toHaveLength(0);
    const configure = async (destination, folder) => {
      await page.locator('[data-edit="' + destination + '"]').click();
      await page.locator('[name="url"]').fill(base + '/' + destination);
      await page.locator('[name="username"]').fill('fixture');
      await page.locator('[name="password"]').fill('fixture-password');
      await page.getByRole('tab', { name: 'Files', exact: true }).click();
      await page.locator('[name="movieRoot"]').fill(folder);
      await page.locator('[name="showRoot"]').fill(folder + (destination === 'local' ? '\\Shows' : '/Shows'));
      await page.getByRole('button', { name: 'Test and save', exact: true }).click();
      await expect(page.locator('#download-message')).toContainText('Settings saved');
    };
    await configure('local', 'C:\\Movies');
    await page.getByRole('button', { name: 'Download settings', exact: true }).click();
    await configure('server', '/mnt/media/downloads/complete');
    let disk = await fs.readFile(path.join(profile, 'downloads.json'), 'utf8');
    expect(disk).not.toContain('fixture-password');
    const publicConfig = await page.evaluate(() => window.matro.downloadConfig());
    expect(publicConfig.local.passwordSaved).toBe(true); expect(publicConfig.server.passwordSaved).toBe(true);
    expect(JSON.stringify(publicConfig)).not.toContain('secret');
    await page.getByRole('searchbox', { name: 'Search movie torrents', exact: true }).fill('public domain');
    expect(searches).toBe(0);
    await page.getByRole('searchbox', { name: 'Search movie torrents', exact: true }).press('Enter');
    await expect(page.locator('.download-movie')).toHaveCount(1);
    expect(searches).toBe(1); expect(added).toHaveLength(0);
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
    await page.locator('.download-movie').click();
    await expect(page.getByRole('button', { name: 'Download to Server', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Download to Server', exact: true }).click();
    await page.getByRole('button', { name: 'No, stop when complete', exact: true }).click();
    await expect(page.locator('#download-message')).toContainText('Sent to qBittorrent on Server');
    disk = await fs.readFile(path.join(profile, 'downloads.json'), 'utf8');
    expect(JSON.parse(disk).seeding).toBe(false);
    await expect(page.locator('#download-message')).toContainText('Sent to qBittorrent on Server');
    await expect(page.locator('.download-job')).toHaveCount(1);
    expect((await page.evaluate(() => window.matro.downloadList('server')))[0].progress).toBe(.25);
    expect(added).toHaveLength(1); expect(added[0].savePath).toContain('/mnt/media/downloads/complete/.matro-pending/');
    await page.keyboard.press('Escape');
    await page.locator('[data-destination="local"]').click();
    await page.locator('.download-movie').click();
    await page.getByRole('button', { name: 'Download to This PC', exact: true }).click();
    await expect(page.locator('#download-message')).toContainText('Sent to qBittorrent on This PC');
    expect(added).toHaveLength(2); expect(added[1].savePath).toContain('C:\\Movies');
    expect(added[1].magnet).toContain(hash);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Download settings', exact: true }).click();
    await page.locator('[name="password"]').fill('wrong');
    await page.getByRole('button', { name: 'Test and save', exact: true }).click();
    await expect(page.locator('#download-message')).toContainText('login failed');
    expect(await fs.readFile(path.join(profile, 'downloads.json'), 'utf8')).toBe(disk);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    failSearch = true;
    await page.getByRole('searchbox', { name: 'Search movie torrents', exact: true }).press('Enter');
    await expect(page.locator('#download-message')).toContainText('HTTP 503');
    await page.screenshot({ path: 'test-results/downloads-error.png' });
    failSearch = false;
    await page.getByRole('searchbox', { name: 'Search movie torrents', exact: true }).press('Enter');
    await expect(page.locator('.download-movie')).toHaveCount(1);
    await page.locator('.download-movie').click();
    await page.screenshot({ path: 'test-results/downloads-browser.png' });
    expect(errors).toEqual([]);
    await page.keyboard.press('Escape');
    await app.close(); app = null;
    app = await electron.launch({ args: [path.resolve('.')], env });
    const restored = await app.firstWindow();
    await restored.getByRole('button', { name: 'Downloads', exact: true }).click();
    await expect(restored.locator('.download-job')).toHaveCount(1);
    await expect(restored.locator('[data-destination="local"]')).toHaveAttribute('aria-pressed', 'true');
    expect((await restored.evaluate(() => window.matro.downloadConfig())).server.passwordSaved).toBe(true);
    await restored.setViewportSize({ width: 900, height: 700 });
    await expect(restored.getByRole('button', { name: 'Downloads', exact: true })).toBeVisible();
    await restored.getByRole('button', { name: 'Download settings', exact: true }).click();
    await expect(restored.locator('[name="url"]')).toBeVisible();
    expect(await restored.evaluate(() => document.querySelector('.page').scrollWidth <= document.querySelector('.page').clientWidth)).toBe(true);
    await restored.screenshot({ path: 'test-results/downloads-settings-compact.png' });
  } finally {
    if (app) await app.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
