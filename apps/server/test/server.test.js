const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Real generated media: a web-playable MP4 and an MKV with two audio languages plus an embedded SRT track.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matro-server-'));
const mediaDir = path.join(root, 'media'), dataDir = path.join(root, 'data');
process.env.MATRO_MEDIA = mediaDir;
const { ffmpeg } = require('../../../packages/core/server/config');
const { createApp } = require('../../../packages/core/server');

let base, close, database, app;
const jar = {};
function make(file, extra) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=4', ...extra, file]);
}
async function call(who, method, url, body, headers = {}) {
  const raw = body !== undefined && (Buffer.isBuffer(body) || typeof body === 'string');
  const res = await fetch(base + url, { method, redirect: 'manual',
    headers: { 'x-matro': '1', ...(who && jar[who] ? { cookie: jar[who] } : {}), ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set && who) jar[who] = set.split(';')[0].includes('=;') || /Max-Age=0/.test(set) ? '' : set.split(';')[0];
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
}

// The catalog as the renderer loads it: items grouped into titles, plus this person's own state.
async function catalog(who) {
  const { data } = await call(who, 'GET', '/api/library');
  const groups = new Map();
  for (const item of data.items) { if (!groups.has(item.groupId)) groups.set(item.groupId, []); groups.get(item.groupId).push(item); }
  return { ...data, groups: [...groups.values()].sort((a, b) => a[0].group.localeCompare(b[0].group)) };
}

// A stand-in for api.themoviedb.org and image.tmdb.org, so metadata is exercised with no network or key.
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const movieSearchYears = [];
async function fakeTmdb(url) {
  const u = new URL(url);
  if (u.pathname === '/3/search/movie') movieSearchYears.push(u.searchParams.get('year'));
  if (u.hostname === 'image.tmdb.org') return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200 });
  const route = u.pathname.replace('/3', '');
  if (route === '/search/movie') return json({ results: [{ id: 1, title: 'Heat', release_date: '1995-12-15', overview: 'A crew and a cop.', poster_path: '/p.jpg' }, { id: 9, title: 'Heat Wave', release_date: '2001-01-01', poster_path: '/q.jpg' }] });
  if (route === '/movie/1' && u.searchParams.get('language') === 'pl-PL') return json({ id: 1, title: 'Gorączka', original_language: 'en',
    release_date: '1995-12-15', images: { posters: [{ iso_639_1: 'pl', file_path: '/pl.jpg' }] } });
  if (route === '/movie/1') return json({ id: 1, title: 'Heat', release_date: '1995-12-15', genres: [{ name: 'Crime' }], overview: 'A crew and a cop.', tagline: 'A Los Angeles crime saga', runtime: 170, imdb_id: 'tt0113277',
    vote_count: 100, vote_average: 8.3, poster_path: '/p.jpg', backdrop_path: '/b.jpg', credits: { cast: [{ id: 5, name: 'Al Pacino', character: 'Vincent', profile_path: '/a.jpg' }], crew: [{ job: 'Director', name: 'Michael Mann' }] } });
  if (route === '/search/tv') return json({ results: [{ id: 2, name: 'Show', first_air_date: '2020-01-01' }] });
  if (route === '/tv/2') return json({ id: 2, name: 'Show', first_air_date: '2020-01-01', genres: [], overview: 'A show.', number_of_seasons: 1, created_by: [{ name: 'Someone' }], poster_path: '/sp.jpg', external_ids: {}, credits: {} });
  if (route === '/tv/2/season/1') return json({ episodes: [{ episode_number: 1, name: 'Pilot', runtime: 1, overview: 'It begins.', still_path: '/e1.jpg' }] });
  return new Response('{}', { status: 404 });
}

// A stand-in for api.opensubtitles.com: records each request so tests can see what was sent and that nothing is sent while search is off.
const openSubtitlesCalls = [];
async function fakeOpenSubtitles(url, options = {}) {
  const u = new URL(url);
  openSubtitlesCalls.push({ url: String(url), headers: options.headers || {}, body: options.body });
  if (u.pathname.endsWith('/subtitles')) return json({ data: [
    { attributes: { release: 'Heat.1995.BluRay', language: 'pl', files: [{ file_id: 11, file_name: 'heat.srt' }] } },
    { attributes: { release: 'Elsewhere', language: 'pl', files: [{ file_id: 12 }] } },
    { attributes: { release: 'Broken', language: 'pl', files: [] } }] });
  if (u.pathname.endsWith('/download')) return json({ link: JSON.parse(options.body).file_id === 12 ? 'https://evil.example/x.srt' : 'https://www.opensubtitles.com/download/abc/heat.srt' });
  if (u.hostname === 'www.opensubtitles.com') return new Response('1\n00:00:01,000 --> 00:00:02,000\nZażółć gęślą jaźń\n', { status: 200 });
  return new Response('', { status: 404 });
}

