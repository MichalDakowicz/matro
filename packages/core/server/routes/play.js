const { HttpError, readJson, readBody, sendFile, sendOpenFile, sendBytes, MIME } = require('../http');
const { canDirectPlay } = require('../media');
const { normalize } = require('../lang');
const { toVtt, createEmbedded, MAX_UPLOAD } = require('../subtitles');
const { createFrames } = require('../previews');
const { createStreams } = require('../stream');
const { QUALITIES } = require('../../playback/encoding.cjs');
const { createAssetCache } = require('../asset-cache');
const { playbackSession, createPlaybackActivity } = require('../playback-session');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');

const KINDS = ['full', 'forced', 'sdh'];
const MAX_SUBS_PER_ITEM = 60;

function register(app) {
  const { router, db, library, dataDir } = app;
  const assets = createAssetCache(dataDir);
  const embedded = createEmbedded(dataDir, assets), frames = createFrames(dataDir, assets), transcode = createStreams({ dataDir });
  const activity = createPlaybackActivity(app.scanner.setPlayback);
  app.closePlayback = () => { activity.close(); transcode.close(); };
  const q = {
    uploaded: db.prepare(`SELECT s.id, s.name, s.language, s.kind, s.created, s.user_id AS userId, u.username AS addedBy FROM subtitles s
      LEFT JOIN users u ON u.id = s.user_id WHERE s.item_id = ? ORDER BY s.language, s.name`),
    sub: db.prepare('SELECT * FROM subtitles WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM subtitles WHERE item_id = ?'),
    sameSubtitle: db.prepare('SELECT id, created FROM subtitles WHERE item_id = ? AND user_id = ? AND name = ? AND language = ? AND kind = ? AND vtt = ? LIMIT 1'),
    insert: db.prepare('INSERT INTO subtitles (item_id, user_id, name, language, kind, vtt, created) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    update: db.prepare('UPDATE subtitles SET name = ?, language = ?, kind = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM subtitles WHERE id = ?')
  };
  const find = id => { const item = library.item(id); if (!item) throw new HttpError(404, 'That title is not in the library.'); return item; };
  const label = ctx => {
    const name = String(ctx.query.get('name') || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 60) throw new HttpError(400, 'Give the subtitles a name (up to 60 characters).');
    const language = normalize(ctx.query.get('lang'));
    const kind = ctx.query.get('kind') || 'full';
    if (!KINDS.includes(kind)) throw new HttpError(400, 'Kind must be full, forced or sdh.');
    return { name, language, kind };
  };
  const subtitleOut = (row, user) => ({ id: row.id, name: row.name, language: row.language, kind: row.kind, addedBy: row.addedBy, created: row.created,
    mine: row.userId === user.id, canEdit: row.userId === user.id || user.role === 'admin' });

  router.add('GET', '/api/items/:id/info', async ctx => {
    const item = find(ctx.params.id);
    let info;
    try { info = await library.info(item); } catch { throw new HttpError(422, 'This file could not be read. It may be damaged or unsupported.'); }
    if (info.broken) throw new HttpError(422, 'This file could not be read. It may be damaged or unsupported.');
    return {
      id: item.id, groupId: item.group_id, title: item.title, groupTitle: item.group_title, kind: item.kind, season: item.season, episode: item.episode,
      duration: info.duration, video: info.video, directPlay: canDirectPlay(item.path, info), chapters: info.chapters,
      audio: info.audio.map(t => ({ ...t, language: normalize(t.language) })),
      embedded: info.subtitles.map(t => ({ ...t, language: normalize(t.language) })),
      uploaded: q.uploaded.all(item.id).map(row => subtitleOut(row, ctx.user))
    };
  });

  router.add('GET', '/api/items/:id/direct', async ctx => {
    const item = find(ctx.params.id);
    const session = playbackSession(ctx, ctx.query.get('session'));
    if (ctx.query.get('preload') !== '1') transcode.releaseMain(session);
    await sendFile(ctx.req, ctx.res, item.path, MIME[path.extname(item.path).toLowerCase()] || 'video/mp4', { 'Cache-Control': 'private, no-store' });
  });

  async function offline(ctx, download = false) {
    const item = find(ctx.params.id), info = await library.info(item);
    if (info.broken) throw new HttpError(422, 'This file could not be prepared for offline playback.');
    const audio = ctx.query.has('audio') ? Number(ctx.query.get('audio')) : null;
    if (audio !== null && !info.audio.some(track => track.index === audio)) throw new HttpError(400, 'Unknown audio track.');
    const direct = canDirectPlay(item.path, info) && (audio === null || audio === info.audio[0]?.index);
    const entry = direct ? null : await transcode.offline(item.path, info, audio);
    const changed = () => new HttpError(409, 'The offline file changed. Retry the download.');
    if (entry?.error) throw new HttpError(422, 'This file could not be prepared for offline playback.');
    if (entry && !entry.done) {
      if (download) throw changed();
      return { state: 'preparing', progress: info.duration > 0 ? Math.min(0.99, (entry.preparedSeconds || 0) / info.duration) : null };
    }
    const type = direct ? MIME[path.extname(item.path).toLowerCase()] || 'video/mp4' : 'video/mp4';
    if (entry) entry.readers++;
    try {
      const handle = await fs.open(entry?.file || item.path, 'r').catch(error => {
        if (download && error.code === 'ENOENT') throw changed();
        throw error;
      });
      try {
        const { size, mtimeMs, ctimeMs, ino } = await handle.stat();
        const version = createHash('sha256').update(JSON.stringify([2, item.id, audio, size, mtimeMs, ctimeMs, ino])).digest('hex');
        if (!download) return { state: 'ready', size, version, type };
        if (ctx.query.get('version') !== version) throw changed();
        await sendOpenFile(ctx.req, ctx.res, handle, size, type, { 'Cache-Control': 'private, no-store' });
      } finally { await handle.close(); }
    } finally {
      if (entry) { entry.used = Date.now(); entry.readers--; }
    }
  }
  router.add('GET', '/api/items/:id/offline', ctx => offline(ctx));
  router.add('GET', '/api/items/:id/offline/file', ctx => offline(ctx, true));

  router.add('POST', '/api/playback/state', async ctx => {
    const body = await readJson(ctx.req), session = playbackSession(ctx, body.session);
    // Any report, paused or not, proves the player is still open and keeps its prepared stream alive.
    transcode.renew(session);
    // Older apps send no session id and no heartbeat: keep their activity until they report playing:false or stop.
    activity.set(session, body.playing === true, body.buffering === true, body.session == null);
  });

  router.add('POST', '/api/playback/stop', async ctx => {
    const body = await readJson(ctx.req), session = playbackSession(ctx, body.session);
    transcode.stop(session, body.keepPreload === true);
    activity.set(session, false);
  });

  router.add('GET', '/api/items/:id/transcode', async ctx => {
    const session = playbackSession(ctx, ctx.query.get('session'));
    const item = find(ctx.params.id), info = await library.info(item);
    const number = name => ctx.query.get(name) === null ? null : Number(ctx.query.get(name));
    const offset = number('t') ?? 0, audio = number('audio'), burn = number('burn'), delay = Math.max(-60, Math.min(60, number('delay') ?? 0)), preload = ctx.query.get('preload') === '1';
    if (!Number.isFinite(offset) || offset < 0 || (info.duration && offset >= info.duration)) throw new HttpError(400, 'Bad start time.');
    if (audio !== null && !info.audio.some(t => t.index === audio)) throw new HttpError(400, 'Unknown audio track.');
    if (burn !== null && !info.subtitles.some(t => t.index === burn && t.bitmap)) throw new HttpError(400, 'Unknown image subtitle track.');
    const quality = ctx.query.get('quality');
    if (quality !== null && quality !== 'original' && !QUALITIES[quality]) throw new HttpError(400, 'Unknown quality.');
    await transcode(ctx.req, ctx.res, { session, file: item.path, info, offset, audio, burn, delay: Number.isFinite(delay) ? delay : 0, preload, quality: QUALITIES[quality] ? quality : null });
  });

  // A still frame, used for seek previews and thumbnails.
  router.add('GET', '/api/items/:id/frame', async ctx => {
    const item = find(ctx.params.id), t = Number(ctx.query.get('t') || 0), width = Number(ctx.query.get('w')) || 320;
    if (!Number.isFinite(t) || t < 0) throw new HttpError(400, 'Bad time.');
    let jpeg; try { jpeg = await frames(item, t, width); } catch { throw new HttpError(404, 'No preview for that moment.'); }
    await sendBytes(ctx.req, ctx.res, jpeg, 'image/jpeg', { 'Cache-Control': 'private, max-age=86400' });
  });

  // Subtitle text for the player: e<stream index> is embedded in the file, u<id> was uploaded by a viewer.
  router.add('GET', '/api/items/:id/subtitles/:key', async ctx => {
    const item = find(ctx.params.id), key = ctx.params.key;
    let vtt;
    if (/^u\d+$/.test(key)) {
      const row = q.sub.get(Number(key.slice(1)));
      if (!row || row.item_id !== item.id) throw new HttpError(404, 'Subtitles not found.');
      vtt = row.vtt;
    } else if (/^e\d+$/.test(key)) {
      const index = Number(key.slice(1)), info = await library.info(item);
      if (!info.subtitles.some(t => t.index === index && t.text)) throw new HttpError(404, 'That track is not a text subtitle.');
      try { vtt = await embedded(item, index); } catch { throw new HttpError(502, 'Could not read the subtitles inside this file.'); }
    } else throw new HttpError(404, 'Subtitles not found.');
    ctx.res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'private, no-cache' }).end(vtt);
  });

  // Every signed-in account may add subtitles; the file body is the raw subtitle file, labelled through the query string.
  router.add('POST', '/api/items/:id/subtitles', async ctx => {
    const item = find(ctx.params.id), meta = label(ctx);
    const queued = ctx.query.get('queued') === '1';
    const limited = () => q.count.get(item.id).n >= MAX_SUBS_PER_ITEM;
    const overLimit = () => new HttpError(409, 'This title already has the maximum number of subtitle tracks.');
    if (!queued && limited()) throw overLimit();
    const body = await readBody(ctx.req, MAX_UPLOAD + 1024);
    const vtt = await toVtt(body, { filename: ctx.query.get('filename'), language: meta.language, charset: ctx.query.get('charset') });
    let row = queued ? q.sameSubtitle.get(item.id, ctx.user.id, meta.name, meta.language, meta.kind, vtt) : null;
    if (!row) {
      if (limited()) throw overLimit();
      const created = Date.now(), { lastInsertRowid } = q.insert.run(item.id, ctx.user.id, meta.name, meta.language, meta.kind, vtt, created);
      row = { id: Number(lastInsertRowid), created };
    }
    return { subtitle: subtitleOut({ ...row, ...meta, userId: ctx.user.id, addedBy: ctx.user.username }, ctx.user) };
  });

  const own = (ctx) => {
    const row = q.sub.get(Number(ctx.params.id));
    if (!row) throw new HttpError(404, 'Subtitles not found.');
    if (row.user_id !== ctx.user.id && ctx.user.role !== 'admin') throw new HttpError(403, 'Only the person who added these subtitles, or the head account, can change them.');
    return row;
  };
  // The subtitle files this person added (everyone's, for the head account), for the profile page.
  router.add('GET', '/api/me/subtitles', ctx => ({ subtitles: db.prepare(`SELECT s.id, s.name, s.language, s.kind, s.created, i.group_title AS groupTitle, i.title, i.kind AS itemKind, i.season, i.episode, u.username AS addedBy
    FROM subtitles s JOIN items i ON i.id = s.item_id LEFT JOIN users u ON u.id = s.user_id WHERE ? = 'admin' OR s.user_id = ? ORDER BY s.created DESC LIMIT 500`).all(ctx.user.role, ctx.user.id) }));

  router.add('PATCH', '/api/subtitles/:id', async ctx => {
    const row = own(ctx), body = await readJson(ctx.req);
    const name = body.name === undefined ? row.name : String(body.name).trim().replace(/\s+/g, ' ');
    const language = body.language === undefined ? row.language : normalize(body.language);
    const kind = body.kind === undefined ? row.kind : body.kind;
    if (!name || name.length > 60) throw new HttpError(400, 'Give the subtitles a name (up to 60 characters).');
    if (!KINDS.includes(kind)) throw new HttpError(400, 'Kind must be full, forced or sdh.');
    q.update.run(name, language, kind, row.id);
  });
  router.add('DELETE', '/api/subtitles/:id', ctx => { q.remove.run(own(ctx).id); });
}
module.exports = { register };
