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

test('offline preparation times out after stalled progress, not elapsed download time', async () => {
  const { preparationTracker } = await import('../apps/web/web/offline.js');
  const stalled = preparationTracker(), minutes = 60 * 1000;
  assert.equal(stalled(null, 0), false);
  assert.equal(stalled(null, 45 * minutes), false);
  assert.equal(stalled(0, 46 * minutes), false);
  assert.equal(stalled(.3, 70 * minutes), false);
  assert.equal(stalled(.5, 90 * minutes), false);
  assert.equal(stalled(.4, 110 * minutes), false, 'regressions do not reset the clock');
  assert.equal(stalled(.5, 120 * minutes), true);
});

test('only an account change reloads the web app; a subtitle-limit 409 does not', async () => {
  const { api, ApiError } = await import('../apps/web/web/http.js');
  const respond = (status, body) => { globalThis.fetch = async () => new Response(JSON.stringify(body), { status }); };
  let reloads = 0;
  globalThis.location = { reload: () => { reloads++; } };
  respond(409, { error: 'This title already has the maximum number of subtitle tracks.' });
  await assert.rejects(api('PUT', '/api/state', {}, { accountId: 1 }), error => error instanceof ApiError && error.status === 409);
  assert.equal(reloads, 0);
  respond(409, { error: 'The signed-in account changed. Open Matro again.', code: 'account-changed' });
  await assert.rejects(api('PUT', '/api/state', {}, { accountId: 1 }), error => error.code === 'account-changed');
  assert.equal(reloads, 1);
  delete globalThis.location;
});