test.before(async () => {
  make(path.join(mediaDir, 'Heat (1995)', 'Heat.1995.mp4'), ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart']);
  const srt = path.join(root, 'in.srt');
  fs.writeFileSync(srt, '1\n00:00:00,500 --> 00:00:02,000\nHello there\n');
  for (const n of [1, 2]) make(path.join(mediaDir, 'Show', `Show.S01E0${n}.mkv`), ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4', '-i', srt,
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'srt', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=jpn', '-metadata:s:s:0', 'language=eng', '-shortest']);
  // Subtitle files beside a video, as a download or the owner leaves them: language and flags come from the name.
  const heat = path.join(mediaDir, 'Heat (1995)');
  fs.writeFileSync(path.join(heat, 'Heat.1995.en.srt'), '1\n00:00:00,500 --> 00:00:02,000\nSidecar line\n');
  fs.writeFileSync(path.join(heat, 'Heat.1995.pl.forced.srt'), '1\n00:00:01,000 --> 00:00:02,000\nTylko obce\n');
  fs.writeFileSync(path.join(heat, 'Heat.1995.broken.srt'), 'not a subtitle');
  fs.writeFileSync(path.join(heat, 'Other.en.srt'), '1\n00:00:00,500 --> 00:00:02,000\nNot ours\n');
  const created = createApp({ dataDir, tmdb: { fetchImpl: fakeTmdb, env: { TMDB_API_KEY: 'test-key' } }, subtitleSearch: { fetch: fakeOpenSubtitles } }), { server, library, db } = created;
  app = created.app;
  database = db;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const added = await library.addFolder(mediaDir);
  assert.equal(added.ok, true);
  close = () => server.close();
});
test.after(() => { close?.(); database?.close(); fs.rmSync(root, { recursive: true, force: true }); });

test('a fresh server has no web setup; the head account comes from the command line', async () => {
  assert.equal((await call(null, 'GET', '/api/status')).data.setup, true);
  assert.equal((await call(null, 'POST', '/api/setup', { username: 'head', password: 'correct horse' })).status, 404);
  assert.equal((await call(null, 'POST', '/api/login', { username: 'head', password: 'correct horse' })).status, 401);
  await app.createUser('head', 'correct horse', 'admin');
  assert.equal((await call(null, 'GET', '/api/status')).data.setup, false);
  const made = await call('admin', 'POST', '/api/login', { username: 'head', password: 'correct horse' });
  assert.equal(made.data.user.role, 'admin');
  assert.equal((await call('admin', 'GET', '/api/status')).data.user.username, 'head');
});

test('the session cookie is Secure only for HTTPS requests', async () => {
  const login = headers => fetch(base + '/api/login', { method: 'POST', headers: { 'x-matro': '1', 'content-type': 'application/json', ...headers }, body: JSON.stringify({ username: 'head', password: 'correct horse' }) });
  const plain = await login({});
  assert.equal(plain.status, 200);
  assert.doesNotMatch(plain.headers.get('set-cookie'), /Secure/);
  assert.doesNotMatch((await login({ 'x-forwarded-proto': 'https' })).headers.get('set-cookie'), /Secure/, 'forwarded header is ignored without a trusted proxy');
});

test('writes need the request header and same-origin', async () => {
  const noHeader = await fetch(base + '/api/logout', { method: 'POST' });
  assert.equal(noHeader.status, 403);
  const cross = await call('admin', 'PUT', '/api/state', {}, { origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
});

test('native clients authenticate media with revocable bearer sessions and web login never returns a token', async () => {
  const login = async headers => fetch(base + '/api/login', { method: 'POST', headers: { 'x-matro': '1', 'content-type': 'application/json', ...headers }, body: JSON.stringify({ username: 'head', password: 'correct horse' }) });
  assert.equal((await (await login({})).json()).token, undefined);
  const { token } = await (await login({ 'x-matro-client': 'native' })).json();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const headers = { authorization: `Bearer ${token}`, 'x-matro': '1' };
  assert.equal((await fetch(base + '/api/library', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/logout', { method: 'POST', headers })).status, 200);
  assert.equal((await fetch(base + '/api/library', { headers })).status, 401);
});

test('an existing phone cookie upgrades to a native media session through an authenticated POST', async () => {
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'x-matro': '1', 'content-type': 'application/json' }, body: JSON.stringify({ username: 'head', password: 'correct horse' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/api/session/native', { method: 'POST', headers: { cookie, 'x-matro': '1' } })).status, 403);
  const response = await fetch(base + '/api/session/native', { method: 'POST', headers: { cookie, 'x-matro': '1', 'x-matro-client': 'native' } });
  assert.equal(response.status, 200); const { token } = await response.json();
  const native = await fetch(base + '/api/library', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(native.status, 200); assert.equal((await native.json()).user.username, 'head');
});

// New accounts come only from a one-time code the head account made.
const invite = async (days) => (await call('admin', 'POST', '/api/admin/invites', days ? { days } : {})).data.code;
async function join(who, username, password, code) { return call(who, 'POST', '/api/signup', { code: code ?? await invite(), username, password }); }

test('only the head account manages users, folders and uploads', async () => {
  assert.equal((await join('sam', 'sam', 'viewer-pass-1')).status, 200);
  assert.equal((await call('sam', 'GET', '/api/me')).data.user.role, 'viewer', 'signing up signs you in');
  assert.equal((await call('sam', 'POST', '/api/login', { username: 'sam', password: 'wrong-password' })).status, 401);
  assert.equal((await call('sam', 'POST', '/api/login', { username: 'sam', password: 'viewer-pass-1' })).status, 200);
  for (const [method, url, body] of [['GET', '/api/admin/users'], ['POST', '/api/admin/invites', {}], ['GET', '/api/admin/invites'], ['DELETE', '/api/admin/invites/1'], ['GET', '/api/admin/folders'],
    ['POST', '/api/admin/rescan', {}], ['POST', '/api/admin/folders', { path: mediaDir }], ['POST', '/api/admin/upload?path=a.mp4', Buffer.from('x')], ['GET', '/api/admin/browse']]) {
    assert.equal((await call('sam', method, url, body)).status, 403, `${method} ${url}`);
    assert.equal((await call(null, method, url, body)).status, 401, `${method} ${url} signed out`);
  }
});

test('viewers see the catalog with no server paths', async () => {
  const { groups, folders, user } = await catalog('sam');
  assert.equal(user.role, 'viewer');
  assert.deepEqual(groups.map(g => [g[0].group, g[0].kind, g.length]), [['Heat', 'movie', 1], ['Show', 'show', 2]]);
  assert.deepEqual(groups[1].map(i => [i.season, i.episode]), [[1, 1], [1, 2]]);
  assert.deepEqual(folders, ['media']);
  const text = JSON.stringify(await catalog('sam'));
  assert.ok(!text.includes(JSON.stringify(mediaDir).slice(1, -1)) && !text.includes(JSON.stringify(root).slice(1, -1)), 'no server paths for viewers');
  assert.equal(groups[0][0].path, path.join('Heat (1995)', 'Heat.1995.mp4'));
  const head = await catalog('admin');
  assert.equal(head.folders[0], mediaDir);
  assert.equal(head.items[0].path.startsWith(mediaDir), true);
});

test('library scans publish local art and NFO details with TMDB disabled', async t => {
  const isolated = path.join(root, 'local-artwork'), media = path.join(isolated, 'Films');
  const source = path.join(media, 'Finished Film (2025)');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'Finished Film (2025).mp4'), 'a catalog fixture');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  fs.writeFileSync(path.join(source, 'poster.jpg'), jpeg);
  fs.writeFileSync(path.join(source, 'fanart.jpg'), jpeg);
  const nfo = path.join(source, 'movie.nfo');
  fs.writeFileSync(nfo, '<movie><title>My Film</title><year>2025</year><plot>A &amp; B</plot><tmdbid>412</tmdbid></movie>');
  const { app, library, db, server } = createApp({ dataDir: path.join(isolated, 'data'), tmdb: {
    env: { MATRO_METADATA: 'off' }, fetchImpl: () => assert.fail('TMDB must stay off'),
  } });
  t.after(() => { app.downloads.close(); app.scanner.close(); server.close(); db.close(); });
  const { id } = await library.addFolder(media);
  const item = db.prepare('SELECT id FROM active_items').get();
  let meta = app.tmdb.snapshot()[item.id];
  assert.equal(meta.title, 'My Film');
  assert.equal(meta.overview, 'A & B');
  assert.equal(meta.year, '2025');
  assert.equal(meta.tmdbId, 412);
  assert.match(meta.poster, /^artwork\/local-[0-9a-f]{64}\.jpg$/);
  assert.equal(meta.backdrop, meta.poster);
  assert.deepEqual(fs.readFileSync(app.tmdb.artworkFile(path.basename(meta.poster))), jpeg);
  const revision = library.state.revision;
  fs.writeFileSync(nfo, '<movie><title>Renamed Film</title></movie>');
  await library.rescan(id);
  assert.notEqual(library.state.revision, revision);
  meta = app.tmdb.snapshot()[item.id];
  assert.equal(meta.title, 'Renamed Film');
  assert.equal(meta.tmdbId, undefined);
});

// Wraps the shared metadata store so a test can hold, or just watch, each local read.
function watchLocalReads(t, { hold } = {}) {
  const vendor = require('../../../packages/core/desktop/metadata.cjs'), create = vendor.createMetadata, reads = [];
  vendor.createMetadata = options => {
    const meta = create(options), read = meta.syncLocal;
    meta.syncLocal = async (items, all) => { reads.push({ paths: items.map(item => item.path), all: !!all }); await hold?.(); return read(items, all); };
    return meta;
  };
  t.after(() => { vendor.createMetadata = create; });
  return reads;
}
const waitFor = async check => { for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(check()); };
const filmIn = (media, name, poster) => {
  const folder = path.join(media, name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name + '.mp4'), 'a catalog fixture');
  fs.writeFileSync(path.join(folder, 'poster.jpg'), poster);
  return folder;
};

test('the first library load answers at once and the revision changes when local art is read', async t => {
  const isolated = path.join(root, 'first-load'), media = path.join(isolated, 'Films'), data = path.join(isolated, 'data');
  filmIn(media, 'Slow Film (2025)', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const env = { MATRO_METADATA: 'off' };
  const seeded = createApp({ dataDir: data, tmdb: { env } });
  await seeded.library.addFolder(media);
  seeded.server.close(); seeded.db.close();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  watchLocalReads(t, { hold: () => gate });
  const restarted = createApp({ dataDir: data, tmdb: { env } }), { server, library, db } = restarted;
  t.after(() => { release(); restarted.app.downloads.close(); restarted.app.scanner.close(); server.close(); db.close(); });
  await restarted.app.createUser('head', 'correct horse', 'admin');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`, headers = { 'x-matro': '1', 'content-type': 'application/json' };
  const login = await fetch(url + '/api/login', { method: 'POST', headers, body: JSON.stringify({ username: 'head', password: 'correct horse' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const load = () => fetch(url + '/api/library', { headers: { ...headers, cookie }, signal: AbortSignal.timeout(2000) }).then(res => res.json());
  const first = await load();
  assert.equal(first.items.length, 1);
  assert.deepEqual(first.metadata, {});
  release();
  await waitFor(() => library.state.revision !== first.catalogRevision);
  const next = await load();
  assert.notEqual(next.catalogRevision, first.catalogRevision);
  assert.match(Object.values(next.metadata)[0].poster, /^artwork\/local-[0-9a-f]{64}\.jpg$/);
});

test('a folder scan reads only that folder and drops copies of art that changed', async t => {
  const isolated = path.join(root, 'scoped-scan'), media = path.join(isolated, 'Films'), other = path.join(isolated, 'More');
  const jpeg = tail => Buffer.from([0xff, 0xd8, 0xff, tail, 0xd9]);
  const aFolder = filmIn(media, 'Film A (2020)', jpeg(1));
  filmIn(other, 'Film B (2021)', jpeg(2));
  const reads = watchLocalReads(t);
  const { app: scoped, library, db, server } = createApp({ dataDir: path.join(isolated, 'data'), tmdb: { env: { MATRO_METADATA: 'off' } } });
  t.after(() => { scoped.downloads.close(); scoped.scanner.close(); server.close(); db.close(); });
  const a = await library.addFolder(media), b = await library.addFolder(other);
  const idOf = title => db.prepare('SELECT id FROM active_items WHERE title LIKE ?').get(title + '%').id;
  const posters = () => ({ a: scoped.tmdb.snapshot()[idOf('Film A')]?.poster, b: scoped.tmdb.snapshot()[idOf('Film B')]?.poster });
  const before = posters();
  assert.ok(before.a && before.b);
  reads.length = 0;
  fs.writeFileSync(path.join(aFolder, 'poster.jpg'), jpeg(3));
  await library.rescan(a.id);
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0].paths, [path.join(aFolder, 'Film A (2020).mp4')]);
  assert.equal(reads[0].all, true);
  const after = posters();
  assert.notEqual(after.a, before.a);
  assert.equal(after.b, before.b);
  const artwork = path.join(isolated, 'data', 'tmdb', 'artwork');
  assert.equal(fs.existsSync(path.join(artwork, path.basename(before.a))), false);
  assert.equal(fs.existsSync(path.join(artwork, path.basename(after.a))), true);
  assert.equal(fs.existsSync(path.join(artwork, path.basename(before.b))), true);
  // Dropping a folder removes its local data without reading the other folders.
  reads.length = 0;
  library.removeFolder(b.id);
  await scoped.tmdb.refreshLocal(b.id);
  assert.deepEqual(reads.map(read => read.paths), [[]]);
  assert.equal(scoped.tmdb.snapshot()[idOf('Film A')].poster, after.a);
  assert.equal(Object.keys(scoped.tmdb.snapshot()).length, 1);
  assert.equal(fs.existsSync(path.join(artwork, path.basename(before.b))), false);
});

test('scan status follows background scans and redacts folder errors for viewers', async () => {
  const folder = path.join(root, 'Scan status source');
  fs.mkdirSync(folder);
  const { id } = await app.library.addFolder(folder);
  try {
    const scan = app.library.rescan(id);
    assert.equal(app.library.scanStatus(false).scanning, true);
    await scan;
    assert.equal(app.library.scanStatus(false).scanning, false);
    fs.renameSync(folder, folder + '-missing');
    await app.library.rescan(id);
    const { scanStatus } = (await call('sam', 'GET', '/api/library/revision')).data;
    assert.ok(scanStatus.lastScanAt > 0);
    assert.deepEqual(scanStatus.errors, [{ folder: 'Scan status source', error: 'Folder could not be scanned completely.' }]);
    assert.equal((await call('admin', 'GET', '/api/library')).data.scanStatus.errors[0].folder, folder);
    fs.renameSync(folder + '-missing', folder);
    await app.library.rescan(id);
    assert.deepEqual(app.library.scanStatus(true).errors, []);
  } finally {
    app.library.removeFolder(id);
  }
});

test('TMDB metadata is matched on the server and artwork is served to signed-in viewers', async () => {
  const { groups } = await catalog('sam');
  const film = groups[0][0], show = groups[1][0];
  let data;
  for (let i = 0; i < 50; i++) { data = (await call('sam', 'GET', '/api/library')).data; if (data.metadata[film.id] && data.metadata[show.groupId]) break; await new Promise(r => setTimeout(r, 100)); }
  assert.equal(data.metadataEnabled, true);
  const heat = data.metadata[film.id];
  assert.deepEqual([heat.title, heat.year, heat.people[0], heat.cast[0].name, heat.imdbId], ['Heat', '1995', 'Michael Mann', 'Al Pacino', 'tt0113277']);
  assert.equal(heat.poster, 'artwork/movie-1-poster.jpg');
  assert.equal(data.metadata[show.groupId].episodes[1][1].name, 'Pilot');
  const art = await fetch(`${base}/api/artwork/movie-1-poster.jpg`, { headers: { cookie: jar.sam } });
  assert.equal(art.status, 200);
  assert.equal(art.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${base}/api/artwork/movie-1-poster.jpg`)).status, 401);
  assert.equal((await call('sam', 'GET', '/api/artwork/..%2f..%2fmatro.db')).status, 404);
  assert.equal((await call('sam', 'GET', '/api/admin/metadata/search?kind=movie&query=Heat')).status, 403);
  const found = (await call('admin', 'GET', '/api/admin/metadata/search?kind=movie&query=Heat')).data.results;
  assert.deepEqual(found.map(r => r.id), [1, 9]);
  // Only a four-digit year narrows the search; anything else is dropped.
  movieSearchYears.length = 0;
  await call('admin', 'GET', '/api/admin/metadata/search?kind=movie&query=Heat&year=1995');
  await call('admin', 'GET', '/api/admin/metadata/search?kind=movie&query=Heat&year=abcd');
  assert.deepEqual(movieSearchYears, ['1995', null]);
  assert.equal((await call('sam', 'POST', '/api/admin/metadata/assign', { key: film.id, tmdbId: 9 })).status, 403);
  assert.equal((await call('admin', 'POST', '/api/admin/metadata/assign', { key: 'nope', tmdbId: 1 })).status, 404);
  const language = { key: film.id, language: 'pl-PL' };
  assert.equal((await call('sam', 'POST', '/api/admin/metadata/language', language)).status, 403);
  assert.equal((await call('admin', 'POST', '/api/admin/metadata/language', { ...language, language: '../pl-PL' })).status, 400);
  const changed = await call('admin', 'POST', '/api/admin/metadata/language', language);
  assert.equal(changed.status, 200);
  const localized = (await catalog('sam')).metadata[film.id];
  assert.equal(localized.title, 'Gorączka');
  assert.equal(localized.poster, 'artwork/movie-1-pl-PL-poster.jpg');
  assert.equal((await call('sam', 'GET', '/api/' + localized.poster)).status, 200);
  const none = await call('admin', 'POST', '/api/admin/metadata/assign', { key: film.id, tmdbId: null });
  assert.equal(none.data.metadata[film.id], undefined, 'pinning "no match" falls back to the file name');
});

test('download activity gets cached artwork without exposing download matches in the library', async () => {
  const fixture = [{ hash: 'a'.repeat(40), name: 'Heat.1995.1080p.mkv', title: 'Heat', year: '1995', kind: 'movie' }];
  let decorated;
  for (let i = 0; i < 50; i++) {
    decorated = await app.tmdb.downloadArtwork(fixture);
    if (decorated[0].banner) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(decorated[0].banner, '/api/artwork/movie-1-backdrop.jpg');
  const list = app.downloads.list, jobs = app.downloads.jobs;
  app.downloads.list = async () => [{ hash: fixture[0].hash, name: 'unhelpful-release-name' }];
  app.downloads.jobs = async () => fixture;
  try {
    assert.equal((await call('admin', 'GET', '/api/admin/downloads/list')).data.result[0].banner, decorated[0].banner);
    assert.equal((await call('admin', 'GET', '/api/admin/downloads/jobs')).data.result[0].banner, decorated[0].banner);
    assert.equal((await call('sam', 'GET', '/api/admin/downloads/list')).status, 403);
    const art = await fetch(base + decorated[0].banner, { headers: { cookie: jar.admin } });
    assert.equal(art.status, 200);
    const publicMetadata = (await call('sam', 'GET', '/api/metadata')).data.metadata;
    assert.ok(Object.keys(publicMetadata).every(key => !key.startsWith('download:')));
  } finally { app.downloads.list = list; app.downloads.jobs = jobs; }
});

test('track info, direct play ranges, transcode and embedded subtitles', async () => {
  const { groups } = await catalog('sam');
  const movie = groups[0][0];
  const info = (await call('sam', 'GET', `/api/items/${movie.id}/info`)).data;
  assert.equal(info.directPlay, true);
  assert.ok(info.duration > 3);
  const range = await fetch(`${base}/api/items/${movie.id}/direct`, { headers: { cookie: jar.sam, range: 'bytes=0-99' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(`${base}/api/items/${movie.id}/direct`)).status, 401);

  const ep = groups[1][0];
  const epInfo = (await call('sam', 'GET', `/api/items/${ep.id}/info`)).data;
  assert.equal(epInfo.directPlay, false);
  assert.deepEqual(epInfo.audio.map(a => a.language), ['en', 'ja']);
  assert.equal(epInfo.embedded[0].text, true);
  const second = await fetch(`${base}/api/items/${ep.id}/transcode?t=1&audio=${epInfo.audio[1].index}`, { headers: { cookie: jar.sam } });
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('content-type'), 'video/mp4');
  const bytes = Buffer.from(await second.arrayBuffer());
  assert.ok(bytes.length > 1000 && bytes.includes(Buffer.from('ftyp')));
  assert.equal((await fetch(`${base}/api/items/${ep.id}/transcode?t=1&audio=99`, { headers: { cookie: jar.sam } })).status, 400);
  const slot = await fetch(`${base}/api/items/${ep.id}/transcode?t=0&preload=1`, { headers: { cookie: jar.sam } });
  assert.equal(slot.status, 200, 'a preload runs beside the main stream');
  await slot.body.cancel();
  const frame = await fetch(`${base}/api/items/${ep.id}/frame?t=1&w=200`, { headers: { cookie: jar.sam } });
  assert.equal(frame.status, 200);
  assert.equal(frame.headers.get('content-type'), 'image/jpeg');
  const jpeg = Buffer.from(await frame.arrayBuffer());
  assert.ok(jpeg.length > 500 && jpeg[0] === 0xff && jpeg[1] === 0xd8);
  const nearbyWidth = await fetch(`${base}/api/items/${ep.id}/frame?t=1&w=230`, { headers: { cookie: jar.sam } });
  assert.deepEqual(Buffer.from(await nearbyWidth.arrayBuffer()), jpeg);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'cache', 'frames')).map(name => name.match(/-\d+-1\.jpg$/)?.[0]), ['-160-1.jpg']);
  const vtt = await call('sam', 'GET', `/api/items/${ep.id}/subtitles/e${epInfo.embedded[0].index}`);
  assert.match(vtt.data, /^WEBVTT/);
  assert.match(vtt.data, /Hello there/);
  assert.equal(fs.readdirSync(path.join(dataDir, 'cache', 'subs')).length, 1);
});

test('an offline range still reads its open generation when the media path is replaced', async t => {
  const { groups } = await catalog('sam');
  const movie = groups[0][0], route = `/api/items/${movie.id}/offline`;
  const ready = (await call('sam', 'GET', route)).data;
  const original = app.library.item(movie.id).path, backup = original + '.backup', replacement = original + '.replacement';
  const bytes = fs.readFileSync(original);
  fs.writeFileSync(replacement, Buffer.alloc(bytes.length));
  const open = fs.promises.open;
  let replaced = false;
  t.mock.method(fs.promises, 'open', async (file, ...args) => {
    const handle = await open(file, ...args);
    if (file === original && !replaced) {
      const stat = handle.stat.bind(handle);
      handle.stat = async () => {
        const properties = await stat();
        fs.renameSync(original, backup);
        fs.renameSync(replacement, original);
        replaced = true;
        return properties;
      };
    }
    return handle;
  });
  try {
    const url = base + route + '/file?version=' + ready.version;
    const headers = { cookie: jar.sam, range: 'bytes=0-31' };
    const range = await fetch(url, { headers });
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 32));
    assert.equal(replaced, true);
    const stale = await fetch(url, { headers });
    assert.equal(stale.status, 409);
    await stale.body.cancel();
  } finally {
    if (fs.existsSync(backup)) fs.renameSync(backup, original);
    fs.rmSync(replacement, { force: true });
  }
});

