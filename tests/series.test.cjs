const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { createSeriesCatalog } = require('../electron/series-catalog.cjs');
const { createTorrents } = require('../electron/torrents.cjs');
const { planDownload, defaultStorage } = require('../electron/download-layout.cjs');
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
  const catalog = createSeriesCatalog({ request: async url => url.pathname.endsWith('search/shows') ? [{ show }] : { torrents_count: 3, torrents: [{ ...release(1, 1, '720p'), imdb_id: '9999999' }, { ...release(1, 1, '720p'), hash: 'bad' }] }, json: async value => value, rememberRelease: () => { throw new Error('invalid release must not be remembered'); } });
  await catalog.search({ query: 'Sample' });
  assert.deepEqual((await catalog.releases({ id: '7' })).releases, []);
  const future = Date.now() + 61 * 60 * 1000; t.mock.method(Date, 'now', () => future);
  await assert.rejects(catalog.releases({ id: '7' }), /Search again/);
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
