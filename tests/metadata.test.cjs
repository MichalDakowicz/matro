const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readEnv, credentials, createMetadata, cleanQuery, yearOf } = require('../packages/core/desktop/metadata.cjs');

test('file and folder names become clean TMDB queries', () => {
  assert.equal(cleanQuery('The.Brutalist.2024.2160p.WEB-DL.x265'), 'The Brutalist');
  assert.equal(cleanQuery('Akira (1988)'), 'Akira');
  assert.equal(cleanQuery('Cyberpunk Edgerunners'), 'Cyberpunk Edgerunners');
  assert.equal(yearOf('Akira (1988)'), '1988');
  assert.equal(yearOf('Blade.Runner.2049.2017.1080p'), '2017');
  assert.equal(cleanQuery('Blade.Runner.2049.2017.1080p'), 'Blade Runner 2049');
  assert.equal(cleanQuery('Blade Runner 2049'), 'Blade Runner 2049');
  assert.equal(cleanQuery('2001 A Space Odyssey (1968)'), '2001 A Space Odyssey');
  assert.equal(yearOf('Northbound'), null);
});

test('credentials come from .env files and both naming styles', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-env-'));
  await fs.writeFile(path.join(dir, '.env'), '# comment\nVITE_TMDB_ACCESS_TOKEN="token-value"\nOTHER=1\n');
  const env = readEnv([path.join(dir, '.env'), path.join(dir, 'missing.env')]);
  assert.deepEqual(credentials(env), { token: 'token-value', key: '' });
  assert.equal(credentials({}), null);
  assert.deepEqual(credentials({ TMDB_API_KEY: 'k' }), { token: '', key: 'k' });
  assert.equal(credentials({ TMDB_API_KEY: 'k', MATRO_METADATA: 'off' }), null);
});

const json = body => new Response(JSON.stringify(body));
const missing = () => new Response(null, { status: 404 });
const image = () => new Response(Uint8Array.of(255, 216, 255, 217));

async function previewFixture(t, handle, auth = { token: 'host-token' }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-preview-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  const metadata = createMetadata({ dir, auth, fetch: (raw, options) => {
    const url = new URL(raw);
    calls.push([url, options]);
    return handle(url, options);
  } });
  await metadata.loaded;
  return { metadata, dir, calls };
}

test('movie editions inherit a manual file match and take updates under the group key', async t => {
  const { metadata, calls } = await previewFixture(t, url => {
    const id = Number(url.pathname.split('/').pop());
    return json({ id, title: id === 1 ? 'Earlier match' : 'Corrected match' });
  });
  const theatrical = { id: 'theatrical', kind: 'movie', group: 'Film', path: 'Film.mkv' };
  const extended = { ...theatrical, id: 'extended', path: 'Film Extended.mkv' };
  await metadata.assign([extended], 1);
  const cuts = [theatrical, extended].map(item => ({ ...item, editionGroup: 'cuts' }));

  await metadata.sync(cuts);
  assert.equal(metadata.snapshot().cuts.tmdbId, 1);
  assert.equal(calls.length, 1);
  assert.equal((await metadata.assign(cuts, 2)).cuts.title, 'Corrected match');
  assert.equal((await metadata.assign(cuts, null)).cuts, undefined);
  await metadata.sync(cuts);
  assert.equal(metadata.snapshot().cuts, undefined);
  assert.equal(calls.length, 2);
});

