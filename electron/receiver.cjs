// Receiver mode: the desktop window keeps its own renderer and talks to a Matro server instead of the local disk.
// Each handler answers the same IPC channel its local twin in main.cjs does, translated into the server's API the way
// server/public/web/adapter.js does for browsers. Media, frames and artwork reach the renderer through the matro://app/server/ proxy.
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const PROXY = 'matro://app/server';
const SIDECAR = 10000; // uploaded subtitle tracks get indexes from here up, as sidecar files do locally
const KIND = { full: '', forced: ' (forced)', sdh: ' (SDH)' };
const VIDEO = ['mkv', 'mp4', 'm4v', 'mov', 'webm', 'avi', 'ts', 'm2ts', 'wmv', 'flv'];
const track = u => ({ index: SIDECAR + u.id, language: u.language, title: `${u.name}${KIND[u.kind] || ''}`, codec: 'vtt', text: true, bitmap: false, sidecar: true, uploaded: true, uploadId: u.id, addedBy: u.addedBy });

/** Where a matro://app/server/... request goes on the server; only the API is reachable. */
function proxyTarget(base, requestUrl) {
  const url = new URL(requestUrl);
  if (url.hostname !== 'app' || !url.pathname.startsWith('/server/api/')) return null;
  return base + url.pathname.slice('/server'.length) + url.search;
}

/** Name, language and type for an uploaded subtitle file, guessed from its file name ("Show.S01E01.pl.forced.srt"). */
function subtitleMeta(file) {
  const parts = path.basename(file).replace(/\.[^.]+$/, '').split('.');
  const kind = parts.some(p => /^forced$/i.test(p)) ? 'forced' : parts.some(p => /^(sdh|cc)$/i.test(p)) ? 'sdh' : 'full';
  const language = (parts.slice(1).find(p => /^[a-z]{2,3}$/i.test(p) && !/^(cc|srt|sdh)$/i.test(p)) || 'en').toLowerCase();
  return { name: parts.join(' ').replace(/[_ ]+/g, ' ').slice(0, 60) || 'Subtitles', language, kind };
}

/** A request that never reached the server (as opposed to the server answering with an error). */
const isOffline = error => error instanceof TypeError || /ECONN|ENOTFOUND|ETIMEDOUT|net::|fetch failed|Failed to fetch|timed out|aborted/i.test(String(error?.message));

