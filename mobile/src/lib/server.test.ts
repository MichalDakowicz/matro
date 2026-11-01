import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates } from './server.ts';

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
