import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import * as client from '../../../../packages/core/client/server.ts';
import * as offlineStorage from './offline-storage.ts';

const ts = createRequire(import.meta.url)('typescript');
const transpile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const offlineCode = transpile('./offline.ts'), bufferCode = transpile('../player/diskBuffer.ts');

const base = 'http://test.invalid', user = { id: 1, username: 'viewer', role: 'viewer' };
const prepared = { state: 'ready', version: 'a'.repeat(64), size: 3, type: 'video/mp4' };
const media = () => new Response(new Uint8Array(3), { status: 206, headers: { 'content-range': 'bytes 0-2/3' } });
const items = (...ids: string[]) => ids.map(id => ({ id, title: id, kind: 'show', groupId: 'show', group: 'Show', season: 1, episode: 1, format: 'MP4' }));
const nameOf = (item: { title: string }) => item.title;
const never = () => new Promise<never>(() => {});

function setup(entries = new Map<string, string>(), files = new Map<string, number>()) {
  const fixture = {
    holds: 0, free: Infinity, failWrite: false, maxFileSize: 0,
    info: { duration: 5, directPlay: true, audio: [], uploaded: [], embedded: [] as { index: number; text: boolean }[] },
    fetch: async (_: string, _init: RequestInit) => media(),
    request: async (_: string, _init?: { signal?: AbortSignal }) => prepared as { state: string; progress?: number },
    storage: {
      getAllKeys: async () => [...entries.keys()],
      getItem: async (key: string) => entries.get(key) ?? null,
      setItem: async (key: string, value: string) => { entries.set(key, value); },
      removeItem: async (key: string) => { entries.delete(key); },
      multiGet: async (keys: string[]) => keys.map(key => [key, entries.get(key)]),
      multiSet: async (pairs: [string, string][]) => { for (const [key, value] of pairs) entries.set(key, value); },
    },
    Directory: class {
      uri: string;
      constructor(dir: string | { uri: string }, ...parts: string[]) { this.uri = [typeof dir === 'string' ? dir : dir.uri, ...parts].join('/'); }
      create() {}
      list() { return [...files.keys()].filter(uri => uri.startsWith(this.uri + '/')).map(uri => new fixture.File(uri)); }
    },
    File: class {
      uri: string;
      constructor(dir: string | { uri: string }, name?: string) { this.uri = typeof dir === 'string' ? dir : dir.uri + '/' + name; }
      get name() { return this.uri.split('/').pop(); }
      get exists() { return files.has(this.uri); }
      get size() { return files.get(this.uri) ?? 0; }
      create() { files.set(this.uri, 0); }
      delete() { files.delete(this.uri); }
      open() {
        const file = this;
        return { offset: 0, close() {}, writeBytes(bytes: Uint8Array) {
          if (fixture.failWrite) throw new Error('write failed: ENOSPC (No space left on device)');
          this.offset += bytes.byteLength;
          const size = Math.max(file.size, this.offset);
          files.set(file.uri, size);
          fixture.maxFileSize = Math.max(fixture.maxFileSize, size);
        } };
      }
    },
    Paths: { document: '/documents', cache: { list: () => new fixture.Directory('/cache').list(), uri: '/cache' }, get availableDiskSpace() { return fixture.free; } },
  };
  const modules: Record<string, unknown> = {
    '@react-native-async-storage/async-storage': fixture.storage,
    'expo-file-system': fixture,
    'expo/fetch': { fetch: (...args: Parameters<typeof fixture.fetch>) => fixture.fetch(...args) },
    './offline-storage': offlineStorage,
    './storage': { recoveryScope: offlineStorage.recoveryScope, progressRecovery: { snapshot: async (_: string, _items: unknown, progress: unknown) => ({ progress }) } },
    './offline-notifications': {
      holdService() { fixture.holds++; return () => { fixture.holds--; }; },
      offlineNotice: () => ({ preparing() {}, progress() {}, done() {}, failed() {}, dismiss() {} }),
    },
    './server': {
      ...client, request: (_: string, path: string, init: { signal?: AbortSignal }) => fixture.request(path, init),
      inspect: async () => fixture.info,
    },
  };
  const load = <T>(code: string) => {
    const context = { exports: {}, require: (name: string) => { assert.ok(modules[name], name); return modules[name]; },
      setTimeout, clearTimeout, AbortController, Date, Error, Uint8Array,
    };
    vm.runInNewContext(code, context);
    return context.exports as T;
  };
  const offline = load<typeof import('./offline.ts')>(offlineCode);
  const buffer = () => load<typeof import('../player/diskBuffer.ts')>(bufferCode);
  const records = () => offline.savedTitles(base, user);
  return { fixture, entries, files, offline, buffer, records };
}

