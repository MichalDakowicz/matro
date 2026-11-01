// window.matro for the browser: the desktop renderer calls this object where Electron would call its main process.
// Everything here turns those calls into requests to the server.
import { get, post, put, del, api } from './http.js';
import { h, say, dialog, languageSelect } from './dom.js';

const SIDECAR = 10000; // uploaded subtitle tracks get indexes from here up, as sidecar files do on the desktop
const KIND = { full: '', forced: ' (forced)', sdh: ' (SDH)' };
const sizeText = bytes => bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

// The matcher stores artwork as `artwork/<name>`; on the server those files live behind the API.
const artwork = value => typeof value === 'string' ? (value.startsWith('artwork/') ? `/api/${value}` : value) : Array.isArray(value) ? value.map(artwork) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, artwork(v)])) : value;

export function createAdapter(session) {
  const noop = () => () => {};
  const watchers = new Set();
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
    const data = await get('/api/library');
    data.metadata = artwork(data.metadata);
    session.user = data.user; latest = data;
    if (data.metadataEnabled) follow();
    return data;
  }
  // TMDB matching runs on the server in the background; keep asking for a short while so posters appear as they arrive.
  function follow() {
    const run = ++polling; let quiet = 0, last = JSON.stringify(Object.keys(latest.metadata).length);
    (async () => {
      while (run === polling && quiet < 12) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (run !== polling) return;
        try {
          const { metadata } = await get('/api/metadata'), fixed = artwork(metadata), signature = JSON.stringify(Object.keys(fixed).length);
          if (signature !== last) { last = signature; quiet = 0; latest.metadata = fixed; for (const cb of watchers) cb(fixed); } else quiet++;
        } catch { quiet++; }
      }
    })();
  }
  async function inspect(id) {
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
        const { subtitle } = await api('POST', `/api/items/${id}/subtitles?${q}`, file.files[0]);
        box.close(subtitle);
      } catch (error) { status.textContent = error.message; submit.disabled = false; }
    } }, h('p', { class: 'muted' }, 'Everyone who watches this title can pick these subtitles. You and the head account can change or remove them later from your profile.'),
    h('div', { class: 'ssh-fields web-fields' }, h('label', { class: 'ssh-wide' }, 'Subtitle file (SRT, VTT, ASS or SSA)', file), h('label', { class: 'ssh-wide' }, 'Name shown to everyone', name), h('label', {}, 'Language', language), h('label', {}, 'Type', kind)),
    status, h('div', { class: 'show-actions' }, submit, h('button', { class: 'pill', type: 'button', onclick: () => box.close(null) }, 'Cancel')));
    const box = dialog('Add subtitles', form);
    const subtitle = await box.done;
    if (!subtitle) return null;
    const text = await subtitles({ id, index: SIDECAR + subtitle.id });
    return { text, track: track({ ...subtitle, addedBy: session.user.username }) };
  }
  async function subtitles({ id, index }) {
    const res = await fetch(`/api/items/${id}/subtitles/${index >= SIDECAR ? `u${index - SIDECAR}` : `e${index}`}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load subtitles.');
    return res.text();
  }

  // Direct play when the browser can handle the file as-is; otherwise a transcode that starts at `offset`.
  async function stream({ id, offset = 0, audio = null, bitmapSubtitle = null, subtitleDelay = 0, preload = false }) {
    const d = details.get(id) || await inspect(id), first = d.audio[0];
    if (d.directPlay && bitmapSubtitle === null && (audio === null || !first || audio === first.index)) return { url: `/api/items/${id}/direct${offset > 0 ? `#t=${offset}` : ''}`, offset: 0 };
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
    load, inspect, prepare: inspect, subtitles, loadSubtitle, stream,
    save: state => put('/api/state', { progress: state.progress, queue: state.queue, preferences: state.preferences, markers: state.markers || {} }, { keepalive: JSON.stringify(state).length < 60000 }).catch(() => {}),
    stop: async () => {}, playbackState: async () => {},
    preview: async ({ id, time, hover }) => `/api/items/${id}/frame?t=${Math.max(0, Number(time) || 0)}&w=${hover ? 320 : 480}`,
    segments: async () => [], removeMarker: async () => ({}), scannerStatus: async () => latest?.scanner || { message: 'Library is up to date', running: false, total: 0, ready: 0 },
    rescan: async () => { if (session.user.role === 'admin') await post('/api/admin/rescan'); return load(); },
    addFolder: async () => { headOnly(); const path = await chooseFolder(); if (path) { const r = await post('/api/admin/folders', { path }); say(r.ok ? `Added. Found ${r.items} video${r.items === 1 ? '' : 's'}.` : r.error); } return load(); },
    openFiles: pickFiles, importDrop: files => upload(Array.from(files)),
    removeFolder: async root => { headOnly(); const { folders } = await get('/api/admin/folders'); const folder = folders.find(f => f.path === root); if (folder) await del(`/api/admin/folders/${folder.id}`); return load(); },
    window: async action => { if (action === 'fullscreen') { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen().catch(() => {}); } },
    onFullscreen: callback => { const listener = () => callback(!!document.fullscreenElement); document.addEventListener('fullscreenchange', listener); return () => document.removeEventListener('fullscreenchange', listener); },
    onSegments: noop, onDownloads: noop, onClosing: noop,
    onMetadata: callback => { watchers.add(callback); return () => watchers.delete(callback); },
    searchMetadata: async ({ kind, query, year }) => { headOnly('Only the head account can change TMDB matches.'); const q = new URLSearchParams({ kind, query }); if (year) q.set('year', year); return artwork((await get(`/api/admin/metadata/search?${q}`)).results); },
    assignMetadata: async ({ key, tmdbId }) => { headOnly('Only the head account can change TMDB matches.'); const { metadata } = await post('/api/admin/metadata/assign', { key, tmdbId }); latest.metadata = artwork(metadata); return latest.metadata; },
    openTitlePage: async ({ site, type, tmdbId, imdbId }) => {
      const url = site === 'imdb' && /^ttd{5,12}$/.test(imdbId || '') ? `https://www.imdb.com/title/${imdbId}/` : site === 'tmdb' && Number.isInteger(Number(tmdbId)) ? `https://www.themoviedb.org/${type === 'tv' ? 'tv' : 'movie'}/${Number(tmdbId)}` : null;
      if (url) window.open(url, '_blank', 'noopener');
    },
    connectSSH: unsupported('SSH sources'), setPrelude: unsupported('Preludes'), 
    downloadHostOnly: true,
    hiddenTabs: session.user.role === 'admin' ? [] : ['folders', 'downloads'],
    canCompareEditions: session.user.role === 'admin',
    downloadSeriesSearch: value => download('series-search', value), downloadSeriesReleases: value => download('series-releases', value),
    downloadSeriesSource: async () => { say('Release information is provided by EZTV.'); },
    downloadUpgrade: unsupported('Edition upgrades'), downloadFavorite: unsupported('Edition favorites'),
    downloadJobs: () => download('jobs'), downloadRetry: id => download('retry', { id }), downloadRemove: value => download('remove', value),
    downloadConfig: () => download('config'), downloadConfigure: value => download('configure', value),
    downloadSearch: value => download('search', value), downloadAdd: value => download('add', value), downloadList: () => download('list')
  };
  return { matro, state: () => latest };
}
