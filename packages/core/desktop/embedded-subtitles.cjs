const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const MAX_BYTES = 16 * 1024 * 1024;
const validVTT = value => typeof value === 'string' && /^\uFEFF?WEBVTT(?:\r?\n|$)/.test(value) && Buffer.byteLength(value) <= MAX_BYTES;
function createEmbeddedSubtitles({ dir, stat, probe, remote, extractLocal }) {
  const pending = new Map();
  async function load(file, index) {
    if (!Number.isInteger(index) || index < 0 || index > 10000) throw new Error('Invalid subtitle track.');
    const source = await stat(file);
    if (!source.isFile()) throw new Error('The movie is no longer available.');
    const key = createHash('sha256').update(JSON.stringify([1, file, source.size, source.mtimeMs, index])).digest('hex');
    const cached = path.join(dir, key + '.vtt');
    try {
      const size = (await fs.stat(cached)).size;
      if (size <= MAX_BYTES) { const value = await fs.readFile(cached, 'utf8'); if (validVTT(value)) return value; }
    } catch { /* A missing/unreadable cache is safe to regenerate. */ }
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const info = await probe(file);
      if (!info.subtitles.some(track => track.index === index && track.text)) throw new Error('Choose an embedded text subtitle track. Bitmap tracks use video rendering.');
      const value = remote.isRemote(file) ? await remote.extractSubtitles(file, index) : await extractLocal(file, index);
      if (!validVTT(value)) throw new Error('Embedded subtitles did not produce valid WebVTT text, or exceeded 16 MiB.');
      const temporary = cached + '.' + randomUUID() + '.tmp';
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(temporary, value, { mode: 0o600 }); await fs.rename(temporary, cached);
      } catch { /* Cache failures must not prevent subtitles from loading. */ }
      finally { await fs.unlink(temporary).catch(() => {}); }
      return value;
    })().finally(() => pending.delete(key));
    pending.set(key, task); return task;
  }
  return { load };
}
module.exports = { createEmbeddedSubtitles, validVTT, MAX_BYTES };
