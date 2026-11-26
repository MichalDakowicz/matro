// window.matro for the browser: the desktop renderer calls this object where Electron would call its main process.
// Everything here turns those calls into requests to the server.
import { get, post, del, api } from './http.js';
import { h, say, dialog, languageName, languageSelect } from './dom.js';
import { accountScope, createOffline, networkLost } from './offline.js';
import { toVtt } from './offline-store.js';
import { mountMovieRequests } from './movie-requests.js';
import { dismissedProgress, isContinueDismissed } from '../../../packages/core/client/watch-progress.js';
import { describePlayback, savedPlayback as savedDiagnostics } from '../../../packages/core/client/playback-info.js';

import { knownQuality, qualityOptions } from '../../../packages/core/client/quality.js';
import { matchOfflineTrack } from '../../../packages/core/client/offline-rules.js';

const FILE = 20000; // subtitle files found next to the video on the server get indexes from here up
const SIDECAR = 10000; // uploaded subtitle tracks get indexes from here up, as sidecar files do on the desktop
const KIND = { full: '', forced: ' (forced)', sdh: ' (SDH)' };
const sizeText = bytes => bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

// The matcher stores artwork as `artwork/<name>`; on the server those files live behind the API.
const artwork = value => typeof value === 'string' ? (value.startsWith('artwork/') ? `/api/${value}` : value) : Array.isArray(value) ? value.map(artwork) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, artwork(v)])) : value;

