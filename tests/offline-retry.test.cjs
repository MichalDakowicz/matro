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

test('offline captions skip only missing tracks and retry network and server outages six times', async t => {
  const { optionalCaption, RetryableDownloadError } = await import('../packages/core/client/offline-rules.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  for (const status of [404, 410]) {
    assert.equal(await optionalCaption(async () => new Response(null, { status }), controller.signal), undefined);
  }
  for (const status of [401, 403]) {
    await assert.rejects(optionalCaption(async () => new Response(null, { status }), controller.signal), { status });
  }
  let calls = 0;
  const caption = optionalCaption(async () => {
    if (++calls === 1) throw new TypeError('network');
    return new Response(null, { status: 503 });
  }, controller.signal);
  const outage = assert.rejects(caption, error => error instanceof RetryableDownloadError && /HTTP 503/.test(error.message));
  for (const delay of [1500, 3000, 6000, 12000, 24000, 30000]) {
    await setImmediate();
    t.mock.timers.tick(delay);
  }
  await outage;
  assert.equal(calls, 7);
});

test('cancellation still stops an optional caption download', async () => {
  const { optionalCaption } = await import('../packages/core/client/offline-rules.js');
  const controller = new AbortController();
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

test('offline preparation advances again after a server restart lowers progress', async t => {
  const { prepareDownload, RetryableDownloadError } = await import('../packages/core/client/offline-rules.js');
  const minute = 60_000;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const signal = new AbortController().signal, reports = [];
  let progress = .8;
  const load = async () => ({ state: 'preparing', progress });
  const stalled = prepareDownload(signal, load, (...values) => reports.push(values));
  const rejection = assert.rejects(stalled, RetryableDownloadError);
  await setImmediate();
  progress = .1; t.mock.timers.tick(15 * minute); await setImmediate();
  progress = .2; t.mock.timers.tick(16 * minute); await setImmediate();
  t.mock.timers.tick(30 * minute);
  await rejection;
  assert.deepEqual(reports, [[.8, 0], [.1, 0], [.2, 31 * minute], [.2, 31 * minute]]);
});

test('web preparation reports unknown progress without a stall error', async t => {
  const { prepareDownload, RetryableDownloadError } = await import('../packages/core/client/offline-rules.js');
  const minute = 60_000;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const signal = new AbortController().signal, reports = [];
  const prepared = { state: 'ready', size: 3, version: 'a'.repeat(64), type: 'video/mp4' };
  let status = { state: 'preparing', progress: null };
  const load = async () => status;
  const result = prepareDownload(signal, load, progress => reports.push(progress), { stallWithoutProgress: false });
  await setImmediate();
  status = { state: 'preparing', progress: 'unknown' };
  t.mock.timers.tick(31 * minute); await setImmediate();
  await assert.rejects(prepareDownload(signal, load, () => {}, { advancedAt: 0 }), RetryableDownloadError);
  status = prepared;
  t.mock.timers.tick(2000);
  assert.deepEqual(await result, prepared);
  assert.deepEqual(reports, [undefined, undefined]);
});
