const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { locateTitles } = require('./media-scan.cjs');

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = text => text.replace(/&(?:amp|lt|gt|quot|apos);/g, match => entities[match.slice(1, -1)]).trim();

function readNfo(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return {};
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  const decodeValue = raw => {
    const value = (raw || '').trim();
    if (value.startsWith('<![CDATA[') && value.endsWith(']]>')) return value.slice(9, -3).trim();
    return decode(value.replace(/<[^>]*>/g, ''));
  };
  const tag = name => decodeValue(new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)<\\/' + name + '\\s*>', 'i').exec(text)?.[1]);
  const title = tag('title').slice(0, 300), overview = tag('plot').slice(0, 5000), year = tag('year');
  const id = tag('tmdbid') || decodeValue(/<uniqueid\b[^>]*\btype\s*=\s*["']tmdb["'][^>]*>([\s\S]*?)<\/uniqueid\s*>/i.exec(text)?.[1]);
  return {
    ...(title ? { title } : {}), ...(overview ? { overview } : {}),
    ...(/^\d{4}$/.test(year) ? { year } : {}),
    ...(/^[1-9]\d{0,8}$/.test(id) ? { tmdbId: Number(id) } : {}),
  };
}
async function regularFile(file, maxSize) {
  const stat = await fs.lstat(file);
  return stat.isFile() && stat.size > 0 && stat.size <= maxSize ? stat : null;
}

// Only JPEG art is read (poster.jpg, <name>-poster.jpg, fanart.jpg, folder.jpg, ...). PNG and WebP files are ignored.
// With `partial`, the files cached for other titles are kept for the next read.
function createLocalMetadata(artwork, keyFor) {
  let files = new Map();
  return async (items, partial = false) => {
    const roots = new Map(), directoryFor = new Map(), directories = new Map(), jobs = new Map();
    for (const item of items) {
      if (!path.isAbsolute(item.path || '') || (item.kind !== 'movie' && item.kind !== 'show')) continue;
      if (item.root) {
        if (!roots.has(item.root)) roots.set(item.root, []);
        roots.get(item.root).push(item.path);
      }
    }
    for (const [root, paths] of roots) {
      for (const { file, folder } of locateTitles(root, paths)) {
        if (!folder) continue;
        const relative = path.relative(root, folder);
        if (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) directoryFor.set(file, folder);
      }
    }
    for (const item of items) {
      if (!path.isAbsolute(item.path || '') || (item.kind !== 'movie' && item.kind !== 'show')) continue;
      const key = keyFor(item), dir = directoryFor.get(item.path) || path.dirname(item.path);
      if (!directories.has(dir)) directories.set(dir, new Set());
      directories.get(dir).add(key);
      if (!jobs.has(key)) jobs.set(key, { item, dir });
    }
    const results = {}, names = new Map(), currentFiles = new Map();
    async function find(dir, allowed, maxSize, convert) {
      if (!names.has(dir)) names.set(dir, fs.readdir(dir).catch(() => []));
      const entries = await names.get(dir);
      for (const name of allowed) {
        const actual = entries.find(entry => entry.toLowerCase() === name.toLowerCase());
        if (!actual) continue;
        const file = path.join(dir, actual);
        try {
          const stat = await regularFile(file, maxSize);
          if (!stat) continue;
          const signature = stat.size + ':' + stat.mtimeMs + ':' + stat.ctimeMs;
          const cached = files.get(file);
          let value = cached?.signature === signature ? cached.value : undefined;
          // A copy dropped as stale must be written again.
          if (typeof value === 'string' && !(await fs.stat(path.join(artwork, path.basename(value))).catch(() => null))) value = undefined;
          if (value === undefined) {
            const handle = await fs.open(file, 'r');
            try {
              const opened = await handle.stat();
              if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size) continue;
              const buffer = Buffer.alloc(stat.size + 1);
              const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
              if (bytesRead !== stat.size) continue;
              value = await convert(buffer.subarray(0, bytesRead));
            } finally { await handle.close(); }
          }
          currentFiles.set(file, { signature, value });
          if (value) return value;
        } catch { /* An unavailable sidecar leaves the other candidates usable. */ }
      }
      return null;
    }
    async function image(bytes) {
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
      const name = 'local-' + createHash('sha256').update(bytes).digest('hex') + '.jpg';
      const target = path.join(artwork, name);
      if (!(await fs.stat(target).catch(() => null))) {
        const temporary = target + '.' + randomUUID() + '.tmp';
        try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, target); }
        finally { await fs.rm(temporary, { force: true }); }
      }
      return 'artwork/' + name;
    }
    const nfoFile = bytes => {
      const value = readNfo(bytes.toString('utf8'));
      return Object.keys(value).length ? value : null;
    };
    for (const [key, { item, dir }] of jobs) {
      const videoDir = path.dirname(item.path), single = directories.get(dir).size === 1;
      const video = path.basename(item.path, path.extname(item.path)), folder = path.basename(dir);
      const sameName = item.kind === 'movie' ? [video] : [folder];
      const candidates = (suffix, generic) => [...new Set([...sameName, folder].filter((name, i) => i === 0 || single))]
        .map(name => name + suffix).concat(single ? generic : []);
      const findImage = async (suffix, generic) => (item.kind === 'movie' && videoDir !== dir
        ? await find(videoDir, [video + suffix], 20 * 1024 * 1024, image) : null)
        || await find(dir, candidates(suffix, generic), 20 * 1024 * 1024, image);
      const nfo = (item.kind === 'movie' && videoDir !== dir ? await find(videoDir, [video + '.nfo'], 256 * 1024, nfoFile) : null)
        || await find(dir, candidates('.nfo', item.kind === 'movie' ? ['movie.nfo'] : ['tvshow.nfo']), 256 * 1024, nfoFile);
      const poster = await findImage('-poster.jpg', ['poster.jpg', 'folder.jpg']);
      const backdrop = await findImage('-fanart.jpg', ['fanart.jpg']);
      if (poster || backdrop || (nfo && Object.keys(nfo).length)) {
        results[key] = { ...nfo, ...(poster ? { poster } : {}), ...(backdrop ? { backdrop } : {}) };
      }
    }
    files = partial ? new Map([...files, ...currentFiles]) : currentFiles;
    return results;
  };
}
module.exports = { createLocalMetadata, readNfo };