async function until(condition: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await condition()) return;
    await setImmediate();
  }
  assert.fail('Download did not reach the expected state');
}

test('relaunch restores queued and preparing records and respects a pause', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = setup(), { offline, fixture, records } = first;
  fixture.request = (_, { signal } = {}) => new Promise((_, reject) => {
    signal!.addEventListener('abort', () => reject(new Error('Cancelled.')));
  });
  const season = items('one', 'two', 'three', 'four');
  await offline.saveOfflineBatch(base, user, season, nameOf);
  await offline.pauseOffline(base, user, 'two');
  await until(async () => (await records()).filter(record => record.state === 'preparing' && !record.paused).length === 2);
  assert.equal((await records()).find(record => record.id === 'four')?.state, 'queued');
  assert.equal(fixture.holds, 1);
  const persisted = new Map(first.entries);
  for (const id of ['four', 'two', 'three', 'one']) await offline.removeOffline(base, user, id);
  assert.equal(fixture.holds, 0);

  const next = setup(persisted);
  await next.offline.resumeInterrupted(base, user);
  await until(async () => (await next.records()).filter(record => record.complete).length === 3 && !next.fixture.holds);
  assert.ok((await next.records()).find(record => record.id === 'two')?.paused);
  assert.ok(await next.offline.savedTitle(base, user, 'four'));
  const saved = (await next.offline.savedTitle(base, user, 'one'))!;
  next.files.set(saved.uri, saved.size - 1);
  assert.equal(await next.offline.savedTitle(base, user, 'one'), undefined);
});

test('a stalled caption and a 502 or stalled range retry before completing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { offline, fixture, records } = setup();
  fixture.info.embedded = [{ index: 1, text: true }];
  let captions = 0, ranges = 0;
  const signals: AbortSignal[] = [];
  fixture.fetch = async (url, { signal }) => {
    signals.push(signal!);
    if (url.includes('/subtitles/')) return ++captions === 1 ? never() : new Response('WEBVTT');
    if (++ranges === 1) return new Response(null, { status: 502 });
    if (ranges === 2) {
      return new Response(new ReadableStream({ pull: never }), { status: 206, headers: { 'content-range': 'bytes 0-2/3' } });
    }
    return media();
  };
  await offline.saveOffline(base, user, items('one')[0], 'One');
  await until(() => captions === 1);
  t.mock.timers.tick(15000);
  await setImmediate();
  assert.ok(signals[0].aborted);
  t.mock.timers.tick(1500);
  await until(() => ranges === 1);
  await setImmediate();
  t.mock.timers.tick(1500);
  await until(() => ranges === 2);
  await setImmediate();
  t.mock.timers.tick(30000);
  await setImmediate();
  assert.ok(signals[3].aborted);
  t.mock.timers.tick(3000);
  await until(async () => (await records())[0]?.complete === true);
  assert.equal((await offline.savedTitle(base, user, 'one'))?.text[1], 'WEBVTT');
  assert.equal(ranges, 3);
});

test('after a connection outage and relaunch, a download resumes at its last complete range', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const first = setup(), { offline, fixture, records } = first;
  const piece = 8 * 1024 * 1024, size = piece + 3;
  fixture.request = async () => ({ ...prepared, size });
  let failedRanges = 0;
  fixture.fetch = async (_, init) => {
    if ((init.headers as Record<string, string>).range === `bytes=0-${piece - 1}`) {
      return new Response(new Uint8Array(piece), { status: 206, headers: { 'content-range': `bytes 0-${piece - 1}/${size}` } });
    }
    failedRanges++;
    return new Response(null, { status: 503 });
  };
  await offline.saveOffline(base, user, items('one')[0], 'One');
  await until(async () => (await records())[0]?.have === piece && failedRanges === 1);
  for (const delay of [1500, 3000, 6000, 12000, 24000, 30000]) {
    const expected = failedRanges + 1;
    await setImmediate();
    t.mock.timers.tick(delay);
    await until(() => failedRanges === expected);
  }
  await until(async () => /503/.test((await records())[0]?.error ?? ''));
  const [waiting] = await records();
  assert.equal(waiting.paused, false);
  assert.equal(fixture.holds, 1); // The service stays up for the retry.

  const next = setup(new Map(first.entries), new Map(first.files));
  next.fixture.request = async () => ({ ...prepared, size });
  next.fixture.fetch = async (_, init) => {
    assert.equal((init.headers as Record<string, string>).range, `bytes=${piece}-${size - 1}`);
    return new Response(new Uint8Array(3), { status: 206, headers: { 'content-range': `bytes ${piece}-${size - 1}/${size}` } });
  };
  await next.offline.resumeInterrupted(base, user);
  assert.equal(next.offline.activeDownloads(base, user).length, 0);
  t.mock.timers.tick(30000);
  await next.offline.retryInterrupted(base, user);
  await until(async () => (await next.records())[0]?.complete === true);
  assert.equal((await next.offline.savedTitle(base, user, 'one'))?.size, size);
});

