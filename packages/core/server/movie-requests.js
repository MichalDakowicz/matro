const { HttpError } = require('./http');
const { tx } = require('./db');
const { createMovieRequestPush } = require('./movie-request-push');

function createMovieRequests(db, options, metadata = () => ({})) {
  const push = createMovieRequestPush(db, options);
  const select = `SELECT r.id, r.title, NULLIF(r.year, 0) AS year, r.kind, NULLIF(r.season, 0) AS season, r.tmdb_id AS tmdbId, r.status,
      CASE WHEN r.status = 'pending' THEN 'pending' WHEN r.declined THEN 'declined' WHEN r.fulfilled IS NOT NULL OR r.seen = 0 THEN 'ready' ELSE 'handled' END AS outcome,
      r.group_id AS groupId, r.created, r.seen = 0 AS isNew, u.username AS requester
    FROM movie_requests r LEFT JOIN users u ON u.id = r.user_id`;
  const forViewer = db.prepare(`${select} WHERE r.user_id = ? AND r.status = ? ORDER BY r.id DESC LIMIT ?`);
  const forOwner = db.prepare(`${select} WHERE r.status = ? ORDER BY r.id DESC LIMIT ?`);
  const byId = db.prepare(`${select} WHERE r.id = ?`);
  const duplicate = db.prepare(`SELECT id FROM movie_requests WHERE user_id = ? AND title_key = ? AND year = ? AND status = 'pending'`);
  const nextId = db.prepare('UPDATE movie_request_sequence SET last_id = last_id + 1 WHERE singleton = 1 RETURNING last_id');
  const insert = db.prepare('INSERT INTO movie_requests (id, user_id, title, title_key, year, kind, season, tmdb_id, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const resolve = db.prepare("UPDATE movie_requests SET status = 'handled', declined = ?, fulfilled = ?, seen = 0 WHERE id = ? AND status = 'pending'");
  const link = db.prepare("UPDATE movie_requests SET status = 'handled', group_id = ?, fulfilled = ?, seen = 0 WHERE id = ? AND status = 'pending'");
  const waiting = db.prepare("SELECT id, user_id, tmdb_id, kind, season, created FROM movie_requests WHERE status = 'pending' AND tmdb_id IS NOT NULL");
  const catalog = db.prepare('SELECT id, group_id, kind, season, added FROM items ORDER BY added, id');
  const unseen = db.prepare("SELECT id, title, CASE WHEN declined THEN 'declined' ELSE 'ready' END AS outcome FROM movie_requests WHERE user_id = ? AND status = 'handled' AND seen = 0 ORDER BY id");
  const owner = db.prepare('SELECT user_id FROM movie_requests WHERE id = ?');
  const markSeen = db.prepare("UPDATE movie_requests SET seen = 1 WHERE user_id = ? AND status = 'handled' AND seen = 0");
  const remove = db.prepare("DELETE FROM movie_requests WHERE id = ? AND (? = 'admin' OR user_id = ?)");

  const asRow = row => ({ ...row, isNew: !!row.isNew });

  // Link pending requests to titles that have appeared in the library, then tell the requesters.
  function fulfil() {
    const open = waiting.all();
    if (!open.length) return 0;
    const matches = metadata();
    const items = new Map();
    for (const row of catalog.all()) {
      const tmdbId = matches[row.kind === 'movie' ? row.id : row.group_id]?.tmdbId;
      if (!tmdbId) continue;
      const key = `${row.kind}:${tmdbId}`;
      if (!items.has(key)) items.set(key, []);
      items.get(key).push(row);
    }
    const now = Date.now();
    const done = tx(db, () => {
      let count = 0;
      for (const request of open) {
        const kind = request.kind === 'movie' ? 'movie' : 'show';
        const hit = items.get(`${kind}:${request.tmdb_id}`)?.find(item => item.added > request.created &&
          (request.kind !== 'season' || item.season === request.season));
        if (!hit || !link.run(hit.group_id, now, request.id).changes) continue;
        push.clear(request.id);
        push.enqueueFor(request.id, request.user_id, now);
        count++;
      }
      return count;
    });
    if (done) void push.notify();
    return done;
  }

  return {
    push,
    fulfil,
    // What a viewer has not been told yet, for the in-app notice that comes with the library.
    updates: user => user.role === 'admin' ? [] : unseen.all(user.id),
    list(user) {
      if (user.role === 'admin') return {
        pending: forOwner.all('pending', -1).map(asRow), handled: forOwner.all('handled', 30).map(asRow), alertsConfigured: push.enabled, canRemove: true,
      };
      const result = { pending: forViewer.all(user.id, 'pending', -1).map(asRow), handled: forViewer.all(user.id, 'handled', 30).map(asRow), canRemove: true };
      markSeen.run(user.id);
      return result;
    },
    submit(user, body) {
      const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
      if (!rawTitle || rawTitle.length > 200 || /[\x00-\x1f\x7f]/.test(rawTitle)) throw new HttpError(400, 'Enter a title up to 200 characters.');
      const kind = body.kind ?? 'movie';
      if (!['movie', 'series', 'season'].includes(kind)) throw new HttpError(400, 'Request a movie, a series or a season.');
      const season = kind === 'season' ? Number(body.season) : 0;
      if (kind === 'season' && !(Number.isInteger(season) && season >= 1 && season <= 99)) throw new HttpError(400, 'Enter a season number from 1 to 99.');
      const tmdbId = body.tmdbId == null ? null : Number(body.tmdbId);
      if (tmdbId !== null && !(Number.isSafeInteger(tmdbId) && tmdbId > 0)) throw new HttpError(400, 'Invalid TMDB id.');
      const title = rawTitle.replace(/\s+/g, ' ');
      const year = body.year == null || body.year === '' ? 0 : Number(body.year);
      if (body.year != null && body.year !== '' && (!['number', 'string'].includes(typeof body.year) ||
          !/^\d{4}$/.test(String(body.year)) || year < 1000)) throw new HttpError(400, 'Enter a four-digit release year.');
      // The pending-request index is per account, title and year, so shows and seasons carry their kind in the key.
      const key = (kind === 'movie' ? '' : `${kind}:${season}:`) + title.normalize('NFKC').toLowerCase(), now = Date.now();
      const result = tx(db, () => {
        const existing = duplicate.get(user.id, key, year);
        if (existing) return { request: asRow(byId.get(existing.id)), duplicate: true };
        const { last_id: id } = nextId.get();
        insert.run(id, user.id, title, key, year, kind, season, tmdbId, now);
        push.enqueue(id, now);
        return { request: asRow(byId.get(id)), duplicate: false };
      });
      if (!result.duplicate) void push.notify();
      return result;
    },
    handle(id, declined = false) {
      const request = Number.isSafeInteger(id) && byId.get(id);
      if (!request) throw new HttpError(404, 'Request not found.');
      if (request.status === 'pending') {
        tx(db, () => {
          const now = Date.now();
          resolve.run(declined ? 1 : 0, declined ? null : now, id);
          push.clear(id);
          push.enqueueFor(id, owner.get(id)?.user_id, now);
        });
        void push.notify();
      }
      return { request: asRow(byId.get(id)) };
    },
    remove(user, id) {
      if (!Number.isSafeInteger(id) || !remove.run(id, user.role, user.id).changes) throw new HttpError(404, 'Request not found.');
    },
    start: push.start,
    close: push.close,
  };
}

module.exports = { createMovieRequests };