test('Downloads previews are opt-in and leave the library metadata untouched', async t => {
  const disabled = await previewFixture(t, () => assert.fail('a disabled preview called TMDB'), null);
  const titles = [{ key: 'heat', kind: 'movie', title: 'A release title', imdbId: 'tt0113277' }];
  assert.deepEqual(await disabled.metadata.preview({ titles }), { enabled: false, results: [{ key: 'heat', metadata: null }] });

  const { metadata, dir, calls } = await previewFixture(t, (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (url.hostname === 'image.tmdb.org') {
      assert.equal(url.pathname, '/t/p/w500/heat.jpg');
      assert.equal(options.headers, undefined);
      return image();
    }
    assert.equal(options.headers.authorization, 'Bearer host-token');
    assert.equal(url.pathname, '/3/find/tt0113277');
    assert.equal(url.searchParams.get('external_source'), 'imdb_id');
    return json({ movie_results: [{ id: 949, title: 'Heat', release_date: '1995-12-15', overview: 'A crew and a cop.', poster_path: '/heat.jpg', backdrop_path: '/backdrop.jpg' }] });
  });
  const result = await metadata.preview({ titles });
  assert.deepEqual(result, { enabled: true, results: [{ key: 'heat', metadata: {
    tmdbId: 949, type: 'movie', title: 'Heat', year: '1995', overview: 'A crew and a cop.', poster: 'artwork/movie-949-poster.jpg',
  } }] });
  assert.deepEqual(await metadata.preview({ titles }), result);
  assert.equal(calls.length, 2);
  assert.deepEqual(metadata.snapshot(), {});
  await fs.access(metadata.artworkFile('movie-949-poster.jpg'));
  await assert.rejects(fs.access(path.join(dir, 'metadata.json')), { code: 'ENOENT' });
});

test('Downloads matching checks release years, Unicode titles, media types and declared aliases', async t => {
  const { metadata, calls } = await previewFixture(t, url => {
    const query = url.searchParams.get('query');
    if (url.pathname === '/3/search/movie' && query === 'The Thing') {
      if (url.searchParams.get('year') === '1982') return json({ results: [] });
      return json({ results: [{ id: 1, title: 'The Thing', release_date: '2011-10-12' }, { id: 2, title: 'The Thing', release_date: '1982-06-25' }] });
    }
    if (url.pathname === '/3/search/tv' && query === '未来') return json({ results: [{ id: 3, name: 'Future', original_name: '未来', first_air_date: '2018-09-22', genre_ids: [18] }] });
    if (url.pathname === '/3/search/movie' && query === '未来') return json({ results: [
      { id: 4, title: 'Forest', original_title: '森', release_date: '2018-05-10', genre_ids: [16] },
      { id: 5, title: 'Mirai', original_title: '未来', release_date: '2018-05-16', genre_ids: [16] },
    ] });
    if (url.pathname === '/3/search/tv' && query === 'Sousou no Frieren') return json({ results: [{ id: 6, name: 'Frieren: Beyond Journey’s End', original_name: '葬送のフリーレン', genre_ids: [16] }] });
    if (url.pathname === '/3/tv/6/alternative_titles') return json({ results: [{ title: 'Sousou no Frieren' }] });
    if (url.pathname === '/3/movie/123') return json({ id: 123, title: 'Pinned Movie', release_date: '2025-02-01' });
    return missing();
  });
  const { results } = await metadata.preview({ titles: [
    { key: 'year-fallback', kind: 'movie', title: 'The Thing', year: 1982 },
    { key: 'wrong-year', kind: 'movie', title: 'The Thing', year: 1990 },
    { key: 'ambiguous', kind: 'movie', title: 'The Thing' },
    { key: 'anime-movie', kind: 'anime', title: '未来', year: '2018' },
    { key: 'anime-alias', kind: 'anime', title: 'Sousou no Frieren' },
    { key: 'typed-id', kind: 'anime', title: 'Release Name', tmdbId: '123', type: 'movie' },
    { key: 'conflicting-id', kind: 'show', title: 'Other', tmdbId: 123, type: 'movie' },
    { key: 'invalid-id', kind: 'movie', title: 'Other', tmdbId: '../123', imdbId: 'https://example.test' },
  ] });
  assert.deepEqual(results.map(({ key, metadata }) => [key, metadata?.tmdbId ?? null, metadata?.type ?? null]), [
    ['year-fallback', 2, 'movie'], ['wrong-year', null, null], ['ambiguous', null, null],
    ['anime-movie', 5, 'movie'], ['anime-alias', 6, 'tv'], ['typed-id', 123, 'movie'],
    ['conflicting-id', null, null], ['invalid-id', null, null],
  ]);
  assert.equal(results[3].metadata.originalTitle, '未来');
  assert.equal(calls.filter(([url]) => url.pathname === '/3/movie/123').length, 1);
  assert.ok(calls.every(([url]) => url.hostname === 'api.themoviedb.org'));
});

