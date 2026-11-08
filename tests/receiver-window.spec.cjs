const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixtures } = require('./fixtures.cjs');
const { createApp } = require('../packages/core/server');

test('receiver has no native bars, exposes its source switch before sign-in, and enters/exits native fullscreen', async () => {
  const f = await fixtures(), root = await fs.mkdtemp(path.join(f.dir, 'receiver-window-'));
  const media = path.join(root, 'media'), profile = path.join(root, 'profile'); await fs.mkdir(media); await fs.mkdir(profile);
  await fs.copyFile(f.mkv, path.join(media, 'Northbound.mkv'));
  const { app, server, db, library } = createApp({ dataDir: path.join(root, 'data'), tmdb: { env: {} } });
  let browser;
  try {
    await app.createUser('head', 'receiver-window-test', 'admin'); await library.addFolder(media);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    await fs.writeFile(path.join(profile, 'server.json'), JSON.stringify({ url: base, enabled: true }));
    const env = { ...process.env, MATRO_USER_DATA: profile, MATRO_METADATA: 'off' }; delete env.ELECTRON_RUN_AS_NODE; delete env.MATRO_SERVER_URL;
    const launch = process.env.MATRO_EXECUTABLE ? { executablePath: process.env.MATRO_EXECUTABLE, args: [`--user-data-dir=${profile}`] } : { args: [path.resolve(__dirname, '..')] };
    browser = await electron.launch({ ...launch, env });
    const page = await browser.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    const fullscreen = () => browser.evaluate(({ BrowserWindow }, base) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().startsWith(base)).isFullScreen(), base);
    await expect(page.getByRole('button', { name: 'Playback source', exact: true })).toBeVisible();
    expect(await browser.evaluate(({ BrowserWindow, Menu }) => {
      const win = BrowserWindow.getAllWindows()[0], outer = win.getBounds(), inner = win.getContentBounds();
      return { menu: win.isMenuBarVisible(), applicationMenu: Menu.getApplicationMenu() === null, frameHeight: outer.height - inner.height };
    })).toEqual({ menu: false, applicationMenu: true, frameHeight: 0 });
    expect(await page.evaluate(() => Object.keys(window.matroDesktop).sort())).toEqual(['chooseSource', 'fullscreen', 'onFullscreen', 'window']);
    expect(await page.evaluate(() => [typeof require, typeof window.matroSource])).toEqual(['undefined', 'undefined']);
    const opened = browser.waitForEvent('window'); await page.getByRole('button', { name: 'Playback source', exact: true }).click();
    const settings = await opened;
    await expect(settings.getByRole('button', { name: 'Use this PC', exact: true })).toBeVisible();
    await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/source.html')).close());
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('head');
    await page.getByLabel('Password', { exact: true }).fill('receiver-window-test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Playback source', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: /^(Play now|Resume)$/ }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.2);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Fullscreen (F)', exact: true }).click();
    await expect.poll(fullscreen).toBe(true); await expect(page.locator('body')).toHaveClass(/fullscreen/);
    await expect(page.locator('.window-zone')).toBeHidden(); await expect(page.locator('.titlebar')).toBeHidden();
    const geometry = await page.locator('.stage').evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, viewportWidth: innerWidth, viewportHeight: innerHeight }));
    expect(geometry.width).toBe(geometry.viewportWidth); expect(geometry.height).toBe(geometry.viewportHeight);
    await page.keyboard.press('Escape'); await expect.poll(fullscreen).toBe(false); await expect(page.locator('body')).not.toHaveClass(/fullscreen/);
    await expect(page.locator('video')).toBeVisible();
    await page.keyboard.press('f'); await expect.poll(fullscreen).toBe(true);
    await page.keyboard.press('f'); await expect.poll(fullscreen).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); app.downloads.close(); app.closePlayback(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
