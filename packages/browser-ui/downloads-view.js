// Markup for the download browser. Dynamic hues and progress are applied by paint():
// the page's content security policy blocks inline style attributes.
import { episodeLabel, seedText } from './downloads-discovery.js';
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const icons = {
  movie: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M8 5v14M16 5v14"/>'),
  show: svg('<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M8 21h8"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>')
};
export const hueOf = title => { let hue = 0; for (const char of String(title)) hue = (hue * 31 + char.charCodeAt(0)) % 360; return hue; };
export const paint = root => {
  root.querySelectorAll('[data-hue]').forEach(node => node.style.setProperty('--h', node.dataset.hue));
  root.querySelectorAll('[data-p]').forEach(node => { node.style.width = node.dataset.p + '%'; });
};
const variant = index => index % 4 ? ` v${index % 4}` : '';
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const artworkPath = value => /^(?:\/api\/)?artwork\/(?:movie|tv)-\d+-(?:backdrop|poster)\.jpg$/.test(value || '');
function loadPoster(container, src, className) {
  if (!artworkPath(src) || container.querySelector(`.${className}`)?.getAttribute('src') === src) return;
  container.querySelector(`.${className}`)?.remove();
  const image = document.createElement('img');
  image.className = className; image.alt = ''; image.draggable = false; image.hidden = true;
  image.addEventListener('load', () => { image.hidden = false; container.classList.add('has-download-poster'); }, { once: true });
  image.addEventListener('error', () => { image.remove(); container.classList.remove('has-download-poster'); }, { once: true });
  container.prepend(image); image.src = src;
}
export function setCardPreview(card, metadata) {
  card.querySelector('.card-name').textContent = metadata.title;
  const cover = card.querySelector('.cover');
  cover.querySelector('.cover-title').textContent = metadata.title;
  const facts = card.querySelector('.card-meta');
  if (metadata.year && !card.dataset.titleYear) {
    facts.textContent = [metadata.year, facts.textContent].filter(Boolean).join(' · ');
    card.dataset.titleYear = metadata.year;
  }
  loadPoster(cover, metadata.poster, 'download-poster');
}

