// Saved-for-offline files, kept apart from the browser: a key-value backend (IndexedDB in the page, a Map in tests) holds one
// record per title plus its pieces. A file is pulled in CHUNK-sized byte ranges, so a dropped connection resumes where it
// stopped instead of starting over, and nothing larger than one piece is ever held in memory while downloading.
export const CHUNK = 8 * 1024 * 1024;
export const newRequestId = () => Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');

export const metaKey = id => `meta:${id}`;
const chunkPrefix = id => `piece:${encodeURIComponent(id)}:`;
const chunkKey = (record, n) => record.transfer
  ? `${chunkPrefix(record.id)}${encodeURIComponent(record.version ?? '')}:${record.size}:${n}`
  : `chunk:${record.id}:${n}`; // Existing completed saves use these keys.
export const chunkCount = size => Math.ceil(size / CHUNK);
export const chunkRange = (size, n) => ({ start: n * CHUNK, end: Math.min(size, (n + 1) * CHUNK) - 1 });

// SRT and WebVTT can be shown as they are with a small fix; anything else (ASS/SSA) needs the server to convert it.
export function toVtt(text, filename = '') {
  const t = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT/.test(t)) return t;
  if (/\.srt$/i.test(filename)) return 'WEBVTT\n\n' + t.replace(/(\d\d:\d\d:\d\d),(\d{3})/g, '$1.$2');
  return null;
}

export function memoryBackend() {
  const map = new Map();
  const access = data => ({
    get: async key => data.get(key), set: async (key, value) => { data.set(key, value); }, delete: async key => { data.delete(key); },
    keys: async prefix => [...data.keys()].filter(key => key.startsWith(prefix)),
  });
  let pending = Promise.resolve();
  return { ...access(map), transaction(_mode, run) {
    const work = pending.catch(() => {}).then(async () => {
      const copy = new Map(map), result = await run(access(copy));
      map.clear();
      for (const [key, value] of copy) map.set(key, value);
      return result;
    });
    pending = work;
    return work;
  } };
}

