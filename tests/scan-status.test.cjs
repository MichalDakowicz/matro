const test = require('node:test'), assert = require('node:assert/strict');

test('scan status messages cover scanning, never scanned, clean and failed scans', async () => {
  const { scanMessage } = await import('../packages/core/client/scan-status.js');
  assert.equal(scanMessage({ scanning: true, lastScanAt: null, errors: [] }), 'Scanning library…');
  assert.equal(scanMessage({ scanning: false, lastScanAt: null, errors: [] }), 'No library scan yet.');
  assert.match(scanMessage({ scanning: false, lastScanAt: 1700000000000, errors: [] }), /^Last scan /);
  assert.match(scanMessage({ scanning: false, lastScanAt: 1700000000000, errors: [{ folder: 'a', error: 'x' }] }), /1 folder had an error$/);
  assert.match(scanMessage({ scanning: false, lastScanAt: 1700000000000, errors: [{}, {}] }), /2 folders had errors$/);
});
