const { test } = require('node:test');
const assert = require('node:assert/strict');

test('offline downloads retry dropped connections and 5xx answers, but not refusals', async () => {
  const { retrying } = await import('../apps/web/web/offline.js');
  const { ApiError } = await import('../apps/web/web/http.js');
  const signal = new AbortController().signal;
  // The helper's backoff would make real waits slow, so only exercise the paths that don't sleep or that sleep once.
  let tries = 0;
  assert.equal(await retrying(signal, async () => { if (++tries < 2) throw new TypeError('network'); return 'ok'; }), 'ok');
  assert.equal(tries, 2);
  for (const error of [new ApiError(404, 'gone'), Object.assign(new Error('changed'), { fatal: true })]) {
    tries = 0;
    await assert.rejects(retrying(signal, async () => { tries++; throw error; }), error.constructor);
    assert.equal(tries, 1);
  }
});
