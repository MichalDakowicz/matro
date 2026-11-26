const fs = require('node:fs/promises');
const path = require('node:path');

// Frames and extracted subtitles share one disk budget. Artwork and playback
// preparations are stored separately.
function createAssetCache(dataDir, { maxBytes = 256 * 1024 ** 2 } = {}) {
  const root = path.join(dataDir, 'cache');
  const files = new Map();
  let total = 0;

  async function prune() {
    if (total <= maxBytes) return;
    for (const [file, entry] of [...files].sort((a, b) => a[1].used - b[1].used)) {
      if (total <= maxBytes) break;
      try { await fs.rm(file, { force: true }); } catch { continue; }
      files.delete(file);
      total -= entry.size;
    }
  }

  const ready = (async () => {
    for (const [kind, ext] of [['frames', '.jpg'], ['subs', '.vtt']]) {
      const dir = path.join(root, kind);
      const names = await fs.readdir(dir).catch(() => []);
      for (const name of names) {
        const file = path.join(dir, name);
        if (!name.endsWith(ext) && !name.endsWith('.tmp')) continue;
        const stat = await fs.stat(file).catch(() => null);
        if (!stat?.isFile()) continue;
        // Temporary files left by a previous interrupted write aren't usable.
        if (name.endsWith('.tmp') && Date.now() - stat.mtimeMs > 3600000) {
          try { await fs.rm(file); continue; } catch { /* Count it if removal failed. */ }
        }
        files.set(file, { size: stat.size, used: stat.mtimeMs });
        total += stat.size;
      }
    }
    await prune();
  })();
  let writes = ready;
  return {
    async read(kind, name, encoding) {
      await ready;
      const file = path.join(root, kind, name);
      const data = await fs.readFile(file, encoding).catch(() => null);
      const entry = files.get(file);
      if (data !== null && entry) entry.used = Date.now();
      return data;
    },
    write(kind, name, data) {
      const size = Buffer.byteLength(data);
      if (size > maxBytes) return;
      const dir = path.join(root, kind), file = path.join(dir, name), temporary = file + '.tmp';
      writes = writes.then(async () => {
        await fs.mkdir(dir, { recursive: true });
        try {
          await fs.writeFile(temporary, data);
          await fs.rename(temporary, file);
        } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
        total += size - (files.get(file)?.size || 0);
        files.set(file, { size, used: Date.now() });
        await prune();
      }).catch(() => {});
      return writes;
    }
  };
}

module.exports = { createAssetCache };
