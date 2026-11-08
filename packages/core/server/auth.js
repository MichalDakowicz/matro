const crypto = require('node:crypto');
const config = require('./config');

const DAY = 86400000;
const scrypt = (password, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key)));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `s1$${salt.toString('hex')}$${(await scrypt(password, salt)).toString('hex')}`;
}
// Unknown usernames still pay for one hash so response time does not reveal which names exist.
const DUMMY = hashPassword('matro-dummy-password');
async function verifyPassword(password, stored) {
  const [version, salt, hash] = String(stored).split('$');
  if (version !== 's1' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex'), actual = await scrypt(password, Buffer.from(salt, 'hex'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createAuth(db) {
  const failures = new Map();
  const q = {
    byName: db.prepare('SELECT * FROM users WHERE username = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)'),
    session: db.prepare('SELECT s.token_hash, s.expires, u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'),
    slide: db.prepare('UPDATE sessions SET expires = ? WHERE token_hash = ?'),
    drop: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    dropUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    expired: db.prepare('DELETE FROM sessions WHERE expires < ?')
  };
  return {
    hashPassword,
    // Five wrong passwords lock that address+name pair for a minute, doubling each time, so a guess costs time.
    throttle(key) {
      const entry = failures.get(key);
      return entry && entry.until > Date.now() ? Math.ceil((entry.until - Date.now()) / 1000) : 0;
    },
    fail(key) {
      const entry = failures.get(key) || { count: 0, until: 0 };
      entry.count++;
      if (entry.count >= 5) entry.until = Date.now() + 60000 * 2 ** Math.min(entry.count - 5, 6);
      failures.set(key, entry);
      if (failures.size > 5000) failures.delete(failures.keys().next().value);
    },
    succeed(key) { failures.delete(key); },
    async check(username, password) {
      const user = q.byName.get(String(username));
      const ok = await verifyPassword(String(password), user ? user.hash : await DUMMY);
      return user && ok ? user : null;
    },
    create(userId) {
      const token = crypto.randomBytes(32).toString('base64url'), now = Date.now();
      q.insertSession.run(sha(token), userId, now, now + config.sessionDays * DAY);
      q.expired.run(now);
      return token;
    },
    user(token) {
      if (!token) return null;
      const row = q.session.get(sha(token)), now = Date.now();
      if (!row || row.expires < now) return null;
      if (row.expires - now < (config.sessionDays - 1) * DAY) q.slide.run(now + config.sessionDays * DAY, row.token_hash);
      return { id: row.id, username: row.username, role: row.role };
    },
    destroy(token) { if (token) q.drop.run(sha(token)); },
    destroyAll(userId) { q.dropUser.run(userId); }
  };
}
module.exports = { createAuth, hashPassword, verifyPassword };