test('offline media preparation is authenticated and serves versioned, seekable files', async () => {
  const { groups } = await catalog('sam');
  const movie = `/api/items/${groups[0][0].id}/offline`;
  assert.equal((await call(null, 'GET', movie)).status, 401);
  const direct = (await call('sam', 'GET', movie)).data;
  assert.equal(direct.state, 'ready');
  assert.equal(direct.file, undefined);
  assert.equal((await call('sam', 'GET', movie + '/file?version=old')).status, 409);
  const headers = { cookie: jar.sam, range: 'bytes=0-31' };
  const first = await fetch(base + movie + '/file?version=' + direct.version, { headers });
  assert.equal(first.status, 206);
  assert.equal(first.headers.get('content-range'), `bytes 0-31/${direct.size}`);
  assert.equal((await first.arrayBuffer()).byteLength, 32);

  const episode = `/api/items/${groups[1][0].id}/offline`, info = (await call('sam', 'GET', episode.replace('/offline', '/info'))).data;
  const audio = info.audio[1].index;
  let ready;
  for (let i = 0; i < 100; i++) {
    ready = (await call('sam', 'GET', episode + '?audio=' + audio)).data;
    if (ready.state === 'ready') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ready.state, 'ready');
  const second = await fetch(base + episode + '/file?audio=' + audio + '&version=' + ready.version, { headers });
  assert.equal(second.status, 206);
  assert.match(Buffer.from(await second.arrayBuffer()).toString('latin1'), /ftyp/);
});

