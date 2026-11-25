import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoSkip } from '../../../../packages/core/client/auto-skip.js';
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

test('invalid durations cannot complete playback or trigger an outro', () => {
  const markers = [{ type: 'outro', start: 8 }];
  for (const duration of [0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(reachedPlaybackEnd(Infinity, duration), false);
    assert.equal(reachedOutro(10, duration, markers), false);
    assert.equal(reachedCompletion(10, duration, markers), false);
    assert.equal(isCompleted({ position: 10, duration }), false);
  }
  assert.equal(reachedCompletion(Infinity, 200, markers), false);
});

test('auto-skip tracks each marker across seeks and refreshed marker lists', () => {
  const intro = { type: 'intro', start: 0, end: 10 };
  const recap = { type: 'recap', start: 20, end: 30 };
  const outro = { type: 'outro', start: 90, end: 100 };
  const markers = [intro, recap, outro];
  const autoSkip = createAutoSkip();
  assert.equal(autoSkip.target(markers, 1, 100), 10);
  autoSkip.seek(21);
  assert.equal(autoSkip.target(markers, 21, 100), null);
  assert.equal(autoSkip.target(markers, 29, 100), null);
  autoSkip.seek(19);
  assert.equal(autoSkip.target(markers, 20, 100), 30);
  autoSkip.seek(0);
  assert.equal(autoSkip.target(markers.map(marker => ({ ...marker })), 1, 100), null);
  assert.equal(autoSkip.target(markers, 21, 100), null);
  assert.equal(autoSkip.target(markers, 95, 100), null);
  assert.equal(createAutoSkip().target(markers, 1, 100), 10);
});

test('completion uses markers when given and the file end otherwise', () => {
  assert.equal(reachedCompletion(170, 200, [{ type: 'outro', start: 160 }]), true);
  assert.equal(reachedCompletion(170, 200), false);
  assert.equal(isCompleted({ position: 195, duration: 200 }), true);
  assert.equal(isCompleted({ position: 170, duration: 200 }), false);
  assert.equal(isCompleted({ position: 10, duration: 200, completed: true }), true);
});
