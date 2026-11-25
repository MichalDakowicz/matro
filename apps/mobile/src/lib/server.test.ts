import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates, connect, playbackPath } from '../../../../packages/core/client/server.ts';

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
  assert.deepEqual(playbackPath('id', info, 42, null, null), { path: '/api/items/id/direct', offset: 0, start: 42 });
  assert.deepEqual(playbackPath('id', info, 42, 2, 3), { path: '/api/items/id/transcode?t=42&audio=2&burn=3', offset: 42, start: 0 });
});

test('connect keeps the server own message but reports a network failure generically', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Too many requests. Try again later.' }), { status: 429 })) as typeof fetch;
  await assert.rejects(connect('matro.example.com'), { message: 'Too many requests. Try again later.', status: 429 });
  globalThis.fetch = (async () => { throw new TypeError('Network request failed'); }) as typeof fetch;
  await assert.rejects(connect('matro.example.com'), { message: "Couldn't reach a Matro server at that address." });
});
