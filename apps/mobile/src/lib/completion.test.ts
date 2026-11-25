import test from 'node:test';
import assert from 'node:assert/strict';
import { isCompleted, reachedCompletion, reachedOutro, reachedPlaybackEnd } from '../../../../packages/core/client/watch-progress.js';

test('the end margin is 5% of the file, capped at 10 seconds', () => {
  assert.equal(reachedPlaybackEnd(189, 200), false);
  assert.equal(reachedPlaybackEnd(190, 200), true);
  assert.equal(reachedPlaybackEnd(2590, 2700), false);
  assert.equal(reachedPlaybackEnd(2690, 2700), true);
  assert.equal(reachedPlaybackEnd(5, 0), false);
});

test('only an outro in the second half counts as watched', () => {
  const late = [{ type: 'outro', start: 160 }], early = [{ type: 'outro', start: 30 }], intro = [{ type: 'intro', start: 120 }];
  assert.equal(reachedOutro(159, 200, late), false);
  assert.equal(reachedOutro(160, 200, late), true);
  assert.equal(reachedOutro(100, 200, early), false);
  assert.equal(reachedOutro(190, 200, intro), false);
  assert.equal(reachedOutro(10, 0, late), false);
});

test('completion uses markers when given and the file end otherwise', () => {
  assert.equal(reachedCompletion(170, 200, [{ type: 'outro', start: 160 }]), true);
  assert.equal(reachedCompletion(170, 200), false);
  assert.equal(isCompleted({ position: 195, duration: 200 }), true);
  assert.equal(isCompleted({ position: 170, duration: 200 }), false);
  assert.equal(isCompleted({ position: 10, duration: 200, completed: true }), true);
});
