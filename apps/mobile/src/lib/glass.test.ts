import test from 'node:test';
import assert from 'node:assert/strict';
import { blurProps, canBlur } from './glass.ts';

const phone = { os: 'android', version: 34, tv: false, highContrast: false, powerSave: false };

test('glass blurs on Android 12+ phones and keeps the solid fill everywhere else', () => {
  assert.equal(canBlur(phone), true);
  assert.equal(canBlur({ ...phone, version: 31 }), true);
  assert.equal(canBlur({ ...phone, version: 30 }), false); // no RenderEffect
  assert.equal(canBlur({ ...phone, os: 'ios', version: '17.4' }), false);
  assert.equal(canBlur({ ...phone, tv: true }), false);
  assert.equal(canBlur({ ...phone, highContrast: true }), false);
  assert.equal(canBlur({ ...phone, powerSave: true }), false);
});

test('the blur is 18 dp at any density and leaves the colour to the fill', () => {
  for (const density of [1, 2, 2.75, 3.5]) {
    const { intensity, blurReductionFactor } = blurProps(density);
    const radius = intensity / blurReductionFactor * 4, sigma = .57735 * radius + .5;
    assert.equal(intensity, 1);
    assert.ok(Math.abs(sigma - 18 * density) < 1e-6, `density ${density}`);
  }
});
