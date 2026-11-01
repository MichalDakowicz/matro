const { HttpError, readJson, readBody, sendFile, MIME } = require('../http');
const { canDirectPlay } = require('../media');
const { normalize } = require('../lang');
const { toVtt, createEmbedded, MAX_UPLOAD } = require('../subtitles');
const { createFrames } = require('../previews');
const { createStreams } = require('../stream');
const path = require('node:path');

const KINDS = ['full', 'forced', 'sdh'];
const MAX_SUBS_PER_ITEM = 60;

function register(app) {
  const { router, db, library } = app;
  const embedded = createEmbedded(), transcode = createStreams(), frames = createFrames();
  const q = {
    uploaded: db.prepare(`SELECT s.id, s.name, s.language, s.kind, s.created, s.user_id AS userId, u.username AS addedBy FROM subtitles s
      LEFT JOIN users u ON u.id = s.user_id WHERE s.item_id = ? ORDER BY s.language, s.name`),
    sub: db.prepare('SELECT * FROM subtitles WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM subtitles WHERE item_id = ?'),
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
    await sendFile(ctx.req, ctx.res, item.path, MIME[path.extname(item.path).toLowerCase()] || 'video/mp4', { 'Cache-Control': 'private, no-store' });
  });

  router.add('GET', '/api/items/:id/transcode', async ctx => {
    const item = find(ctx.params.id), info = await library.info(item);
    const number = name => ctx.query.get(name) === null ? null : Number(ctx.query.get(name));
    const offset = number('t') ?? 0, audio = number('audio'), burn = number('burn'), delay = Math.max(-60, Math.min(60, number('delay') ?? 0)), preload = ctx.query.get('preload') === '1';
    if (!Number.isFinite(offset) || offset < 0 || (info.duration && offset >= info.duration)) throw new HttpError(400, 'Bad start time.');
    if (audio !== null && !info.audio.some(t => t.index === audio)) throw new HttpError(400, 'Unknown audio track.');
    if (burn !== null && !info.subtitles.some(t => t.index === burn && t.bitmap)) throw new HttpError(400, 'Unknown image subtitle track.');
    await transcode(ctx.req, ctx.res, { userId: ctx.user.id, file: item.path, info, offset, audio, burn, delay: Number.isFinite(delay) ? delay : 0, preload });
  });

  // A still frame, used for seek previews and thumbnails.
  router.add('GET', '/api/items/:id/frame', async ctx => {
    const item = find(ctx.params.id), t = Number(ctx.query.get('t') || 0), width = Math.max(120, Math.min(640, Number(ctx.query.get('w')) || 320));
    if (!Number.isFinite(t) || t < 0) throw new HttpError(400, 'Bad time.');
    let file; try { file = await frames(item, t, width); } catch { throw new HttpError(404, 'No preview for that moment.'); }
    await sendFile(ctx.req, ctx.res, file, 'image/jpeg', { 'Cache-Control': 'private, max-age=86400' });
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
    if (q.count.get(item.id).n >= MAX_SUBS_PER_ITEM) throw new HttpError(409, 'This title already has the maximum number of subtitle tracks.');
    const body = await readBody(ctx.req, MAX_UPLOAD + 1024);
    const vtt = await toVtt(body, { filename: ctx.query.get('filename'), language: meta.language, charset: ctx.query.get('charset') });
    const { lastInsertRowid } = q.insert.run(item.id, ctx.user.id, meta.name, meta.language, meta.kind, vtt, Date.now());
    return { subtitle: subtitleOut({ id: Number(lastInsertRowid), ...meta, created: Date.now(), userId: ctx.user.id, addedBy: ctx.user.username }, ctx.user) };
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
