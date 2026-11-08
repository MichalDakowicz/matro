const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function origin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Enter the server address without a path, username or password.');
  return url.origin;
}
function loadSource(dir) {
  try { const value = JSON.parse(fs.readFileSync(path.join(dir, 'server.json'), 'utf8')); return { url: origin(value.url), enabled: value.enabled !== false }; }
  catch { return { url: '', enabled: false }; }
}
async function saveSource(dir, value) {
  const file = path.join(dir, 'server.json');
  const data = { url: value.url ? origin(value.url) : '', enabled: value.enabled === true };
  await fsp.mkdir(dir, { recursive: true }); await fsp.writeFile(file + '.tmp', JSON.stringify(data)); await fsp.rename(file + '.tmp', file);
  return data;
}
async function findServer(input, fetchImpl = fetch) {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  if (!raw) throw Error('Enter your Matro server address.');
  const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|[^.:/]+(?::\d+)?$|.*\.(local|lan|home)(?::\d+)?$)/i.test(raw);
  const candidates = /^https?:\/\//i.test(raw) ? [raw] : privateHost ? [`http://${raw}`, `https://${raw}`] : [`https://${raw}`, `http://${raw}`];
  const addresses = candidates.map(origin);
  for (const address of addresses) {
    try {
      const response = await fetchImpl(address + '/api/status', { redirect: 'error', signal: AbortSignal.timeout(8000) });
      const status = response.ok ? await response.json() : null;
      if (status && typeof status.setup === 'boolean') return address;
    } catch {}
  }
  throw Error('Could not reach a Matro server at that address. Check the address and connection.');
}
function relaunchArgs(argv) {
  return argv.slice(1).filter((value, index, args) => value !== '--server' && value !== '--local' && args[index - 1] !== '--server');
}
module.exports = { origin, loadSource, saveSource, findServer, relaunchArgs };
