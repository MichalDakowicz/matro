const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createReceiver, proxyTarget, subtitleMeta, PROXY } = require('../electron/receiver.cjs');

async function fakeServer(routes) {
  const calls = [];
  const server = await new Promise(resolve => { const s = http.createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body, matro: req.headers['x-matro'] });
      const hit = routes[`${req.method} ${req.url.split('?')[0]}`];
      res.setHeader('content-type', 'application/json');
      if (!hit) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'Not found.' })); }
      res.end(typeof hit === 'function' ? JSON.stringify(hit(body)) : JSON.stringify(hit));
    });
  }).listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, calls, base: `http://127.0.0.1:${server.address().port}` };
}
const make = (base, user = { id: 1, username: 'ann', role: 'viewer' }, extra = {}) => createReceiver({ base, fetch, user, openDialog: async () => ({ canceled: true }), notifyMetadata() {}, ...extra });

test('only the server API is reachable through the proxy', () => {
  assert.equal(proxyTarget('http://s:1', 'matro://app/server/api/items/a/direct?x=1'), 'http://s:1/api/items/a/direct?x=1');
  assert.equal(proxyTarget('http://s:1', 'matro://app/server/etc/passwd'), null);
  assert.equal(proxyTarget('http://s:1', 'matro://other/server/api/x'), null);
});

test('subtitle names, languages and types come from the file name', () => {
  assert.deepEqual(subtitleMeta('C:/x/Show.S01E01.pl.forced.srt'), { name: 'Show S01E01 pl forced', language: 'pl', kind: 'forced' });
  assert.equal(subtitleMeta('Film.srt').language, 'en');
  assert.equal(subtitleMeta('Film.en.sdh.srt').kind, 'sdh');
});

test('load, save and stream go through the account API', async () => {
  const { server, calls, base } = await fakeServer({
    'GET /api/library': { user: { id: 1, username: 'ann', role: 'viewer' }, items: [], metadata: {}, metadataEnabled: false },
    'PUT /api/state': { ok: true },
    'GET /api/items/a/info': { duration: 90, video: {}, audio: [{ index: 1 }], chapters: [], directPlay: true, embedded: [{ index: 2, forced: false, language: 'en' }], uploaded: [{ id: 7, name: 'Mine', language: 'pl', kind: 'forced', addedBy: 'bob' }] }
  });
  try {
    const r = make(base);
    assert.deepEqual((await r.handlers['library:load']()).items, []);
    await r.handlers['library:save']({ progress: { a: { position: 5 } }, queue: ['a'], preferences: { volume: 1 } });
    assert.equal(calls.find(c => c.method === 'PUT').matro, '1');
    assert.deepEqual(JSON.parse(calls.find(c => c.method === 'PUT').body).queue, ['a']);
    const info = await r.handlers['media:inspect']('a');
    assert.deepEqual(info.subtitles.map(s => [s.index, s.title]), [[2, undefined], [10007, 'Mine (forced)']].map(([i, t]) => [i, t]));
    assert.deepEqual(await r.handlers['media:stream']({ id: 'a', offset: 12 }), { url: `${PROXY}/api/items/a/direct#t=12`, offset: 0 });
    const burned = await r.handlers['media:stream']({ id: 'a', offset: 3, audio: 1, bitmapSubtitle: 5, subtitleDelay: 1 });
    assert.match(burned.url, /transcode\?t=3&audio=1&burn=5&delay=1$/);
    assert.equal(await r.handlers['media:preview']({ id: 'a', time: 4, hover: true }), `${PROXY}/api/items/a/frame?t=4&w=320`);
  } finally { server.close(); }
});

test('viewers cannot manage media or downloads; server errors reach the caller', async () => {
  const { server, base } = await fakeServer({});
  try {
    const r = make(base);
    await assert.rejects(r.handlers['library:files'](), /head account/);
    await assert.rejects(r.handlers['downloads:jobs'](), /head account/);
    await assert.rejects(r.handlers['library:ssh'](), /not available in receiver mode/);
    await assert.rejects(r.handlers['library:load'](), /Not found/);
    assert.deepEqual(await r.handlers['media:segments'](), []);
  } finally { server.close(); }
});
