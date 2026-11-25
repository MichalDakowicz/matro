const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createApp } = require('../../../packages/core/server');
const { createFcm } = require('../../../packages/core/server/fcm');

async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await delay(10);
  }
  assert.ok(check(), 'database did not reach the expected notification state');
}

test('movie requests stay within their account roles and send one private alert per new request', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-requests-'));
  const alerts = [], downloads = [];
  let available = true, instance;
  const options = { dataDir, tmdb: { env: {} }, downloads: { fetch: (...args) => { downloads.push(args); throw new Error('Unexpected download call'); } },
    movieRequests: {
      send: async (device, options) => {
        alerts.push({ ...device, test: options?.test || false });
        if (!available) throw new Error('FCM unavailable');
        return 'sent';
      },
    },
  };
  const start = async () => {
    instance = createApp(options);
    await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  };
  const stop = async () => {
    if (!instance) return;
    const { server, db } = instance;
    await new Promise(resolve => server.close(resolve));
    db.close();
    instance = null;
  };
  t.after(async () => { await stop(); await fs.rm(dataDir, { force: true, recursive: true }); });
  await start();
  for (const [name, role] of [['head', 'admin'], ['viewer', 'viewer'], ['second', 'viewer']]) await instance.app.createUser(name, 'test password', role);
  async function request(token, route, method = 'GET', body) {
    const res = await fetch(`http://127.0.0.1:${instance.server.address().port}${route}`, {
      method, headers: { 'x-matro': '1', 'x-matro-client': 'native', 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }
  const login = async username => (await request('', '/api/login', 'POST', { username, password: 'test password' })).body.token;
  const head = await login('head'), viewer = await login('viewer'), second = await login('second');
  const form = '/api/movie-requests', inbox = '/api/admin/movie-requests';
  const empty = { pending: [], handled: [], canRemove: true, tmdb: false };
  const device = inbox + '/device', deviceToken = 'android:matro-test-registration-token';
  assert.equal((await request('', form)).status, 401);
  assert.equal((await request('', form, 'POST', { title: 'Movie' })).status, 401);
  assert.equal((await request(head, form)).status, 403);
  assert.equal((await request(head, form, 'POST', { title: 'Movie' })).status, 403);
  assert.equal((await request(viewer, inbox)).status, 403);
  assert.equal((await request(viewer, device, 'PUT', { token: deviceToken })).status, 403);
  assert.equal((await request(head, device + '/test', 'POST')).status, 409);
  assert.equal((await request(head, device, 'PUT', { token: 'invalid' })).status, 400);
  const { registration } = (await request(head, device, 'PUT', { token: deviceToken })).body;
  assert.ok(registration);
  assert.equal((await request(head, device + '/test', 'POST')).status, 200);
  assert.deepEqual(alerts.shift(), { id: registration, token: deviceToken, test: true });
  assert.equal((await request(viewer, form, 'POST', { title: '  ' })).status, 400);
  assert.equal((await request(viewer, form, 'POST', { title: 'Arrival', year: '2e03' })).status, 400);

  const submitted = await Promise.all([
    request(viewer, form, 'POST', { title: '  The   Arrival ', year: '1996' }),
    request(viewer, form, 'POST', { title: 'the arrival', year: 1996 }),
  ]);
  const first = submitted.find(result => result.body.duplicate === false).body.request;
  assert.equal(first.title.toLowerCase(), 'the arrival');
  assert.equal(first.year, 1996);
  assert.equal(submitted.find(result => result.body.duplicate).body.request.id, first.id);
  await until(() => !instance.db.prepare('SELECT notify_after FROM movie_request_push WHERE request_id = ?').get(first.id));
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0], { requestId: first.id, id: registration, token: deviceToken, test: false,
    title: first.title, year: 1996, requester: 'viewer', outcome: null });
  assert.deepEqual((await request(second, form)).body, empty);
  assert.deepEqual((await request(head, inbox)).body, { ...empty, pending: [first], alertsConfigured: true });
  assert.equal((await request('', `${form}/${first.id}`, 'DELETE')).status, 401);
  assert.equal((await request(second, `${form}/${first.id}`, 'DELETE')).status, 404);
  assert.equal((await request(viewer, `${inbox}/${first.id}`, 'PATCH')).status, 403);
  assert.equal((await request(viewer, '/api/admin/downloads/add', 'POST', { title: first.title })).status, 403);
  assert.equal(downloads.length, 0);
  assert.equal((await request(head, `${inbox}/${first.id}`, 'PATCH')).status, 200);
  assert.deepEqual((await request(viewer, form)).body, { ...empty, handled: [{ ...first, status: 'handled', outcome: 'ready', isNew: true }] });
  assert.equal((await request(viewer, `${form}/${first.id}`, 'DELETE')).status, 200);
  assert.deepEqual((await request(viewer, form)).body, empty);

  available = false;
  const now = Date.now(), next = (await request(second, form, 'POST', { title: 'Arrival', year: 2016 })).body.request;
  assert.ok(next.id > first.id);
  await until(() => instance.db.prepare('SELECT notify_after FROM movie_request_push WHERE request_id = ?').get(next.id)?.notify_after > now + 60_000);
  assert.equal((await request(head, inbox)).body.pending[0].id, next.id);
  instance.db.prepare('UPDATE movie_request_push SET notify_after = ? WHERE request_id = ?').run(1, next.id);
  await stop();
  available = true;
  await start();
  await until(() => !instance.db.prepare('SELECT notify_after FROM movie_request_push WHERE request_id = ?').get(next.id));
  assert.equal(alerts.length, 3);
  assert.equal((await request(head, inbox)).body.pending[0].id, next.id);
  assert.equal((await request(head, `${form}/${next.id}`, 'DELETE')).status, 200);
  assert.deepEqual((await request(second, form)).body, empty);

  available = false;
  const cancelled = (await request(viewer, form, 'POST', { title: 'Withdrawn request' })).body.request;
  await until(() => instance.db.prepare('SELECT notify_after FROM movie_request_push WHERE request_id = ?').get(cancelled.id)?.notify_after > Date.now());
  assert.equal((await request(viewer, `${form}/${cancelled.id}`, 'DELETE')).status, 200);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS count FROM movie_request_push').get().count, 0);
  assert.equal((await request(head, '/api/logout', 'POST')).status, 200);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS count FROM movie_request_devices').get().count, 0);

  // A request written by an older server can be removed before this server receives its first new request.
  instance.db.prepare(`INSERT INTO movie_requests (id, user_id, title, title_key, created)
    VALUES (100, (SELECT id FROM users WHERE username = 'viewer'), 'Existing movie', 'existing movie', ?)`).run(Date.now());
  await stop();
  await start();
  assert.equal((await request(viewer, `${form}/100`, 'DELETE')).status, 200);
  const added = (await request(viewer, form, 'POST', { title: 'Another movie' })).body.request;
  assert.ok(added.id > 100);
  assert.equal(alerts.length, 4);
});

