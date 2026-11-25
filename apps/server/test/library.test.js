const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { open } = require('../../../packages/core/server/db');
const { createLibrary } = require('../../../packages/core/server/library');
const { idFor } = require('../../../packages/core/server/scan');

async function temporaryDirectory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('an existing catalog keeps uploads through incomplete scans, drops and folder removal', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-library-'));
  let db;
  t.after(async () => {
    db?.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const media = path.join(root, 'Media'), nested = path.join(media, 'Nested');
  await fs.mkdir(nested, { recursive: true });
  const file = path.join(nested, 'Film.mkv'), id = idFor(file), database = path.join(root, 'matro.db');
  await fs.writeFile(file, 'film');
  const legacy = new DatabaseSync(database);
  legacy.exec(`
    CREATE TABLE folders (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, added INTEGER NOT NULL);
    CREATE TABLE items (
      id TEXT PRIMARY KEY, folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE, path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL, group_id TEXT NOT NULL, group_title TEXT NOT NULL, year INTEGER,
      kind TEXT NOT NULL CHECK (kind IN ('movie', 'show')), season INTEGER, episode INTEGER,
      size INTEGER NOT NULL, mtime INTEGER NOT NULL, added INTEGER NOT NULL, duration REAL, probe TEXT
    );
    CREATE TABLE subtitles (
      id INTEGER PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, name TEXT NOT NULL, language TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'full' CHECK (kind IN ('full', 'forced', 'sdh')), vtt TEXT NOT NULL, created INTEGER NOT NULL
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, hash TEXT, role TEXT, created INTEGER);
  `);
  legacy.prepare('INSERT INTO folders VALUES (1, ?, 1)').run(media);
  legacy.prepare(`INSERT INTO items (id, folder_id, path, title, group_id, group_title, kind, size, mtime, added, probe)
    VALUES (?, 1, ?, 'Film', 'legacy', 'Film', 'movie', 4, 1, 1, '{"broken":true}')`).run(id, file);
  legacy.prepare("INSERT INTO subtitles (id, item_id, name, language, vtt, created) VALUES (42, ?, 'English', 'en', 'WEBVTT', 1)").run(id);
  legacy.close();

  db = open(database);
  const library = createLibrary(db, { autoProbe: false });
  assert.equal(library.item(id).probe, null);
  const subtitle = db.prepare('SELECT id, item_id FROM subtitles WHERE item_id = ?');
  const assertUpload = () => assert.deepEqual({ ...subtitle.get(id) }, { id: 42, item_id: id });
  assertUpload();
  for (const title of ['City Lights', 'Modern Times', 'The Kid']) await fs.writeFile(path.join(media, title + '.mkv'), '');
  assert.equal((await library.rescan(1)).items, 4);

  const readdir = fs.readdir;
  const fault = t.mock.method(fs, 'readdir', async (directory, options) => {
    if (directory === nested) throw Object.assign(new Error('Simulated NAS error'), { code: 'EIO' });
    return readdir(directory, options);
  });
  assert.equal((await library.rescan(1)).ok, false);
  assert.equal(library.folders()[0].items, 4);
  fault.mock.restore();

  const held = path.join(root, 'held');
  await fs.rename(media, held);
  await fs.mkdir(media);
  assert.match((await library.rescan(1)).error, /No media files/);
  assert.ok(library.item(id));
  await fs.rename(path.join(held, 'City Lights.mkv'), path.join(media, 'City Lights.mkv'));
  assert.match((await library.rescan(1)).error, /More than 25%/);
  assert.equal(library.folders()[0].items, 4);
  for (const title of ['Modern Times', 'The Kid']) await fs.rename(path.join(held, title + '.mkv'), path.join(media, title + '.mkv'));
  assert.equal((await library.rescan(1)).removed, 1);
  assert.equal(library.item(id), undefined);
  assertUpload();

  await fs.rename(path.join(held, 'Nested'), nested);
  assert.equal((await library.rescan(1)).items, 4);
  assert.equal(library.item(id).added, 1);
  assertUpload();
  library.removeFolder(1);
  assert.deepEqual(library.folders(), []);
  assert.equal(library.item(id), undefined);
  assertUpload();
  assert.equal((await library.addFolder(media)).id, 1);
  assert.ok(library.item(id));
  assertUpload();
});

test('canonical overlaps are rejected and removing a legacy overlap keeps its covered items', async t => {
  const root = await temporaryDirectory(t);
  const outer = path.join(root, 'Media'), inner = path.join(outer, 'Show'), alias = path.join(root, 'Alias');
  await fs.mkdir(inner, { recursive: true });
  await fs.symlink(inner, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const file = path.join(inner, 'Show.S01E01.mkv');
  await fs.writeFile(file, '');
  const db = open(':memory:');
  t.after(() => db.close());
  const library = createLibrary(db, { autoProbe: false });
  const id = idFor(file);
  const outerFolder = (await library.addFolder(outer)).id;
  await assert.rejects(library.addFolder(alias), { status: 409 });
  await assert.rejects(library.addFolder(inner), { status: 409 });
  await assert.rejects(library.addFolder(root), { status: 409 });

  const legacyInner = Number(db.prepare('INSERT INTO folders (path, added) VALUES (?, 1)').run(inner).lastInsertRowid);
  await library.rescan(legacyInner);
  assert.equal(library.item(id).folder_id, legacyInner);
  library.removeFolder(legacyInner);
  assert.equal(library.item(id).folder_id, outerFolder);
});

test('a probe of a replaced file cannot overwrite its new metadata', async t => {
  const root = await temporaryDirectory(t);
  const file = path.join(root, 'Film.mkv'), replacement = path.join(root, 'replacement.tmp');
  const time = new Date('2024-01-01T00:00:00Z');
  for (const [target, content] of [[file, 'old'], [replacement, 'new']]) {
    await fs.writeFile(target, content);
    await fs.utimes(target, time, time);
  }
  const started = Promise.withResolvers(), oldProbe = Promise.withResolvers();
  const db = open(':memory:');
  t.after(() => db.close());
  let probes = 0;
  const library = createLibrary(db, { autoProbe: false, probeFile: () => {
    if (probes++ === 0) { started.resolve(); return oldProbe.promise; }
    return { duration: 20 };
  } });
  const { id: folder } = await library.addFolder(root);
  const id = idFor(file), original = library.item(id);
  const stale = assert.rejects(library.info(original), { status: 503 });
  await started.promise;
  await fs.rename(replacement, file);
  await library.rescan(folder);
  const updated = library.item(id);
  assert.equal(updated.size, original.size);
  assert.equal(updated.mtime, original.mtime);
  assert.notEqual(updated.fingerprint, original.fingerprint);
  assert.equal((await library.info(updated)).duration, 20);
  oldProbe.resolve({ duration: 10 });
  await stale;
  assert.equal(library.item(id).duration, 20);
});

test('an existing unnumbered show keeps its group ID through a server rescan', async t => {
  const root = await temporaryDirectory(t);
  const show = path.join(root, 'Existing Show');
  await fs.mkdir(show);
  const paths = ['Pilot.mkv', 'Finale.mkv'].map(name => path.join(show, name));
  await Promise.all(paths.map(file => fs.writeFile(file, '')));
  const db = open(':memory:');
  t.after(() => db.close());
  db.prepare('INSERT INTO folders (id, path, added) VALUES (1, ?, 1)').run(show);
  const groupId = idFor('dir:' + show);
  const insert = db.prepare(`INSERT INTO items (id, folder_id, path, title, group_id, group_title, kind, size, mtime, added)
    VALUES (?, 1, ?, 'Old title', ?, 'Existing Show', 'show', 0, 0, 1)`);
  for (const file of paths) insert.run(idFor(file), file, groupId);
  const library = createLibrary(db, { autoProbe: false });
  assert.equal((await library.rescan(1)).ok, true);
  for (const file of paths) {
    const row = library.item(idFor(file));
    assert.equal(row.group_id, groupId);
    assert.equal(row.kind, 'show');
  }
});

test('background probing wakes at the earliest retry without another scan', { timeout: 5000 }, async t => {
  const root = await temporaryDirectory(t);
  const first = path.join(root, 'First.mkv'), next = path.join(root, 'Next.mkv');
  await Promise.all([fs.writeFile(first, ''), fs.writeFile(next, '')]);
  const db = open(':memory:');
  t.after(() => db.close());
  const tried = [];
  const library = createLibrary(db, { autoProbe: false, probeFile: async file => {
    tried.push(file);
    return { duration: 20 };
  } });
  await library.addFolder(root);
  const postpone = db.prepare('UPDATE items SET retry_probe_after = ? WHERE id = ?');
  const start = Date.now();
  postpone.run(start + 80, idFor(first));
  postpone.run(start + 200, idFor(next));
  library.probeSoon();
  assert.deepEqual(tried, []);
  while (!library.item(idFor(next)).probe) await delay(20);
  assert.deepEqual(tried, [first, next]);
});

test('device and change time changes preserve an existing probe', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-library-'));
  const file = path.join(root, 'Film.mkv'), id = idFor(file);
  await fs.writeFile(file, 'film');
  const catalog = path.join(root, 'matro.db');
  let db = open(catalog);
  // Windows cannot delete the catalog while it is open, and the directory hook runs first.
  t.after(() => { try { db.close(); } catch { /* already closed */ } return fs.rm(root, { recursive: true, force: true }); });
  const fileStat = await fs.stat(file, { bigint: true });
  const legacy = [fileStat.dev, fileStat.ino, fileStat.size, fileStat.mtimeNs, fileStat.ctimeNs].join(':');
  let attempts = 0;
  const probeFile = async () => { attempts++; return { duration: 20 }; };
  let library = createLibrary(db, { autoProbe: false, probeFile });
  const folder = await library.addFolder(root);
  await library.info(library.item(id));
  db.prepare('UPDATE items SET fingerprint = ? WHERE id = ?').run(legacy, id);
  db.close();
  db = open(catalog);
  library = createLibrary(db, { autoProbe: false, probeFile });

  const stat = fs.stat;
  t.mock.method(fs, 'stat', async (target, options) => {
    const result = await stat(target, options);
    if (target === file && options?.bigint) { result.dev += 1n; result.ctimeNs += 1n; }
    return result;
  });
  assert.equal((await library.rescan(folder.id)).ok, true);
  assert.equal((await library.info(library.item(id))).duration, 20);
  assert.equal(attempts, 1);
});

test('probes back off after errors and recover after repeated failures', async t => {
  const root = await temporaryDirectory(t);
  const file = path.join(root, 'Film.mkv'), id = idFor(file);
  await fs.writeFile(file, 'film');
  const db = open(':memory:');
  t.after(() => db.close());
  let attempts = 0, now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const library = createLibrary(db, { autoProbe: false, probeFile: async () => {
    if (++attempts <= 3) throw new Error('Temporary I/O error');
    return { duration: 20 };
  } });
  await library.addFolder(root);
  const info = () => library.info(library.item(id));
  for (const [failure, delay] of [[1, 60_000], [2, 120_000], [3, 240_000]]) {
    const status = failure < 3 ? 503 : 422;
    await assert.rejects(info(), { status });
    const row = library.item(id);
    assert.equal(row.probe_error, 'Temporary I/O error');
    assert.equal(row.probed_at, now);
    assert.equal(row.retry_probe_after, now + delay);
    await assert.rejects(info(), { status });
    assert.equal(attempts, failure);
    now += delay;
  }
  assert.equal((await info()).duration, 20);
  assert.equal(library.item(id).probe_error, null);
  assert.equal(library.item(id).probe_failures, 0);
});

test('cuts and encodes of one movie in a folder become editions of a single movie, not a show', async t => {
  const base = await temporaryDirectory(t), root = path.join(base, 'Media'), movie = path.join(root, 'Film (2020)'), other = path.join(root, 'Shows', 'Show');
  await fs.mkdir(movie, { recursive: true });
  await fs.mkdir(other, { recursive: true });
  const files = ['Film (2020).mkv', "Film (2020) Director's Cut.mkv", 'Film.2020.2160p.x265.mkv'].map(name => path.join(movie, name));
  for (const file of files) await fs.writeFile(file, 'x' + path.basename(file));
  await fs.mkdir(path.join(root, 'Solo (2019)'));
  await fs.writeFile(path.join(root, 'Solo (2019)', 'Solo (2019).mkv'), 'solo');
  await fs.writeFile(path.join(other, 'Show.S01E01.mkv'), 'e1');
  const db = open(':memory:');
  t.after(() => db.close());
  const library = createLibrary(db, { autoProbe: false });
  const { id } = await library.addFolder(root);
  const rows = Object.fromEntries(db.prepare('SELECT * FROM active_items').all().map(row => [path.basename(row.path), row]));
  const editions = files.map(file => rows[path.basename(file)]);
  assert.deepEqual([...new Set(editions.map(row => row.kind))], ['movie']);
  assert.equal(new Set(editions.map(row => row.edition_group)).size, 1);
  assert.ok(editions[0].edition_group);
  assert.equal(new Set(editions.map(row => row.group_title)).size, 1);
  assert.deepEqual(editions.map(row => row.edition_label), ['Film (2020)', "Director's Cut", '2160p · x265']);
  assert.equal(rows['Solo (2019).mkv'].edition_group, null);
  assert.equal(rows['Show.S01E01.mkv'].edition_group, null);
  const before = editions.map(row => row.id);
  const { idFor } = require('../../../packages/core/server/scan');
  db.prepare("UPDATE items SET kind = 'show', group_id = ?, season = 1, episode = 0, edition_group = NULL WHERE edition_group IS NOT NULL").run(idFor('dir:' + movie));
  await library.rescan(id);
  assert.deepEqual(db.prepare('SELECT id FROM active_items WHERE edition_group IS NOT NULL ORDER BY path').all().map(row => row.id).sort(), before.sort());
  await fs.rm(files[1]);
  await library.rescan(id);
  const rest = db.prepare('SELECT edition_group, kind FROM active_items WHERE path LIKE ?').all(movie + '%');
  assert.equal(rest.length, 2);
  assert.ok(rest.every(row => row.edition_group && row.kind === 'movie'));
});

test('unrelated movies sharing a folder stay separate movies', async t => {
  const root = path.join(await temporaryDirectory(t), 'Media'), folder = path.join(root, 'Double Bill');
  await fs.mkdir(folder, { recursive: true });
  for (const name of ['Alpha (2001).mkv', 'Beta (2002).mkv']) await fs.writeFile(path.join(folder, name), name);
  const db = open(':memory:');
  t.after(() => db.close());
  await createLibrary(db, { autoProbe: false }).addFolder(root);
  const rows = db.prepare('SELECT kind, edition_group FROM active_items').all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.kind === 'movie' && row.edition_group === null));
});
