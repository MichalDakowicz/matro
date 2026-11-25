import { createStore } from './offline-store.js';
import { ApiError, api } from './http.js';

const database = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('matro-saved-media', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function change(mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('files', mode);
      const action = operation(transaction.objectStore('files'));
      transaction.oncomplete = () => resolve(action.result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
const db = {
  get: key => change('readonly', store => store.get(key)),
  set: (key, value) => change('readwrite', store => store.put(value, key)),
  delete: key => change('readwrite', store => store.delete(key)),
  keys: prefix => change('readonly', store => store.getAllKeys(IDBKeyRange.bound(prefix, prefix + '\uffff'))),
};
const scopeFor = user => `account:${user.id}:${encodeURIComponent(user.username)}:`;
const activeKey = 'active-account-scope';
export const networkLost = error => error instanceof TypeError || error instanceof ApiError && error.status >= 500;
export async function lastOfflineUser() {
  const scope = await db.get(activeKey);
  if (!scope) return null;
  const library = await db.get(scope + 'library'), records = await db.keys(scope + 'meta:');
  return records.length ? library?.user || null : null;
}
export const forgetOfflineSession = () => db.delete(activeKey);

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  function abort() { clearTimeout(timer); reject(signal.reason); }
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
});

// A dropped connection or a 5xx answer is retried with backoff; the server's own refusals (4xx) and a changed file are not.
export async function retrying(signal, run) {
  for (let tries = 0;; tries++) {
    try { return await run(); }
    catch (error) {
      if (signal.aborted || error.fatal || error instanceof ApiError && error.status < 500 || tries >= 6) throw error;
      await wait(Math.min(30000, 1500 * 2 ** tries), signal);
    }
  }
}

export function createOffline(user) {
  const scope = scopeFor(user);
  const backend = {
    get: key => db.get(scope + key), set: (key, value) => db.set(scope + key, value), delete: key => db.delete(scope + key),
    keys: async prefix => (await db.keys(scope + prefix)).map(key => key.slice(scope.length)),
  };
  const store = createStore(backend), jobs = new Map(), listeners = new Set();
  const emit = () => { for (const notify of listeners) notify(); };
  const urls = new Map();
  function cancel(id) { jobs.get(id)?.controller.abort(); }
  async function download(item, inspect, subtitles) {
    const id = item.id;
    if (jobs.has(id)) return jobs.get(id).done;
    const controller = new AbortController(), { signal } = controller;
    // `prepared` is the server's transcode progress (0-1) while it converts the file, null when unknown.
    const job = { controller, item, have: 0, size: 0, prepared: null, started: Date.now(), initial: 0 };
    const root = `/api/items/${encodeURIComponent(id)}/offline`;
    async function run() {
      let info = await inspect(id), status;
      const started = Date.now();
      for (;;) {
        if (signal.aborted) throw signal.reason;
        status = await retrying(signal, () => api('GET', root, undefined, { signal }));
        if (status.state === 'ready') break;
        if (status.state !== 'preparing' || Date.now() - started > 30 * 60 * 1000) throw new Error('The server did not finish preparing this title.');
        job.prepared = typeof status.progress === 'number' ? status.progress : null; emit();
        await wait(2000, signal);
      }
      job.prepared = null;
      const texts = {};
      const tracks = [];
      for (const track of info.subtitles) {
        if (signal.aborted) throw signal.reason;
        if (!track.text || track.bitmap) continue;
        try { texts[track.index] = await subtitles({ id, index: track.index, signal }); tracks.push(track); } catch { /* A missing subtitle does not prevent saving the video. */ }
      }
      info = { ...info, audio: info.audio.slice(0, 1), subtitles: tracks };
      let first = true;
      const fetchRange = (start, end) => retrying(signal, async () => {
        const res = await fetch(`${root}/file?version=${encodeURIComponent(status.version)}`, {
          credentials: 'same-origin', signal, headers: { range: `bytes=${start}-${end}` },
        });
        if (res.status !== 206 || res.headers.get('content-range') !== `bytes ${start}-${end}/${status.size}`) {
          await res.body?.cancel();
          throw Object.assign(new Error('The server could not resume this download. Try again.'), { fatal: res.status < 500 });
        }
        return res.blob();
      });
      await store.download({ id, ...status, info, subtitles: texts, title: item.title, fetchRange, signal,
        onProgress(have, size) {
          if (first) { first = false; job.started = Date.now(); job.initial = have; }
          Object.assign(job, { have, size }); emit();
        } });
    }
    jobs.set(id, job); emit();
    job.done = run().finally(() => { jobs.delete(id); emit(); });
    return job.done;
  }
  let pending = Promise.resolve();
  const serialize = task => { const next = pending.catch(() => {}).then(task); pending = next; return next; };
  async function library() {
    const saved = await backend.get('library');
    if (!saved) throw new Error('Connect to your Matro server to load the library.');
    const records = await store.list(), ids = new Set(records.filter(record => record.complete).map(record => record.id));
    const queued = await backend.get('pending');
    return { ...saved, progress: { ...saved.progress, ...queued?.progress }, items: saved.items.filter(item => ids.has(item.id)), folders: [], metadataEnabled: false };
  }
  return {
    store, download, library, cancel, jobs,
    async remember(data) { await backend.set('library', data); await db.set(activeKey, scope); },
    queue: ({ progress }) => serialize(async () => {
      const queued = (await backend.get('pending'))?.progress || {};
      for (const [id, entry] of Object.entries(progress)) if (!queued[id] || entry.updated >= queued[id].updated) queued[id] = entry;
      await backend.set('pending', { progress: queued });
    }),
    sync: save => serialize(async () => {
      const body = await backend.get('pending');
      if (!body) return false;
      await save(body); await backend.delete('pending'); return true;
    }),
    async playback(id) {
      if (urls.has(id)) return urls.get(id);
      const file = await store.file(id);
      if (!file) return null;
      if (urls.has(id)) return urls.get(id);
      const url = URL.createObjectURL(file); urls.set(id, url); return url;
    },
    release(keep) {
      for (const [id, url] of urls) if (url !== keep?.split('#')[0]) { URL.revokeObjectURL(url); urls.delete(id); }
    },
    async remove(id) {
      cancel(id); await jobs.get(id)?.done.catch(() => {});
      await store.remove(id); emit();
    },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async queueSubtitle(id, track, text, body, query) {
      await backend.set(`upload:${track.index}`, { id, body, query });
      if (text) await store.addSubtitle(id, track.index, track, text);
      emit();
    },
    async subtitleUploads() { return backend.keys('upload:'); },
    async flushSubtitles(send) {
      for (const key of await backend.keys('upload:')) {
        const upload = await backend.get(key);
        if (!upload) continue;
        await send(upload); await backend.delete(key);
      }
      emit();
    },
  };
}
