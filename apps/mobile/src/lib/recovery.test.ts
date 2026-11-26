import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressRecovery } from '../../../../packages/core/client/recovery.ts';
import type { Item } from '../../../../packages/core/client/server.ts';

const movie: Item = { id: 'movie', kind: 'movie', groupId: 'movie', group: 'Movie', title: 'Movie', season: null, episode: null, format: 'MP4' };
function memory(delay = 0) {
  const disk = new Map<string, string>(), reads: string[] = [];
  const storage = {
    getItem: async (key: string) => { reads.push(key); return disk.get(key) ?? null; },
    setItem: async (key: string, value: string) => { if (delay) await new Promise(r => setTimeout(r, delay)); disk.set(key, value); },
    getAllKeys: async () => [...disk.keys()],
    removeItem: async (key: string) => { disk.delete(key); },
  };
  return { disk, reads, storage };
}

test('local progress survives a new recovery instance and merges by timestamp, including backward seeks', async () => {
  const { storage } = memory();
  const recovery = createProgressRecovery(storage), old = { position: 60, duration: 100, updated: 1 }, latest = { position: 20, duration: 100, updated: 2 };
  await recovery.write('server:alice', 'movie', latest);
  await recovery.write('server:alice', 'movie', old);
  const reopened = createProgressRecovery(storage);
  assert.deepEqual((await reopened.snapshot('server:alice', [movie], { movie: old })).progress, { movie: latest });
  assert.deepEqual((await reopened.snapshot('server:bob', [movie], {})).progress, {});
  assert.deepEqual((await reopened.snapshot('other-server:alice', [movie], {})).progress, {});
  const newer = { ...old, position: 80, updated: 3 };
  assert.deepEqual((await reopened.snapshot('server:alice', [movie], { movie: newer }, true)).progress, { movie: newer });
  assert.deepEqual((await reopened.snapshot('server:alice', [movie], {})).progress, {});
});

test('recovery ignores corrupt checkpoints and drains local writes before restoring', async () => {
  const { disk, storage } = memory(10);
  const recovery = createProgressRecovery(storage), entry = { position: 24, duration: 100, updated: 2 };
  const writing = recovery.write('account', 'movie', entry);
  assert.deepEqual((await recovery.snapshot('account', [movie], {})).progress, { movie: entry }); await writing;
  for (const key of disk.keys()) disk.set(key, '{broken');
  assert.deepEqual((await recovery.snapshot('account', [movie], {})).progress, {});
  await recovery.write('account', 'movie', { ...entry, duration: 0 });
  assert.deepEqual((await recovery.snapshot('account', [movie], {})).progress, {});
});

test('recovery migrates once, replays a separate dismissal and preserves newer unsynced playback', async () => {
  const { disk, reads, storage } = memory(), scope = 'account';
  const first = { ...movie, kind: 'show', groupId: 'show', id: 'first' };
  const second = { ...first, id: 'second' };
  const older = { position: 15, duration: 100, updated: 10 }, newer = { ...older, position: 30, updated: 30 };
  const legacy = 'matro:recovery:v1:account:first';
  disk.set(legacy, JSON.stringify(older));
  const dismissal = { id: 'first', at: 20 };
  await createProgressRecovery(storage).dismiss(scope, dismissal);
  assert.equal(disk.has(legacy), false);
  const reopened = createProgressRecovery(storage);
  reads.length = 0;
  const items = [first, second, ...Array.from({ length: 5000 }, (_, i) => ({ ...movie, id: String(i) }))];
  const restored = await reopened.snapshot(scope, items, { second: newer });
  assert.equal(reads.length, 1);
  assert.deepEqual(restored.progress, { first: { ...older, hidden: true }, second: newer });
  assert.deepEqual(restored.pending, { progress: { first: older }, dismissals: { first: dismissal } });

  await reopened.write(scope, first.id, newer);
  await reopened.confirm(scope, { first: older }, { first: { ...older, updated: 100 } }, dismissal);
  const remaining = await reopened.snapshot(scope, items, {});
  assert.deepEqual(remaining.pending, { progress: { first: newer }, dismissals: {} });
  await reopened.confirm(scope, remaining.pending.progress, { first: { ...newer, updated: 110 } });
  assert.deepEqual((await reopened.snapshot(scope, items, {})).pending, { progress: {}, dismissals: {} });
});
