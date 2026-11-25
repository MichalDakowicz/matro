import test from 'node:test';
import assert from 'node:assert/strict';
import { accountChanged, candidates, playbackPath, ServerError } from '../../../../packages/core/client/server.ts';

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

test('only a 401 or an account-changed 409 signs the phone out', () => {
  assert.equal(accountChanged(new ServerError('Sign in first.', 401)), true);
  assert.equal(accountChanged(new ServerError('The signed-in account changed.', 409, 'account-changed')), true);
  assert.equal(accountChanged(new ServerError('This title already has the maximum number of subtitle tracks.', 409)), false);
  assert.equal(accountChanged(new Error('offline')), false);
});
