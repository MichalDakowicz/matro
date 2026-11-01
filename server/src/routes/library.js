const path = require('node:path');
const { HttpError, readJson, sendFile } = require('../http');

const DEFAULT_STATE = () => ({ progress: {}, queue: [], preferences: { autoplay: true, volume: 0.72 }, markers: {} });
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

// The catalog and each person's own state, in the shape the desktop renderer loads from its library file.
function register(app) {
  const { router, db, library, tmdb } = app;
  const q = {
    items: db.prepare('SELECT i.id, i.path, i.title, i.group_id, i.group_title, i.kind, i.season, i.episode, i.added, f.path AS folder FROM items i JOIN folders f ON f.id = i.folder_id ORDER BY i.path'),
    folders: db.prepare('SELECT path FROM folders ORDER BY path'),
    get: db.prepare('SELECT data FROM user_state WHERE user_id = ?'),
    set: db.prepare('INSERT INTO user_state (user_id, data, updated) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated')
  };
  const stateOf = userId => { const row = q.get.get(userId); try { return { ...DEFAULT_STATE(), ...(row ? JSON.parse(row.data) : {}) }; } catch { return DEFAULT_STATE(); } };

  router.add('GET', '/api/library', ctx => {
    tmdb.sync(); // new titles are matched in the background; the page polls /api/metadata for them
    const admin = ctx.user.role === 'admin', label = folder => admin ? folder : path.basename(folder);
    // Viewers see folder names and paths relative to them, never where the files live on the server.
    const items = q.items.all().map(r => ({ id: r.id, path: admin ? r.path : path.relative(r.folder, r.path), root: label(r.folder), title: r.title, group: r.group_title,
      groupId: r.group_id, titlePath: r.group_id, kind: r.kind, season: r.season, episode: r.episode, format: path.extname(r.path).slice(1).toUpperCase(), added: r.added }));
    return { user: { id: ctx.user.id, username: ctx.user.username, role: ctx.user.role }, folders: [...new Set(q.folders.all().map(f => label(f.path)))], items, ...stateOf(ctx.user.id),
      scanner: { message: library.state.scanning ? 'Scanning the library' : 'Library is up to date', running: false, total: 0, ready: 0, playback: false }, metadata: tmdb.snapshot(), metadataEnabled: tmdb.enabled };
  });

  router.add('GET', '/api/metadata', () => ({ metadata: tmdb.snapshot() }));
  // Cached posters, backdrops, stills and cast photos. Names are matched against a strict pattern by the matcher.
  router.add('GET', '/api/artwork/:name', async ctx => {
    const file = tmdb.artworkFile(ctx.params.name);
    if (!file) throw new HttpError(404, 'No such artwork.');
    await sendFile(ctx.req, ctx.res, file, 'image/jpeg', { 'Cache-Control': 'private, max-age=604800' }).catch(() => { throw new HttpError(404, 'No such artwork.'); });
  });

  router.add('PUT', '/api/state', async ctx => {
    const body = await readJson(ctx.req, 4 * 1024 * 1024), state = stateOf(ctx.user.id);
    if (body.progress !== undefined) { if (!isObject(body.progress)) throw new HttpError(400, 'Bad progress.'); state.progress = body.progress; }
    if (body.queue !== undefined) { if (!Array.isArray(body.queue) || body.queue.length > 1000 || body.queue.some(id => typeof id !== 'string')) throw new HttpError(400, 'Bad queue.'); state.queue = body.queue; }
    if (body.preferences !== undefined) { if (!isObject(body.preferences)) throw new HttpError(400, 'Bad preferences.'); state.preferences = body.preferences; }
    if (body.markers !== undefined) { if (!isObject(body.markers)) throw new HttpError(400, 'Bad markers.'); state.markers = body.markers; }
    q.set.run(ctx.user.id, JSON.stringify({ progress: state.progress, queue: state.queue, preferences: state.preferences, markers: state.markers }), Date.now());
  });
}
module.exports = { register };