test('subtitle files next to the video are listed and served as WebVTT', async () => {
  const movie = (await catalog('sam')).groups[0][0];
  const { files } = (await call('sam', 'GET', `/api/items/${movie.id}/info`)).data;
  assert.deepEqual(files.map(f => [f.language, f.forced, f.sdh]).sort(), [['en', false, false], ['pl', true, false], ['und', false, false]].sort());
  const english = files.find(f => f.language === 'en'), polish = files.find(f => f.language === 'pl'), broken = files.find(f => f.language === 'und');
  // Ids come from the file name, so they do not move when another subtitle file appears next to the video.
  fs.writeFileSync(path.join(mediaDir, 'Heat (1995)', 'Heat.1995.aa.srt'), 'x');
  const again = (await call('sam', 'GET', `/api/items/${movie.id}/info`)).data.files;
  assert.equal(again.length, files.length + 1); assert.equal(again.find(f => f.language === 'en').id, english.id);
  fs.rmSync(path.join(mediaDir, 'Heat (1995)', 'Heat.1995.aa.srt'));
  const vtt = await call('sam', 'GET', `/api/items/${movie.id}/subtitles/f${english.id}`);
  assert.equal(vtt.status, 200);
  assert.match(vtt.data, /^WEBVTT/); assert.match(vtt.data, /Sidecar line/);
  assert.match((await call('sam', 'GET', `/api/items/${movie.id}/subtitles/f${polish.id}`)).data, /Tylko obce/);
  assert.equal((await call('sam', 'GET', `/api/items/${movie.id}/subtitles/f${broken.id}`)).status, 422);
  assert.equal((await call('sam', 'GET', `/api/items/${movie.id}/subtitles/f9`)).status, 404);
  assert.equal((await call(null, 'GET', `/api/items/${movie.id}/subtitles/f${english.id}`)).status, 401);
});