export function movieCard(movie, index, added) {
  const best = movie.torrents[0]?.quality;
  return `<button class="card download-movie" data-open-movie="${esc(movie.id)}" data-title-year="${esc(movie.year)}"><span class="cover art${variant(index)}" data-hue="${hueOf(movie.title)}" aria-hidden="true">${best ? `<span class="format-badge">${esc(best.toUpperCase())}</span>` : ''}${added ? `<span class="status-badge" title="Added">${icons.check}</span>` : ''}<span class="cover-title">${esc(movie.title)}</span></span><span class="card-name">${esc(movie.title)}</span><span class="card-meta">${esc([movie.year, plural(movie.torrents.length, 'release')].filter(Boolean).join(' · '))}</span></button>`;
}
export function showCard(show, index) {
  return `<button class="card download-series" data-open-show="${esc(show.id)}" data-title-year="${esc(show.year)}"><span class="cover art${variant(index)}" data-hue="${hueOf(show.title)}" aria-hidden="true">${show.indexed ? '' : '<span class="format-badge">NO INDEX</span>'}<span class="cover-title">${esc(show.title)}</span></span><span class="card-name">${esc(show.title)}</span><span class="card-meta">${esc([show.year, show.status, !show.indexed && 'No release index'].filter(Boolean).join(' · '))}</span></button>`;
}
export function discoveryCard(group, index) {
  const best = group.releases[0];
  return `<button class="card download-discovery" data-open-discovery="${esc(group.key)}" data-title-year="${esc(group.year)}"><span class="cover art${variant(index)}" data-hue="${hueOf(group.title)}" aria-hidden="true"><span class="cover-title">${esc(group.title)}</span></span><span class="card-name">${esc(group.title)}</span><span class="card-meta">${esc([group.year, plural(group.releases.length, 'release'), seedText(best.seeds)].filter(Boolean).join(' · '))}</span></button>`;
}
const stateText = item => item.progress >= 1 ? 'Complete' : String(item.state || 'queued');
const banner = item => artworkPath(item?.banner) ? `<img class="xfer-banner" src="${esc(item.banner)}" alt="" draggable="false">` : '';
const removeButton = (hash, title) => `<button type="button" class="xfer-remove" data-remove-download="${esc(hash)}" aria-label="Remove ${esc(title)} from downloads" title="Remove download (keep files)">×</button>`;
export function transferCard(item, job, rate, seedLabel) {
  const percent = Math.round(item.progress * 100), done = ['ready', 'complete'].includes(job?.phase);
  return `<div class="download-transfer xfer art${item.progress >= 1 ? ' done' : ''}" data-hue="${hueOf(item.name)}">${banner(item)}<div class="xfer-state"><b>${esc(stateText(item))}</b><span class="mono">${item.progress < 1 && item.speed ? rate(item.speed) : ''}</span>${removeButton(item.hash, job?.title || item.title || item.name)}</div>
    <div class="xfer-text"><div class="xfer-line"><span class="card-name">${esc(item.name)}</span><span class="card-meta mono">${percent}%</span></div><span class="progress-track" role="progressbar" aria-label="${esc(item.name)} download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span class="progress-fill" data-p="${percent}"></span></span>
    <span class="xfer-path mono">Final: ${esc(job?.finalRoot || item.savePath)}</span>${item.temporaryPath && item.temporaryPath !== item.savePath ? `<span class="xfer-path mono">Temporary: ${esc(item.temporaryPath)}</span>` : ''}${job ? `<span class="xfer-path">${esc(seedLabel(job))}${done ? ` · ${job.selected} media/subtitle files · ${job.skipped} extras skipped` : ''}</span>` : ''}</div></div>`;
}
export function jobCard(job) {
  const code = job.kind === 'show' && job.episode > 0 ? ` · S${String(job.season).padStart(2, '0')}E${String(job.episode).padStart(2, '0')}` : '';
  const title = job.title + code;
  const state = { error: 'Error', reconnecting: 'Reconnecting', queued: 'Queued' }[job.phase] || 'Preparing';
  const note = job.phase === 'reconnecting' ? 'Connection interrupted. Preparation will continue automatically when the server is available.'
    : job.error || (job.phase === 'queued' ? 'Waiting for a season download slot.' : 'Fetching metadata, selecting media and arranging files…');
  return `<div class="download-job xfer art" data-hue="${hueOf(job.title)}">${banner(job)}<div class="xfer-state"><b>${state}</b>${removeButton(job.hash, title)}</div><div class="xfer-text"><div class="xfer-line"><span class="card-name">${esc(title)}</span></div><span class="xfer-path">${esc(note)}</span>${job.phase === 'error' ? `<button class="pill small" data-retry-job="${esc(job.id)}">Retry preparation</button>` : ''}</div></div>`;
}