function createReceiver({ base, fetch: doFetch, user, openDialog, notifyMetadata, offline, cache, confirm = async () => true }) {
  const details = new Map(), watchers = { run: 0 };
  let latest = null;
  const admin = () => user.role === 'admin';
  const headOnly = (message = 'Only the head account can add or remove media.') => { if (!admin()) throw new Error(message); };

  async function call(method, route, body, upload) {
    const headers = { 'x-matro': '1' };
    const init = { method, headers, credentials: 'include' };
    if (upload) { init.body = upload; init.duplex = 'half'; headers['content-type'] = 'application/octet-stream'; }
    else if (body !== undefined) { init.body = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const res = await doFetch(base + route, init);
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error ?? `Server answered ${res.status}.`);
    return json;
  }
  const get = route => call('GET', route), post = (route, body) => call('POST', route, body);

  // Unsent progress from an offline session is sent first, then the library is remembered for the next time the server is out of reach.
  async function load() {
    let data;
    try {
      const pending = await cache.read('pending');
      if (pending) { try { await call('PUT', '/api/state', pending); await cache.write('pending', null); } catch (error) { if (!isOffline(error)) throw error; } }
      data = await get('/api/library');
      await cache.write('library', data).catch(() => {});
    } catch (error) {
      data = isOffline(error) ? await cache.read('library') : null;
      if (!data) throw error;
      data = { ...data, progress: { ...data.progress, ...(await cache.read('pending'))?.progress }, offline: true };
    }
    user = data.user || user; latest = data;
    if (data.metadataEnabled && !data.offline) follow();
    return data;
  }
  // TMDB matching runs on the server in the background; keep asking for a short while so posters appear as they arrive.
  function follow() {
    const run = ++watchers.run; let quiet = 0, last = Object.keys(latest.metadata || {}).length;
    (async () => {
      while (run === watchers.run && quiet < 12) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (run !== watchers.run) return;
        try {
          const { metadata } = await get('/api/metadata'), count = Object.keys(metadata).length;
          if (count !== last) { last = count; quiet = 0; latest.metadata = metadata; notifyMetadata(metadata); } else quiet++;
        } catch { quiet++; }
      }
    })();
  }
  async function inspect(id) {
    const saved = offline.info(id);
    if (saved) { details.set(id, saved); return saved; }
    const info = await get(`/api/items/${encodeURIComponent(id)}/info`);
    const result = { duration: info.duration, video: info.video, audio: info.audio, chapters: info.chapters, directPlay: info.directPlay,
      subtitles: [...info.embedded.map(({ forced: _forced, ...t }) => t), ...info.uploaded.map(track)] };
    details.set(id, result);
    return result;
  }
  async function subtitles({ id, index }) {
    const saved = offline.subtitle(id, String(index));
    if (saved !== null) return saved;
    const res = await doFetch(`${base}/api/items/${encodeURIComponent(id)}/subtitles/${index >= SIDECAR ? `u${index - SIDECAR}` : `e${index}`}`, { credentials: 'include', headers: { 'x-matro': '1' } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load subtitles.');
    return res.text();
  }
  // Direct play when the player can handle the file as-is; otherwise a transcode that starts at `offset`.
  async function stream({ id, offset = 0, audio = null, bitmapSubtitle = null, subtitleDelay = 0, preload = false }) {
    if (offline.has(id) && bitmapSubtitle === null) return { url: `matro://app/offline/${encodeURIComponent(id)}${offset > 0 ? `#t=${offset}` : ''}`, offset: 0 };
    const d = details.get(id) || await inspect(id), first = d.audio[0], item = encodeURIComponent(id);
    if (d.directPlay && bitmapSubtitle === null && (audio === null || !first || audio === first.index)) return { url: `${PROXY}/api/items/${item}/direct${offset > 0 ? `#t=${offset}` : ''}`, offset: 0 };
    const q = new URLSearchParams({ t: String(Math.floor(offset * 10) / 10) });
    if (audio !== null) q.set('audio', audio);
    if (bitmapSubtitle !== null) { q.set('burn', bitmapSubtitle); q.set('delay', subtitleDelay); }
    if (preload) q.set('preload', '1');
    return { url: `${PROXY}/api/items/${item}/transcode?${q}`, offset };
  }
  async function upload(files) {
    headOnly();
    let sent = 0;
    for (const file of files) {
      if (!VIDEO.includes(path.extname(file).slice(1).toLowerCase()) || !fs.statSync(file).isFile()) continue;
      await call('POST', `/api/admin/upload?path=${encodeURIComponent(path.basename(file))}`, undefined, Readable.toWeb(fs.createReadStream(file)));
      sent++;
    }
    if (!sent) throw new Error('Pick video files to send to the server.');
    return load();
  }
  const download = async (route, value) => {
    headOnly('Only the head account can manage downloads.');
    const url = `/api/admin/downloads/${route}`;
    return (value === undefined ? await get(url) : await post(url, value)).result;
  };
  const unsupported = what => () => Promise.reject(new Error(`${what} is not available in receiver mode.`));

  // What a saved copy carries: the first audio track, text subtitles and the info the player needs, as the server's offline file does.
  async function prepareOffline(id) {
    const full = await inspect(id), tracks = full.subtitles.filter(t => t.text && !t.bitmap), texts = {};
    for (const t of tracks) { try { texts[String(t.index)] = await subtitles({ id, index: t.index }); } catch { /* that track stays online-only */ } }
    const item = latest?.items.find(i => i.id === id);
    return { info: { ...full, audio: full.audio.slice(0, 1), subtitles: tracks }, subtitles: texts, title: item ? `${item.group || item.title}${item.kind === 'show' ? ` · ${item.title}` : ''}` : id };
  }

  const handlers = {
    'offline:toggle': async id => {
      if (offline.progress(id) !== null) { offline.cancel(id); return 'cancelled'; }
      if (offline.has(id)) { if (await confirm('Remove the offline copy from this PC?')) await offline.remove(id); return 'removed'; }
      await offline.start(id); return 'saved';
    },
    'offline:list': async () => ({ saved: offline.list(), partial: await offline.partials(), bytes: offline.usage() }),
    'offline:remove': id => offline.remove(id),
    'library:load': load,
    'media:inspect': inspect, 'media:prepare': inspect,
    'media:stream': stream, 'media:subtitles': subtitles,
    'media:subtitle-file': async id => {
      const result = await openDialog({ properties: ['openFile'], filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }] });
      if (result.canceled || !result.filePaths[0]) return null;
      const file = result.filePaths[0], meta = subtitleMeta(file);
      const q = new URLSearchParams({ ...meta, filename: path.basename(file) });
      const { subtitle } = await call('POST', `/api/items/${encodeURIComponent(id)}/subtitles?${q}`, undefined, fs.readFileSync(file));
      return { text: await subtitles({ id, index: SIDECAR + subtitle.id }), track: track({ ...subtitle, addedBy: user.username }) };
    },
    'media:preview': async ({ id, time, hover }) => `${PROXY}/api/items/${encodeURIComponent(id)}/frame?t=${Math.max(0, Number(time) || 0)}&w=${hover ? 320 : 480}`,
    'media:stop': async () => {}, 'media:playback-state': async () => {},
    'media:segments': async () => [], 'media:remove-marker': async () => ({}),
    'media:scanner': async () => latest?.scanner || { message: 'Library is up to date', running: false, total: 0, ready: 0 },
    'library:save': async state => {
      const body = { progress: state.progress, queue: state.queue, preferences: state.preferences, markers: state.markers || {} };
      try { await call('PUT', '/api/state', body); } catch (error) { if (isOffline(error)) await cache.write('pending', body).catch(() => {}); }
    },
    'library:rescan': async () => { if (admin()) await post('/api/admin/rescan'); return load(); },
    'library:folder': async () => { headOnly(); throw new Error('Folders on the server are added from the server\'s web page. Use Open files to send videos from this PC.'); },
    'library:files': async () => {
      headOnly();
      const result = await openDialog({ properties: ['openFile', 'multiSelect'], filters: [{ name: 'Video', extensions: VIDEO }] });
      return result.canceled ? load() : upload(result.filePaths);
    },
    'library:import': files => upload(files),
    'library:remove-folder': async root => { headOnly(); const { folders } = await get('/api/admin/folders'); const folder = folders.find(f => f.path === root); if (folder) await call('DELETE', `/api/admin/folders/${folder.id}`); return load(); },
    'library:ssh': unsupported('SSH sources'), 'library:prelude': unsupported('Preludes'),
    'metadata:search': async ({ kind, query, year }) => { headOnly('Only the head account can change TMDB matches.'); const q = new URLSearchParams({ kind, query }); if (year) q.set('year', year); return (await get(`/api/admin/metadata/search?${q}`)).results; },
    'metadata:assign': async ({ key, tmdbId }) => { headOnly('Only the head account can change TMDB matches.'); const { metadata } = await post('/api/admin/metadata/assign', { key, tmdbId }); latest.metadata = metadata; return metadata; },
    'downloads:series-search': v => download('series-search', v), 'downloads:series-releases': v => download('series-releases', v),
    'downloads:series-source': async () => {},
    'downloads:upgrade': unsupported('Edition upgrades'), 'downloads:favorite': unsupported('Edition favorites'),
    'downloads:jobs': () => download('jobs'), 'downloads:retry': id => download('retry', { id }), 'downloads:remove': v => download('remove', v),
    'downloads:config': () => download('config'), 'downloads:configure': v => download('configure', v),
    'downloads:search': v => download('search', v), 'downloads:add': v => download('add', v), 'downloads:list': () => download('list')
  };
  return { handlers, prepareOffline, call, role: () => user.role, username: () => user.username, stop: () => { watchers.run++; } };
}

module.exports = { isOffline, createReceiver, proxyTarget, subtitleMeta, PROXY };
