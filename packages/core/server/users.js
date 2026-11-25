const { HttpError } = require('./http');
const { tx } = require('./db');
const { sessionHash } = require('./auth');

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/;
function validateCredentials(username, password) {
  username = String(username || '').trim(); password = String(password || '');
  if (!USERNAME.test(username)) throw new HttpError(400, 'Usernames are 2–32 letters, numbers, dots, dashes or underscores.');
  if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Passwords need at least 8 characters.');
  return { username, password };
}
// Shared by the web server (viewer accounts) and the command line (head account, password resets).
function createUsers(db, auth) {
  const insert = db.prepare('INSERT INTO users (username, hash, role, created) VALUES (?, ?, ?, ?)');
  const setHash = db.prepare('UPDATE users SET hash = ? WHERE id = ?');
  const byName = db.prepare('SELECT id, username, role FROM users WHERE username = ?');
  const count = db.prepare('SELECT COUNT(*) AS n FROM users');
  const moveDevice = db.prepare('UPDATE movie_request_devices SET session_hash = ? WHERE session_hash = ?');
  const insertHash = (username, hash, role) => {
    try { return Number(insert.run(username, hash, role, Date.now()).lastInsertRowid); }
    catch (error) { if (/UNIQUE/.test(error.message)) throw new HttpError(409, 'That username is taken.'); throw error; }
  };
  return {
    insertHash,
    count: () => count.get().n,
    byName: name => byName.get(String(name)),
    async create(username, password, role) { return insertHash(username, await auth.hashPassword(password), role); },
    // With `current` (the caller's session) every other session ends and a replacement is returned; the phone's
    // movie request alert registration moves to it, because deleting a session would otherwise delete the registration.
    async setPassword(userId, password, current) {
      const hash = await auth.hashPassword(password);
      return tx(db, () => {
        setHash.run(hash, userId);
        if (!current) { auth.destroyAll(userId); return undefined; }
        const token = auth.create(userId);
        moveDevice.run(sessionHash(token), sessionHash(current));
        auth.destroyOthers(userId, token);
        return token;
      });
    }
  };
}
module.exports = { USERNAME, validateCredentials, createUsers };