const dialogHead = (title, year) => `<div class="section-heading"><h2 id="download-detail-title"><span data-preview-title>${esc(title)}</span> <span class="dim year" data-preview-year>${esc(year)}</span></h2><button class="icon-button" data-close-detail aria-label="Close">×</button></div>`;
const previewSlot = (details, overview = '') => `<div class="download-preview" data-preview-detail>${details ? `<p class="dlg-meta">${esc(details)}</p>` : ''}${overview ? `<p class="muted lede">${esc(overview)}</p>` : ''}</div>`;
function seasonPicker(releases) {
  const seasons = [...new Set(releases.filter(release => Number.isInteger(release.season) && release.episode > 0 && !release.pack).map(release => release.season))].sort((a, b) => a - b);
  return seasons.length ? `<label class="download-episode-picker" hidden>Episode names <select data-preview-season><option value="">Choose a season</option>${seasons.map(season => `<option value="${season}">${season === 0 ? 'Specials' : `Season ${season}`}</option>`).join('')}</select></label>` : '';
}
const episodeName = item => Number.isInteger(item.season) && item.episode > 0 && !item.pack ? `<span data-episode-season="${item.season}" data-episode-number="${item.episode}"></span>` : '';
export function setDetailPreview(dialog, metadata, source) {
  dialog.querySelector('[data-preview-title]').textContent = metadata.title;
  dialog.querySelector('[data-preview-year]').textContent = metadata.year || source.year || '';
  const aliases = [...new Set([metadata.originalTitle, ...(metadata.aliases || [])])].filter(title => title && title !== metadata.title);
  const facts = [ ...(metadata.genres || []), metadata.rating != null && `TMDB ${metadata.rating}/10`, metadata.runtime && `${metadata.runtime} min`, metadata.seasonCount && plural(metadata.seasonCount, 'season') ].filter(Boolean);
  const slot = dialog.querySelector('[data-preview-detail]');
  slot.classList.remove('has-download-poster');
  slot.innerHTML = `<div>${facts.length ? `<p class="dlg-meta">${esc(facts.join(' · '))}</p>` : ''}<p class="muted lede">${esc(metadata.overview || source.overview || source.summary || 'No description available.')}</p>${aliases.length ? `<p class="dlg-meta download-aliases">Also known as ${esc(aliases.slice(0, 6).join(' · '))}</p>` : ''}${metadata.cast?.length ? `<p class="dlg-meta">Cast · ${esc(metadata.cast.slice(0, 5).map(person => person.name).join(', '))}</p>` : ''}<p class="dlg-meta download-credit">Metadata${metadata.poster ? ' and artwork' : ''} from TMDB</p></div>`;
  loadPoster(slot, metadata.poster, 'download-detail-poster');
  const aliasButton = dialog.querySelector('[data-preview-aliases]');
  if (aliasButton) aliasButton.hidden = !aliases.length;
  const seasonPicker = dialog.querySelector('.download-episode-picker');
  if (seasonPicker) seasonPicker.hidden = metadata.type !== 'tv';
  for (const node of dialog.querySelectorAll('[data-episode-season]')) {
    const { episodeSeason, episodeNumber } = node.dataset;
    const name = metadata.episodes?.[episodeSeason]?.[episodeNumber]?.name;
    node.textContent = name ? ` · ${name}` : '';
  }
}
function releaseRow({ label, hash, selectionId, batchId, seasonPack, note, extra = '', disabled, text, cls = '', hints = {} }) {
  return `<div class="download-release${cls}"${Object.entries(hints).map(([key, value]) => ` data-${key}="${esc(value)}"`).join('')}><span><strong>${label}${extra}</strong>${note}</span><button class="pill small" ${hash ? `data-release="${esc(hash)}"` : ''}${selectionId ? ` data-selection="${esc(selectionId)}"` : ''}${batchId ? ` data-season-batch="${esc(batchId)}"` : ''}${seasonPack ? ' data-season-pack="true"' : ''} ${disabled ? 'disabled' : ''}>${text}</button></div>`;
}
export function movieDetail(movie, { target, label, configured, sending, sent, upgrade, qualityHeight }) {
  return `${dialogHead(movie.title, movie.year)}${previewSlot(movie.language || 'Language unavailable', movie.overview || 'No description available.')}
    <p class="release-heading">${plural(movie.torrents.length, 'release')} · choose quality</p>${movie.torrents.map(item => {
      const key = `${target}:${item.hash}`, pending = sending.has(key), added = sent.has(key), higher = !upgrade || qualityHeight(item.quality) > upgrade.current.resolution;
      return releaseRow({ label: esc([item.quality, item.type, item.codec].filter(Boolean).join(' · ')), hash: item.hash, note: `<small>${esc(item.size)} · ${item.seeds} seeds · ${item.peers} peers</small>`, extra: upgrade ? `<span class="quality-badge">${higher ? 'Higher resolution' : 'Not higher resolution'}</span>` : '', disabled: !configured || pending || added || !higher, text: pending ? 'Sending…' : added ? 'Added' : upgrade ? `Upgrade on ${label}` : `Download to ${label}` });
    }).join('')}${configured ? '' : '<p class="dim detail-note">Connect this destination in Download settings first.</p>'}`;
}
function seasonResult(data, { target, label, configured, sending, sent, searching }) {
  const { season, pack, batch, expected, coverage, nextPage } = data;
  const code = `Season ${season}`;
  const item = pack || batch;
  const key = `${target}:${pack?.hash || batch?.id}`;
  const row = item ? releaseRow({
    label: `${esc(code)} · ${esc(item.quality)}`, hash: pack?.hash, selectionId: pack?.selectionId, seasonPack: !!pack, batchId: batch?.id,
    note: pack ? `<small>${esc(pack.title)} · ${esc(pack.size)} · ${pack.seeds} seeds</small>` : `<small>${batch.count} episodes from ${esc(batch.group)} · up to two transfers at a time</small>`,
    disabled: !configured || searching || sending.has(key) || sent.has(key),
    text: sending.has(key) ? 'Sending…' : sent.has(key) ? (batch ? 'Queued' : 'Added') : `Download season to ${label}`
  }) : `<p class="dim detail-note">${expected ? `Found ${coverage} of ${expected} listed episodes from a matching release group for ${code}.` : `No numbered episodes are listed for ${code}.`}</p>`;
  return `${row}${nextPage ? `<button type="button" class="text-button" id="season-more" ${searching ? 'disabled' : ''}>Search older releases for this season</button>` : ''}`;
}
const seasonSection = context => `<p class="detail-note" role="status" data-season-notice ${context.seasonNotice ? '' : 'hidden'}>${esc(context.seasonNotice)}</p>${context.seasonDownload ? seasonResult(context.seasonDownload, context) : ''}`;
export function seriesDetail(show, data, filters, context) {
  const { target, label, configured, sending, sent, searching } = context;
  const intro = `${dialogHead(show.title, show.year)}${previewSlot([show.language, show.status, ...(show.genres || [])].filter(Boolean).join(' · '), show.overview || show.summary)}`;
  const credit = `<p class="series-credit dim">Metadata from TVmaze · summaries shortened · <button class="text-button" data-series-source="${esc(show.id)}">TVmaze source</button> <button class="text-button" data-series-source="license">CC BY-SA 4.0</button></p>`;
  if (!show.indexed) return `${intro}<p class="muted detail-note">No release index is available for this series. You can add a series magnet on the Downloads page.</p>${credit}`;
  const qualities = ['480p', '720p', '1080p', '1440p', '2160p'];
  const rows = data ? (data.releases.length ? data.releases.map(item => {
    const key = `${target}:${item.hash}`, code = item.season !== null ? `S${String(item.season).padStart(2, '0')}${item.episode > 0 ? `E${String(item.episode).padStart(2, '0')}` : ' · season pack / unnumbered'}` : 'Episode unnumbered';
    return releaseRow({ label: `${esc(code)}${episodeName(item)} · ${esc(item.quality)} ${esc(item.codec)}`, hash: item.hash, note: `<small class="series-release-title">${esc(item.title)}</small><small>${esc(item.size)} · ${item.seeds} seeds · ${item.peers} peers</small>`, cls: ' series-release', disabled: !configured || sending.has(key) || sent.has(key) || searching, text: sent.has(key) ? 'Added' : sending.has(key) ? 'Sending…' : `Download to ${label}` });
  }).join('') : '<p class="muted detail-note">No matching releases on the scanned pages. Try More releases or relax the filters.</p>') : `<p class="muted detail-note">${searching ? 'Loading series releases…' : 'Could not load releases. Retry with Apply series filters.'}</p>`;
  return `${intro}
    <form id="series-filter-form" class="series-filters"><div class="fields"><label class="field">Season<input name="season" type="number" min="0" max="99" placeholder="All" value="${esc(filters.season)}"></label><label class="field">Episode<input name="episode" type="number" min="0" max="999" placeholder="All" value="${esc(filters.episode)}"></label></div>
      <div class="chip-row" role="group" aria-label="Resolution"><button type="button" class="chip" data-series-quality="" aria-pressed="${!filters.quality}">All resolutions</button>${qualities.map(value => `<button type="button" class="chip" data-series-quality="${value}" aria-pressed="${filters.quality === value}">${value}</button>`).join('')}</div>
      <div class="show-actions"><button class="pill primary small" ${searching ? 'disabled' : ''}>Apply series filters</button><button type="button" class="pill small" id="find-season-download" ${searching ? 'disabled' : ''}>Find season download</button><button class="text-button" id="clear-series-filters" type="button" ${searching ? 'disabled' : ''}>Clear filters</button></div></form>
    ${seasonSection(context)}
    ${data ? `<p class="dim detail-note">${data.releases.length} matching releases from EZTV page${data.lastPage !== data.page ? `s ${data.page}–${data.lastPage}` : ` ${data.page}`} · ${data.total} releases indexed for this show. Use More releases for older results.</p>${seasonPicker(data.releases)}` : ''}${rows}
    <div class="show-actions"><button class="pill" id="series-more" ${data?.nextPage && !searching ? '' : 'disabled'}>More releases</button></div>
    ${credit}`;
}
function animeFilters(releases) {
  const filters = [['quality', 'Resolution', 'Any resolution'], ['audio', 'Audio hint', 'Any audio'], ['subtitles', 'Subtitle hint', 'Any subtitles']];
  const hints = { quality: releases.map(item => item.quality === 'Unknown' ? '' : item.quality), audio: releases.map(item => item.audioHint), subtitles: releases.map(item => item.subtitleHint) };
  const inputs = filters.map(([field, label, any]) => {
    const values = [...new Set(hints[field].filter(Boolean))].sort();
    return values.length ? `<label>${label}<select data-release-filter="${field}"><option value="">${any}</option>${values.map(value => `<option>${esc(value)}</option>`).join('')}</select></label>` : '';
  }).join('');
  return inputs ? `<div class="anime-release-filters" role="group" aria-label="Filter anime releases">${inputs}</div><p class="sr-only" data-filter-status role="status"></p>` : '';
}
export function discoveryDetail(group, context) {
  const { target, label, configured, sending, sent, upgrade, qualityHeight, storage } = context;
  const animeSeason = group.kind === 'anime' && group.releases.some(item => item.downloadKind === 'show')
    ? `<form id="anime-season-form" class="series-filters"><label>Season <input name="season" type="number" min="1" max="99" required value="${esc(context.animeSeason)}"></label><div class="show-actions"><button class="pill small" ${context.searching ? 'disabled' : ''}>Find season download</button></div></form>${seasonSection(context)}` : '';
  const rows = group.releases.map(item => {
    const key = `${target}:${item.hash || item.selectionId}`, pending = sending.has(key), added = sent.has(key);
    const higher = !upgrade || qualityHeight(item.quality) > upgrade.current.resolution;
    const hints = [item.audioHint, item.subtitleHint].filter(Boolean);
    const destination = `<small class="release-destination" title="${esc(storage?.[item.downloadKind === 'movie' ? 'movieRoot' : 'showRoot'])}">${item.downloadKind === 'movie' ? 'Movie folder' : 'Series folder'}</small>`;
    const choose = item.canChooseDownloadKind ? `<label class="download-release-kind">Save as <select data-release-kind><option value="show">Series</option><option value="movie">Movie</option></select></label>` : destination;
    return releaseRow({ label: esc([episodeLabel(item), item.quality === 'Unknown' ? 'Resolution unknown' : item.quality].filter(Boolean).join(' · ')),
      extra: episodeName(item), hash: item.hash, selectionId: item.selectionId, cls: ' discovery-release',
      note: `<small class="series-release-title">${esc(item.releaseTitle)}</small><small>${esc([item.provider, item.size, seedText(item.seeds), item.peers == null ? '' : plural(item.peers, 'peer')].filter(Boolean).join(' · '))}</small>${hints.length ? `<small>${esc(hints.join(' · '))} (release label, unverified)</small>` : ''}${choose}`,
      hints: { quality: item.quality, audio: item.audioHint, subtitles: item.subtitleHint },
      disabled: !configured || pending || added || !higher, text: pending ? 'Sending…' : added ? 'Added' : upgrade ? `Upgrade on ${label}` : `Download to ${label}`,
    });
  }).join('');
  return `${dialogHead(group.title, group.year)}${previewSlot('')}${group.kind === 'anime' ? '<button class="text-button" data-preview-aliases hidden>Search with alternate titles</button>' : ''}
    <p class="release-heading">${plural(group.releases.length, 'release')} · most seeded first</p>${group.kind === 'anime' ? animeFilters(group.releases) : ''}${animeSeason}${seasonPicker(group.releases)}${rows}<p class="muted detail-note" data-no-release-matches hidden>No releases match these filters.</p>${configured ? '' : '<p class="dim detail-note">Connect this destination in Download settings first.</p>'}`;
}
export function upgradePanel(upgrade) {
  return `<section class="download-comparison"><div class="section-heading"><h2>${esc(upgrade.title)} · compare editions</h2><button id="close-upgrade" class="text-button">Browse all movies</button></div><p class="note">Your current edition is ${upgrade.current.width} × ${upgrade.current.height}. Only higher-resolution releases are enabled below. The previous file is kept; higher resolution alone does not guarantee a better encode.</p><div class="edition-grid">${upgrade.editions.map(item => `<article class="edition-card"><h3>${esc(item.name || 'Unavailable edition')}${item.favorite ? ' · Favorite' : ''}</h3>${item.error ? `<p class="download-error">${esc(item.error)}</p>` : `<dl><dt>Resolution</dt><dd>${item.width} × ${item.height}</dd><dt>Codec</dt><dd>${esc(item.codec)}</dd><dt>File size</dt><dd>${(item.size / 1073741824).toFixed(2)} GiB</dd><dt>Average data rate</dt><dd>${(item.size * 8 / item.duration / 1000000).toFixed(1)} Mb/s</dd></dl><div class="show-actions"><button class="pill small" data-edition-play="${item.id}">Play this edition</button><button class="pill small" data-edition-favorite="${item.id}" ${item.favorite ? 'disabled' : ''}>${item.favorite ? 'Saved favorite' : 'Make favorite'}</button></div>`}</article>`).join('')}</div><button class="text-button" id="refresh-editions">Refresh editions</button></section>`;
}
