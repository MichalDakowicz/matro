const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { fixtures } = require('./fixtures.cjs');
const execute = promisify(execFile);

function options(profile) {
  const env = { ...process.env, MATRO_USER_DATA: profile, MATRO_METADATA: 'off' };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.MATRO_EXECUTABLE) return { executablePath: process.env.MATRO_EXECUTABLE, args: [`--user-data-dir=${profile}`], env };
  return { args: [path.resolve(__dirname, '..')], env, ...(process.env.MATRO_ELECTRON_BINARY ? { executablePath: process.env.MATRO_ELECTRON_BINARY } : {}) };
}

test('SSH settings open from welcome and folders, and failed connections stay in the dialog', async () => {
  const profile = path.resolve(__dirname, '../.test-media', `ssh-ui-${Date.now()}`);
  const app = await electron.launch(options(profile)), page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.getByRole('button', { name: 'Connect SSH', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect over SSH' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Media folder', { exact: true })).toHaveValue('/mnt/media');
    await dialog.getByLabel('Server', { exact: true }).fill('-invalid-host');
    await dialog.getByLabel('Username', { exact: true }).fill('michu');
    await dialog.getByRole('button', { name: 'Connect and add folder' }).click();
    await expect(page.locator('#ssh-status')).toContainText('valid SSH hostname');
    await expect(dialog).toBeVisible();
    expect((await page.evaluate(() => window.matro.load())).folders).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Folders', exact: true }).click();
    await page.getByRole('button', { name: 'Connect SSH', exact: true }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/ssh-folders.png' });
  } finally { await app.close(); }
});

test('real SSH source imports, persists and reconnects after restarting Matro', async () => {
  test.skip(process.env.MATRO_TEST_SSH !== '1', 'Set MATRO_TEST_SSH=1 for the local server integration test.');
  const profile = path.resolve(__dirname, '../.test-media', `ssh-live-ui-${Date.now()}`);
  let app = await electron.launch(options(profile));
  try {
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Connect SSH', exact: true }).click();
    await page.getByLabel('Server', { exact: true }).fill('192.168.100.6');
    await page.getByLabel('Username', { exact: true }).fill('michu');
    await page.screenshot({ path: 'test-results/ssh-settings.png' });
    await page.getByRole('button', { name: 'Connect and add folder' }).click();
    await expect(page.locator('#ssh-dialog')).not.toBeVisible({ timeout: 30000 });
    await expect(page.locator('.source-path')).toContainText('michu@192.168.100.6:/mnt/media');
    let state = await page.evaluate(() => window.matro.load());
    expect(state.items.length).toBeGreaterThan(0); expect(state.sshConnections).toHaveLength(1);
    const id = state.items.find(i => i.format === 'MP4')?.id || state.items[0].id;
    await app.close();
    app = await electron.launch(options(profile)); page = await app.firstWindow();
    const info = await page.evaluate(id => window.matro.prepare(id), id);
    expect(info.duration).toBeGreaterThan(0);
    state = JSON.parse(await fs.readFile(path.join(profile, 'library.json'), 'utf8'));
    expect(state.sshConnections[0].directory).toBe('/mnt/media');
    expect(Object.keys(state.sshConnections[0])).not.toContain('password');
  } finally { await app.close(); }
});

