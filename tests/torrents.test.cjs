const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createTorrents, endpoint } = require('../electron/torrents.cjs');
const hash = '1234567890abcdef1234567890abcdef12345678';
const secure = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from([...value].reverse().join('')), decryptString: value => [...value.toString()].reverse().join('') };

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-downloads-'));
  const calls = [], additions = [], existing = new Map();
  let expired = false, brokenCatalog = false, failAdd = false, failDelete = false;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw), route = req.url.split('?')[0];
    calls.push({ route, cookie: req.headers.cookie, origin: req.headers.origin });
    if (route === '/catalog/list_movies.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(brokenCatalog ? { status: 'error' } : { status: 'ok', data: { movie_count: 21, movies: [{ id: 1, title: '<Movie & title>', year: 1968, torrents: [{ hash, quality: '1080p', seeds: 12 }, { hash: 'not-a-hash' }] }] } })); return;
    }
    if (route.endsWith('/auth/login')) {
      if (form.get('password') !== 'private-password' || form.get('username') !== 'michu') { res.end('Fails.'); return; }
      res.setHeader('Set-Cookie', 'SID=test-session; HttpOnly; path=/'); res.end('Ok.'); return;
    }
    if (req.headers.cookie !== 'SID=test-session' || expired) { expired = false; res.statusCode = 403; res.end('Forbidden'); return; }
    if (req.headers.origin !== `http://127.0.0.1:${server.address().port}`) { res.statusCode = 403; res.end(); return; }
    if (route.endsWith('/app/version')) { res.end('v5.1.4'); return; }
    if (route.endsWith('/torrents/info')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(existing.get(route.split('/')[1]) || [])); return; }
    if (route.endsWith('/torrents/add')) {
      if (failAdd) { res.end('Fails.'); return; }
      additions.push({ route, form });
      existing.set(route.split('/')[1], [{ hash, name: '<Movie & title>', progress: .42, state: 'downloading', dlspeed: 2048, save_path: form.get('savepath') }]);
      res.end('Ok.'); return;
    }
    if (route.endsWith('/torrents/delete')) {
      if (failDelete) { res.statusCode = 500; res.end(); return; }
      assert.equal(form.get('deleteFiles'), 'false');
      assert.equal(form.get('hashes'), hash);
      existing.delete(route.split('/')[1]); res.end(); return;
    }
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const options = { dir, secure, catalog: url + '/catalog/' };
  const service = createTorrents(options);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  return { service, dir, options, url, calls, additions, expire: () => expired = true, breakCatalog: () => brokenCatalog = true, failAdd: (value = true) => failAdd = value, failDelete: value => failDelete = value };
}
const settings = (url, target = 'local', savePath = '') => ({ target, url, username: 'michu', password: 'private-password', seeding: 'yes', savePath });

test('HTTP errors during login preserve the transient classification', async t => {
  const f = await fixture(t);
  for (const status of [530, 503, 429, 401, 403]) {
    const service = createTorrents({ ...f.options, fetch: async () => new Response('Unavailable', { status }) });
    await assert.rejects(service.configure(settings(f.url)), error => error.message.includes(`HTTP ${status}`) && error.retryable === [530, 503, 429].includes(status));
  }
});

test('removal keeps files, retains history on API failure, and persists after restart', async t => {
  const f = await fixture(t);
  await f.service.configure(settings(f.url));
  await f.service.search({ query: 'Sample' });
  await f.service.add({ target: 'local', hash });
  f.failDelete(true);
  await assert.rejects(f.service.remove({ target: 'local', hash }), /HTTP 500/);
  assert.equal((await f.service.jobs('local')).length, 1);
  f.failDelete(false);
  assert.deepEqual(await f.service.remove({ target: 'local', hash }), { removed: true, filesKept: true });
  assert.deepEqual(await f.service.jobs('local'), []);
  assert.deepEqual(await f.service.list('local'), []);
  const restarted = createTorrents(f.options);
  assert.deepEqual(await restarted.jobs('local'), []);
  await assert.rejects(restarted.remove({ target: 'local', hash: 'all' }), /valid download/);
});

test('a stale failed entry can be removed even when its torrent is absent', async t => {
  const f = await fixture(t);
  await f.service.configure(settings(f.url));
  await f.service.search({ query: 'Sample' });
  f.failAdd();
  await assert.rejects(f.service.add({ target: 'local', hash }), /did not accept/);
  assert.equal((await f.service.jobs('local'))[0].phase, 'error');
  await f.service.remove({ target: 'local', hash });
  assert.deepEqual(await f.service.jobs('local'), []);
  assert.equal(f.calls.some(call => call.route.endsWith('/torrents/delete')), false);
});

test('server SSH host mapping survives saves and reloads without changing the torrent URL', async t => {
  const f = await fixture(t);
  let result = await f.service.configure({ ...settings(f.url, 'server'), sshHost: '192.168.100.6' });
  assert.equal(result.server.sshHost, '192.168.100.6');
  result = await f.service.configure({ ...settings(f.url, 'server'), password: '' });
  assert.equal(result.server.sshHost, '192.168.100.6');
  const restarted = createTorrents(f.options);
  assert.equal((await restarted.config()).server.sshHost, '192.168.100.6');
  assert.equal((await restarted.config()).server.url, f.url + '/');
  await assert.rejects(f.service.configure({ ...settings(f.url, 'server'), sshHost: 'https://wrong/path' }), /SSH server hostname/);
});

