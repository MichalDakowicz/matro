const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { createSeriesCatalog } = require('../packages/core/desktop/series-catalog.cjs');
const { createTorrents } = require('../packages/core/desktop/torrents.cjs');
const { planDownload, defaultStorage } = require('../packages/core/desktop/download-layout.cjs');
const hash = 'abcdef12' + '1'.repeat(32);
const show = { id: 7, name: 'Sample Show', premiered: '2021-01-01', externals: { imdb: 'tt1234567' }, summary: '<b>A show &amp; its story</b>', language: 'English', genres: ['Drama'], status: 'Ended' };
const release = (season, episode, quality, code = hash) => ({ hash: code, imdb_id: '1234567', season: String(season), episode: String(episode), filename: `Sample.Show.S0${season}E0${episode}.${quality}.x265.mkv`, title: 'Episode release', seeds: 10, peers: 3, size_bytes: 1073741824, magnet_url: `magnet:?xt=urn:btih:${code}&tr=udp://tracker.example/announce&tr=javascript:bad&xs=https://untrusted.invalid/` });

test('series search is explicit, selects exact show and filters older release pages', async () => {
  const calls = [], remembered = new Map();
  const catalog = createSeriesCatalog({ request: async url => { calls.push(String(url)); if (url.pathname.endsWith('search/shows')) return [{ show }, { show: { id: 8, name: 'No index' } }]; return { torrents_count: 200, torrents: url.searchParams.get('page') === '1' ? [release(1, 1, '720p')] : [release(2, 3, '1080p')] }; }, json: async value => value, rememberRelease: (hash, value) => remembered.set(hash, value) });
  assert.equal(calls.length, 0);
  const found = await catalog.search({ query: 'Sample' });
  assert.equal(calls.length, 1); assert.equal(found.shows.length, 2); assert.equal(found.shows[0].overview, 'A show & its story'); assert.equal(found.shows[1].indexed, false);
  const results = await catalog.releases({ id: '7', season: 2, episode: 3, quality: '1080p' });
  assert.equal(results.scanned, 2); assert.equal(results.releases.length, 1); assert.equal(results.nextPage, null);
  assert.equal(remembered.get(hash).kind, 'show'); assert.equal(remembered.get(hash).episode, 3);
  assert.ok(remembered.get(hash).magnet.includes('udp%3A'));
  assert.ok(!remembered.get(hash).magnet.includes('javascript')); assert.ok(!remembered.get(hash).magnet.includes('untrusted'));
  await catalog.releases({ id: '7', season: 2, episode: 3, quality: '1080p' }); assert.equal(calls.length, 3);
  assert.equal(catalog.source('7'), 'https://www.tvmaze.com/shows/7');
  await assert.rejects(catalog.releases({ id: '999' }), /Search again/);
  await assert.rejects(catalog.releases({ id: '7', season: -1 }), /Invalid series filter/);
  await assert.rejects(catalog.releases({ id: '7', quality: 'invalid' }), /resolution filter/);
  await assert.rejects(catalog.releases({ id: '8' }), /no release index/);
});
test('wrong IMDb, malformed hashes and expired show selections are rejected', async t => {
  const catalog = createSeriesCatalog({ request: async url => url.pathname.endsWith('search/shows') ? [{ show }] : { torrents_count: 5, torrents: [null, { hash, imdb_id: '1234567' }, { ...release(1, 1, '720p'), imdb_id: '9999999' }, { ...release(1, 1, '720p'), hash: 'bad' }, 'invalid'] }, json: async value => value, rememberRelease: () => { throw new Error('invalid release must not be remembered'); } });
  await catalog.search({ query: 'Sample' });
  assert.deepEqual((await catalog.releases({ id: '7' })).releases, []);
  const future = Date.now() + 61 * 60 * 1000; t.mock.method(Date, 'now', () => future);
  await assert.rejects(catalog.releases({ id: '7' }), /Search again/);
});
test('season lookup combines matching episodes across pages and prefers a listed pack', async () => {
  const code = n => n.toString(16).padStart(40, '0');
  const episode = (n, id, group, source = 'WEB-DL', seeds = 10) => ({
    ...release(2, n, '1080p', code(id)), seeds, filename: `Sample.Show.S02E0${n}.1080p.${source}.x265-${group}[eztv.re].mkv`
  });
  const pages = {
    1: [episode(1, 1, 'TEAM'), episode(1, 2, 'TEAM', 'WEB-DL', 20), episode(2, 3, 'TEAM', 'BluRay', 100), episode(3, 4, 'OTHER')],
    4: [{ ...episode(2, 5, 'TEAM'), filename: 'Sample.Show.S02E02-E03.1080p.WEB-DL.x265-TEAM.mkv' }],
    5: [episode(2, 6, 'TEAM'), episode(3, 7, 'TEAM')]
  };
  const remembered = new Map();
  const catalog = createSeriesCatalog({
    request: async url => {
      if (url.pathname.endsWith('search/shows')) return [{ show }];
      if (url.pathname.endsWith('/episodes')) return [1, 2, 3].map(number => ({ season: 2, number }));
      return { torrents_count: 500, torrents: pages[url.searchParams.get('page')] || [] };
    },
    json: async value => value,
    rememberRelease: (hash, value) => remembered.set(hash, value)
  });
  await catalog.search({ query: 'Sample' });
  const filters = { id: '7', season: 2, quality: '1080p', seasonDownload: true };
  const first = await catalog.releases(filters);
  assert.equal(first.coverage, 1);
  assert.equal(first.batch, null);
  assert.equal(first.nextPage, 5);
  const second = await catalog.releases({ ...filters, page: first.nextPage });
  assert.equal(second.batch.count, 3);
  assert.equal(second.batch.group, 'TEAM');
  assert.equal(second.nextPage, null);
  assert.deepEqual(catalog.seasonBatch(second.batch.id).map(value => [value.episode, value.hash]), [[1, code(2)], [2, code(6)], [3, code(7)]]);

  pages[2] = [{ ...release(2, 0, '720p', code(8)), filename: 'Sample.Show.S02.720p.WEB-DL.x265-TEAM' }];
  // This catalog instance has cached raw release pages. Start another lookup
  // with a fresh provider cache to verify the listed pack is preferred.
  const withPack = createSeriesCatalog({
    request: async url => url.pathname.endsWith('search/shows') ? [{ show }] : url.pathname.endsWith('/episodes')
      ? [1, 2, 3].map(number => ({ season: 2, number }))
      : { torrents_count: 200, torrents: [...pages[1], ...pages[2], ...pages[5]] },
    json: async value => value,
    rememberRelease: (hash, value) => remembered.set(hash, value)
  });
  await withPack.search({ query: 'Sample' });
  const preferred = await withPack.releases({ ...filters, quality: '' });
  assert.equal(preferred.pack.hash, code(8));
  assert.equal(preferred.batch, null);
  assert.equal(remembered.get(code(8)).episode, 0);

  // Starting from an episode downloads that episode to the end of the season; a whole-season pack can't do that.
  const partial = await withPack.releases({ ...filters, quality: '', fromEpisode: 2 });
  assert.equal(partial.from, 2);
  assert.equal(partial.pack, null);
  assert.equal(partial.batch.count, 2);
  assert.deepEqual(withPack.seasonBatch(partial.batch.id).map(value => value.episode), [2, 3]);
  await assert.rejects(withPack.releases({ ...filters, episode: 2 }), /From episode/);
});

