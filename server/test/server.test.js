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
const { ffmpeg } = require('../src/config');
const { createApp } = require('../src');

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
async function fakeTmdb(url) {
  const u = new URL(url);
  if (u.hostname === 'image.tmdb.org') return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200 });
  const route = u.pathname.replace('/3', '');
  if (route === '/search/movie') return json({ results: [{ id: 1, title: 'Heat', release_date: '1995-12-15', overview: 'A crew and a cop.', poster_path: '/p.jpg' }, { id: 9, title: 'Heat Wave', release_date: '2001-01-01', poster_path: '/q.jpg' }] });
  if (route === '/movie/1') return json({ id: 1, title: 'Heat', release_date: '1995-12-15', genres: [{ name: 'Crime' }], overview: 'A crew and a cop.', tagline: 'A Los Angeles crime saga', runtime: 170, imdb_id: 'tt0113277',
    vote_count: 100, vote_average: 8.3, poster_path: '/p.jpg', backdrop_path: '/b.jpg', credits: { cast: [{ id: 5, name: 'Al Pacino', character: 'Vincent', profile_path: '/a.jpg' }], crew: [{ job: 'Director', name: 'Michael Mann' }] } });
  if (route === '/search/tv') return json({ results: [{ id: 2, name: 'Show', first_air_date: '2020-01-01' }] });
  if (route === '/tv/2') return json({ id: 2, name: 'Show', first_air_date: '2020-01-01', genres: [], overview: 'A show.', number_of_seasons: 1, created_by: [{ name: 'Someone' }], poster_path: '/sp.jpg', external_ids: {}, credits: {} });
  if (route === '/tv/2/season/1') return json({ episodes: [{ episode_number: 1, name: 'Pilot', runtime: 1, overview: 'It begins.', still_path: '/e1.jpg' }] });
  return new Response('{}', { status: 404 });
}

test.before(async () => {
  make(path.join(mediaDir, 'Heat (1995)', 'Heat.1995.mp4'), ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart']);
  const srt = path.join(root, 'in.srt');
  fs.writeFileSync(srt, '1\n00:00:00,500 --> 00:00:02,000\nHello there\n');
  for (const n of [1, 2]) make(path.join(mediaDir, 'Show', `Show.S01E0${n}.mkv`), ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4', '-i', srt,
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'srt', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=jpn', '-metadata:s:s:0', 'language=eng', '-shortest']);
  const created = createApp({ dataDir, tmdb: { fetchImpl: fakeTmdb, env: { TMDB_API_KEY: 'test-key' } } }), { server, library, db } = created;
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
  assert.equal((await call('sam', 'POST', '/api/admin/metadata/assign', { key: film.id, tmdbId: 9 })).status, 403);
  assert.equal((await call('admin', 'POST', '/api/admin/metadata/assign', { key: 'nope', tmdbId: 1 })).status, 404);
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
  const vtt = await call('sam', 'GET', `/api/items/${ep.id}/subtitles/e${epInfo.embedded[0].index}`);
  assert.match(vtt.data, /^WEBVTT/);
  assert.match(vtt.data, /Hello there/);
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
});

test('guessing invite codes is throttled', async () => {
  // Earlier tests in this run already spent some failed attempts, so count until the lock rather than assuming a clean start.
  const statuses = [];
  for (let n = 0; n < 6; n++) statuses.push((await call(null, 'POST', '/api/signup', { code: 'AAAA-BBBB-CCCC', username: 'guess', password: 'long-enough-1' })).status);
  assert.ok(statuses.includes(429), `locked within five failures: ${statuses}`);
  assert.deepEqual([...new Set(statuses.slice(0, statuses.indexOf(429)))], [400]);
  assert.equal((await call(null, 'POST', '/api/signup', { code: await invite(), username: 'guess', password: 'long-enough-1' })).status, 429, 'even a real code waits out the lock');
});
