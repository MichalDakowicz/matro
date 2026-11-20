const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../../../packages/core/server');

test('an in-flight legacy playback save cannot revive a removed manual marker', { timeout: 10000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-manual-markers-'));
  const intro = { type: 'intro', start: 1, end: 3, source: 'manual' };
  const detectedIntro = { ...intro, source: 'automatic' };
  await fs.writeFile(path.join(root, 'segments.json'), JSON.stringify({ markers: { first: [detectedIntro] } }));
  const { app, server, db } = createApp({ dataDir: root, tmdb: { env: {} } });
  t.mock.method(app.scanner, 'request', async () => {});
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const user = await app.createUser('viewer', 'manual-markers-test', 'viewer');
  db.prepare('INSERT INTO folders (id, path, added) VALUES (1, ?, 0)').run(root);
  const insert = db.prepare("INSERT INTO items (id, folder_id, path, title, group_id, group_title, kind, season, episode, size, mtime, added) VALUES (?, 1, ?, ?, 'show', 'Test Show', 'show', 1, ?, 0, 0, 0)");
  insert.run('first', path.join(root, 'S01E01.mkv'), 'Test Show, episode 1', 1);
  insert.run('second', path.join(root, 'S01E02.mkv'), 'Test Show, episode 2', 2);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-matro': '1', 'content-type': 'application/json' };
  const login = await fetch(base + '/api/login', { method: 'POST', headers, body: JSON.stringify({ username: 'viewer', password: 'manual-markers-test' }) });
  assert.equal(login.status, 200);
  headers.cookie = login.headers.get('set-cookie').split(';')[0];
  const send = async (method, route, body) => {
    const response = await fetch(base + route, { method, headers, body: JSON.stringify(body) });
    assert.equal(response.status, 200, route);
    return response.json();
  };
  const saved = () => JSON.parse(db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(user).data);
  const outro = { type: 'outro', start: 71, end: 79, source: 'manual' };
  const recap = { type: 'recap', start: 8, end: 12, source: 'manual' };
  const saveManual = (changes, replaceType = false) => send('POST', '/api/segments/manual', { changes, replaceType });
  await saveManual([{ id: 'first', markers: [intro, outro] }, { id: 'second', markers: [intro] }]);
  const progress = { position: 27, duration: 90, completed: false, updated: Date.now() };
  const stale = JSON.stringify({
    progress: { first: progress },
    markers: { first: [intro, { ...outro, start: 66, end: 69 }, recap] }
  });
  // Send the stale snapshot first, then hold the final byte so the state
  // handler cannot apply it until the explicit removal has committed.
  const started = new Promise(resolve => server.prependOnceListener('request', req => req.once('data', resolve)));
  let held;
  const finished = new Promise(resolve => {
    held = http.request(base + '/api/state', { method: 'PUT', headers: { ...headers, 'content-length': Buffer.byteLength(stale) } }, response => {
      response.resume().once('end', () => resolve(response.statusCode));
    });
    held.once('error', resolve);
  });
  held.write(stale.slice(0, -1));
  try {
    await Promise.race([started, finished.then(status => { assert.fail(`Stale save completed early: ${status}`); })]);
    const removed = await send('POST', '/api/items/first/segments/remove', { marker: intro });
    assert.deepEqual(removed.markers, [outro]);
    const rescanned = await send('POST', '/api/items/first/segments', { force: true });
    assert.deepEqual(rescanned.markers, [detectedIntro, outro]);
  } finally {
    held.end(stale.slice(-1));
  }
  assert.equal(await finished, 200);
  assert.deepEqual(saved().progress.first, progress);
  assert.deepEqual(saved().markers, { first: [outro, recap], second: [intro] });

  const removedAgain = await send('POST', '/api/items/first/segments/remove', { marker: detectedIntro });
  assert.deepEqual(removedAgain.markers, [recap, outro]);
  assert.deepEqual((await send('POST', '/api/items/first/segments', { force: true })).markers, [detectedIntro, recap, outro]);
  const restored = await saveManual([{ id: 'first', markers: [intro] }]);
  assert.deepEqual(restored.markers.first, [intro, recap, outro]);
  const adjusted = { ...intro, start: 4, end: 6 };
  await saveManual([{ id: 'first', markers: [adjusted] }], true);
  assert.deepEqual(saved().markers, { first: [outro, recap, adjusted], second: [intro] });
});