test('an anime season persists and deduplicates absolute-numbered episodes before dispatch', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-season-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const anime = { ...show, name: 'Example Anime', type: 'Animation', language: 'Japanese' };
  const hashes = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
  const files = hashes.map((hash, index) => ({
    ...release(1, index + 3, '1080p', hash), filename: `[Team] Example Anime - 0${index + 3}v2 [1080p HEVC Dual Audio] [CF8E640${index}].mkv`
  }));
  const added = new Map();
  const serviceOptions = {
    dir, secure: { isEncryptionAvailable: () => true },
    animeCatalogURL: 'https://anime.example/',
    fetch: async (url, options) => {
      if (url.pathname.endsWith('/auth/login')) return new Response('Ok.', { headers: { 'Set-Cookie': 'SID=fixture' } });
      if (url.pathname.endsWith('/app/version')) return new Response('v5.1.4');
      if (url.pathname.endsWith('/torrents/info')) {
        const hash = url.searchParams.get('hashes');
        return Response.json(added.has(hash) ? [{ hash, tags: added.get(hash).get('tags'), state: 'metaDL' }] : []);
      }
      if (url.pathname.endsWith('/torrents/files')) return Response.json([]);
      if (url.pathname.endsWith('/torrents/add')) {
        const hash = new URL(options.body.get('urls')).searchParams.get('xt').split(':').at(-1);
        added.set(hash, options.body);
        return new Response('Ok.');
      }
      throw new Error(`Unexpected fixture request ${url.pathname}`);
    },
    catalogFetch: async url => {
      if (url.hostname === 'anime.example') return new Response(`<rss version="2.0"><channel>${files.map(item => `<item><title>${item.filename}</title><nyaa:categoryId>1_2</nyaa:categoryId><nyaa:infoHash>${item.hash}</nyaa:infoHash><nyaa:seeders>10</nyaa:seeders></item>`).join('')}</channel></rss>`);
      if (url.pathname.endsWith('/search/shows')) return Response.json([{ show: anime }]);
      if (url.pathname.endsWith('/episodes')) return Response.json([2, 3].flatMap((count, index) => Array.from({ length: count }, (_, number) => ({ season: index + 1, number: number + 1 }))));
      return Response.json({ torrents_count: files.length, torrents: files });
    }
  };
  const service = createTorrents(serviceOptions);
  t.after(() => service.close());
  await service.configure({ target: 'local', url: 'http://127.0.0.1:8080', seeding: 'no', storage: { showRoot: path.join(dir, 'Shows') } });
  await service.seriesSearch({ query: 'Example' });
  const direct = await service.seriesReleases({ id: '7', season: 2, seasonDownload: true });
  const { results } = await service.discovery({ kind: 'anime', query: 'Example Anime' });
  const { batch } = await service.seriesReleases({ animeSelections: results.map(item => item.selectionId), season: 2 });
  assert.equal(batch.count, 3);
  assert.equal(batch.id, direct.batch.id);
  assert.equal(added.size, 0);
  const options = { target: 'local', seasonDownloadId: batch.id };
  await assert.rejects(service.add({ ...options, seasonDownloadId: 'unverified' }), /Find the season download again/);
  assert.deepEqual(await service.add(options), { queued: hashes, duplicates: [] });
  assert.deepEqual(await service.add(options), { queued: [], duplicates: hashes });
  assert.equal(added.size, 0);
  const jobs = JSON.parse(await fs.readFile(path.join(dir, 'download-jobs.json'), 'utf8'));
  assert.equal(jobs.length, 3);
  const job = jobs.find(job => job.hash === hashes[1]);
  const video = { index: 0, name: files[1].filename, size: 1000 };
  const plan = planDownload([video], job.release, defaultStorage('server'));
  assert.equal(plan.files[0].newPath, 'Example Anime/S02/S02E02 Example Anime (2021) [1080p].mkv');
  assert.throws(() => planDownload([{ ...video, name: 'Example.Anime.S02E03.mkv' }], job.release, defaultStorage('server')), /does not match/);

  await service.close();
  const restarted = createTorrents(serviceOptions);
  t.after(() => restarted.close());
  await restarted.process();
  await restarted.process();
  assert.deepEqual([...added.keys()], [hashes[0]]);
  assert.equal(added.get(hashes[0]).get('ratioLimit'), '0');
  assert.ok(added.get(hashes[0]).get('savepath').startsWith(path.join(dir, 'Shows')));
  assert.deepEqual((await restarted.jobs('local')).map(job => job.phase), ['metadata', 'queued', 'queued']);
});

