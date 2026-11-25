import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates, playbackPath } from '../../../../packages/core/client/server.ts';

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
