const api = window.matro;
const $ = selector => document.querySelector(selector);
const root = $('#app');
const icons = {
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  shows: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  movies: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  play: '<path d="M7 4.5v15l13-7.5z"/>', pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>', restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
  back: '<path d="m15 6-6 6 6 6"/>', chevron: '<path d="m9 6 6 6-6 6"/>', next: '<path d="M18 5v14M6 5v14l10-7z"/>', prev: '<path d="M6 5v14M18 5v14L8 12z"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5"/>',
  tracks: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 11h3M7 14.5h6M13 11h4M15.5 14.5H17"/>',
  queue: '<path d="M4 6h16M4 11h16M4 16h9M16 15v5l4-2.5z"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', more: '<circle cx="5.5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18.5" cy="12" r="1"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>', upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  arrows: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>', network: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const skipIcon = (back, seconds) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${back ? 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4' : 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4'}"/><text x="12" y="15.4" text-anchor="middle">${seconds}</text></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = seconds => { const s = Math.max(0, Math.floor(Number(seconds) || 0)); return `${s >= 3600 ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(s >= 3600 ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`; };
const base = file => file.split(/[\\/]/).filter(Boolean).pop() || file;
const titleKey = item => item.groupId || item.group;
const sameTitle = (left, right) => titleKey(left) === titleKey(right);
const SKIP = 5;
let library = { items: [], folders: [], progress: {}, queue: [], preferences: { autoplay: true, volume: .72 } };
let metadata = {}, metadataEnabled = false;
let tab = 'home', query = '', view = 'library', selected = null, folderFilter = null, statusFilter = 'all';
let current = null, info = null, video = null, offset = 0, audio = null, subtitle = null, subtitleText = null, subtitleUrl = null, delay = 0, subSize = 'M';
let queueOpen = false, sidePanel = null, generation = 0, lastSave = 0, idleTimer, toastTimer, subtitleGeneration = 0;
let loading = false, playbackError = '', trackCues = [];
let playIntent = true;
let segmentStatus = '', markerDraft = null;
let scannerSummary = null;
function renderScannerStatus() {
  const status = $('#scanner-status'); if (!status) return;
  status.textContent = scannerSummary ? `${scannerSummary.message}${scannerSummary.total ? ` · ${scannerSummary.ready}/${scannerSummary.total} episodes ready` : ''}` : 'Preparing background scan…';
}
const isScanning = id => scanningSegments.has(id) || (scannerSummary?.running && scannerSummary.id === id);
let fullscreenActive = false, fullscreenQueueOpen = false;
let previewTimer, previewVersion = 0, previewHovered = false;
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
function languageName(code) {
  if (!code || ['und', 'unk'].includes(code.toLowerCase())) return 'Unknown language';
  try { return languageNames.of(code) || code.toUpperCase(); } catch { return code.toUpperCase(); }
}
const bitmapTrack = () => info?.subtitles.find(track => track.index === subtitle && track.bitmap);
function trackHeading(track) {
  const title = track.title && ![track.language, languageName(track.language)].some(value => value.toLowerCase() === track.title.toLowerCase()) ? track.title : '';
  return `<span class="track-heading"><strong>${esc(languageName(track.language))}</strong>${title ? `<span class="track-title">${esc(title)}</span>` : ''}</span>`;
}
function hidePreview() { clearTimeout(previewTimer); previewVersion++; previewHovered = false; if ($('#seek-preview')) $('#seek-preview').hidden = true; }
function hoverSeek(event) {
  if (!info.duration || !current) return;
  previewHovered = true;
  const input = $('#seek'), bounds = input.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left - 8) / Math.max(1, bounds.width - 16)));
  const time = Math.min(info.duration - .1, fraction * info.duration);
  const tooltip = $('#seek-preview'), image = $('#seek-preview-image'), status = $('#seek-preview-status');
  tooltip.hidden = false; tooltip.style.left = `${Math.max(90, Math.min(bounds.width - 90, event.clientX - bounds.left))}px`;
  $('#seek-preview-time').textContent = `${fmt(time)}.${Math.floor(time % 1 * 10)}`;
  image.hidden = true; image.removeAttribute('src'); status.hidden = false; status.textContent = info.video ? 'Loading preview…' : 'Audio';
  clearTimeout(previewTimer); const version = ++previewVersion; const id = current.id;
  if (!info.video) return;
  previewTimer = setTimeout(async () => {
    try {
      const frame = await api.preview({ id, time });
      if (version !== previewVersion || !previewHovered || current?.id !== id) return;
      if (frame) { image.src = frame; image.hidden = false; status.hidden = true; }
      else status.textContent = 'Preview unavailable';
    } catch { if (version === previewVersion) status.textContent = 'Preview unavailable'; }
  }, 160);
}
const finishMargin = duration => Math.min(10, duration * .05);
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000); }
async function attempt(fn) { try { return await fn(); } catch (error) { toast(error.message || String(error)); return null; } }
function save() { return api.save({ progress: library.progress, queue: library.queue, preferences: library.preferences, markers: library.markers || {} }); }
const completed = id => !!library.progress[id]?.completed;
const orderedEpisodes = item => library.items.filter(i => i.kind === 'show' && sameTitle(i, item)).sort((a, b) => a.season - b.season || a.episode - b.episode);
function statusLabel(id) { return completed(id) ? ' · Completed' : library.progress[id]?.position > 0 ? ' · In progress' : ''; }
function trackChoice(t) { return t ? { language: t.language, title: t.title, codec: t.codec, channels: t.channels } : null; }
function matchTrack(tracks, choice) {
  if (!choice) return null;
  const score = t => Number(t.title === choice.title) * 4 + Number(t.channels === choice.channels) * 2 + Number(t.codec === choice.codec);
  return tracks.filter(t => t.language === choice.language).sort((a, b) => score(b) - score(a))[0] || null;
}
function rememberTracks() {
  library.preferences.tracks ||= {};
  library.preferences.tracks[titleKey(current)] = { audio: trackChoice(info.audio.find(t => t.index === audio)), subtitle: trackChoice(info.subtitles.find(t => t.index === subtitle)), off: subtitle === null, delay, size: subSize };
  void attempt(save);
}
// Title metadata comes from TMDB when configured; everything falls back to file names.
const metaKey = item => item.kind === 'show' ? titleKey(item) : item.id;
const meta = item => metadata[metaKey(item)] || null;
const displayName = item => meta(item)?.title || item.group;
const episodeName = item => meta(item)?.episodes?.[item.season]?.[item.episode]?.name || item.title;
const hash = text => { let h = 7; for (const c of String(text)) h = (h * 31 + c.codePointAt(0)) >>> 0; return h; };
const artFor = item => `art v${hash(metaKey(item)) % 4}" data-hue="${hash(metaKey(item)) % 360}`;
const searchText = items => `${items[0].group} ${meta(items[0])?.title || ''} ${(meta(items[0])?.people || []).join(' ')} ${items.map(i => i.title).join(' ')}`.toLowerCase();
function applyStyles(scope = document) {
  scope.querySelectorAll('[data-hue]').forEach(el => el.style.setProperty('--h', el.dataset.hue));
  scope.querySelectorAll('[data-progress]').forEach(el => { el.style.width = `${el.dataset.progress}%`; });
}
function continueItems() {
  const result = [], seen = new Set();
  const recent = library.items.filter(i => library.progress[i.id] && !library.progress[i.id].hidden).sort((a, b) => library.progress[b.id].updated - library.progress[a.id].updated);
  for (const item of recent) {
    const key = item.kind === 'show' ? titleKey(item) : item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    let next = item;
    if (completed(item.id)) {
      if (item.kind !== 'show') continue;
      const episodes = orderedEpisodes(item), index = episodes.reduce((last, episode, n) => completed(episode.id) ? n : last, -1);
      next = episodes.slice(index + 1).find(i => !completed(i.id));
    }
    if (next && (completed(item.id) || library.progress[item.id].position > 0) && (!folderFilter || next.root === folderFilter)) result.push(next);
  }
  return result;
}
async function markComplete(id) {
  const old = library.progress[id] || { position: 0, duration: 0 };
  library.progress[id] = { ...old, completed: !completed(id), hidden: false, updated: Date.now() };
  await save();
  if (view === 'player') { renderQueue(); renderSegments(); }
  else { const selectedId = selected?.id; renderLibrary(); if (selectedId) detail(selectedId); }
}
async function removeContinue(id) {
  const item = library.items.find(i => i.id === id);
  for (const candidate of item.kind === 'show' ? orderedEpisodes(item) : [item]) {
    const old = library.progress[candidate.id]; if (old) old.hidden = true;
  }
  await save(); renderLibrary();
}
function remember() {
  if (!current || !video || loading || playbackError) return;
  const old = library.progress[current.id] || {};
  const position = Math.min(info.duration || Infinity, offset + video.currentTime);
  if (!position && !old.position) return;
  library.progress[current.id] = { ...old, position, duration: info.duration, completed: !!old.completed || (info.duration > 0 && position >= info.duration - finishMargin(info.duration)), hidden: false, updated: Date.now() };
}
function groups(kind) {
  const map = new Map();
  for (const item of library.items.filter(i => i.kind === kind && (!folderFilter || i.root === folderFilter))) {
    const key = kind === 'show' ? titleKey(item) : item.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  const words = tab === 'search' ? query.trim().toLowerCase() : '';
  return [...map.values()].filter(items => searchText(items).includes(words));
}
const groupStatus = items => items.every(i => completed(i.id)) ? 'done' : items.some(i => completed(i.id) || library.progress[i.id]?.position > 0) ? 'progress' : 'new';
const itemMeta = item => item.kind === 'show' ? `Season ${item.season} · Episode ${item.episode}` : item.kind === 'audio' ? `${item.format} · Audio` : `${item.format} · Movie`;
const groupMeta = items => { const item = items[0], seasons = new Set(items.map(i => i.season)).size; return item.kind === 'show' ? `${seasons} ${seasons === 1 ? 'season' : 'seasons'} · ${items.length} episodes` : `${meta(item)?.year ? `${meta(item).year} · ` : ''}${itemMeta(item)}`; };
function cover(item, extra = '') {
  const m = meta(item);
  return `<span class="cover ${artFor(item)}">${m?.poster ? `<img src="${esc(m.poster)}" alt="" loading="lazy">` : `<span class="cover-title">${esc(displayName(item))}</span>`}${extra}</span>`;
}
function poster(items) {
  const item = items[0], status = groupStatus(items), p = item.kind !== 'show' ? library.progress[item.id] : null;
  const bar = status === 'progress' && p?.duration ? `<span class="progress-track"><span class="progress-fill" data-progress="${Math.min(100, p.position / p.duration * 100)}"></span></span>` : '';
  const badge = status === 'done' ? `<span class="status-badge" aria-label="Watched">${icon('check')}</span>` : '';
  return `<button class="card" data-detail="${item.id}" aria-label="Open ${esc(displayName(item))}">${cover(item, badge + bar)}<span class="card-name">${esc(displayName(item))}</span><span class="card-meta">${esc(groupMeta(items))}</span></button>`;
}
function continueCard(i) {
  const p = library.progress[i.id] || { position: 0, duration: 0 }, backdrop = meta(i)?.backdrop;
  return `<div class="continue-card"><button class="cw" data-play="${i.id}"><span class="cw-art ${artFor(i)}" data-frame="${i.kind === 'audio' ? '' : i.id}" data-time="${p.position || 0}">${backdrop ? `<img src="${esc(backdrop)}" alt="">` : ''}<span class="cw-play">${icon('play')}</span><span class="cw-text"><span class="cw-line"><span class="card-name">${esc(displayName(i))}${i.kind === 'show' ? ` · S${i.season} E${i.episode}` : ''}</span><span class="card-meta">${p.duration ? `${fmt(p.duration - p.position)} left` : 'Up next'}</span></span><span class="progress-track"><span class="progress-fill" data-progress="${p.duration ? Math.min(100, p.position / p.duration * 100) : 0}"></span></span></span></span></button><button class="remove-continue" data-remove-continue="${i.id}" aria-label="Remove ${esc(i.group)} from Continue watching">×</button></div>`;
}
// Real frames from where you stopped, fetched one at a time (the preview decoder cancels overlapping requests).
const frames = new Map();
let frameRun = 0;
async function loadFrames() {
  const run = ++frameRun;
  for (const el of document.querySelectorAll('[data-frame]')) {
    if (!el.dataset.frame) continue;
    const key = `${el.dataset.frame}:${Math.floor(el.dataset.time)}`;
    let frame = frames.get(key);
    if (frame === undefined) { try { frame = await api.preview({ id: el.dataset.frame, time: Number(el.dataset.time) || 0 }); } catch { frame = null; } frames.set(key, frame); }
    if (run !== frameRun || view !== 'library') return;
    if (frame && el.isConnected) { el.querySelector('img')?.remove(); el.insertAdjacentHTML('afterbegin', '<img alt="">'); el.querySelector('img').src = frame; }
  }
}
function dock() {
  const items = [['movie', 'Movies', 'movies'], ['show', 'Shows', 'shows'], ...(library.items.some(i => i.kind === 'audio') ? [['audio', 'Music', 'music']] : []), ['search', 'Search', 'search'], ['folders', 'Folders', 'folder']];
  return `<div class="dock-wrap"><button class="dock-back" data-action="close-detail" aria-label="Close details" title="Back (Esc)">${icon('back')}</button><nav class="dock" aria-label="Library">${items.map(([id, label, glyph]) => `<button class="dock-item" data-tab="${id}" ${tab === id && !folderFilter ? `aria-current="page" title="Back to the landing page"` : ''}>${icon(glyph)}<span class="dock-label">${label}</span>${['movie', 'show', 'audio'].includes(id) ? `<span class="sr-only"> ${groups(id).length}</span>` : ''}</button>`).join('')}</nav></div>`;
}
let footerOpen = false;
function footer() {
  return `<button class="help-button" data-action="about" aria-label="About Matro and this library" aria-controls="library-footer" aria-expanded="${footerOpen}">?</button><footer id="library-footer" class="library-footer ${footerOpen ? 'open' : ''}"><span class="local-status"><span class="status-dot"></span>Local library</span><span class="dim">Your files stay on this device. No account, no uploads.</span><span id="scanner-status" class="scanner-status" role="status"></span>${metadataEnabled ? '<span class="dim">Metadata and artwork from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</span>' : ''}<span class="motion-setting" role="group" aria-label="Poster motion"><span>Motion</span>${[['system', `Match Windows${reduceMotion.matches ? ' (off)' : ' (on)'}`], ['on', 'On'], ['off', 'Off']].map(([id, label]) => `<button class="chip" data-motion="${id}" aria-pressed="${(library.preferences.motion || 'system') === id}">${label}</button>`).join('')}</span><button class="text-button" data-action="shortcuts" aria-label="Keyboard shortcuts">Shortcuts</button></footer>`;
}
const sectionGrid = (title, items, count, more) => items.length ? `<section class="section"><div class="section-heading"><h2>${title}</h2><span>${count}${more ? ` · <button class="text-button" data-tab="${more}">See all</button>` : ''}</span></div><div class="grid">${items.map(poster).join('')}</div></section>` : '';
const kinds = [['show', 'Shows', 'shows'], ['movie', 'Movies', 'titles'], ['audio', 'Music & audio', 'files']];
function landingPage() {
  if (!library.items.length) return `<section class="welcome"><p class="show-kicker">Matro · local library</p><h1>Your collection.<br>Your kind of player.</h1><p>All your films, shows and favourite files in one quiet place. Add a folder to build your library, or drop media anywhere in this window — seasons and episodes are picked up from file names.</p><div class="show-actions"><button class="pill primary" data-action="folder">${icon('folder')}Add folder</button><button class="pill" data-action="files">${icon('plus')}Open files</button></div><div class="formats">${['MKV', 'MP4', 'AVI', 'MOV', 'WEBM', 'FLAC', '+ MORE'].map(f => `<span>${f}</span>`).join('')}</div></section>`;
  const continues = continueItems();
  const featured = !folderFilter ? featuredTitles() : [];
  return `${folderFilter ? `<div class="page-head"><div><h1 class="page-title">${esc(base(folderFilter))}</h1><p class="page-sub">${esc(folderFilter)}</p></div><button class="text-button" data-action="all-folders">Show all folders</button></div>` : ''}
    ${continues.length ? `<section class="section"><div class="section-heading"><h2>Continue watching ${icon('chevron')}</h2><span>${continues.length} in progress</span></div><div class="cw-row">${continues.map(continueCard).join('')}</div></section>` : ''}
    ${featured.length ? reelMarkup(featured) : ''}
    ${kinds.map(([kind, title, noun]) => { const items = groups(kind); return sectionGrid(title, items, `${items.length} ${kind === 'show' ? 'shows' : noun}`, folderFilter ? '' : kind); }).join('')}`;
}
function browsePage(kind) {
  const [, title, noun] = kinds.find(([k]) => k === kind), all = groups(kind), items = all.filter(g => statusFilter === 'all' || groupStatus(g) === statusFilter);
  const chips = [['all', 'All'], ['new', kind === 'audio' ? 'Not played' : 'Unwatched'], ['progress', 'In progress'], ['done', kind === 'audio' ? 'Played' : 'Watched']];
  return `<div class="page-head"><div><h1 class="page-title">${title}</h1><p class="page-sub">${all.length} ${kind === 'show' ? 'shows' : noun}${statusFilter !== 'all' ? ` · ${items.length} shown` : ''}</p></div><div class="chip-row" role="group" aria-label="Filter by status">${chips.map(([id, label]) => `<button class="chip" data-status-filter="${id}" aria-pressed="${statusFilter === id}">${label}</button>`).join('')}</div></div>
    ${items.length ? `<div class="grid">${items.map(poster).join('')}</div>` : `<div class="empty-results"><h2>Nothing here yet.</h2><p>${all.length ? 'No titles match this filter.' : 'Add a folder or open files to fill this shelf.'}</p></div>`}`;
}
function searchPage() {
  const words = query.trim().toLowerCase();
  const sections = kinds.map(([kind, title, noun]) => { const items = groups(kind); return sectionGrid(title, items, `${items.length} ${kind === 'show' ? 'shows' : noun}`); }).join('');
  const files = words ? library.items.filter(i => i.path.toLowerCase().includes(words)).slice(0, 12) : [];
  const total = kinds.reduce((sum, [kind]) => sum + groups(kind).length, 0) + files.length;
  return `<div class="search-hero"><label for="search">Search movies, shows, people and file names</label><div class="search-field">${icon('search')}<input id="search" type="search" placeholder="Try a title, a director, or a file name" aria-label="Search library" autocomplete="off" value="${esc(query)}"><kbd>Ctrl K</kbd></div><p class="search-summary">${words ? `${total} ${total === 1 ? 'result' : 'results'} across ${library.items.length} files` : 'Searching your whole library — titles, people and file names'}</p></div>
    ${sections}${files.length ? `<section class="section"><div class="section-heading"><h2>Files</h2><span>${files.length}</span></div>${files.map(i => `<button class="file-row" data-play="${i.id}">${icon('file')}<span class="mono">${esc(i.path)}</span><small>${esc(i.format)}</small></button>`).join('')}</section>` : ''}
    ${words && !total ? '<div class="empty-results"><h2>No matches.</h2><p>Check the spelling, or search by part of a file name.</p></div>' : ''}`;
}
function foldersPage() {
  const loose = library.items.filter(i => !library.folders.includes(i.root)).length;
  return `<div class="page-head"><div><h1 class="page-title">Folders</h1><p class="page-sub">${library.folders.length} ${library.folders.length === 1 ? 'source' : 'sources'} · ${library.items.length} items · stored on this device only</p></div><div class="show-actions"><button class="pill" data-action="files">${icon('plus')}Open files</button><button class="pill" data-action="rescan" aria-label="Rescan folders">${icon('refresh')}Rescan</button><button class="pill primary" data-action="folder">${icon('plus')}Add folder</button></div></div>
    <ul class="sources">${library.folders.map((f, index) => `<li class="source-row"><span class="source-icon">${icon(/^\\\\|^\/\//.test(f) ? 'network' : 'folder')}</span><span class="min"><span class="source-name">${esc(base(f))}</span><span class="source-path mono" title="${esc(f)}">${esc(f)}</span></span><span class="source-count">${library.items.filter(i => i.root === f).length} items</span><span class="source-actions"><button class="pill small" data-folder="${index}" aria-label="Browse ${esc(base(f))}">Browse</button><button class="icon-button" data-remove-folder="${index}" aria-label="Remove ${esc(base(f))} from library">${icon('trash')}</button></span></li>`).join('')}
    ${loose ? `<li class="source-row"><span class="source-icon">${icon('file')}</span><span><span class="source-name">Opened files</span><span class="source-path">Added one by one or dropped into the window</span></span><span class="source-count">${loose} items</span><span></span></li>` : ''}</ul>
    ${!library.folders.length && !loose ? '<p class="page-sub">No folders yet. Add one to build your library — mounted network drives work too.</p>' : ''}
    <div class="drop-hint">${icon('upload')}Drop folders or files anywhere to import · scanning is recursive</div>
    <p class="note">Removing a folder never deletes files on disk. Progress, queue and skip markers are kept for when you add it back.</p>`;
}
function renderLibrary() {
  view = 'library'; document.body.classList.remove('in-player');
  const page = tab === 'search' ? searchPage() : tab === 'folders' ? foldersPage() : ['movie', 'show', 'audio'].includes(tab) ? browsePage(tab) : landingPage();
  root.innerHTML = `<div class="shell">${dock()}<main class="page">${page}</main>${footer()}</div>`;
  applyStyles(root);
  $('#search')?.addEventListener('input', event => { const caret = event.target.selectionStart; query = event.target.value; renderLibrary(); $('#search').focus(); $('#search').setSelectionRange(caret, caret); });
  setupReel(); renderScannerStatus(); void loadFrames();
}
function rerender() {
  if (view !== 'library') return;
  const focused = document.activeElement?.id === 'search' ? $('#search').selectionStart : null, scroll = $('.shell')?.scrollTop || 0, open = selected?.id;
  renderLibrary(); if ($('.shell')) $('.shell').scrollTop = scroll;
  if (focused !== null && $('#search')) { $('#search').focus(); $('#search').setSelectionRange(focused, focused); }
  if (open) detail(open, false);
}
// Landing poster reel: an endless strip moved by sideways scroll, drag or arrow keys.
const LINES = [
  ['M 92 52 C 220 14, 388 18, 438 128 C 468 206, 458 336, 432 426', 'M 452 96 C 464 118, 470 146, 466 176', 'M 38 258 C 24 290, 24 330, 40 362', 'M 18 280 C 10 310, 12 338, 24 362'],
  ['M 30 300 C 12 420, 40 566, 152 618 C 224 646, 306 640, 368 624', 'M 384 34 C 404 38, 424 48, 436 64', 'M 400 16 C 422 22, 442 36, 454 54'],
  ['M 126 30 C 266 2, 428 34, 446 204', 'M 454 236 C 468 336, 446 476, 386 566', 'M 32 118 C 20 150, 18 182, 26 212']
];
// Motion follows Windows' animation setting unless the user overrides it (preferences.motion: 'system' | 'on' | 'off').
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motionReduced = () => library.preferences.motion === 'off' || (library.preferences.motion !== 'on' && reduceMotion.matches);
function applyMotion() { document.body.classList.toggle('reduce-motion', motionReduced()); }
reduceMotion.addEventListener('change', () => { applyMotion(); if (view === 'library') renderLibrary(); });
// The reel is driven frame by frame: mode is 'idle', 'drag' (follows the pointer), 'wheel' (follows trackpad deltas),
// 'free' (coasting on release velocity with friction) or 'spring' (easing into a poster with a soft, slightly bouncy spring).
// pos counts posters; slots repeats the titles until there are at least eight, so the loop's wrap always happens off-screen.
let reel = { pos: 0, vel: 0, target: 0, mode: 'idle', raf: 0, last: 0, list: [], slots: [], variant: 0, drag: null, hover: null, justDragged: false, samples: [], wheelTimer: null, shown: -1 };
const FRICTION = 2.4, STIFFNESS = 80, DAMPING = 2 * .8 * Math.sqrt(80), MAX_SPEED = 26;
const mod = (a, n) => ((a % n) + n) % n;
function featuredTitles() {
  const recency = items => Math.max(0, ...items.map(i => library.progress[i.id]?.hidden ? 0 : library.progress[i.id]?.updated || 0));
  // Every movie and show, most recently watched first, then newest additions.
  return [...groups('show'), ...groups('movie')].sort((a, b) => recency(b) - recency(a) || (b[0].added || 0) - (a[0].added || 0));
}
function reelMarkup(list) {
  reel.list = list;
  // Enough repeats to fill both sides of a wide window, so the loop's wrap still happens beyond the faded edges.
  const copies = list.length > 1 ? Math.ceil(18 / list.length) : 1;
  reel.slots = Array.from({ length: list.length * copies }, (_, slot) => slot % list.length);
  return `<section class="showcase" id="showcase" aria-label="Featured from your library"><div class="show-meta" id="show-meta"></div><div class="reel" id="reel" tabindex="0" role="region" aria-roledescription="carousel" aria-label="Featured titles. Scroll sideways, drag, or use the arrow keys."><div class="reel-glow" id="reel-glow" aria-hidden="true"><span></span><span></span></div>${reel.slots.map((index, slot) => { const item = list[index][0], m = meta(item); return `<button class="reel-poster ${artFor(item)}" data-reel="${index}" data-slot="${slot}" tabindex="-1" ${slot >= list.length ? 'aria-hidden="true"' : ''} aria-label="${esc(displayName(item))}, featured">${m?.poster ? `<img src="${esc(m.poster)}" alt="" loading="lazy" draggable="false">` : `<span class="cover-title">${esc(displayName(item))}</span>`}<span class="glare"></span></button>`; }).join('')}<div class="reel-ratings" id="reel-ratings"></div></div><div class="reel-top" aria-hidden="true"><svg class="reel-lines" id="reel-lines" viewBox="0 0 470 650"></svg></div><div class="reel-dots" id="reel-dots" aria-hidden="true">${list.length > 12 ? '<span class="reel-count"></span>' : list.map(() => '<span></span>').join('')}</div></section>`;
}
const reelCentre = () => mod(Math.round(reel.pos), reel.list.length || 1);
const centreSlot = () => mod(Math.round(reel.pos), reel.slots.length || 1);
const slotOffset = slot => { const n = reel.slots.length; return n > 1 ? mod(slot - reel.pos + n / 2, n) - n / 2 : 0; };
// The strip runs the full window width. Posters shrink with distance from the centre and spacing follows their size,
// so the strip tapers toward both edges; each side stretches to reach its edge, where posters fade to nothing.
const POSTER_SIZE = 1.08, GAP = .8;
const posterScale = a => 1 / (1 + .15 * a + .022 * a * a);
const REACH = [0];
for (let i = 1; i <= 64; i++) { const t = i / 4; REACH.push(REACH[i - 1] + 340 * GAP * .25 * (posterScale(t - .25) + posterScale(t)) / 2); }
const reachAt = a => { const i = Math.min(63.999, a * 4), lo = Math.floor(i); return REACH[lo] + (REACH[lo + 1] - REACH[lo]) * (i - lo); };
function reelFrame() {
  const el = $('#reel'), show = $('#showcase'); if (!el || !show) return null;
  const box = el.getBoundingClientRect(), area = show.getBoundingClientRect(), start = parseFloat(getComputedStyle(show).getPropertyValue('--reel-start')) || 400;
  const k = Math.max(.62, Math.min(1.1, (area.width - start) / 1040)) * POSTER_SIZE, cx = area.left - box.left + start + (area.width - start) / 2;
  return { k, cx, width: box.width, stretchL: Math.max(1, (cx - 60) / (reachAt(6) * k)), stretchR: Math.max(1, (box.width - cx - 60) / (reachAt(6) * k)) };
}
function placeAt(off, f) {
  const a = Math.abs(off), dir = Math.sign(off), stretch = 1 + ((dir < 0 ? f.stretchL : f.stretchR) - 1) * Math.min(1, a / 4);
  const x = dir * reachAt(a) * f.k * stretch, y = (dir < 0 ? 46 : -26) * a * Math.max(0, 1 - a / 14) * f.k;
  const edge = Math.min(f.cx + x, f.width - f.cx - x), half = reel.slots.length > 1 ? reel.slots.length / 2 : 99;
  const o = Math.max(0, Math.min(1, (edge - 10) / (f.width * .14))) * Math.max(0, Math.min(1, (half - a) / .6));
  return { x, y, r: -2 + dir * Math.min(15, 4.6 * a), s: posterScale(a), b: 1 / (1 + .55 * a), o };
}
function updateReel() {
  const el = $('#reel'), f = reelFrame(); if (!el || !f) return;
  const centre = reelCentre(), moving = reel.mode !== 'idle';
  $('#showcase').style.setProperty('--cx', `${f.cx.toFixed(1)}px`);
  el.classList.toggle('animating', moving); el.classList.toggle('dragging', reel.mode === 'drag');
  el.querySelectorAll('.reel-poster').forEach((poster, i) => {
    const off = slotOffset(i), p = placeAt(off, f);
    // Off-screen and fully faded posters leave rendering entirely (their lazy images don't load until they come into view).
    if (p.o < .01) { if (poster.style.display !== 'none') { poster.style.display = 'none'; poster.classList.remove('tilting'); } return; }
    if (poster.style.display === 'none') poster.style.display = '';
    const tilt = reel.hover && reel.hover.index === i && !moving ? reel.hover : null;
    poster.classList.toggle('tilting', !!tilt);
    poster.style.transform = `translate(-50%, -50%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) perspective(900px) rotateX(${tilt ? tilt.rx.toFixed(2) : 0}deg) rotateY(${tilt ? tilt.ry.toFixed(2) : 0}deg) rotate(${p.r.toFixed(2)}deg) scale(${(p.s * (tilt ? 1.05 : 1) * f.k).toFixed(3)})`;
    // Nearer posters stack above farther ones; the whole reel stays below the rest of the page.
    poster.style.zIndex = String(100 - Math.round(Math.abs(off) * 10));
    poster.style.filter = `brightness(${p.b.toFixed(3)}) saturate(${Math.min(1, .55 + .45 * p.b).toFixed(3)})`;
    poster.style.opacity = p.o.toFixed(3); poster.style.visibility = p.o < .01 ? 'hidden' : 'visible'; poster.style.pointerEvents = p.o < .5 ? 'none' : 'auto';
    if (tilt) { poster.style.setProperty('--gx', `${tilt.gx}%`); poster.style.setProperty('--gy', `${tilt.gy}%`); }
  });
  // Hand-drawn lines appear only around the hovered poster, following it.
  const lines = $('#reel-lines'), h = reel.hover && !moving ? reel.hover : null;
  if (h) { const p = placeAt(slotOffset(h.index), f); lines.style.transform = `translate(-50%, -50%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) rotate(${p.r.toFixed(2)}deg) scale(${(p.s * 1.035 * f.k).toFixed(3)})`; }
  lines.style.opacity = h ? '1' : '0';
  const glow = $('#reel-glow'); glow.style.transform = `translate(-50%, -50%) scale(${f.k.toFixed(3)})`; glow.classList.toggle('hot', !!h);
  const count = $('#reel-dots .reel-count');
  if (count) count.textContent = `${centre + 1} / ${reel.list.length}`; else $('#reel-dots').querySelectorAll('span').forEach((dot, i) => dot.classList.toggle('on', i === centre));
}
function drawLines() {
  const lines = $('#reel-lines'); if (!lines) return;
  lines.innerHTML = LINES[reel.variant].map(d => `<path d="${d}"/>`).join('');
  lines.classList.remove('draw'); void lines.getBoundingClientRect(); if (!motionReduced()) lines.classList.add('draw');
}
function renderShowMeta() {
  const panel = $('#show-meta'); if (!panel || !reel.list.length) return;
  const items = reel.list[reelCentre()], item = items[0], m = meta(item), name = displayName(item);
  const resume = items.find(i => library.progress[i.id]?.position > 0 && !completed(i.id)), target = resume || items.find(i => !completed(i.id)) || item;
  const rows = m ? [[m.peopleLabel, m.people?.slice(0, 2).join(', ')], ['Year', m.year], ['Genre', m.genres?.slice(0, 2).join(', ')]] : [];
  if (!rows.some(([, value]) => value)) rows.splice(0, rows.length, ['Type', item.kind === 'show' ? 'Series' : 'Movie'], ...(item.kind === 'show' ? [['Seasons', String(new Set(items.map(i => i.season)).size)], ['Episodes', String(items.length)]] : [['Format', item.format]]), ['Folder', item.root ? base(item.root) : 'Opened file']);
  panel.innerHTML = `<p class="show-kicker">${resume ? 'Pick up where you left off' : 'Featured from your library'}</p><h2 class="show-title ${name.length > 22 ? 'longer' : name.length > 12 ? 'long' : name.length > 7 ? 'mid' : ''}">${esc(name)}</h2><dl class="meta-list">${rows.filter(([, value]) => value).map(([label, value]) => `<div><dt>${esc(label)}</dt><dd title="${esc(value)}">${esc(value)}</dd></div>`).join('')}</dl><div class="show-actions"><button class="pill primary" data-play="${target.id}">${icon('play')}${resume ? 'Resume watching' : 'Play'}</button><button class="pill" data-detail="${item.id}">Details</button></div>${reel.list.length > 1 ? `<p class="show-hint">${icon('arrows')}Scroll sideways or drag to browse</p>` : ''}`;
  $('#reel-ratings').innerHTML = m?.rating ? `<div><strong>${m.rating.toFixed(1)}</strong><img class="tmdb-logo" src="assets/tmdb.svg" alt="TMDB rating" draggable="false"></div>` : '';
}
// Ambient glow: the centre poster is shrunk once to 24×36 pixels and eight edge regions (corners and edge midpoints) are averaged.
// Each colour then glows from the matching side of the poster. Results are cached per image, so browsing costs nothing extra.
// Spots sit on the poster's corners and edge midpoints inside a glow box much larger than the poster, so every colour fades out before the box edge.
const GLOW_SPOTS = ['39% 35%', '50% 33%', '61% 35%', '38% 50%', '62% 50%', '39% 65%', '50% 67%', '61% 65%'];
const palettes = new Map();
function vivid(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const h = !d ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  // Lift dull, dark regions just enough to read as light on the near-black page.
  return `hsl(${Math.round((h + 360) % 360)} ${Math.round(Math.min(1, s * 1.3 + .08) * 100)}% ${Math.round(Math.min(.6, Math.max(.32, l)) * 100)}%)`;
}
async function posterPalette(poster) {
  const img = poster.querySelector('img'), key = img?.src || `hue:${poster.dataset.hue}`;
  if (palettes.has(key)) return palettes.get(key);
  let colours;
  if (img) {
    try {
      if (!img.complete) await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 36;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, 24, 36);
      const data = ctx.getImageData(0, 0, 24, 36).data;
      // Average each 8×12 cell of a 3×3 grid, skipping the centre cell.
      colours = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]].map(([cx, cy]) => {
        let r = 0, g = 0, b = 0;
        for (let y = cy * 12; y < cy * 12 + 12; y++) for (let x = cx * 8; x < cx * 8 + 8; x++) { const p = (y * 24 + x) * 4; r += data[p]; g += data[p + 1]; b += data[p + 2]; }
        return vivid(r / 96, g / 96, b / 96);
      });
    } catch { colours = null; }
  }
  if (!colours) { const h = Number(poster.dataset.hue) || 210; colours = GLOW_SPOTS.map((_, i) => `hsl(${(h + i * 12) % 360} 55% ${i < 3 ? 52 : 38}%)`); }
  palettes.set(key, colours);
  return colours;
}
let glowRun = 0;
async function updateGlow() {
  const glow = $('#reel-glow'), poster = document.querySelector(`.reel-poster[data-slot="${centreSlot()}"]`); if (!glow || !poster) return;
  const run = ++glowRun, colours = await posterPalette(poster);
  if (run !== glowRun || !glow.isConnected) return;
  // Cross-fade: paint the hidden layer, then swap which layer is visible.
  const [a, b] = glow.children, next = a.classList.contains('on') ? b : a;
  next.style.background = colours.map((colour, i) => `radial-gradient(circle 320px at ${GLOW_SPOTS[i]}, ${colour}, transparent)`).join(', ');
  a.classList.toggle('on', next === a); b.classList.toggle('on', next === b);
}
// One animation frame: coast with friction, hand over to the spring once slow, then render.
function stepReel(now) {
  reel.raf = 0;
  const dt = Math.min(1 / 30, Math.max(0, (now - reel.last) / 1000)); reel.last = now;
  if (reel.mode === 'free') {
    reel.pos += reel.vel * dt; reel.vel *= Math.exp(-FRICTION * dt);
    // Aim for where the coast would naturally end, so the spring keeps the throw's direction and energy.
    if (Math.abs(reel.vel) < 3.5) { reel.mode = 'spring'; reel.target = Math.round(reel.pos + reel.vel / FRICTION); }
  } else if (reel.mode === 'spring') {
    reel.vel += (-STIFFNESS * (reel.pos - reel.target) - DAMPING * reel.vel) * dt; reel.pos += reel.vel * dt;
    if (Math.abs(reel.pos - reel.target) < .0006 && Math.abs(reel.vel) < .01) { reel.pos = reel.target; reel.vel = 0; reel.mode = 'idle'; }
  }
  frameReel();
  if (reel.mode === 'free' || reel.mode === 'spring') reel.raf = requestAnimationFrame(stepReel);
}
function runReel() { if (!reel.raf) { reel.last = performance.now(); reel.raf = requestAnimationFrame(stepReel); } }
// Render the current position; the title, rating and glow follow the centre poster live as it changes.
function frameReel() {
  updateReel();
  const centre = reelCentre(); if (centre !== reel.shown) { reel.shown = centre; renderShowMeta(); void updateGlow(); }
}
function springTo(target) {
  if (motionReduced()) { cancelAnimationFrame(reel.raf); reel.raf = 0; reel.pos = target; reel.vel = 0; reel.mode = 'idle'; frameReel(); return; }
  reel.target = target; reel.mode = 'spring'; reel.hover = null; runReel();
}
function fling(velocity) {
  if (motionReduced()) return springTo(Math.round(reel.pos));
  reel.vel = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, velocity)); reel.mode = 'free'; reel.hover = null; runReel();
}
// Release speed from the last ~100 ms of movement, in posters per second.
function sample() { const now = performance.now(); reel.samples.push({ t: now, pos: reel.pos }); while (reel.samples.length > 2 && now - reel.samples[0].t > 100) reel.samples.shift(); }
// A least-squares slope over the last 100 ms before release, so one stray sample cannot flip the throw, and pausing before letting go means no throw.
function releaseSpeed() {
  const now = performance.now(), s = reel.samples.filter(p => now - p.t <= 100); reel.samples = [];
  if (s.length < 2 || s[s.length - 1].t - s[0].t < 8) return 0;
  const mt = s.reduce((sum, p) => sum + p.t, 0) / s.length, mp = s.reduce((sum, p) => sum + p.pos, 0) / s.length;
  const num = s.reduce((sum, p) => sum + (p.t - mt) * (p.pos - mp), 0), den = s.reduce((sum, p) => sum + (p.t - mt) ** 2, 0);
  return den ? num / den * 1000 : 0;
}
function stopReel() { cancelAnimationFrame(reel.raf); reel.raf = 0; reel.vel = 0; }
function reelPick(slot) {
  if (reel.justDragged) return;
  const n = reel.slots.length, base = reel.mode === 'spring' ? reel.target : Math.round(reel.pos), delta = mod(slot - mod(base, n) + Math.floor(n / 2), n) - Math.floor(n / 2);
  if (delta === 0 && reel.mode === 'idle') return openDetail(reel.list[reel.slots[slot]][0].id, document.querySelector(`.reel-poster[data-slot="${slot}"]`));
  springTo(base + delta);
}
function setupReel() {
  const el = $('#reel'); if (!el) return;
  if (!Number.isFinite(reel.pos)) reel.pos = 0;
  // A re-render mid-gesture loses the old element's listeners; ease into the nearest poster instead.
  if (reel.mode === 'drag' || reel.mode === 'wheel') { reel.mode = 'spring'; reel.target = Math.round(reel.pos); }
  reel.hover = null; reel.drag = null; reel.shown = reelCentre();
  // Place posters without animating in from their untransformed spot.
  el.classList.add('instant'); updateReel(); renderShowMeta(); void updateGlow(); void el.offsetWidth; requestAnimationFrame(() => el.classList.remove('instant'));
  if (reel.mode !== 'idle') runReel();
  // Dragging one poster-gap moves one poster.
  const posterWidth = () => reachAt(1) * (reelFrame()?.k || 1);
  el.addEventListener('wheel', event => {
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY), d = horizontal ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (!d || reel.list.length < 2) return;
    event.preventDefault();
    // A mouse-wheel notch steps one poster; trackpad deltas move the reel directly and ride the OS's own inertia.
    if (event.deltaMode === 1 || (Math.abs(d) >= 50 && Number.isInteger(d))) return springTo((reel.mode === 'spring' ? reel.target : Math.round(reel.pos)) + Math.sign(d));
    stopReel(); reel.mode = 'wheel'; reel.hover = null; reel.pos += d / posterWidth(); sample(); frameReel();
    clearTimeout(reel.wheelTimer); reel.wheelTimer = setTimeout(() => { if (reel.mode === 'wheel') fling(releaseSpeed()); }, 90);
  }, { passive: false });
  el.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); springTo((reel.mode === 'spring' ? reel.target : Math.round(reel.pos)) + (event.key === 'ArrowRight' ? 1 : -1)); }
    else if (event.key === 'Enter' && event.target === el) { event.preventDefault(); openDetail(reel.list[reelCentre()][0].id, document.querySelector(`.reel-poster[data-slot="${centreSlot()}"]`)); }
  });
  // Posters are artwork, not files: never start the browser's image drag-and-drop.
  el.addEventListener('dragstart', event => event.preventDefault());
  el.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Grabbing a moving reel catches it where it is.
    const caught = reel.mode !== 'idle'; stopReel(); if (caught) { reel.mode = 'drag'; updateReel(); }
    reel.drag = { x: event.clientX, pos: reel.pos, moved: false, caught }; reel.samples = []; sample();
  });
  el.addEventListener('pointermove', event => {
    const d = reel.drag;
    if (d) {
      const dx = event.clientX - d.x;
      if (d.moved || Math.abs(dx) >= 6) {
        if (!d.moved) { d.moved = true; try { el.setPointerCapture(event.pointerId); } catch { /* Capture is optional. */ } }
        reel.mode = 'drag'; reel.hover = null; reel.pos = d.pos - dx / posterWidth() * (reel.list.length > 1 ? 1 : 0); sample(); frameReel();
        return;
      }
    }
    // Hover effects belong to the centre poster only.
    const poster = event.target.closest('.reel-poster'), index = poster ? Number(poster.dataset.slot) : -1;
    if (reel.mode !== 'idle' || !poster || index !== centreSlot()) { if (reel.hover) { reel.hover = null; updateReel(); } return; }
    // Entering gives a fresh, randomly chosen set of lines; the poster's resting box is kept so tilting doesn't feed back into the cursor maths.
    const fresh = !reel.hover;
    if (fresh) { reel.variant = (reel.variant + 1 + Math.floor(Math.random() * 2)) % 3; reel.hoverBox = poster.getBoundingClientRect(); }
    const r = reel.hoverBox, px = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)), py = Math.min(1, Math.max(0, (event.clientY - r.top) / r.height));
    // The edge under the cursor tips toward the viewer: up to 9° vertically and 13° horizontally.
    reel.hover = motionReduced() ? { index, rx: 0, ry: 0, gx: 50, gy: 30 } : { index, rx: (.5 - py) * 18, ry: (px - .5) * 26, gx: Math.round(px * 100), gy: Math.round(py * 100) };
    updateReel(); if (fresh) drawLines();
  });
  const end = () => {
    const d = reel.drag; reel.drag = null; if (!d) return;
    if (!d.moved) { if (d.caught) springTo(Math.round(reel.pos)); return; }
    reel.justDragged = true; setTimeout(() => { reel.justDragged = false; }, 0); fling(releaseSpeed());
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', () => { if (reel.hover && !reel.drag) { reel.hover = null; updateReel(); } });
}
window.addEventListener('resize', () => { if (view === 'library') updateReel(); });
function detail(id, focus = true) {
  selected = library.items.find(i => i.id === id); if (!selected) return;
  const items = selected.kind === 'show' ? library.items.filter(i => i.kind === 'show' && sameTitle(i, selected)).sort((a, b) => a.season - b.season || a.episode - b.episode) : [selected];
  const m = meta(selected), name = displayName(selected), seasons = new Set(items.map(i => i.season)).size;
  const resume = items.find(i => library.progress[i.id]?.position > 0 && !completed(i.id)), target = resume || items.find(i => !completed(i.id)) || selected, p = resume ? library.progress[resume.id] : null;
  const facts = [[m?.year, m?.genres?.slice(0, 3).join(' · ')], [selected.kind === 'show' ? `${seasons} ${seasons === 1 ? 'season' : 'seasons'} · ${items.length} episodes` : m?.runtime ? `${Math.floor(m.runtime / 60) ? `${Math.floor(m.runtime / 60)}h ` : ''}${m.runtime % 60}m` : null]].flat().filter(Boolean);
  const overlay = document.createElement('div'); overlay.className = 'detail'; overlay.id = 'detail-overlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-labelledby', 'detail-title');
  overlay.innerHTML = `<div class="detail-hero"><span class="detail-hero-art ${artFor(selected)}">${m?.backdrop ? `<img src="${esc(m.backdrop)}" alt="" draggable="false">` : `<span class="cover-title">${esc(name)}</span>`}</span><span class="detail-hero-fade"></span></div>
    <div class="detail-body"><div class="detail-head">${m?.poster && !m.backdrop ? `<span class="detail-poster"><img src="${esc(m.poster)}" alt=""></span>` : ''}<h2 id="detail-title">${esc(name)}</h2>
      ${m?.people?.length ? `<p class="detail-sub">${esc(m.peopleLabel)} <strong>${esc(m.people.slice(0, 3).join(', '))}</strong></p>` : ''}
      <p class="detail-sub">${[...facts, selected.kind === 'show' ? 'Series' : selected.kind === 'audio' ? 'Audio' : 'Movie', selected.format].map(esc).join(' <span aria-hidden="true">·</span> ')}</p>
      ${m?.overview ? `<p class="detail-overview">${esc(m.overview)}</p>` : ''}
      <div class="detail-actions"><button class="pill primary" data-play="${target.id}">${icon('play')}${resume ? `Resume<span class="resume-time" aria-hidden="true">${resume !== selected && selected.kind === 'show' ? `S${resume.season} E${resume.episode} · ` : ''}${fmt(p.position)}</span>${p.duration ? `<span class="resume-bar" aria-hidden="true"><span data-progress="${Math.min(100, p.position / p.duration * 100)}"></span></span>` : ''}` : 'Play now'}</button>
      ${resume ? `<button class="pill" data-restart="${resume.id}">${icon('restart')}Play from start</button>` : ''}<button class="pill" data-enqueue="${selected.id}">${icon('plus')}Add to queue</button><button class="pill" data-complete="${selected.id}">${icon('check')}${completed(selected.id) ? 'Mark incomplete' : 'Mark complete'}</button></div>
      ${m?.rating ? `<div class="ratings"><div><p><img class="tmdb-logo" src="assets/tmdb.svg" alt="TMDB rating"></p><strong>${m.rating.toFixed(1)}</strong><small>/10 · ${m.votes.toLocaleString()} votes</small></div></div>` : ''}
      ${metadataEnabled && selected.kind !== 'audio' ? `<p class="match-line">${m ? `Matched on TMDB as <strong>${esc(m.title)}</strong>${m.year ? ` (${esc(m.year)})` : ''}.` : 'Not matched on TMDB yet.'}<button class="text-button" data-action="fix-match">${icon('search')}${m ? 'Wrong title? Fix match' : 'Find on TMDB'}</button></p>` : ''}</div>
    <div class="detail-panels">${items.length > 1 ? episodesPanel(selected, items, resume, target) : ''}
      <section class="panel" aria-labelledby="file-h"><div class="panel-head"><h3 id="file-h">File</h3></div><div class="facts"><div><p>Format</p><strong>${esc(selected.format)}</strong><small>${selected.kind === 'show' ? 'Series' : selected.kind === 'audio' ? 'Audio' : 'Movie'}</small></div><div><p>Source</p><strong>${esc(selected.root ? base(selected.root) : 'Opened file')}</strong><small>Local file</small></div>${m?.cast?.length ? `<div><p>Starring</p><strong>${esc(m.cast.slice(0, 2).join(', '))}</strong>${m.cast[2] ? `<small>${esc(m.cast.slice(2).join(', '))}</small>` : ''}</div>` : ''}</div><div class="path-box">${icon('folder')}<span class="mono">${esc(selected.path)}</span></div><p class="note">Audio tracks, subtitles and chapters appear when playback starts. HDR is tone-mapped and surround plays as stereo.</p></section></div></div>`;
  document.querySelectorAll('.detail').forEach(old => old.remove()); root.append(overlay); applyStyles(overlay);
  if (focus) $('.dock-back')?.focus({ preventScroll: true });
}
// Episodes: one season at a time behind season tabs, each episode a card with its TMDB still, summary and progress.
let detailSeason = null;
const episodeInfo = item => meta(item)?.episodes?.[item.season]?.[item.episode] || null;
function episodeCard(i, resume) {
  const e = episodeInfo(i), p = library.progress[i.id], done = completed(i.id), now = resume?.id === i.id, pct = p?.duration ? Math.min(100, p.position / p.duration * 100) : 0;
  const facts = [e?.runtime ? `${e.runtime}m` : null, i.format, now ? `${fmt(p.position)} watched` : done ? 'Watched' : p?.position > 0 ? 'In progress' : null].filter(Boolean);
  return `<div class="episode-entry ${now ? 'current' : ''}"><button class="episode-row" data-play="${i.id}"><span class="episode-still ${artFor(i)}">${e?.still ? `<img src="${esc(e.still)}" alt="" loading="lazy" draggable="false">` : ''}<span class="episode-code">S${i.season} E${i.episode}</span>${done ? `<span class="status-badge" aria-label="Watched">${icon('check')}</span>` : ''}${pct && !done ? `<span class="progress-track"><span class="progress-fill" data-progress="${pct}"></span></span>` : ''}<span class="episode-play">${icon('play')}</span></span><span class="episode-text min"><strong>${i.episode}. ${esc(episodeName(i))}</strong><small>${facts.map(esc).join(' · ')}</small>${e?.overview ? `<span class="episode-overview">${esc(e.overview)}</span>` : ''}</span></button><button class="text-button" data-complete="${i.id}" aria-label="${done ? 'Mark incomplete' : 'Mark complete'} ${esc(i.title)}">${done ? 'Completed' : 'Mark complete'}</button></div>`;
}
function episodesPanel(selected, items, resume, target) {
  const seasons = [...new Set(items.map(i => i.season))], key = titleKey(selected);
  const open = detailSeason?.key === key && seasons.includes(detailSeason.season) ? detailSeason.season : (resume || target).season;
  const stats = s => { const eps = items.filter(i => i.season === s); return { eps, watched: eps.filter(i => completed(i.id)).length }; };
  return `<section class="panel wide episodes" aria-labelledby="episodes-h"><div class="panel-head"><h3 id="episodes-h">Episodes</h3>${seasons.length > 1 ? `<div class="chip-row season-tabs" role="tablist" aria-label="Seasons">${seasons.map(s => { const { eps, watched } = stats(s); return `<button class="chip" role="tab" data-season-tab="${s}" aria-selected="${s === open}" aria-pressed="${s === open}">Season ${s}<span class="season-count">${watched}/${eps.length}</span></button>`; }).join('')}</div>` : ''}<button class="text-button" data-enqueue-show="${selected.id}">Queue all</button></div>${seasons.map(s => { const { eps, watched } = stats(s); return `<section class="season" data-season-panel="${s}" ${s === open ? '' : 'hidden'}><h3 class="season-heading">Season ${s} · ${eps.length} ${eps.length === 1 ? 'episode' : 'episodes'} · ${watched} watched</h3><div class="episode-grid">${eps.map(i => episodeCard(i, resume)).join('')}</div></section>`; }).join('')}</section>`;
}
function showSeason(season) {
  if (!selected) return;
  detailSeason = { key: titleKey(selected), season };
  document.querySelectorAll('[data-season-panel]').forEach(panel => { panel.hidden = Number(panel.dataset.seasonPanel) !== season; });
  document.querySelectorAll('[data-season-tab]').forEach(tab => { const on = Number(tab.dataset.seasonTab) === season; tab.setAttribute('aria-selected', String(on)); tab.setAttribute('aria-pressed', String(on)); });
}
// Manual TMDB matching: search, then pin a result (or none) to the title.
let matchItem = null, matchTimer, matchRun = 0;
const cleanName = text => String(text).replace(/[._]+/g, ' ').replace(/\s*[[(]?\b(?:19|20)\d{2}\b[\])]?.*$/, '').trim() || String(text);
function openMatch(item) {
  if (!item) return;
  matchItem = item; let dialog = $('#match-dialog');
  if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'match-dialog'; dialog.className = 'match-dialog'; dialog.setAttribute('aria-labelledby', 'match-title'); document.body.append(dialog); }
  const m = meta(item);
  dialog.innerHTML = `<div class="section-heading"><h2 id="match-title">Match with TMDB</h2><button class="icon-button" data-action="close-match" aria-label="Close">×</button></div><p class="match-note">Pick the right ${item.kind === 'show' ? 'series' : 'movie'} for <span class="mono">${esc(item.kind === 'show' ? item.group : base(item.path))}</span>. Your files are not changed.</p><div class="search-field small">${icon('search')}<input id="match-query" type="search" aria-label="Search TMDB" autocomplete="off" value="${esc(m?.title || cleanName(item.group))}"></div><div id="match-results" class="match-results" aria-live="polite"></div><div class="match-footer"><button class="text-button" data-match-none>${m ? 'Remove match and use the file name' : 'Keep using the file name'}</button><button class="pill small" data-action="close-match">Cancel</button></div>`;
  dialog.showModal();
  const input = $('#match-query');
  input.addEventListener('input', () => { clearTimeout(matchTimer); matchTimer = setTimeout(() => void runMatchSearch(), 300); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); clearTimeout(matchTimer); void runMatchSearch(); } });
  input.focus(); input.select(); void runMatchSearch();
}
async function runMatchSearch() {
  const run = ++matchRun, list = $('#match-results'); if (!list || !matchItem) return;
  list.innerHTML = '<p class="scan-note">Searching TMDB…</p>';
  let results;
  try { results = await api.searchMetadata({ kind: matchItem.kind, query: $('#match-query').value }); } catch (error) { if (run === matchRun) list.innerHTML = `<p class="scan-note">${esc(error.message)}</p>`; return; }
  if (run !== matchRun) return;
  const currentId = meta(matchItem)?.tmdbId;
  list.innerHTML = results.length ? results.map(r => `<button class="match-row" data-match-pick="${r.id}">${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : `<span class="match-thumb art" data-hue="${hash(r.title) % 360}"></span>`}<span class="min"><strong>${esc(r.title)}</strong>${r.year ? ` <small>${esc(r.year)}</small>` : ''}<span class="match-overview">${esc(r.overview || 'No description on TMDB.')}</span></span>${r.id === currentId ? '<span class="match-current">Current</span>' : ''}</button>`).join('') : '<p class="scan-note">No results. Try a shorter title or the original-language name.</p>';
  applyStyles(list);
}
async function assignMatch(tmdbId) {
  const item = matchItem; if (!item) return;
  const list = $('#match-results'); if (list) list.innerHTML = '<p class="scan-note">Loading details…</p>';
  metadata = await api.assignMetadata({ key: metaKey(item), tmdbId });
  $('#match-dialog')?.close(); matchItem = null;
  toast(tmdbId === null ? 'Using the file name for this title.' : `Matched with ${displayName(item)}.`); rerender();
}
function closeDetail() {
  const id = selected?.id, card = document.querySelector(`.card[data-detail="${id}"]`), centre = document.querySelector(`.reel-poster[data-slot="${centreSlot()}"]`);
  // Shrink back into the card (or the centre reel poster) the title came from, when it is on screen.
  const back = card?.querySelector('.cover') || (reel.list[reelCentre()]?.some(i => i.id === id) ? centre : null);
  const overlay = $('#detail-overlay'); selected = null;
  if (overlay && canAnimate()) {
    // Drop the id at once so the page underneath (and the dock's Back button) behave as closed while this plays out.
    overlay.removeAttribute('id'); overlay.style.pointerEvents = 'none';
    const hero = overlay.querySelector('.detail-hero'), to = back?.getBoundingClientRect();
    const runs = [overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 340, easing: 'ease-in', fill: 'forwards' })];
    if (to) runs.push(hero.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)' }, { clipPath: insetFrom(to, hero.getBoundingClientRect()) }], { duration: 380, easing: EASE, fill: 'forwards' }));
    Promise.all(runs.map(run => run.finished)).finally(() => overlay.remove());
  } else overlay?.remove();
  (card || document.querySelector(`[data-detail="${id}"]`))?.focus({ preventScroll: true });
}
function enqueue(id, all = false) {
  const item = library.items.find(i => i.id === id); if (!item) return;
  const ids = all ? library.items.filter(i => sameTitle(i, item) && i.kind === 'show').sort((a, b) => a.season - b.season || a.episode - b.episode).map(i => i.id) : [id];
  library.queue = [...new Set([...library.queue, ...ids])]; void attempt(save); toast(`${all ? 'Episodes' : displayName(item)} added to queue`); if (view === 'player') renderQueue();
}
function ib(name, label, action, extra = '') { return `<button class="icon-button ${extra}" data-action="${action}" aria-label="${label}" title="${label}">${icon(name)}</button>`; }
async function play(id, keepQueue = false) {
  const item = library.items.find(i => i.id === id); if (!item) return;
  hidePreview(); remember(); await save(); const token = ++generation; subtitleGeneration++; loading = true; frameRun++; selected = null;
  video?.pause(); if (video) { video.removeAttribute('src'); video.load(); }
  await api.stop(); current = item; view = 'player'; sidePanel = null; subtitle = null; subtitleText = null; delay = 0; playbackError = ''; markerDraft = null; segmentStatus = '';
  if (item.kind === 'show' && (!keepQueue || library.queue.some(queued => { const entry = library.items.find(i => i.id === queued); return !entry || entry.kind !== 'show' || !sameTitle(entry, item); }))) {
    library.queue = orderedEpisodes(item).map(i => i.id);
  } else if (!library.queue.includes(id)) {
    const siblings = item.kind === 'show' ? library.items.filter(i => sameTitle(i, item) && i.kind === 'show').sort((a, b) => a.season - b.season || a.episode - b.episode).map(i => i.id) : [id];
    library.queue = [...new Set([...library.queue, ...siblings])];
  }
  info = { duration: 0, audio: [], subtitles: [], chapters: [] }; renderPlayer();
  try {
    const metadata = await api.inspect(id); if (token !== generation) return; info = metadata;
    const choice = library.preferences.tracks?.[titleKey(item)];
    audio = matchTrack(info.audio, choice?.audio)?.index ?? info.audio.find(a => a.default)?.index ?? info.audio[0]?.index ?? null;
    subtitle = choice?.off ? null : matchTrack(info.subtitles.filter(t => t.text || t.bitmap), choice?.subtitle)?.index ?? null;
    delay = choice?.delay || 0; subSize = choice?.size || 'M'; video.className = `sub-${subSize}`;
    if (info.subtitles.find(t => t.index === subtitle)?.text) {
      try { subtitleText = await api.subtitles({ id, index: subtitle }); } catch { subtitle = null; subtitleText = null; }
      if (token !== generation) return;
    }
    if (library.progress[id]) library.progress[id].hidden = false;
    const progress = library.progress[id]; const start = progress && !completed(id) && progress.position < info.duration - finishMargin(info.duration) ? progress.position : 0;
    updateMetadata(); await loadStream(start, true, token); await save(); void detectMarkers(id);
  } catch (error) { if (token === generation) { loading = false; playbackError = error.message; showMessage(); } }
}
function renderPlayer() {
  document.body.classList.add('in-player');
  const heading = current.kind === 'show' ? `${displayName(current)} · S${current.season} E${current.episode}` : itemMeta(current);
  root.innerHTML = `<div class="player-layout"><main class="stage"><video id="video" playsinline></video><div class="player-top">${ib('back', 'Back to library (Esc)', 'library')}<div class="player-heading"><h1>${esc(current.kind === 'show' ? episodeName(current) : displayName(current))}</h1><p>${esc(heading)}</p><div class="player-chips" id="player-chips"></div></div><div class="player-actions" id="player-actions"></div></div><div class="stage-message" id="stage-message"></div><div class="player-controls"><div class="timeline"><span class="time" id="position">0:00</span><div class="seek-area"><div class="seek-marks" id="seek-marks" aria-hidden="true"></div><input class="seek" id="seek" type="range" min="0" max="1" step=".1" value="0" aria-label="Seek"><div id="seek-preview" class="seek-preview" role="tooltip" aria-label="Seek preview" hidden><img id="seek-preview-image" alt="Frame preview" hidden><span id="seek-preview-status">Loading preview…</span><output id="seek-preview-time"></output></div></div><span class="time" id="duration">0:00</span></div><div class="control-row"><div class="control-group">${ib('prev', 'Previous in queue', 'previous')}<button class="icon-button skip-button" data-action="backward" aria-label="Back ${SKIP} seconds" title="Back ${SKIP} seconds (←)">${skipIcon(true, SKIP)}</button><button class="icon-button play-toggle" id="play-toggle" data-action="toggle" aria-label="Play">${icon('play')}</button><button class="icon-button skip-button" data-action="forward" aria-label="Forward ${SKIP} seconds" title="Forward ${SKIP} seconds (→)">${skipIcon(false, SKIP)}</button>${ib('next', 'Next in queue', 'next')}${ib('volume', 'Mute (M)', 'mute')}<input id="volume" class="volume" type="range" min="0" max="1" step=".01" value="${library.preferences.volume}" aria-label="Volume"><output class="volume-value" id="volume-value"></output></div><div class="control-group"><button class="icon-button speed" data-action="speed" aria-label="Change playback speed">1×</button><button class="icon-button" id="tracks-button" data-action="tracks" aria-label="Audio and subtitles" title="Audio and subtitles">${icon('tracks')}</button>${ib('queue', 'Queue', 'queue', queueOpen ? 'active' : '')}${ib('fullscreen', 'Fullscreen (F)', 'fullscreen')}</div></div></div><div id="segment-tools" class="segment-tools"></div><div id="tracks"></div></main><aside id="queue" class="queue-panel" aria-label="Queue" ${queueOpen ? '' : 'hidden'}></aside></div>`;
  video = $('#video'); video.volume = library.preferences.volume; updateVolume();
  const player = video;
  const listen = (name, callback) => player.addEventListener(name, event => { if (video === player && view === 'player') callback(event); });
  listen('timeupdate', () => { updateTime(); if (Date.now() - lastSave > 1000) { remember(); void attempt(save); lastSave = Date.now(); } });
  listen('playing', () => { if (playIntent && !video.paused) void api.playbackState(true); loading = false; playbackError = ''; showMessage(); updateToggle(); scheduleIdle(); });
  listen('pause', () => { if (!playIntent) void api.playbackState(false); loading = false; showMessage(); updateToggle(); $('.stage')?.classList.remove('idle'); remember(); void attempt(save); });
  listen('waiting', () => { loading = playIntent && !video.paused; if (loading) void api.playbackState({ playing: true, buffering: true }); showMessage(); });
  listen('ended', () => { playIntent = false; void api.playbackState(false); remember(); void attempt(save); if (library.preferences.autoplay) void step(1); updateToggle(); });
  listen('error', () => { void api.playbackState(false); loading = false; playbackError = 'Playback failed. File may be unavailable, damaged, or use an unsupported codec.'; showMessage(); });
  listen('click', () => toggle());
  listen('dblclick', () => api.window('fullscreen'));
  $('#seek').addEventListener('input', e => { $('#position').textContent = fmt(e.target.value); fillRange(e.target); });
  $('#seek').addEventListener('change', e => { void attempt(() => seek(Number(e.target.value))); });
  $('#seek').addEventListener('pointermove', hoverSeek);
  $('#seek').addEventListener('pointerleave', hidePreview);
  $('#seek').addEventListener('blur', hidePreview);
  $('#volume').addEventListener('input', e => { setVolume(Number(e.target.value)); });
  $('.stage').addEventListener('mousemove', () => { $('.stage').classList.remove('idle'); scheduleIdle(); });
  renderQueue(); renderSegments(); showMessage();
}
const fillRange = input => input.style.setProperty('--fill', `${(Number(input.value) - Number(input.min)) / Math.max(1e-9, Number(input.max) - Number(input.min)) * 100}%`);
function updateVolume() { const input = $('#volume'), output = $('#volume-value'); if (!input || !video) return; input.value = video.volume; fillRange(input); output.textContent = video.muted ? 'Muted' : `${Math.round(video.volume * 100)}%`; }
function scheduleIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (view === 'player' && !video.paused && !sidePanel && !loading && !previewHovered && !$('.stage').querySelector(':focus-visible')) $('.stage').classList.add('idle'); }, 3200); }
function updateMetadata() {
  $('#player-chips').innerHTML = `<span class="chip">${esc(current.format)}</span>${info.video ? `<span class="chip">${info.video.height}p · ${esc(info.video.codec.toUpperCase())}</span>` : '<span class="chip">Audio</span>'}${info.audio.length ? `<span class="chip">${esc(info.audio.find(a => a.index === audio)?.codec.toUpperCase())} · Stereo output</span>` : ''}`;
  $('#seek').max = info.duration || 1; $('#duration').textContent = fmt(info.duration); renderSeekMarks();
}
async function loadStream(position, shouldPlay = true, token = generation) {
  playIntent = shouldPlay; loading = true; playbackError = ''; showMessage(); updateToggle();
  const result = await api.stream({ id: current.id, offset: position, audio, bitmapSubtitle: bitmapTrack()?.index ?? null, subtitleDelay: delay }); if (token !== generation) return;
  offset = result.offset; video.src = result.url; video.load(); applySubtitle(); updateTime();
  if (playIntent) { try { await video.play(); } catch (error) { if (token === generation && error.name !== 'AbortError') { loading = false; playbackError = error.message; showMessage(); } } }
  else { video.addEventListener('loadeddata', () => { loading = false; showMessage(); }, { once: true }); }
}
async function seek(position) {
  if (!info.duration || !current) return;
  const target = Math.max(0, Math.min(info.duration - .1, position));
  const shouldPlay = playIntent;
  const relative = target - offset;
  // Fragmented streams can buffer frames before Chromium exposes a seekable range.
  for (let i = 0; i < video.seekable.length; i++) if (relative >= video.seekable.start(i) && relative <= video.seekable.end(i)) { video.currentTime = relative; updateTime(); return; }
  const token = ++generation; await loadStream(target, shouldPlay, token);
}
function updateTime() { if (!video || view !== 'player') return; const position = Math.min(info.duration || Infinity, offset + (video.currentTime || 0)); $('#position').textContent = fmt(position); if (document.activeElement !== $('#seek')) $('#seek').value = position; fillRange($('#seek')); updateSkip(position); }
function updateToggle() { const btn = $('#play-toggle'); if (!btn) return; btn.innerHTML = icon(playIntent ? 'pause' : 'play'); btn.setAttribute('aria-label', playIntent ? 'Pause' : 'Play'); }
function toggle() { if (!video || !video.getAttribute('src')) return; playIntent = !playIntent; void api.playbackState(playIntent); if (playIntent) void attempt(() => video.play()); else video.pause(); updateToggle(); }
function setVolume(value) { if (!video) return; video.volume = Math.max(0, Math.min(1, value)); video.muted = false; library.preferences.volume = video.volume; updateVolume(); const btn = document.querySelector('[data-action="mute"]'); if (btn) btn.innerHTML = icon('volume'); void attempt(save); }
function showMessage() {
  const message = $('#stage-message'); if (!message) return;
  message.classList.toggle('error', !!playbackError);
  message.innerHTML = playbackError ? `<h2>Couldn’t play this file.</h2><p>${esc(playbackError)}</p><button class="pill" data-action="retry">Try again</button>` : loading ? '<span class="eyebrow">Getting your file ready</span><p>Preparing playback…</p>' : !info.video ? `<div class="audio-art ${artFor(current)}">${icon('music')}</div><h2>${esc(current.group)}</h2><p>${esc(current.format)} · Audio</p>` : '';
  applyStyles(message);
}
function renderQueue() {
  const panel = $('#queue'); if (!panel) return; const visible = fullscreenActive ? fullscreenQueueOpen : queueOpen; panel.hidden = !visible;
  document.querySelector('[data-action="queue"]')?.classList.toggle('active', visible);
  $('.player-layout')?.classList.toggle('with-queue', visible);
  const items = library.queue.map(id => library.items.find(i => i.id === id)).filter(Boolean), left = items.filter(i => i.id !== current.id && !completed(i.id)).length;
  const row = (item, index) => {
    const id = item.id, previous = items[index - 1], now = id === current.id, done = completed(id), p = library.progress[id], pct = p?.duration && !done ? Math.min(100, p.position / p.duration * 100) : 0;
    const still = episodeInfo(item)?.still || (item.kind !== 'show' ? meta(item)?.backdrop : null), runtime = episodeInfo(item)?.runtime;
    const heading = item.kind === 'show' && (!previous || !sameTitle(previous, item) || previous.season !== item.season) ? `<h3 class="season-heading">${esc(displayName(item))} · Season ${item.season}</h3>` : '';
    return `${heading}<div class="queue-row ${now ? 'current' : ''} ${done ? 'done' : ''}"><button class="qplay" data-play="${id}" aria-label="Play ${esc(item.title)}"><span class="queue-thumb ${artFor(item)}">${still ? `<img src="${esc(still)}" alt="" draggable="false">` : ''}<span class="queue-code">${item.kind === 'show' ? `E${item.episode}` : esc(item.format)}</span>${pct ? `<span class="progress-track"><span class="progress-fill" data-progress="${pct}"></span></span>` : ''}</span><span class="queue-info"><small class="kicker">${now ? '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>Now playing' : done ? 'Watched' : item.kind === 'show' ? `S${item.season} · E${item.episode}` : 'Movie'}</small><strong>${esc(item.kind === 'show' ? episodeName(item) : displayName(item))}</strong><small>${esc([runtime ? `${runtime}m` : null, item.format].filter(Boolean).join(' · '))}</small></span></button><span class="queue-actions"><button class="icon-button" data-complete="${id}" aria-label="${done ? 'Mark incomplete' : 'Mark complete'} ${esc(item.title)}" title="${done ? 'Mark incomplete' : 'Mark complete'}">${icon('check')}</button><button class="icon-button" data-remove-queue="${id}" aria-label="Remove ${esc(item.title)} from queue" title="Remove from queue">${icon('close')}</button></span></div>`;
  };
  panel.innerHTML = `<div class="queue-header"><div><h2>Up next</h2><p>${left} to go · ${items.length} in queue</p></div><button class="text-button" data-action="clear-watched">Clear watched</button></div><div class="queue-items">${items.map(row).join('') || '<p class="queue-empty">Nothing queued. Add titles from a title page.</p>'}</div><div class="autoplay"><div><strong>Autoplay next</strong><small>Plays the next episode when one ends</small></div><button class="switch ${library.preferences.autoplay ? 'on' : ''}" data-action="autoplay" aria-label="Autoplay next" aria-pressed="${library.preferences.autoplay}"></button></div>`;
  applyStyles(panel);
}
async function step(direction) {
  const queue = current?.kind === 'show' ? library.queue.filter(id => { const item = library.items.find(i => i.id === id); return item?.kind === 'show' && sameTitle(item, current); }) : library.queue;
  const index = queue.indexOf(current?.id);
  if (index >= 0 && queue[index + direction]) await play(queue[index + direction], true);
}
const scanningSegments = new Set();
function acceptMarkers(id, detected) {
  library.markers ||= {};
  const manual = (library.markers[id] || []).filter(s => s.source !== 'automatic');
  library.markers[id] = [...manual, ...detected.filter(s => !manual.some(m => m.start < s.end && m.end > s.start))];
}
async function detectMarkers(id, force = false) {
  library.markers ||= {};
  if (!current || current.kind !== 'show' || scanningSegments.has(id)) return;
  if (!force && library.markers[id]?.some(s => s.source === 'automatic')) { renderSegments(); return; }
  scanningSegments.add(id); segmentStatus = 'Comparing season episodes…'; renderSegments(); renderTracks();
  try {
    const detected = await api.segments({ id, force });
    acceptMarkers(id, detected);
    await save();
    if (current?.id === id) segmentStatus = detected.length ? 'Markers ready. Background scanning continues through your library.' : 'No reliable repeats found. Background scans will check full episodes for more matches.';
  } catch (error) { if (current?.id === id && error.name !== 'AbortError') segmentStatus = `Detection unavailable: ${error.message}`; }
  finally { scanningSegments.delete(id); if (current?.id === id) { renderSegments(); renderTracks(); } }
}
function renderSegments() {
  const actionsPanel = $('#player-actions'), tools = $('#segment-tools'); if (!actionsPanel || !tools || !current) return;
  actionsPanel.innerHTML = `<button class="pill" data-action="complete-current">${completed(current.id) ? 'Completed ✓' : 'Mark complete'}</button><button class="pill ${sidePanel === 'segments' ? 'active' : ''}" id="segments-button" data-action="segments" aria-label="Skip segment settings" aria-expanded="${sidePanel === 'segments'}">Skip segments${isScanning(current.id) ? ' · Scanning…' : ''}</button>`;
  tools.innerHTML = '<button class="pill" id="skip-segment" data-action="skip-segment" aria-keyshortcuts="Enter" hidden></button>';
  renderSeekMarks(); updateSkip(offset + (video?.currentTime || 0));
}
function renderSeekMarks() {
  const marks = $('#seek-marks'); if (!marks || !current) return;
  const duration = info?.duration || 0, markers = duration ? library.markers?.[current.id] || [] : [];
  marks.innerHTML = markers.map(() => '<span></span>').join('');
  markers.forEach((s, i) => { const span = marks.children[i]; span.style.left = `${s.start / duration * 100}%`; span.style.width = `${Math.max(.4, (s.end - s.start) / duration * 100)}%`; span.title = s.type; });
}
function updateSkip(position) {
  const button = $('#skip-segment'); if (!button || !current) return;
  const marker = (library.markers?.[current.id] || []).find(s => position >= s.start && position < s.end);
  button.hidden = !marker; if (marker) button.innerHTML = `Skip ${esc(marker.type)}<kbd class="key-hint" aria-hidden="true">Enter</kbd>`;
}
function openPanel(name) {
  sidePanel = sidePanel === name ? null : name;
  renderTracks();
}
function segmentsPanel() {
  const markers = library.markers?.[current.id] || [];
  const rows = markers.map((s, index) => `<div class="marker-row"><span class="marker-type">${esc(s.type)}</span><span class="mono">${fmt(s.start)} – ${fmt(s.end)}</span><span class="dim">${s.source === 'automatic' ? 'Detected' : 'Manual'}</span><button class="text-button" data-marker-seek="${index}">Jump</button><button class="text-button" data-marker-remove="${index}" aria-label="Remove ${esc(s.type)} marker">Remove</button></div>`).join('');
  return `<section class="tracks-panel segments-panel" aria-label="Skip segments"><div class="tracks-heading"><h3>Skip segments</h3><button class="icon-button" data-action="segments" aria-label="Close skip segments">×</button></div>
    <p class="scan-note">A skip button appears while playback is inside one of these ranges.${current.kind === 'show' ? ' Matro compares episodes of this season to find intros, recaps and outros.' : ''}</p>
    <div class="marker-list">${rows || '<p class="scan-note">No skip ranges for this file yet.</p>'}</div>
    <div class="marker-actions">${markerDraft ? `<span>${esc(markerDraft.type)} starts at ${fmt(markerDraft.start)} — seek to its end</span><button class="pill" data-action="marker-end">Save end here</button><button class="text-button" data-action="marker-cancel">Cancel</button>` : ['intro', 'outro', 'recap'].map(type => `<button class="text-button" data-marker-start="${type}">Mark ${type} start</button>`).join('')}</div>
    ${current.kind === 'show' ? `<div class="marker-scan"><button class="text-button" data-action="detect-segments" ${isScanning(current.id) ? 'disabled' : ''}>Compare season again</button><p class="scan-note" role="status">${esc(segmentStatus)}</p></div>` : ''}</section>`;
}
function renderTracks() {
  const panel = $('#tracks'); if (!panel) return;
  $('#tracks-button').classList.toggle('active', sidePanel === 'tracks');
  $('#tracks-button').setAttribute('aria-expanded', String(sidePanel === 'tracks'));
  const segments = $('#segments-button'); if (segments) { segments.classList.toggle('active', sidePanel === 'segments'); segments.setAttribute('aria-expanded', String(sidePanel === 'segments')); }
  if (!sidePanel) { panel.innerHTML = ''; return; }
  $('.stage').classList.remove('idle');
  if (sidePanel === 'segments') { panel.innerHTML = segmentsPanel(); return; }
  const bitmap = !!bitmapTrack();
  const audioRows = info.audio.map(a => `<button class="track-option ${a.index === audio ? 'selected' : ''}" data-audio="${a.index}" aria-pressed="${a.index === audio}"><span class="radio"></span><span class="track-copy">${trackHeading(a)}<small>${esc(a.codec.toUpperCase())} · ${a.channels} ch${a.channels > 2 ? ' · plays as stereo' : ''}${a.default ? ' · Default' : ''}</small></span></button>`).join('');
  const subtitleRows = info.subtitles.map(s => `<button class="track-option ${s.index === subtitle ? 'selected' : ''}" data-subtitle="${s.index}" aria-pressed="${s.index === subtitle}" ${s.text || s.bitmap ? '' : 'disabled'}><span class="radio"></span><span class="track-copy">${trackHeading(s)}<small>${esc(s.codec.toUpperCase())} · ${s.bitmap ? 'Bitmap' : s.text ? 'Text' : 'Unsupported format'}</small></span></button>`).join('');
  panel.innerHTML = `<section class="tracks-panel" aria-label="Audio and subtitles">
    <div class="tracks-heading"><h3>Audio & subtitles</h3><button class="icon-button" data-action="tracks" aria-label="Close audio and subtitles">×</button></div>
    <div class="track-columns"><div><h3>Audio</h3>${audioRows || '<p class="scan-note">No audio tracks</p>'}</div>
    <div><h3>Subtitles</h3><button class="track-option ${subtitle === null ? 'selected' : ''}" data-subtitle="off" aria-pressed="${subtitle === null}"><span class="radio"></span><span><strong>Off</strong><small>No subtitles</small></span></button>${subtitleRows}
    ${subtitle === 'external' ? '<button class="track-option selected" disabled><span class="radio"></span><span><strong>External file</strong><small>Loaded subtitles</small></span></button>' : ''}</div></div>
    <div class="track-bottom"><div class="delay-controls"><span>Sub delay</span><button class="icon-button" data-action="delay-down" aria-label="Subtitles earlier by 0.1 seconds">−</button><output>${delay > 0 ? '+' : ''}${delay.toFixed(1)} s</output><button class="icon-button" data-action="delay-up" aria-label="Subtitles later by 0.1 seconds">+</button></div>
    <div class="size-options" aria-label="Subtitle size">${['S', 'M', 'L'].map(size => `<button class="${size === subSize ? 'selected' : ''}" data-size="${size}" aria-label="Subtitle size ${size}" aria-pressed="${size === subSize}" ${bitmap ? 'disabled title="Bitmap subtitles keep their original size"' : ''}>${size}</button>`).join('')}</div><button class="text-button" data-action="subtitle-file">Load subtitle file…</button></div>
    ${bitmap ? '<p class="bitmap-note">Bitmap subtitles keep their original appearance. Track or delay changes briefly reload playback.</p>' : ''}
    ${info.chapters.length ? `<div class="player-chapters">${info.chapters.map((c, index) => `<button class="chapter-button" data-chapter="${index}">${esc(c.title)} · ${fmt(c.start)}</button>`).join('')}</div>` : ''}</section>`;
}
function applySubtitle() {
  $('#subtitle-track')?.remove(); if (subtitleUrl) URL.revokeObjectURL(subtitleUrl); subtitleUrl = null; trackCues = [];
  if (!subtitleText || !video) return;
  subtitleUrl = URL.createObjectURL(new Blob([subtitleText], { type: 'text/vtt' }));
  const track = document.createElement('track'); track.id = 'subtitle-track'; track.kind = 'subtitles'; track.label = 'Selected subtitles'; track.src = subtitleUrl; track.default = true;
  track.addEventListener('load', () => { track.track.mode = 'showing'; trackCues = [...track.track.cues].map(cue => { cue.line = -5; return { cue, start: cue.startTime, end: cue.endTime }; }); adjustCues(); });
  video.append(track);
}
function adjustCues() { for (const { cue, start, end } of trackCues) { const endTime = end - offset + delay; cue.startTime = Math.max(0, start - offset + delay); cue.endTime = Math.max(.001, endTime); } }
async function pickSubtitle(value) {
  const token = ++subtitleGeneration; const id = current.id;
  const wasBitmap = !!bitmapTrack();
  if (value === 'off') { subtitle = null; subtitleText = null; rememberTracks(); applySubtitle(); renderTracks(); if (wasBitmap) await restartStream(); return; }
  const selectedTrack = info.subtitles.find(track => track.index === Number(value));
  if (selectedTrack?.bitmap) { subtitle = selectedTrack.index; subtitleText = null; rememberTracks(); applySubtitle(); renderTracks(); await restartStream(); return; }
  const text = await api.subtitles({ id, index: Number(value) }); if (token !== subtitleGeneration || current.id !== id) return;
  subtitle = Number(value); subtitleText = text; rememberTracks(); applySubtitle(); renderTracks();
  if (wasBitmap) await restartStream();
}
async function restartStream() { const token = ++generation; await loadStream(offset + video.currentTime, playIntent, token); }
async function changeSubtitleDelay(change) { delay = Math.max(-60, Math.min(60, Math.round((delay + change) * 10) / 10)); adjustCues(); renderTracks(); rememberTracks(); if (bitmapTrack()) await restartStream(); }
async function backToLibrary() {
  hidePreview(); if (fullscreenActive) await api.window('fullscreen'); remember(); await save(); ++generation; ++subtitleGeneration; video?.pause(); if (video) { video.removeAttribute('src'); video.load(); } await api.stop();
  if (subtitleUrl) URL.revokeObjectURL(subtitleUrl); current = null; video = null; renderLibrary();
}
// Page transitions run through the View Transitions API and are skipped when motion is reduced.
const canAnimate = () => !!document.startViewTransition && !motionReduced();
function pageTransition(x, y, update) {
  if (!canAnimate()) return update();
  document.documentElement.style.setProperty('--vt-x', x); document.documentElement.style.setProperty('--vt-y', y);
  document.startViewTransition(update);
}
// Title pages open as a reveal: the backdrop stays put and is uncovered outward from the clicked poster's rectangle,
// clipped to its own frame, while the page fades in over the library. Closing runs it in reverse toward the card.
const EASE = 'cubic-bezier(.2,.75,.15,1)';
function insetFrom(rect, frame) {
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  const top = clamp(rect.top - frame.top, frame.height - 2), left = clamp(rect.left - frame.left, frame.width - 2);
  const bottom = clamp(frame.bottom - rect.bottom, frame.height - top - 2), right = clamp(frame.right - rect.right, frame.width - left - 2);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round 6px)`;
}
const artFrom = source => source?.matches?.('.reel-poster') ? source : source?.querySelector?.('.cover') || (source?.closest?.('#show-meta') ? document.querySelector(`.reel-poster[data-slot="${centreSlot()}"]`) : null);
function openDetail(id, source) {
  const from = artFrom(source)?.getBoundingClientRect();
  detail(id);
  const overlay = $('#detail-overlay'); if (!overlay || !canAnimate()) return;
  const hero = overlay.querySelector('.detail-hero');
  overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
  if (from) hero.animate([{ clipPath: insetFrom(from, hero.getBoundingClientRect()) }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }], { duration: 700, easing: EASE });
  overlay.querySelector('.detail-body').animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 140, easing: EASE, fill: 'backwards' });
}
const TAB_ORDER = ['home', 'movie', 'show', 'audio', 'search', 'folders'];
function goTab(next) {
  // Clicking the selected dock item again deselects it, which is the landing page.
  if (next === tab && next !== 'home' && !folderFilter && !selected) next = 'home';
  // Back to the landing page slides vertically; moving between tabs slides in the dock's direction.
  const from = TAB_ORDER.indexOf(folderFilter ? 'home' : tab), to = TAB_ORDER.indexOf(next);
  if (from === to && !selected) return goTabNow(next);
  // Home rises from the bottom; leaving home slides the landing page down out of view; tabs swipe sideways.
  const [x, y] = next === 'home' ? ['0px', '100vh'] : from === 0 ? ['0px', '-100vh'] : [to >= from ? '100vw' : '-100vw', '0px'];
  pageTransition(x, y, () => goTabNow(next));
}
function goTabNow(next) {
  if (selected) { $('#detail-overlay')?.remove(); selected = null; } if (next !== tab) statusFilter = 'all'; tab = next; folderFilter = null; renderLibrary(); $('.shell')?.scrollTo(0, 0); }
