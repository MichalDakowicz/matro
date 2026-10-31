import { createSettingsDialog } from './downloads-settings.js';
import { esc, icons, paint, movieCard, showCard, transferCard, jobCard, movieDetail, seriesDetail, upgradePanel } from './downloads-view.js';
const labels = { local: 'This PC', server: 'Server' };
const defaults = { local: 'http://127.0.0.1:8080', server: '' };
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

export function createDownloadBrowser(api, { play = () => {} } = {}) {
  let config = { local: null, server: null }, target = localStorage.getItem('download-destination') === 'server' ? 'server' : 'local';
  let results = null, query = '', searchText = '', message = '', searching = false;
  let container, detail, settings, timer, mountId = 0, searchId = 0, listId = 0, open = null;
  let list = [], jobs = [], listError = '', loaded = false, refreshing = false, upgrade = null, searchOnMount = false;
  let listRetryable = false, connectionFailures = 0, nextRefreshAt = 0;
  let kind = localStorage.getItem('download-kind') === 'show' ? 'show' : 'movie', seriesQuery = '', seriesShows = null, seriesSelected = null, seriesData = null, seriesFilters = noFilters();
  const sending = new Set(), sent = new Set();
  const current = () => container?.isConnected;
  function announce(value) { message = value; const node = container?.querySelector('#download-message'); if (node) node.textContent = value; }
  const roots = () => config[target]?.storage;
  const context = () => ({ target, label: labels[target], configured: !!config[target], sending, sent, upgrade: kind === 'movie' ? upgrade : null, qualityHeight, searching });
  const addedMovie = movie => movie.torrents.some(item => sent.has(`${target}:${item.hash}`));
  function drawDetail() {
    if (!open || !detail) return;
    detail.innerHTML = open === 'movie' ? movieDetail(results.movies.find(movie => movie.id === detail.dataset.id), context()) : seriesDetail(seriesSelected, seriesData, seriesFilters, context());
    paint(detail); detail.setAttribute('aria-busy', String(searching));
    if (!detail.open) detail.showModal();
  }
  function closeDetail() { open = null; if (detail?.open) detail.close(); }
  function drawResults() {
    const node = container.querySelector('#download-results'), count = container.querySelector('#download-count');
    if (kind === 'show') {
      count.textContent = seriesShows?.length ? `${plural(seriesShows.length, 'series', 'series')} · metadata: TVmaze` : '';
      node.innerHTML = seriesShows === null ? '<div class="empty-results"><h2>Find your next series.</h2><p>Search a show, then choose its season, episode and resolution.</p></div>' : seriesShows.length ? `<div class="grid">${seriesShows.map(showCard).join('')}</div><p class="series-credit dim">Metadata from TVmaze · summaries shortened · <button class="text-button" data-series-source="license">CC BY-SA 4.0</button></p>` : '<div class="empty-results"><h2>No series found.</h2><p>Try another title or spelling, or add a series magnet below.</p></div>';
    } else {
      count.textContent = results ? `${plural(results.total, 'movie')} · page ${results.page} · catalog: YTS` : '';
      node.innerHTML = results ? (results.movies.length ? `<div class="grid">${results.movies.map((movie, index) => movieCard(movie, index, addedMovie(movie))).join('')}</div>` : '<div class="empty-results"><h2>No movies found.</h2><p>Try another title or spelling.</p></div>') + `<div class="show-actions pager"><button class="pill" data-results-page="${results.page - 1}" ${results.page <= 1 || searching ? 'disabled' : ''}>Previous page</button><button class="pill" data-results-page="${results.page + 1}" ${results.page * 20 >= results.total || searching ? 'disabled' : ''}>Next page</button></div>` : '<div class="empty-results"><h2>Find your next movie.</h2><p>Search the catalog, choose a release, and send it to your selected destination.</p></div>';
    }
    node.setAttribute('aria-busy', String(searching)); paint(node);
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
  async function searchSeries() {
    const value = container.querySelector('#torrent-query').value.trim();
    if (!value) return;
    seriesQuery = value; searching = true; seriesSelected = null; seriesData = null;
    const id = ++searchId, mount = mountId;
    announce('Searching series titles…'); drawResults();
    try {
      const response = await api.downloadSeriesSearch({ query: value });
      if (id !== searchId || mount !== mountId || !current()) return;
      seriesShows = response.shows; announce(`${seriesShows.length} series found. Choose the show to see releases.`);
    } catch (error) { if (id === searchId && mount === mountId && current()) { seriesShows = []; announce(error.message); } }
    finally { if (id === searchId && mount === mountId && current()) { searching = false; drawResults(); } }
  }
  async function loadSeries(page = 1) {
    if (!seriesSelected) return;
    searching = true; const id = ++searchId, mount = mountId;
    announce('Loading releases for ' + seriesSelected.title + '…'); drawDetail();
    try {
      const response = await api.downloadSeriesReleases({ id: seriesSelected.id, page, ...seriesFilters });
      if (id !== searchId || mount !== mountId || !current()) return;
      seriesData = response; announce(`${response.releases.length} matching series releases. Nothing downloads until you select a release.`);
    } catch (error) { if (id === searchId && mount === mountId && current()) { seriesData = null; announce(error.message); } }
    finally { if (id === searchId && mount === mountId && current()) { searching = false; drawDetail(); } }
  }
  async function search(page = 1) {
    if (kind === 'show') return searchSeries();
    const input = container.querySelector('#torrent-query'), nextQuery = page === 1 ? input.value.trim() : searchText;
    if (!nextQuery) { input.focus(); return; }
    query = input.value; searchText = nextQuery; searching = true;
    const id = ++searchId, mount = mountId;
    announce('Searching the movie catalog…'); drawResults();
    try {
      const response = await api.downloadSearch({ query: nextQuery, page });
      if (id !== searchId || mount !== mountId || !current()) return;
      results = response; announce(`${results.total} ${results.total === 1 ? 'movie' : 'movies'} found.`);
    } catch (error) {
      if (id !== searchId || mount !== mountId || !current()) return;
      results = null; announce(error.message);
    } finally {
      if (id === searchId) searching = false;
      if (id === searchId && mount === mountId && current()) drawResults();
    }
  }
  const other = () => kind === 'movie' ? 'series' : 'movies';
  function draw() {
    container.innerHTML = `<div class="page-head"><div><h1 class="page-title">Downloads</h1><p class="page-sub">Find movies or series. Choose where they go.</p></div><button class="pill" id="open-download-settings">Download settings</button></div>
      <div class="download-destination"><div class="chip-row" role="group" aria-label="Download to">${Object.entries(labels).map(([id, label]) => `<button class="chip" data-destination="${id}" aria-pressed="${target === id}" aria-label="${label}${config[id] ? '' : ' — not configured'}">${label}</button>`).join('')}</div><span class="path"><span class="status-dot${config[target] ? '' : ' off'}"></span><span class="mono dim">${esc(roots()?.[kind === 'show' ? 'showRoot' : 'movieRoot'] || 'Open Download settings to connect this destination')}</span></span></div>
      <p id="download-message" role="status" aria-live="polite">${esc(message)}</p><div id="download-upgrade-panel"></div>
      <section class="section" id="download-activity" hidden><div class="section-heading"><h2>On ${labels[target]}</h2><span><button class="text-button" id="refresh-downloads">Refresh downloads</button></span></div><div class="cw-row" id="download-transfers" aria-live="off"></div></section>
      <form id="torrent-search-form" class="search-hero" role="search"><label for="torrent-query" class="sr-only">${kind === 'show' ? 'Search series torrents' : 'Search movie torrents'}</label><div class="search-field">${icons.search}<input id="torrent-query" type="search" maxlength="200" placeholder="${kind === 'show' ? 'Search a series title' : 'Search a movie title'}" value="${esc(kind === 'show' ? seriesQuery : query)}" required autocomplete="off"><button class="kind-toggle" id="download-kind" type="button" aria-label="Searching ${kind === 'show' ? 'series' : 'movies'}. Switch to ${other()}" title="Searching ${kind === 'show' ? 'series' : 'movies'}. Press to search ${other()}">${icons[kind]}</button></div></form>
      <p class="note">${kind === 'show' ? 'Search submits the title to TVmaze. Choosing a series loads release information from EZTV.' : 'Submitting a search sends the title to YTS.'} A download starts only when you choose a release and click Download.</p>
      <section class="section"><div class="section-heading"><h2>Results</h2><span id="download-count"></span></div><div id="download-results"></div></section>
      <details class="download-magnet"><summary>${kind === 'show' ? 'Add a series magnet' : 'Add a movie magnet'}</summary><form id="download-magnet-form" class="download-fields"><input type="hidden" name="kind" value="${kind}"><label>Title<input name="title" required maxlength="200"></label><label>Year (optional)<input name="year" pattern="[0-9]{4}" maxlength="4"></label>${kind === 'show' ? '<label>Fallback season<input name="season" type="number" min="0" max="99" value="1"></label>' : ''}<label class="download-wide">Magnet link<input name="magnet" required maxlength="20000" placeholder="magnet:?xt=urn:btih:…"></label><button class="pill primary" ${!config[target] ? 'disabled' : ''}>Add selected download</button></form></details>`;
    drawResults(); drawList(); drawUpgrade();
  }
  function chooseTarget(id) { target = id; localStorage.setItem('download-destination', target); listId++; refreshing = false; list = []; jobs = []; listError = ''; listRetryable = false; nextRefreshAt = 0; connectionFailures = 0; draw(); void refresh(); }
  async function sendRelease(button) {
    const destination = target, key = `${destination}:${button.dataset.release}`, mount = mountId;
    if (sending.has(key) || sent.has(key)) return;
    sending.add(key); button.disabled = true; button.textContent = 'Sending…';
    try {
      const choice = await seedChoice(config.seeding); if (!choice || mount !== mountId || !current()) return;
      const result = await api.downloadAdd({ target: destination, hash: button.dataset.release, ...(kind === 'movie' && upgrade ? { upgradeId: upgrade.currentId } : {}), ...choice }); sent.add(key);
      if (choice.rememberSeed) config.seeding = choice.seed;
      if (mount === mountId && current()) announce(result.duplicate ? `Already in qBittorrent on ${labels[destination]}.` : `Sent to qBittorrent on ${labels[destination]}. Preparing media files before starting.`);
    } catch (error) { if (mount === mountId && current()) announce(error.message); }
    finally { sending.delete(key); if (mount === mountId && current()) { drawDetail(); drawResults(); } }
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
        sent.delete(`${destination}:${hash}`);
        if (mount === mountId && destination === target && current()) {
          list = list.filter(item => item.hash !== hash); jobs = jobs.filter(job => job.hash !== hash);
          announce('Download removed. Files kept on disk.'); drawList(); drawResults();
          await refresh();
        }
      } catch (error) { if (mount === mountId && current()) announce(error.message); }
      finally { if (button.isConnected) button.disabled = false; }
      return;
    }
    if (button.id === 'download-kind') { kind = kind === 'movie' ? 'show' : 'movie'; localStorage.setItem('download-kind', kind); searchId++; searching = false; announce(''); draw(); container.querySelector('#torrent-query').focus(); return; }
    if (data.destination) { if (data.destination !== target) chooseTarget(data.destination); return; }
    if (data.openMovie) { open = 'movie'; detail.dataset.id = data.openMovie; drawDetail(); return; }
    if (data.openShow) {
      const show = seriesShows.find(item => item.id === data.openShow);
      if (!show.indexed) { announce('This series has no release index. You can still add a series magnet below.'); return; }
      seriesSelected = show; seriesData = null; seriesFilters = noFilters(); open = 'show'; await loadSeries(); return;
    }
    if (data.closeDetail !== undefined) { closeDetail(); return; }
    if (data.seriesSource) { try { await api.downloadSeriesSource(data.seriesSource); } catch (error) { announce(error.message); } return; }
    if (data.seriesQuality !== undefined) { seriesFilters = { ...Object.fromEntries(new FormData(detail.querySelector('#series-filter-form'))), quality: data.seriesQuality }; await loadSeries(); return; }
    if (button.id === 'clear-series-filters') { seriesFilters = noFilters(); await loadSeries(); return; }
    if (button.id === 'series-more' && seriesData?.nextPage) { await loadSeries(seriesData.nextPage); return; }
    if (button.id === 'open-download-settings') { settings.open(target); return; }
    if (button.id === 'refresh-downloads') { button.disabled = true; await refresh(true); if (button.isConnected) button.disabled = false; return; }
    if (button.id === 'close-upgrade') { upgrade = null; results = null; query = ''; draw(); return; }
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
    if (data.release) await sendRelease(button);
  }
  async function submit(event) {
    event.preventDefault();
    if (event.target.id === 'torrent-search-form') { await search(); return; }
    if (event.target.id === 'series-filter-form') { seriesFilters = { ...seriesFilters, ...Object.fromEntries(new FormData(event.target)) }; await loadSeries(); return; }
    if (event.target.id === 'download-magnet-form') {
      const values = Object.fromEntries(new FormData(event.target)), destination = target, mount = mountId, button = event.target.querySelector('button');
      button.disabled = true;
      try { const choice = await seedChoice(config.seeding); if (!choice || mount !== mountId) return; await api.downloadAdd({ target: destination, ...values, ...choice }); if (choice.rememberSeed) config.seeding = choice.seed; if (current() && mount === mountId) { announce('Magnet added. Preparing selected media files.'); await refresh(); } }
      catch (error) { if (current() && mount === mountId) announce(error.message); }
      finally { if (button.isConnected) button.disabled = false; }
    }
  }
  const remember = event => { if (event.target.id === 'torrent-query') { if (kind === 'show') seriesQuery = event.target.value; else query = event.target.value; } };
  return {
    async openUpgrade(id) { upgrade = await api.downloadUpgrade(id); kind = 'movie'; localStorage.setItem('download-kind', kind); query = upgrade.title; results = null; searchOnMount = true; },
    markup: () => '<div id="download-browser" aria-label="Movie and series downloads"></div>',
    async mount(node) {
      this.unmount(); container = node; const mount = mountId;
      detail = document.createElement('dialog'); detail.id = 'download-detail'; detail.className = 'detail-dialog'; detail.setAttribute('aria-labelledby', 'download-detail-title'); document.body.append(detail);
      detail.addEventListener('close', () => { if (open === 'show') { searchId++; searching = false; seriesSelected = null; } open = null; });
      detail.addEventListener('click', event => { if (event.target === detail) closeDetail(); else void click(event); });
      detail.addEventListener('submit', submit);
      settings = createSettingsDialog({ labels, defaults, getConfig: () => config, configure: values => api.downloadConfigure(values), announce, saved: (next, destination) => { config = next; target = destination; localStorage.setItem('download-destination', target); list = []; jobs = []; listError = ''; listRetryable = false; nextRefreshAt = 0; connectionFailures = 0; if (current()) draw(); void refresh(); } });
      draw(); container.addEventListener('click', click); container.addEventListener('submit', submit); container.addEventListener('input', remember);
      try {
        config = await api.downloadConfig();
        if (mount !== mountId || !current()) return;
        if (!loaded) { if (!config[target]) target = config.local ? 'local' : config.server ? 'server' : target; loaded = true; if (!config[target]) settings.open(target); }
        draw(); await refresh(); if (searchOnMount) { searchOnMount = false; await search(); }
      } catch (error) { if (mount === mountId && current()) announce(error.message); }
      if (mount !== mountId || !current()) return;
      timer = setInterval(async () => { if (!current()) { clearInterval(timer); return; } if (!document.hidden && (!listError || listRetryable)) await refresh(); }, 5000);
    },
    unmount() {
      clearInterval(timer); mountId++; searchId++; listId++; searching = false; refreshing = false; open = null;
      document.querySelectorAll('.download-seed-dialog[open]').forEach(dialog => dialog.close());
      detail?.remove(); settings?.destroy(); detail = settings = null;
      if (container) { container.removeEventListener('click', click); container.removeEventListener('submit', submit); container.removeEventListener('input', remember); }
      container = null;
    }
  };
}
function plural(count, word, many = word + 's') { return `${count} ${count === 1 ? word : many}`; }
