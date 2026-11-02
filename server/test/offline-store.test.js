const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'web', 'offline-store.js')).href);
const bytes = n => new Blob([new Uint8Array(n).fill(7)]);
// Serves slices of a pretend file of `size` bytes and can be told to fail on the Nth request.
const source = (size, failAt = Infinity) => { const calls = []; return { calls, fetchRange: async (start, end) => { calls.push([start, end]); if (calls.length === failAt) throw new TypeError('network down'); return bytes(end - start + 1); } }; };

test('chunk ranges tile the file exactly', async () => {
  const { CHUNK, chunkCount, chunkRange } = await load();
  const size = CHUNK * 2 + 5;
  assert.equal(chunkCount(size), 3);
  assert.deepEqual(chunkRange(size, 0), { start: 0, end: CHUNK - 1 });
  assert.deepEqual(chunkRange(size, 2), { start: CHUNK * 2, end: size - 1 });
});

test('a download stores the file, its info and subtitles, and plays back as one blob', async () => {
  const { createStore, memoryBackend, CHUNK } = await load();
  const store = createStore(memoryBackend()), size = CHUNK + 100, src = source(size);
  const progress = [];
  const record = await store.download({ id: 'a', size, type: 'video/mp4', info: { duration: 9 }, subtitles: { 3: 'WEBVTT' }, title: 'Heat', fetchRange: src.fetchRange, onProgress: (d, t) => progress.push([d, t]) });
  assert.equal(record.complete, true);
  assert.equal(progress.at(-1)[0], size);
  const file = await store.file('a');
  assert.equal(file.size, size);
  assert.equal(file.type, 'video/mp4');
  assert.deepEqual((await store.meta('a')).subtitles, { 3: 'WEBVTT' });
  assert.deepEqual(await store.usage(), { bytes: size, titles: 1 });
});

test('a dropped connection resumes from the last stored piece', async () => {
  const { createStore, memoryBackend, CHUNK } = await load();
  const store = createStore(memoryBackend()), size = CHUNK * 3;
  const first = source(size, 3);
  await assert.rejects(store.download({ id: 'b', size, type: 'video/mp4', info: {}, fetchRange: first.fetchRange }), TypeError);
  assert.equal(await store.file('b'), null, 'a partial download is not playable');
  assert.equal((await store.usage()).titles, 0);
  assert.equal((await store.usage()).bytes, CHUNK * 2);
  const second = source(size);
  await store.download({ id: 'b', size, type: 'video/mp4', info: {}, fetchRange: second.fetchRange });
  assert.equal(second.calls.length, 1, 'only the missing piece is requested');
  assert.equal((await store.file('b')).size, size);
});

test('a file that changed on the server starts over, and an abort keeps progress', async () => {
  const { createStore, memoryBackend, CHUNK } = await load();
  const store = createStore(memoryBackend());
  await store.download({ id: 'c', size: CHUNK, type: 'video/mp4', info: {}, fetchRange: source(CHUNK).fetchRange });
  const next = source(CHUNK + 1);
  await store.download({ id: 'c', size: CHUNK + 1, type: 'video/mp4', info: {}, fetchRange: next.fetchRange });
  assert.equal(next.calls.length, 2, 'a different size means a different file');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(store.download({ id: 'd', size: CHUNK * 2, type: 'video/mp4', info: {}, fetchRange: source(1).fetchRange, signal: controller.signal }), { name: 'AbortError' });
  assert.equal((await store.list()).length, 2);
});

test('removing a title frees every piece', async () => {
  const { createStore, memoryBackend, CHUNK } = await load();
  const backend = memoryBackend(), store = createStore(backend);
  await store.download({ id: 'e', size: CHUNK * 2, type: 'video/mp4', info: {}, fetchRange: source(1).fetchRange });
  await store.remove('e');
  assert.deepEqual(await backend.keys(''), []);
  assert.deepEqual(await store.usage(), { bytes: 0, titles: 0 });
});