test('Firebase alert displays the movie title, optional year, and requester', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-fcm-payload-'));
  t.after(() => fs.rm(dataDir, { force: true, recursive: true }));
  const credential = path.join(dataDir, 'firebase.json');
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  await fs.writeFile(credential, JSON.stringify({ type: 'service_account', project_id: 'matro-test',
    client_email: 'sender@matro-test.iam.gserviceaccount.com', private_key: privateKey }));
  const messages = [];
  const send = createFcm({ MATRO_REQUEST_FCM_CREDENTIALS: credential }, async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'fixture', expires_in: 3600 });
    messages.push(JSON.parse(init.body).message);
    return Response.json({ name: 'fixture' });
  });
  const device = { id: 'owner-device', token: 'fixture-android-token' };
  await send({ ...device, title: 'Arrival', year: 2016, requester: 'viewer' });
  await send({ ...device, title: 'Singin’ in the Rain', year: null, requester: 'second' });
  await send({ ...device, title: 'Arrival', year: 2016, outcome: 'ready' });
  await send({ ...device, title: 'Arrival', year: 2016, outcome: 'declined' });
  await send(device, { test: true });
  assert.deepEqual(messages.map(message => message.notification), [
    { title: 'Arrival (2016)', body: 'Requested by viewer' },
    { title: 'Singin’ in the Rain', body: 'Requested by second' },
    { title: 'Arrival (2016)', body: 'Ready to watch in your library' },
    { title: 'Arrival (2016)', body: 'Your request was declined' },
    { title: 'Example Movie (2024)', body: 'Requested by Demo Viewer · Test alert' },
  ]);
  assert.ok(messages.every(message => message.data.registration === device.id && message.data.kind === 'matro.movie-request'));
});