test('SSH subtitles upload beside the video, avoid collisions and persist with choices after restart', async () => {
  test.skip(process.env.MATRO_TEST_SSH !== '1', 'Set MATRO_TEST_SSH=1 for the local server integration test.');
  const f = await fixtures();
  const { stdout } = await execute('ssh', ['-o', 'BatchMode=yes', 'michu@192.168.100.6', 'mktemp -d /mnt/media/.matro-subtitle-test.XXXXXXXX']);
  const directory = stdout.trim();
  if (!/^\/mnt\/media\/\.matro-subtitle-test\.[a-zA-Z0-9]+$/.test(directory)) throw new Error('Unexpected temporary directory; refusing test setup.');
  const name = 'Northbound.S01E03.The.Long.Thaw';
  const subtitle = path.join(f.dir, `ssh-subtitle-${Date.now()}.en.srt`);
  const existing = path.join(f.dir, `ssh-existing-${Date.now()}.srt`);
  const profile = path.join(f.dir, `ssh-subtitle-profile-${Date.now()}`);
  let app;
  try {
    await fs.writeFile(subtitle, '1\n00:00:00,100 --> 00:00:11,000\nSaved SSH subtitle — zażółć\n');
    await fs.writeFile(existing, '1\n00:00:00,100 --> 00:00:11,000\nExisting subtitle remains\n');
    await execute('scp', ['-q', '-o', 'BatchMode=yes', f.mkv, `michu@192.168.100.6:${directory}/${name}.mkv`]);
    // Seed the first name to verify the app chooses a new one rather than replacing it.
    await execute('scp', ['-q', '-o', 'BatchMode=yes', existing, `michu@192.168.100.6:${directory}/${name}.en.srt`]);
    app = await electron.launch(options(profile)); let page = await app.firstWindow();
    await page.evaluate(directory => window.matro.connectSSH({ host: '192.168.100.6', user: 'michu', port: 22, directory }), directory);
    await app.close(); app = await electron.launch(options(profile)); page = await app.firstWindow();
    await page.getByRole('button', { name: 'Open Northbound', exact: true }).click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(.1);
    await page.getByRole('button', { name: 'Audio and subtitles', exact: true }).click();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, subtitle);
    await page.getByRole('button', { name: 'Load subtitle file…', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Subtitles saved next to the video.');
    await expect.poll(() => page.locator('video').evaluate(v => v.textTracks[0]?.cues?.length || 0)).toBeGreaterThan(0);
    await page.locator('[data-action="delay-up"]').click();
    await page.locator('#sub-size').evaluate(el => { el.value = '1.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const state = await page.evaluate(() => window.matro.load());
    const choice = Object.values(state.preferences.tracks)[0]; expect(choice.delay).toBe(.1);
    const downloaded = path.join(f.dir, `ssh-verified-${Date.now()}.srt`);
    await execute('scp', ['-q', '-o', 'BatchMode=yes', `michu@192.168.100.6:${directory}/${name}.en.2.srt`, downloaded]);
    expect(await fs.readFile(downloaded, 'utf8')).toBe(await fs.readFile(subtitle, 'utf8'));
    await app.close(); app = await electron.launch(options(profile)); page = await app.firstWindow();
    await page.getByRole('button', { name: 'Resume watching', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(v => Array.from(v.textTracks[0]?.cues || [], c => c.text).join('\n'))).toContain('Saved SSH subtitle');
    const restored = await page.evaluate(() => window.matro.load());
    expect(Object.values(restored.preferences.tracks)[0]).toEqual(choice);
    expect(restored.preferences.subtitles.size).toBe(1.5);
  } finally {
    await app?.close();
    // Only remove the unique fixture directory created by this test.
    await execute('ssh', ['-o', 'BatchMode=yes', 'michu@192.168.100.6', `python3 -c 'import shutil,sys; p=sys.argv[1]; assert p.startswith("/mnt/media/.matro-subtitle-test."); shutil.rmtree(p)' '${directory}'`]);
  }
});


test('embedded SSH subtitles load from a real movie, survive seeks and reuse the cache after restart', async () => {
  test.skip(process.env.MATRO_TEST_SSH !== '1', 'Set MATRO_TEST_SSH=1 for the read-only embedded subtitle server check.');
  const { rootFor } = require('../electron/ssh-media.cjs');
  const { describe } = require('../electron/media.cjs');
  const profile = path.resolve(__dirname, '../.test-media', 'embedded-ssh-' + Date.now());
  const config = { host: '192.168.100.6', user: 'michu', port: 22, directory: '/mnt/media/Movies/Ghost in the Shell', identity: '' };
  const root = rootFor(config), movie = path.join(root, 'Ghost.in.the.Shell.1995.mkv'), item = describe(movie, root);
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, folders: [root], items: [item], progress: {}, queue: [], preferences: { volume: .5, autoplay: false }, sshConnections: [{ ...config, root }] }));
  let app;
  try {
    app = await electron.launch(options(profile)); let page = await app.firstWindow();
    await page.locator('[data-detail="' + item.id + '"]').first().click();
    await page.getByRole('button', { name: 'Play now', exact: true }).click();
    await expect.poll(() => page.locator('video').evaluate(video => video.currentTime), { timeout: 30000 }).toBeGreaterThan(.1);
    await page.getByRole('button', { name: 'Audio and subtitles', exact: true }).click();
    await page.locator('[data-subtitle="2"]').click();
    await expect.poll(() => page.locator('video').evaluate(video => video.textTracks[0]?.cues?.length || 0), { timeout: 30000 }).toBeGreaterThan(800);
    const future = await page.locator('video').evaluate(video => Array.from(video.textTracks[0].cues).find(cue => cue.startTime > 130)?.endTime);
    expect(future).toBeGreaterThan(130);
    await page.locator('#seek').evaluate(input => { input.value = '120'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect.poll(() => page.locator('video').evaluate((video, end) => Array.from(video.textTracks[0]?.cues || []).some(cue => Math.abs(cue.endTime - (end - 120)) < .05), future), { timeout: 30000 }).toBe(true);
    const cacheDir = path.join(profile, 'subtitles'), cacheFiles = await fs.readdir(cacheDir);
    expect(cacheFiles.filter(name => name.endsWith('.vtt'))).toHaveLength(1);
    const cachePath = path.join(cacheDir, cacheFiles.find(name => name.endsWith('.vtt'))), before = await fs.stat(cachePath);
    await app.close(); app = await electron.launch(options(profile)); page = await app.firstWindow();
    const loaded = await page.evaluate(async id => { const value = await window.matro.subtitles({ id, index: 2 }); return { valid: value.startsWith('WEBVTT'), cues: (value.match(/ --> /g) || []).length }; }, item.id);
    expect(loaded.valid).toBe(true); expect(loaded.cues).toBeGreaterThan(800);
    expect((await fs.stat(cachePath)).mtimeMs).toBe(before.mtimeMs);
    await page.screenshot({ path: 'test-results/embedded-ssh-subtitles.png' });
  } finally { await app?.close(); }
});
