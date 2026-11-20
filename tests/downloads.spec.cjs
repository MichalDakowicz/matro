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

test('Downloads browses seeded titles and previews anime releases before an explicit download', async ({}, testInfo) => {
  const profile = path.resolve('.test-media', `discovery-${Date.now()}`);
  const image = await fs.readFile(path.resolve('assets/icon.png'));
  await fs.mkdir(profile, { recursive: true });
  const hash = '1'.repeat(40), numberedHash = '2'.repeat(40), batchHash = '3'.repeat(40);
  const titles = [], details = [], seasons = [], added = [], errors = [];
  let initialPoster;
  const posterGate = new Promise(resolve => { initialPoster = resolve; });
  const film = { id: 42, title: 'Fixture Film', release_date: '2024-01-03', overview: 'A TMDB fixture overview.', poster_path: '/film.png', runtime: 92, genres: [{ name: 'Adventure' }] };
  const anime = { id: 2, name: 'Star Sailor', original_name: '星の船人', first_air_date: '2023-01-01', overview: 'A sailor travels from star to star.', poster_path: '/anime.png', genre_ids: [16], genres: [{ id: 16, name: 'Animation' }], number_of_seasons: 2, episode_run_time: [24], vote_count: 12, vote_average: 8.6, alternative_titles: { results: [{ title: 'Hoshi no Funabito' }] } };
  const episode = (releaseTitle, id, seeds = 0) => `<item><title>${releaseTitle}</title><nyaa:infoHash>${id}</nyaa:infoHash><nyaa:size>1 GiB</nyaa:size><nyaa:seeders>${seeds}</nyaa:seeders><nyaa:leechers>2</nyaa:leechers><nyaa:categoryId>1_2</nyaa:categoryId></item>`;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture'), route = url.pathname;
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = new URLSearchParams(raw);
    const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (route === '/catalog/list_movies.json') return json({ status: 'ok', data: { movie_count: 1, movies: [{ id: 42, tmdb_id: 42, title: film.title, year: 2024, torrents: [{ hash: 'f'.repeat(40), quality: '1080p', seeds: 21 }] }] } });
    if (route === '/series/get-torrents') return json({ torrents_count: 1, torrents: [{ hash: 'e'.repeat(40), filename: 'Fixture.Series.S01E02.720p.mkv', season: '1', episode: '2', seeds: 34 }] });
    if (route === '/anime/') {
      const query = url.searchParams.get('q'); titles.push(query);
      const releases = [episode('[Group] Star Sailor - 14 [1080p][Dual Audio][English Subs]', hash, 82), episode('[Group] Star Sailor S02E03 [720p]', numberedHash, 11), episode('[Group] Star Sailor Season 2 Complete [1080p]', batchHash, 12)];
      if (!query) releases.push(episode('[Group] Quiet Signal - 01 [720p]', '4'.repeat(40), 5));
      res.setHeader('Content-Type', 'application/xml'); return res.end(`<rss version="2.0"><channel>${releases.join('')}</channel></rss>`);
    }
    if (route === '/prowlarr/api/v1/search') { res.statusCode = 503; return res.end('{}'); }
    if (route === '/tmdb/search/tv') return json({ results: url.searchParams.get('query') === anime.name ? [anime] : [] });
    if (route === '/tmdb/search/movie') return json({ results: [] });
    if (route === '/tmdb/movie/42' || route === '/tmdb/tv/2') {
      if (url.searchParams.get('append_to_response')) details.push(route);
      return json(route.includes('/movie/') ? film : anime);
    }
    if (route === '/tmdb/tv/2/season/2') { seasons.push(route); return json({ episodes: [{ episode_number: 3, name: 'The bright pier' }] }); }
    if (route.startsWith('/images/')) {
      if (route.endsWith('/film.png')) await posterGate;
      res.setHeader('Content-Type', 'image/png'); return res.end(image);
    }
    if (route.endsWith('/auth/login')) { res.setHeader('Set-Cookie', 'SID=fixture; path=/'); return res.end('Ok.'); }
    if (route.endsWith('/app/version')) return res.end('v5.1.4');
    if (route.endsWith('/torrents/info')) return json(added.length ? [{ hash, name: anime.name, tags: added[0].get('tags'), state: 'stoppedDL', progress: 0, save_path: added[0].get('savepath') }] : []);
    if (route.endsWith('/torrents/add')) { added.push(body); return res.end('Ok.'); }
    if (route.endsWith('/torrents/files')) return json([]);
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, MATRO_USER_DATA: profile, MATRO_METADATA: '', TMDB_ACCESS_TOKEN: 'fixture-tmdb', MATRO_TORRENT_API: `${base}/catalog/`, MATRO_SERIES_RELEASES_API: `${base}/series/`, MATRO_ANIME_API: `${base}/anime/`, MATRO_TMDB_API: `${base}/tmdb`, MATRO_TMDB_IMAGES: `${base}/images`, MATRO_PROWLARR_URL: `${base}/prowlarr/`, MATRO_PROWLARR_API_KEY: 'fixture-prowlarr' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.MATRO_SERVER_URL;
  let app;
  try {
    app = await electron.launch({ args: [path.resolve('.')], env });
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(value => window.matro.downloadConfigure(value), { target: 'local', url: base, storage: { movieRoot: path.join(profile, 'Movies'), showRoot: path.join(profile, 'Shows') } });
    await page.getByRole('button', { name: 'Downloads', exact: true }).click();
    await page.evaluate(() => window.matroTheme.set('dark'));
    await page.getByRole('searchbox', { name: 'Search movie torrents' }).fill('Fixture');
    await page.getByRole('search').getByRole('button', { name: 'Search', exact: true }).click();
    const filmCard = page.locator('.download-movie'); await filmCard.focus(); initialPoster();
    await expect(filmCard.locator('img.download-poster')).toBeVisible();
    await expect(filmCard).toBeFocused(); expect(details).toEqual([]);
    await filmCard.press('Enter');
    await expect(page.getByRole('dialog').getByText('A TMDB fixture overview.')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Adventure · 92 min')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(filmCard).toBeFocused();
    await page.getByRole('button', { name: 'Most seeded', exact: true }).click();
    await expect(page.locator('.download-discovery').first()).toContainText('21 seeds');

    await page.getByRole('button', { name: 'Series', exact: true }).click();
    await page.getByRole('button', { name: 'Most seeded', exact: true }).click();
    await expect(page.locator('.download-discovery').first()).toContainText('34 seeds');

    await page.getByRole('button', { name: 'Anime', exact: true }).click();
    await page.getByRole('button', { name: 'Most seeded', exact: true }).click();
    await expect(page.locator('.download-discovery')).toHaveCount(2);
    await expect(page.locator('.download-discovery').first()).toContainText('Star Sailor');
    await expect(page.getByText('Prowlarr is unavailable.')).toBeVisible();
    await page.locator('.download-discovery').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('A sailor travels from star to star.')).toBeVisible();
    await expect(dialog.getByText(/Also known as.*Hoshi no Funabito/)).toBeVisible();
    await expect(dialog.getByText('Episode 14 (absolute) · 1080p')).toBeVisible();
    await expect(dialog.getByText('S02 batch · 1080p')).toBeVisible();
    await expect(dialog.getByText('Dual audio · English subtitles (release label, unverified)')).toBeVisible();
    const picker = dialog.getByLabel('Episode names'); expect(seasons).toEqual([]);
    await picker.focus(); await picker.selectOption('2'); await expect(dialog.getByText(/The bright pier/)).toBeVisible(); await expect(picker).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('downloads-anime-dark.png') });
    await dialog.getByLabel('Audio hint').selectOption('Dual audio');
    await expect(dialog.locator('.discovery-release:visible')).toHaveCount(1);
    expect(added).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Download to This PC', exact: true }).click();
    await page.getByRole('button', { name: 'No, stop when complete', exact: true }).click();
    await expect.poll(() => added.length).toBe(1);
    expect(added[0].get('urls')).toContain(hash); expect(added[0].get('savepath')).toContain('Shows');
    await dialog.getByRole('button', { name: 'Search with alternate titles', exact: true }).click();
    await expect.poll(() => titles.includes('Hoshi no Funabito')).toBe(true);
    await expect(page.getByRole('searchbox', { name: 'Search anime torrents' })).toHaveValue('Star Sailor');
    await page.setViewportSize({ width: 375, height: 760 });
    await page.evaluate(() => window.matroTheme.set('light'));
    await expect(page.getByRole('button', { name: 'Anime', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.querySelector('.page').scrollWidth <= document.querySelector('.page').clientWidth)).toBe(true);
    await page.locator('.download-discovery').first().click();
    await expect(dialog.getByText('A sailor travels from star to star.')).toBeVisible();
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('downloads-anime-light-narrow.png') });
    expect(errors).toEqual([]);
  } finally { initialPoster(); await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
