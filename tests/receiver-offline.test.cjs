const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createOfflineStore, createCache, serverDir, serveFile } = require('../electron/receiver-offline.cjs');
const { createReceiver, isOffline } = require('../electron/receiver.cjs');

const FILE = Buffer.alloc(20 * 1024 * 1024 + 123, 7); // more than two 8 MB pieces

async function fakeServer({ preparingFor = 0 } = {}) {
  let asked = 0; const ranges = [];
  const server = await new Promise(resolve => { const s = http.createServer((req, res) => {
    if (req.url.endsWith('/offline/file')) {
      const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || ''); ranges.push(req.headers.range);
      res.statusCode = 206; res.setHeader('content-range', `bytes ${m[1]}-${m[2]}/${FILE.length}`); return res.end(FILE.subarray(Number(m[1]), Number(m[2]) + 1));
    }
    if (req.url.endsWith('/offline')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(++asked > preparingFor ? { state: 'ready', size: FILE.length, type: 'video/mp4' } : { state: 'preparing' })); }
    res.statusCode = 404; res.end('{}');
  }).listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, ranges, base: `http://127.0.0.1:${server.address().port}` };
}
const prepare = async id => ({ info: { duration: 5, audio: [{ index: 1 }], subtitles: [] }, subtitles: { 2: 'WEBVTT' }, title: `Title ${id}` });

test('a title is saved in ranged pieces, listed, and removed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-off-'));
  const { server, ranges, base } = await fakeServer({ preparingFor: 1 });
  const seen = [];
  try {
    const store = createOfflineStore({ dir, fetch, base, prepare, notify: s => seen.push(s), pause: async () => {} });
    await store.init();
    assert.equal(store.has('abc'), false);
    await store.start('abc');
    assert.equal(store.has('abc'), true);
    assert.equal(store.progress('abc'), null);
    assert.equal(ranges.length, 3);
    assert.equal((await fs.readFile(store.file('abc'))).length, FILE.length);
    assert.equal(store.subtitle('abc', '2'), 'WEBVTT');
    assert.equal(store.info('abc').audio.length, 1);
    assert.ok(seen.some(s => s.progress.abc === 100));
    const again = createOfflineStore({ dir, fetch, base, prepare });
    await again.init();
    assert.deepEqual(again.list().map(r => [r.id, r.title, r.size]), [['abc', 'Title abc', FILE.length]]);
    await again.remove('abc');
    assert.equal(again.has('abc'), false);
    assert.deepEqual((await fs.readdir(dir)).filter(n => n.startsWith('abc')), []);
  } finally { server.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('an interrupted save resumes from the bytes already on disk, and bad ids are refused', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-off-'));
  const { server, ranges, base } = await fakeServer();
  try {
    await fs.writeFile(path.join(dir, 'abc.part'), FILE.subarray(0, 8 * 1024 * 1024));
    const store = createOfflineStore({ dir, fetch, base, prepare, pause: async () => {} });
    await store.init();
    assert.deepEqual((await store.partials()).map(p => p.id), ['abc']);
    await store.start('abc');
    assert.equal(ranges[0], `bytes=${8 * 1024 * 1024}-${16 * 1024 * 1024 - 1}`);
    await assert.rejects(store.start('../evil'), /Unknown title/);
  } finally { server.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('saved files are served with byte ranges', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-off-'));
  const file = path.join(dir, 'x.mp4'); await fs.writeFile(file, Buffer.from('0123456789'));
  const part = await serveFile(file, 'video/mp4', 'bytes=2-4');
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 2-4/10'); assert.equal(await part.text(), '234');
  assert.equal(await (await serveFile(file, 'video/mp4', 'bytes=-3')).text(), '789');
  assert.equal((await serveFile(file, 'video/mp4', 'bytes=50-')).status, 416);
  assert.equal(await (await serveFile(file, 'video/mp4', null)).text(), '0123456789');
  await fs.rm(dir, { recursive: true, force: true });
});

test('offline start: the library and unsent progress come from the cache and are replayed later', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-off-'));
  const cache = createCache(dir), store = { has: () => false, info: () => null, subtitle: () => null };
  const library = { user: { id: 1, username: 'ann', role: 'viewer' }, items: [], metadata: {}, progress: { a: { position: 1 } } };
  const sent = [];
  let online = true;
  const server = await new Promise(resolve => { const s = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', () => { sent.push([req.method, req.url, body]); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.method === 'GET' ? library : { ok: true })); });
  }).listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const flaky = (url, options) => online ? fetch(url, options) : Promise.reject(new TypeError('fetch failed'));
  const make = () => createReceiver({ base, fetch: flaky, user: library.user, openDialog: async () => ({}), notifyMetadata() {}, offline: store, cache });
  try {
    await make().handlers['library:load']();
    online = false;
    const offline = make();
    const data = await offline.handlers['library:load']();
    assert.equal(data.offline, true);
    await offline.handlers['library:save']({ progress: { a: { position: 9 } }, queue: [], preferences: {} });
    assert.equal((await cache.read('pending')).progress.a.position, 9);
    assert.equal((await offline.handlers['library:load']()).progress.a.position, 9);
    online = true;
    await make().handlers['library:load']();
    assert.ok(sent.some(([method, , body]) => method === 'PUT' && body.includes('"position":9')));
    assert.equal(await cache.read('pending'), null);
  } finally { server.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('server folders are per address and network errors are told apart from server errors', () => {
  assert.notEqual(serverDir('/u', 'http://a:1'), serverDir('/u', 'http://b:1'));
  assert.equal(isOffline(new TypeError('fetch failed')), true);
  assert.equal(isOffline(new Error('Wrong username or password.')), false);
});