test('a series release uses the show root, preserves episode metadata and cannot become a movie upgrade', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-series-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let added;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/metadata/search/shows') { res.end(JSON.stringify([{ show }])); return; }
    if (url.pathname === '/releases/get-torrents') { res.end(JSON.stringify({ torrents_count: 1, torrents: [release(2, 3, '1080p')] })); return; }
    if (url.pathname.endsWith('/auth/login')) { res.setHeader('Set-Cookie', 'SID=fixture; path=/'); res.end('Ok.'); return; }
    if (url.pathname.endsWith('/app/version')) { res.end('v5.1.4'); return; }
    if (url.pathname.endsWith('/torrents/info')) { res.end('[]'); return; }
    if (url.pathname.endsWith('/torrents/add')) { added = new URLSearchParams(body); res.end('Ok.'); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const service = createTorrents({ dir, secure: { isEncryptionAvailable: () => true }, seriesShowsURL: url + 'metadata/', seriesReleasesURL: url + 'releases/' });
  await service.configure({ target: 'local', url, username: 'user', seeding: 'no', storage: { movieRoot: path.join(dir, 'Movies'), showRoot: path.join(dir, 'Shows'), naming: 'clean' } });
  await service.seriesSearch({ query: 'Sample' }); await service.seriesReleases({ id: '7' });
  await assert.rejects(service.add({ target: 'local', hash, upgradeId: 'old-movie' }), /Series releases cannot/);
  assert.equal(added, undefined);
  await service.add({ target: 'local', hash });
  assert.ok(added.get('savepath').startsWith(path.join(dir, 'Shows'))); assert.equal(added.get('useDownloadPath'), 'false');
  const jobs = JSON.parse(await fs.readFile(path.join(dir, 'download-jobs.json'), 'utf8'));
  assert.equal(jobs[0].release.kind, 'show'); assert.equal(jobs[0].release.season, 2); assert.equal(jobs[0].release.episode, 3);
  const plan = planDownload([{ index: 0, name: 'release/video.mkv', size: 1000 }], jobs[0].release, defaultStorage('server'));
  assert.equal(plan.files[0].newPath, 'Sample Show/S02/S02E03 Sample Show (2021) [1080p].mkv');
});
test('public catalogs use the catalog fetch, and a failure names its reason', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-catalog-'));
  const seen = [], secure = { isEncryptionAvailable: () => false };
  const service = createTorrents({ dir, secure, fetch: async () => { throw new Error('qBittorrent fetch must not reach the catalogs'); }, catalogFetch: async url => { seen.push(String(url)); return new Response(JSON.stringify([{ show }])); } });
  const found = await service.seriesSearch({ query: 'Sample' });
  assert.equal(found.shows.length, 1); assert.ok(seen[0].startsWith('https://api.tvmaze.com/search/shows'));
  const broken = createTorrents({ dir, secure, catalogFetch: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); } });
  await assert.rejects(broken.seriesSearch({ query: 'Sample' }), /Could not reach the service \(ECONNRESET\)/);
  await service.close(); await broken.close();
});
