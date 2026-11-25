// window.matro for the browser: the desktop renderer calls this object where Electron would call its main process.
// Everything here turns those calls into requests to the server.
import { get, post, put, patch, del, api } from './http.js';
import { h, say, dialog, languageSelect } from './dom.js';
import { accountScope, createOffline, networkLost } from './offline.js';
import { toVtt } from './offline-store.js';
import { mountMovieRequests } from './movie-requests.js';

const SIDECAR = 10000; // uploaded subtitle tracks get indexes from here up, as sidecar files do on the desktop
const KIND = { full: '', forced: ' (forced)', sdh: ' (SDH)' };
const sizeText = bytes => bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

// The matcher stores artwork as `artwork/<name>`; on the server those files live behind the API.
const artwork = value => typeof value === 'string' ? (value.startsWith('artwork/') ? `/api/${value}` : value) : Array.isArray(value) ? value.map(artwork) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, artwork(v)])) : value;

export function createAdapter(session) {
  const noop = () => () => {};
  const watchers = new Set();
  const scope = accountScope(session.user), offline = createOffline(session.user);
  function checkAccount(data) {
    if (accountScope(data.user) === scope) return;
    location.reload();
    throw new Error('The signed-in account changed.');
  }
  let polling = 0;
  const unsupported = what => () => Promise.reject(new Error(`${what} is a desktop feature.`));
  const headOnly = (message = 'Only the head account can add or remove media.') => { if (session.user.role !== 'admin') throw new Error(message); };
  const download = async (route, value) => {
    headOnly('Only the head account can manage downloads.');
    const url = `/api/admin/downloads/${route}`;
    return (value === undefined ? await get(url) : await post(url, value)).result;
  };
  const details = new Map();
  let latest = null;

  async function load() {
    if (session.offline) return latest = await offline.library();
    let data;
    try { data = await get('/api/library'); }
    catch (error) {
      if (!networkLost(error)) throw error;
      latest = await offline.library();
      session.offline = true;
      return latest;
    }
    checkAccount(data);
    if (await offline.sync(body => put('/api/state', body)).catch(() => false)) {
      data = await get('/api/library').catch(() => data);
      checkAccount(data);
    }
    if (offlineSync) await offlineSync.catch(() => {});
    offlineSync = offline.flushSubtitles(({ id, query, body }) => api('POST', `/api/items/${id}/subtitles?${query}`, body)).catch(() => {});
    data.metadata = artwork(data.metadata);
    await offline.remember(data).catch(() => {});
    acceptLibrary(data);
    return data;
  }
  function acceptLibrary(data) {
    session.user = data.user; latest = data;
    if (data.metadataEnabled) follow();
  }
  let offlineSync;
  function watchDownloads(callback) {
    let closed = false, checking = false;
    const check = async () => {
      const before = latest;
      if (session.offline || closed || checking || document.hidden || !before?.catalogRevision) return;
      checking = true;
      try {
        const { catalogRevision } = await get('/api/library/revision');
        if (closed || latest !== before || catalogRevision === before.catalogRevision) return;
        const data = await get('/api/library');
        if (closed || latest !== before) return;
        checkAccount(data);
        data.metadata = artwork(data.metadata);
        acceptLibrary(data);
        void offline.remember(data).catch(() => {});
        callback({ items: data.items, folders: data.folders, metadata: data.metadata });
      } catch { /* Check again after a temporary outage. */ }
      finally { checking = false; }
    };
    const timer = setInterval(check, 5000);
    document.addEventListener('visibilitychange', check);
    return () => { closed = true; clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }
  // TMDB matching runs on the server in the background; keep asking for a short while so posters appear as they arrive.
  function follow() {
    const run = ++polling; let quiet = 0, last = JSON.stringify(latest.metadata);
    (async () => {
      while (run === polling && quiet < 12) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (run !== polling) return;
        try {
          const { metadata } = await get('/api/metadata'), fixed = artwork(metadata), signature = JSON.stringify(fixed);
          if (signature !== last) { last = signature; quiet = 0; latest.metadata = fixed; for (const cb of watchers) cb(fixed); } else quiet++;
        } catch { quiet++; }
      }
    })();
  }
  async function inspect(id) {
    if (session.offline) {
      const saved = await offline.store.meta(id);
      if (!saved?.complete) throw new Error('This title is not saved on this device.');
      details.set(id, saved.info);
      return saved.info;
    }
    const info = await get(`/api/items/${id}/info`);
    const result = { duration: info.duration, video: info.video, audio: info.audio, chapters: info.chapters, directPlay: info.directPlay,
      subtitles: [...info.embedded.map(({ forced: _f, ...t }) => t), ...info.uploaded.map(u => track(u))] };
    details.set(id, result);
    return result;
  }
  const track = u => ({ index: SIDECAR + u.id, language: u.language, title: `${u.name}${KIND[u.kind] || ''}`, codec: 'vtt', text: true, bitmap: false, sidecar: true, uploaded: true, uploadId: u.id, addedBy: u.addedBy });

  // Subtitle files any signed-in person can add to a title, with the name and language everyone will see.
  async function loadSubtitle(id) {
    const file = h('input', { type: 'file', name: 'file', accept: '.srt,.vtt,.ass,.ssa', required: true });
    const name = h('input', { name: 'name', maxLength: 60, required: true, placeholder: 'e.g. English (fan-timed)', autocomplete: 'off' });
    const language = languageSelect('en');
    const kind = h('select', { name: 'kind' }, [['full', 'Full'], ['forced', 'Forced only'], ['sdh', 'SDH / captions']].map(([v, l]) => h('option', { value: v }, l)));
    const status = h('p', { class: 'web-status', role: 'status' });
    file.addEventListener('change', () => { if (!name.value && file.files[0]) name.value = file.files[0].name.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').slice(0, 60); });
    const submit = h('button', { class: 'pill primary', type: 'submit' }, 'Add subtitles');
    const form = h('form', { onsubmit: async e => {
      e.preventDefault(); submit.disabled = true; status.textContent = 'Uploading…';
      try {
        const q = new URLSearchParams({ name: name.value, lang: language.value, kind: kind.value, filename: file.files[0].name });
        if (session.offline) {
          const local = file.files[0];
          if (local.size > 4 * 1024 * 1024) throw new Error('Subtitle files must be smaller than 4 MB.');
          const text = toVtt(await local.text(), local.name);
          const index = -Number(crypto.getRandomValues(new Uint32Array(1))[0]) - 1;
          const track = { index, title: name.value, language: language.value, codec: 'vtt', text: true, sidecar: true };
          q.set('queued', '1');
          await offline.queueSubtitle(id, track, text, local, q.toString());
          box.close({ queued: { text, track: text ? track : undefined, warning: 'Queued to upload when Matro reconnects.' } });
          return;
        }
        const { subtitle } = await api('POST', `/api/items/${id}/subtitles?${q}`, file.files[0]);
        box.close(subtitle);
      } catch (error) { status.textContent = error.message; submit.disabled = false; }
    } }, h('p', { class: 'muted' }, 'Everyone who watches this title can pick these subtitles. You and the head account can change or remove them later from your profile.'),
    h('div', { class: 'ssh-fields web-fields' }, h('label', { class: 'ssh-wide' }, 'Subtitle file (SRT, VTT, ASS or SSA)', file), h('label', { class: 'ssh-wide' }, 'Name shown to everyone', name), h('label', {}, 'Language', language), h('label', {}, 'Type', kind)),
    status, h('div', { class: 'show-actions' }, submit, h('button', { class: 'pill', type: 'button', onclick: () => box.close(null) }, 'Cancel')));
    const box = dialog('Add subtitles', form);
    const subtitle = await box.done;
    if (!subtitle) return null;
    if (subtitle.queued) { details.delete(id); return subtitle.queued; }
    const text = await subtitles({ id, index: SIDECAR + subtitle.id });
    return { text, track: track({ ...subtitle, addedBy: session.user.username }) };
  }
  async function subtitles({ id, index, signal }) {
    if (session.offline) return (await offline.store.meta(id))?.subtitles[index] || '';
    const res = await fetch(`/api/items/${id}/subtitles/${index >= SIDECAR ? `u${index - SIDECAR}` : `e${index}`}`, { credentials: 'same-origin', signal });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load subtitles.');
    return res.text();
  }

  // Direct play when the browser can handle the file as-is; otherwise a transcode that starts at `offset`.
  async function stream({ id, offset = 0, audio = null, bitmapSubtitle = null, subtitleDelay = 0, preload = false, forceTranscode = false }) {
    const saved = await offline.store.meta(id).catch(() => null);
    if (saved?.complete && bitmapSubtitle === null && (audio === null || audio === saved.info.audio[0]?.index)) {
      const url = await offline.playback(id);
      if (url) return { url: preload && offset > 0 ? `${url}#t=${offset}` : url, offset: 0 };
    }
    if (session.offline) throw new Error('This title or track is unavailable offline.');
    const d = details.get(id) || await inspect(id), first = d.audio[0];
    if (!forceTranscode && d.directPlay && bitmapSubtitle === null && (audio === null || !first || audio === first.index)) return { url: `/api/items/${id}/direct${preload ? '?preload=1' : ''}${offset > 0 ? `#t=${offset}` : ''}`, offset: 0 };
    const q = new URLSearchParams({ t: String(Math.floor(offset * 10) / 10) });
    if (audio !== null) q.set('audio', audio);
    if (bitmapSubtitle !== null) { q.set('burn', bitmapSubtitle); q.set('delay', subtitleDelay); }
    if (preload) q.set('preload', '1');
    return { url: `/api/items/${id}/transcode?${q}`, offset };
  }

  // Adding media is for the head account: a folder on the server, or files sent from this browser.
  async function chooseFolder() {
    const body = h('div', { class: 'web-picker' }); let box;
    async function open(path) {
      try {
        const d = await get(`/api/admin/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`);
        body.replaceChildren(h('p', { class: 'mono wrap dim' }, d.path), h('div', { class: 'picker' }, d.parent ? h('button', { type: 'button', class: 'file-row', onclick: () => open(d.parent) }, '← ..') : null,
          d.dirs.map(n => h('button', { type: 'button', class: 'file-row', onclick: () => open(d.path.replace(/[\\/]$/, '') + (d.path.includes('\\') ? '\\' : '/') + n) }, h('span', { class: 'mono' }, n)))),
        h('div', { class: 'show-actions' }, h('button', { class: 'pill primary', type: 'button', onclick: () => box.close(d.path) }, 'Add this folder')));
      } catch (error) { say(error.message); }
    }
    box = dialog('Choose a folder on the server', body); open('');
    return box.done;
  }
  const send = (file, folder = '') => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/admin/upload?path=${encodeURIComponent([folder, file.name].filter(Boolean).join('/'))}`);
    xhr.setRequestHeader('x-matro', '1');
    xhr.upload.onprogress = e => { if (e.lengthComputable) say(`Uploading ${file.name} · ${Math.round(e.loaded / e.total * 100)}% of ${sizeText(file.size)}`); };
    xhr.onload = () => xhr.status === 200 ? resolve() : reject(new Error(JSON.parse(xhr.responseText || '{}').error || `Could not upload ${file.name}.`));
    xhr.onerror = () => reject(new Error(`Upload of ${file.name} failed (connection lost).`));
    xhr.send(file);
  });
  async function upload(files) {
    headOnly();
    for (const file of files) await send(file);
    say(`Added ${files.length} file${files.length === 1 ? '' : 's'}.`);
    return load();
  }
  async function pickFiles() {
    headOnly();
    const input = h('input', { type: 'file', multiple: true, accept: 'video/*,.mkv,.avi,.ts,.m2ts,.wmv,.flv' });
    const files = await new Promise(resolve => { input.addEventListener('change', () => resolve([...input.files])); input.addEventListener('cancel', () => resolve([])); input.click(); });
    return files.length ? upload(files) : load();
  }

  const matro = {
    chooseSource: window.matroDesktop?.chooseSource,
    recoveryScope: scope,
    load, inspect, prepare: inspect, subtitles, loadSubtitle, stream,
    offlineSave: session.offline ? null : async id => {
      const item = latest.items.find(item => item.id === id);
      if (!item) throw new Error('That title is no longer in the library.');
      const saved = await offline.store.meta(id);
      if (!saved?.complete) await offline.download({ ...item, title: latest.metadata[item.groupId || item.id]?.title || item.title }, inspect, subtitles);
    },
    // A season at a time, two titles at once: the server converts files before sending, so more only queues there.
    offlineSaveMany: session.offline ? null : async ids => {
      const queue = [...ids]; let failure;
      await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
        for (let id; (id = queue.shift());) {
          try { await matro.offlineSave(id); } catch (error) { if (error.name !== 'AbortError') failure ??= error; }
        }
      }));
      if (failure) throw failure;
    },
    dismissContinue: session.offline ? undefined : async id => (await patch(`/api/items/${encodeURIComponent(id)}/progress`, { dismiss: true })).progress,
    setCompleted: session.offline ? undefined : async (id, completed, checkpoint) => (await patch(`/api/items/${encodeURIComponent(id)}/progress`, { completed, checkpoint })).progress,
    save: (state, { keepalive = false } = {}) => {
      const body = { progress: state.progress, queue: state.queue, preferences: state.preferences };
      // Keepalive has a small shared in-flight byte quota. Reserve it for exit;
      // ordinary overlapping checkpoints must not consume that quota.
      if (session.offline) return offline.queue({ progress: body.progress });
      return put('/api/state', body, { keepalive: keepalive && new Blob([JSON.stringify(body)]).size < 60000 }).catch(error => {
        if (!networkLost(error)) throw error;
        return offline.queue({ progress: body.progress });
      });
    },
    stop: async keepUrl => {
      offline.release(keepUrl);
      if (!session.offline) await post('/api/playback/stop', { keepPreload: !!keepUrl && new URL(keepUrl, location.origin).searchParams.get('preload') === '1' }).catch(error => { if (!networkLost(error)) throw error; });
    }, playbackState: value => post('/api/playback/state', typeof value === 'object' ? value : { playing: !!value }).catch(() => {}),
    preview: async ({ id, time, hover }) => `/api/items/${id}/frame?t=${Math.max(0, Number(time) || 0)}&w=${hover ? 320 : 480}`,
    segments: async ({ id, force }) => (await post(`/api/items/${id}/segments`, { force })).markers,
    saveMarkers: async edits => (await post('/api/segments/manual', edits)).markers,
    removeMarker: async ({ id, marker }) => (await post(`/api/items/${id}/segments/remove`, { marker })).markers,
    scannerStatus: async () => (await get('/api/segments')).scanner,
    rescan: async () => { if (session.user.role === 'admin') await post('/api/admin/rescan'); return load(); },
    addFolder: async () => { headOnly(); const path = await chooseFolder(); if (path) { const r = await post('/api/admin/folders', { path }); say(r.ok ? `Added. Found ${r.items} video${r.items === 1 ? '' : 's'}.` : r.error); } return load(); },
    openFiles: pickFiles, importDrop: files => upload(Array.from(files)),
    removeFolder: async root => { headOnly(); const { folders } = await get('/api/admin/folders'); const folder = folders.find(f => f.path === root); if (folder) await del(`/api/admin/folders/${folder.id}`); return load(); },
    window: async action => { if (window.matroDesktop) return window.matroDesktop.window(action); if (action === 'fullscreen') { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen().catch(() => {}); } },
    onFullscreen: callback => {
      if (window.matroDesktop) { const remove = window.matroDesktop.onFullscreen(callback); void window.matroDesktop.fullscreen().then(callback); return remove; }
      const listener = () => callback(!!document.fullscreenElement); document.addEventListener('fullscreenchange', listener); return () => document.removeEventListener('fullscreenchange', listener);
    },
    onSegments: callback => {
      let closed = false, timer, previous = {};
      const poll = async () => {
        try {
          const update = await get('/api/segments');
          if (closed) return;
          callback({ scanner: update.scanner });
          for (const [id, markers] of Object.entries(update.markers)) {
            const key = JSON.stringify(markers);
            if (key !== previous[id]) { previous[id] = key; callback({ id, markers, stage: 'done', scanner: update.scanner }); }
          }
        } catch { /* Retry after transient connection failures. */ }
        if (!closed) timer = setTimeout(poll, 5000);
      };
      timer = setTimeout(poll, 1000);
      return () => { closed = true; clearTimeout(timer); };
    }, onDownloads: watchDownloads, onClosing: noop,
    onMetadata: callback => { watchers.add(callback); return () => watchers.delete(callback); },
    searchMetadata: async ({ kind, query, year }) => { headOnly('Only the head account can change TMDB matches.'); const q = new URLSearchParams({ kind, query }); if (year) q.set('year', year); return artwork((await get(`/api/admin/metadata/search?${q}`)).results); },
    assignMetadata: async ({ key, tmdbId }) => { headOnly('Only the head account can change TMDB matches.'); const { metadata } = await post('/api/admin/metadata/assign', { key, tmdbId }); latest.metadata = artwork(metadata); return latest.metadata; },
    setMetadataLanguage: async ({ key, language }) => { headOnly('Only the head account can change TMDB metadata.'); const { metadata } = await post('/api/admin/metadata/language', { key, language }); latest.metadata = artwork(metadata); return latest.metadata; },
    openTitlePage: async ({ site, type, tmdbId, imdbId }) => {
      const url = site === 'imdb' && /^ttd{5,12}$/.test(imdbId || '') ? `https://www.imdb.com/title/${imdbId}/` : site === 'tmdb' && Number.isInteger(Number(tmdbId)) ? `https://www.themoviedb.org/${type === 'tv' ? 'tv' : 'movie'}/${Number(tmdbId)}` : null;
      if (url) window.open(url, '_blank', 'noopener');
    },
    connectSSH: unsupported('SSH sources'), setPrelude: unsupported('Preludes'), 
    downloadHostOnly: true,
    get movieRequests() {
      if (session.offline) return null;
      const admin = session.user.role === 'admin';
      return {
        label: admin ? 'Movie requests' : 'Request a movie',
        openOnLoad: session.openMovieRequests,
        mount: (node, search) => mountMovieRequests(node, { admin, search }),
      };
    },
    hiddenTabs: session.user.role === 'admin' && !session.offline ? [] : ['folders', 'downloads'],
    canCompareEditions: session.user.role === 'admin' && !session.offline,
    canEditMetadata: session.user.role === 'admin' && !session.offline,
    downloadSeriesSearch: value => download('series-search', value), downloadSeriesReleases: value => download('series-releases', value),
    downloadSeriesSource: async () => { say('Release information is provided by EZTV.'); },
    downloadUpgrade: unsupported('Edition upgrades'), downloadFavorite: unsupported('Edition favorites'),
    downloadJobs: () => download('jobs'), downloadRetry: id => download('retry', { id }), downloadRemove: value => download('remove', value),
    downloadConfig: () => download('config'), downloadConfigure: value => download('configure', value),
    downloadDiscover: value => download('discover', value), downloadPreview: value => download('preview', value),
    downloadSearch: value => download('search', value), downloadAdd: value => download('add', value), downloadList: () => download('list')
  };
  return { matro, offline, state: () => latest };
}