test('any viewer can add labelled subtitles; only owner or head account can edit them', async () => {
  const { groups } = await catalog('sam');
  const movie = groups[0][0];
  const srt = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nZażółć gęślą jaźń\n', 'utf8');
  const up = await call('sam', 'POST', `/api/items/${movie.id}/subtitles?name=${encodeURIComponent('Polish (fan)')}&lang=pol&kind=full&filename=heat.srt`, srt);
  assert.equal(up.status, 200);
  assert.equal(up.data.subtitle.language, 'pl');
  const id = up.data.subtitle.id;
  const text = (await call('sam', 'GET', `/api/items/${movie.id}/subtitles/u${id}`)).data;
  assert.match(text, /^WEBVTT/);
  assert.match(text, /Zażółć gęślą jaźń/);
  assert.match(text, /(?:00:)?00:01\.000 --> (?:00:)?00:02\.000/);

  // A legacy Polish code page decodes correctly through the language hint.
  const legacy = Buffer.concat([Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n'), Buffer.from([0xb3, 0xf3, 0x66, 0xe6]), Buffer.from('\n')]);
  const old = await call('sam', 'POST', `/api/items/${movie.id}/subtitles?name=Old&lang=pl&filename=old.srt`, legacy);
  assert.match((await call('sam', 'GET', `/api/items/${movie.id}/subtitles/u${old.data.subtitle.id}`)).data, /łóf/);

  assert.equal((await call('sam', 'POST', `/api/items/${movie.id}/subtitles?name=Bad&lang=en&filename=x.srt`, Buffer.from('not subtitles'))).status, 400);
  assert.equal((await call('sam', 'POST', `/api/items/${movie.id}/subtitles?lang=en&filename=x.srt`, srt)).status, 400);

  assert.equal((await join('eve', 'eve', 'viewer-pass-2')).status, 200);
  assert.equal((await call('eve', 'PATCH', `/api/subtitles/${id}`, { name: 'Mine now' })).status, 403);
  assert.equal((await call('eve', 'DELETE', `/api/subtitles/${id}`)).status, 403);
  const listed = (await call('eve', 'GET', `/api/items/${movie.id}/info`)).data.uploaded;
  assert.equal(listed.find(s => s.id === id).canEdit, false);
  assert.equal((await call('sam', 'PATCH', `/api/subtitles/${id}`, { name: 'Polish, retimed', kind: 'sdh', language: 'pl' })).status, 200);
  assert.equal((await call('admin', 'PATCH', `/api/subtitles/${id}`, { name: 'Polish' })).status, 200);
  const after = (await call('eve', 'GET', `/api/items/${movie.id}/info`)).data.uploaded.find(s => s.id === id);
  assert.deepEqual([after.name, after.kind, after.addedBy], ['Polish', 'sdh', 'sam']);
  const mine = (await call('sam', 'GET', '/api/me/subtitles')).data.subtitles;
  assert.deepEqual(mine.map(s => s.name).sort(), ['Old', 'Polish']);
  assert.equal((await call('eve', 'GET', '/api/me/subtitles')).data.subtitles.length, 0);
  assert.equal((await call('admin', 'GET', '/api/me/subtitles')).data.subtitles.length, 2);
  assert.equal((await call('admin', 'DELETE', `/api/subtitles/${id}`)).status, 200);
});

test('online subtitle search is off until the head account adds a key, and the key never leaves the server', async () => {
  const movie = (await catalog('sam')).groups[0][0], key = 'secret-key-123', url = `/api/items/${movie.id}/subtitle-search`;
  assert.deepEqual((await call('sam', 'GET', '/api/subtitle-search')).data, { enabled: false });
  assert.equal((await call('sam', 'GET', `${url}?language=pl`)).status, 403);
  assert.equal((await call('sam', 'POST', url, { token: 'x' })).status, 403);
  assert.equal(openSubtitlesCalls.length, 0);
  assert.equal((await call('sam', 'PUT', '/api/admin/subtitle-search', { key })).status, 403);
  assert.equal((await call('admin', 'PUT', '/api/admin/subtitle-search', { key: 'bad key' })).status, 400);
  const on = await call('admin', 'PUT', '/api/admin/subtitle-search', { key });
  assert.deepEqual(on.data, { enabled: true });
  const status = await call('sam', 'GET', '/api/subtitle-search');
  assert.deepEqual(status.data, { enabled: true });
  assert.equal(JSON.stringify([on.data, status.data, (await call('admin', 'GET', '/api/library')).data, (await call('admin', 'GET', '/api/me')).data]).includes(key), false);

  assert.equal((await call('sam', 'GET', `${url}?language=und`)).status, 400);
  const found = await call('sam', 'GET', `${url}?language=pol`);
  assert.deepEqual(found.data.results.map(r => [r.name, r.language]), [['Heat.1995.BluRay', 'pl'], ['Elsewhere', 'pl']]);
  assert.equal(openSubtitlesCalls[0].headers['Api-Key'], key);
  assert.match(openSubtitlesCalls[0].url, /query=Heat&languages=pl&type=movie/);
  assert.equal(JSON.stringify(found.data).includes(key), false);

  const [first, elsewhere] = found.data.results;
  assert.equal((await call('sam', 'POST', url, { token: 'unknown' })).status, 404);
  assert.equal((await call('sam', 'POST', url, { token: elsewhere.token })).status, 502);
  const saved = await call('sam', 'POST', url, { token: first.token });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.subtitle.language, 'pl');
  assert.match((await call('sam', 'GET', `/api/items/${movie.id}/subtitles/u${saved.data.subtitle.id}`)).data, /Zażółć/);
  assert.equal((await call('sam', 'POST', url, { token: first.token })).data.subtitle.id, saved.data.subtitle.id);
  assert.equal((await call('eve', 'POST', url, { token: first.token })).status, 404);

  assert.deepEqual((await call('admin', 'PUT', '/api/admin/subtitle-search', { key: '' })).data, { enabled: false });
  assert.equal((await call('sam', 'GET', `${url}?language=pl`)).status, 403);
  assert.equal((await call('sam', 'DELETE', `/api/subtitles/${saved.data.subtitle.id}`)).status, 200);
});

test('online subtitle search limits each account so one viewer cannot spend the shared OpenSubtitles quota', async () => {
  const movie = (await catalog('sam')).groups[0][0], url = `/api/items/${movie.id}/subtitle-search`;
  assert.equal((await call('admin', 'PUT', '/api/admin/subtitle-search', { key: 'secret-key-123' })).status, 200);
  try {
    const calls = openSubtitlesCalls.length;
    for (let n = 0; n < 10; n++) assert.equal((await call('eve', 'GET', `${url}?language=pl`)).status, 200);
    assert.equal(openSubtitlesCalls[calls].headers['User-Agent'], `Matro v${require('../../../package.json').version}`);
    const blocked = await call('eve', 'GET', `${url}?language=pl`);
    assert.equal(blocked.status, 429);
    assert.match(JSON.stringify(blocked.data), /Too many subtitle searches/);
    assert.equal(openSubtitlesCalls.length, calls + 10, 'a refused search never reaches OpenSubtitles');
    const found = await call('admin', 'GET', `${url}?language=pl`);
    assert.equal(found.status, 200, 'another account keeps its own allowance');

    const token = found.data.results[0].token;
    for (let n = 0; n < 20; n++) assert.equal((await call('admin', 'POST', url, { token })).status, 200);
    const spent = openSubtitlesCalls.length, capped = await call('admin', 'POST', url, { token });
    assert.equal(capped.status, 429);
    assert.match(JSON.stringify(capped.data), /downloads today/);
    assert.equal(openSubtitlesCalls.length, spent);
  } finally {
    assert.deepEqual((await call('admin', 'PUT', '/api/admin/subtitle-search', { key: '' })).data, { enabled: false });
  }
});

test('watch state is saved per person and merged into the catalog they load', async () => {
  const { groups } = await catalog('sam');
  const episode = groups[1][0];
  const state = { progress: { [episode.id]: { position: 30, duration: 90, completed: false } }, queue: [episode.id], preferences: { volume: 0.4, tracks: { [episode.groupId]: { audio: { language: 'ja' }, off: true } } }, markers: {} };
  assert.equal((await call('sam', 'PUT', '/api/state', state)).status, 200);
  assert.equal((await call('sam', 'PUT', '/api/state', { queue: 'nope' })).status, 400);
  assert.equal((await call('sam', 'PUT', '/api/state', { progress: [] })).status, 400);
  const mine = await catalog('sam');
  assert.equal(mine.progress[episode.id].position, 30);
  assert.deepEqual(mine.queue, [episode.id]);
  assert.equal(mine.preferences.tracks[episode.groupId].audio.language, 'ja');
  const theirs = await catalog('eve');
  assert.deepEqual(theirs.progress, {});
  assert.deepEqual(theirs.queue, []);
  assert.equal(theirs.preferences.tracks, undefined);
  assert.equal((await call(null, 'PUT', '/api/state', state)).status, 401);
});

test('saving progress never drops or rewinds a title another page already saved', async () => {
  const { groups } = await catalog('eve');
  const [a, b] = [groups[1][0].id, groups[1][1].id];
  const put = progress => call('eve', 'PUT', '/api/state', { progress });
  assert.equal((await put({ [a]: { position: 50, updated: 200 } })).status, 200);
  // A page that reloaded mid-startup saves empty defaults: nothing is lost.
  assert.equal((await put({})).status, 200);
  assert.equal((await catalog('eve')).progress[a].position, 50);
  // A stale copy is ignored, a newer one wins, and other titles are added alongside.
  await put({ [a]: { position: 10, updated: 100 } });
  assert.equal((await catalog('eve')).progress[a].position, 50);
  await put({ [a]: { position: 70, updated: 300 }, [b]: { position: 5, updated: 250 } });
  const now = (await catalog('eve')).progress;
  assert.equal(now[a].position, 70);
  assert.equal(now[b].position, 5);
});

test('dismissing a show from an older client preserves current playback and other state', async () => {
  const { groups } = await catalog('eve');
  const movie = groups[0][0].id, [first, second] = groups[1].map(item => item.id);
  const older = { [first]: { position: 10, duration: 100, completed: false, updated: 400 },
    [movie]: { position: 20, duration: 100, completed: false, updated: 400 } };
  const put = body => call('eve', 'PUT', '/api/state', body);
  assert.equal((await put({ progress: older, queue: [movie, first], preferences: { autoplay: false } })).status, 200);
  const movieProgress = (await catalog('eve')).progress[movie];
  const advanced = { [first]: { position: 100, duration: 100, completed: true, updated: 500 },
    [second]: { position: 35, duration: 100, completed: false, updated: 510 } };
  const saved = await put({ progress: advanced });
  assert.equal(saved.status, 200);

  const route = `/api/items/${second}/progress`;
  assert.equal((await call(null, 'PATCH', route, { dismiss: true })).status, 401);
  assert.equal((await call('eve', 'PATCH', '/api/items/missing/progress', { dismiss: true })).status, 404);
  const otherBefore = await catalog('sam');
  const dismissed = await call('eve', 'PATCH', route, { dismiss: true });
  assert.equal(dismissed.status, 200);
  const hidden = Object.fromEntries(Object.entries(saved.data.progress).map(([id, entry]) => [id, { ...entry, hidden: true }]));
  assert.deepEqual(dismissed.data.progress, hidden);

  // A late full save from either client cannot undo the dismissal.
  await put({ progress: older });
  await put({ progress: advanced });
  const after = await catalog('eve');
  assert.deepEqual(after.progress, { ...hidden, [movie]: movieProgress });
  assert.deepEqual(after.queue, [movie, first]);
  assert.deepEqual(after.preferences, { autoplay: false, volume: 0.72 });
  assert.deepEqual((await catalog('sam')).progress, otherBefore.progress);

  const pausedSeek = { ...advanced[second], position: 37, updated: 515 };
  const paused = (await put({ progress: { [second]: pausedSeek } })).data.progress[second];
  assert.deepEqual({ ...paused, updated: 515 }, { ...pausedSeek, hidden: true });
  assert.deepEqual((await catalog('eve')).progress[second], paused);

  const resumed = { ...advanced[second], position: 40, hidden: false, updated: 520 };
  const resumedProgress = (await put({ progress: { [second]: resumed } })).data.progress[second];
  assert.deepEqual({ ...resumedProgress, updated: 520 }, resumed);
  assert.deepEqual((await catalog('eve')).progress[second], resumedProgress);

  assert.equal((await call('eve', 'PATCH', route, { dismiss: true })).status, 200);
  const staleToggle = await call('eve', 'PATCH', `/api/items/${first}/progress`, { completed: false, checkpoint: older[first] });
  assert.equal(staleToggle.status, 200);
  assert.deepEqual({ ...staleToggle.data.progress[first], updated: hidden[first].updated }, { ...hidden[first], completed: false });
  const recovered = { position: 55, duration: 100, hidden: false, updated: 530 };
  const newerToggle = await call('eve', 'PATCH', route, { completed: true, checkpoint: recovered });
  assert.equal(newerToggle.status, 200);
  assert.deepEqual({ ...newerToggle.data.progress[second], updated: 530 }, { ...recovered, completed: true, hidden: true });
  assert.deepEqual((await catalog('eve')).progress, { ...staleToggle.data.progress, ...newerToggle.data.progress, [movie]: movieProgress });

  // A stale client can seek in an episode with no existing progress row.
  assert.equal((await join('seek-viewer', 'seek-viewer', 'viewer-pass-3')).status, 200);
  const saveFirst = await call('seek-viewer', 'PUT', '/api/state', { progress: { [first]: advanced[first] } });
  assert.equal(saveFirst.status, 200);
  const dismissFirst = await call('seek-viewer', 'PATCH', `/api/items/${first}/progress`, { dismiss: true });
  assert.deepEqual(dismissFirst.data.progress, { [first]: { ...saveFirst.data.progress[first], hidden: true } });
  const saveSeek = await call('seek-viewer', 'PUT', '/api/state', { progress: { [second]: pausedSeek, [movie]: older[movie] } });
  assert.equal(saveSeek.status, 200);
  assert.equal(saveSeek.data.progress[second].hidden, true);
  assert.deepEqual((await catalog('seek-viewer')).progress, { ...dismissFirst.data.progress, ...saveSeek.data.progress });
});

test('watch state uses account-bound operations and ignores invalid or stale checkpoints', async () => {
  assert.equal((await join('state-viewer', 'state-viewer', 'viewer-pass-4')).status, 200);
  const { user, groups } = await catalog('state-viewer');
  const [first, second] = groups[1];
  const movie = groups[0][0].id;
  const headers = { 'x-matro-account': String(user.id) };
  const put = body => call('state-viewer', 'PUT', '/api/state', body, headers);
  const mismatch = await call('eve', 'PUT', '/api/state', { queue: [] }, headers);
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.data.code, 'account-changed');
  assert.equal((await call('eve', 'PATCH', `/api/items/${first.id}/progress`, { dismiss: true }, headers)).status, 409);
  assert.equal((await call('eve', 'GET', '/api/library', undefined, headers)).status, 409);

  await put({ queueChange: { add: [movie, first.id], remove: [] }, preferences: { autoplay: false, tracks: { show: { off: true }, other: { delay: 1 } } } });
  await put({ queueChange: { add: [second.id], remove: [first.id] }, preferences: { tracks: { show: { delay: 2 } } } });
  await call('state-viewer', 'PUT', '/api/state', { progress: {}, queue: [first.id], preferences: { volume: .2 } });
  const options = await catalog('state-viewer');
  assert.deepEqual(options.queue, [movie, second.id]);
  assert.deepEqual(options.preferences, { autoplay: false, volume: .2, tracks: { show: { off: true, delay: 2 }, other: { delay: 1 } } });
  const { queueChange } = await import('../../../packages/core/client/watch-progress.js');
  await put({ queueChange: queueChange(options.queue, [second.id, movie]) });
  assert.deepEqual((await catalog('state-viewer')).queue, [second.id, movie]);

  const before = Date.now();
  const future = await put({ progress: { [first.id]: { position: 10, duration: 100, updated: 1e20 } } });
  assert.ok(future.data.progress[first.id].updated >= before && future.data.progress[first.id].updated <= Date.now());
  await put({ progress: { [first.id]: null, [second.id]: { position: '15', duration: 100, updated: Date.now() } } });
  await call('state-viewer', 'PUT', '/api/state', `{"progress":{"${first.id}":{"position":1e400,"duration":100,"updated":1e400}}}`, { ...headers, 'content-type': 'application/json' });
  const cutoff = Date.now();
  assert.deepEqual((await catalog('state-viewer')).progress, future.data.progress);
  await new Promise(resolve => setTimeout(resolve, 5));
  const current = await put({ progress: { [first.id]: { position: 15, duration: 100, updated: cutoff }, [second.id]: { position: 25, duration: 100, updated: cutoff + 1 } } });
  assert.equal(current.data.progress[first.id].position, 15);
  const dismissal = await call('state-viewer', 'PATCH', `/api/items/${first.id}/progress`, { dismiss: true, dismissedAt: cutoff }, headers);
  assert.equal(dismissal.data.progress[first.id].hidden, true);
  assert.equal(dismissal.data.progress[second.id], undefined);
  assert.equal((await catalog('state-viewer')).progress[second.id].position, 25);
});

