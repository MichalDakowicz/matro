const test = require('node:test');
const assert = require('node:assert/strict');
const { isNewerRelease } = require('../packages/core/desktop/update-check.cjs');

test('the update check compares stable release versions numerically', () => {
  for (const [tag, installed, expected] of [
    ['v2.0.0', '1.99.99', true],
    ['v1.10.0', '1.9.99', true],
    ['v1.10.10', '1.10.9', true],
    ['v1.9.99', '1.10.0', false],
    ['v1.10.0', '1.10.0', false],
    ['v1.10.0+build.2', '1.10.0+build.1', false],
    ['v1.10.0', '1.10.0-rc.1', true],
    ['v2.0.0-rc.1', '1.10.0', false],
    ['nightly', '1.10.0', false],
    ['v1.2.3', 'development', false]
  ]) {
    assert.equal(isNewerRelease(tag, installed), expected, `${tag} compared with ${installed}`);
  }
});
