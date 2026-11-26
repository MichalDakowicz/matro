import test from 'node:test';
import assert from 'node:assert/strict';
import { activeOfflineAccountKey, migrateOfflineAccount, offlineAccount, offlineLibraryKey, offlineMediaPrefix } from './offline-storage.ts';

test('native migrates legacy offline metadata and recovery only after the server confirms the account', async () => {
  const base = 'https://matro.example:8484';
  const identity = { id: 7, username: 'viewer', role: 'viewer' };
  const user = { ...identity, accountKey: 'original', legacyScope: true } as const;
  const replacement = { ...identity, accountKey: 'replacement' };
  const from = encodeURIComponent(base + ':account:7:viewer'), to = offlineAccount(base, user);
  const active = activeOfflineAccountKey(base);
  const saved = JSON.stringify({ id: 'clip', uri: 'file:///documents/legacy/clip.mp4', complete: true });
  const progress = JSON.stringify({ position: 25, duration: 100, updated: 42 });
  const old = [
    [active, from],
    [offlineLibraryKey(from), JSON.stringify({ user: identity, items: [{ id: 'clip' }] })],
    [offlineMediaPrefix(from) + 'clip', saved],
    [offlineMediaPrefix(from) + 'newer', 'old record'],
    [`matro:recovery:v1:${from}:clip`, progress],
    [offlineMediaPrefix(to) + 'newer', 'new record']
  ] as const;
  const disk = new Map<string, string>(old);
  let writingFails = true;
  const store = {
    getAllKeys: async () => [...disk.keys()],
    multiGet: async (keys: string[]) => keys.map(key => [key, disk.get(key) ?? null] as const),
    multiSet: async (entries: [string, string][]) => {
      const partial = writingFails ? entries.slice(0, 1) : entries;
      for (const [key, value] of partial) disk.set(key, value);
      if (writingFails) throw new Error('Write failed');
    },
    multiRemove: async (keys: string[]) => { for (const key of keys) disk.delete(key); }
  };

  await migrateOfflineAccount(store, base, replacement);
  assert.deepEqual([...disk], old);
  await assert.rejects(migrateOfflineAccount(store, base, user), /Write failed/);
  for (const [key, value] of old) assert.equal(disk.get(key), value);

  writingFails = false;
  await migrateOfflineAccount(store, base, user);
  await migrateOfflineAccount(store, base, user);
  assert.equal(disk.get(active), to);
  assert.deepEqual(JSON.parse(disk.get(offlineLibraryKey(to))!), { user, items: [{ id: 'clip' }] });
  assert.equal(disk.get(offlineMediaPrefix(to) + 'clip'), saved);
  assert.equal(disk.get(offlineMediaPrefix(to) + 'newer'), 'new record');
  assert.equal(disk.get(`matro:recovery:v1:${to}:clip`), progress);
  assert.equal([...disk.keys()].some(key => key.includes(from)), false);
});
