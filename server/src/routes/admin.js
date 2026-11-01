const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const config = require('../config');
const { HttpError, readJson } = require('../http');
const { VIDEO } = require('../scan');

// Every path segment from the browser is reduced to something safe to create under the media folder.
const safeSegment = value => String(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 150);

function register(app) {
  const { router, db, library, auth } = app;
  const q = {
    users: db.prepare(`SELECT u.id, u.username, u.role, u.created, (SELECT updated FROM user_state WHERE user_id = u.id) AS lastWatched,
      (SELECT COUNT(*) FROM subtitles WHERE user_id = u.id) AS subtitles FROM users u ORDER BY u.role, u.username`),
    user: db.prepare('SELECT * FROM users WHERE id = ?'),
    setHash: db.prepare('UPDATE users SET hash = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM users WHERE id = ?')
  };
  const target = id => {
    const user = q.user.get(Number(id));
    if (!user) throw new HttpError(404, 'No such account.');
    if (user.role === 'admin') throw new HttpError(400, 'The head account cannot be changed this way.');
    return user;
  };

  router.add('GET', '/api/admin/users', { auth: 'admin' }, () => ({ users: q.users.all() }));
  // New accounts are made by the person joining, with a one-time code created here.
  router.add('GET', '/api/admin/invites', { auth: 'admin' }, () => ({ invites: app.invites.list() }));
  router.add('POST', '/api/admin/invites', { auth: 'admin' }, async ctx => app.invites.create(ctx.user.id, (await readJson(ctx.req)).days));
  router.add('DELETE', '/api/admin/invites/:id', { auth: 'admin' }, ctx => { if (!app.invites.revoke(Number(ctx.params.id))) throw new HttpError(404, 'No unused invite with that id.'); });
  router.add('PATCH', '/api/admin/users/:id', { auth: 'admin' }, async ctx => {
    const user = target(ctx.params.id), password = String((await readJson(ctx.req)).password || '');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Passwords need at least 8 characters.');
    q.setHash.run(await auth.hashPassword(password), user.id);
    auth.destroyAll(user.id);
  });
  router.add('DELETE', '/api/admin/users/:id', { auth: 'admin' }, ctx => { q.remove.run(target(ctx.params.id).id); });

  router.add('GET', '/api/admin/folders', { auth: 'admin' }, () => ({ folders: library.folders(), scanning: library.state.scanning, mediaDir: config.mediaDir }));
  router.add('POST', '/api/admin/folders', { auth: 'admin' }, async ctx => library.addFolder((await readJson(ctx.req)).path));
  router.add('DELETE', '/api/admin/folders/:id', { auth: 'admin' }, ctx => { library.removeFolder(Number(ctx.params.id)); });
  router.add('POST', '/api/admin/rescan', { auth: 'admin' }, async () => library.rescanAll());

  // Fixing a wrong TMDB match from the title page (the desktop's "Fix match").
  router.add('GET', '/api/admin/metadata/search', { auth: 'admin' }, async ctx => {
    const year = /^d{4}$/.test(ctx.query.get('year') || '') ? ctx.query.get('year') : null;
    try { return { results: await app.tmdb.search(ctx.query.get('kind'), ctx.query.get('query'), year) }; } catch (error) { throw new HttpError(502, error.message); }
  });
  router.add('POST', '/api/admin/metadata/assign', { auth: 'admin' }, async ctx => {
    const body = await readJson(ctx.req);
    try { return { metadata: await app.tmdb.assign(String(body.key || ''), body.tmdbId ?? null) }; } catch (error) { throw error.status ? error : new HttpError(502, error.message); }
  });

  // Folder picker for the head account: subfolders of a server path.
  router.add('GET', '/api/admin/browse', { auth: 'admin' }, async ctx => {
    const dir = path.resolve(ctx.query.get('path') || config.mediaDir);
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { throw new HttpError(400, 'That folder cannot be read.'); }
    const parent = path.dirname(dir);
    return { path: dir, parent: parent === dir ? null : parent, dirs: entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) };
  });

  // Upload one video into the server's media folder; the body is the raw file so large films stream to disk.
  router.add('POST', '/api/admin/upload', { auth: 'admin' }, async ctx => {
    const parts = String(ctx.query.get('path') || '').split(/[\\/]+/).map(safeSegment).filter(Boolean);
    if (!parts.length || parts.length > 4) throw new HttpError(400, 'Choose a file name, optionally inside up to three folders.');
    if (!VIDEO.has(path.extname(parts.at(-1)).slice(1).toLowerCase())) throw new HttpError(400, 'That is not a video file type Matro knows.');
    const declared = Number(ctx.req.headers['content-length']);
    if (declared > config.maxUploadBytes) throw new HttpError(413, 'That file is larger than the upload limit.');
    const final = path.join(config.mediaDir, ...parts);
    if (!final.startsWith(config.mediaDir + path.sep)) throw new HttpError(400, 'Bad path.');
    await fsp.mkdir(path.dirname(final), { recursive: true });
    try { await fsp.access(final); throw new HttpError(409, 'A file with that name is already on the server.'); } catch (error) { if (error instanceof HttpError) throw error; }
    const temporary = `${final}.${randomBytes(6).toString('hex')}.part`;
    let size = 0;
    const limit = new Transform({ transform(chunk, _enc, done) { size += chunk.length; done(size > config.maxUploadBytes ? new HttpError(413, 'That file is larger than the upload limit.') : null, chunk); } });
    try { await pipeline(ctx.req, limit, fs.createWriteStream(temporary, { flags: 'wx' })); await fsp.rename(temporary, final); }
    catch (error) { await fsp.rm(temporary, { force: true }); throw error; }
    let folder = library.byPath(config.mediaDir);
    if (!folder) { await fsp.mkdir(config.mediaDir, { recursive: true }); await library.addFolder(config.mediaDir); folder = library.byPath(config.mediaDir); }
    else await library.rescan(folder.id);
    return { path: parts.join('/'), size };
  });
}
module.exports = { register };
