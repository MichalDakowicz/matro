const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers/promises');

test('a short piece is retried, then the exact requested range is returned', async t => {
  const { fetchPiece } = await import('../packages/core/client/offline-rules.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signal = new AbortController().signal;
  const prepared = { state: 'ready', size: 3, version: 'a'.repeat(64), type: 'video/mp4' };
  const range = { start: 0, end: 2 };
  const calls = [];
  const result = fetchPiece(async (path, headers) => {
    calls.push([path, headers]);
    return new Response(calls.length === 1 ? 'ab' : 'abc', { status: 206, headers: { 'Content-Range': 'bytes 0-2/3' } });
  }, '/offline', prepared, range, signal);
  await setImmediate();
  t.mock.timers.tick(1500);
  assert.equal(Buffer.from(await result).toString(), 'abc');
  const request = ['/offline/file?version=' + prepared.version, { range: 'bytes=0-2' }];
  assert.deepEqual(calls, [request, request]);

  for (const [status, contentRange, message] of [[409, '', /prepared file changed/], [206, 'bytes 1-3/4', /invalid byte range/]]) {
    let attempts = 0;
    await assert.rejects(fetchPiece(async () => {
      attempts++;
      return new Response('abc', { status, headers: { 'Content-Range': contentRange } });
    }, '/offline', prepared, range, signal), message);
    assert.equal(attempts, 1);
  }
});

test('offline captions tolerate an outage but cancellation still stops the job', async t => {
  const { optionalCaption } = await import('../packages/core/client/offline-rules.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let calls = 0;
  const missing = optionalCaption(async () => { calls++; throw new TypeError('network'); }, controller.signal);
  await setImmediate();
  t.mock.timers.tick(1500);
  assert.equal(await missing, undefined);
  assert.equal(calls, 2);

  const cancelled = optionalCaption(() => new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
});

test('offline downloads retry 5xx answers and stop on a 4xx response', async t => {
  const { retrying } = await import('../packages/core/client/offline-rules.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signal = new AbortController().signal;
  let tries = 0;
  const result = retrying(signal, async () => { if (++tries < 2) throw Object.assign(new Error('proxy'), { status: 502 }); return 'ok'; });
  await setImmediate();
  t.mock.timers.tick(1500);
  assert.equal(await result, 'ok');
  assert.equal(tries, 2);
  tries = 0;
  const gone = Object.assign(new Error('gone'), { status: 404 });
  await assert.rejects(retrying(signal, async () => { tries++; throw gone; }), gone);
  assert.equal(tries, 1);
});

test('offline preparation tracks the best progress and times out even without a reported value', async t => {
  const { prepareDownload, RetryableDownloadError } = await import('../packages/core/client/offline-rules.js');
  const minute = 60_000;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const signal = new AbortController().signal, reports = [];
  let progress = null;
  const load = async () => ({ state: 'preparing', progress });
  const stalled = prepareDownload(signal, load, (...values) => reports.push(values));
  const rejection = assert.rejects(stalled, RetryableDownloadError);
  await setImmediate();
  progress = .5; t.mock.timers.tick(20 * minute); await setImmediate();
  progress = .4; t.mock.timers.tick(20 * minute); await setImmediate();
  progress = null; t.mock.timers.tick(10 * minute);
  await rejection;
  assert.deepEqual(reports, [[undefined, 0], [.5, 20 * minute], [.5, 20 * minute]]);

  await assert.rejects(prepareDownload(signal, load, () => {}, { advancedAt: 0 }), RetryableDownloadError);
});
