// Posters, backdrops, cast and episode names from TMDB, using the desktop app's own matcher (src/vendor/metadata.cjs,
// copied by scripts/sync-ui.js). Credentials come from the environment (TMDB_ACCESS_TOKEN or TMDB_API_KEY, also the
// VITE_-prefixed names the desktop's .env uses). Without them the server works exactly as before, on generated covers.
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

let vendor = null;
try { vendor = require('./vendor/metadata.cjs'); } catch { /* run `npm run sync-ui` to enable TMDB */ }

// A tiny KEY=VALUE reader so a developer's .env next to the project works; real environment variables win.
function loadEnv(files) {
  const env = {};
  for (const file of files) {
    let text; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) { const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/); if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2'); }
  }
  return { ...env, ...process.env };
}

// What the matcher needs to know about a title, in the desktop's item shape.
const asItem = row => ({ id: row.id, kind: row.kind, group: row.year ? `${row.group_title} (${row.year})` : row.group_title, groupId: row.group_id, path: row.path, season: row.season });
const keyOf = item => item.kind === 'show' ? item.groupId || item.group : item.id;

function createTmdb(db, { fetchImpl = fetch, env = loadEnv([path.join(config.dataDir, '.env'), path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) } = {}) {
  const auth = vendor && vendor.credentials(env);
  const rows = db.prepare('SELECT id, kind, group_id, group_title, year, path, season FROM items');
  const items = () => rows.all().map(asItem);
  const dir = path.join(config.dataDir, 'tmdb');
  fs.mkdirSync(dir, { recursive: true });
  const meta = auth ? vendor.createMetadata({ dir, auth, fetch: (url, options) => fetchImpl(url, { signal: AbortSignal.timeout(20000), ...options }) }) : null;
  // Download matches share the image cache, but are not part of viewers' library metadata.
  const snapshot = () => Object.fromEntries(Object.entries(meta?.snapshot() || {}).filter(([key]) => !key.startsWith('download:')));
  return {
    enabled: !!meta,
    snapshot,
    async downloadArtwork(downloads) {
      if (!meta) return downloads;
      const titles = downloads.map(item => {
        const title = item.title || vendor.cleanQuery(item.name || ''), year = item.year || vendor.yearOf(item.name || '');
        const kind = item.kind === 'show' || (!item.kind && /\bS\d{1,2}(?:E\d{1,3})?\b|\b\d{1,2}x\d{2}\b/i.test(item.name || '')) ? 'show' : 'movie';
        const id = `download:${kind}:${title}:${year || ''}`;
        return { id, groupId: id, group: title + (year ? ` (${year})` : ''), kind, path: '', season: null };
      });
      await meta.sync(titles); // Matching is queued; download polling picks up newly cached images.
      const cached = meta.snapshot();
      return downloads.map((item, index) => {
        const match = cached[titles[index].id], banner = match?.backdrop || match?.poster;
        return { ...item, banner: banner ? `/api/${banner}` : null };
      });
    },
    sync: () => { if (meta) void meta.sync(items()); },
    artworkFile: name => meta?.artworkFile(name) || null,
    search: (kind, query, year) => meta ? meta.search(kind, query, year) : Promise.reject(new Error('TMDB is not configured on this server.')),
    async assign(key, tmdbId) {
      if (!meta) throw new Error('TMDB is not configured on this server.');
      const matching = items().filter(item => keyOf(item) === key);
      if (!matching.length) throw Object.assign(new Error('That title is no longer in the library.'), { status: 404 });
      await meta.assign(matching, tmdbId ?? null);
      return snapshot();
    }
  };
}
module.exports = { createTmdb, loadEnv };
