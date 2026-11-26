import { createSettingsDialog } from './downloads-settings.js';
import { esc, icons, paint, movieCard, showCard, discoveryCard, transferCard, jobCard, movieDetail, seriesDetail, discoveryDetail, setCardPreview, setDetailPreview, upgradePanel } from './downloads-view.js';
import { groupReleases, kinds, previewTitle } from './downloads-discovery.js';
const posterBatch = 24;
const rate = value => value >= 1048576 ? `${(value / 1048576).toFixed(1)} MiB/s` : `${Math.round(value / 1024)} KiB/s`;
const qualityHeight = value => /4k/i.test(value) ? 2160 : +(String(value).match(/(\d{3,4})p/i)?.[1] || 0);
const seedLabel = job => job.seed ? 'Seed after completion' : 'Stop after completion';
const temporaryConnectionError = error => /Could not reach the service|qBittorrent (?:returned|login returned) HTTP (?:408|429|5\d\d)\b/.test(error?.message || '');
function removeChoice(title) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'download-seed-dialog';
    dialog.setAttribute('aria-label', 'Remove download?');
    dialog.innerHTML = `<h2>Remove download?</h2><p>${esc(title)}</p><p>The transfer will stop and disappear from Downloads. Downloaded files stay on disk.</p><div class="show-actions"><button class="pill primary" data-remove-confirm>Remove download</button><button class="pill" data-remove-cancel autofocus>Keep download</button></div>`;
    let confirmed = false;
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-remove-confirm]')) { confirmed = true; dialog.close(); }
      else if (event.target === dialog || event.target.closest('[data-remove-cancel]')) dialog.close();
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(confirmed); }, { once: true });
    document.body.append(dialog); dialog.showModal();
  });
}
const noFilters = () => ({ season: '', episode: '', quality: '' });
function seedChoice(saved) {
  if (typeof saved === 'boolean') return Promise.resolve({ seed: saved, rememberSeed: false });
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'download-seed-dialog';
    dialog.setAttribute('aria-label', 'Seed after downloading?');
    dialog.innerHTML = '<h2>Seed after downloading?</h2><p>Seeding shares the downloaded media with other people.</p><p>Choose No to stop when the download finishes. BitTorrent may still upload while downloading.</p><label><input type="checkbox" id="remember-seeding" checked> Remember my choice</label><div class="show-actions"><button class="pill primary" data-seed="yes">Yes, keep seeding</button><button class="pill" data-seed="no">No, stop when complete</button><button class="text-button" data-seed="cancel">Cancel</button></div>';
    let choice = null;
    dialog.addEventListener('click', event => { const value = event.target.closest('[data-seed]')?.dataset.seed; if (!value) return; choice = value === 'cancel' ? null : { seed: value === 'yes', rememberSeed: dialog.querySelector('input').checked }; dialog.close(); });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(choice); }, { once: true });
    document.body.append(dialog); dialog.showModal();
  });
}

