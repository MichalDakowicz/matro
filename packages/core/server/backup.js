const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { lockData } = require('./db');

// Uploaded subtitle text and manual markers are stored in matro.db.
const SIDE_FILES = ['segments.json', 'downloads.json', 'downloads.key', 'download-jobs.json', '.env', 'opensubtitles.key', path.join('tmdb', 'metadata.json')];
// Every backup records the app version and the database's PRAGMA user_version. Restoring refuses anything newer than this server,
// whose schema is still created in place (user_version 0): raise SCHEMA when a migration starts setting user_version.
const MANIFEST = 'backup.json', SCHEMA = 0, VERSION = require('../../../package.json').version;
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
function userVersion(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('PRAGMA user_version').get().user_version; } finally { db.close(); }
}
const stamp = () => new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-');
const dbFile = dir => path.join(dir, 'matro.db');

function snapshot(source, dest) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare('VACUUM INTO ?').run(dest);
  } finally {
    db.close();
  }
  fs.chmodSync(dest, 0o600);
}

function copyPrivate(source, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(dest, 0o600);
}

function copySideFiles(from, to) {
  const files = SIDE_FILES.filter(file => fs.existsSync(path.join(from, file)));
  for (const file of files) copyPrivate(path.join(from, file), path.join(to, file));
  return files;
}

function backup(dataDir, dest) {
  if (!fs.existsSync(dbFile(dataDir))) throw new Error(`There is no Matro database in ${dataDir}.`);
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  fs.mkdirSync(dest, { mode: 0o700 });
  try {
    // Write the database last so an interrupted copy cannot look like a complete backup.
    const files = copySideFiles(dataDir, dest);
    fs.writeFileSync(path.join(dest, MANIFEST), JSON.stringify({ version: VERSION, schema: userVersion(dbFile(dataDir)), created: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
    snapshot(dbFile(dataDir), path.join(dest, 'matro.db.tmp'));
    fs.renameSync(path.join(dest, 'matro.db.tmp'), dbFile(dest));
    return ['matro.db', ...files];
  } catch (error) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw error;
  }
}

function validateBackup(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
      throw new Error('The database failed its integrity check.');
    }
    db.prepare('SELECT id, username, hash FROM users LIMIT 1').get();
    db.prepare('SELECT id, path FROM items LIMIT 1').get();
  } finally {
    db.close();
  }
}

// Older servers have no data lock, but still hold their WAL open while running.
// Leaving WAL mode also makes SQLite checkpoint any changes left after an unclean stop.
function closeWal(file) {
  const db = new DatabaseSync(file);
  try {
    if (db.prepare('PRAGMA journal_mode = DELETE').get().journal_mode === 'delete') return;
  } catch (error) {
    if (![5, 6].includes(error.errcode & 0xff)) throw error;
  } finally {
    db.close();
  }
  throw new Error('The Matro server appears to be running. Stop it, then restore.');
}

function replaceFiles(dataDir, staged) {
  const replaced = [];
  try {
    for (const file of SIDE_FILES) {
      const target = path.join(dataDir, file);
      const previous = path.join(staged, 'previous', file);
      const next = path.join(staged, file);
      if (fs.existsSync(target)) {
        if (!fs.statSync(target).isFile()) throw new Error(`Expected a file at ${target}.`);
        fs.mkdirSync(path.dirname(previous), { recursive: true, mode: 0o700 });
        fs.renameSync(target, previous);
      }
      replaced.push({ target, previous });
      if (fs.existsSync(next)) {
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.renameSync(next, target);
      }
    }
    fs.renameSync(dbFile(staged), dbFile(dataDir));
  } catch (error) {
    for (const { target, previous } of replaced.reverse()) {
      if (fs.existsSync(previous)) fs.renameSync(previous, target);
      else fs.rmSync(target, { force: true });
    }
    throw error;
  }
}

function restore(dataDir, from) {
  if (!fs.existsSync(dbFile(from))) throw new Error(`${from} is not a Matro backup (it has no matro.db).`);
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(from, MANIFEST), 'utf8')); } catch { /* Backups made before manifests existed restore as before. */ }
  const schema = Math.max(Number(manifest.schema) || 0, (() => { try { return userVersion(dbFile(from)); } catch { return 0; } })());
  if ((manifest.version && newer(manifest.version, VERSION)) || schema > SCHEMA) {
    throw new Error(`This backup was made by a newer Matro (${manifest.version || 'unknown version'}, database version ${schema}); this server is ${VERSION}, database version ${SCHEMA}. Update Matro, then restore.`);
  }
  if (fs.existsSync(dataDir) && path.relative(fs.realpathSync(from), fs.realpathSync(dataDir)) === '') {
    throw new Error('The backup folder must differ from the active data folder.');
  }

  const unlock = lockData(dataDir);
  let staged, kept;
  try {
    const existing = fs.existsSync(dbFile(dataDir));
    if (existing) closeWal(dbFile(dataDir));
    staged = fs.mkdtempSync(path.join(dataDir, '.restoring-'));
    try {
      snapshot(dbFile(from), dbFile(staged));
      validateBackup(dbFile(staged));
    } catch (error) {
      throw new Error(`${from} is not a usable Matro backup: ${error.message}`);
    }
    const files = copySideFiles(from, staged);
    if (existing || SIDE_FILES.some(file => fs.existsSync(path.join(dataDir, file)))) {
      kept = path.join(dataDir, 'backups', `before-restore-${stamp()}`);
      if (existing) backup(dataDir, kept);
      else copySideFiles(dataDir, kept);
    }
    try {
      replaceFiles(dataDir, staged);
    } catch (error) {
      if (kept) throw new Error(`Restore failed. The previous state is saved in ${kept}. ${error.message}`);
      throw error;
    }
    return { kept, files: ['matro.db', ...files] };
  } finally {
    try { if (staged) fs.rmSync(staged, { recursive: true, force: true }); }
    finally { unlock(); }
  }
}

module.exports = { backup, restore, stamp, MANIFEST };
