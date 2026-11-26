/** @param {import('./server.ts').LibraryScanStatus} status */
export function scanMessage(status) {
  if (status.scanning) return 'Scanning library…';
  if (!status.lastScanAt) return 'No library scan yet.';
  const date = new Date(status.lastScanAt).toLocaleString();
  const errors = status.errors.length;
  return errors ? 'Last scan ' + date + ' · ' + errors + (errors === 1 ? ' folder had an error' : ' folders had errors') : 'Last scan ' + date;
}