// Phones get the inline "Connect download client" card instead of a modal in front of the page. Keep in step with the phone rules in web.css.
const PHONE = '(max-width:720px), (pointer:coarse) and (max-height:480px)';
export function createDownloadBrowser(api, { play = () => {} } = {}) {
  const hostOnly = api.downloadHostOnly === true;
  const labels = hostOnly ? { server: 'Matro host' } : { local: 'This PC', server: 'Server' };
  const defaults = hostOnly ? { server: 'http://127.0.0.1:8080' } : { local: 'http://127.0.0.1:8080', server: '' };
  let config = { local: null, server: null }, target = localStorage.getItem('download-destination') === 'server' ? 'server' : 'local';
  if (hostOnly) target = 'server';
  let results = null, query = '', searchText = '', message = '', searching = false, requestedMovie = null;
  let container, detail, settings, timer, mountId = 0, searchId = 0, listId = 0, open = null;
  let list = [], jobs = [], listError = '', loaded = false, refreshing = false, upgrade = null, searchOnMount = false;
  let listRetryable = false, connectionFailures = 0, nextRefreshAt = 0;
  const savedKind = localStorage.getItem('download-kind');
  let kind = Object.hasOwn(kinds, savedKind) ? savedKind : 'movie', seriesQuery = '', animeQuery = '', seriesShows = null, seriesSelected = null, seriesData = null, seriesFilters = noFilters();
  const catalogs = Object.fromEntries(Object.keys(kinds).map(key => [key, { mode: 'search', value: '', response: null, pending: false, id: 0, limit: posterBatch, error: '', aliases: [] }]));
  let groups = [], movieSelected = null, groupSelected = null, detailMetadata = null, detailOrigin = null, episodeSeason = '', detailId = 0, seriesId = 0, loadingSeries = false;
  const posters = new Map();
  let previewsDisabled = false;
  const sending = new Set(), sent = new Set(), resolvedSelections = new Map();
  let seasonDownload = null, seasonNotice = '', animeSeason = '1';
  const current = () => container?.isConnected;
  function announce(value) { message = value; const node = container?.querySelector('#download-message'); if (node) node.textContent = value; }
  const roots = () => config[target]?.storage;
  const context = () => ({ target, label: labels[target], configured: !!config[target], sending, sent, upgrade: kind === 'movie' ? upgrade : null, qualityHeight, searching: loadingSeries, seasonDownload, seasonNotice, animeSeason, storage: roots() });
  const addedMovie = movie => movie.torrents.some(item => sent.has(`${target}:${item.hash}`));
  const detailSource = () => open === 'movie' ? movieSelected : open === 'show' ? seriesSelected : open === 'discovery' ? groupSelected : null;
  const detailKind = () => open === 'discovery' ? groupSelected.kind : open;
  function resultButton(root, previous) {
    const selector = ['openMovie', 'openShow', 'openDiscovery', 'discoveryRetry', 'discoveryMore', 'searchAliases', 'resultsPage', 'seriesSource'].find(key => Object.hasOwn(previous.dataset, key));
    return selector ? [...root.querySelectorAll('button')].find(button => !button.disabled && button.dataset[selector] === previous.dataset[selector]) : null;
  }
  function drawDetail({ preserveDrafts = false } = {}) {
    if (!detailSource() || !detail) return;
    const active = detail.contains(document.activeElement) ? document.activeElement : null;
    const form = preserveDrafts && detail.querySelector('#series-filter-form');
    const filters = form ? { ...seriesFilters, ...Object.fromEntries(new FormData(form)) } : seriesFilters;
    const releaseFilters = open === 'discovery' && detail.open ? [...detail.querySelectorAll('[data-release-filter]')].map(input => [input.dataset.releaseFilter, input.value]) : [];
    const markup = open === 'movie' ? movieDetail(movieSelected, context()) : open === 'show' ? seriesDetail(seriesSelected, seriesData, filters, context()) : discoveryDetail(groupSelected, context());
    detail.innerHTML = `${markup}<p class="sr-only" data-detail-status role="status"></p>`;
    applyDetailPreview(); detail.setAttribute('aria-busy', String(loadingSeries));
    for (const [key, value] of releaseFilters) detail.querySelector(`[data-release-filter="${key}"]`).value = value;
    if (releaseFilters.length) filterDiscovery();
    if (!detail.open) detail.showModal();
    else if (active) {
      const replacement = [...detail.querySelectorAll('button, input, select')].find(node => node.tagName === active.tagName &&
        (active.name ? node.name === active.name : active.id ? node.id === active.id : Object.keys(active.dataset).length ?
          Object.entries(active.dataset).every(([key, value]) => node.dataset[key] === value) : node.textContent === active.textContent));
      if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
      else detail.querySelector('#series-filter-form [name="season"], [data-close-detail]')?.focus({ preventScroll: true });
    }
  }
  function applyDetailPreview() {
    if (detailMetadata) setDetailPreview(detail, detailMetadata, detailSource());
    const season = detail.querySelector('[data-preview-season]'); if (season) season.value = episodeSeason;
  }
  function resetDetail() {
    if (seasonDownload?.batch) sent.delete(`${target}:${seasonDownload.batch.id}`);
    seasonDownload = null; seasonNotice = ''; animeSeason = '1';
    open = null; movieSelected = seriesSelected = groupSelected = null; detailMetadata = detailOrigin = null; episodeSeason = '';
    detailId++; seriesId++; loadingSeries = false;
  }
  function closeDetail() { if (detail?.open) detail.close(); }
  const announceDetail = value => { const status = detail?.querySelector('[data-detail-status]'); if (status) status.textContent = value; };
  async function loadDetailPreview(season) {
    if (!api.downloadPreview || previewsDisabled || !detailSource()) return;
    const request = ++detailId, source = detailSource();
    if (season !== undefined) announceDetail('Loading episode names…');
    try {
      const data = await api.downloadPreview({ detail: true, titles: [{ key: 'selected', ...previewTitle(source, detailKind()), ...(season !== undefined ? { season } : {}) }] });
      if (request !== detailId || !detail?.open || detailSource() !== source) return;
      if (data.enabled === false) previewsDisabled = true;
      const metadata = data.results?.[0]?.metadata;
      if (metadata) { detailMetadata = metadata; applyDetailPreview(); }
      if (season !== undefined) announceDetail(metadata?.episodes?.[season] ? 'Episode names loaded.' : 'Episode names are unavailable.');
    } catch { if (request === detailId && detail?.open) announceDetail('TMDB details are unavailable.'); }
  }
  function hydratePosters() {
    if (!api.downloadPreview || previewsDisabled) return;
    const byKey = new Map(), needed = [];
    for (const card of container.querySelectorAll('[data-open-movie], [data-open-show], [data-open-discovery]')) {
      const { openMovie, openShow, openDiscovery } = card.dataset;
      const source = openMovie ? results?.movies.find(movie => String(movie.id) === openMovie) : openShow ? seriesShows?.find(show => String(show.id) === openShow) : groups.find(group => group.key === openDiscovery);
      if (!source) continue;
      const title = previewTitle(source, openMovie ? 'movie' : openShow ? 'show' : source.kind), key = JSON.stringify(title);
      if (!byKey.has(key)) {
        byKey.set(key, []);
        if (!posters.has(key)) needed.push({ title, key });
      }
      byKey.get(key).push(card);
    }
    for (let offset = 0; offset < needed.length; offset += posterBatch) {
      const batch = needed.slice(offset, offset + posterBatch);
      const response = api.downloadPreview({ titles: batch.map(({ title }, index) => ({ ...title, key: String(index) })) })
        .then(result => { if (result.enabled === false) previewsDisabled = true; return result.results || []; }).catch(() => []);
      for (const [index, { key }] of batch.entries()) {
        if (posters.size >= 300) posters.delete(posters.keys().next().value);
        const pending = response.then(rows => rows.find(row => row.key === String(index))?.metadata || null);
        posters.set(key, pending);
        void pending.then(metadata => { if (!metadata && posters.get(key) === pending) posters.delete(key); });
      }
    }
    for (const [key, cards] of byKey) void posters.get(key)?.then(metadata => {
      if (metadata) for (const card of cards) if (current() && container.contains(card)) setCardPreview(card, metadata);
    });
  }
  function drawDiscovery() {
    const node = container.querySelector('#discovery-results'), state = catalogs[kind];
    if (!node) return;
    const standalone = state.mode === 'browse' || kind === 'anime';
    const knownHashes = !standalone && kind === 'movie' ? results?.movies.flatMap(movie => movie.torrents.map(release => release.hash)) : undefined;
    groups = groupReleases(state.response?.results || [], knownHashes);
    const warnings = [...(state.response?.warnings || []), state.error].filter(Boolean);
    const heading = state.mode === 'browse' ? 'Most seeded' : kind === 'anime' ? 'Anime releases' : 'Additional releases';
    const show = standalone || groups.length || warnings.length || state.pending || state.response?.prowlarrEnabled;
    const focused = node.contains(document.activeElement) ? document.activeElement : null;
    node.innerHTML = !show ? '' : `<div class="discovery-heading section-heading"><h3>${heading}</h3>${state.response ? `<span>${plural(groups.length, 'title')}</span>` : ''}</div>
      ${warnings.length ? `<p class="download-error" role="status">${esc(warnings.join(' '))} <button class="text-button" type="button" data-discovery-retry>Retry</button></p>` : ''}
      ${groups.length ? `<div class="grid">${groups.slice(0, state.limit).map(discoveryCard).join('')}</div>` : `<div class="empty-results"><p>${state.pending ? 'Loading releases…' : state.response ? 'No matching releases from these sources.' : 'Search a title or browse the most seeded releases.'}</p></div>`}
      ${groups.length > state.limit ? '<button type="button" class="pill discovery-more" data-discovery-more>Show more titles</button>' : ''}
      ${kind === 'anime' && state.mode === 'search' && state.value && !previewsDisabled ? `<button type="button" class="text-button discovery-alias-retry" data-search-aliases ${state.pending ? 'disabled' : ''}>Try alternate titles</button>` : ''}`;
    node.setAttribute('aria-busy', String(state.pending)); paint(node); hydratePosters();
    if (focused) {
      (resultButton(node, focused) || node.querySelector('[data-open-discovery]') || container.querySelector('#torrent-query'))?.focus({ preventScroll: true });
    }
  }
  function drawResults() {
    const node = container.querySelector('#download-results'), count = container.querySelector('#download-count');
    const focused = node.contains(document.activeElement) ? document.activeElement : null;
    container.querySelector('#download-browse').setAttribute('aria-pressed', String(catalogs[kind].mode === 'browse'));
    if (catalogs[kind].mode === 'browse' || kind === 'anime') {
      count.textContent = ''; node.innerHTML = '';
    } else if (kind === 'show') {
      count.textContent = seriesShows?.length ? `${plural(seriesShows.length, 'series', 'series')} · metadata: TVmaze` : '';
      node.innerHTML = seriesShows === null ? '<div class="empty-results"><h2>Find your next series.</h2><p>Search a show, then choose its season, episode and resolution.</p></div>' : seriesShows.length ? `<div class="grid">${seriesShows.map(showCard).join('')}</div><p class="series-credit dim">Metadata from TVmaze · summaries shortened · <button class="text-button" data-series-source="license">CC BY-SA 4.0</button></p>` : '<div class="empty-results"><h2>No series found.</h2><p>Try another title or spelling, or add a series magnet below.</p></div>';
    } else {
      count.textContent = results ? `${plural(results.total, 'movie')} · page ${results.page} · catalog: YTS` : '';
      node.innerHTML = results ? (results.movies.length ? `<div class="grid">${results.movies.map((movie, index) => movieCard(movie, index, addedMovie(movie))).join('')}</div>` : '<div class="empty-results"><h2>No movies found.</h2><p>Try another title or spelling.</p></div>') + `<div class="show-actions pager"><button class="pill" data-results-page="${results.page - 1}" ${results.page <= 1 || searching ? 'disabled' : ''}>Previous page</button><button class="pill" data-results-page="${results.page + 1}" ${results.page * 20 >= results.total || searching ? 'disabled' : ''}>Next page</button></div>` : '<div class="empty-results"><h2>Find your next movie.</h2><p>Search the catalog, choose a release, and send it to your selected destination.</p></div>';
    }
    node.insertAdjacentHTML('beforeend', '<div id="discovery-results"></div>');
    node.setAttribute('aria-busy', String(searching)); paint(node); drawDiscovery();
    if (focused) (resultButton(node, focused) || node.querySelector('.card') || container.querySelector('#torrent-query'))?.focus({ preventScroll: true });
  }
  function drawList() {
    const section = container.querySelector('#download-activity'), node = container.querySelector('#download-transfers');
    const preparing = jobs.filter(job => !['ready', 'complete'].includes(job.phase));
    const cards = config[target] ? preparing.map(jobCard).concat(listError && !listRetryable ? [] : list.filter(item => !preparing.some(job => job.hash === item.hash)).map(item => transferCard(item, jobs.find(job => job.hash === item.hash), rate, seedLabel))) : [];
    section.hidden = !cards.length && !listError;
    node.innerHTML = cards.join('') + (listError ? `<p class="${listRetryable ? 'note' : 'download-error'}" role="status">${listRetryable ? 'Connection interrupted. Reconnecting automatically…' : esc(listError)}</p>` : '');
    paint(node);
  }
  function drawUpgrade() {
    const node = container?.querySelector('#download-upgrade-panel'); if (!node) return;
    node.innerHTML = upgrade && kind === 'movie' ? upgradePanel(upgrade) : '';
  }
  async function refreshEditions() {
    if (!upgrade) return;
    const id = upgrade.currentId, mount = mountId;
    try { const result = await api.downloadUpgrade(id); if (mount === mountId && current() && upgrade?.currentId === id && JSON.stringify(result) !== JSON.stringify(upgrade)) { upgrade = result; drawUpgrade(); } }
    catch (error) { if (mount === mountId && current()) announce(error.message); }
  }
  async function refresh(force = false) {
    if (!config[target] || !current() || refreshing) return;
    if (!force && Date.now() < nextRefreshAt) return;
    refreshing = true;
    const id = ++listId, destination = target, mount = mountId;
    try {
      const [response, preparation] = await Promise.all([api.downloadList(destination), api.downloadJobs(destination)]);
      if (id !== listId || destination !== target || mount !== mountId || !current()) return;
      list = response; jobs = preparation; listError = '';
      listRetryable = false; connectionFailures = 0; nextRefreshAt = 0;
    } catch (error) {
      if (id !== listId || destination !== target || mount !== mountId || !current()) return;
      listError = error.message;
      listRetryable = temporaryConnectionError(error);
      if (listRetryable) {
        connectionFailures++;
        nextRefreshAt = Date.now() + Math.min(60000, 10000 * 2 ** Math.min(connectionFailures - 1, 3));
      }
    } finally { if (id === listId && mount === mountId) refreshing = false; }
    drawList();
    if (upgrade && jobs.some(job => job.phase === 'complete' && job.sourceId === upgrade.sourceId)) await refreshEditions();
  }
  async function discover(value, aliases = []) {
    if (!api.downloadDiscover) return;
    const tab = kind, state = catalogs[tab], mount = mountId, id = ++state.id;
    const mode = value ? 'search' : 'browse', changedMode = state.mode !== mode;
    if (changedMode) state.response = null;
    Object.assign(state, { mode, value, aliases, pending: true, error: '', limit: posterBatch });
    const standalone = mode === 'browse' || tab === 'anime';
    if (standalone) announce(value ? 'Searching anime releases…' : 'Loading the most seeded releases…');
    if (changedMode) drawResults(); else drawDiscovery();
    try {
      const response = await api.downloadDiscover({ kind: tab, ...(value ? { query: value } : {}), ...(aliases.length ? { aliases } : {}), ...(value && tab === 'movie' ? { additionalOnly: true } : {}) });
      if (mount !== mountId || tab !== kind || id !== state.id || !current()) return;
      state.response = response;
      if (standalone) announce(response.results.length ? `${plural(response.results.length, 'release')} found.` : 'No matching releases found.');
    } catch (error) {
      if (mount !== mountId || tab !== kind || id !== state.id || !current()) return;
      state.error = error.message || 'Could not load releases.';
      if (standalone) announce('Could not load releases.');
    } finally {
      if (mount === mountId && tab === kind && id === state.id && current()) { state.pending = false; drawDiscovery(); }
    }
  }
  const alternateTitles = metadata => [...new Set([metadata?.originalTitle, metadata?.title, ...(metadata?.aliases || [])].filter(Boolean))];
  async function searchAlternates() {
    const state = catalogs.anime, value = state.value, mount = mountId, request = ++state.id;
    if (!value || !api.downloadPreview) return;
    state.pending = true; drawDiscovery(); announce('Looking up alternate anime titles…');
    let aliases = [], unavailable = false;
    try {
      const result = await api.downloadPreview({ detail: true, titles: [{ key: 'alternate-titles', kind: 'anime', title: value }] });
      unavailable = result.enabled === false;
      aliases = alternateTitles(result.results?.[0]?.metadata).filter(title => title.toLowerCase() !== value.toLowerCase());
    } catch { /* The original query can still be edited and submitted. */ }
    if (mount !== mountId || kind !== 'anime' || request !== state.id || !current()) return;
    if (unavailable) previewsDisabled = true;
    if (aliases.length) await discover(value, aliases);
    else { state.pending = false; drawDiscovery(); announce(unavailable ? 'TMDB title previews are unavailable.' : 'No alternate titles found. Try another spelling.'); }
  }
  async function searchSeries(value) {
    searching = true;
    const id = ++searchId, mount = mountId;
    announce('Searching series titles…'); drawResults();
    try {
      const response = await api.downloadSeriesSearch({ query: value });
      if (id !== searchId || mount !== mountId || !current()) return;
      seriesShows = response.shows; announce(`${seriesShows.length} series found. Choose the show to see releases.`);
    } catch (error) { if (id === searchId && mount === mountId && current()) announce(error.message); }
    finally { if (id === searchId && mount === mountId && current()) { searching = false; drawResults(); } }
  }
  async function loadSeries(page = 1) {
    if (!seriesSelected) return;
    if (page === 1) { seasonDownload = null; seasonNotice = ''; }
    loadingSeries = true; const id = ++seriesId, mount = mountId;
    announce('Loading releases for ' + seriesSelected.title + '…'); drawDetail();
    try {
      const response = await api.downloadSeriesReleases({ id: seriesSelected.id, page, ...seriesFilters });
      if (id !== seriesId || mount !== mountId || !current() || !detail?.open) return;
      seriesData = response; announce(`${response.releases.length} matching series releases. Nothing downloads until you select a release.`);
    } catch (error) { if (id === seriesId && mount === mountId && current() && detail?.open) announce(error.message); }
    finally { if (id === seriesId && mount === mountId && current() && detail?.open) { loadingSeries = false; drawDetail({ preserveDrafts: true }); } }
  }
  async function loadSeason(page = 1) {
    const anime = open === 'discovery' && groupSelected?.kind === 'anime';
    const form = detail.querySelector(anime ? '#anime-season-form' : '#series-filter-form');
    if (!form?.reportValidity()) return;
    let options;
    if (anime) {
      animeSeason = form.elements.season.value;
      const animeSelections = [...detail.querySelectorAll('.discovery-release:not([hidden]) [data-selection]')].map(button => button.dataset.selection);
      options = { animeSelections, aliases: alternateTitles(detailMetadata), season: animeSeason };
    } else {
      if (page === 1) seriesFilters = { ...seriesFilters, ...Object.fromEntries(new FormData(form)) };
      if (seriesFilters.season === '' || seriesFilters.episode !== '') {
        seasonDownload = null; seasonNotice = 'Enter a season and leave Episode blank to find a season download.'; drawDetail(); return;
      }
      options = { id: seriesSelected.id, season: seriesFilters.season, quality: seriesFilters.quality, page, seasonDownload: true, ...(seriesFilters.episode !== '' ? { fromEpisode: seriesFilters.episode } : {}) };
    }
    if (page === 1) seasonDownload = null;
    loadingSeries = true;
    const id = ++seriesId, mount = mountId;
    seasonNotice = 'Finding matching season releases…'; drawDetail();
    const active = () => id === seriesId && mount === mountId && current() && detail?.open;
    try {
      const result = await api.downloadSeriesReleases(options);
      if (active()) { seasonDownload = result; seasonNotice = ''; }
    } catch (error) { if (active()) seasonNotice = error.message; }
    finally { if (active()) { loadingSeries = false; drawDetail(); } }
  }
  async function search(page = 1) {
    const input = container.querySelector('#torrent-query'), nextQuery = page === 1 ? input.value.trim() : searchText;
    if (!nextQuery) { input.focus(); return; }
    if (kind === 'anime') return discover(nextQuery);
    if (page === 1) void discover(nextQuery);
    if (kind === 'show') return searchSeries(nextQuery);
    query = input.value; searchText = nextQuery; searching = true;
    const id = ++searchId, mount = mountId;
    announce('Searching the movie catalog…'); drawResults();
    try {
      const response = await api.downloadSearch({ query: nextQuery, page });
      if (id !== searchId || mount !== mountId || !current()) return;
      results = response; announce(`${results.total} ${results.total === 1 ? 'movie' : 'movies'} found.`);
    } catch (error) {
      if (id !== searchId || mount !== mountId || !current()) return;
      announce(error.message);
    } finally {
      if (id === searchId) searching = false;
      if (id === searchId && mount === mountId && current()) drawResults();
    }
  }
  function draw() {
    const titleKind = kinds[kind][1], magnetKind = kind === 'anime' ? 'show' : kind, storage = roots();
    const paths = kind === 'anime' ? [['Movies', storage?.movieRoot], ['Series', storage?.showRoot]].filter(([, value]) => value).map(([name, value]) => `${name} · ${value}`).join(' / ') : storage?.[kind === 'show' ? 'showRoot' : 'movieRoot'];
    container.innerHTML = `<div class="page-head"><div><h1 class="page-title">Downloads</h1><p class="page-sub">Find movies, series, and anime. Choose where they go.</p></div><button class="pill" id="open-download-settings">Download settings</button></div>
      <div class="download-destination"><div class="chip-row" role="group" aria-label="Download to">${Object.entries(labels).map(([id, label]) => `<button class="chip" data-destination="${id}" aria-pressed="${target === id}" aria-label="${label}${config[id] ? '' : ' — not configured'}">${label}</button>`).join('')}</div><span class="path"><span class="status-dot${config[target] ? '' : ' off'}"></span><span class="mono dim">${esc(paths || 'Open Download settings to connect this destination')}</span></span></div>
      <p id="download-message" role="status" aria-live="polite">${esc(message)}</p>${loaded && !config[target] ? `<section class="download-connect" aria-labelledby="download-connect-title"><h2 id="download-connect-title">Connect a download client</h2><p class="muted">Downloads go through qBittorrent on ${esc(labels[target])}. Connect it to add downloads; you can browse and search the catalog first.</p><button class="pill primary" type="button" data-connect>Connect download client</button></section>` : ''}<div id="download-upgrade-panel"></div>
      <section class="section" id="download-activity" hidden><div class="section-heading"><h2>On ${labels[target]}</h2><span><button class="text-button" id="refresh-downloads">Refresh downloads</button></span></div><div class="cw-row" id="download-transfers" aria-live="off"></div></section>
      <div class="download-catalog-controls"><div class="chip-row" role="group" aria-label="Media type">${Object.entries(kinds).map(([key, [label]]) => `<button type="button" class="chip" data-download-kind="${key}" aria-pressed="${kind === key}">${label}</button>`).join('')}</div><button type="button" class="pill small" id="download-browse" aria-pressed="${catalogs[kind].mode === 'browse'}">Most seeded</button></div>
      <form id="torrent-search-form" class="search-hero" role="search"><label for="torrent-query" class="sr-only">Search ${titleKind} torrents</label><div class="search-field">${icons.search}<input id="torrent-query" type="search" maxlength="200" placeholder="Search ${kind === 'anime' ? 'an' : 'a'} ${titleKind} title" value="${esc(kind === 'show' ? seriesQuery : kind === 'anime' ? animeQuery : query)}" required autocomplete="off"><button class="pill small" type="submit">Search</button></div></form>
      ${kind === 'movie' && requestedMovie?.year ? `<p class="note">Requested movie · ${esc(requestedMovie.title)} (${esc(requestedMovie.year)})</p>` : ''}
      <p class="note">${kind === 'show' ? 'Series titles from TVmaze · releases from EZTV and configured sources.' : kind === 'anime' ? 'Releases from Nyaa and configured sources.' : 'Movies from YTS and configured sources.'}</p>
      <section class="section"><div class="section-heading"><h2>Results</h2><span id="download-count"></span></div><div id="download-results"></div></section>
      <details class="download-magnet"><summary>Add ${kind === 'anime' ? 'an' : 'a'} ${titleKind} magnet</summary><form id="download-magnet-form" class="download-fields">${kind === 'anime' ? '<label>Save as<select name="kind"><option value="show">Series</option><option value="movie">Movie</option></select></label>' : `<input type="hidden" name="kind" value="${magnetKind}">`}<label>Title<input name="title" required maxlength="200"></label><label>Year (optional)<input name="year" pattern="[0-9]{4}" maxlength="4"></label>${magnetKind === 'show' ? '<label>Fallback season<input name="season" type="number" min="0" max="99" value="1"></label>' : ''}<label class="download-wide">Magnet link<input name="magnet" required maxlength="20000" placeholder="magnet:?xt=urn:btih:…"></label><button class="pill primary" ${!config[target] ? 'disabled' : ''}>Add selected download</button></form></details>`;
    drawResults(); drawList(); drawUpgrade();
  }
  function chooseTarget(id) { target = id; localStorage.setItem('download-destination', target); listId++; refreshing = false; list = []; jobs = []; listError = ''; listRetryable = false; nextRefreshAt = 0; connectionFailures = 0; draw(); void refresh(); }
  async function sendRelease(button) {
    const destination = target, { release: hash, selection: selectionId, seasonBatch: batchId, seasonPack } = button.dataset, mount = mountId;
    const key = `${destination}:${batchId || hash || selectionId}`, action = button.textContent;
    const source = detailSource();
    const report = value => {
      if (mount !== mountId || !current()) return;
      if ((batchId || seasonPack) && detailSource() === source) {
        seasonNotice = value;
        const status = detail.querySelector('[data-season-notice]');
        if (status) { status.textContent = value; status.hidden = false; }
      }
      announce(value);
    };
    const downloadKind = button.closest('.download-release').querySelector('[data-release-kind]')?.value;
    const upgradeId = kind === 'movie' && upgrade ? upgrade.currentId : undefined;
    if (sending.has(key) || sent.has(key)) return;
    sending.add(key); button.disabled = true; button.textContent = 'Sending…';
    try {
      const choice = await seedChoice(config.seeding); if (!choice || mount !== mountId || !current()) return;
      const release = batchId ? { seasonDownloadId: batchId } : selectionId ? { selectionId, ...(downloadKind ? { downloadKind } : {}) } : { hash };
      const result = await api.downloadAdd({ target: destination, ...release, ...(upgradeId ? { upgradeId } : {}), ...choice }); sent.add(key);
      if (selectionId && !hash && result.hash) {
        const canonical = `${destination}:${result.hash}`;
        resolvedSelections.set(key, canonical); sent.add(canonical);
      }
      if (choice.rememberSeed) config.seeding = choice.seed;
      if (batchId) {
        for (const episodeHash of [...result.queued, ...result.duplicates]) sent.add(`${destination}:${episodeHash}`);
        const duplicates = result.duplicates.length ? ` ${result.duplicates.length} already in Downloads.` : '';
        report(`${plural(result.queued.length, 'episode')} queued on ${labels[destination]}.${duplicates}`);
      } else {
        report(result.queued ? `Already queued on ${labels[destination]}.` : result.duplicate ? `Already in qBittorrent on ${labels[destination]}.` : `Sent to qBittorrent on ${labels[destination]}. Preparing media files before starting.`);
      }
    } catch (error) { report(error.message); }
    finally {
      sending.delete(key);
      if (button.isConnected) { button.disabled = sent.has(key); button.textContent = sent.has(key) ? (batchId ? 'Queued' : 'Added') : action; if (!button.disabled && detail?.open) button.focus(); }
      if (mount === mountId && current() && sent.has(key) && kind === 'movie') {
        for (const card of container.querySelectorAll('[data-open-movie]')) {
          const movie = results?.movies.find(item => String(item.id) === card.dataset.openMovie);
          if (movie && addedMovie(movie) && !card.querySelector('.status-badge')) card.querySelector('.cover').insertAdjacentHTML('beforeend', `<span class="status-badge" title="Added">${icons.check}</span>`);
        }
      }
    }
    if (mount === mountId && destination === target) await refresh();
  }
  async function click(event) {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    const data = button.dataset;
    if (data.removeDownload) {
      const destination = target, hash = data.removeDownload, mount = mountId;
      const title = jobs.find(job => job.hash === hash)?.title || list.find(item => item.hash === hash)?.name || 'This download';
      if (!await removeChoice(title) || mount !== mountId) return;
      button.disabled = true;
      try {
        await api.downloadRemove({ target: destination, hash });
        const canonical = `${destination}:${hash}`;
        sent.delete(canonical);
        for (const [selection, resolved] of resolvedSelections) if (resolved === canonical) {
          sent.delete(selection); resolvedSelections.delete(selection);
        }
        if (mount === mountId && destination === target && current()) {
          list = list.filter(item => item.hash !== hash); jobs = jobs.filter(job => job.hash !== hash);
          announce('Download removed. Files kept on disk.'); drawList(); drawResults();
          await refresh();
        }
      } catch (error) { if (mount === mountId && current()) announce(error.message); }
      finally { if (button.isConnected) button.disabled = false; }
      return;
    }
    if (data.downloadKind) {
      if (data.downloadKind !== kind) {
        catalogs[kind].id++; catalogs[kind].pending = false; searchId++; searching = false;
        kind = data.downloadKind; localStorage.setItem('download-kind', kind);
        announce(''); draw(); container.querySelector(`[data-download-kind="${kind}"]`).focus();
      }
      return;
    }
    if (button.id === 'download-browse') { searchId++; searching = false; await discover(''); return; }
    if (data.discoveryRetry !== undefined) { const state = catalogs[kind]; await discover(state.value, state.aliases); return; }
    if (data.discoveryMore !== undefined) {
      const state = catalogs[kind], next = groups[state.limit];
      state.limit += posterBatch; drawDiscovery();
      [...container.querySelectorAll('[data-open-discovery]')].find(card => card.dataset.openDiscovery === next?.key)?.focus();
      return;
    }
    if (data.searchAliases !== undefined) { await searchAlternates(); return; }
    if (data.previewAliases !== undefined) {
      const value = detailSource().title, aliases = alternateTitles(detailMetadata).filter(title => title.toLowerCase() !== value.toLowerCase());
      closeDetail(); animeQuery = value;
      const input = container.querySelector('#torrent-query'); input.value = value; input.focus();
      await discover(value, aliases); return;
    }
    if (data.destination) { if (data.destination !== target) chooseTarget(data.destination); return; }
    if (data.openMovie) {
      resetDetail(); movieSelected = results?.movies.find(movie => String(movie.id) === data.openMovie);
      if (movieSelected) { open = 'movie'; detailOrigin = button; drawDetail(); void loadDetailPreview(); }
      return;
    }
    if (data.openDiscovery) {
      resetDetail(); groupSelected = groups.find(group => group.key === data.openDiscovery);
      if (groupSelected) { open = 'discovery'; detailOrigin = button; drawDetail(); void loadDetailPreview(); }
      return;
    }
    if (data.openShow) {
      const show = seriesShows?.find(item => String(item.id) === data.openShow);
      if (!show) return;
      resetDetail(); seriesSelected = show; seriesData = null; seriesFilters = noFilters(); open = 'show'; detailOrigin = button;
      if (show.indexed) void loadSeries(); else drawDetail();
      void loadDetailPreview(); return;
    }
    if (data.closeDetail !== undefined) { closeDetail(); return; }
    if (data.seriesSource) { try { await api.downloadSeriesSource(data.seriesSource); } catch (error) { announce(error.message); } return; }
    if (data.seriesQuality !== undefined) { seriesFilters = { ...Object.fromEntries(new FormData(detail.querySelector('#series-filter-form'))), quality: data.seriesQuality }; await loadSeries(); return; }
    if (button.id === 'clear-series-filters') { seriesFilters = noFilters(); await loadSeries(); return; }
    if (button.id === 'find-season-download') { await loadSeason(); return; }
    if (button.id === 'season-more' && seasonDownload?.nextPage) { await loadSeason(seasonDownload.nextPage); return; }
    if (button.id === 'series-more' && seriesData?.nextPage) { await loadSeries(seriesData.nextPage); return; }
    if (button.id === 'open-download-settings' || button.dataset.connect !== undefined) { settings.open(target); return; }
    if (button.id === 'refresh-downloads') { button.disabled = true; await refresh(true); if (button.isConnected) button.disabled = false; return; }
    if (button.id === 'close-upgrade') {
      upgrade = null; results = null; query = searchText = ''; searchId++; searching = false;
      const state = catalogs.movie; state.id++;
      Object.assign(state, { mode: 'search', value: '', response: null, pending: false, error: '', aliases: [] });
      draw(); container.querySelector('#torrent-query').focus(); return;
    }
    if (button.id === 'refresh-editions') { await refreshEditions(); return; }
    if (data.editionPlay) { play(data.editionPlay); return; }
    if (data.editionFavorite) {
      button.disabled = true;
      try { upgrade = await api.downloadFavorite({ sourceId: upgrade.sourceId, id: data.editionFavorite }); drawUpgrade(); announce('Favorite edition saved. Normal playback will use this edition.'); }
      catch (error) { announce(error.message); if (button.isConnected) button.disabled = false; }
      return;
    }
    if (data.retryJob) { try { await api.downloadRetry(data.retryJob); await refresh(); } catch (error) { announce(error.message); } return; }
    if (data.resultsPage) { await search(Number(data.resultsPage)); return; }
    if (data.release || data.selection || data.seasonBatch) await sendRelease(button);
  }
  async function submit(event) {
    event.preventDefault();
    if (event.target.id === 'torrent-search-form') { await search(); return; }
    if (event.target.id === 'series-filter-form') { seriesFilters = { ...seriesFilters, ...Object.fromEntries(new FormData(event.target)) }; await loadSeries(); return; }
    if (event.target.id === 'anime-season-form') { await loadSeason(); return; }
    if (event.target.id === 'download-magnet-form') {
      const values = Object.fromEntries(new FormData(event.target)), destination = target, mount = mountId, button = event.target.querySelector('button');
      button.disabled = true;
      try { const choice = await seedChoice(config.seeding); if (!choice || mount !== mountId) return; await api.downloadAdd({ target: destination, ...values, ...choice }); if (choice.rememberSeed) config.seeding = choice.seed; if (current() && mount === mountId) { announce('Magnet added. Preparing selected media files.'); await refresh(); } }
      catch (error) { if (current() && mount === mountId) announce(error.message); }
      finally { if (button.isConnected) button.disabled = false; }
    }
  }
  const remember = event => {
    if (event.target.id !== 'torrent-query') return;
    if (kind === 'show') seriesQuery = event.target.value;
    else if (kind === 'anime') animeQuery = event.target.value;
    else query = event.target.value;
  };
  function filterDiscovery() {
    const filters = [...detail.querySelectorAll('[data-release-filter]')];
    let visible = 0;
    for (const row of detail.querySelectorAll('.discovery-release')) {
      row.hidden = filters.some(filter => filter.value && row.dataset[filter.dataset.releaseFilter] !== filter.value);
      if (!row.hidden) visible++;
    }
    detail.querySelector('[data-filter-status]').textContent = `${plural(visible, 'matching release')}.`;
    detail.querySelector('[data-no-release-matches]').hidden = visible > 0;
  }
  const changeDetail = event => {
    if (event.target.matches('[data-release-filter]')) { filterDiscovery(); return; }
    if (!event.target.matches('[data-preview-season]')) return;
    episodeSeason = event.target.value;
    if (episodeSeason !== '') void loadDetailPreview(Number(episodeSeason));
    else if (detailMetadata) { detailId++; detailMetadata = { ...detailMetadata, episodes: undefined }; applyDetailPreview(); }
  };
  function prepareMovieSearch(title) {
    kind = 'movie'; localStorage.setItem('download-kind', kind);
    Object.assign(catalogs.movie, { mode: 'search', value: '', response: null, pending: false, error: '', aliases: [] });
    query = title; results = null; message = ''; searchOnMount = true;
  }
  return {
    openMovieSearch(title, year) {
      upgrade = null;
      requestedMovie = { title, year };
      prepareMovieSearch(title);
    },
    async openUpgrade(id) {
      upgrade = await api.downloadUpgrade(id);
      requestedMovie = null;
      prepareMovieSearch(upgrade.title);
    },
    markup: () => '<div id="download-browser" aria-label="Movie, series, and anime downloads"></div>',
    async mount(node) {
      this.unmount(); container = node; const mount = mountId;
      detail = document.createElement('dialog'); detail.id = 'download-detail'; detail.className = 'detail-dialog'; detail.setAttribute('aria-labelledby', 'download-detail-title'); document.body.append(detail);
      detail.addEventListener('close', () => {
        if (detail?.open) return;
        const origin = detailOrigin; resetDetail();
        if (origin && current() && document.activeElement === document.body) {
          (origin.isConnected ? origin : resultButton(container, origin) || container.querySelector('#torrent-query'))?.focus({ preventScroll: true });
        }
      });
      detail.addEventListener('click', event => { if (event.target === detail) closeDetail(); else void click(event); });
      detail.addEventListener('submit', submit);
      detail.addEventListener('change', changeDetail);
      settings = createSettingsDialog({ hostOnly, labels, defaults, getConfig: () => config, configure: values => api.downloadConfigure(values), announce, saved: (next, destination) => { config = next; target = destination; localStorage.setItem('download-destination', target); list = []; jobs = []; listError = ''; listRetryable = false; nextRefreshAt = 0; connectionFailures = 0; if (current()) draw(); void refresh(); } });
      draw(); container.addEventListener('click', click); container.addEventListener('submit', submit); container.addEventListener('input', remember);
      try {
        const initialConfig = await api.downloadConfig();
        if (mount !== mountId || !current()) return;
        config = initialConfig;
        if (!loaded) { if (!config[target]) target = config.local ? 'local' : config.server ? 'server' : target; loaded = true; if (!config[target] && !requestedMovie && !matchMedia(PHONE).matches) settings.open(target); }
        draw();
        if (searchOnMount) { searchOnMount = false; void search(); }
        await refresh();
      } catch (error) { if (mount === mountId && current()) announce(error.message); }
      if (mount !== mountId || !current()) return;
      timer = setInterval(async () => { if (!current()) { clearInterval(timer); return; } if (!document.hidden && (!listError || listRetryable)) await refresh(); }, 5000);
    },
    unmount() {
      clearInterval(timer); mountId++; searchId++; listId++; searching = false; refreshing = false;
      catalogs[kind].id++; catalogs[kind].pending = false; resetDetail();
      document.querySelectorAll('.download-seed-dialog[open]').forEach(dialog => dialog.close());
      detail?.remove(); settings?.destroy(); detail = settings = null;
      if (container) { container.removeEventListener('click', click); container.removeEventListener('submit', submit); container.removeEventListener('input', remember); }
      container = null;
    }
  };
}
function plural(count, word, many = word + 's') { return `${count} ${count === 1 ? word : many}`; }
