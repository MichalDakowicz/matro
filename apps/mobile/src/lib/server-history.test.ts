import test from 'node:test';
import assert from 'node:assert/strict';
import { forgetFromHistory, rememberServer, serverHost } from './server-history.ts';

test('latest server moves to the front without duplicates', () => {
  assert.deepEqual(rememberServer(['https://a.example', 'http://10.0.0.2:8484'], 'http://10.0.0.2:8484'), ['http://10.0.0.2:8484', 'https://a.example']);
});
test('history keeps five entries', () => {
  const list = ['1', '2', '3', '4', '5'].map(n => `https://${n}.example`);
  assert.equal(rememberServer(list, 'https://6.example').length, 5);
  assert.equal(rememberServer(list, 'https://6.example').at(-1), 'https://4.example');
});
test('forget and host label', () => {
  assert.deepEqual(forgetFromHistory(['a', 'b'], 'a'), ['b']);
  assert.equal(serverHost('http://192.168.1.5:8484'), '192.168.1.5:8484');
});