export function createAdapter(session) {
  const noop = () => () => {};
  const watchers = new Set();
  const accountId = session.user.id;
  const stateRequest = (method, url, body, options) => api(method, url, body, { ...options, accountId });
  let updates = Promise.resolve();
  const updateState = body => {
    if (session.offline) return Promise.resolve();
    const update = updates.catch(() => {}).then(() => stateRequest('PUT', '/api/state', body));
    updates = update;
    return update;
  };
  const scope = accountScope(session.user), offline = createOffline(session.user, { inspect: inspectRemote, subtitlePath, sendSubtitle });
  function checkAccount(data) {
    if (accountScope(data.user) === scope) return;
    location.reload();
    throw new Error('The signed-in account changed.');
  }
  const playerSession = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
  const playbackState = value => {
    if (session.offline) return;
    const state = typeof value === 'object' ? value : { playing: !!value };
    return stateRequest('POST', '/api/playback/state', { ...state, session: playerSession }, { keepalive: !state.playing }).catch(() => {});
  };
  let polling = 0;
  const unsupported = what => () => Promise.reject(new Error(`${what} is a desktop feature.`));
  const headOnly = (message = 'Only the head account can add or remove media.') => { if (session.user.role !== 'admin') throw new Error(message); };
  const download = async (route, value) => {
    headOnly('Only the head account can manage downloads.');
    const url = `/api/admin/downloads/${route}`;
    return (value === undefined ? await get(url) : await post(url, value)).result;
  };
  const details = new Map();
  let quality = knownQuality((() => { try { return localStorage.getItem('matro-quality'); } catch { return null; } })());
  let latest = null, offlineSync;

  async function load() {
    if (session.offline) return latest = await offline.library();
    let data;
    try { data = await stateRequest('GET', '/api/library'); }
    catch (error) {
      if (!networkLost(error)) throw error;
      latest = await offline.library();
      session.offline = true;
      return latest;
    }
    checkAccount(data);
    if (await offline.sync(body => stateRequest('PUT', '/api/state', body)).catch(() => false)) {
      data = await stateRequest('GET', '/api/library');
      checkAccount(data);
    }
    if (offlineSync) await offlineSync.catch(() => {});
    offlineSync = offline.flushSubtitles().catch(() => {});
    data.metadata = artwork(data.metadata);
    await offline.remember(data).catch(() => {});
    acceptLibrary(data);
    void offline.resume().catch(error => say(error.message));
    return data;
  }
  const toldRequests = new Set();
  function acceptLibrary(data) {
    session.user = data.user; latest = data;
    // A request the viewer made has been answered: say so once per tab until they open the requests page.
    const fresh = (data.requestUpdates || []).filter(update => !toldRequests.has(update.id));
    for (const update of fresh) toldRequests.add(update.id);
    if (fresh.length) say(fresh.length > 1 ? `${fresh.length} of your requests have an answer.` : `${fresh[0].title} ${fresh[0].outcome === 'ready' ? 'is ready to watch.' : 'was declined.'}`);
    if (data.metadataEnabled) follow();
  }
  function watchDownloads(callback) {
    let closed = false, checking = false;
    const check = async () => {
      const before = latest;
      if (session.offline || closed || checking || document.hidden || !before?.catalogRevision) return;
      checking = true;
      try {
        const { catalogRevision, scanStatus } = await stateRequest('GET', '/api/library/revision');
        if (closed || latest !== before) return;
        if (JSON.stringify(scanStatus) !== JSON.stringify(before.scanStatus)) {
          latest.scanStatus = scanStatus;
          callback({ scanStatus });
        }
        if (catalogRevision === before.catalogRevision) return;
        const data = await stateRequest('GET', '/api/library');
        if (closed || latest !== before) return;
        checkAccount(data);
        data.metadata = artwork(data.metadata);
        acceptLibrary(data);
        void offline.remember(data).catch(() => {});
        callback({ items: data.items, folders: data.folders, metadata: data.metadata, scanStatus: data.scanStatus });
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
  const savedPlayback = id => offline.playback(id).catch(() => null);
  async function inspect(id) {
    const saved = await savedPlayback(id);
    if (saved) return { ...saved.info, qualities: [] };
    if (session.offline) throw new Error('This title is not saved on this device.');
    try { return await inspectRemote(id); }
    catch (error) {
      const fallback = await savedPlayback(id);
      if (fallback) return fallback.info;
      throw error;
    }
  }
  async function inspectRemote(id, { signal, deadline } = {}) {
    const info = await api('GET', `/api/items/${id}/info`, undefined, { signal, deadline });
    const result = { duration: info.duration, video: info.video, audio: info.audio, chapters: info.chapters, directPlay: info.directPlay, hdrDirectMime: info.hdrDirectMime, hdrToneMap: info.hdrToneMap, qualities: qualityOptions(info.video),
      subtitles: [...info.embedded, ...info.uploaded.map(u => track(u)), ...(info.files || []).map(f => ({ index: FILE + f.id, language: f.language, title: f.title, codec: f.codec, text: true, bitmap: false, sidecar: true, forced: f.forced, sdh: f.sdh }))] };
    details.set(id, result);
    return result;
  }
  const track = u => ({ index: SIDECAR + u.id, language: u.language, title: `${u.name}${KIND[u.kind] || ''}`, codec: 'vtt', text: true, bitmap: false, sidecar: true, uploaded: true, uploadId: u.id, addedBy: u.addedBy, forced: u.kind === 'forced', sdh: u.kind === 'sdh' });
  function sendSubtitle({ id, query, body }) {
    return stateRequest('POST', `/api/items/${id}/subtitles?${query}`, body);
  }

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
        const local = file.files[0];
        let uploaded;
        if (!session.offline) {
          try { uploaded = await sendSubtitle({ id, query: q, body: local }); }
          catch (error) { if (!networkLost(error)) throw error; }
        }
        if (!uploaded) {
          if (local.size > 4 * 1024 * 1024) throw new Error('Subtitle files must be smaller than 4 MB.');
          const text = toVtt(await local.text(), local.name);
          const index = -Number(crypto.getRandomValues(new Uint32Array(1))[0]) - 1;
          const track = { index, title: name.value, language: language.value, codec: 'vtt', text: true, sidecar: true };
          q.set('queued', '1');
          await offline.queueSubtitle(id, track, text, local, q.toString());
          box.close({ queued: { text, track: text ? track : undefined, warning: 'Queued to upload when Matro reconnects.' } });
          return;
        }
        box.close(uploaded.subtitle);
      } catch (error) { status.textContent = error.message; submit.disabled = false; }
    } }, h('p', { class: 'muted' }, 'Everyone who watches this title can pick these subtitles. You and the head account can change or remove them later from your profile.'),
    h('div', { class: 'ssh-fields web-fields' }, h('label', { class: 'ssh-wide' }, 'Subtitle file (SRT, VTT, ASS or SSA)', file), h('label', { class: 'ssh-wide' }, 'Name shown to everyone', name), h('label', {}, 'Language', language), h('label', {}, 'Type', kind)),
    status, h('div', { class: 'show-actions' }, submit, h('button', { class: 'pill', type: 'button', onclick: () => box.close(null) }, 'Cancel')));
    const box = dialog('Add subtitles', form);
    const subtitle = await box.done;
    if (!subtitle) return null;
    if (subtitle.queued) { details.delete(id); return subtitle.queued; }
    const uploadedTrack = track({ ...subtitle, addedBy: session.user.username });
    const text = await fetchSubtitles({ id, index: uploadedTrack.index });
    await offline.store.addSubtitle(id, uploadedTrack.index, uploadedTrack, text).catch(() => {});
    return { text, track: uploadedTrack };
  }
  async function subtitles(options) {
    const { id, index } = options;
    const text = async () => (await offline.store.meta(id).catch(() => null))?.subtitles?.[index];
    const saved = await text();
    if (saved !== undefined || session.offline) return saved || '';
    try { return await fetchSubtitles(options); }
    catch (error) {
      const fallback = await text();
      if (fallback !== undefined) return fallback;
      throw error;
    }
  }
  function subtitlePath(id, index) {
    return `/api/items/${id}/subtitles/${index >= FILE ? `f${index - FILE}` : index >= SIDECAR ? `u${index - SIDECAR}` : `e${index}`}`;
  }
  async function fetchSubtitles({ id, index, signal }) {
    const res = await fetch(subtitlePath(id, index), { credentials: 'same-origin', signal });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load subtitles.');
    return res.text();
  }

  // Direct play when the browser can handle the file as-is; otherwise a transcode that starts at `offset`.
  async function stream({ id, offset = 0, audio = null, bitmapSubtitle = null, subtitleDelay = 0, audioDelay = 0, preload = false, forceTranscode = false, hdr = false, channels = 2 }) {
    const local = async (fallback = false) => {
      const saved = await savedPlayback(id);
      if (!saved || (!fallback && (bitmapSubtitle !== null || (audio !== null && audio !== saved.info.audio[0]?.index)))) return null;
      return { url: preload && offset > 0 ? `${saved.url}#t=${offset}` : saved.url, offset: 0, diagnostics: savedDiagnostics };
    };
    const saved = await local();
    if (saved) return saved;
    if (session.offline) throw new Error('This title or track is unavailable offline.');
    let d;
    try { d = details.get(id) || await inspectRemote(id); }
    catch (error) {
      const fallback = await local(true);
      if (fallback) return fallback;
      throw error;
    }
    const first = d.audio[0];
    const tier = d.video && quality !== 'original' ? quality : null;
    const q = new URLSearchParams({ session: playerSession });
    if (preload) q.set('preload', '1');
    const directHDR = hdr && !!d.hdrDirectMime;
    if (!tier && !audioDelay && !forceTranscode && (d.directPlay || directHDR) && bitmapSubtitle === null && (audio === null || !first || audio === first.index)) return { url: `/api/items/${id}/direct?${q}${offset > 0 ? `#t=${offset}` : ''}`, offset: 0, progressive: directHDR, diagnostics: describePlayback(d, { direct: true, audio }) };
    const start = Math.floor(offset * 10) / 10;
    q.set('t', String(start));
    if (audio !== null) q.set('audio', audio);
    if (tier) q.set('quality', tier);
    if (audioDelay) q.set('adelay', audioDelay);
    if (channels === 6) q.set('channels', '6');
    if (bitmapSubtitle !== null) { q.set('burn', bitmapSubtitle); q.set('delay', subtitleDelay); }
    return { url: `/api/items/${id}/transcode?${q}`, offset, diagnostics: describePlayback(d, { audio, offset: start, burn: bitmapSubtitle, force: forceTranscode, quality: tier, channels, audioDelay, toneMap: d.hdrToneMap }) };
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
    xhr.timeout = 30 * 60 * 1000;
    xhr.upload.onprogress = e => { if (e.lengthComputable) say(`Uploading ${file.name} · ${Math.round(e.loaded / e.total * 100)}% of ${sizeText(file.size)}`); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
      let message;
      try { message = JSON.parse(xhr.responseText)?.error; } catch { /* Proxies may send HTML or plain text. */ }
      reject(new Error(typeof message === 'string' && message ? message : `Could not upload ${file.name} (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error(`Upload of ${file.name} failed (connection lost).`));
    xhr.onabort = () => reject(new Error(`Upload of ${file.name} was canceled.`));
    xhr.ontimeout = () => reject(new Error(`Upload of ${file.name} timed out.`));
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

  async function saveOffline(ids, choices) {
    if (session.offline) throw new Error('Reconnect to save titles for offline playback.');
    const items = new Map(latest.items.map(item => [item.id, item]));
    await offline.enqueue(await Promise.all([...new Set(ids)].map(async id => {
      const item = items.get(id);
      if (!item) throw new Error('That title is no longer in the library.');
      return { id, title: latest.metadata[item.groupId || id]?.title || item.title, choice: await choices?.forTitle(id) };
    })));
  }

  async function changeProgress(id, change, localProgress = {}) {
    if (!session.offline) {
      try { return (await stateRequest('PATCH', `/api/items/${encodeURIComponent(id)}/progress`, change)).progress; }
      catch (error) { if (!networkLost(error)) throw error; }
    }
    const cached = await offline.cachedProgress(), progress = { ...cached.progress, ...localProgress };
    const item = cached.items.find(item => item.id === id);
    const siblings = item?.kind === 'show' ? cached.items.filter(other =>
      other.kind === 'show' && (other.groupId || other.group) === (item.groupId || item.group)) : [{ id }];
    const checkpoint = change.checkpoint || progress[id];
    const updated = Math.max(Date.now(), (checkpoint?.updated || 0) + 1);
    const changes = change.dismiss ? dismissedProgress(siblings, progress, progress) : { [id]: {
      ...checkpoint, position: checkpoint?.position ?? 0, duration: checkpoint?.duration || (await offline.store.meta(id))?.info?.duration || 0,
      completed: change.completed, hidden: item?.kind === 'show' && (!!checkpoint?.hidden || isContinueDismissed(siblings, progress)), updated,
    } };
    await offline.queue({ progress: changes });
    return changes;
  }

  const trackName = track => [languageName(track.language), track.title].filter(Boolean).join(' · ');
  async function offlineSaveOptions(ids) {
    const id = ids[0], first = await inspect(id);
    const selected = latest.items.find(item => item.id === id);
    const preferred = latest.preferences?.tracks?.[selected?.groupId || selected?.group];
    const bitmaps = first.subtitles.filter(track => track.bitmap);
    const audio = h('select', { 'aria-label': 'Audio track' }, first.audio.map(track => h('option', { value: track.index, selected: track.index === (matchOfflineTrack(first.audio, preferred?.audio) || first.audio[0])?.index }, trackName(track))));
    const burn = h('select', { 'aria-label': 'Burn bitmap subtitles into the video' }, h('option', { value: '' }, 'None'), bitmaps.map(track => h('option', { value: track.index, selected: !preferred?.off && track.index === matchOfflineTrack(bitmaps, preferred?.subtitle)?.index }, trackName(track))));
    const quality = h('select', { 'aria-label': 'Size preset' }, qualityOptions(first.video).map(tier => h('option', { value: tier.id }, tier.label)));
    const text = first.subtitles.filter(track => track.text && !track.bitmap);
    const form = h('form', { onsubmit: event => {
      event.preventDefault();
      box.close({ audio: audio.value === '' ? null : Number(audio.value), burn: burn.value === '' ? null : Number(burn.value), quality: quality.value || 'original' });
    } },
      first.audio.length ? h('label', {}, 'Audio', audio) : h('p', { class: 'muted' }, 'No audio tracks'),
      bitmaps.length ? h('label', {}, 'Burn bitmap subtitles into the video', burn) : null,
      first.video ? h('label', {}, 'Size preset', quality) : null,
      h('p', { class: 'muted' }, text.length ? `Selectable text subtitles · ${text.map(trackName).join(', ')}` : 'No text subtitles'),
      ids.length > 1 ? h('p', { class: 'muted' }, 'Tracks shown are from the first episode. Other episodes use matching tracks where available, their first audio otherwise, and include their available text subtitles.') : null,
      h('div', { class: 'show-actions' }, h('button', { class: 'pill primary', type: 'submit' }, 'Start download')));
    const box = dialog('Save offline', form);
    const choice = await box.done;
    if (!choice) return null;
    const firstAudio = first.audio.find(track => track.index === choice.audio), firstBurn = bitmaps.find(track => track.index === choice.burn);
    return {
      async forTitle(itemId) {
        if (itemId === id) return choice;
        const info = await inspect(itemId);
        return { audio: matchOfflineTrack(info.audio, firstAudio)?.index ?? null, burn: matchOfflineTrack(info.subtitles.filter(track => track.bitmap), firstBurn)?.index ?? null, quality: info.video ? choice.quality : 'original' };
      }
    };
  }
  const matro = {
    chooseSource: window.matroDesktop?.chooseSource,
    recoveryScope: scope,
    load, inspect, prepare: inspect, savedPlayback, subtitles, loadSubtitle, stream,
    get canEditLists() { return !session.offline && Array.isArray(latest?.lists); },
    async editLists(change) {
      const { lists } = await stateRequest('POST', '/api/lists', change);
      if (latest) latest.lists = lists;
      return lists;
    },
    get canFollowShows() { return !session.offline && Array.isArray(latest?.followed); },
    async followShow(change) {
      const { followed } = await stateRequest('POST', '/api/follows', change);
      if (latest) latest.followed = followed;
      return followed;
    },
    async showSchedule(key) { return (await get('/api/follows/' + encodeURIComponent(key) + '/episodes')).episodes; },
    quality: () => quality, setQuality: id => { quality = knownQuality(id); try { localStorage.setItem('matro-quality', quality); } catch { /* The choice only lasts for this visit. */ } },
    get subtitleSearchStatus() { return session.offline ? null : () => get('/api/subtitle-search'); },
    searchSubtitles: async ({ id, language }) => (await get(`/api/items/${id}/subtitle-search?${new URLSearchParams({ language })}`)).results,
    downloadSubtitle: async ({ id, token }) => {
      const { subtitle } = await stateRequest('POST', `/api/items/${id}/subtitle-search`, { token });
      const saved = track(subtitle);
      return { text: await subtitles({ id, index: saved.index }), track: saved };
    },
    offlineSaveOptions,
    async offlineUnsaved(ids) {
      const saved = new Set((await offline.store.list()).filter(record => record.complete).map(record => record.id));
      return ids.filter(id => !saved.has(id));
    },
    get offlineSave() { return session.offline ? null : (id, choices) => saveOffline([id], choices); },
    get offlineSaveMany() { return session.offline ? null : saveOffline; },
    dismissContinue: (id, progress) => changeProgress(id, { dismiss: true }, progress),
    setCompleted: (id, completed, checkpoint) => changeProgress(id, { completed, checkpoint }),
    async setCompletedMany(ids, completed) {
      if (session.offline) return null;
      try { return (await stateRequest('PATCH', '/api/progress', { ids, completed })).progress; }
      catch (error) { if (!networkLost(error)) throw error; return null; }
    },
    savePreferences: preferences => updateState({ preferences }),
    changeQueue: queueChange => updateState({ queueChange }),
    save: ({ progress }, { keepalive = false } = {}) => {
      const body = { progress };
      // Keepalive has a small shared in-flight byte quota. Reserve it for exit;
      // ordinary overlapping checkpoints must not consume that quota.
      if (session.offline) return offline.queue(body);
      return stateRequest('PUT', '/api/state', body, { keepalive: keepalive && new Blob([JSON.stringify(body)]).size < 60000 }).catch(error => {
        if (!networkLost(error)) throw error;
        return offline.queue(body);
      });
    },
    stop: async (keepUrl, { background = false } = {}) => {
      offline.release(keepUrl);
      if (session.offline) return;
      const stop = stateRequest('POST', '/api/playback/stop', { session: playerSession, keepPreload: !!keepUrl && new URL(keepUrl, location.origin).searchParams.get('preload') === '1' });
      if (background) void stop.catch(() => {});
      else await stop.catch(error => { if (!networkLost(error)) throw error; });
    }, playbackState, playbackHeartbeat: playbackState,
    preview: async ({ id, time, hover }) => `/api/items/${id}/frame?t=${Math.max(0, Number(time) || 0)}&w=${hover ? 320 : 480}`,
    segments: async ({ id, force }) => (await stateRequest('POST', `/api/items/${id}/segments`, { force })).markers,
    saveMarkers: async edits => (await stateRequest('POST', '/api/segments/manual', edits)).markers,
    removeMarker: async ({ id, marker }) => (await stateRequest('POST', `/api/items/${id}/segments/remove`, { marker })).markers,
    scannerStatus: async () => (await get('/api/segments')).scanner,
    rescan: async () => {
      if (session.user.role !== 'admin') return load();
      const { results } = await post('/api/admin/rescan');
      return { ...await load(), warnings: results.filter(result => !result.ok).map(({ folder, error }) => folder ? `${folder}: ${error}` : error) };
    },
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
      const url = site === 'imdb' && /^tt\d{5,12}$/.test(imdbId || '') ? `https://www.imdb.com/title/${imdbId}/` : site === 'tmdb' && Number.isInteger(Number(tmdbId)) ? `https://www.themoviedb.org/${type === 'tv' ? 'tv' : 'movie'}/${Number(tmdbId)}` : null;
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
    canCompareEditions: false,
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
