const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');
const { createAssetCache } = require('../../../packages/core/server/asset-cache');
const { createPlaybackActivity, playbackSession } = require('../../../packages/core/server/playback-session');
const playbackCache = require('../../../packages/core/playback/cache.cjs');

test('scanner activity expires independently, and heartbeats renew a player lease', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const ctx = { user: { id: 1 }, token: 'first-login' };
  const first = playbackSession(ctx, 'phone'), second = playbackSession(ctx, 'tv');
  assert.notEqual(first, second);
  assert.notEqual(playbackSession(ctx), playbackSession({ ...ctx, token: 'other-login' }));
  let status;
  const activity = createPlaybackActivity((playing, buffering) => { status = { playing, buffering }; }, 100);
  t.after(() => activity.close());
  activity.set(first, true, true);
  activity.set(second, true);
  t.mock.timers.tick(50);
  activity.set(second, true);
  assert.deepEqual(status, { playing: true, buffering: true });
  t.mock.timers.tick(50);
  assert.deepEqual(status, { playing: true, buffering: false });
  t.mock.timers.tick(50);
  assert.deepEqual(status, { playing: false, buffering: false });
});

test('activity without a session id outlives the lease until it reports idle', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  let status;
  const activity = createPlaybackActivity((playing, buffering) => { status = { playing, buffering }; }, 100);
  t.after(() => activity.close());
  const old = playbackSession({ user: { id: 1 }, token: 'old-apk' }, null);
  activity.set(old, true, false, true);
  t.mock.timers.tick(10000);
  assert.deepEqual(status, { playing: true, buffering: false });
  activity.set(old, false);
  assert.deepEqual(status, { playing: false, buffering: false });
});

test('stopping a playback session releases only its own unfinished transcode', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-session-stop-'));
  const file = path.join(dataDir, 'film.mp4');
  await fs.writeFile(file, '');
  const children = [], requests = [];
  const { createPlaybackCache } = playbackCache;
  t.mock.method(playbackCache, 'createPlaybackCache', options => {
    const cache = createPlaybackCache({
      ...options, maxJobs: 2,
      spawnProcess() {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.finish = (code, bytes) => {
          child.stdout.end(bytes);
          child.emit('close', code);
        };
        child.kill = t.mock.fn(() => child.finish(1));
        children.push(child);
        return child;
      },
    });
    const serve = cache.serve;
    cache.serve = (...args) => {
      const request = serve(...args);
      requests.push(request);
      return request;
    };
    return cache;
  });
  const { createApp } = require('../../../packages/core/server');
  const { app, server, db, library } = createApp({ dataDir, tmdb: { env: {} } });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await Promise.allSettled(requests);
    db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  t.mock.method(library, 'item', () => ({ path: file }));
  t.mock.method(library, 'info', async () => ({ video: { codec: 'h264' }, duration: 60, audio: [{ index: 0 }], subtitles: [] }));
  const account = await app.createUser('viewer', 'test-password', 'admin');
  const headers = { cookie: `matro_session=${app.auth.create(account)}` };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const transcode = (query, signal) => fetch(base + '/api/items/film/transcode?' + query, { headers, signal });
  const stop = session => fetch(base + '/api/playback/stop', { method: 'POST',
    headers: { ...headers, 'x-matro': '1', 'content-type': 'application/json' }, body: JSON.stringify({ session }),
  });
  async function start(query, expected) {
    const controller = new AbortController();
    const request = transcode(query, controller.signal);
    void request.catch(() => {});
    for (let attempt = 0; children.length < expected && attempt < 200; attempt++) await delay(10);
    assert.equal(children.length, expected);
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    await requests[expected - 1]; // The cache now has an owner but no active HTTP reader.
  }

  await start('session=first-player', 1);
  await start('session=second-player&audio=0', 2);
  const [first, second] = children;
  assert.equal((await stop('first-player')).status, 200);
  assert.equal(first.kill.mock.callCount(), 1);
  assert.equal(second.kill.mock.callCount(), 0);

  second.finish(0, 'second transcode');
  const resumed = await transcode('session=second-player&audio=0', AbortSignal.timeout(3000));
  assert.equal(resumed.status, 200);
  assert.equal(await resumed.text(), 'second transcode');
  assert.equal(children.length, 2, 'the second session reused its original transcode');
});

test('frames and embedded subtitles share an access-ordered disk budget', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-assets-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let now = Date.now();
  t.mock.method(Date, 'now', () => now++);
  const cache = createAssetCache(dir, { maxBytes: 8 });
  await cache.write('frames', 'old.jpg', Buffer.from('jpeg'));
  await cache.write('subs', 'cold.vtt', 'text');
  assert.equal((await cache.read('frames', 'old.jpg')).toString(), 'jpeg');
  await cache.write('frames', 'new.jpg', Buffer.from('more'));
  assert.equal(await cache.read('subs', 'cold.vtt', 'utf8'), null);
  await fs.access(path.join(dir, 'cache', 'frames', 'old.jpg'));
  await fs.access(path.join(dir, 'cache', 'frames', 'new.jpg'));
});
