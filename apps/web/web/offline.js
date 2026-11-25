import { DOWNLOAD_SLOTS, RetryableDownloadError, fetchPiece, isTextCaption, keptAudio, offlinePath, optionalCaption, prepareDownload, retrying, withChoice } from '../../../packages/core/client/offline-rules.js';
import { createStore, newRequestId, resumable } from './offline-store.js';
import { ApiError, api } from './http.js';

const database = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('matro-saved-media', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const resultOf = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function transaction(mode, operation, scope = '') {
  const db = await database();
  try {
    const tx = db.transaction('files', mode), store = tx.objectStore('files');
    const completed = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    const work = async () => {
      try {
        return await operation({
          get: key => resultOf(store.get(scope + key)),
          set: (key, value) => resultOf(store.put(value, scope + key)),
          delete: key => resultOf(store.delete(scope + key)),
          keys: async prefix => (await resultOf(store.getAllKeys(IDBKeyRange.bound(scope + prefix, scope + prefix + '\uffff')))).map(key => key.slice(scope.length)),
        });
      } catch (error) {
        try { tx.abort(); } catch { /* The transaction already finished. */ }
        throw error;
      }
    };
    const [result] = await Promise.all([work(), completed]);
    return result;
  } finally { db.close(); }
}
const db = {
  get: key => transaction('readonly', tx => tx.get(key)),
  set: (key, value) => transaction('readwrite', tx => tx.set(key, value)),
  delete: key => transaction('readwrite', tx => tx.delete(key)),
  keys: prefix => transaction('readonly', tx => tx.keys(prefix)),
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

function mergeProgress(previous, incoming) {
  const merged = { ...previous };
  for (const [id, entry] of Object.entries(incoming || {})) {
    if (!entry) continue;
    const other = merged[id], order = (entry.updated || 0) - (other?.updated || 0);
    if (!other || order > 0 || (order === 0 && (!other.hidden || entry.hidden))) {
      merged[id] = other?.hidden && entry.hidden === undefined ? { ...entry, hidden: true } : entry;
    }
  }
  return merged;
}

export function createOffline(user, { inspect, subtitlePath, sendSubtitle }) {
  const scope = scopeFor(user);
  const backend = {
    get: key => db.get(scope + key), set: (key, value) => db.set(scope + key, value), delete: key => db.delete(scope + key),
    keys: async prefix => (await db.keys(scope + prefix)).map(key => key.slice(scope.length)),
    transaction: (mode, operation) => transaction(mode, operation, scope),
  };
  const store = createStore(backend), jobs = new Map(), listeners = new Set();
  const emit = () => { for (const notify of listeners) notify(); };
  const urls = new Map();
  const withLock = (key, options, run) => navigator.locks
    ? navigator.locks.request(scope + key, options, run) : run();
  const updateJob = (record, edit) => store.update(record.id, current =>
    current?.requestId === record.requestId && resumable(current) ? edit(current) : null);
  const paused = () => new DOMException('Download paused.', 'AbortError');
  let running = 0, stopped = false;

  async function runJob(job) {
    const { item, controller: { signal } } = job, { id, requestId, choice } = item;
    const current = await updateJob(item, record => ({ ...record, state: 'preparing', error: null }));
    if (!current) {
      if ((await store.meta(id))?.complete) return;
      throw paused();
    }
    signal.throwIfAborted();
    job.active = true; emit();
    const root = offlinePath(id);
    try {
      let info = await retrying(signal, () => inspect(id, { signal, deadline: true }));
      const status = await prepareDownload(signal, () => api('GET', withChoice(root, choice), undefined, { signal, deadline: true }), progress => {
        job.prepared = progress ?? null; emit();
      }, { stallWithoutProgress: false });
      job.prepared = null;
      const texts = {}, tracks = [];
      const send = (path, headers, requestSignal) => fetch(path, { credentials: 'same-origin', signal: requestSignal, headers });
      for (const track of info.subtitles) {
        if (!isTextCaption(track)) continue;
        const caption = await optionalCaption(requestSignal => send(subtitlePath(id, track.index), {}, requestSignal), signal);
        if (caption !== undefined) { texts[track.index] = caption; tracks.push(track); }
      }
      const burnedSubtitle = info.subtitles.find(track => track.index === choice?.burn);
      info = { ...info, audio: keptAudio(info.audio, choice), subtitles: tracks, burnedSubtitle, offlineQuality: choice?.quality || 'original', qualities: [] };
      let first = true;
      const fetchRange = async (start, end) => new Blob([await fetchPiece(send, root, status, { start, end }, signal, choice)]);
      await store.download({ id, ...status, info, subtitles: texts, title: item.title, requestId, fetchRange, signal,
        onProgress(have, size) {
          if (first) { first = false; job.started = Date.now(); job.initial = have; }
          Object.assign(job, { have, size }); emit();
        } });
    } catch (error) {
      if (!signal.aborted && error.name !== 'AbortError') {
        await updateJob(item, record => ({ ...record, state: error instanceof RetryableDownloadError || networkLost(error) ? record.state : 'failed', error: error.message }));
      }
      throw error;
    }
  }

  function pump() {
    if (stopped) return;
    for (const job of jobs.values()) {
      if (running >= DOWNLOAD_SLOTS) break;
      if (job.running) continue;
      job.running = true; running++;
      const { id } = job.item, { signal } = job.controller;
      void Promise.resolve().then(() => withLock(`download:${id}`, { signal }, () => runJob(job)))
        .finally(() => {
          job.controller.abort();
          running--; jobs.delete(id); emit(); pump();
        }).then(job.resolve, job.reject);
    }
  }
  function schedule(record) {
    if (jobs.has(record.id)) return jobs.get(record.id).done;
    const job = { item: record, controller: new AbortController(), have: 0, size: 0, prepared: null };
    job.done = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }));
    jobs.set(record.id, job);
    emit(); pump();
    return job.done;
  }
  async function enqueue(items) {
    const records = await store.enqueue(items);
    const outcomes = await Promise.allSettled(records.map(schedule));
    const failure = outcomes.find(result => result.status === 'rejected' && result.reason.name !== 'AbortError')
      || outcomes.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  async function resume() {
    const records = (await store.list()).filter(record => resumable(record) && !jobs.has(record.id))
      .sort((a, b) => a.queuedAt - b.queuedAt || a.order - b.order);
    for (const record of records) void schedule(record).catch(() => {});
  }
  async function cancel(id) {
    await store.update(id, record => resumable(record) ? { ...record, state: 'paused', error: null } : null);
    const job = jobs.get(id);
    if (job) {
      job.controller.abort();
      if (!job.running) { jobs.delete(id); job.reject(paused()); }
    }
    emit();
  }
  let pending = Promise.resolve();
  const serialize = task => { const next = pending.catch(() => {}).then(task); pending = next; return next; };
  async function library() {
    const saved = await backend.get('library');
    if (!saved) throw new Error('Connect to your Matro server to load the library.');
    const records = await store.list(), ids = new Set(records.filter(record => record.complete).map(record => record.id));
    const queued = await backend.get('pending');
    return { ...saved, progress: mergeProgress(saved.progress, queued?.progress), items: saved.items.filter(item => ids.has(item.id)), folders: [], metadataEnabled: false };
  }
  return {
    store, enqueue, resume, library, cancel, jobs,
    shutdown() {
      stopped = true;
      for (const job of jobs.values()) {
        job.controller.abort();
        if (!job.running) { jobs.delete(job.item.id); job.reject(paused()); }
      }
    },
    async remember(data) { await backend.set('library', data); await db.set(activeKey, scope); },
    async cachedProgress() {
      const [saved, queued] = await Promise.all([backend.get('library'), backend.get('pending')]);
      return { items: saved?.items || [], progress: mergeProgress(saved?.progress, queued?.progress) };
    },
    queue: ({ progress }) => backend.transaction('readwrite', async tx => {
      const previous = await tx.get('pending');
      await tx.set('pending', { progress: mergeProgress(previous?.progress, progress), revision: newRequestId() });
    }),
    sync: save => withLock('progress', {}, async () => {
      const body = await backend.get('pending');
      if (!body) return false;
      await save({ progress: body.progress });
      await backend.transaction('readwrite', async tx => {
        const current = await tx.get('pending');
        if (current?.revision === body.revision) await tx.delete('pending');
      });
      return true;
    }),
    async playback(id) {
      const meta = await store.meta(id);
      if (!meta?.complete) return null;
      const version = meta.transfer ?? meta.savedAt;
      const cached = urls.get(id);
      if (cached?.version === version) return { ...meta, url: cached.url };
      const saved = await store.read(id);
      if (!saved) return null;
      const { record, file } = saved, readVersion = record.transfer ?? record.savedAt;
      if (urls.get(id)?.version !== readVersion) {
        if (urls.has(id)) URL.revokeObjectURL(urls.get(id).url);
        urls.set(id, { url: URL.createObjectURL(file), version: readVersion });
      }
      return { ...record, url: urls.get(id).url };
    },
    release(keep) {
      for (const [id, { url }] of urls) if (url !== keep?.split('#')[0]) { URL.revokeObjectURL(url); urls.delete(id); }
    },
    async remove(id) {
      await cancel(id); await jobs.get(id)?.done.catch(() => {});
      await store.remove(id); emit();
    },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async queueSubtitle(id, track, text, body, query) {
      await backend.set(`upload:${track.index}`, { id, body, query, queuedAt: Date.now() });
      if (text) await store.addSubtitle(id, track.index, track, text);
      emit();
    },
    subtitleUploads,
    flushSubtitles: () => serialize(() => withLock('uploads', {}, flushSubtitles)),
    retrySubtitle: key => serialize(() => withLock('uploads', {}, async () => {
      const upload = await backend.get(key);
      if (!upload) return;
      const queued = { ...upload, error: null };
      await backend.set(key, queued);
      await uploadSubtitle(key, queued);
      emit();
    })),
    discardSubtitle: key => serialize(() => withLock('uploads', {}, async () => { await backend.delete(key); emit(); })),
  };

  async function subtitleUploads() {
    const uploads = await Promise.all((await backend.keys('upload:')).map(async key => {
      const upload = await backend.get(key);
      return upload && { ...upload, key };
    }));
    return uploads.filter(Boolean).sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0));
  }
  async function flushSubtitles() {
    for (const { key, ...upload } of await subtitleUploads()) {
      if (!upload.error) await uploadSubtitle(key, upload);
    }
    emit();
  }
  async function uploadSubtitle(key, upload) {
    try { await sendSubtitle(upload); }
    catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) {
        await backend.set(key, { ...upload, error: error.message });
      }
      return;
    }
    await backend.delete(key);
  }
}