test('an older client echoing server times cannot overwrite a slow-clock phone', async () => {
  assert.equal((await join('slow-viewer', 'slow-viewer', 'viewer-pass-5')).status, 200);
  const { user, groups } = await catalog('slow-viewer');
  const id = groups[0][0].id, headers = { 'x-matro-account': String(user.id) };
  const slow = Date.now() - 3600e3;
  await call('slow-viewer', 'PUT', '/api/state', { progress: { [id]: { position: 100, duration: 1000, updated: slow } } }, headers);
  const loaded = (await catalog('slow-viewer')).progress[id];
  await call('slow-viewer', 'PUT', '/api/state', { progress: { [id]: { position: 500, duration: 1000, updated: slow + 60e3 } } }, headers);
  // No account header: this is the old client, sending everything it loaded earlier.
  await call('slow-viewer', 'PUT', '/api/state', { progress: { [id]: loaded } });
  assert.equal((await catalog('slow-viewer')).progress[id].position, 500);
});

test('head account upload lands in the library; logout and password reset end sessions', async () => {
  const bytes = fs.readFileSync(path.join(mediaDir, 'Heat (1995)', 'Heat.1995.mp4'));
  const up = await call('admin', 'POST', '/api/admin/upload?path=' + encodeURIComponent('Up Movie (2001)/../Up.Movie.mp4'), bytes, { 'content-type': 'application/octet-stream' });
  assert.equal(up.status, 200);
  assert.ok(fs.existsSync(path.join(mediaDir, 'Up Movie (2001)', '_', 'Up.Movie.mp4')) || fs.existsSync(path.join(mediaDir, 'Up Movie (2001)', 'Up.Movie.mp4')));
  assert.equal((await call('admin', 'POST', '/api/admin/upload?path=notvideo.txt', Buffer.from('x'))).status, 400);
  assert.ok((await catalog('sam')).groups.some(g => g[0].group.startsWith('Up')));

  const stale = jar.sam;
  const users = (await call('admin', 'GET', '/api/admin/users')).data.users;
  assert.equal((await call('admin', 'PATCH', `/api/admin/users/${users.find(u => u.username === 'sam').id}`, { password: 'new-password-9' })).status, 200);
  jar.sam = stale;
  assert.equal((await call('sam', 'GET', '/api/me')).status, 401);
  assert.equal((await call('sam', 'POST', '/api/login', { username: 'sam', password: 'new-password-9' })).status, 200);
  await call('sam', 'POST', '/api/logout', {});
  assert.equal((await call('sam', 'GET', '/api/me')).status, 401);
  const head = users.find(u => u.role === 'admin');
  assert.equal((await call('admin', 'DELETE', `/api/admin/users/${head.id}`)).status, 400);
});

