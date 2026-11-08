const fs = require('node:fs/promises');
const path = require('node:path');
const { scan } = require('./scan');
const { probe } = require('./media');
const { tx } = require('./db');

// `autoProbe: false` is for one-shot tools such as the CLI, which should exit instead of probing every file.
function createLibrary(db, { autoProbe = true } = {}) {
  const q = {
    folders: db.prepare('SELECT id, path, added, (SELECT COUNT(*) FROM items WHERE folder_id = folders.id) AS items FROM folders ORDER BY path'),
    folder: db.prepare('SELECT * FROM folders WHERE id = ?'),
    byPath: db.prepare('SELECT * FROM folders WHERE path = ?'),
    addFolder: db.prepare('INSERT INTO folders (path, added) VALUES (?, ?)'),
    dropFolder: db.prepare('DELETE FROM folders WHERE id = ?'),
    existing: db.prepare('SELECT id, size, mtime FROM items WHERE folder_id = ?'),
    upsert: db.prepare(`INSERT INTO items (id, folder_id, path, title, group_id, group_title, year, kind, season, episode, size, mtime, added)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET folder_id = excluded.folder_id, title = excluded.title, group_id = excluded.group_id, group_title = excluded.group_title,
        year = excluded.year, kind = excluded.kind, season = excluded.season, episode = excluded.episode,
        probe = CASE WHEN items.size = excluded.size AND items.mtime = excluded.mtime THEN items.probe ELSE NULL END,
        duration = CASE WHEN items.size = excluded.size AND items.mtime = excluded.mtime THEN items.duration ELSE NULL END,
        size = excluded.size, mtime = excluded.mtime`),
    dropItem: db.prepare('DELETE FROM items WHERE id = ?'),
    item: db.prepare('SELECT * FROM items WHERE id = ?'),
    setProbe: db.prepare('UPDATE items SET probe = ?, duration = ? WHERE id = ?'),
    unprobed: db.prepare('SELECT id, path FROM items WHERE probe IS NULL LIMIT 1')
  };
  const state = { scanning: false, probing: false, lastScan: null };
  const pending = new Map();

  async function rescan(folderId) {
    const folder = q.folder.get(folderId);
    if (!folder) throw new Error('Unknown folder.');
    let rows;
    try { rows = await scan(folder.path); }
    catch (error) { return { folder: folder.path, ok: false, error: error.code === 'ENOENT' ? 'Folder is not available.' : error.message }; }
    const known = new Map(q.existing.all(folderId).map(row => [row.id, row]));
    const now = Date.now();
    const stats = await Promise.all(rows.map(row => fs.stat(row.path).catch(() => null)));
    const live = rows.map((row, i) => [row, stats[i]]).filter(([, stat]) => stat);
    tx(db, () => {
      for (const [row, stat] of live) {
        q.upsert.run(row.id, folderId, row.path, row.title, row.groupId, row.groupTitle, row.year ?? null, row.kind, row.season, row.episode, stat.size, Math.floor(stat.mtimeMs), now);
        known.delete(row.id);
      }
      // Files that vanished from a folder we could read are gone from the catalog; their watch state goes with them.
      for (const id of known.keys()) q.dropItem.run(id);
    });
    if (autoProbe) probeSoon();
    return { folder: folder.path, ok: true, items: live.length, removed: known.size };
  }
  async function rescanAll() {
    if (state.scanning) return state.last;
    state.scanning = true;
    try {
      const results = [];
      for (const folder of q.folders.all()) results.push(await rescan(folder.id));
      state.last = { at: Date.now(), results };
      return state.last;
    } finally { state.scanning = false; }
  }

  async function addFolder(input) {
    const resolved = path.resolve(String(input || ''));
    let stat; try { stat = await fs.stat(resolved); } catch { throw Object.assign(new Error('That folder does not exist on the server.'), { status: 400 }); }
    if (!stat.isDirectory()) throw Object.assign(new Error('That path is not a folder.'), { status: 400 });
    if (q.byPath.get(resolved)) throw Object.assign(new Error('That folder is already in the library.'), { status: 409 });
    const { lastInsertRowid } = q.addFolder.run(resolved, Date.now());
    const result = await rescan(Number(lastInsertRowid));
    return { id: Number(lastInsertRowid), ...result };
  }

  // Durations and codecs come from ffprobe, filled in one file at a time so a big scan does not starve playback.
  async function probeItem(item) {
    if (pending.has(item.id)) return pending.get(item.id);
    const task = (async () => {
      const info = await probe(item.path);
      q.setProbe.run(JSON.stringify(info), info.duration || null, item.id);
      return info;
    })().finally(() => pending.delete(item.id));
    pending.set(item.id, task);
    return task;
  }
  async function info(item) {
    if (item.probe) return JSON.parse(item.probe);
    return probeItem(item);
  }
  function probeSoon() {
    if (state.probing) return;
    state.probing = true;
    (async () => {
      for (let row; (row = q.unprobed.get());) {
        try { await probeItem(row); } catch { q.setProbe.run(JSON.stringify({ duration: 0, video: null, audio: [], subtitles: [], chapters: [], broken: true }), null, row.id); }
      }
    })().finally(() => { state.probing = false; });
  }
  return { folders: () => q.folders.all(), addFolder, removeFolder: id => q.dropFolder.run(id), rescan, rescanAll, item: id => q.item.get(id), info, probeSoon, state, byPath: p => q.byPath.get(p) };
}
module.exports = { createLibrary };
