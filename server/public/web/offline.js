// Watching with no connection. A title is saved from the server in pieces into IndexedDB (which works on plain-HTTP LAN
// addresses too), played from a blob, and listed with how much space it takes. The service worker (../sw.js) keeps the app
// itself so the page opens offline on HTTPS addresses.
import { createStore } from './offline-store.js';
import { api } from './http.js';

const DB = 'matro-offline', STORE = 'kv';
const opened = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const run = async (mode, work) => {
  const db = await opened();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode), result = work(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(result.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
};
const backend = {
  get: key => run('readonly', s => s.get(key)),
  set: (key, value) => run('readwrite', s => s.put(value, key)),
  delete: key => run('readwrite', s => s.delete(key)),
  keys: prefix => run('readonly', s => s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`)))
};
export const store = createStore(backend);

// Remembered between visits so the library, and who is signed in, can be shown when the server cannot be reached.
export const remember = (key, value) => backend.set(`app:${key}`, value).catch(() => {});
export const recall = key => backend.get(`app:${key}`).catch(() => undefined);

export const sizeLabel = bytes => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
export const isOffline = error => error instanceof TypeError || navigator.onLine === false;

const urls = new Map(); // id -> blob: address, kept for the page's lifetime
const jobs = new Map(); // id -> { controller, percent }
const listeners = new Set();
const changed = () => { for (const callback of listeners) callback(); };
// Subtitle files added with no connection wait here and are sent to the server when it answers again.
export const queueSubtitle = entry => backend.set(`pending:sub:${Date.now()}${Math.random().toString(36).slice(2, 6)}`, entry);
export async function flushSubtitles() {
  let sent = 0;
  for (const key of (await backend.keys('pending:sub:')).sort()) {
    const entry = await backend.get(key);
    try { await api('POST', `/api/items/${entry.id}/subtitles?${entry.query}`, new Blob([entry.body])); } catch (error) { if (isOffline(error)) break; }
    await backend.delete(key); sent++; // a rejected file (bad format) is dropped rather than retried for ever
  }
  return sent;
}
export const pendingSubtitles = async () => (await backend.keys('pending:sub:')).length;
export const refresh = changed;
export const onChange = callback => { listeners.add(callback); return () => listeners.delete(callback); };
export const progressOf = id => jobs.get(id)?.percent ?? null;
// What the Downloads page shows: saves in flight (with speed and time left) and the ones that stopped on an error.
const failures = new Map();
export const activeJobs = () => [...jobs].map(([id, j]) => {
  const seconds = (Date.now() - j.started) / 1000, speed = j.state === 'saving' && seconds > 1 && j.got > 0 ? j.got / seconds : 0;
  return { id, title: j.title, state: j.state, percent: j.percent, done: j.done || 0, size: j.size || 0, speed, left: speed ? Math.max(0, (j.size - j.done) / speed) : null };
});
export const failedJobs = () => [...failures].map(([id, f]) => ({ id, ...f }));
export const dismissFailure = id => { failures.delete(id); changed(); };
export const isSaved = async id => !!(await store.meta(id))?.complete;

export async function playUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const blob = await store.file(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob); urls.set(id, url);
  return url;
}
export async function savedInfo(id) { const record = await store.meta(id); return record?.complete ? record.info : null; }
export async function savedSubtitles(id, key) { const record = await store.meta(id); return record?.complete ? record.subtitles[key] ?? null : null; }

// One byte range, read as a stream so progress moves smoothly instead of once per piece.
const fetchRange = id => async (start, end, onBytes = () => {}) => {
  const res = await fetch(`/api/items/${id}/offline/file`, { credentials: 'same-origin', headers: { range: `bytes=${start}-${end}` }, signal: jobs.get(id)?.controller.signal });
  if (res.status !== 206 && res.status !== 200) throw new Error(`The server answered ${res.status}.`);
  const parts = [], reader = res.body.getReader(); let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onBytes(got); }
  return new Blob(parts);
};
// The phone app (a WebView) turns these into a notification with the progress; the browser ignores them.
const tell = payload => { try { window.ReactNativeWebView?.postMessage(`dl:${JSON.stringify(payload)}`); } catch { /* not in the app */ } };

// `shape` turns the server's /info into what the player shows; here only what the saved file can actually do is kept.
export async function save(id, { info, title, subtitleTracks, fetchText }) {
  if (jobs.has(id)) return;
  navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict saved titles under storage pressure
  failures.delete(id);
  const job = { controller: new AbortController(), percent: 0, title, state: 'preparing', started: Date.now(), got: 0, done: 0, size: 0 }; jobs.set(id, job); changed(); tell({ id, title, state: 'saving', percent: 0 });
  let outcome = 'failed';
  try {
    let ready;
    for (let tries = 0; ; tries++) {
      ready = await api('GET', `/api/items/${id}/offline`);
      if (ready.state === 'ready') break;
      if (tries > 450) throw new Error('The server is still converting this file. Try again later.');
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (job.controller.signal.aborted) throw new DOMException('Cancelled.', 'AbortError');
    }
    job.state = 'saving'; job.started = Date.now(); changed();
    const subtitles = {};
    for (const track of subtitleTracks) { try { subtitles[track.key] = await fetchText(track); } catch { /* a missing subtitle must not block the video */ } }
    await store.download({ id, size: ready.size, type: ready.type, info, subtitles, title, fetchRange: fetchRange(id), signal: job.controller.signal,
      onProgress: (done, size) => { if (!job.base) job.base = done; job.got = done - job.base; job.done = done; job.size = size; const percent = Math.floor(done / size * 100); if (percent === job.percent) return; job.percent = percent; changed(); tell({ id, title, state: 'saving', percent }); } });
    outcome = 'saved';
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  } catch (error) { outcome = error.name === 'AbortError' ? 'stopped' : 'failed'; if (outcome === 'failed') failures.set(id, { title, error: error.message || 'The download failed.', at: Date.now() });
    throw error;
  } finally { jobs.delete(id); changed(); tell({ id, title, state: outcome }); }
}
// Stored pieces of a save that is not running: nothing in flight and not finished.
export const cancel = id => jobs.get(id)?.controller.abort();
export async function remove(id) {
  cancel(id);
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  await store.remove(id); changed();
}
export const usage = async () => ({ ...(await store.usage()), quota: await navigator.storage?.estimate?.().then(e => e.quota).catch(() => 0) });
