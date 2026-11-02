// Receiver mode: the desktop app becomes a client of a self-hosted Matro server (server/) the way the Android receiver
// is (mobile/src/lib/server.ts). server.json holds only the address and whether the mode is on; the session cookie
// lives in the window's own profile and everything else (library, progress, queue) stays on the server.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const PARTITION = 'persist:matro-server';
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

/** Signs in the way the web page does; the session cookie lands wherever fetchImpl keeps its cookies. */
async function signIn(base, username, password, fetchImpl = fetch) {
  const response = await fetchImpl(base + '/api/login', { method: 'POST', credentials: 'include', headers: { 'x-matro': '1', 'content-type': 'application/json' }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? `Server answered ${response.status}.`);
  return body.user;
}

function parse(text) {
  try { const { url, enabled } = JSON.parse(text); return typeof url === 'string' && /^https?:\/\//.test(url) ? { url, enabled: enabled !== false } : null; } catch { return null; }
}

/** Joins with a one-time invite code; the session cookie lands wherever fetchImpl keeps its cookies. */
async function signUp(base, code, username, password, fetchImpl = fetch) {
  const response = await fetchImpl(base + '/api/signup', { method: 'POST', credentials: 'include', headers: { 'x-matro': '1', 'content-type': 'application/json' }, body: JSON.stringify({ code, username, password }), signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? `Server answered ${response.status}.`);
  return body.user;
}

/** {url, enabled} from the saved text, or null when missing, damaged or not an http(s) address. */
function createServerLink(dir) {
  const file = path.join(dir, 'server.json');
  return {
    async get() { return parse(await fs.readFile(file, 'utf8').catch(() => '')); },
    async set({ url, enabled }) { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(file, JSON.stringify({ url, enabled: enabled !== false })); },
    async clear() { await fs.rm(file, { force: true }); }
  };
}

module.exports = { signUp, signIn, candidates, connect, createServerLink };