test('invite codes work once, expire, can be revoked, and are never stored in the clear', async () => {
  const code = await invite();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM invites WHERE code_hash LIKE ?').get('%' + code.replaceAll('-', '') + '%').n, 0, 'only a hash is stored');
  // Typed by hand: case, spaces and dashes are forgiven.
  const taken = await call(null, 'POST', '/api/signup', { code: code.toLowerCase().replaceAll('-', ' '), username: 'sam', password: 'another-pass-1' });
  assert.equal(taken.status, 409, 'a taken username does not use up the code');
  const made = await call('zoe', 'POST', '/api/signup', { code: code.toLowerCase().replaceAll('-', ' '), username: 'zoe', password: 'zoe-password-1' });
  assert.equal(made.status, 200);
  assert.equal(made.data.user.role, 'viewer');
  assert.equal((await call('zoe', 'GET', '/api/me')).data.user.username, 'zoe');
  assert.equal((await call(null, 'POST', '/api/signup', { code, username: 'zed', password: 'zed-password-1' })).status, 400, 'a used code cannot be used again');
  assert.equal((await call(null, 'POST', '/api/login', { username: 'zed', password: 'zed-password-1' })).status, 401);

  assert.equal((await call(null, 'POST', '/api/signup', { code: await invite(), username: 'x', password: 'long-enough-1' })).status, 400, 'username too short');
  assert.equal((await call(null, 'POST', '/api/signup', { code: await invite(), username: 'okname', password: 'short' })).status, 400, 'password too short');
  const spare = await invite();
  assert.equal((await join(null, 'okname', 'long-enough-1', spare)).status, 200, 'rejected attempts did not burn the codes');

  const expired = await invite();
  database.prepare("UPDATE invites SET expires = 1 WHERE id = (SELECT MAX(id) FROM invites)").run();
  assert.equal((await join(null, 'late', 'long-enough-1', expired)).status, 400);
  const revoked = await invite();
  const list = (await call('admin', 'GET', '/api/admin/invites')).data.invites;
  assert.deepEqual(list.slice(0, 2).map(i => i.status).sort(), ['expired', 'waiting']);
  assert.ok(list.some(i => i.status === 'used' && i.usedBy === 'zoe'));
  assert.equal((await call('admin', 'DELETE', `/api/admin/invites/${list.find(i => i.status === 'waiting').id}`)).status, 200);
  assert.equal((await join(null, 'ghost', 'long-enough-1', revoked)).status, 400);
  assert.equal((await call('admin', 'DELETE', `/api/admin/invites/${list.find(i => i.status === 'used').id}`)).status, 404, 'used invites stay as a record');
  assert.equal((await call('admin', 'POST', '/api/admin/users', { username: 'direct', password: 'direct-pass-1' })).status, 404, 'the head no longer creates accounts directly');
});

