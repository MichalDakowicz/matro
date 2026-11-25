import test from 'node:test';
import assert from 'node:assert/strict';
import { batchesOf, planSmart, NO_SMART, type Held, type SmartSettings } from './smart-plan.ts';
import type { Item } from '../../../../packages/core/client/server.ts';

const show = (items: Item[]) => ({ show: items.slice().sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)) });

const GB = 1024 ** 3;
const episode = (number: number, show = 'show'): Item => ({ id: `${show}-${number}`, title: `E${number}`, groupId: show, group: show, kind: 'show', season: 1, episode: number, format: 'MKV' });
const items = [3, 1, 5, 2, 4, 6].map(number => episode(number)), done = (...ids: string[]) => Object.fromEntries(ids.map(id => [id, { position: 1, duration: 1, completed: true, updated: 1 }]));
const keep = (count: number, removeWatched = false, capBytes: number | null = null): SmartSettings => ({ rules: { show: { keep: count, removeWatched } }, capBytes });
const held = (id: string, gb = 1, complete = true): Held => ({ id, bytes: gb * GB, complete });
const ids = (list: Item[]) => list.map(item => item.id);

test('nothing is saved or removed without a rule', () => {
  assert.deepEqual(planSmart({ shows: show(items), progress: done('show-1'), settings: NO_SMART, held: [held('show-1')] }), { save: [], remove: [], capped: 0 });
});
test('keeps the next unwatched episodes in order and skips watched and already saved ones', () => {
  const plan = planSmart({ shows: show(items), progress: done('show-1'), settings: keep(3), held: [held('show-3')] });
  assert.deepEqual(ids(plan.save), ['show-2', 'show-4']);
  assert.deepEqual(plan.remove, []);
});
test('watched episodes go only when the rule says so, and unwatched ones never do', () => {
  const state = { shows: show(items), progress: done('show-1', 'show-2'), held: [held('show-1'), held('show-2'), held('show-5')] };
  assert.deepEqual(planSmart({ ...state, settings: keep(2, false) }).remove, []);
  assert.deepEqual(planSmart({ ...state, settings: keep(2, true) }).remove, ['show-1', 'show-2']);
});
test('a paused or failed record is not saved again', () => {
  assert.deepEqual(planSmart({ shows: show(items), progress: {}, settings: keep(2), held: [held('show-1', 0, false)] }).save.map(item => item.id), ['show-2']);
});
test('the storage cap stops new saves but keeps what is there, counting what watched removals free', () => {
  const state = { shows: show(items), progress: done('show-1'), settings: keep(4, false, 3 * GB), held: [held('show-1'), held('show-2')] };
  const plan = planSmart(state);
  assert.deepEqual([ids(plan.save), plan.capped], [['show-3'], 2]);
  const freed = planSmart({ ...state, settings: keep(4, true, 3 * GB) });
  assert.deepEqual([freed.remove, ids(freed.save), freed.capped], [['show-1'], ['show-3', 'show-4'], 1]);
});
test('only groups of two or more unfinished saves are batches, with paused ones counted apart', () => {
  const record = (title: string, over: object = {}) => ({ title, complete: false, batch: 'b1', batchLabel: 'Show', ...over });
  assert.deepEqual(batchesOf([record('a'), record('b', { paused: true }), record('c', { complete: true }), record('solo', { batch: 'b2' }), { title: 'loose', complete: false }]), [{ id: 'b1', label: 'Show', waiting: 1, paused: 1 }]);
});
