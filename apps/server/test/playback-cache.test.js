const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAssetCache } = require('../../../packages/core/server/asset-cache');
const { createPlaybackActivity, playbackSession } = require('../../../packages/core/server/playback-session');

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