test('repeated wrong passwords are throttled', async () => {
  for (let i = 0; i < 5; i++) await call(null, 'POST', '/api/login', { username: 'ghost', password: 'nope-nope-nope' });
  assert.equal((await call(null, 'POST', '/api/login', { username: 'ghost', password: 'nope-nope-nope' })).status, 429);
});

test('static app is served with a locked-down policy', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(base + '/..%2f..%2fpackage.json')).status, 404);
  const manifest = await fetch(base + '/manifest.webmanifest');
  assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
  assert.equal((await manifest.json()).display, 'standalone');
});

test('guessing invite codes is throttled', async () => {
  // Earlier tests in this run already spent some failed attempts, so count until the lock rather than assuming a clean start.
  const statuses = [];
  for (let n = 0; n < 6; n++) statuses.push((await call(null, 'POST', '/api/signup', { code: 'AAAA-BBBB-CCCC', username: 'guess', password: 'long-enough-1' })).status);
  assert.ok(statuses.includes(429), `locked within five failures: ${statuses}`);
  assert.deepEqual([...new Set(statuses.slice(0, statuses.indexOf(429)))], [400]);
  assert.equal((await call(null, 'POST', '/api/signup', { code: await invite(), username: 'guess', password: 'long-enough-1' })).status, 429, 'even a real code waits out the lock');
});
