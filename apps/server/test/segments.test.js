const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createApp } = require('../../../packages/core/server');
const { ffmpeg } = require('../../../packages/core/server/config');

test('real season comparison persists markers, isolates shows and remembers per-account removal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-segments-'));
  const media = path.join(root, 'media'), dataDir = path.join(root, 'data');
  await fs.mkdir(media);
  const source = path.join(root, 'source.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=5:duration=80', '-c:v', 'libx264', '-preset', 'ultrafast', source]);
  for (const name of ['North.S01E01', 'North.S01E02', 'North.S02E01', 'South.S01E01']) await fs.copyFile(source, path.join(media, name + '.mp4'));
  let instance;
  const start = async () => {
    instance = createApp({ dataDir, tmdb: { env: {} } });
    await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${instance.server.address().port}`;
  };
  const stop = async () => {
    instance.app.scanner.close(); instance.server.closeAllConnections();
    await new Promise(resolve => instance.server.close(resolve)); instance.db.close();
    instance = null;
  };
  try {
    let base = await start();
    await instance.app.createUser('head', 'segment-test-password', 'admin');
    await instance.app.createUser('viewer', 'segment-test-password', 'viewer');
    await instance.library.addFolder(media);
    const login = async username => {
      const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'x-matro': '1', 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'segment-test-password' }) });
      assert.equal(res.status, 200); return res.headers.get('set-cookie').split(';')[0];
    };
    const call = async (cookie, route, body) => {
      const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'x-matro': '1', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      assert.equal(res.status, 200, route); return res.json();
    };
    const head = await login('head'), viewer = await login('viewer');
    const catalog = (await call(head, '/api/library')).items;
    const item = catalog.find(i => i.title === 'North S01E01');
    assert.ok(item);
    const detected = (await call(head, `/api/items/${item.id}/segments`, {})).markers;
    assert.ok(detected.some(m => m.type === 'intro'), JSON.stringify(detected));
    assert.ok(detected.some(m => m.type === 'outro'), JSON.stringify(detected));
    for (const other of catalog.filter(i => i.group !== item.group || i.season !== item.season)) {
      assert.deepEqual((await call(head, `/api/items/${other.id}/segments`, {})).markers, []);
    }
    const marker = detected.find(m => m.type === 'intro');
    const remaining = (await call(head, `/api/items/${item.id}/segments/remove`, { marker })).markers;
    assert.ok(!remaining.some(m => m.type === 'intro'));
    assert.ok((await call(viewer, '/api/library')).markers[item.id].some(m => m.type === 'intro'));
    await stop(); base = await start();
    const restored = await call(head, '/api/library');
    assert.ok(restored.markers[item.id].some(m => m.type === 'outro'));
    assert.ok(!restored.markers[item.id].some(m => m.type === 'intro'));
    assert.ok((await call(viewer, '/api/library')).markers[item.id].some(m => m.type === 'intro'));
    await call(head, '/api/playback/state', { playing: true, buffering: true });
    assert.equal((await call(head, '/api/segments')).scanner.buffering, true);
  } finally {
    if (instance) await stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
