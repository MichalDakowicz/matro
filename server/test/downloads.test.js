const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src');
const { createDownloads } = require('../src/downloads');

test('host downloads enforce roles, protect credentials and prepare without deleting files', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matro-downloads-'));
  const media = path.join(root, 'library'), dataDir = path.join(root, 'data');
  fs.mkdirSync(media);
  const calls = [], hash = 'a'.repeat(40);
  let torrent = null, files = [{ index: 0, name: 'Example.mkv', size: 100, priority: 1 }];
  const reply = value => new Response(typeof value === 'string' ? value : JSON.stringify(value));
  async function mock(url, options = {}) {
    const route = new URL(url).pathname.split('/api/v2/')[1], body = options.body;
    calls.push({ route, body: body?.toString() });
    if (route === 'auth/login') return new Response('Ok.', { headers: { 'set-cookie': 'SID=mock' } });
    if (route === 'app/version') return reply('v5.1.4');
    if (route === 'torrents/add') { torrent = { hash, tags: body.get('tags'), save_path: body.get('savepath'), progress: 0, state: 'stoppedDL' }; return reply('Ok.'); }
    if (route === 'torrents/info') return reply(torrent ? [torrent] : []);
    if (route === 'torrents/files') return reply(files);
    if (route === 'torrents/renameFile') files[0].name = body.get('newPath');
    if (route === 'torrents/setLocation') torrent.save_path = body.get('location');
    if (route === 'torrents/delete') torrent = null;
    return reply('');
  }
  const created = createApp({ dataDir, downloads: { fetch: mock, hostConfig: { url: 'http://127.0.0.1:8080', movieRoot: path.join(media, 'Movies'), showRoot: path.join(media, 'Shows') } }, tmdb: { env: {} } });
  const { app, server, db, library } = created;
  t.after(async () => { app.downloads.close(); await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await library.addFolder(media);
  await app.createUser('head', 'head password', 'admin');
  await app.createUser('viewer', 'viewer password', 'viewer');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (cookie, route, body) => {
    const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-matro': '1', cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  const head = (await request('', '/api/login', { username: 'head', password: 'head password' })).cookie;
  const viewer = (await request('', '/api/login', { username: 'viewer', password: 'viewer password' })).cookie;
  const api = '/api/admin/downloads/';
  for (const [route, body] of [['config'], ['list'], ['jobs'], ['configure', {}], ['add', {}], ['remove', {}], ['retry', {}], ['search', {}], ['series-search', {}], ['series-releases', {}]]) {
    assert.equal((await request('', api + route, body)).status, 401);
    assert.equal((await request(viewer, api + route, body)).status, 403);
  }
  const storage = { movieRoot: path.join(media, 'Movies'), showRoot: path.join(media, 'Shows') };
  const settings = { target: 'server', url: 'http://127.0.0.1:8080', username: 'test', password: 'private-test-password', storage };
  assert.equal((await request(head, api + 'configure', { ...settings, target: 'local' })).status, 400);
  // Browser-supplied addresses and paths cannot override the server destination.
  assert.equal((await request(head, api + 'configure', { ...settings, url: 'http://invalid.example', storage: { ...storage, movieRoot: root } })).status, 200);
  const saved = await request(head, api + 'configure', { username: settings.username, password: settings.password });
  assert.equal(saved.body.result.server.url, settings.url + '/');
  assert.equal(saved.body.result.server.storage.movieRoot, storage.movieRoot);
  assert.equal(saved.body.result.server.storage.showRoot, storage.showRoot);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.result.server.passwordSaved, true);
  assert.ok(!JSON.stringify(saved.body).includes(settings.password));
  assert.ok(!fs.readFileSync(path.join(dataDir, 'downloads.json'), 'utf8').includes(settings.password));
  const reopened = createDownloads({ dataDir, library, tmdb: app.tmdb, fetch: mock, hostConfig: { url: settings.url, ...storage } });
  await reopened.configure({ ...settings, password: '' }); reopened.close();
  assert.equal((await request(head, api + 'add', { target: 'server', magnet: `magnet:?xt=urn:btih:${hash}`, title: 'Example', kind: 'movie', seed: false })).status, 200);
  for (let i = 0; i < 5; i++) await app.downloads.process();
  assert.equal((await request(head, api + 'jobs')).body.result[0].phase, 'ready');
  assert.ok(calls.some(c => c.route === 'torrents/start'));
  const kept = path.join(media, 'keep.txt'); fs.writeFileSync(kept, 'keep');
  assert.equal((await request(head, api + 'remove', { target: 'server', hash })).status, 200);
  assert.equal(fs.readFileSync(kept, 'utf8'), 'keep');
  assert.ok(calls.some(c => c.route === 'torrents/delete' && c.body.includes('deleteFiles=false')));
  assert.deepEqual((await request(head, api + 'jobs')).body.result, []);
});

test('Docker path mappings check existing files through the library mount', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matro-path-map-'));
  let checked = false;
  const downloads = createDownloads({ dataDir: path.join(root, 'data'), library: { folders: () => [{ path: root }] }, tmdb: {}, pathMap: { '/host/movies': root }, hostConfig: { movieRoot: '/host/movies', showRoot: '/host/movies/Shows' }, fetch: async url => {
    checked = true; return new URL(url).pathname.endsWith('/auth/login') ? new Response('Ok.', { headers: { 'set-cookie': 'SID=test' } }) : new Response('v5.1.4');
  } });
  try {
    await downloads.configure({ target: 'server', url: 'http://localhost:8080', storage: { movieRoot: '/host/movies', showRoot: '/host/movies/Shows' } });
    assert.equal(checked, true);
  } finally { downloads.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
