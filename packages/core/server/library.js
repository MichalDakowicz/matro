const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { scan } = require('./scan');
const { probe } = require('./media');
const { HttpError } = require('./http');
const { tx } = require('./db');

const contains = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const maxRemovedShare = 0.25;
const minute = 60 * 1000;
const probeUnavailable = failures => failures >= 3
  ? new HttpError(422, 'This file could not be read. It may be damaged or unsupported.')
  : new HttpError(503, 'This file is temporarily unreadable. Try again in a moment.');
const sourceChanged = () => new HttpError(503, 'This file changed during inspection. Try again after the library refreshes.');

async function sourceStat(file) {
  const stat = await fs.stat(file, { bigint: true });
  if (!stat.isFile()) throw new Error('The media path is no longer a file.');
  return { size: Number(stat.size), mtime: Number(stat.mtimeMs), fingerprint: [stat.size, stat.mtimeNs, stat.ino || ''].join(':') };
}

// `autoProbe: false` is for one-shot tools such as the CLI, which should exit instead of probing every file.
function createLibrary(db, { autoProbe = true, excludedFiles, onChange, probeFile = probe } = {}) {
  const q = {
    folders: db.prepare('SELECT id, path, added, (SELECT COUNT(*) FROM active_items WHERE folder_id = f.id) AS items FROM active_folders f ORDER BY path'),
    roots: db.prepare('SELECT id, path, canonical_path FROM active_folders ORDER BY length(path), path'),
    folder: db.prepare('SELECT * FROM active_folders WHERE id = ?'),
    byPath: db.prepare('SELECT * FROM folders WHERE path = ?'),
    addFolder: db.prepare(`INSERT INTO folders (path, canonical_path, added) VALUES (?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET removed = 0, canonical_path = excluded.canonical_path, added = excluded.added RETURNING id`),
    dropFolder: db.prepare('UPDATE folders SET removed = 1 WHERE id = ? AND removed = 0'),
    moveItem: db.prepare('UPDATE items SET folder_id = ? WHERE id = ?'),
    existing: db.prepare('SELECT id, path FROM active_items WHERE folder_id = ?'),
    showGroups: db.prepare("SELECT DISTINCT group_id FROM items WHERE folder_id = ? AND kind = 'show'"),
    // Catalogs from before fingerprints keep their probes while size and mtime still match.
    upsert: db.prepare(`INSERT INTO items (id, folder_id, path, title, group_id, group_title, year, kind, season, episode, size, mtime, added, fingerprint, edition_group, edition_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET folder_id = excluded.folder_id, title = excluded.title, group_id = excluded.group_id, group_title = excluded.group_title,
        year = excluded.year, kind = excluded.kind, season = excluded.season, episode = excluded.episode, removed = 0,
        probe = CASE WHEN (items.fingerprint = excluded.fingerprint OR (items.fingerprint IS NULL AND items.size = excluded.size AND items.mtime = excluded.mtime)) THEN items.probe END,
        duration = CASE WHEN (items.fingerprint = excluded.fingerprint OR (items.fingerprint IS NULL AND items.size = excluded.size AND items.mtime = excluded.mtime)) THEN items.duration END,
        probe_failures = CASE WHEN items.fingerprint = excluded.fingerprint THEN items.probe_failures ELSE 0 END,
        probe_error = CASE WHEN items.fingerprint = excluded.fingerprint THEN items.probe_error END,
        probed_at = CASE WHEN items.fingerprint = excluded.fingerprint THEN items.probed_at END,
        retry_probe_after = CASE WHEN items.fingerprint = excluded.fingerprint THEN items.retry_probe_after END,
        edition_group = excluded.edition_group, edition_label = excluded.edition_label,
        size = excluded.size, mtime = excluded.mtime, fingerprint = excluded.fingerprint
      WHERE items.removed = 1 OR items.folder_id != excluded.folder_id OR items.title != excluded.title
        OR items.group_id != excluded.group_id OR items.group_title != excluded.group_title OR items.year IS NOT excluded.year
        OR items.kind != excluded.kind OR items.season IS NOT excluded.season OR items.episode IS NOT excluded.episode
        OR items.edition_group IS NOT excluded.edition_group OR items.edition_label IS NOT excluded.edition_label
        OR items.fingerprint IS NOT excluded.fingerprint`),
    dropItem: db.prepare('UPDATE items SET removed = 1 WHERE id = ?'),
    item: db.prepare('SELECT * FROM active_items WHERE id = ?'),
    setProbe: db.prepare(`UPDATE items SET probe = ?, duration = ?, probe_failures = 0, probe_error = NULL, probed_at = ?, retry_probe_after = NULL
      WHERE id = ? AND fingerprint IS ? AND removed = 0`),
    setProbeFailure: db.prepare(`UPDATE items SET probe_failures = ?, probe_error = ?, probed_at = ?, retry_probe_after = ?
      WHERE id = ? AND fingerprint IS ? AND removed = 0`),
    unprobed: db.prepare(`SELECT rowid, id, path, fingerprint, probe_failures FROM items
      WHERE rowid > ? AND removed = 0 AND probe IS NULL AND COALESCE(retry_probe_after, 0) <= ? ORDER BY rowid LIMIT 1`),
    nextRetry: db.prepare(`SELECT MIN(retry_probe_after) AS at FROM items
      WHERE removed = 0 AND probe IS NULL AND retry_probe_after > ?`)
  };
  const state = { scanning: false, probing: false, lastScan: null, revision: randomUUID() };
  const pending = new Map(), folderScans = new Map();
  let allFoldersScan, folderAdds = Promise.resolve(), probeAgain = false, retryTimer;
  const changed = () => { state.revision = randomUUID(); onChange?.(); };

  async function scanFolder(folderId) {
    const folder = q.folder.get(folderId);
    if (!folder) return { ok: false, error: 'Folder was removed from the library.' };
    let rows;
    const knownShows = new Set(q.showGroups.all(folderId).map(row => row.group_id));
    try { rows = await scan(folder.path, excludedFiles, knownShows); }
    catch (error) { return { folder: folder.path, ok: false, error: error.code === 'ENOENT' ? 'Folder is not available.' : error.message }; }
    const known = new Set(q.existing.all(folderId).map(row => row.id));
    const previousCount = known.size;
    const now = Date.now();
    const stats = await Promise.all(rows.map(row => sourceStat(row.path).catch(() => null)));
    const live = rows.map((row, i) => [row, stats[i]]).filter(([, stat]) => stat);
    if (q.folder.get(folderId)?.added !== folder.added) return { folder: folder.path, ok: false, error: 'Folder was removed from the library.' };
    for (const [row] of live) known.delete(row.id);
    let error;
    if (live.length !== rows.length) error = 'Some media files could not be read. Existing titles were kept.';
    else if (previousCount && !live.length) error = 'No media files were found. Existing titles were kept.';
    else if (known.size > Math.max(1, previousCount * maxRemovedShare)) error = 'More than 25% of this folder is missing. Existing titles were kept.';
    let catalogChanged = false;
    tx(db, () => {
      for (const [row, stat] of live) {
        const result = q.upsert.run(row.id, folderId, row.path, row.title, row.groupId, row.groupTitle, row.year,
          row.kind, row.season, row.episode, stat.size, stat.mtime, now, stat.fingerprint, row.editionGroup, row.editionLabel);
        catalogChanged ||= result.changes > 0;
      }
      if (!error) for (const id of known) { q.dropItem.run(id); catalogChanged = true; }
    });
    if (catalogChanged) changed();
    if (autoProbe) probeSoon();
    if (error) return { folder: folder.path, ok: false, error, items: q.existing.all(folderId).length, removed: 0 };
    return { folder: folder.path, ok: true, items: live.length, removed: known.size };
  }
  function rescan(folderId) {
    const prior = folderScans.get(folderId) || Promise.resolve();
    const task = prior.catch(() => {}).then(() => scanFolder(folderId)).finally(() => {
      if (folderScans.get(folderId) === task) folderScans.delete(folderId);
    });
    folderScans.set(folderId, task);
    return task;
  }
  function rescanAll() {
    if (allFoldersScan) return allFoldersScan;
    state.scanning = true;
    allFoldersScan = (async () => {
      const results = [];
      for (const folder of q.folders.all()) results.push(await rescan(folder.id));
      state.lastScan = { at: Date.now(), results };
      return state.lastScan;
    })().finally(() => { state.scanning = false; allFoldersScan = null; });
    return allFoldersScan;
  }

  const canonicalRoots = () => Promise.all(q.roots.all().map(async folder => ({
    ...folder, canonical: await fs.realpath(folder.path).catch(() => folder.canonical_path ?? folder.path)
  })));

  async function addFolder(input) {
    const resolved = path.resolve(String(input || ''));
    const added = folderAdds.then(async () => {
      let canonical, stat;
      try { canonical = await fs.realpath(resolved); stat = await fs.stat(canonical); }
      catch { throw new HttpError(400, 'That folder does not exist on the server.'); }
      if (!stat.isDirectory()) throw new HttpError(400, 'That path is not a folder.');
      for (const folder of await canonicalRoots()) {
        if (!q.folder.get(folder.id)) continue;
        if (contains(folder.canonical, canonical) && contains(canonical, folder.canonical)) {
          throw new HttpError(409, 'That folder is already in the library.');
        }
        if (contains(folder.path, resolved) || contains(resolved, folder.path) ||
            contains(folder.canonical, canonical) || contains(canonical, folder.canonical)) {
          throw new HttpError(409, 'That folder overlaps a folder already in the library.');
        }
      }
      // Keep the registered path for file IDs, even when it is a symlink or a junction.
      const previous = q.byPath.get(resolved);
      return q.addFolder.get(resolved, canonical, Math.max(Date.now(), (previous?.added ?? 0) + 1));
    });
    folderAdds = added.catch(() => {});
    const { id } = await added;
    changed();
    return { id, ...await rescan(id) };
  }

  async function coveringFolder(input) {
    const direct = q.byPath.get(input);
    if (direct?.removed === 0) return direct;
    const canonical = await fs.realpath(input).catch(() => null);
    if (!canonical) return undefined;
    return (await canonicalRoots()).find(folder => contains(folder.canonical, canonical) && q.folder.get(folder.id));
  }

  function removeFolder(id) {
    const removed = tx(db, () => {
      if (!q.dropFolder.run(id).changes) return false;
      const remaining = q.roots.all();
      for (const item of q.existing.all(id)) {
        // Older catalogs could register overlapping roots. Keep items still covered by one.
        const owner = remaining.find(folder => contains(folder.path, item.path));
        if (owner) q.moveItem.run(owner.id, item.id);
        else q.dropItem.run(item.id);
      }
      return true;
    });
    if (removed) changed();
  }

  // Durations and codecs come from ffprobe, filled in one file at a time so a big scan does not starve playback.
  async function inspectSource(item) {
    let before, info, failure;
    try { before = await sourceStat(item.path); } catch (error) { failure = error; }
    if (before) {
      if (item.fingerprint && before.fingerprint !== item.fingerprint) throw sourceChanged();
      let after;
      try { info = await probeFile(item.path); } catch (error) { failure = error; }
      try { after = await sourceStat(item.path); } catch (error) { failure = error; }
      if (after && before.fingerprint !== after.fingerprint) throw sourceChanged();
    }
    const now = Date.now();
    if (failure) {
      const failures = item.probe_failures + 1;
      const retryAfter = now + Math.min(60, 2 ** (failures - 1)) * minute;
      if (!q.setProbeFailure.run(failures, String(failure.message || failure).slice(0, 1000), now, retryAfter, item.id, item.fingerprint).changes) throw sourceChanged();
      throw probeUnavailable(failures);
    }
    if (!q.setProbe.run(JSON.stringify(info), info.duration || null, now, item.id, item.fingerprint).changes) throw sourceChanged();
    return info;
  }
  function probeItem(item) {
    const key = `${item.id}:${item.fingerprint}`;
    if (pending.has(key)) return pending.get(key);
    const task = inspectSource(item).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }
  async function info(item) {
    item = q.item.get(item.id);
    if (!item) throw new HttpError(404, 'That title is not in the library.');
    if (item.probe) return JSON.parse(item.probe);
    if (item.retry_probe_after > Date.now()) throw probeUnavailable(item.probe_failures);
    return probeItem(item);
  }
  function probeSoon() {
    if (state.probing) { probeAgain = true; return; }
    clearTimeout(retryTimer);
    state.probing = true;
    (async () => {
      // An already-due row is tried once per pass. A stale file otherwise
      // keeps its old deadline until the next rescan notices the change.
      const started = Date.now();
      let cursor = 0;
      for (let row; (row = q.unprobed.get(cursor, started));) {
        cursor = row.rowid;
        try { await probeItem(row); } catch { /* A failed probe can be retried after its backoff. */ }
      }
      const { at } = q.nextRetry.get(started);
      if (at !== null) retryTimer = setTimeout(probeSoon, Math.max(0, at - Date.now())).unref();
    })().catch(() => { /* The database can close during a background probe. */ }).finally(() => {
      state.probing = false;
      if (probeAgain) { probeAgain = false; probeSoon(); }
    });
  }
  return { folders: () => q.folders.all(), addFolder, removeFolder, rescan, rescanAll, item: id => q.item.get(id), info, probeSoon, state,
    byPath: p => { const folder = q.byPath.get(p); return folder?.removed === 0 ? folder : undefined; }, coveringFolder };
}
module.exports = { createLibrary };