export function createStore(backend) {
  const meta = id => backend.get(metaKey(id));
  async function list() {
    const out = [];
    for (const key of await backend.keys('meta:')) { const record = await backend.get(key); if (record) out.push(record); }
    return out.sort((a, b) => (b.savedAt ?? b.queuedAt ?? 0) - (a.savedAt ?? a.queuedAt ?? 0));
  }
  const update = (id, edit) => backend.transaction('readwrite', async tx => {
    const key = metaKey(id), previous = await tx.get(key), next = edit(previous);
    if (next && next !== previous) await tx.set(key, next);
    return next;
  });
  function enqueue(items) {
    return backend.transaction('readwrite', async tx => {
      const records = [], queuedAt = Date.now();
      for (const [index, { id, title }] of items.entries()) {
        const key = metaKey(id), previous = await tx.get(key);
        if (previous?.complete) continue;
        const record = previous?.requestId && resumable(previous) && !previous.error ? previous
          : { ...previous, id, title, state: 'queued', error: null, requestId: newRequestId(), queuedAt, order: index };
        if (record !== previous) await tx.set(key, record);
        records.push(record);
      }
      return records;
    });
  }
  // Pulls every missing piece of `size` bytes through `fetchRange(start, end) -> Blob`. Pieces already stored are kept, so calling it
  // again after a failure resumes. Throws AbortError when `signal` fires, leaving the partial download in place.
  async function download({ id, size, type, version, info, subtitles = {}, title = '', requestId, fetchRange, onProgress = () => {}, signal }) {
    const total = chunkCount(size), key = metaKey(id);
    const checkRequest = record => {
      if (requestId && (record?.requestId !== requestId || !resumable(record))) {
        throw new DOMException('Download paused.', 'AbortError');
      }
    };
    const record = await backend.transaction('readwrite', async tx => {
      const previous = await tx.get(key);
      if (previous?.complete && previous.version === version && previous.size === size) return previous;
      checkRequest(previous);
      const same = previous?.transfer && previous.size === size && previous.version === version;
      if (!same && previous) await clearPieces(tx, previous);
      const next = { ...previous, id, size, type, version, info, subtitles, title, chunks: total,
        transfer: same ? previous.transfer : newRequestId(), have: same ? previous.have : 0,
        complete: false, state: 'downloading', savedAt: Date.now() };
      await tx.set(key, next);
      return next;
    });
    if (record.complete) return record;
    const owned = async tx => {
      signal?.throwIfAborted();
      const current = await tx.get(key);
      if (current?.transfer !== record.transfer) throw new DOMException('Download changed in another tab.', 'AbortError');
      if (!current.complete) checkRequest(current);
      return current;
    };
    onProgress(Math.min(record.have * CHUNK, size), size);
    // Pieces are requested a few ahead of the one being stored, so the network doesn't idle while the disk works.
    const ahead = new Map();
    const request = n => {
      if (!ahead.has(n)) { const { start, end } = chunkRange(size, n), piece = fetchRange(start, end, got => onProgress(Math.min(size, start + got), size)); piece.catch(() => {}); ahead.set(n, piece); }
      return ahead.get(n);
    };
    for (let n = record.have; n < total; n++) {
      signal?.throwIfAborted();
      for (let k = n; k < Math.min(total, n + 3); k++) request(k);
      const { start, end } = chunkRange(size, n), blob = await request(n); ahead.delete(n);
      if (blob.size !== end - start + 1) throw new Error('The server sent an incomplete piece.');
      await backend.transaction('readwrite', async tx => {
        const current = await owned(tx);
        if (current.have > n) return;
        await tx.set(chunkKey(current, n), blob);
        await tx.set(key, { ...current, have: n + 1 });
      });
      onProgress(end + 1, size);
    }
    return backend.transaction('readwrite', async tx => {
      const current = await owned(tx);
      if (current.complete) return current;
      for (let n = 0; n < total; n++) {
        const { start, end } = chunkRange(size, n);
        if ((await tx.get(chunkKey(current, n)))?.size !== end - start + 1) throw new Error('The saved file is missing a piece.');
      }
      const complete = { ...current, complete: true, state: 'complete', error: null, savedAt: Date.now() };
      await tx.set(key, complete);
      return complete;
    });
  }
  async function clearPieces(tx, record) {
    for (let n = 0; n < record.chunks; n++) await tx.delete(chunkKey(record, n));
  }
  function remove(id) {
    return backend.transaction('readwrite', async tx => {
      const record = await tx.get(metaKey(id));
      if (!record) return;
      await clearPieces(tx, record);
      await tx.delete(metaKey(id));
    });
  }
  // Read the metadata and pieces from one snapshot, so removal or replacement in another tab cannot split the read.
  function read(id) {
    return backend.transaction('readonly', async tx => {
      const record = await tx.get(metaKey(id));
      if (!record?.complete) return null;
      const parts = [];
      for (let n = 0; n < record.chunks; n++) {
        const part = await tx.get(chunkKey(record, n)), { start, end } = chunkRange(record.size, n);
        if (part?.size !== end - start + 1) return null;
        parts.push(part);
      }
      return { record, file: new Blob(parts, { type: record.type }) };
    });
  }
  // Bytes on this device: every stored piece, finished or not.
  async function usage() {
    let bytes = 0, titles = 0;
    for (const record of await list()) { titles += record.complete ? 1 : 0; bytes += Math.min((record.have || 0) * CHUNK, record.size || 0); }
    return { bytes, titles };
  }
  // A subtitle added on this device to a saved title (works with no connection).
  async function addSubtitle(id, key, track, text) {
    return Boolean(await update(id, record => record?.complete ? { ...record,
      info: { ...record.info, subtitles: [...record.info.subtitles.filter(other => other.index !== track.index), track] },
      subtitles: { ...record.subtitles, [key]: text } } : null));
  }
  return { meta, list, enqueue, update, addSubtitle, download, remove, read, file: async id => (await read(id))?.file ?? null, usage };
}

export const resumable = record => ['queued', 'preparing', 'downloading'].includes(record?.state);
