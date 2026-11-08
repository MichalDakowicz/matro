const crypto = require('node:crypto');

// 12 characters from an alphabet without look-alikes (no 0/O, 1/I/L), shown as XXXX-XXXX-XXXX: about 58 bits.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DAY = 86400000;
function generate() {
  const bytes = crypto.randomBytes(12);
  const raw = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}
// Codes are typed by hand, so case, spaces and dashes do not matter. Only a hash is stored.
const normalize = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = code => crypto.createHash('sha256').update(normalize(code)).digest('hex');

function createInvites(db) {
  const q = {
    insert: db.prepare('INSERT INTO invites (code_hash, created_by, created, expires) VALUES (?, ?, ?, ?)'),
    byHash: db.prepare('SELECT id, expires, used_at FROM invites WHERE code_hash = ?'),
    claim: db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ? AND used_at IS NULL AND expires > ?'),
    list: db.prepare(`SELECT i.id, i.created, i.expires, i.used_at AS usedAt, u.username AS usedBy FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created DESC LIMIT 100`),
    revoke: db.prepare('DELETE FROM invites WHERE id = ? AND used_at IS NULL')
  };
  return {
    create(adminId, days = 7) {
      const code = generate(), now = Date.now(), expires = now + Math.max(1, Math.min(30, Number(days) || 7)) * DAY;
      q.insert.run(hashCode(code), adminId, now, expires);
      return { code, expires };
    },
    find: code => normalize(code).length === 12 ? q.byHash.get(hashCode(code)) : undefined,
    claim: (id, userId) => q.claim.run(userId, Date.now(), id, Date.now()).changes === 1,
    list: () => q.list.all().map(row => ({ ...row, status: row.usedAt ? 'used' : row.expires < Date.now() ? 'expired' : 'waiting' })),
    revoke: id => q.revoke.run(id).changes === 1
  };
}
module.exports = { createInvites, normalize };
