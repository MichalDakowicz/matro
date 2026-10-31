const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');

test('Movies and Series have separate searches and series filters send episode files to Shows', async () => {
  const profile = path.resolve('.test-media', 'series-ui-' + Date.now()), showRoot = path.join(profile, 'Shows'), movieRoot = path.join(profile, 'Movies'); await fs.mkdir(profile, { recursive: true });
  const hash = 'abcdef12' + '1'.repeat(32), second = '2'.repeat(40), old = '3'.repeat(40);
  let metadataRequests = 0, releaseRequests = 0, movieRequests = 0, torrent = null, added = null;
  const files = [{ index: 0, name: 'Release/video.mkv', size: 10000, priority: 1 }, { index: 1, name: 'Release/English.srt', size: 100, priority: 1 }, { index: 2, name: 'Release/README.txt', size: 50, priority: 1 }, { index: 3, name: 'Release/poster.jpg', size: 50, priority: 1 }];
  const release = (season, episode, quality, hash) => ({ hash, imdb_id: '1234567', season: String(season), episode: String(episode), filename: `Sample.Show.S0${season}E0${episode}.${quality}.x265.mkv`, title: `Sample Show S0${season}E0${episode} ${quality} <img src=x onerror=window.injected=true>`, seeds: 10, peers: 2, size_bytes: 1000000000 });
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://fixture'), data = new URLSearchParams(body), json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (url.pathname === '/metadata/search/shows') { metadataRequests++; json([{ show: { id: 7, name: 'Sample Show', premiered: '2021-01-01', language: 'English', genres: ['Drama'], status: 'Ended', externals: { imdb: 'tt1234567' }, summary: '<b>A series summary</b>' } }]); return; }
    if (url.pathname === '/series/get-torrents') { releaseRequests++; json({ torrents_count: 200, torrents: url.searchParams.get('page') === '1' ? [release(1, 1, '720p', old)] : [release(2, 3, '1080p', hash), release(2, 4, '720p', second)] }); return; }
    if (url.pathname === '/movies/list_movies.json') { movieRequests++; json({ status: 'ok', data: { movie_count: 0 } }); return; }
    if (url.pathname.endsWith('/auth/login')) { res.setHeader('Set-Cookie', 'SID=fixture; path=/'); res.end('Ok.'); return; }
    if (url.pathname.endsWith('/app/version')) { res.end('v5.1.4'); return; }
    if (url.pathname.endsWith('/torrents/info')) { json(torrent ? [torrent] : []); return; }
    if (url.pathname.endsWith('/torrents/add')) { added = data; torrent = { hash, name: 'Sample Show', tags: data.get('tags'), save_path: data.get('savepath'), state: 'stoppedDL', progress: 0 }; res.end('Ok.'); return; }
    if (url.pathname.endsWith('/torrents/files')) { json(files); return; }
    if (url.pathname.endsWith('/torrents/stop')) { res.end(); return; }
    if (url.pathname.endsWith('/torrents/filePrio')) { for (const index of data.get('id').split('|').map(Number)) files.find(file => file.index === index).priority = +data.get('priority'); res.end(); return; }
    if (url.pathname.endsWith('/torrents/renameFile')) { files.find(file => file.name === data.get('oldPath')).name = data.get('newPath'); res.end(); return; }
    if (url.pathname.endsWith('/torrents/setLocation')) { torrent.save_path = data.get('location'); res.end(); return; }
    if (url.pathname.endsWith('/torrents/start')) { torrent.state = 'downloading'; torrent.progress = .1; res.end(); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`, env = { ...process.env, MATRO_USER_DATA: profile, MATRO_METADATA: 'off', MATRO_TORRENT_API: base + 'movies/', MATRO_SERIES_METADATA_API: base + 'metadata/', MATRO_SERIES_RELEASES_API: base + 'series/' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: [path.resolve('.')], env }); const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(async ({ base, movieRoot, showRoot }) => window.matro.downloadConfigure({ target: 'local', url: base, seeding: 'no', storage: { movieRoot, showRoot } }), { base, movieRoot, showRoot });
    await page.getByRole('button', { name: 'Downloads', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search movie torrents', exact: true }).fill('A movie query');
    await page.locator('#download-kind').click();
    await expect(page.locator('.download-destination .mono')).toContainText(showRoot);
    await page.getByRole('searchbox', { name: 'Search series torrents', exact: true }).fill('Sample Show');
    expect(metadataRequests).toBe(0); expect(releaseRequests).toBe(0); expect(movieRequests).toBe(0);
    await page.getByRole('searchbox', { name: 'Search series torrents', exact: true }).press('Enter');
    await expect(page.locator('.download-series')).toHaveCount(1); expect(releaseRequests).toBe(0);
    await page.locator('.download-series').click();
    await expect(page.locator('.series-release')).toHaveCount(1);
    await page.getByRole('button', { name: 'More releases', exact: true }).click();
    await expect(page.locator('.series-release')).toHaveCount(2);
    await page.locator('#series-filter-form [name="season"]').fill('2');
    await page.locator('#series-filter-form [name="episode"]').fill('3');
    await page.getByRole('button', { name: 'Apply series filters', exact: true }).click();
    await expect(page.locator('.series-release')).toHaveCount(1);
    await page.getByRole('button', { name: '1080p', exact: true }).click();
    await expect(page.locator('.series-release')).toHaveCount(1);
    await expect(page.locator('.series-release')).toContainText('S02E03');
    expect(await page.evaluate(() => window.injected)).toBeUndefined(); expect(added).toBeNull();
    await page.getByRole('button', { name: 'Download to This PC', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.matro.downloadJobs('local')))[0]?.phase, { timeout: 20000 }).toBe('ready');
    expect(added.get('savepath')).toContain(showRoot); expect(added.get('useDownloadPath')).toBe('false'); expect(added.get('ratioLimit')).toBe('0');
    expect(torrent.save_path).toBe(showRoot);
    expect(files[0].name).toBe('Sample Show/S02/S02E03 Sample Show (2021) [1080p].mkv');
    expect(files[1].name).toBe('Sample Show/S02/S02E03 Sample Show (2021) [1080p].en.srt');
    expect(files.slice(2).every(file => file.priority === 0)).toBe(true);
    await page.screenshot({ path: 'test-results/series-downloader.png' });
    await page.keyboard.press('Escape');
    await page.locator('#download-kind').click();
    await expect(page.getByRole('searchbox', { name: 'Search movie torrents', exact: true })).toHaveValue('A movie query');
    await expect(page.locator('.download-destination .mono')).toContainText(movieRoot);
    expect(metadataRequests).toBe(1); expect(movieRequests).toBe(0); expect(releaseRequests).toBe(2);
    expect(errors).toEqual([]);
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
