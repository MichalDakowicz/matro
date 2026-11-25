const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { setTimeout: delay } = require('node:timers/promises');
const { createApp } = require('../../../packages/core/server');
const { hashPassword, sessionHash } = require('../../../packages/core/server/auth');
const config = require('../../../packages/core/server/config');

const credentials = { username: 'head', password: 'test-password' };

async function fixture(t, { proxy, beforeOpen } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-auth-'));
  const previous = { mediaDir: config.mediaDir, trustProxy: config.trustProxy, cloudflareProxy: config.cloudflareProxy };
  const media = path.join(root, 'media'), dataDir = path.join(root, 'data');
  Object.assign(config, { mediaDir: media, trustProxy: Boolean(proxy), cloudflareProxy: proxy === 'cloudflare' });
  await fs.mkdir(dataDir);
  await beforeOpen?.(path.join(dataDir, 'matro.db'));
  const { app, server, db, library } = createApp({ dataDir, tmdb: { env: {} }, movieRequests: { env: {} } });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    while (library.state.probing) await delay(20);
    db.close();
    Object.assign(config, previous);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  if (!beforeOpen) await app.createUser(credentials.username, credentials.password, 'admin');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(route, { body, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(base + '/api/' + route, { method, headers: { 'x-matro': '1', ...headers },
      body: raw || body === undefined ? body : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    return { status: res.status, data: await res.json(), set, cookie: set?.split(';')[0] };
  }
  const login = (body = credentials, headers) => call('login', { body, headers });
  return { root, media, base, app, db, call, login };
}

test('direct access ignores forwarding headers, and an opaque origin receives a 403', async t => {
  const { call, login } = await fixture(t);
  const loginBody = { ...credentials, password: 'invalid-password' };
  for (let i = 1; i <= 6; i++) {
    const headers = { 'x-forwarded-for': `192.0.2.${i}`, 'cf-connecting-ip': `198.51.100.${i}` };
    assert.equal((await login(loginBody, headers)).status, i < 6 ? 401 : 429);
    assert.equal((await call('signup', { body: { code: 'AAAA-BBBB-CCCC' }, headers })).status, i < 6 ? 400 : 429);
  }
  assert.equal((await call('logout', { body: {}, headers: { origin: 'null' } })).status, 403);
});

test('one trusted proxy uses the rightmost forwarded address for login and invite attempts', async t => {
  const { app, call, login } = await fixture(t, { proxy: 'single' });
  const loginBody = { ...credentials, password: 'invalid-password' };
  for (let i = 1; i <= 6; i++) {
    const headers = { 'x-forwarded-for': `192.0.2.${i}, 198.51.100.1` };
    assert.equal((await login(loginBody, headers)).status, i < 6 ? 401 : 429);
    assert.equal((await call('signup', { body: { code: 'AAAA-BBBB-CCCC' }, headers })).status, i < 6 ? 400 : 429);
  }
  const headers = { 'x-forwarded-for': '192.0.2.1, 198.51.100.2', 'x-forwarded-proto': 'https' };
  const admin = await login(credentials, headers);
  assert.equal(admin.status, 200);
  assert.match(admin.set, /; Secure$/);
  const { code } = app.invites.create(admin.data.user.id);
  assert.equal((await call('signup', { body: { code, username: 'viewer', password: credentials.password }, headers })).status, 200);
});

test('Cloudflare client addresses share a soft limit without locking out a new address', async t => {
  const { app, call, login } = await fixture(t, { proxy: 'cloudflare' });
  const headers = i => ({ 'x-forwarded-for': '198.51.100.1', 'cf-connecting-ip': `192.0.2.${i}` });
  const invalid = i => login({ username: i % 2 ? 'HEAD' : 'head', password: 'invalid-password' }, headers(i));
  const badInvite = i => call('signup', { body: { code: 'AAAA-BBBB-CCCC' }, headers: headers(i) });
  for (let i = 1; i <= 20; i++) {
    assert.equal((await invalid(i)).status, 401);
    assert.equal((await badInvite(i)).status, 400);
  }
  const adminId = (await login(credentials, headers(21))).data.user.id;
  const { code } = app.invites.create(adminId);
  const [wrongPassword, wrongInvite, validInvite] = await Promise.all([
    invalid(22), badInvite(22), call('signup', { body: { code, username: 'viewer', password: credentials.password }, headers: headers(23) }),
  ]);
  assert.equal(wrongPassword.status, 429);
  assert.equal(wrongInvite.status, 429);
  assert.equal(validInvite.status, 200);
});

test('sliding a cookie session refreshes the cookie while bearer requests skip the refresh', async t => {
  const { call, db, login } = await fixture(t, { proxy: 'single' });
  const headers = { 'x-forwarded-proto': 'https' };
  const signedIn = await login(credentials, headers);
  const token = signedIn.cookie.split('=')[1];
  const setExpiry = db.prepare('UPDATE sessions SET expires = ? WHERE token_hash = ?');
  const expiry = db.prepare('SELECT expires FROM sessions WHERE token_hash = ?');
  const oldExpiry = Date.now() + 10 * 86400000;
  setExpiry.run(oldExpiry, sessionHash(token));
  const renewed = await call('me', { headers: { ...headers, cookie: signedIn.cookie } });
  assert.equal(renewed.cookie, signedIn.cookie);
  assert.equal(renewed.set, signedIn.set);
  assert.ok(expiry.get(sessionHash(token)).expires > oldExpiry);
  assert.equal((await call('me', { headers: { ...headers, cookie: signedIn.cookie } })).set, null);
  setExpiry.run(oldExpiry, sessionHash(token));
  assert.equal((await call('me', { headers: { authorization: `Bearer ${token}` } })).set, null);
  assert.ok(expiry.get(sessionHash(token)).expires > oldExpiry);
  setExpiry.run(oldExpiry, sessionHash(token));
  const logout = await call('logout', { body: {}, headers: { ...headers, cookie: signedIn.cookie } });
  assert.match(logout.set, /Max-Age=0; Secure$/);
  assert.equal((await call('me', { headers: { cookie: signedIn.cookie } })).status, 401);
});

test('concurrent current-password checks share a throttle across sessions', async t => {
  const { call, login } = await fixture(t);
  const sessions = await Promise.all([login(), login()]);
  const change = (session, current) => call('me/password', { body: { current, password: 'replacement-pass' }, headers: { cookie: session.cookie } });
  const statuses = await Promise.all(Array.from({ length: 8 }, (_, i) => change(sessions[i % 2], 'invalid-password').then(res => res.status)));
  assert.deepEqual(statuses.sort(), [403, 403, 403, 403, 403, 429, 429, 429]);
  assert.equal((await change(sessions[1], credentials.password)).status, 429);
});

test('migration keeps existing sessions and state while recreated viewers have new identities', async t => {
  const token = 'x'.repeat(43);
  const { call, login } = await fixture(t, { beforeOpen: async file => {
    const old = new DatabaseSync(file);
    try {
      old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, hash TEXT, role TEXT, created INTEGER);
        CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, created INTEGER, expires INTEGER);
        CREATE TABLE user_state (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT, updated INTEGER);`);
      const hash = await hashPassword(credentials.password);
      old.prepare("INSERT INTO users VALUES (3, 'head', ?, 'admin', 1), (17, 'viewer', ?, 'viewer', 2)").run(hash, hash);
      old.prepare('INSERT INTO sessions VALUES (?, 17, 1, ?)').run(sessionHash(token), Date.now() + 86400000);
      old.prepare('INSERT INTO user_state VALUES (17, ?, 1)').run(JSON.stringify({ preferences: { autoplay: false } }));
    } finally { old.close(); }
  } });
  const original = await call('library', { headers: { cookie: `matro_session=${token}` } });
  assert.equal(original.data.user.id, 17);
  assert.match(original.data.user.accountKey, /^[a-f0-9]{32}$/);
  assert.equal(original.data.preferences.autoplay, false);
  const admin = await login();
  const headers = { cookie: admin.cookie };
  assert.equal((await call('admin/users/17', { method: 'DELETE', headers })).status, 200);
  const { data: { code } } = await call('admin/invites', { body: {}, headers });
  const recreated = await call('signup', { body: { code, username: 'viewer', password: credentials.password } });
  assert.equal(recreated.status, 200);
  assert.ok(recreated.data.user.id > 17);
  assert.notEqual(recreated.data.user.accountKey, original.data.user.accountKey);
  assert.equal((await call('library', { headers: { cookie: `matro_session=${token}` } })).status, 401);
  const current = await call('library', { headers: { cookie: recreated.cookie } });
  assert.equal(current.data.user.accountKey, recreated.data.user.accountKey);
  assert.equal(current.data.preferences.autoplay, true);
});

test('upload destinations are confined before creating any nested folders', async t => {
  const { call, login, media, root } = await fixture(t);
  const outside = path.join(root, 'outside');
  await Promise.all([fs.mkdir(media), fs.mkdir(outside)]);
  await fs.symlink(outside, path.join(media, 'elsewhere'), 'junction');
  const headers = { cookie: (await login()).cookie };
  const res = await call('admin/upload?path=elsewhere%2Fnested%2Fclip.mp4', { headers, body: Buffer.from('outside') });
  assert.equal(res.status, 400);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('concurrent uploads publish exactly one file and clean up both temporary files', async t => {
  const { base, login, media } = await fixture(t);
  const cookie = (await login()).cookie, folder = path.join(media, 'nested');
  const requests = ['first-upload', 'second-upload'].map(text => {
    let request;
    const result = new Promise((resolve, reject) => {
      request = http.request(base + '/api/admin/upload?path=nested%2Fclip.mp4', {
        method: 'POST', headers: { cookie, 'x-matro': '1', 'content-length': Buffer.byteLength(text) },
      }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      request.on('error', reject);
      request.write(text.slice(0, 1));
    });
    return { text, request, result };
  });
  const results = Promise.all(requests.map(upload => upload.result));
  try {
    let parts = [];
    for (let i = 0; i < 100 && parts.length < 2; i++) {
      parts = await fs.readdir(folder).catch(() => []);
      if (parts.length < 2) await delay(25);
    }
    assert.equal(parts.filter(file => file.endsWith('.part')).length, 2);
    for (const upload of requests) upload.request.end(upload.text.slice(1));
    const statuses = await results;
    assert.deepEqual([...statuses].sort(), [200, 409]);
    assert.deepEqual(await fs.readdir(folder), ['clip.mp4']);
    assert.equal(await fs.readFile(path.join(folder, 'clip.mp4'), 'utf8'), requests[statuses.indexOf(200)].text);
  } finally {
    for (const upload of requests) upload.request.destroy();
    await results.catch(() => {});
  }
});

test('download routes preserve explicit statuses and hide upstream and unexpected failures', async t => {
  const { app, call, login } = await fixture(t);
  const headers = { cookie: (await login()).cookie };
  const route = () => call('admin/downloads/config', { headers });
  app.downloads.config = () => { throw Object.assign(new Error('Refresh the selection.'), { status: 409 }); };
  const conflict = await route();
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error, 'Refresh the selection.');
  app.downloads.config = () => { throw Object.assign(new Error('Private upstream response'), { status: 503 }); };
  const upstream = await route();
  assert.equal(upstream.status, 503);
  assert.doesNotMatch(upstream.data.error, /Private/);
  t.mock.method(console, 'error', () => {});
  app.downloads.config = () => { throw new Error('Private local path'); };
  const unexpected = await route();
  assert.equal(unexpected.status, 500);
  assert.doesNotMatch(unexpected.data.error, /Private/);
});
