const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { lockData, open } = require('../../../packages/core/server/db');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matro-cli-'));
const data = path.join(root, 'data'), library = path.join(root, 'films', 'Heat (1995)');
fs.mkdirSync(library, { recursive: true });
fs.writeFileSync(path.join(library, 'Heat.1995.mkv'), 'not really a video');
const cli = (args, password, dir = data) => spawnSync(process.execPath, [path.join(__dirname, '../../../packages/core/server/cli.js'), ...args], {
  encoding: 'utf8', env: { ...process.env, MATRO_DATA: dir, MATRO_MEDIA: path.join(dir, 'media'), MATRO_PASSWORD: password ?? '' } });
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('setup creates the head account and registers folders', () => {
  const bad = cli(['setup', '--username', 'head'], 'short');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /8 characters/);
  const ok = cli(['setup', '--username', 'head', '--library', path.join(root, 'films')], 'correct horse battery');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Head account "head" created/);
  assert.match(ok.stdout, /1 video found/);
  const db = new DatabaseSync(path.join(data, 'matro.db'));
  assert.deepEqual({ ...db.prepare('SELECT username, role FROM users').get() }, { username: 'head', role: 'admin' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 1);
  assert.equal(db.prepare('SELECT hash FROM users').get().hash.includes('correct'), false);
  db.close();
});

test('setup refuses once an account exists, passwd resets and signs out', () => {
  const again = cli(['setup', '--username', 'other'], 'correct horse battery');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already has accounts/);
  assert.equal(cli(['passwd', 'nobody'], 'new-password-99').status, 1);
  const db = new DatabaseSync(path.join(data, 'matro.db'));
  db.prepare("INSERT INTO sessions (token_hash, user_id, created, expires) VALUES ('x', 1, 0, 9999999999999)").run();
  const before = db.prepare('SELECT hash FROM users').get().hash;
  const reset = cli(['passwd', 'head'], 'new-password-99');
  assert.equal(reset.status, 0, reset.stderr);
  assert.notEqual(db.prepare('SELECT hash FROM users').get().hash, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  db.close();
});

test('back up live state and restore it offline while keeping the replaced state', () => {
  const dir = path.join(root, 'backup-data');
  const file = path.join(dir, 'matro.db');
  const dest = path.join(root, "owner's backup");
  const setup = cli(['setup', '--username', 'owner', '--library', path.join(root, 'films')], 'correct horse battery', dir);
  assert.equal(setup.status, 0, setup.stderr);
  const db = open(file);
  const item = db.prepare('SELECT id FROM items').get().id;
  const state = { history: { [item]: { position: 42 } }, manualMarkers: { [item]: [{ start: 0, end: 25 }] } };
  const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n';
  const settings = '{"server":{"username":"qbittorrent"}}';
  try {
    db.prepare('INSERT INTO user_state VALUES (1, ?, 0)').run(JSON.stringify(state));
    db.prepare("INSERT INTO subtitles (item_id, user_id, name, language, vtt, created) VALUES (?, 1, 'English', 'eng', ?, 0)").run(item, vtt);
    fs.writeFileSync(path.join(dir, 'downloads.json'), settings);
    fs.writeFileSync(path.join(dir, 'downloads.key'), Buffer.alloc(32, 42));
    fs.writeFileSync(path.join(dir, 'segments.json'), '{"markers":{}}');
    const saved = cli(['backup', dest], undefined, dir);
    assert.equal(saved.status, 0, saved.stderr);
    assert.equal(cli(['backup', dest], undefined, dir).status, 1);

    db.exec("UPDATE users SET username = 'changed'; DELETE FROM user_state; DELETE FROM subtitles;");
    fs.writeFileSync(path.join(dir, 'downloads.json'), '{}');
    fs.writeFileSync(path.join(dir, '.env'), 'TMDB_API_KEY=old');
    const unlock = lockData(dir);
    try {
      const refused = cli(['restore', dest], undefined, dir);
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /Stop the server/);
    } finally {
      unlock();
    }
    const legacy = cli(['restore', dest], undefined, dir);
    assert.equal(legacy.status, 1);
    assert.match(legacy.stderr, /server appears to be running/);
    assert.equal(db.prepare('SELECT username FROM users').get().username, 'changed');
  } finally {
    db.close();
  }

  const restored = cli(['restore', dest], undefined, dir);
  assert.equal(restored.status, 0, restored.stderr);
  const current = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(current.prepare('SELECT username FROM users').get().username, 'owner');
    assert.deepEqual(JSON.parse(current.prepare('SELECT data FROM user_state').get().data), state);
    assert.equal(current.prepare('SELECT vtt FROM subtitles').get().vtt, vtt);
  } finally {
    current.close();
  }
  assert.equal(fs.readFileSync(path.join(dir, 'downloads.json'), 'utf8'), settings);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'downloads.key')), Buffer.alloc(32, 42));
  assert.equal(fs.readFileSync(path.join(dir, 'segments.json'), 'utf8'), '{"markers":{}}');
  assert.equal(fs.existsSync(path.join(dir, '.env')), false);

  const kept = path.join(dir, 'backups', fs.readdirSync(path.join(dir, 'backups'))[0]);
  assert.match(path.basename(kept), /^before-restore-/);
  const previous = new DatabaseSync(path.join(kept, 'matro.db'), { readOnly: true });
  try {
    assert.equal(previous.prepare('SELECT username FROM users').get().username, 'changed');
  } finally {
    previous.close();
  }
  assert.equal(fs.readFileSync(path.join(kept, '.env'), 'utf8'), 'TMDB_API_KEY=old');

  const fresh = path.join(root, 'fresh-data');
  const migrated = cli(['restore', dest], undefined, fresh);
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.ok(fs.existsSync(path.join(fresh, 'matro.db')));
});
