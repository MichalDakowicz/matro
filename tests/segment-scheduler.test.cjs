const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createSegmentScheduler, prioritizeEpisodes, mergeMarkers } = require('../electron/segment-scheduler.cjs');

async function sampleState() {
  const root = path.resolve('.test-media'); await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'scheduler-'));
  const items = [];
  for (const group of ['A', 'B']) for (let episode = 1; episode <= 3; episode++) {
    const file = path.join(dir, `${group}${episode}.mkv`); await fs.writeFile(file, group);
    items.push({ id: `${group}${episode}`, group, kind: 'show', season: 1, episode, path: file });
  }
  return { items, progress: {}, markers: {}, segmentScans: {} };
}
async function until(predicate) {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > end) throw new Error('Scheduler did not reach expected state'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

test('Continue watching and upcoming episodes lead background order; active playback takes priority', async () => {
  const state = await sampleState();
  state.progress = { A1: { position: 4, updated: 100, hidden: true }, B1: { position: 20, completed: true, updated: 20 } };
  assert.deepEqual(prioritizeEpisodes(state).map(i => i.id), ['B2', 'B3', 'B1', 'A1', 'A2', 'A3']);
  assert.deepEqual(prioritizeEpisodes(state, 'A2').slice(0, 3).map(i => i.id), ['A2', 'A3', 'A1']);
});

test('idle app prepares all quick passes first, persists markers, and reuses work after restart', async () => {
  const state = await sampleState(), calls = [];
  state.progress.B2 = { position: 3, updated: 10 };
  state.markers.B2 = [{ type: 'recap', start: 0, end: 5, source: 'manual' }];
  let writes = 0;
  const engine = { close() {}, async detect(item, siblings, update, options) {
    calls.push({ id: item.id, mode: options.mode });
    const markers = [{ type: 'intro', start: 10, end: 30, source: 'automatic' }];
    update({ stage: 'matches', markers }); return markers;
  } };
  const scanner = createSegmentScheduler({ getState: () => state, engine, persist: async () => { writes++; }, delay: 1 });
  scanner.refresh();
  try {
    await until(() => state.items.every(i => state.segmentScans[i.id]?.full));
    assert.equal(calls[0].id, 'B2');
    assert.deepEqual(calls.map(c => c.mode), [...Array(6).fill('quick'), ...Array(6).fill('full')]);
    assert.equal(state.markers.B2[0].source, 'manual'); assert.equal(state.markers.B2.length, 2);
    assert.ok(writes >= 12);
  } finally { scanner.close(); }
  const saved = JSON.parse(JSON.stringify(state)), reruns = [];
  let idle = false;
  const restarted = createSegmentScheduler({ getState: () => saved, engine: { close() {}, async detect(item) { reruns.push(item.id); return []; } }, persist: async () => {}, onUpdate: update => { if (!update.scanner.running) idle = true; }, delay: 1 });
  restarted.refresh();
  try {
    await until(() => idle); assert.deepEqual(reruns, []);
    const file = path.join(path.dirname(saved.items[0].path), 'B4.mkv'); await fs.writeFile(file, 'new');
    saved.items.push({ ...saved.items[3], id: 'B4', episode: 4, path: file }); restarted.invalidate();
    await until(() => saved.segmentScans.B4?.full);
    assert.ok(reruns.includes('B4')); assert.ok(reruns.includes('B2')); assert.ok(!reruns.includes('A1'));
  } finally { restarted.close(); }
});

test('starting playback aborts unrelated decode, scans selected episode, then resumes queue', async () => {
  const state = await sampleState(), calls = [];
  let aborted = false, blockFirst = true;
  const engine = { close() {}, async detect(item, siblings, update, options) {
    calls.push(item.id);
    if (blockFirst) {
      blockFirst = false;
      await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('interrupted'), { name: 'AbortError' })); }, { once: true }));
    }
    return [];
  } };
  const scanner = createSegmentScheduler({ getState: () => state, engine, persist: async () => {}, delay: 1 });
  scanner.refresh();
  try {
    await until(() => calls.length === 1);
    scanner.setCurrent('B2');
    await until(() => state.segmentScans.B2?.quick);
    assert.equal(aborted, true); assert.deepEqual(calls.slice(0, 2), ['A1', 'B2']);
    await until(() => state.items.every(i => state.segmentScans[i.id]?.full));
    assert.equal(state.segmentScans.A1.quick, true);
  } finally { scanner.close(); }
});

test('unavailable episodes back off without preventing other shows from being prepared', async () => {
  const state = await sampleState(), calls = [];
  const scanner = createSegmentScheduler({ getState: () => state, engine: { close() {}, async detect(item) { calls.push(item.id); if (item.group === 'A') throw new Error('Drive unavailable'); return []; } }, persist: async () => {}, delay: 1 });
  scanner.refresh();
  try {
    await until(() => ['B1', 'B2', 'B3'].every(id => state.segmentScans[id]?.full));
    assert.equal(calls.filter(id => id === 'A1').length, 1);
    assert.ok(state.segmentScans.A1.retryAt > Date.now());
  } finally { scanner.close(); }
});

test('outro matching gaps join, long breaks stay separate, manual boundaries win', () => {
  const marker = (start, end) => ({ type: 'outro', start, end, source: 'automatic' });
  assert.deepEqual(mergeMarkers([marker(1355, 1447)], [marker(1456, 1534)]), [marker(1355, 1534)]);
  assert.equal(mergeMarkers([marker(1355, 1447)], [marker(1470, 1534)]).length, 2);
  const manual = { type: 'outro', start: 1400, end: 1450, source: 'manual' };
  assert.deepEqual(mergeMarkers([manual], [marker(1355, 1447)]), [manual]);
  assert.deepEqual(mergeMarkers([], [marker(1355, 1447)], [marker(1360, 1440)]), []);
});

test('scanner keeps processing during playback with gentle resource settings', async () => {
  const state = await sampleState(), calls = [];
  const scanner = createSegmentScheduler({ getState: () => state, engine: { close() {}, async detect(item, siblings, update, options) { calls.push({ id: item.id, playback: options.playback }); return []; } }, persist: async () => {}, delay: 1 });
  scanner.setCurrent('B2'); scanner.setPlayback(true);
  try {
    await until(() => state.items.every(i => state.segmentScans[i.id]?.full));
    assert.equal(calls[0].id, 'B2'); assert.ok(calls.every(call => call.playback === true));
    assert.equal(scanner.snapshot().playback, true);
  } finally { scanner.close(); }
});

test('buffering slows scan input further while scanner continues working', async () => {
  const state = await sampleState(), calls = [];
  const scanner = createSegmentScheduler({ getState: () => state, engine: { close() {}, async detect(item, siblings, update, options) { calls.push(options); return []; } }, persist: async () => {}, delay: 1 });
  scanner.setCurrent('B2'); scanner.setPlayback(true, true);
  try {
    await until(() => state.items.every(i => state.segmentScans[i.id]?.quick));
    assert.ok(calls.every(options => options.playback && options.readRate === .5));
    assert.equal(scanner.snapshot().buffering, true);
  } finally { scanner.close(); }
});
