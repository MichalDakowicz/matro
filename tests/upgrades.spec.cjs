const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');
const { run, ffmpeg, describe } = require('../electron/media.cjs');

test('higher resolution download preserves original, filters files, compares editions and remembers favorite', async () => {
  const root = path.resolve('.test-media', `upgrades-${Date.now()}`), movies = path.join(root, 'Movies'), folder = path.join(movies, 'Film'), profile = path.join(root, 'profile');
  await fs.mkdir(folder, { recursive: true }); await fs.mkdir(profile, { recursive: true });
  const original = path.join(folder, 'Film (2020).mkv'), source = path.join(root, 'upgrade-source.mkv');
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', original]);
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=12', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', source]);
  const oldBytes = await fs.readFile(original), old = describe(original, movies), hash = 'abcdef12' + '1'.repeat(32);
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify({ libraryVersion: 2, folders: [movies], items: [old], progress: {}, queue: [], preferences: { autoplay: true, volume: .5 } }));
  const files = [{ index: 0, name: 'Release/Film.2020.720p.mkv', size: 1000000, priority: 1 }, { index: 1, name: 'Release/Subs/English.srt', size: 50, priority: 1 }, { index: 2, name: 'Release/README.txt', size: 50, priority: 1 }, { index: 3, name: 'Release/poster.jpg', size: 50, priority: 1 }];
  let torrent = null, addForm; const commands = [];
  const server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const data = new URLSearchParams(raw), route = req.url.split('?')[0]; commands.push(route);
      const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
      if (route === '/catalog/list_movies.json') { json({ status: 'ok', data: { movie_count: 1, movies: [{ id: 1, title: 'Film', year: 2020, torrents: [{ hash, quality: '720p', size: '1 GiB', seeds: 10 }, { hash: '2'.repeat(40), quality: '180p', seeds: 10 }] }] } }); return; }
      if (route.endsWith('/auth/login')) { res.setHeader('Set-Cookie', 'SID=fixture; path=/'); res.end('Ok.'); return; }
      if (route.endsWith('/app/version')) { res.end('v5.1.4'); return; }
      if (route.endsWith('/torrents/info')) { json(torrent ? [torrent] : []); return; }
      if (route.endsWith('/torrents/files')) { json(files); return; }
      if (route.endsWith('/torrents/add')) { addForm = data; torrent = { hash, name: 'Film', tags: data.get('tags'), save_path: data.get('savepath'), state: 'stoppedDL', progress: 0, dlspeed: 0 }; res.end('Ok.'); return; }
      if (route.endsWith('/torrents/stop')) { res.end(); return; }
      if (route.endsWith('/torrents/filePrio')) { for (const index of data.get('id').split('|').map(Number)) files.find(file => file.index === index).priority = +data.get('priority'); res.end(); return; }
      if (route.endsWith('/torrents/renameFile')) { files.find(file => file.name === data.get('oldPath')).name = data.get('newPath'); res.end(); return; }
      if (route.endsWith('/torrents/setLocation')) { torrent.save_path = data.get('location'); res.end(); return; }
      if (route.endsWith('/torrents/start')) {
        for (const file of files.filter(file => file.priority > 0)) {
          const destination = path.join(torrent.save_path, file.name); await fs.mkdir(path.dirname(destination), { recursive: true });
          if (/\.mkv$/.test(file.name)) await fs.copyFile(source, destination); else await fs.writeFile(destination, '1\n00:00:00,000 --> 00:00:00,800\nSubtitle\n');
        }
        torrent.progress = 1; torrent.state = 'stoppedUP'; res.end(); return;
      }
      res.statusCode = 404; res.end();
    } catch (error) { res.statusCode = 500; res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, env = { ...process.env, MATRO_USER_DATA: profile, MATRO_METADATA: 'off', MATRO_TORRENT_API: base + '/catalog/' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [path.resolve('.')], env }); const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(async ({ base, movies, root }) => window.matro.downloadConfigure({ target: 'local', url: base, username: 'u', password: 'fixture', seeding: 'no', storage: { movieRoot: movies, showRoot: root + '/Shows', movieFolders: 'title', showFolders: 'season', naming: 'clean', subtitles: true } }), { base, movies, root });
    await page.getByRole('button', { name: 'Open Film (2020)', exact: true }).first().click();
    await page.getByRole('button', { name: 'Find better quality / compare editions', exact: true }).click();
    await expect(page.locator('.edition-card')).toHaveCount(1);
    await page.locator('.download-movie').click();
    await expect(page.locator('.download-release')).toHaveCount(2);
    await expect(page.locator('.download-release').last().getByRole('button')).toBeDisabled();
    await page.getByRole('button', { name: 'Upgrade on This PC', exact: true }).first().click();
    await expect.poll(async () => (await page.evaluate(() => window.matro.downloadJobs('local')))[0]?.phase, { timeout: 30000 }).toBe('complete');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Refresh editions', exact: true }).click();
    await expect(page.locator('.edition-card')).toHaveCount(2);
    expect(await fs.readFile(original)).toEqual(oldBytes);
    expect(files.filter(file => file.priority > 0)).toHaveLength(2);
    expect(files.filter(file => file.priority === 0).map(file => file.index)).toEqual([2, 3]);
    expect(files[0].name).toBe('Film/Film (2020) [720p] [abcdef12].mkv');
    expect(addForm.get('useDownloadPath')).toBe('false'); expect(addForm.get('shareLimitAction')).toBe('Stop'); expect(addForm.get('seedingTimeLimit')).toBe('0');
    expect(commands.indexOf('/api/v2/torrents/start')).toBeGreaterThan(commands.indexOf('/api/v2/torrents/renameFile'));
    await page.locator('.edition-card').last().getByRole('button', { name: 'Make favorite', exact: true }).click();
    await expect(page.locator('.edition-card').last()).toContainText('Saved favorite');
    const saved = await page.evaluate(() => window.matro.load()), favorite = saved.movieEditions[old.id].favorite;
    expect(favorite).not.toBe(old.id); expect(saved.items).toHaveLength(2);
    await page.screenshot({ path: 'test-results/movie-upgrades.png' });
    await page.locator('.edition-card').first().getByRole('button', { name: 'Play this edition', exact: true }).click();
    await expect(page.locator('video')).toBeVisible();
    await expect.poll(() => page.evaluate(async () => (await window.matro.load()).queue[0])).toBe(old.id);
    await app.close(); app = null;
    app = await electron.launch({ args: [path.resolve('.')], env }); const restored = await app.firstWindow();
    expect((await restored.evaluate(() => window.matro.load())).movieEditions[old.id].favorite).toBe(favorite);
    await restored.evaluate(() => window.matro.rescan());
    const rescanned = await restored.evaluate(() => window.matro.load()); expect(rescanned.items.filter(item => item.kind === 'movie')).toHaveLength(2); expect(rescanned.items.filter(item => item.kind === 'show')).toHaveLength(0);
    await restored.locator(`[data-detail="${old.id}"]`).first().click();
    await restored.locator('#detail-overlay').getByRole('button', { name: /^(Play now|Resume)/ }).click();
    await expect.poll(() => restored.evaluate(async () => (await window.matro.load()).queue[0])).toBe(favorite);
    expect(errors).toEqual([]);
  } finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
