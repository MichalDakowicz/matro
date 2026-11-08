import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressRecovery } from '../../../../packages/core/client/recovery.ts';

test('local progress survives a new recovery instance and merges by timestamp, including backward seeks', async () => {
  const disk = new Map<string, string>();
  const storage = { getItem: async (key: string) => disk.get(key) ?? null, setItem: async (key: string, value: string) => { disk.set(key, value); } };
  const recovery = createProgressRecovery(storage), old = { position: 60, duration: 100, updated: 1 }, latest = { position: 20, duration: 100, updated: 2 };
  await recovery.write('server:alice', 'movie', latest);
  await recovery.write('server:alice', 'movie', old);
  const reopened = createProgressRecovery(storage);
  assert.deepEqual(await reopened.restore('server:alice', { movie: old }, ['movie']), { movie: latest });
  assert.deepEqual(await reopened.restore('server:bob', {}, ['movie']), {});
  assert.deepEqual(await reopened.restore('other-server:alice', {}, ['movie']), {});
  const newer = { ...old, position: 80, updated: 3 };
  assert.deepEqual(await reopened.restore('server:alice', { movie: newer }, ['movie']), { movie: newer });
});

test('recovery ignores corrupt checkpoints and drains local writes before restoring', async () => {
  const disk = new Map<string, string>();
  const storage = { getItem: async (key: string) => disk.get(key) ?? null, setItem: async (key: string, value: string) => { await new Promise(r => setTimeout(r, 10)); disk.set(key, value); } };
  const recovery = createProgressRecovery(storage), entry = { position: 24, duration: 100, updated: 2 };
  const writing = recovery.write('account', 'movie', entry);
  assert.deepEqual(await recovery.restore('account', {}, ['movie']), { movie: entry }); await writing;
  for (const key of disk.keys()) disk.set(key, '{broken');
  assert.deepEqual(await recovery.restore('account', {}, ['movie']), {});
  await recovery.write('account', 'movie', { ...entry, duration: 0 });
  assert.deepEqual(await recovery.restore('account', {}, ['movie']), {});
});
