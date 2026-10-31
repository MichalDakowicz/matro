const transientStatus = status => status === 408 || status === 429 || status >= 500 && status <= 599;
function connectionError(status, context = 'qBittorrent returned') {
  return Object.assign(new Error(`${context} HTTP ${status}. Check Web UI access and retry.`), { retryable: transientStatus(status) });
}
function isTransient(error) {
  if (typeof error?.retryable === 'boolean') return error.retryable;
  // Also recognise persisted errors created by older app versions.
  return /Could not reach the service|qBittorrent (?:returned|login returned) HTTP (?:408|429|5\d\d)\b/.test(error?.message || '');
}
const retryDelay = attempts => Math.min(60000, 10000 * 2 ** Math.min(Math.max(0, attempts - 1), 3));
module.exports = { connectionError, isTransient, retryDelay };