test('Downloads details load credits, aliases and only the requested season without external artwork URLs', async t => {
  const show = { id: 8, name: 'Show', original_name: 'Original Show', first_air_date: '2020-01-01', overview: 'A show.', poster_path: '//example.test/poster.jpg' };
  const { metadata, calls } = await previewFixture(t, url => {
    if (url.pathname === '/3/search/tv') return json({ results: [show] });
    if (url.pathname === '/3/tv/8') {
      assert.equal(url.searchParams.get('append_to_response'), 'alternative_titles,credits');
      return json({ ...show, backdrop_path: '/../hidden.jpg', number_of_seasons: 2, episode_run_time: [22], vote_average: 8.65, vote_count: 12,
        genres: [{ name: 'Comedy' }], alternative_titles: { results: [{ title: 'An Alias' }, { title: 'Original Show' }] },
        credits: { cast: [{ name: 'An Actor', character: 'A Role', profile_path: '/cast.jpg' }] },
      });
    }
    if (url.pathname === '/3/tv/8/season/0') return json({ episodes: [{ episode_number: 1, name: 'Bonus', runtime: 22, overview: 'A special.', still_path: '/still.jpg' }] });
    assert.fail(`Unexpected preview fetch: ${url}`);
  });
  const titles = [{ key: 'show', kind: 'show', title: 'Show', season: 0 }];
  const basic = await metadata.preview({ titles });
  assert.equal(basic.results[0].metadata.poster, null);
  assert.equal(basic.results[0].metadata.episodes, undefined);
  assert.equal(calls.length, 1);
  const detail = await metadata.preview({ titles, detail: true });
  assert.deepEqual(detail.results[0].metadata, { ...basic.results[0].metadata, backdrop: null, aliases: ['Original Show', 'An Alias'],
    genres: ['Comedy'], cast: [{ name: 'An Actor', role: 'A Role' }], runtime: 22, rating: 8.7, seasonCount: 2,
    episodes: { 0: { 1: { name: 'Bonus', runtime: 22, overview: 'A special.' } } },
  });
  assert.deepEqual(calls.map(([url]) => url.pathname), ['/3/search/tv', '/3/tv/8', '/3/tv/8/season/0']);
  assert.deepEqual(await metadata.preview({ titles, detail: true }), detail);
  assert.equal(calls.length, 3);
});

test('Downloads previews bound batches and concurrent calls, coalesce lookups, and retry failures', async t => {
  let active = 0, peak = 0, attempts = 0;
  const { metadata, calls } = await previewFixture(t, async url => {
    const query = url.searchParams.get('query');
    active++;
    peak = Math.max(active, peak);
    try {
      await new Promise(resolve => setTimeout(resolve, 1));
      if (query === 'Retry' && attempts++ === 0) throw new Error('upstream timeout');
      return json({ results: [{ id: 1, title: query }] });
    } finally { active--; }
  });
  const titles = Array.from({ length: 30 }, (_, index) => ({ key: `test-${index}`, kind: 'movie', title: `Title ${index}` }));
  const [first, concurrent] = await Promise.all([metadata.preview({ titles }), metadata.preview({ titles: [{ ...titles[0], key: 'duplicate' }] })]);
  assert.equal(first.results.length, 24);
  assert.equal(concurrent.results[0].metadata.title, 'Title 0');
  assert.equal(peak, 4);
  assert.equal(calls.length, 24);
  const retry = { titles: [{ key: 'retry', kind: 'movie', title: 'Retry' }] };
  assert.equal((await metadata.preview(retry)).results[0].metadata, null);
  assert.equal((await metadata.preview(retry)).results[0].metadata.title, 'Retry');
});

