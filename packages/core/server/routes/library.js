const path = require('node:path');
const { HttpError, readJson, sendFile } = require('../http');
const { isContinueDismissed } = require('../../client/watch-progress.js');

const DEFAULT_STATE = () => ({ progress: {}, queue: [], preferences: { autoplay: true, volume: 0.72 }, markers: {}, markerDismissals: {} });
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const sameMarker = (first, second) => first?.type === second.type && first.start === second.start && first.end === second.end;
const overlaps = (first, second) => first.start < second.end && first.end > second.start;
const validMarker = marker => marker && ['intro', 'outro', 'recap'].includes(marker.type) && Number.isFinite(marker.start) && Number.isFinite(marker.end) && marker.end > marker.start;
const manualMarker = ({ type, start, end }) => ({ type, start, end, source: 'manual' });

function dismissMarker(state, id, marker, legacyOnly = false) {
  const dismissed = state.markerDismissals[id] ||= [];
  const index = dismissed.findIndex(other => sameMarker(other, marker));
  const previous = dismissed[index];
  const source = marker.source === 'manual' || (previous && previous.source !== 'automatic') ? 'manual' : 'automatic';
  const dismissal = { ...marker, source };
  if (legacyOnly && (!previous || previous.legacyOnly === true)) dismissal.legacyOnly = true;
  if (index < 0) dismissed.push(dismissal);
  else dismissed[index] = dismissal;
}

