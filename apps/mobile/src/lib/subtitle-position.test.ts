import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubtitlePosition, subtitleOffset, subtitlePresets } from '../player/subtitlePosition.ts';

test('positions restore from storage with a safe default and bounded axes', () => {
  for (const value of [null, '', 'null', 'invalid']) assert.deepEqual(parseSubtitlePosition(value), subtitlePresets.Bottom);
  assert.deepEqual(parseSubtitlePosition('{"x":25,"y":61}'), { x: 25, y: 61 });
  assert.deepEqual(parseSubtitlePosition('{"x":-5,"y":110}'), { x: 0, y: 100 });
  assert.deepEqual(parseSubtitlePosition('{"x":"100","y":0}'), subtitlePresets.Top);
});

test('the caption box moves only through space it can fit inside', () => {
  assert.equal(subtitleOffset(0, 300, 120), 0);
  assert.equal(subtitleOffset(50, 300, 120), 90);
  assert.equal(subtitleOffset(100, 300, 120) + 120, 300);
  assert.equal(subtitleOffset(100, 100, 160), 0);
});
