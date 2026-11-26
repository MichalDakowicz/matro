const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fixtures } = require('./fixtures.cjs');
const { createApp } = require('../packages/core/server');
const { ffmpeg, run } = require('../packages/core/desktop/media.cjs');

test('overlapping large progress saves work on a slow connection', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/state') {
      let body = ''; for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      await new Promise(resolve => setTimeout(resolve, 500));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    } else if (['/adapter.js', '/http.js', '/dom.js', '/offline.js', '/offline-store.js', '/movie-requests.js'].includes(req.url)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await fs.readFile(path.join(__dirname, '../apps/web/web', req.url.slice(1))));
    } else res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Network regression</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-network-'));
  const env = { ...process.env, MATRO_USER_DATA: profile, MATRO_WEB_URL: `http://127.0.0.1:${server.address().port}` }; delete env.ELECTRON_RUN_AS_NODE;
  let browser;
  try {
    browser = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    const page = await browser.firstWindow(); await page.waitForLoadState();
    const results = await page.evaluate(async () => {
      const { createAdapter } = await import('/adapter.js');
      const { matro } = createAdapter({ user: { id: 1, username: 'viewer', role: 'viewer' } });
      const state = { progress: {}, queue: [], markers: { episode: [{ type: 'intro', start: 30, end: 90, source: 'manual' }, { type: 'outro', start: 300, end: 330, source: 'automatic' }] }, preferences: { padding: 'x'.repeat(42000) } };
      const baseline = await Promise.allSettled([1, 2, 3].map(() => fetch('/api/state', { method: 'PUT', body: JSON.stringify(state), keepalive: true })));
      const normal = await Promise.all([matro.save(state), matro.save(state), matro.save(state)].map(p => p.then(() => 'saved', e => e.message)));
      const options = [], originalFetch = window.fetch;
      window.fetch = (url, init) => { options.push(init.keepalive); return originalFetch(url, init); };
      try {
        await matro.save({ ...state, preferences: {} }, { keepalive: true });
        await matro.save({ ...state, preferences: { padding: '€'.repeat(22000) } }, { keepalive: true });
      } finally { window.fetch = originalFetch; }
      return { baseline: baseline.map(r => r.status), normal, options };
    });
    expect(results.baseline).toContain('rejected');
    expect(results.normal).toEqual(['saved', 'saved', 'saved']);
    expect(results.options).toEqual([true, false]);
    expect(requests.slice(-5).every(body => !Object.hasOwn(body, 'markers'))).toBe(true);
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
});

test('browser and desktop receiver control playback and hand it back through the same Matro server', async ({ page }) => {
  const f = await fixtures(), root = await fs.mkdtemp(path.join(f.dir, 'handoff-'));
  const media = path.join(root, 'media');
  await fs.mkdir(media);
  await run(ffmpeg, ['-v', 'error', '-stream_loop', '3', '-i', f.mkv, '-t', '42', '-c', 'copy', path.join(media, 'Northbound.mkv')]);
  const { app, server, db, library } = createApp({ dataDir: path.join(root, 'data'), tmdb: { env: {} }, movieRequests: { env: {} } });
  let desktop;
  const devices = current => current.getByRole('dialog', { name: 'Connected devices' });
  const button = (current, name) => current.getByRole('button', { name, exact: true });
  const paused = current => current.locator('video').evaluate(video => video.paused);
  const position = current => current.locator('#seek').evaluate(control => Number(control.value));
  const useControl = async (box, name) => {
    const control = button(box, name);
    await expect(control).toBeEnabled({ timeout: 8000 });
    await control.press('Enter');
  };
  try {
    await app.createUser('head', 'remote-playback-test', 'admin');
    await library.addFolder(media);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, MATRO_USER_DATA: path.join(root, 'profile'), MATRO_WEB_URL: base };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await electron.launch({ args: [path.resolve(__dirname, 'web-host.cjs')], env });
    const receiver = await desktop.firstWindow();

    async function signIn(current, width, theme) {
      await current.setViewportSize({ width, height: 800 });
      await current.getByRole('textbox', { name: 'Username', exact: true }).fill('head');
      await current.getByLabel('Password', { exact: true }).fill('remote-playback-test');
      await button(current, 'Sign in').click();
      await expect(button(current, 'Open Northbound')).toBeVisible();
      await current.evaluate(theme => window.matroTheme.set(theme), theme);
      await expect(current.locator('html')).toHaveAttribute('data-theme', theme);
    }
    await page.goto(base);
    await signIn(page, 390, 'light');
    await signIn(receiver, 1200, 'dark');
    await button(receiver, 'Profile: head').press('Enter');
    await button(receiver, 'Connected devices').press('Enter');
    const receiverBox = devices(receiver);
    await expect(button(receiverBox, 'Enable remote playback')).toBeVisible();
    await expect(button(receiverBox, 'Close')).toBeFocused();
    await receiver.keyboard.press('Tab');
    await expect(receiverBox.getByRole('textbox')).toBeFocused();
    await receiver.keyboard.press('Tab');
    await receiver.keyboard.press('Enter');
    await expect(button(receiverBox, 'Disable remote playback')).toBeVisible();
    await receiver.keyboard.press('Escape');
    await expect(receiverBox).toHaveCount(0);

    await button(page, 'Open Northbound').press('Enter');
    const playOnDevice = button(page, 'Play on device');
    await playOnDevice.press('Enter');
    const box = devices(page);
    await expect(button(box, 'Enable remote playback')).toBeVisible();
    expect(await box.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const size = await button(box, 'Enable remote playback').boundingBox();
    expect(size.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(playOnDevice).toBeFocused();
    await page.keyboard.press('Enter');
    await button(box, 'Enable remote playback').press('Enter');
    await expect(box.getByRole('option', { name: 'Desktop receiver' })).toHaveCount(1);
    await useControl(box, 'Play on selected device');
    await expect.poll(() => position(receiver)).toBeGreaterThan(.2);
    await useControl(box, 'Pause');
    await expect.poll(() => paused(receiver)).toBe(true);
    await expect(box.getByText('Northbound · Paused', { exact: true })).toBeVisible();
    await useControl(box, 'Ahead 10 s');
    await expect.poll(() => position(receiver)).toBeGreaterThan(9);
    await useControl(box, 'Play');
    await expect.poll(() => paused(receiver)).toBe(false);
    // The sender learns the post-seek position when the receiver's playing state reaches it.
    await expect(box.getByText('Northbound · Playing', { exact: true })).toBeVisible();

    await useControl(box, 'Continue on this device');
    await expect(box).toHaveCount(0);
    await expect.poll(() => position(page)).toBeGreaterThan(9);
    await expect.poll(() => paused(receiver)).toBe(true);

    await button(page, 'Devices').press('Enter');
    await page.route('**/api/remote/command', route => route.fulfill({ status: 409, json: { error: 'The receiving device disconnected.' } }));
    await useControl(box, 'Continue on selected device');
    await expect(box.getByRole('status')).toHaveText('The receiving device disconnected.');
    expect(await paused(page)).toBe(false);
    await page.unroute('**/api/remote/command');
    await useControl(box, 'Continue on selected device');
    await expect(box.getByRole('status')).toHaveText('Playing on Desktop receiver.');
    await expect.poll(() => paused(page)).toBe(true);
    await expect.poll(() => paused(receiver)).toBe(false);
    await expect.poll(() => position(receiver)).toBeGreaterThan(9);

    await page.reload();
    await button(page, 'Open Northbound').press('Enter');
    await button(page, 'Play on device').press('Enter');
    await expect(button(box, 'Enable remote playback')).toBeVisible();
  } finally {
    await desktop?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});