test('endpoint validation rejects unsafe schemes, embedded secrets, and remote addresses labelled local', () => {
  assert.equal(endpoint('http://localhost:8080/api/v2/', 'local'), 'http://localhost:8080/');
  assert.equal(endpoint('https://host/qb/', 'server'), 'https://host/qb/');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://user:secret@host', 'http://host/#token', 'http://host/?token=secret']) assert.throws(() => endpoint(url, 'server'));
  assert.throws(() => endpoint('http://192.168.1.1:8080', 'local'));
});

test('profiles encrypt passwords, hide secrets, preserve blank passwords, and reconnect after restart', async t => {
  const f = await fixture(t);
  const result = await f.service.configure(settings(f.url));
  assert.equal(result.local.passwordSaved, true);
  assert.equal(JSON.stringify(result).includes('private-password'), false);
  const disk = await fs.readFile(path.join(f.dir, 'downloads.json'), 'utf8');
  assert.equal(disk.includes('private-password'), false);
  await f.service.configure({ ...settings(f.url), password: '' });
  const restarted = createTorrents(f.options);
  assert.deepEqual(await restarted.list('local'), []);
  await assert.rejects(restarted.configure({ ...settings(f.url), password: 'wrong' }), /login failed/);
  assert.deepEqual(await restarted.config(), result);
  await assert.rejects(restarted.configure({ ...settings(f.url + '/other'), password: '' }), /login failed/);
});

test('local and server submissions use their own folders, deduplicate, and renew expired sessions', async t => {
  const f = await fixture(t);
  await f.service.configure(settings(f.url + '/local', 'local', 'C:\\Movies'));
  await f.service.configure(settings(f.url + '/server', 'server', '/mnt/media/downloads/complete'));
  assert.equal(f.additions.length, 0);
  const response = await f.service.search({ query: 'public domain', page: 2 });
  assert.equal(response.page, 2); assert.equal(response.total, 21);
  assert.equal(response.movies[0].torrents.length, 1);
  assert.equal(f.additions.length, 0);
  await assert.rejects(f.service.add({ target: 'local', hash: 'deadbeef' }), /Search again/);
  f.expire();
  assert.equal((await f.service.add({ target: 'local', hash })).preparing, true);
  assert.deepEqual(await f.service.add({ target: 'local', hash }), { duplicate: true });
  assert.equal((await f.service.add({ target: 'server', hash })).preparing, true);
  assert.equal(f.additions.length, 2);
  assert.ok(f.additions[0].form.get('savepath').startsWith('C:\\Movies'));
  assert.equal(f.additions[0].form.get('useDownloadPath'), 'false');
  assert.equal(f.additions[0].form.get('stopCondition'), 'MetadataReceived');
  assert.ok(f.additions[1].form.get('savepath').startsWith('/mnt/media/Movies/'));
  assert.equal(f.additions[0].form.get('autoTMM'), 'false');
  assert.ok(f.additions[0].form.get('urls').startsWith(`magnet:?xt=urn:btih:${hash}&dn=`));
  const list = await f.service.list('server');
  assert.equal(list[0].progress, .42); assert.ok(list[0].savePath.startsWith('/mnt/media/Movies/'));
  assert.ok(f.calls.filter(call => call.route.endsWith('/auth/login')).length >= 3);
});

test('default folder is left to the client and failed adds are reported', async t => {
  const f = await fixture(t);
  await f.service.configure(settings(f.url));
  await f.service.search({ query: 'movie' });
  f.failAdd(); await assert.rejects(f.service.add({ target: 'local', hash }), /did not accept/);
  f.failAdd(false); await f.service.add({ target: 'local', hash });
  assert.equal(f.additions[0].form.has('savepath'), true);
  assert.equal(f.additions[0].form.get('autoTMM'), 'false');
  f.breakCatalog(); await assert.rejects(f.service.search({ query: 'movie' }), /catalog is unavailable/);
  await assert.rejects(f.service.search({ query: 'movie', page: 0 }), /Invalid results page/);
  await assert.rejects(f.service.list('unknown'), /Choose This PC or Server/);
});

test('stale catalog releases cannot be submitted', async t => {
  const f = await fixture(t);
  await f.service.search({ query: 'movie' });
  const future = Date.now() + 61 * 60 * 1000;
  t.mock.method(Date, 'now', () => future);
  await assert.rejects(f.service.add({ target: 'local', hash }), /Search again/);
  assert.equal(f.additions.length, 0);
});

test('unavailable encryption and relative folders fail before any authentication request', async t => {
  const f = await fixture(t);
  const insecure = createTorrents({ ...f.options, secure: { isEncryptionAvailable: () => false } });
  await assert.rejects(insecure.configure(settings(f.url)), /storage is unavailable/);
  await assert.rejects(f.service.configure(settings(f.url, 'local', 'relative/folder')), /absolute folders/);
  assert.equal(f.calls.length, 0);
});