test('the server prefixes only artwork and respects explicitly disabled metadata', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-preview-server-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = require('../packages/core/server/config');
  const originalDir = config.dataDir;
  config.dataDir = dir;
  t.after(() => { config.dataDir = originalDir; });
  const { createTmdb } = require('../packages/core/server/tmdb');
  const db = { prepare: () => ({ all: () => [] }) };
  const titles = [{ key: 'known', title: 'A Title', kind: 'movie', tmdbId: 42 }];
  const disabled = createTmdb(db, {
    env: { TMDB_API_KEY: 'key', MATRO_METADATA: 'off' },
    fetchImpl: () => assert.fail('a disabled server called TMDB'),
  });
  assert.deepEqual(await disabled.preview({ titles }), { enabled: false, results: [{ key: 'known', metadata: null }] });

  const server = createTmdb(db, {
    env: { TMDB_API_KEY: 'key' },
    fetchImpl: raw => {
      const url = new URL(raw);
      if (url.hostname === 'image.tmdb.org') {
        assert.equal(url.search, '');
        return image();
      }
      assert.equal(url.searchParams.get('api_key'), 'key');
      return json({ id: 42, title: 'A Title', overview: 'artwork/ is an internal prefix.', poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg' });
    },
  });
  const { enabled, results } = await server.preview({ titles, detail: true });
  assert.equal(enabled, true);
  const [{ metadata }] = results;
  assert.equal(metadata.poster, '/api/artwork/movie-42-poster.jpg');
  assert.equal(metadata.backdrop, '/api/artwork/movie-42-backdrop.jpg');
  assert.equal(metadata.overview, 'artwork/ is an internal prefix.');
  assert.deepEqual(server.snapshot(), {});
  await fs.access(server.artworkFile('movie-42-poster.jpg'));
});

test('titles are matched once, cached, and artwork is stored locally', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-meta-'));
  const calls = [];
  const polishMovie = { id: 222, title: "Boys Don't Cry", original_title: 'Chłopaki nie płaczą', original_language: 'pl', release_date: '2000-02-25' };
  const fetch = async url => {
    calls.push(url);
    const json = body => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new ArrayBuffer(4) });
    if (url.startsWith('https://image.tmdb.org/')) return json(null);
    if (url.includes('/search/movie') && url.includes('query=home')) return json({ results: [{ id: 5, title: 'Video Home System', release_date: '2018-01-01' }] });
    if (url.includes('/search/movie') && url.includes('query=Chlopaki+nie+placza')) return json({ results: [polishMovie] });
    if (url.includes('/search/movie')) return json({ results: [{ id: 7, title: 'Akira Kurosawa’s Dreams', release_date: '1990-05-10' }, { id: 149, title: 'Akira', release_date: '1988-07-16' }] });
    if (url.includes('/movie/149')) return json({ id: 149, title: 'Akira', release_date: '1988-07-16', genres: [{ name: 'Animation' }], credits: { crew: [{ job: 'Director', name: 'Katsuhiro Otomo' }], cast: [] }, vote_average: 7.94, vote_count: 4000, poster_path: '/p.jpg', backdrop_path: null });
    if (url.includes('/movie/222')) return json(polishMovie);
    if (url.includes('/search/tv')) return json({ results: [] });
    return { ok: false, status: 500 };
  };
  let updates = 0;
  const metadata = createMetadata({ dir, fetch, auth: { token: 't', key: '' }, onUpdate: () => updates++ });
  const items = [{ id: 'a', kind: 'movie', group: 'Akira (1988)', path: 'D:/Movies/Akira (1988).mkv', season: null }, { id: 'b', kind: 'show', group: 'Nowhere Show', groupId: 'g', path: 'D:/Shows/x.mkv', season: 1 }, { id: 'h', kind: 'movie', group: 'home_video_2019_final', path: 'D:/Movies/home_video_2019_final.mkv', season: null }];
  items.push({ id: 'polish', kind: 'movie', group: 'Chlopaki nie placza (2000)', path: 'D:/Movies/Chlopaki.nie.placza.2000.mkv' });
  await metadata.sync(items);
  await new Promise(resolve => setTimeout(resolve, 900));
  const snapshot = metadata.snapshot();
  assert.equal(snapshot.a.title, 'Akira');
  assert.equal(snapshot.a.year, '1988');
  assert.deepEqual(snapshot.a.people, ['Katsuhiro Otomo']);
  assert.equal(snapshot.a.rating, 7.9);
  assert.equal(snapshot.a.poster, 'artwork/movie-149-poster.jpg');
  assert.equal(snapshot.g, undefined);
  assert.equal(snapshot.h, undefined, 'a loosely similar title is not accepted');
  assert.equal(snapshot.polish.tmdbId, 222, 'a Polish title in an unaccented filename is matched by its original title');
  assert.ok(calls.some(url => url.includes('year=1988')));
  assert.ok(updates >= 1);
  await fs.access(path.join(dir, 'artwork', 'movie-149-poster.jpg'));
  assert.equal(metadata.artworkFile('../library.json'), null);
  const before = calls.length; await metadata.sync(items); await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(calls.length, before, 'matched and missing titles are not looked up again');
});

