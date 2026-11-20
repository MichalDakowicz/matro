const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createTorrents } = require('../packages/core/desktop/torrents.cjs');
const { planDownload, defaultStorage } = require('../packages/core/desktop/download-layout.cjs');

const privateKey = 'fixture-prowlarr-api-key';
const hash = 'abcdef12' + '1'.repeat(32);
const otherHash = 'abcdef12' + '2'.repeat(32);
const thirdHash = 'abcdef12' + '3'.repeat(32);
const config = { url: 'http://indexers.fixture/prowlarr', key: privateKey };
const proxy = (token, host = 'http://indexers.fixture') => `${host}/prowlarr/4/download?apikey=${privateKey}&link=${token}&file=Test`;
const torrent = item => ({ protocol: 'torrent', indexer: 'Test indexer', indexerId: 4, ...item });

function asXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function nyaa(items) {
  const contents = items.map(({ title, hash, link, seeds, category = '1_2' }) => `<item>
    <title>${asXml(title)}</title><link>${asXml(link)}</link>
    <nyaa:categoryId>${category}</nyaa:categoryId><nyaa:infoHash>${hash ?? ''}</nyaa:infoHash>
    <nyaa:seeders>${seeds ?? ''}</nyaa:seeders><nyaa:leechers>2</nyaa:leechers><nyaa:size>1.5 GiB</nyaa:size>
    <description><![CDATA[<a href="https://nyaa.si/view/1">A result</a>]]></description>
  </item>`).join('');
  return new Response(`<rss xmlns:nyaa="https://nyaa.si/xmlns/nyaa"><channel>${contents}</channel></rss>`);
}
function yts(items) {
  return Response.json({ status: 'ok', data: { movie_count: items.length, movies: items } });
}
async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-discovery-'));
  const calls = [], adds = [];
  const fetch = async (url, request) => {
    calls.push({ url: new URL(url), request });
    const reply = await options.handle?.(url, request);
    if (reply) return reply;
    if (url.hostname === 'localhost') {
      if (url.pathname.endsWith('/auth/login')) return new Response('Ok.', { headers: { 'Set-Cookie': 'SID=session; Path=/' } });
      if (url.pathname.endsWith('/app/version')) return new Response('v5.1.4');
      if (url.pathname.endsWith('/torrents/info')) return Response.json([]);
      if (url.pathname.endsWith('/torrents/add')) { adds.push(request.body); return new Response('Ok.'); }
    }
    throw new Error('Unmocked request');
  };
  const service = createTorrents({ dir, fetch, secure: { isEncryptionAvailable: () => true }, prowlarr: options.prowlarr });
  t.after(async () => { service.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const configure = () => service.configure({ target: 'local', url: 'http://localhost:8080', seeding: 'no', storage: { movieRoot: path.join(dir, 'Movies'), showRoot: path.join(dir, 'Shows') } });
  return { calls, adds, service, dir, configure };
}

test('anime aliases are bounded, mirrored swarms dedupe and explicit title tags inform the hints', async t => {
  const f = await fixture(t, { prowlarr: config, handle(url) {
    const query = url.searchParams.get('q');
    if (url.hostname === 'nyaa.si') {
      if (query === 'Alt One') return nyaa([{ title: '[Group] Example Film (Movie) (2024) [1080p]', hash: thirdHash, seeds: 0 },
        { title: '[Group] Ignored Music Video', hash: '9'.repeat(40), seeds: 50, category: '1_1' }]);
      if (query === 'Alt Two') return nyaa([{ title: '[Group] English Dub Documentary - 13 [720p][EngSub]', hash: 'a'.repeat(40) }]);
      return nyaa([{ title: '[Group] Example & More - 12v2 [1080p][Dual Audio][Multi-Subs]', hash: hash.toUpperCase(), seeds: 18,
        link: `magnet:?xt=urn:btih:${hash}&tr=udp://tracker.fixture:80/announce` }]);
    }
    if (url.pathname.endsWith('/api/v1/search')) {
      if (url.searchParams.get('query') === 'Alt Two') return new Response(privateKey, { status: 502 });
      return Response.json([
        torrent({ title: 'Example.&.More.S02E04.2160p', infoHash: hash, magnetUrl: proxy('mirror'), imdbId: 157693, tmdbId: 91, seeders: 7 }),
        torrent({ title: 'Example.Show.S01.1080p', infoHash: otherHash, downloadUrl: proxy('pack'), seeders: 6 }),
        { protocol: 'usenet', title: 'Ignored', infoHash: 'b'.repeat(40), seeders: 30 }
      ]);
    }
  } });
  const { results, warnings, prowlarrEnabled } = await f.service.discovery({ kind: 'anime', query: 'Primary', aliases: ['primary', ' Alt One ', 'Alt Two', 'Alt Three'] });
  assert.equal(prowlarrEnabled, true);
  assert.deepEqual(warnings, ['Prowlarr is unavailable. Try again later.']);
  assert.deepEqual(results.map(release => release.hash), [hash, otherHash, thirdHash, 'a'.repeat(40)]);
  assert.deepEqual(results.map(release => release.seeds), [18, 6, 0, null]);
  assert.equal(results[0].title, 'Example & More');
  assert.equal(results[0].absoluteEpisode, 12);
  assert.equal(results[0].audioHint, 'Dual audio');
  assert.equal(results[0].subtitleHint, 'Multiple subtitles');
  assert.equal(results[0].tmdbId, 91);
  assert.equal(results[0].imdbId, 'tt0157693');
  assert.equal(results[1].season, 1);
  assert.equal(results[1].pack, true);
  assert.equal(results[1].episode, undefined);
  assert.equal(results[2].downloadKind, 'movie');
  assert.equal(results[2].year, '2024');
  assert.equal(results[3].audioHint, undefined);
  assert.equal(results[3].subtitleHint, 'English subtitles');
  assert.equal(JSON.stringify(results).includes(privateKey), false);
  assert.deepEqual(f.calls.filter(call => call.url.hostname === 'nyaa.si').map(({ url }) => url.searchParams.get('q')), ['Primary', 'Alt One', 'Alt Two']);
  for (const { url, request } of f.calls) {
    assert.equal(request.redirect, 'error');
    assert.ok(request.signal instanceof AbortSignal);
    if (url.hostname === 'nyaa.si') {
      assert.equal(url.searchParams.get('page'), 'rss');
      assert.equal(url.searchParams.get('m'), '1');
      assert.equal(url.searchParams.get('c'), '1_0');
      assert.equal(request.headers['X-Api-Key'], undefined);
    } else {
      assert.equal(url.pathname, '/prowlarr/api/v1/search');
      assert.deepEqual(url.searchParams.getAll('categories'), ['5070']);
      assert.equal(url.searchParams.get('indexerIds'), '-2');
      assert.equal(url.searchParams.get('limit'), '100');
      assert.equal(url.searchParams.has('apikey'), false);
      assert.equal(request.headers['X-Api-Key'], privateKey);
    }
  }
});

test('browse uses YTS seed sort and unfiltered EZTV while the additional movie catalog omits YTS', async t => {
  const f = await fixture(t, { prowlarr: config, handle(url) {
    if (url.pathname.endsWith('list_movies.json')) return yts([{ title: 'Movie Title', year: 2021, imdb_code: 'tt1234567', torrents: [{ hash, seeds: 10, quality: '1080p', size_bytes: 1073741824 }] }]);
    if (url.pathname.endsWith('get-torrents')) return Response.json({ torrents_count: 2, torrents: [
      { filename: 'Sample.Series.S03E04.720p', hash: otherHash, size_bytes: '536870912', imdb_id: '0048576', seeds: 12 },
      { filename: 'Sample.Series.S03E01-E05.1080p', hash: thirdHash, seeds: 17 }
    ] });
    return Response.json([]);
  } });
  const movies = await f.service.discovery({ kind: 'movie' });
  assert.equal(movies.results[0].title, 'Movie Title');
  assert.equal(movies.results[0].size, '1.00 GiB');
  assert.equal(movies.results[0].imdbId, 'tt1234567');
  assert.equal(f.calls[0].url.hostname, 'yts.pw');
  assert.equal(f.calls[0].url.searchParams.get('sort_by'), 'seeds');
  assert.equal(f.calls[0].url.searchParams.has('query_term'), false);
  assert.deepEqual((await f.service.discovery({ kind: 'movie' })).results, movies.results);
  assert.equal(f.calls.length, 2);
  const shows = await f.service.discovery({ kind: 'show' });
  assert.deepEqual(shows.results.map(release => release.hash), [thirdHash, otherHash]);
  assert.equal(shows.results[0].pack, true);
  assert.equal(shows.results[0].episode, undefined);
  assert.equal(shows.results[1].title, 'Sample Series');
  assert.equal(shows.results[1].episode, 4);
  assert.equal(shows.results[1].imdbId, 'tt0048576');
  assert.equal(f.calls[2].url.searchParams.has('imdb_id'), false);
  assert.equal(f.calls[2].url.searchParams.get('page'), '1');
  const showCategories = f.calls[3].url.searchParams.getAll('categories');
  assert.ok(showCategories.includes('5000')); assert.ok(!showCategories.includes('5070'));
  await f.service.discovery({ kind: 'movie', query: 'Movie Title', additionalOnly: true });
  assert.equal(f.calls.length, 5);
  assert.equal(f.calls[4].url.searchParams.get('query'), 'Movie Title');
  assert.equal(f.calls[4].url.searchParams.getAll('categories')[0], '2000');
});

test('Prowlarr searches Polish movie titles with and without accents and merges identical releases', async t => {
  const f = await fixture(t, { prowlarr: config, handle(url) {
    if (url.hostname !== 'indexers.fixture') return;
    const accented = url.searchParams.get('query') === 'Chłopaki nie płaczą';
    return Response.json([
      torrent({ title: 'Chlopaki.nie.placza.2000.1080p', magnetUrl: `magnet:?xt=urn:btih:${hash}`, seeders: accented ? 2 : 7 }),
      ...(!accented ? [torrent({ title: 'Chlopaki.nie.placza.2000.720p', magnetUrl: `magnet:?xt=urn:btih:${otherHash}`, seeders: 3 })] : []),
    ]);
  } });
  const { results, warnings } = await f.service.discovery({ kind: 'movie', query: 'Chłopaki nie płaczą', additionalOnly: true });
  assert.deepEqual(warnings, []);
  assert.deepEqual(f.calls.map(({ url }) => url.searchParams.get('query')), ['Chłopaki nie płaczą', 'Chlopaki nie placza']);
  assert.deepEqual(results.map(release => [release.hash, release.seeds]), [[hash, 7], [otherHash, 3]]);
});

test('anime film selections use the movie root and absolute episodes use the show root', async t => {
  const f = await fixture(t, { handle(url) {
    if (url.hostname === 'nyaa.si') return nyaa([
      { hash, title: '[Group] Standalone (Film) [1080p]', seeds: 50 },
      { hash: otherHash, title: '[Group] Continuing Show - 1120 [720p]', seeds: 30 },
      { hash: thirdHash, title: '[Group] A Name Without Numbering [1080p]', seeds: 10 }
    ]);
  } });
  await f.configure();
  const { results, prowlarrEnabled } = await f.service.discovery({ kind: 'anime' });
  assert.equal(prowlarrEnabled, false);
  assert.equal(f.calls[2].url.searchParams.has('q'), false);
  assert.deepEqual(results.map(release => release.canChooseDownloadKind), [false, false, true]);
  await assert.rejects(f.service.add({ target: 'local', selectionId: results[1].selectionId, downloadKind: 'movie' }), /cannot be downloaded as the selected type/);
  await f.service.add({ target: 'local', selectionId: results[0].selectionId });
  await f.service.add({ target: 'local', selectionId: results[1].selectionId });
  await f.service.add({ target: 'local', selectionId: results[2].selectionId, downloadKind: 'movie' });
  assert.ok(f.adds[0].get('savepath').startsWith(path.join(f.dir, 'Movies')));
  assert.ok(f.adds[1].get('savepath').startsWith(path.join(f.dir, 'Shows')));
  assert.ok(f.adds[2].get('savepath').startsWith(path.join(f.dir, 'Movies')));
  const jobs = JSON.parse(await fs.readFile(path.join(f.dir, 'download-jobs.json'), 'utf8'));
  assert.equal(jobs[0].release.kind, 'movie');
  assert.equal(jobs[1].release.kind, 'show');
  assert.equal(jobs[1].release.episode, 1120);
  assert.equal(jobs[1].release.anime, true);
  assert.match(planDownload([{ index: 0, name: 'Group/Video.mkv', size: 1000 }], jobs[1].release, defaultStorage('server')).files[0].newPath, /S01E1120 /);
});

test('a higher-seeded mirror keeps a validated built-in magnet for acquisition', async t => {
  const f = await fixture(t, { prowlarr: config, handle(url) {
    if (url.hostname === 'nyaa.si') return nyaa([{
      title: '[Group] Known Show - 13 [1080p]', hash, seeds: 7,
      link: `magnet:?xt=urn:btih:${hash}&tr=udp://public-tracker.fixture/announce`
    }]);
    if (url.pathname.endsWith('/api/v1/search')) return Response.json([
      torrent({ title: '[Group] Known Show - 13 [1080p]', infoHash: hash, seeders: 25, downloadUrl: proxy('mirror') }),
      torrent({ title: 'Advertised hash without source', infoHash: otherHash, seeders: 90 }),
      torrent({ title: 'Bad origin with advertised hash', infoHash: thirdHash, magnetUrl: proxy('wrong-host', 'https://other.fixture') })
    ]);
  } });
  await f.configure();
  const { results } = await f.service.discovery({ kind: 'anime', query: 'Known Show' });
  assert.deepEqual(results.map(({ hash, seeds, provider }) => [hash, seeds, provider]), [[hash, 25, 'Test indexer']]);
  await f.service.add({ target: 'local', selectionId: results[0].selectionId });
  assert.equal(f.calls.some(({ url }) => url.pathname.endsWith('/download')), false);
  assert.equal(new URL(f.adds[0].get('urls')).searchParams.get('tr'), 'udp://public-tracker.fixture/announce');
});

test('Prowlarr resolves only a stored configured-origin proxy and gives qBittorrent a sanitized magnet', async t => {
  const f = await fixture(t, { prowlarr: config, handle(url) {
    if (url.pathname.endsWith('/api/v1/search')) return Response.json([
      torrent({ title: 'Fixture.Movie.2022.1080p', magnetUrl: proxy('broken'), downloadUrl: proxy('good'), seeders: 55 }),
      torrent({ title: 'Bad host', magnetUrl: proxy('wrong-host', 'https://other.fixture') }),
      torrent({ title: 'Bad indexer path', downloadUrl: proxy('wrong-id').replace('/4/', '/9/') }),
      torrent({ title: 'Bad route query', magnetUrl: proxy('duplicate-link') + '&link=second' }),
      torrent({ title: privateKey, magnetUrl: proxy('key-in-title') })
    ]);
    if (url.searchParams.get('link') === 'broken') return new Response(null, { status: 302, headers: { location: 'https://other.fixture/file.torrent' } });
    if (url.searchParams.get('link') === 'good') return new Response(null, { status: 301, headers: {
      Location: `magnet:?xt=urn:btih:IFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKB&tr=udp://tracker.fixture/announce&tr=${encodeURIComponent('http://indexers.fixture/?apikey=' + privateKey)}&xs=https://other.fixture`
    } });
  } });
  await f.configure();
  const { results } = await f.service.discovery({ kind: 'movie', query: 'Fixture', additionalOnly: true });
  assert.equal(results.length, 1);
  assert.equal(results[0].hash, null);
  assert.equal(results[0].title, 'Fixture Movie');
  assert.equal(results[0].year, '2022');
  assert.equal(f.calls.some(({ url }) => url.pathname.endsWith('/download')), false);
  assert.equal(JSON.stringify(results).includes('/download'), false);
  assert.equal(JSON.stringify(results).includes(privateKey), false);
  await assert.rejects(f.service.add({ target: 'local', selectionId: results[0].selectionId, hash }), /Search again/);
  await f.service.add({ target: 'local', selectionId: results[0].selectionId });
  const proxyCalls = f.calls.filter(({ url }) => url.pathname.endsWith('/download'));
  assert.deepEqual(proxyCalls.map(({ url }) => url.searchParams.get('link')), ['broken', 'good']);
  assert.equal(f.calls.some(({ url }) => url.hostname === 'other.fixture'), false);
  const { url, request } = proxyCalls[1];
  assert.equal(url.searchParams.has('apikey'), false);
  assert.equal(url.searchParams.get('link'), 'good');
  assert.equal(request.redirect, 'manual');
  assert.equal(request.headers['X-Api-Key'], privateKey);
  const magnet = new URL(f.adds[0].get('urls'));
  assert.equal(magnet.searchParams.get('xt'), 'urn:btih:' + '41'.repeat(20));
  assert.deepEqual(magnet.searchParams.getAll('tr'), ['udp://tracker.fixture/announce']);
  assert.equal(magnet.searchParams.has('xs'), false);
  assert.equal(f.adds[0].get('stopCondition'), 'MetadataReceived');
  assert.equal(f.adds[0].get('stopped'), 'false');
  const jobs = await fs.readFile(path.join(f.dir, 'download-jobs.json'), 'utf8');
  assert.equal(JSON.parse(jobs)[0].release.hash, '41'.repeat(20));
  assert.equal(jobs.includes(privateKey) || jobs.includes('indexers.fixture') || jobs.includes('tracker.fixture'), false);
});

test('Prowlarr torrent bytes preserve the original info hash and start stopped for preparation', async t => {
  const info = 'd6:lengthi1000e4:name9:Movie.mkv12:piece lengthi16384e6:pieces20:12345678901234567890e';
  const expectedHash = createHash('sha1').update(info).digest('hex');
  const bytes = Buffer.from(`d8:announce25:udp://tracker.fixture/xxx4:info${info}e`);
  const replies = {
    good: () => new Response(bytes),
    redirect: () => new Response(null, { status: 302, headers: { location: 'https://other.fixture/file.torrent' } }),
    malformed: () => new Response('not a torrent'),
    oversized: () => new Response(Buffer.alloc(4 * 1024 * 1024 + 1, 1)),
    key: () => new Response(Buffer.from(`d8:announce${privateKey.length}:${privateKey}4:info${info}e`)),
    mismatch: () => new Response(bytes)
  };
  const f = await fixture(t, { prowlarr: config, handle(url) {
    if (url.pathname.endsWith('/api/v1/search')) {
      return Response.json(Object.keys(replies).map(token => torrent({ title: `Test ${token} (2024) [1080p]`, downloadUrl: proxy(token), guid: token, ...(token === 'mismatch' ? { infoHash: '3'.repeat(40) } : {}) })));
    }
    if (url.pathname.endsWith('/download')) return replies[url.searchParams.get('link')]();
  } });
  await f.configure();
  const { results } = await f.service.discovery({ kind: 'movie', query: 'Test', additionalOnly: true });
  for (const result of results.filter(item => item.title !== 'Test good')) {
    await assert.rejects(f.service.add({ target: 'local', selectionId: result.selectionId }), /could not provide usable torrent metadata/);
  }
  assert.equal(f.calls.some(({ url }) => url.hostname === 'other.fixture'), false);
  assert.equal(f.adds.length, 0);
  await f.service.add({ target: 'local', selectionId: results.find(item => item.title === 'Test good').selectionId });
  const form = f.adds[0];
  assert.ok(form instanceof FormData);
  assert.equal(form.has('urls'), false);
  assert.equal(form.get('stopCondition'), 'MetadataReceived');
  assert.equal(form.get('stopped'), 'true');
  assert.deepEqual(Buffer.from(await form.get('torrents').arrayBuffer()), bytes);
  assert.ok(f.calls.some(({ url }) => url.searchParams.get('hashes') === expectedHash));
  const [job] = JSON.parse(await fs.readFile(path.join(f.dir, 'download-jobs.json'), 'utf8'));
  assert.equal(job.release.hash, expectedHash);
  assert.equal(job.phase, 'metadata');
  assert.ok(!JSON.stringify(job).includes('prowlarr'));
});

test('a blocked or invalid source leaves other discovery sources usable without leaking credentials', async t => {
  const f = await fixture(t, { prowlarr: { url: 'file:///secrets', key: privateKey }, handle(url) {
    if (url.pathname.endsWith('/get-torrents')) return Response.json({ torrents_count: 0, torrents: [] });
    if (url.hostname === 'yts.pw') return yts([{ title: 'Example', torrents: [{ hash }] }]);
  } });
  const result = await f.service.discovery({ kind: 'movie', query: 'Example' });
  assert.equal(result.results[0].hash, hash);
  assert.deepEqual(result.warnings, ['Prowlarr is unavailable. Try again later.']);
  assert.equal(JSON.stringify(result).includes(privateKey), false);
  assert.equal(f.calls.length, 1);
});