test('requesters see the outcome of series, season and movie requests and are told when a title arrives', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-request-status-'));
  const alerts = [];
  const { app, server, db } = createApp({ dataDir, tmdb: { env: {} }, movieRequests: { send: async (device, options) => { alerts.push({ ...device, test: options?.test || false }); return 'sent'; } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); await fs.rm(dataDir, { force: true, recursive: true }); });
  await app.createUser('head', 'test password', 'admin');
  await app.createUser('viewer', 'test password', 'viewer');
  async function request(token, route, method = 'GET', body) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method, headers: { 'x-matro': '1', 'x-matro-client': 'native', 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }
  const login = async username => (await request('', '/api/login', 'POST', { username, password: 'test password' })).body.token;
  const head = await login('head'), viewer = await login('viewer');
  const form = '/api/movie-requests', inbox = '/api/admin/movie-requests';

  assert.equal((await request(viewer, form, 'POST', { title: 'Show', kind: 'album' })).status, 400);
  assert.equal((await request(viewer, form, 'POST', { title: 'Show', kind: 'season' })).status, 400);
  assert.equal((await request(viewer, form, 'POST', { title: 'Show', kind: 'season', season: 100 })).status, 400);
  assert.equal((await request(viewer, form, 'POST', { title: 'Show', tmdbId: 'x' })).status, 400);
  assert.equal((await request(viewer, form + '/search?query=Dune')).status, 503);

  const add = async body => (await request(viewer, form, 'POST', body)).body.request;
  const dune = await add({ title: 'Dune', year: 2021, kind: 'movie', tmdbId: 438631 });
  const series = await add({ title: 'Severance', kind: 'series' });
  const second = await add({ title: 'Severance', kind: 'season', season: 2 });
  const absent = await add({ title: 'Nothing here', kind: 'series' });
  const wrongYear = await add({ title: 'Heat', year: 1995 });
  assert.deepEqual([dune.kind, dune.tmdbId, series.kind, second.kind, second.season, series.season], ['movie', 438631, 'series', 'season', 2, null]);
  assert.equal((await add({ title: 'severance', kind: 'season', season: 2 })).id, second.id);
  assert.notEqual((await add({ title: 'Severance', kind: 'season', season: 3 })).id, second.id);

  const { registration } = (await request(viewer, form + '/device', 'PUT', { token: 'android:viewer-registration-token' })).body;
  assert.ok(registration);
  assert.equal((await request(viewer, form + '/device/test', 'POST')).status, 200);
  assert.equal((await request(head, form + '/device', 'PUT', { token: 'android:viewer-registration-token' })).status, 403);
  alerts.length = 0;

  // The scanner reports a movie (2021), season 1 of the show, and a Heat from another year.
  db.prepare("INSERT INTO folders (id, path, added) VALUES (1, '/media', 1)").run();
  const addItem = (id, group, year, kind, season) => db.prepare(`INSERT INTO items (id, folder_id, path, title, group_id, group_title, year, kind, season, episode, size, mtime, added)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1)`).run(id, `/media/${id}.mkv`, group, group, group, year, kind, season, season ? 1 : null);
  addItem('a', 'Dune', 2021, 'movie', null);
  addItem('b', 'Severance', null, 'show', 1);
  addItem('c', 'Heat', 1986, 'movie', null);
  assert.equal(app.movieRequests.fulfil(), 2);
  await until(() => alerts.length === 2);
  assert.deepEqual(alerts.map(alert => [alert.title, alert.outcome]).sort(), [['Dune', 'ready'], ['Severance', 'ready']]);

  const updates = (await request(viewer, '/api/library')).body.requestUpdates;
  assert.deepEqual(updates.map(update => [update.title, update.outcome]), [['Dune', 'ready'], ['Severance', 'ready']]);
  const listed = (await request(viewer, form)).body;
  assert.deepEqual(listed.handled.map(row => [row.title, row.outcome, row.isNew, row.groupId]).sort(), [['Dune', 'ready', true, 'Dune'], ['Severance', 'ready', true, 'Severance']]);
  assert.deepEqual(listed.pending.map(row => row.title).sort(), ['Heat', 'Nothing here', 'Severance', 'Severance']);
  assert.deepEqual((await request(viewer, '/api/library')).body.requestUpdates, []);
  assert.deepEqual((await request(viewer, form)).body.handled.map(row => row.isNew), [false, false]);

  // Season 2 arrives later; requests already answered stay as they were.
  addItem('d', 'Severance', null, 'show', 2);
  assert.equal(app.movieRequests.fulfil(), 1);
  assert.equal(app.movieRequests.fulfil(), 0);

  alerts.length = 0;
  assert.equal((await request(head, `${inbox}/${wrongYear.id}`, 'PATCH', { declined: true })).body.request.outcome, 'declined');
  await until(() => alerts.length === 1);
  assert.equal(alerts[0].outcome, 'declined');
  assert.equal((await request(head, `${inbox}/${absent.id}`, 'PATCH')).body.request.outcome, 'ready');
  assert.equal((await request(viewer, form)).body.handled.find(row => row.id === wrongYear.id).outcome, 'declined');
});

test('an older movie_requests table gains the new columns without losing rows', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-request-migration-'));
  let db;
  t.after(async () => { db?.close(); await fs.rm(dataDir, { force: true, recursive: true }); });
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(dataDir, 'matro.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, hash TEXT NOT NULL, role TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE movie_requests (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT NOT NULL, title_key TEXT NOT NULL, year INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'handled')), created INTEGER NOT NULL);
    INSERT INTO movie_requests (id, title, title_key, status, created) VALUES (7, 'Old request', 'old request', 'handled', 1);`);
  old.close();
  const { open } = require('../../../packages/core/server/db');
  db = open(file);
  assert.deepEqual({ ...db.prepare('SELECT kind, season, tmdb_id, declined, group_id, seen FROM movie_requests WHERE id = 7').get() },
    { kind: 'movie', season: 0, tmdb_id: null, declined: 0, group_id: null, seen: 1 });
});
