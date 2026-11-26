import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { accountChanged, candidates, connect, fetchWithDeadline, playbackPath, ServerError } from '../../../../packages/core/client/server.ts';

test('public hostnames try https first', () => {
  assert.deepEqual(candidates('matro.dakowicz.xyz/'), ['https://matro.dakowicz.xyz', 'http://matro.dakowicz.xyz']);
});
test('LAN addresses try http first', () => {
  assert.deepEqual(candidates(' 192.168.100.6:8484 '), ['http://192.168.100.6:8484', 'https://192.168.100.6:8484']);
});
test('explicit scheme is kept', () => {
  assert.deepEqual(candidates('http://matro.local:8484//'), ['http://matro.local:8484']);
});
test('empty input', () => assert.deepEqual(candidates('  '), []));

test('native direct play resumes on the original timeline; transcoding uses relative time and selected tracks', () => {
  const info = { duration: 100, directPlay: true, audio: [{ index: 1, language: 'en', title: '' }], embedded: [], uploaded: [] };
  assert.deepEqual(playbackPath('id', info, { position: 42 }), { path: '/api/items/id/direct', offset: 0, start: 42 });
  assert.deepEqual(playbackPath('id', info, { position: 42, audio: 2, burn: 3 }), { path: '/api/items/id/transcode?t=42&audio=2&burn=3', offset: 42, start: 0 });
  assert.deepEqual(playbackPath('id', info, { position: 42, session: 'native' }), { path: '/api/items/id/direct?session=native', offset: 0, start: 42 });
  assert.deepEqual(playbackPath('id', info, { position: 0, audioDelay: -0.4 }), { path: '/api/items/id/transcode?t=0&adelay=-0.4', offset: 0, start: 0 });
  assert.deepEqual(playbackPath('id', { ...info, video: { codec: 'h264', width: 1920, height: 1080 } }, { position: 42, session: 'native', quality: '720p', audioDelay: 0.2 }), { path: '/api/items/id/transcode?session=native&t=42&quality=720p&adelay=0.2', offset: 42, start: 0 });
  assert.deepEqual(playbackPath('id', info, { position: 42, session: 'native', audio: 2, burn: 3, subtitleDelay: 1 }), { path: '/api/items/id/transcode?session=native&t=42&audio=2&burn=3&delay=1', offset: 42, start: 0 });
});

test('the body deadline is an idle limit: steady progress outlives it and a stall does not', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const slow = fetchWithDeadline(async () => 'response', async (_, touch) => {
    for (let chunk = 0; chunk < 4; chunk++) { await pause(20000); touch(); }
    return 'done';
  }, { bodyMs: 30000 });
  for (let chunk = 0; chunk < 4; chunk++) { await setImmediate(); t.mock.timers.tick(20000); }
  assert.equal(await slow, 'done');
  const stalled = fetchWithDeadline(async () => 'response', () => new Promise<never>(() => {}), { bodyMs: 30000 });
  await setImmediate();
  t.mock.timers.tick(30000);
  await assert.rejects(stalled, /took too long to send/);
});

test('only a 401 or an account-changed 409 signs the phone out', () => {
  assert.equal(accountChanged(new ServerError('Sign in first.', 401)), true);
  assert.equal(accountChanged(new ServerError('The signed-in account changed.', 409, 'account-changed')), true);
  assert.equal(accountChanged(new ServerError('This title already has the maximum number of subtitle tracks.', 409)), false);
  assert.equal(accountChanged(new Error('offline')), false);
});

test('connect keeps the server own message but reports a network failure generically', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Too many requests. Try again later.' }), { status: 429 })) as typeof fetch;
  await assert.rejects(connect('matro.example.com'), { message: 'Too many requests. Try again later.', status: 429 });
  globalThis.fetch = (async () => { throw new TypeError('Network request failed'); }) as typeof fetch;
  await assert.rejects(connect('matro.example.com'), { message: "Couldn't reach a Matro server at that address." });
});
