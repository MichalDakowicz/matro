// Saved-for-offline files, kept apart from the browser: a key-value backend (IndexedDB in the page, a Map in tests) holds one
// record per title plus its pieces. A file is pulled in CHUNK-sized byte ranges, so a dropped connection resumes where it
// stopped instead of starting over, and nothing larger than one piece is ever held in memory while downloading.
export const CHUNK = 8 * 1024 * 1024;

export const metaKey = id => `meta:${id}`;
export const chunkKey = (id, n) => `chunk:${id}:${n}`;
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
  return { get: async key => map.get(key), set: async (key, value) => { map.set(key, value); }, delete: async key => { map.delete(key); },
    keys: async prefix => [...map.keys()].filter(key => key.startsWith(prefix)) };
}

export function createStore(backend) {
  const meta = id => backend.get(metaKey(id));
  async function list() {
    const out = [];
    for (const key of await backend.keys('meta:')) { const record = await backend.get(key); if (record) out.push(record); }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }
  // Pulls every missing piece of `size` bytes through `fetchRange(start, end) -> Blob`. Pieces already stored are kept, so calling it
  // again after a failure resumes. Throws AbortError when `signal` fires, leaving the partial download in place.
  async function download({ id, size, type, info, subtitles = {}, title = '', fetchRange, onProgress = () => {}, signal }) {
    const total = chunkCount(size);
    let record = await meta(id);
    if (!record || record.size !== size) {
      if (record) await purge(id, record);
      record = { id, size, type, info, subtitles, title, chunks: total, have: 0, complete: false, savedAt: Date.now() };
    } else record = { ...record, info, subtitles, title, complete: false };
    let have = 0;
    while (have < total && await backend.get(chunkKey(id, have))) have++;
    record.have = have;
    await backend.set(metaKey(id), record);
    onProgress(have * CHUNK > size ? size : have * CHUNK, size);
    for (let n = have; n < total; n++) {
      if (signal?.aborted) throw new DOMException('Download paused.', 'AbortError');
      const { start, end } = chunkRange(size, n), blob = await fetchRange(start, end, got => onProgress(Math.min(size, start + got), size));
      if (blob.size !== end - start + 1) throw new Error('The server sent an incomplete piece.');
      await backend.set(chunkKey(id, n), blob);
      record.have = n + 1;
      await backend.set(metaKey(id), record);
      onProgress(end + 1, size);
    }
    record = { ...record, complete: true, savedAt: Date.now() };
    await backend.set(metaKey(id), record);
    return record;
  }
  async function purge(id, record) {
    const known = record ?? await meta(id);
    for (const key of await backend.keys(`chunk:${id}:`)) await backend.delete(key);
    await backend.delete(metaKey(id));
    return known;
  }
  // The finished file as one Blob (a view over the stored pieces, not a copy), or null when it was never completed.
  async function file(id) {
    const record = await meta(id);
    if (!record?.complete) return null;
    const parts = [];
    for (let n = 0; n < record.chunks; n++) { const part = await backend.get(chunkKey(id, n)); if (!part) return null; parts.push(part); }
    return new Blob(parts, { type: record.type });
  }
  // Bytes on this device: every stored piece, finished or not.
  async function usage() {
    let bytes = 0, titles = 0;
    for (const record of await list()) { titles += record.complete ? 1 : 0; bytes += Math.min(record.have * CHUNK, record.size); }
    return { bytes, titles };
  }
  // A subtitle added on this device to a saved title (works with no connection).
  async function addSubtitle(id, key, track, text) {
    const record = await meta(id);
    if (!record) return false;
    await backend.set(metaKey(id), { ...record, info: { ...record.info, subtitles: [...record.info.subtitles, track] }, subtitles: { ...record.subtitles, [key]: text } });
    return true;
  }
  return { meta, list, addSubtitle, download, remove: id => purge(id), file, usage };
}
