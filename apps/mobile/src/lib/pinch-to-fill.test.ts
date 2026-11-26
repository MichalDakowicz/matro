import test from 'node:test';
import assert from 'node:assert/strict';
import { pinchFit } from '../player/pinchToFill.ts';

test('pinches change fit in the expected direction after deliberate movement', () => {
  assert.equal(pinchFit(120, 136, 'contain', false), null);
  assert.equal(pinchFit(20, 25, 'contain', false), null);
  assert.equal(pinchFit(0, 150, 'contain', false), null);
  assert.deepEqual(pinchFit(120, 150, 'contain', false), { fit: 'cover', label: 'Fill' });
  assert.equal(pinchFit(120, 150, 'cover', false), null);
  assert.deepEqual(pinchFit(120, 90, 'cover', false), { fit: 'contain', label: 'Fit' });
  assert.equal(pinchFit(120, 90, 'contain', false), null);
});

test('a spread keeps the whole image visible with bitmap subtitles', () => {
  assert.deepEqual(pinchFit(120, 150, 'contain', true), { fit: 'contain', label: 'Fit kept for image subtitles' });
  assert.deepEqual(pinchFit(120, 150, 'contain', false), { fit: 'cover', label: 'Fill' });
});
