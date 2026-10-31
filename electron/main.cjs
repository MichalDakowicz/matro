const { app, BrowserWindow, ipcMain, dialog, protocol, net, session, shell, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const { createTorrents } = require('./torrents.cjs');
const { createPathChecker, destinationFile } = require('./download-files.cjs');
const { createMovieUpgrades } = require('./movie-upgrades.cjs');
const { mediaFS } = require('./ssh-media.cjs');
const { createEmbeddedSubtitles } = require('./embedded-subtitles.cjs');
const { remote } = require('./ssh-media.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { scan, describe, groupFolders, applyPreludes, sidecars, keepSidecar, SIDECAR, extensions, probe, run, ffmpeg } = require('./media.cjs');
const { createStreamServer } = require('./stream.cjs');
const { createPreviews } = require('./previews.cjs');
const { createSegments } = require('./segments.cjs');
const { createSegmentScheduler } = require('./segment-scheduler.cjs');
const { readEnv, credentials, createMetadata, cleanQuery, yearOf } = require('./metadata.cjs');
const previews = createPreviews();
protocol.registerSchemesAsPrivileged([{ scheme: 'matro', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let win, streams, storage, segments, scanner, metadata, torrents, upgrades, embeddedSubtitles;
if (!app.isPackaged && process.env.MATRO_USER_DATA) app.setPath('userData', path.resolve(process.env.MATRO_USER_DATA));
let state = { folders: [], items: [], progress: {}, queue: [], preferences: { autoplay: true, volume: 0.72 } };
let writeQueue = Promise.resolve();
function persist() { const contents = JSON.stringify(state); writeQueue = writeQueue.catch(() => {}).then(async () => { await fs.writeFile(storage + '.tmp', contents); await fs.rename(storage + '.tmp', storage); }); return writeQueue; }
const find = id => { const item = state.items.find(i => i.id === id); if (!item) throw new Error('Media is no longer in the library.'); return item; };
function handle(channel, fn) { ipcMain.handle(channel, (event, ...args) => { if (event.sender !== win.webContents || !event.senderFrame?.url.startsWith('matro://app/')) throw new Error('Untrusted caller'); return fn(...args); }); }
async function downloadArtwork(items) {
  const titles = items.map(item => {
    const title = item.title || cleanQuery(item.name), year = item.year || yearOf(item.name), kind = item.kind === 'show' ? 'show' : 'movie';
    const id = `download:${kind}:${title}:${year || ''}`;
    return { id, groupId: id, group: title + (year ? ` (${year})` : ''), kind, path: '', season: null };
  });
  await metadata.sync(titles);
  const cached = metadata.snapshot();
  return items.map((item, index) => ({ ...item, banner: cached[titles[index].id]?.backdrop || cached[titles[index].id]?.poster || null }));
}
async function importFiles(files) {
  for (const file of files) {
    if (typeof file !== 'string' || !extensions.has(path.extname(file).slice(1).toLowerCase())) continue;
    if (!(await fs.stat(file)).isFile()) continue;
    const item = describe(path.resolve(file));
    if (!state.items.some(i => i.id === item.id)) state.items.push(item);
  }
  await persist(); scanner?.invalidate(); void metadata?.sync(state.items); return state;
}
const subtitleStyle = value => {
  const style = value && typeof value === 'object' ? value : {}, pick = (key, options, fallback) => options.includes(style[key]) ? style[key] : fallback;
  return { size: Math.max(.5, Math.min(2, Number(style.size) || 1)), font: pick('font', ['sans', 'classic', 'serif', 'mono', 'casual'], 'sans'), background: pick('background', ['none', 'light', 'dark', 'solid'], 'light'), bold: !!style.bold, italic: !!style.italic, edge: pick('edge', ['none', 'outline', 'shadow'], 'none') };
};
const regroup = items => upgrades ? upgrades.restore(applyPreludes(groupFolders(items.filter(item => !state.pendingDownloadFiles?.[item.path])), state.preludes)) : applyPreludes(groupFolders(items), state.preludes);
async function rescan() {
  const results = await Promise.all(state.folders.map(async root => { try { return { root, items: await scan(root) }; } catch { return { root, error: 'Folder unavailable. Check the drive or network connection.' }; } }));
  for (const result of results) if (result.items) state.items = state.items.filter(i => i.root !== result.root).concat(result.items);
  state.items = regroup([...new Map(state.items.map(item => [item.id, item])).values()]);
  state.libraryVersion = 2;
  await persist(); scanner?.invalidate(); void metadata?.sync(state.items); return { ...state, warnings: results.filter(r => r.error).map(r => `${r.root}: ${r.error}`) };
}
app.whenReady().then(async () => {
  storage = path.join(app.getPath('userData'), 'library.json');
  embeddedSubtitles = createEmbeddedSubtitles({ dir: path.join(app.getPath('userData'), 'subtitles'), stat: mediaFS.stat, probe, remote,
    extractLocal: (file, index) => run(ffmpeg, ['-v', 'error', '-nostdin', '-i', file, '-map', '0:' + index, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1'], { timeout: 180000 }) });
  const downloadFiles = { remote, connections: () => state.sshConnections || [] };
  upgrades = createMovieUpgrades({ getState: () => state, probe, stat: mediaFS.stat, describe, persist, resolveFile: (target, config, file) => destinationFile(downloadFiles, target, config, file), metadata: item => metadata?.snapshot()?.[item.id] });
  torrents = createTorrents({ dir: app.getPath('userData'), secure: safeStorage, catalogFetch: (url, options) => net.fetch(url, options), videos: app.getPath('videos'), validateUpgrade: (id, release) => upgrades.validate(id, release), onPrepared: (job, config) => upgrades.prepared(job, config), onComplete: async (job, config) => { await upgrades.completed(job, config); scanner?.invalidate(); void metadata?.sync(state.items); if (win && !win.isDestroyed()) win.webContents.send('library:downloads', state); }, checkPaths: createPathChecker({ remote, connections: () => state.sshConnections || [] }), ...(!app.isPackaged && process.env.MATRO_TORRENT_API ? { catalog: process.env.MATRO_TORRENT_API } : {}), ...(!app.isPackaged && process.env.MATRO_SERIES_METADATA_API ? { seriesShowsURL: process.env.MATRO_SERIES_METADATA_API } : {}), ...(!app.isPackaged && process.env.MATRO_SERIES_RELEASES_API ? { seriesReleasesURL: process.env.MATRO_SERIES_RELEASES_API } : {}) });
  segments = createSegments(path.join(app.getPath('userData'), 'fingerprints'));
  // TMDB lookups are opt-in: they run only when a key is configured in .env (project or user-data folder) or the environment.
  const env = { ...readEnv([path.join(app.getAppPath(), '.env'), path.join(app.getPath('userData'), '.env')]), ...process.env };
  metadata = createMetadata({ dir: app.getPath('userData'), fetch: (url, options) => net.fetch(url, options), auth: env.MATRO_METADATA === 'off' ? null : credentials(env), onUpdate: snapshot => { if (win && !win.isDestroyed()) win.webContents.send('library:metadata', snapshot); } });
  try { state = { ...state, ...JSON.parse(await fs.readFile(storage, 'utf8')) }; } catch { /* First launch or damaged state uses a fresh library. */ }
  for (const config of state.sshConnections || []) {
    try { remote.register(config); } catch { /* Leave cached titles available if a saved configuration is invalid. */ }
  }
  if (state.libraryVersion !== 2) await rescan();
  streams = await createStreamServer();
  protocol.handle('matro', request => {
    const url = new URL(request.url);
    const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/downloads.js': 'downloads.js', '/downloads-view.js': 'downloads-view.js', '/downloads-settings.js': 'downloads-settings.js', '/downloads.css': 'downloads.css', '/assets/logo.svg': 'assets/logo.svg', '/assets/tmdb.svg': 'assets/tmdb.svg', '/assets/imdb.svg': 'assets/imdb.svg','/assets/fonts/Geist-Variable.woff2': 'assets/fonts/Geist-Variable.woff2', '/assets/fonts/GeistMono-Variable.woff2': 'assets/fonts/GeistMono-Variable.woff2' };
    const artwork = url.hostname === 'app' && url.pathname.startsWith('/artwork/') && metadata.artworkFile(url.pathname.slice('/artwork/'.length));
    if (artwork) return net.fetch(pathToFileURL(artwork).href);
    const file = url.hostname === 'app' && files[url.pathname];
    return file ? net.fetch(pathToFileURL(path.join(__dirname, '../src', file)).href) : new Response('Not found', { status: 404 });
  });
  win = new BrowserWindow({ width: 1440, height: 940, minWidth: 900, minHeight: 640, backgroundColor: '#0a0a0b', title: 'Matro', icon: path.join(__dirname, '../assets/icon.png'), frame: false, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  // Open maximized, shown only once the first frame is ready so the window never flashes at its default size.
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  // Let the renderer save playback progress before the window goes away; a stuck renderer still closes after a moment.
  let closing = false;
  win.on('close', event => {
    if (closing) return;
    event.preventDefault(); closing = true;
    win.webContents.send('window:closing');
    setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, 2000);
  });
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen', false));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  scanner = createSegmentScheduler({ getState: () => state, engine: segments, persist, onUpdate: update => { if (!win.isDestroyed()) win.webContents.send('media:segments-progress', update); } });
  handle('downloads:series-search', options => torrents.seriesSearch(options));
  handle('downloads:series-releases', options => torrents.seriesReleases(options));
  handle('downloads:series-source', id => shell.openExternal(torrents.seriesSource(id)));
  handle('downloads:upgrade', id => upgrades.context(id));
  handle('downloads:favorite', async options => { const result = await upgrades.favorite(options?.sourceId, options?.id); win.webContents.send('library:downloads', state); return result; });
  handle('downloads:jobs', async target => downloadArtwork(await torrents.jobs(target)));
  handle('downloads:retry', id => torrents.retry(id));
  handle('downloads:remove', options => torrents.remove(options));
  handle('downloads:config', () => torrents.config());
  handle('downloads:configure', options => torrents.configure(options));
  handle('downloads:search', options => torrents.search(options));
  handle('downloads:add', options => torrents.add(options));
  handle('downloads:list', async target => {
    const jobs = await torrents.jobs(target);
    const items = (await torrents.list(target)).map(item => {
      const job = jobs.find(job => job.hash === item.hash);
      return { ...item, ...(job ? { title: job.title, year: job.year, kind: job.kind } : {}) };
    });
    return downloadArtwork(items);
  });
  handle('library:load', async () => { await metadata.loaded; return { ...state, scanner: scanner.snapshot(), metadata: metadata.snapshot(), metadataEnabled: metadata.enabled }; });
  handle('library:ssh', async options => {
    const root = remote.register(options);
    const wasSaved = state.folders.includes(root);
    try {
      const items = await scan(root);
      if (!state.folders.includes(root)) state.folders.push(root);
      state.sshConnections ||= [];
      if (!state.sshConnections.some(config => remote.register(config) === root)) state.sshConnections.push({ ...remote.configs.get(root), root });
      state.items = regroup(state.items.filter(item => item.root !== root).concat(items));
      await persist(); scanner.invalidate(); void metadata.sync(state.items);
      return state;
    } catch (error) {
      if (!wasSaved) remote.remove(root);
      throw new Error(`Could not read SSH media: ${error.message}. Check that SSH key login works in your terminal and Python 3 is installed on the server.`);
    }
  });
  handle('library:folder', async () => { const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); if (result.canceled) return state; const root = result.filePaths[0]; const items = await scan(root); if (!state.folders.includes(root)) state.folders.push(root); const existing = new Map(state.items.map(i => [i.id, i])); for (const item of items) existing.set(item.id, item); state.items = regroup([...existing.values()]); await persist(); scanner.invalidate(); void metadata.sync(state.items); return state; });
  handle('library:files', async () => { const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media', extensions: [...extensions] }, { name: 'All files', extensions: ['*'] }] }); return result.canceled ? state : importFiles(result.filePaths); });
  handle('library:import', files => { if (!Array.isArray(files) || files.length > 5000) throw new Error('Invalid file selection'); return importFiles(files); });
  handle('library:rescan', rescan);
  // Pick (or clear) a show's prelude. Rescanning restores the regular numbering of a file that stops being the prelude.
  handle('library:prelude', async options => {
    const show = state.items.filter(i => i.kind === 'show' && i.groupId === options?.key && !i.prelude);
    if (!show.length) throw new Error('That show is no longer in the library.');
    state.preludes ||= {};
    if (options.clear) delete state.preludes[options.key];
    else {
      const result = await dialog.showOpenDialog(win, { title: `Choose a prelude for ${show[0].group}`, defaultPath: path.dirname(show[0].path), properties: ['openFile'], filters: [{ name: 'Video', extensions: [...extensions].filter(ext => !/^(mp3|flac|wav|aac|m4a|ogg|opus|wma|aiff|alac)$/.test(ext)) }, { name: 'All files', extensions: ['*'] }] });
      if (result.canceled) return null;
      if (!(await fs.stat(result.filePaths[0])).isFile()) throw new Error('Choose a video file.');
      state.preludes[options.key] = path.resolve(result.filePaths[0]);
    }
    return rescan();
  });
  // The page only names a title; the address is built here so nothing but TMDB and IMDb title pages can ever be opened.
  handle('metadata:open', options => {
    const id = Number(options?.tmdbId), imdb = String(options?.imdbId || '');
    const url = options?.site === 'imdb' && /^tt\d{5,12}$/.test(imdb) ? `https://www.imdb.com/title/${imdb}/`
      : options?.site === 'tmdb' && Number.isInteger(id) && id > 0 ? `https://www.themoviedb.org/${options.type === 'tv' ? 'tv' : 'movie'}/${id}` : null;
    if (url) void shell.openExternal(url);
  });
  handle('metadata:search',options => metadata.search(options?.kind, options?.query, /^\d{4}$/.test(String(options?.year || '')) ? options.year : null));
  handle('metadata:assign', async options => {
    const items = state.items.filter(i => (i.kind === 'show' ? i.groupId || i.group : i.id) === options?.key);
    if (!items.length) throw new Error('That title is no longer in the library.');
    const snapshot = await metadata.assign(items, options.tmdbId ?? null);
    if (!win.isDestroyed()) win.webContents.send('library:metadata', snapshot);
    return snapshot;
  });
  handle('library:remove-folder', async root => { state.folders = state.folders.filter(f => f !== root); state.items = state.items.filter(i => i.root !== root); state.sshConnections = (state.sshConnections || []).filter(config => remote.register(config) !== root); remote.remove(root); await persist(); scanner.invalidate(); return state; });
  handle('library:save', async data => {
    const ids = new Set(state.items.map(i => i.id));
    if (data.progress && typeof data.progress === 'object') for (const [id, value] of Object.entries(data.progress)) if (ids.has(id) && value && Number.isFinite(value.position) && Number.isFinite(value.duration) && !(Number.isFinite(value.updated) && value.updated < (state.progress[id]?.updated || 0))) state.progress[id] = { position: Math.max(0, value.position), duration: Math.max(0, value.duration), updated: Number.isFinite(value.updated) ? value.updated : Date.now(), completed: !!value.completed, hidden: !!value.hidden };
    if (data.markers && typeof data.markers === 'object') {
      state.markers ||= {};
      // The scanner owns automatic markers. A renderer's older library snapshot
      // must not overwrite matches saved while it was on the library screen.
      for (const [id, markers] of Object.entries(data.markers)) if (ids.has(id) && Array.isArray(markers)) {
        const manual = markers.filter(s => s.source !== 'automatic' && ['intro', 'outro', 'recap'].includes(s.type) && Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start).map(s => ({ type: s.type, start: s.start, end: s.end, source: 'manual' }));
        state.markers[id] = [...manual, ...(state.markers[id] || []).filter(s => s.source === 'automatic' && !manual.some(m => m.start < s.end && m.end > s.start))];
      }
    }
    if (Array.isArray(data.queue)) state.queue = [...new Set(data.queue.filter(id => ids.has(id)))];
    if (data.preferences) state.preferences = { autoplay: !!data.preferences.autoplay, volume: Math.max(0, Math.min(1.5, Number(data.preferences.volume) || 0)), tracks: data.preferences.tracks && typeof data.preferences.tracks === 'object' ? data.preferences.tracks : {}, motion: ['on', 'off'].includes(data.preferences.motion) ? data.preferences.motion : 'system', subtitles: subtitleStyle(data.preferences.subtitles) };
    await persist(); scanner.refresh();
  });
  handle('media:inspect', async id => { const item = find(id); scanner.setPlayback(true); scanner.setCurrent(id); try { const info = await probe(item.path); info.subtitles.push(...(await sidecars(item.path)).map(({ path: _path, ...track }) => track)); return info; } catch (error) { scanner.setPlayback(false); throw error; } });
  handle('media:playback-state', value => {
    const playing = typeof value === 'boolean' ? value : value?.playing, buffering = typeof value === 'object' && value?.buffering === true;
    if (typeof playing !== 'boolean') throw new Error('Invalid playback state');
    scanner.setPlayback(playing, buffering);
  });
  handle('media:scanner', () => scanner.snapshot());
  handle('media:segments', options => scanner.request(typeof options === 'string' ? options : options.id, !!options?.force));
  handle('media:remove-marker', async ({ id, marker }) => {
    find(id); state.markers ||= {};
    if ((state.markers[id] || []).some(s => s.source === 'automatic' && s.type === marker.type && s.start === marker.start && s.end === marker.end)) {
      state.markerDismissals ||= {}; state.markerDismissals[id] ||= [];
      state.markerDismissals[id].push({ type: marker.type, start: marker.start, end: marker.end });
    }
    state.markers[id] = (state.markers[id] || []).filter(s => !(s.type === marker.type && s.start === marker.start && s.end === marker.end));
    await persist(); return state.markers[id];
  });
  // Track list and sidecar subtitles for the next queue item, without moving the background scanner's attention.
  handle('media:prepare', async id => { const item = find(id); const info = await probe(item.path); info.subtitles.push(...(await sidecars(item.path)).map(({ path: _path, ...track }) => track)); return info; });
  handle('media:stream', async options => {
    const item = find(options.id); const info = await probe(item.path);
    const offset = Math.max(0, Math.min(info.duration || 864000, Number(options.offset) || 0));
    const audio = info.audio.find(a => a.index === options.audio)?.index ?? info.audio.find(a => a.default)?.index ?? info.audio[0]?.index ?? null;
    const bitmapSubtitle = info.video ? info.subtitles.find(s => s.index === options.bitmapSubtitle && s.bitmap)?.index ?? null : null;
    const subtitleDelay = Math.max(-60, Math.min(60, Number(options.subtitleDelay) || 0));
    return { url: streams.create({ file: item.path, offset, audio, hasVideo: !!info.video, bitmapSubtitle, subtitleDelay }, { preload: !!options.preload }), offset };
  });
  handle('media:preview', async ({ id, time, hover }) => { const item = find(id); if (!Number.isFinite(time) || time < 0) throw new Error('Invalid preview time'); return previews.frame(item.path, time, { hover: !!hover }); });
  handle('media:subtitles', async ({ id, index }) => {
    const item = find(id);
    if (index >= SIDECAR) { const file = (await sidecars(item.path)).find(s => s.index === index); if (!file) throw new Error('That subtitle file is no longer next to the video.'); return run(ffmpeg, ['-v', 'error', '-nostdin', '-i', file.path, '-f', 'webvtt', 'pipe:1']); }
    return embeddedSubtitles.load(item.path, index); });
  // A loaded subtitle file is copied next to the video (never overwriting) so it shows up as a track from then on.
  // Read-only folders still load it for this session.
  handle('media:subtitle-file', async id => {
    const item = find(id);
    const result = await dialog.showOpenDialog(win, { defaultPath: path.dirname(item.path), properties: ['openFile'], filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }] }); if (result.canceled) return null;
    const picked = result.filePaths[0], text = await run(ffmpeg, ['-v', 'error', '-nostdin', '-i', picked, '-f', 'webvtt', 'pipe:1']);
    const language = path.basename(picked, path.extname(picked)).split('.').pop();
    let kept = null, warning = null;
    try { kept = await keepSidecar(item.path, picked, language); } catch (error) { warning = `Loaded for now, but couldn't save it next to the video: ${error.message}`; }
    const track = kept ? (await sidecars(item.path)).find(s => path.resolve(s.path) === path.resolve(kept)) : null;
    if (track) delete track.path;
    return { text, track, warning };
  });
  handle('media:stop', keepUrl => { streams.stop(typeof keepUrl === 'string' ? keepUrl : null); scanner.setPlayback(false); scanner.setCurrent(null); });
  handle('window:action', action => { if (action === 'minimize') win.minimize(); if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); if (action === 'close') win.close(); if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen()); });
  await win.loadURL('matro://app/');
  torrents.start();
  scanner.refresh();
  void metadata.sync(state.items);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { torrents?.close(); streams?.close(); previews.close(); scanner?.close(); remote.close(); });