test('preparation can exceed 30 minutes while advancing and a stalled record retries on reconnect', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const { offline, fixture, records } = setup();
  let progress = 0.2;
  fixture.request = async () => ({ state: 'preparing', progress });
  await offline.saveOffline(base, user, items('one')[0], 'One');
  await until(async () => (await records())[0]?.prepared === 0.2);
  await setImmediate();
  progress = 0.3;
  t.mock.timers.tick(31 * 60 * 1000);
  await until(async () => (await records())[0]?.prepared === 0.3);
  assert.equal(offline.activeDownloads(base, user).length, 1);
  await setImmediate();
  t.mock.timers.tick(31 * 60 * 1000);
  await until(async () => !!(await records())[0]?.error);
  const [stalled] = await records();
  assert.equal(stalled.state, 'preparing');
  assert.match(stalled.error!, /not advanced/);
  fixture.request = async () => prepared;
  assert.equal(fixture.holds, 1);
  t.mock.timers.tick(30000); // The retry timer fires without any foreground poll.
  await until(async () => (await records())[0]?.complete === true && !fixture.holds);
});

test('version conflicts and disk-full failures retain a reason and require manual resume', async () => {
  const { offline, fixture, records } = setup();
  const item = items('one')[0];
  let ranges = 0;
  fixture.fetch = async () => { ranges++; return new Response(null, { status: 409 }); };
  await offline.saveOffline(base, user, item, item.title);
  await until(() => !fixture.holds);
  assert.match((await records())[0].error!, /prepared file changed/);
  assert.equal(ranges, 1);
  await offline.resumeInterrupted(base, user);
  assert.equal(offline.activeDownloads(base, user).length, 0);

  fixture.free = 2;
  await offline.saveOffline(base, user, item, item.title);
  await until(() => !fixture.holds);
  assert.match((await records())[0].error!, /Not enough storage/);
  assert.equal(ranges, 1);

  fixture.free = 100;
  fixture.failWrite = true;
  fixture.fetch = async () => media();
  await offline.saveOffline(base, user, item, item.title);
  await until(() => !fixture.holds);
  const [failed] = await records();
  assert.match(failed.error!, /Not enough storage/);
  assert.ok(failed.paused && failed.uri);
  await offline.resumeInterrupted(base, user);
  assert.equal(offline.activeDownloads(base, user).length, 0);

  fixture.failWrite = false;
  await offline.saveOffline(base, user, item, item.title);
  await until(async () => (await records())[0]?.complete === true);
  assert.equal((await records())[0].error, undefined);
});

test('temporary playback files are swept and a large chunked transcode is discarded at the cap', async () => {
  const { fixture, files, buffer } = setup();
  const { clearPlaybackCache, downloadPlayback } = buffer();
  files.set('/cache/matro-playback-old.mp4', 30);
  files.set('/cache/artwork.jpg', 10);
  clearPlaybackCache();
  assert.deepEqual([...files.keys()], ['/cache/artwork.jpg']);

  const chunk = { byteLength: 96 * 1024 * 1024 };
  let reads = 0, signal: AbortSignal | undefined;
  fixture.fetch = async (_, init) => {
    signal = init.signal!;
    return new Response(new ReadableStream({
      pull(controller) { if (++reads < 4) controller.enqueue(chunk); else controller.close(); },
    }));
  };
  let ready = false;
  downloadPlayback(base + '/transcode', {}, () => { ready = true; });
  await until(() => Boolean(signal?.aborted) && files.size === 1);
  assert.equal(ready, false);
  assert.equal(fixture.maxFileSize, chunk.byteLength * 2);
});
