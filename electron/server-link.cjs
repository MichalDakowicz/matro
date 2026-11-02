// Opt-in link to a self-hosted Matro server (server/). The desktop app then shows the server's web UI the way
// the Android receiver does (mobile/src/lib/server.ts); the saved address is the only thing stored here.
const fs = require('node:fs/promises');
const path = require('node:path');

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^.]+$|.*\.(local|lan|home)$)/i;

/** "matro.example.com" -> https first; LAN addresses -> http first; an explicit scheme is kept. */
function candidates(input) {
  const raw = String(input ?? '').trim().replace(/\/+$/, '');
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw)) return [raw];
  const host = raw.split('/')[0].split(':')[0];
  return PRIVATE_HOST.test(host) ? [`http://${raw}`, `https://${raw}`] : [`https://${raw}`, `http://${raw}`];
}

/** Finds a working address for what the person typed and proves it answers like a Matro server. */
async function connect(input, fetchImpl = fetch, ms = 8000) {
  const list = candidates(input);
  if (!list.length) throw new Error('Enter your server address.');
  for (const base of list) {
    try {
      const response = await fetchImpl(base + '/api/status', { headers: { 'x-matro': '1' }, signal: AbortSignal.timeout(ms) });
      const status = response.ok ? await response.json() : null;
      if (status && typeof status.setup === 'boolean') return { url: base, setup: status.setup };
    } catch { /* try the next scheme */ }
  }
  throw new Error("Couldn't reach a Matro server at that address.");
}

function createServerLink(dir) {
  const file = path.join(dir, 'server.json');
  return {
    async get() {
      try { const { url } = JSON.parse(await fs.readFile(file, 'utf8')); return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null; } catch { return null; }
    },
    async set(url) { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(file, JSON.stringify({ url })); },
    async clear() { await fs.rm(file, { force: true }); }
  };
}

/** Only the linked server's own pages stay in the window; anything else opens in the browser. */
const sameOrigin = (base, target) => { try { return new URL(target).origin === new URL(base).origin; } catch { return false; } };

module.exports = { candidates, connect, createServerLink, sameOrigin };
