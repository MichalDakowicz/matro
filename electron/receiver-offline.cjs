// Watching a server's titles with no connection. A title is pulled from the server (GET /api/items/:id/offline, then
// /offline/file in ranged pieces) into <user-data>/offline/<server>/, resumed if interrupted, and played from disk through
// matro://app/offline/<id>. The last library, user and unsent progress are kept beside it so the app opens without the server.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const CHUNK = 8 * 1024 * 1024;
const EXT = { 'video/webm': '.webm', 'video/ogg': '.ogv', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeId = id => /^[\w-]{1,64}$/.test(String(id));

/** One folder per server address, so two servers never share files. */
const serverDir = (root, base) => path.join(root, 'offline', crypto.createHash('sha1').update(base).digest('hex').slice(0, 12));

function createCache(dir) {
  const file = key => path.join(dir, `${key}.json`);
  return {
    async read(key) { try { return JSON.parse(await fsp.readFile(file(key), 'utf8')); } catch { return null; } },
    async write(key, value) { await fsp.mkdir(dir, { recursive: true }); if (value === null) await fsp.rm(file(key), { force: true }); else await fsp.writeFile(file(key), JSON.stringify(value)); }
  };
}

function createOfflineStore({ dir, fetch: doFetch, base, prepare, notify = () => {}, pause = sleep }) {
  const records = new Map(), jobs = new Map(); // id -> meta | id -> { controller, percent }
  const meta = id => path.join(dir, `${id}.json`), part = id => path.join(dir, `${id}.part`);
  const fileOf = record => path.join(dir, `${record.id}${EXT[record.type] || '.mp4'}`);

  async function init() {
    let names = []; try { names = await fsp.readdir(dir); } catch { /* nothing saved yet */ }
    for (const name of names.filter(n => n.endsWith('.json') && n !== 'library.json' && n !== 'pending.json' && n !== 'user.json')) {
      try { const record = JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8')); if (record.complete && safeId(record.id)) records.set(record.id, record); } catch { /* damaged record */ }
    }
  }
  const emit = () => notify(state());
  const state = () => ({ saved: [...records.keys()], progress: Object.fromEntries([...jobs].map(([id, job]) => [id, job.percent])) });

  async function download(id, job) {
    const info = await prepare(id);
    await fsp.mkdir(dir, { recursive: true });
    let status;
    for (let waited = 0; ; waited += 3000) { // a conversion on the server can take a while; ask until it is ready
      const res = await doFetch(`${base}/api/items/${encodeURIComponent(id)}/offline`, { headers: { 'x-matro': '1' }, credentials: 'include', signal: job.controller.signal });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `The server answered ${res.status}.`);
      if (body.state === 'ready') { status = body; break; }
      if (waited > 30 * 60 * 1000) throw new Error('The server took too long to prepare this title.');
      await pause(3000);
    }
    let have = 0; try { have = (await fsp.stat(part(id))).size; } catch { /* fresh start */ }
    if (have > status.size) { await fsp.rm(part(id), { force: true }); have = 0; }
    while (have < status.size) {
      const end = Math.min(have + CHUNK, status.size) - 1;
      const res = await doFetch(`${base}/api/items/${encodeURIComponent(id)}/offline/file`, { headers: { 'x-matro': '1', range: `bytes=${have}-${end}` }, credentials: 'include', signal: job.controller.signal });
      if (res.status !== 206 && res.status !== 200) throw new Error(`The server answered ${res.status}.`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!bytes.length) throw new Error('The server stopped sending the file.');
      await fsp.appendFile(part(id), res.status === 200 ? bytes.subarray(have, end + 1) : bytes);
      have = (await fsp.stat(part(id))).size;
      job.percent = Math.floor(have / status.size * 100); emit();
    }
    const record = { id, title: info.title, info: info.info, subtitles: info.subtitles, size: status.size, type: status.type, complete: true, savedAt: Date.now() };
    await fsp.rename(part(id), fileOf(record));
    await fsp.writeFile(meta(id), JSON.stringify(record));
    records.set(id, record);
  }

  function start(id) {
    if (!safeId(id)) return Promise.reject(new Error('Unknown title.'));
    const job = { controller: new AbortController(), percent: 0 };
    jobs.set(id, job); emit();
    const done = download(id, job).finally(() => { jobs.delete(id); emit(); });
    done.catch(() => {}); // callers that care await the returned promise
    return done;
  }
  const cancel = id => { jobs.get(id)?.controller.abort(); };
  async function remove(id) {
    const record = records.get(id); records.delete(id);
    await Promise.all([record && fsp.rm(fileOf(record), { force: true }), fsp.rm(meta(id), { force: true }), fsp.rm(part(id), { force: true })]);
    emit();
  }
  async function partials() {
    const found = [];
    for (const name of await fsp.readdir(dir).catch(() => [])) if (name.endsWith('.part') && !jobs.has(name.slice(0, -5))) found.push({ id: name.slice(0, -5), size: (await fsp.stat(path.join(dir, name))).size });
    return found;
  }
  return {
    init, state, start, cancel, remove, partials,
    has: id => records.has(id), progress: id => jobs.get(id)?.percent ?? null,
    info: id => records.get(id)?.info ?? null, subtitle: (id, key) => records.get(id)?.subtitles?.[key] ?? null,
    file: id => records.has(id) ? fileOf(records.get(id)) : null, type: id => records.get(id)?.type,
    list: () => [...records.values()].map(({ id, title, size, savedAt }) => ({ id, title, size, savedAt })),
    usage: () => [...records.values()].reduce((sum, r) => sum + r.size, 0)
  };
}

/** A 200 or 206 Response for a saved file, honouring a single `bytes=a-b` range so the player can seek. */
function serveFile(file, type, rangeHeader) {
  const { Readable } = require('node:stream');
  const size = fs.statSync(file).size, match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  const headers = { 'content-type': type || 'video/mp4', 'accept-ranges': 'bytes' };
  if (!match || (!match[1] && !match[2])) return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...headers, 'content-length': String(size) } });
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2])), end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) } });
}

module.exports = { serveFile, createOfflineStore, createCache, serverDir, safeId, CHUNK };