test('a movie keeps its own metadata language across rematches and restarts', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-language-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const downloads = [];
  const options = { dir, auth: { key: 'fixture' }, fetch: async raw => {
    const url = new URL(raw), language = url.searchParams.get('language');
    if (url.hostname === 'image.tmdb.org') { downloads.push(url.pathname); return image(); }
    if (language === 'de-DE') return new Response('', { status: 503 });
    const movie = { id: Number(url.pathname.split('/').at(-1)), title: 'Day of the Wacko',
      original_title: 'Dzień świra', original_language: 'pl', release_date: '2002-06-07', poster_path: '/english.jpg' };
    if (!language || language === 'en-US') return json(movie);
    assert.match(language, /^pl(?:-PL)?$/);
    assert.equal(url.searchParams.get('include_image_language'), 'pl,null');
    assert.equal(url.searchParams.get('append_to_response'), 'credits,images');
    return json({ ...movie, overview: 'Polski opis',
      images: { posters: [{ iso_639_1: null, file_path: '/neutral.jpg' }, { iso_639_1: 'pl', file_path: '/polish.jpg' }],
        backdrops: [{ iso_639_1: null, file_path: '/neutral-backdrop.jpg' }] } });
  } };
  const metadata = createMetadata(options);
  const first = { id: 'first', kind: 'movie', group: 'Day of the Wacko', path: 'Day.of.the.Wacko.2002.mkv' };
  const second = { ...first, id: 'second' };
  await metadata.assign([first], 42);
  await metadata.assign([second], 42);
  const { first: localized, second: defaultMovie } = await metadata.setLanguage([first], 'pl-PL');
  assert.deepEqual([localized.tmdbId, localized.manual, localized.language, localized.title, localized.overview],
    [42, true, 'pl-PL', 'Dzień świra', 'Polski opis']);
  assert.equal(localized.poster, 'artwork/movie-42-pl-PL-poster.jpg');
  assert.equal(defaultMovie.poster, 'artwork/movie-42-poster.jpg');
  assert.equal(defaultMovie.title, 'Day of the Wacko');
  assert.deepEqual(downloads, ['/t/p/w500/english.jpg', '/t/p/w500/polish.jpg', '/t/p/w1280/neutral-backdrop.jpg']);
  await fs.access(metadata.artworkFile('movie-42-pl-PL-poster.jpg'));
  await assert.rejects(metadata.setLanguage([first], 'de-DE'), /TMDB 503/);
  assert.deepEqual(metadata.snapshot().first, localized);
  assert.equal((await metadata.assign([first], 43)).first.poster, 'artwork/movie-43-pl-PL-poster.jpg');
  assert.equal((await metadata.setLanguage([first], 'original')).first.title, 'Dzień świra');
  const restarted = createMetadata(options);
  await restarted.loaded;
  assert.equal(restarted.snapshot().first.language, 'original');
  assert.equal(restarted.snapshot().first.poster, 'artwork/movie-43-pl-poster.jpg');
  assert.equal((await restarted.setLanguage([first], null)).first.title, 'Day of the Wacko');
  assert.equal(restarted.snapshot().first.language, undefined);
});