// The catalog and each person's own state, in the shape the desktop renderer loads from its library file.
function register(app) {
  const { router, db, library, tmdb, scanner } = app;
  const q = {
    items: db.prepare('SELECT i.id, i.path, i.title, i.group_id, i.group_title, i.kind, i.season, i.episode, i.added, f.path AS folder FROM items i JOIN folders f ON f.id = i.folder_id ORDER BY i.path'),
    episodes: db.prepare("SELECT id FROM items WHERE kind = 'show' AND group_id = ?"),
    folders: db.prepare('SELECT path FROM folders ORDER BY path'),
    get: db.prepare('SELECT data, updated FROM user_state WHERE user_id = ?'),
    set: db.prepare('INSERT INTO user_state (user_id, data, updated) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated')
  };
  const stateOf = userId => {
    const row = q.get.get(userId);
    let state;
    try { state = { ...DEFAULT_STATE(), ...(row ? JSON.parse(row.data) : {}) }; } catch { state = DEFAULT_STATE(); }
    state.progress = Object.assign(Object.create(null), state.progress);
    state.progressTimes = Object.assign(Object.create(null), state.progressTimes);
    // Recover rows written before the server owned the public update timestamp.
    for (const [id, entry] of Object.entries(state.progress)) {
      if (isObject(entry) && entry.updated > row?.updated) entry.updated = row.updated;
    }
    return state;
  };

  router.add('GET', '/api/library', ctx => {
    tmdb.sync(); // new titles are matched in the background; the page polls /api/metadata for them
    const admin = ctx.user.role === 'admin', label = folder => admin ? folder : path.basename(folder);
    // Viewers see folder names and paths relative to them, never where the files live on the server.
    const items = q.items.all().map(r => ({ id: r.id, path: admin ? r.path : path.relative(r.folder, r.path), root: label(r.folder), title: r.title, group: r.group_title,
      groupId: r.group_id, titlePath: r.group_id, kind: r.kind, season: r.season, episode: r.episode, format: path.extname(r.path).slice(1).toUpperCase(), added: r.added }));
    const { progressTimes, queueEdited, ...state } = stateOf(ctx.user.id); scanner.refresh();
    return { user: { id: ctx.user.id, username: ctx.user.username, role: ctx.user.role }, folders: [...new Set(q.folders.all().map(f => label(f.path)))], items, ...state, markers: scanner.markers(state.markers, state.markerDismissals),
      scanner: scanner.snapshot(), metadata: tmdb.snapshot(), metadataEnabled: tmdb.enabled, catalogRevision: library.state.revision, movieRequestsEnabled: true,
      movieRequestPushEnabled: admin && app.movieRequests.push.enabled };
  });
  router.add('GET', '/api/library/revision', () => ({ catalogRevision: library.state.revision }));

  router.add('GET', '/api/segments', ctx => {
    const state = stateOf(ctx.user.id); scanner.refresh();
    return { scanner: scanner.snapshot(), markers: scanner.markers(state.markers, state.markerDismissals) };
  });
  router.add('POST', '/api/segments/manual', async ctx => {
    const { changes, replaceType } = await readJson(ctx.req, 4 * 1024 * 1024);
    if (!Array.isArray(changes) || !changes.length || changes.some(change => typeof change?.id !== 'string' || !Array.isArray(change.markers) || change.markers.some(marker => !validMarker(marker) || marker.start < 0))) throw new HttpError(400, 'Bad marker changes.');
    if (changes.some(({ id }) => !library.item(id))) throw new HttpError(404, 'No such title.');
    const state = stateOf(ctx.user.id);
    for (const { id, markers } of changes) {
      const edited = markers.map(manualMarker);
      const kept = (state.markers[id] || []).filter(marker => {
        if (!edited.some(mark => mark.type === marker.type && replaceType === true || overlaps(mark, marker))) return true;
        if (!edited.some(mark => sameMarker(marker, mark))) dismissMarker(state, id, manualMarker(marker), true);
        return false;
      });
      state.markers[id] = [...kept, ...edited];
    }
    q.set.run(ctx.user.id, JSON.stringify(state), Date.now());
    const visible = scanner.markers(state.markers, state.markerDismissals);
    return { markers: Object.fromEntries(changes.map(({ id }) => [id, visible[id] || []])) };
  });
  router.add('POST', '/api/items/:id/segments', async ctx => {
    if (!library.item(ctx.params.id)) throw new HttpError(404, 'No such title.');
    const body = await readJson(ctx.req);
    if (body.force === true) {
      const state = stateOf(ctx.user.id);
      // A forced comparison can restore detected marks. Keep manual removals
      // protected from older tabs with a stale marker map.
      const manual = (state.markerDismissals[ctx.params.id] || []).filter(marker => marker.source !== 'automatic').map(marker => ({ ...marker, legacyOnly: true }));
      if (manual.length) state.markerDismissals[ctx.params.id] = manual;
      else delete state.markerDismissals[ctx.params.id];
      q.set.run(ctx.user.id, JSON.stringify(state), Date.now());
    }
    await scanner.request(ctx.params.id, body.force === true);
    const state = stateOf(ctx.user.id);
    return { markers: scanner.markers(state.markers, state.markerDismissals)[ctx.params.id] || [] };
  });
  router.add('POST', '/api/items/:id/segments/remove', async ctx => {
    if (!library.item(ctx.params.id)) throw new HttpError(404, 'No such title.');
    const { marker } = await readJson(ctx.req), id = ctx.params.id, state = stateOf(ctx.user.id);
    if (!validMarker(marker)) throw new HttpError(400, 'Bad marker.');
    const kept = state.markers[id] || [];
    state.markers[id] = kept.filter(value => !sameMarker(value, marker));
    const automatic = kept.length === state.markers[id].length && marker.source === 'automatic';
    dismissMarker(state, id, { ...manualMarker(marker), source: automatic ? 'automatic' : 'manual' });
    q.set.run(ctx.user.id, JSON.stringify(state), Date.now());
    return { markers: scanner.markers(state.markers, state.markerDismissals)[id] || [] };
  });
  router.add('POST', '/api/playback/state', async ctx => {
    const body = await readJson(ctx.req);
    scanner.setPlayback(body.playing === true, body.buffering === true);
  });

  router.add('GET', '/api/metadata', () => ({ metadata: tmdb.snapshot() }));
  // Cached posters, backdrops, stills and cast photos. Names are matched against a strict pattern by the matcher.
  router.add('GET', '/api/artwork/:name', async ctx => {
    const file = tmdb.artworkFile(ctx.params.name);
    if (!file) throw new HttpError(404, 'No such artwork.');
    await sendFile(ctx.req, ctx.res, file, 'image/jpeg', { 'Cache-Control': 'private, max-age=604800' }).catch(() => { throw new HttpError(404, 'No such artwork.'); });
  });

  const validCheckpoint = entry => isObject(entry) && Number.isFinite(entry.position) && entry.position >= 0
    && Number.isFinite(entry.duration ?? 0) && entry.duration !== null && (entry.duration ?? 0) >= 0
    && Number.isFinite(entry.updated ?? 0) && entry.updated !== null && (entry.updated ?? 0) >= 0;
  const checkpointTime = (entry, now) => Math.min(entry.updated ?? 0, now);
  const previousTime = (state, id) => state.progressTimes[id] ?? state.progress[id]?.updated ?? 0;
  const sameCheckpoint = (a, b) => a.position === b.position && a.duration === b.duration && a.completed === b.completed && !!a.hidden === !!b.hidden;
  // Without the account header the client is older: its `updated` is an echoed server time, not its own clock.
  const legacyRequest = ctx => ctx.req.headers['x-matro-account'] === undefined;
  function mergeProgress(state, sent, now, legacy = false) {
    const confirmed = Object.create(null);
    for (const [id, entry] of Object.entries(sent)) {
      if (!validCheckpoint(entry)) continue;
      const previous = state.progress[id];
      const timestamp = checkpointTime(entry, now);
      // An echoed server snapshot also counts as a duplicate.
      const order = entry.updated === previous?.updated ? 0 : timestamp - (legacy ? previous?.updated ?? 0 : previousTime(state, id));
      if (!isObject(previous) || order > 0 || (order === 0 && (!previous.hidden || entry.hidden === true))) {
        // An older client compares against its own stored time, so keep that rather than the server clock.
        const next = { position: entry.position, duration: entry.duration ?? 0, updated: legacy ? timestamp : now };
        if (typeof entry.completed === 'boolean') next.completed = entry.completed;
        if (typeof entry.hidden === 'boolean') next.hidden = entry.hidden;
        // A first paused checkpoint can belong to a show dismissed on another device.
        const item = !previous && next.hidden === undefined ? library.item(id) : null;
        if (next.hidden === undefined && (previous?.hidden || item?.kind === 'show' && isContinueDismissed(q.episodes.all(item.group_id), state.progress))) next.hidden = true;
        // Preserve recency on retries and on a visibility-only dismissal.
        if (!isObject(previous) || !sameCheckpoint(previous, next)) {
          if (previous && order === 0 && next.hidden) next.updated = previous.updated ?? now;
          state.progressTimes[id] = order === 0 && previous ? previousTime(state, id) : timestamp;
          state.progress[id] = next;
        }
      }
      if (state.progress[id]) confirmed[id] = state.progress[id];
    }
    return confirmed;
  }
  router.add('PATCH', '/api/items/:id/progress', async ctx => {
    const body = await readJson(ctx.req);
    const item = library.item(ctx.params.id);
    if (!item) throw new HttpError(404, 'No such title.');
    if (!isObject(body) || (body.dismiss === true) === (typeof body.completed === 'boolean')) throw new HttpError(400, 'Bad progress change.');
    const state = stateOf(ctx.user.id), siblings = item.kind === 'show' ? q.episodes.all(item.group_id) : [item], now = Date.now();
    let progress;
    if (body.dismiss === true) {
      if (body.dismissedAt !== undefined && (!Number.isFinite(body.dismissedAt) || body.dismissedAt < 0)) throw new HttpError(400, 'Bad dismissal time.');
      const cutoff = Math.min(body.dismissedAt ?? now, now);
      progress = Object.fromEntries(siblings.filter(i => isObject(state.progress[i.id]) && previousTime(state, i.id) <= cutoff)
        .map(i => [i.id, { ...state.progress[i.id], hidden: true }]));
    } else {
      const previous = isObject(state.progress[item.id]) ? state.progress[item.id] : {}, checkpoint = body.checkpoint;
      // A recovered local position can be ahead of the server. Ignore older client snapshots.
      const newer = validCheckpoint(checkpoint) && checkpoint.updated !== previous.updated && checkpointTime(checkpoint, now) > (legacyRequest(ctx) ? previous.updated ?? 0 : previousTime(state, item.id));
      const source = newer ? checkpoint : previous;
      const hidden = item.kind === 'show' && (!!previous.hidden || isContinueDismissed(siblings, state.progress));
      progress = { [item.id]: { ...previous, position: source.position ?? 0, duration: source.duration ?? 0, completed: body.completed,
        hidden, updated: now } };
      state.progressTimes[item.id] = now;
    }
    Object.assign(state.progress, progress);
    q.set.run(ctx.user.id, JSON.stringify(state), Date.now());
    return { progress };
  });
  router.add('PUT', '/api/state', async ctx => {
    const body = await readJson(ctx.req, 4 * 1024 * 1024), state = stateOf(ctx.user.id);
    const now = Date.now();
    let progress;
    if (body.progress !== undefined) {
      if (!isObject(body.progress)) throw new HttpError(400, 'Bad progress.');
      progress = mergeProgress(state, body.progress, now, legacyRequest(ctx));
    }
    if (body.queue !== undefined && !validQueue(body.queue)) throw new HttpError(400, 'Bad queue.');
    if (body.queueChange !== undefined) {
      const { add, remove } = body.queueChange || {};
      if (!validQueue(add) || !validQueue(remove)) throw new HttpError(400, 'Bad queue change.');
      const removed = new Set(remove);
      const queue = [...new Set([...state.queue.filter(id => !removed.has(id)), ...add])];
      if (!validQueue(queue)) throw new HttpError(400, 'The queue is full.');
      state.queue = queue;
      state.queueEdited = true;
    } else if (body.queue !== undefined && (!state.queueEdited || body.progress === undefined)) {
      // Older explicit queue requests still work. An older playback snapshot cannot replace an edited queue.
      state.queue = body.queue;
    }
    if (body.preferences !== undefined) {
      if (!isObject(body.preferences)) throw new HttpError(400, 'Bad preferences.');
      state.preferences = mergePreferences(state.preferences, body.preferences);
    }
    if (body.markers !== undefined) {
      if (!isObject(body.markers)) throw new HttpError(400, 'Bad markers.');
      // An older tab can still add new manual marks, but a checkpoint's
      // full map can no longer undo a targeted edit or removal.
      for (const [id, markers] of Object.entries(body.markers)) {
        if (!Array.isArray(markers) || !library.item(id)) continue;
        const kept = state.markers[id] || [], dismissed = state.markerDismissals[id] || [];
        for (const marker of markers) {
          if (!validMarker(marker) || marker.source === 'automatic' || dismissed.some(mark => sameMarker(mark, marker))) continue;
          if (!kept.some(mark => mark.type === marker.type || overlaps(mark, marker))) kept.push(manualMarker(marker));
        }
        if (kept.length) state.markers[id] = kept;
      }
    }
    q.set.run(ctx.user.id, JSON.stringify(state), now);
    return progress ? { ok: true, progress } : undefined;
  });
}
const validQueue = queue => Array.isArray(queue) && queue.length <= 1000 && queue.every(id => typeof id === 'string');
function mergePreferences(previous, patch) {
  const { tracks, subtitles, ...fields } = patch;
  const preferences = { ...previous, ...fields };
  if (tracks === null) delete preferences.tracks;
  else if (isObject(tracks)) {
    preferences.tracks = { ...previous.tracks, ...Object.fromEntries(Object.entries(tracks).filter(([, choice]) => isObject(choice))
      .map(([key, choice]) => [key, { ...previous.tracks?.[key], ...choice }])) };
  }
  if (isObject(subtitles)) preferences.subtitles = { ...previous.subtitles, ...subtitles };
  return preferences;
}
module.exports = { register };