const actions = {
  folder: async () => { toast('Choose a folder. Large collections may take a moment to scan.'); library = await api.addFolder(); renderLibrary(); },
  files: async () => { const before = new Set(library.items.map(i => i.id)); library = await api.openFiles(); const added = library.items.find(i => !before.has(i.id)); if (added) await play(added.id); else if (view === 'library') renderLibrary(); },
  rescan: async () => { toast('Refreshing your folders…'); library = await api.rescan(); renderLibrary(); toast(library.warnings?.join('\n') || 'Library is up to date.'); },
  'all-folders': () => { folderFilter = null; renderLibrary(); }, 'close-detail': closeDetail,
  about: () => { footerOpen = !footerOpen; $('#library-footer')?.classList.toggle('open', footerOpen); $('.help-button')?.setAttribute('aria-expanded', String(footerOpen)); },
  'fix-match': () => openMatch(selected), 'close-match': () => { $('#match-dialog')?.close(); matchItem = null; },
  shortcuts: () => $('#shortcuts').showModal(), library: backToLibrary,
  toggle, backward: () => seek(offset + video.currentTime - SKIP), forward: () => seek(offset + video.currentTime + SKIP),
  previous: () => step(-1), next: () => step(1), fullscreen: () => api.window('fullscreen'),
  queue: () => { if (fullscreenActive) fullscreenQueueOpen = !fullscreenQueueOpen; else queueOpen = !queueOpen; renderQueue(); },
  tracks: () => openPanel('tracks'), segments: () => openPanel('segments'), mute: () => { video.muted = !video.muted; const btn = document.querySelector('[data-action="mute"]'); btn.innerHTML = icon(video.muted ? 'mute' : 'volume'); btn.setAttribute('aria-label', video.muted ? 'Unmute (M)' : 'Mute (M)'); updateVolume(); },
  speed: () => { const rates = [.5, .75, 1, 1.25, 1.5, 2]; video.playbackRate = rates[(rates.indexOf(video.playbackRate) + 1) % rates.length]; document.querySelector('[data-action="speed"]').textContent = `${video.playbackRate}×`; },
  autoplay: async () => { library.preferences.autoplay = !library.preferences.autoplay; await save(); renderQueue(); },
  'clear-watched': async () => { library.queue = library.queue.filter(id => id === current.id || !completed(id)); await save(); renderQueue(); },
  'delay-down': () => changeSubtitleDelay(-.1),
  'delay-up': () => changeSubtitleDelay(.1),
  'subtitle-file': async () => { const id = current.id, token = ++subtitleGeneration; const text = await api.loadSubtitle(); if (text && current?.id === id && token === subtitleGeneration) { const wasBitmap = !!bitmapTrack(); subtitleText = text; subtitle = 'external'; applySubtitle(); renderTracks(); if (wasBitmap) await restartStream(); } },
  'marker-end': async () => {
    const end = offset + video.currentTime;
    if (!markerDraft || end <= markerDraft.start) { toast('End must come after start.'); return; }
    library.markers ||= {}; library.markers[current.id] ||= [];
    library.markers[current.id].push({ ...markerDraft, end, source: 'manual' }); markerDraft = null; await save(); renderSegments(); renderTracks();
  },
  'marker-cancel': () => { markerDraft = null; renderTracks(); },
  'skip-segment': () => { const position = offset + video.currentTime; const marker = (library.markers?.[current.id] || []).find(s => position >= s.start && position < s.end); if (marker) return seek(marker.end); },
  'complete-current': () => markComplete(current.id),
  'detect-segments': () => detectMarkers(current.id, true),
  retry: () => loadStream(offset + video.currentTime)
};
document.addEventListener('click', event => {
  const btn = event.target.closest('button'); if (!btn || btn.disabled) return;
  void attempt(async () => {
    if (btn.dataset.complete) return markComplete(btn.dataset.complete);
    if (btn.dataset.removeContinue) return removeContinue(btn.dataset.removeContinue);
    if (btn.dataset.markerStart) { markerDraft = { type: btn.dataset.markerStart, start: offset + video.currentTime }; renderTracks(); return; }
    if (btn.dataset.markerSeek !== undefined) { const marker = library.markers?.[current.id]?.[Number(btn.dataset.markerSeek)]; if (marker) return seek(marker.start); return; }
    if (btn.dataset.markerRemove !== undefined) { const id = current.id, marker = library.markers[id][Number(btn.dataset.markerRemove)]; library.markers[id] = await api.removeMarker({ id, marker }); renderSegments(); renderTracks(); return; }
    if (btn.dataset.window) { btn.blur(); return api.window(btn.dataset.window); }
    if (btn.dataset.slot !== undefined) return reelPick(Number(btn.dataset.slot));
    if (btn.dataset.seasonTab) return showSeason(Number(btn.dataset.seasonTab));
    if (btn.dataset.matchPick) return assignMatch(Number(btn.dataset.matchPick));
    if (btn.dataset.matchNone !== undefined) return assignMatch(null);
    if (btn.dataset.restart) { const old = library.progress[btn.dataset.restart]; if (old) library.progress[btn.dataset.restart] = { ...old, position: 0, updated: Date.now() }; return play(btn.dataset.restart); }
    if (btn.dataset.play) return play(btn.dataset.play, !!btn.closest('.queue-panel'));
    if (btn.dataset.detail) return openDetail(btn.dataset.detail, btn);
    if (btn.dataset.enqueue) return enqueue(btn.dataset.enqueue);
    if (btn.dataset.enqueueShow) return enqueue(btn.dataset.enqueueShow, true);
    if (btn.dataset.tab) return goTab(btn.dataset.tab);
    if (btn.dataset.motion) {
      library.preferences.motion = btn.dataset.motion; applyMotion(); await save();
      document.querySelectorAll('[data-motion]').forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.motion === btn.dataset.motion)));
      reel.hover = null; updateReel(); return;
    }
    if (btn.dataset.statusFilter) { statusFilter = btn.dataset.statusFilter; renderLibrary(); return; }
    if (btn.dataset.folder !== undefined) { folderFilter = library.folders[Number(btn.dataset.folder)]; tab = 'home'; renderLibrary(); $('.shell')?.scrollTo(0, 0); return; }
    if (btn.dataset.removeFolder !== undefined) { library = await api.removeFolder(library.folders[Number(btn.dataset.removeFolder)]); renderLibrary(); return; }
    if (btn.dataset.removeQueue) { library.queue = library.queue.filter(id => id !== btn.dataset.removeQueue); await save(); renderQueue(); return; }
    if (btn.dataset.audio) { const position = offset + video.currentTime, playing = playIntent; audio = Number(btn.dataset.audio); rememberTracks(); updateMetadata(); renderTracks(); const token = ++generation; await loadStream(position, playing, token); return; }
    if (btn.dataset.subtitle) return pickSubtitle(btn.dataset.subtitle);
    if (btn.dataset.size) { subSize = btn.dataset.size; video.className = `sub-${subSize}`; rememberTracks(); renderTracks(); return; }
    if (btn.dataset.chapter !== undefined) return seek(info.chapters[Number(btn.dataset.chapter)].start);
    const action = actions[btn.dataset.action]; if (action) { btn.classList.add('busy'); try { await action(); } finally { btn.classList.remove('busy'); } }
  });
});
document.addEventListener('keydown', event => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) && event.target.type !== 'range';
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); void attempt(actions.files); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && view === 'library') { event.preventDefault(); if (tab !== 'search') goTab('search'); $('#search')?.focus(); return; }
  if (event.key === 'Escape') { if ($('#shortcuts').open || $('#match-dialog')?.open) return; if (footerOpen && view === 'library') { actions.about(); return; } if (fullscreenActive) { void api.window('fullscreen'); return; } if (selected) closeDetail(); else if (sidePanel) { sidePanel = null; renderTracks(); } else if (view === 'player') void attempt(backToLibrary); return; }
  if (typing || $('#shortcuts').open || view !== 'player') return;
  // Enter takes a visible skip (intro, recap, outro) unless a control has focus and Enter belongs to it.
  if (event.key === 'Enter' && !$('#skip-segment')?.hidden && !event.target.closest('button, a, input, select, textarea')) { event.preventDefault(); void attempt(actions['skip-segment']); return; }
  const key = event.key.toLowerCase(); const keyActions = { ' ': toggle, arrowleft: actions.backward, arrowright: actions.forward, arrowup: () => setVolume(video.volume + .05), arrowdown: () => setVolume(video.volume - .05), f: actions.fullscreen, m: actions.mute };
  if (keyActions[key]) { if (key === ' ' && event.target.closest('button')) return; event.preventDefault(); void attempt(keyActions[key]); $('.stage')?.classList.remove('idle'); scheduleIdle(); }
});
let dragDepth = 0;
document.addEventListener('dragenter', event => { event.preventDefault(); if (!event.dataTransfer.types.includes('Files')) return; if (++dragDepth === 1) { const el = document.createElement('div'); el.id = 'drop-overlay'; el.className = 'drop-overlay'; el.textContent = 'Drop your files. Settle in.'; document.body.append(el); } });
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay')?.remove(); } });
document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('#drop-overlay')?.remove(); const files = Array.from(event.dataTransfer.files); void attempt(async () => { const before = new Set(library.items.map(i => i.id)); library = await api.importDrop(files); const item = library.items.find(i => !before.has(i.id)); if (item) await play(item.id); else toast('No new supported media files found. Use Add folder for directories.'); }); });
window.addEventListener('beforeunload', () => { remember(); void save(); });
api?.onFullscreen(active => { fullscreenActive = active; fullscreenQueueOpen = false; document.body.classList.toggle('fullscreen', active); hidePreview(); if (view === 'player') { renderQueue(); $('.stage')?.classList.remove('idle'); scheduleIdle(); } });
api?.onMetadata?.(update => { metadata = update || {}; rerender(); });
api?.onSegments(update => {
  if (update.scanner) { scannerSummary = update.scanner; renderScannerStatus(); }
  if (update.markers) acceptMarkers(update.id, update.markers);
  if (update.stage === 'resource-mode' && current) { segmentStatus = update.scanner.playback ? 'Scanner keeps working gently while video has priority.' : 'Background scan running at normal speed.'; renderSegments(); renderTracks(); return; }
  if (current?.id !== update.id) return;
  segmentStatus = update.stage === 'decoding' ? `Scanning ${update.scanTitle} · ${update.percent}%${scannerSummary?.playback ? ' · Video has priority' : ''}` : update.stage === 'done' ? 'Markers saved. Background scanning continues through your library.' : update.stage === 'error' ? `Detection unavailable: ${update.message}` : update.stage === 'fingerprint' ? 'Scanning this episode…' : update.stage === 'unavailable' ? `Episode unavailable: ${update.message}. Continuing with other episodes…` : update.stage === 'started' ? (update.mode === 'quick' ? 'Checking opening and ending first…' : 'Checking full episode for more matches…') : `Compared ${update.completed} of ${update.total} season episodes. ${library.markers?.[update.id]?.length || 0} markers available; scanning continues…`;
  renderSegments(); renderTracks();
});
if (!api) { root.innerHTML = '<main class="page"><h1 class="page-title">Open Matro in its desktop app.</h1><p class="page-sub">Run npm start from the project folder.</p></main>'; }
else void attempt(async () => { library = await api.load();
  metadata = library.metadata || {}; metadataEnabled = !!library.metadataEnabled;
  scannerSummary = library.scanner || await api.scannerStatus();
  library.markers ||= {};
  for (const p of Object.values(library.progress)) if (p.completed === undefined) p.completed = p.duration > 0 && p.position >= p.duration - finishMargin(p.duration);
  applyMotion(); renderLibrary(); });
