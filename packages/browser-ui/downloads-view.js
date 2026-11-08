// Markup for the download browser. Dynamic hues and progress are applied by paint():
// the page's content security policy blocks inline style attributes.
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

export function movieCard(movie, index, added) {
  const best = movie.torrents[0]?.quality;
  return `<button class="card download-movie" data-open-movie="${esc(movie.id)}"><span class="cover art${variant(index)}" data-hue="${hueOf(movie.title)}">${best ? `<span class="format-badge">${esc(best.toUpperCase())}</span>` : ''}${added ? `<span class="status-badge" title="Added">${icons.check}</span>` : ''}<span class="cover-title">${esc(movie.title)}</span></span><span class="card-name">${esc(movie.title)}</span><span class="card-meta">${esc([movie.year, plural(movie.torrents.length, 'release')].filter(Boolean).join(' · '))}</span></button>`;
}
export function showCard(show, index) {
  return `<button class="card download-series" data-open-show="${esc(show.id)}"><span class="cover art${variant(index)}" data-hue="${hueOf(show.title)}">${show.indexed ? '' : '<span class="format-badge">NO INDEX</span>'}<span class="cover-title">${esc(show.title)}</span></span><span class="card-name">${esc(show.title)}</span><span class="card-meta">${esc([show.year, show.status].filter(Boolean).join(' · '))}</span></button>`;
}
const stateText = item => item.progress >= 1 ? 'Complete' : String(item.state || 'queued');
const banner = item => /^(?:\/api\/)?artwork\/(?:movie|tv)-\d+-(?:backdrop|poster)\.jpg$/.test(item?.banner || '') ? `<img class="xfer-banner" src="${esc(item.banner)}" alt="" draggable="false">` : '';
const removeButton = (hash, title) => `<button type="button" class="xfer-remove" data-remove-download="${esc(hash)}" aria-label="Remove ${esc(title)} from downloads" title="Remove download (keep files)">×</button>`;
export function transferCard(item, job, rate, seedLabel) {
  const percent = Math.round(item.progress * 100), done = ['ready', 'complete'].includes(job?.phase);
  return `<div class="download-transfer xfer art${item.progress >= 1 ? ' done' : ''}" data-hue="${hueOf(item.name)}">${banner(item)}<div class="xfer-state"><b>${esc(stateText(item))}</b><span class="mono">${item.progress < 1 && item.speed ? rate(item.speed) : ''}</span>${removeButton(item.hash, job?.title || item.title || item.name)}</div>
    <div class="xfer-text"><div class="xfer-line"><span class="card-name">${esc(item.name)}</span><span class="card-meta mono">${percent}%</span></div><span class="progress-track" role="progressbar" aria-label="${esc(item.name)} download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span class="progress-fill" data-p="${percent}"></span></span>
    <span class="xfer-path mono">Final: ${esc(job?.finalRoot || item.savePath)}</span>${item.temporaryPath && item.temporaryPath !== item.savePath ? `<span class="xfer-path mono">Temporary: ${esc(item.temporaryPath)}</span>` : ''}${job ? `<span class="xfer-path">${esc(seedLabel(job))}${done ? ` · ${job.selected} media/subtitle files · ${job.skipped} extras skipped` : ''}</span>` : ''}</div></div>`;
}
export const jobCard = job => `<div class="download-job xfer art" data-hue="${hueOf(job.title)}">${banner(job)}<div class="xfer-state"><b>${job.phase === 'error' ? 'Error' : job.phase === 'reconnecting' ? 'Reconnecting' : 'Preparing'}</b>${removeButton(job.hash, job.title)}</div><div class="xfer-text"><div class="xfer-line"><span class="card-name">${esc(job.title)}</span></div><span class="xfer-path">${job.phase === 'error' ? esc(job.error) : job.phase === 'reconnecting' ? 'Connection interrupted. Preparation will continue automatically when the server is available.' : 'Fetching metadata, selecting media and arranging files…'}</span>${job.phase === 'error' ? `<button class="pill small" data-retry-job="${esc(job.id)}">Retry preparation</button>` : ''}</div></div>`;

const dialogHead = (title, year, id = 'download-detail-title') => `<div class="section-heading"><h2 id="${id}">${esc(title)} <span class="dim year">${esc(year)}</span></h2><button class="icon-button" data-close-detail aria-label="Close">×</button></div>`;
function releaseRow({ label, hash, note, extra = '', disabled, text, cls = '' }) {
  return `<div class="download-release${cls}"><span><strong>${label}${extra}</strong>${note}</span><button class="pill small" data-release="${hash}" ${disabled ? 'disabled' : ''}>${text}</button></div>`;
}
export function movieDetail(movie, { target, label, configured, sending, sent, upgrade, qualityHeight }) {
  return `${dialogHead(movie.title, movie.year)}<p class="dlg-meta">${esc(movie.language || 'Language unavailable')}</p><p class="muted lede">${esc(movie.overview || 'No description available.')}</p>
    <p class="release-heading">${plural(movie.torrents.length, 'release')} · choose quality</p>${movie.torrents.map(item => {
      const key = `${target}:${item.hash}`, pending = sending.has(key), added = sent.has(key), higher = !upgrade || qualityHeight(item.quality) > upgrade.current.resolution;
      return releaseRow({ label: esc([item.quality, item.type, item.codec].filter(Boolean).join(' · ')), hash: item.hash, note: `<small>${esc(item.size)} · ${item.seeds} seeds · ${item.peers} peers</small>`, extra: upgrade ? `<span class="quality-badge">${higher ? 'Higher resolution' : 'Not higher resolution'}</span>` : '', disabled: !configured || pending || added || !higher, text: pending ? 'Sending…' : added ? 'Added' : upgrade ? `Upgrade on ${label}` : `Download to ${label}` });
    }).join('')}${configured ? '' : '<p class="dim detail-note">Connect this destination in Download settings first.</p>'}`;
}
export function seriesDetail(show, data, filters, { target, label, configured, sending, sent, searching }) {
  const qualities = ['480p', '720p', '1080p', '1440p', '2160p'];
  const rows = data ? (data.releases.length ? data.releases.map(item => {
    const key = `${target}:${item.hash}`, code = item.season !== null ? `S${String(item.season).padStart(2, '0')}${item.episode > 0 ? `E${String(item.episode).padStart(2, '0')}` : ' · season pack / unnumbered'}` : 'Episode unnumbered';
    return releaseRow({ label: `${esc(code)} · ${esc(item.quality)} ${esc(item.codec)}`, hash: item.hash, note: `<small class="series-release-title">${esc(item.title)}</small><small>${esc(item.size)} · ${item.seeds} seeds · ${item.peers} peers</small>`, cls: ' series-release', disabled: !configured || sending.has(key) || sent.has(key) || searching, text: sent.has(key) ? 'Added' : sending.has(key) ? 'Sending…' : `Download to ${label}` });
  }).join('') : '<p class="muted detail-note">No matching releases on the scanned pages. Try More releases or relax the filters.</p>') : `<p class="muted detail-note">${searching ? 'Loading series releases…' : 'Could not load releases. Retry with Apply series filters.'}</p>`;
  return `${dialogHead(show.title, show.year)}<p class="dlg-meta">${esc([show.language, show.status, ...(show.genres || [])].filter(Boolean).join(' · '))}</p>
    <form id="series-filter-form" class="series-filters"><div class="fields"><label class="field">Season<input name="season" type="number" min="0" max="99" placeholder="All" value="${esc(filters.season)}"></label><label class="field">Episode<input name="episode" type="number" min="0" max="999" placeholder="All" value="${esc(filters.episode)}"></label></div>
      <div class="chip-row" role="group" aria-label="Resolution"><button type="button" class="chip" data-series-quality="" aria-pressed="${!filters.quality}">All resolutions</button>${qualities.map(value => `<button type="button" class="chip" data-series-quality="${value}" aria-pressed="${filters.quality === value}">${value}</button>`).join('')}</div>
      <div class="show-actions"><button class="pill primary small" ${searching ? 'disabled' : ''}>Apply series filters</button><button class="text-button" id="clear-series-filters" type="button" ${searching ? 'disabled' : ''}>Clear filters</button></div></form>
    ${data ? `<p class="dim detail-note">${data.releases.length} matching releases from EZTV page${data.lastPage !== data.page ? `s ${data.page}–${data.lastPage}` : ` ${data.page}`} · ${data.total} releases indexed for this show. Use More releases for older results.</p>` : ''}${rows}
    <div class="show-actions"><button class="pill" id="series-more" ${data?.nextPage && !searching ? '' : 'disabled'}>More releases</button></div>
    <p class="series-credit dim">Metadata from TVmaze · summaries shortened · <button class="text-button" data-series-source="${show.id}">TVmaze source</button> <button class="text-button" data-series-source="license">CC BY-SA 4.0</button></p>`;
}
export function upgradePanel(upgrade) {
  return `<section class="download-comparison"><div class="section-heading"><h2>${esc(upgrade.title)} · compare editions</h2><button id="close-upgrade" class="text-button">Browse all movies</button></div><p class="note">Your current edition is ${upgrade.current.width} × ${upgrade.current.height}. Only higher-resolution releases are enabled below. The previous file is kept; higher resolution alone does not guarantee a better encode.</p><div class="edition-grid">${upgrade.editions.map(item => `<article class="edition-card"><h3>${esc(item.name || 'Unavailable edition')}${item.favorite ? ' · Favorite' : ''}</h3>${item.error ? `<p class="download-error">${esc(item.error)}</p>` : `<dl><dt>Resolution</dt><dd>${item.width} × ${item.height}</dd><dt>Codec</dt><dd>${esc(item.codec)}</dd><dt>File size</dt><dd>${(item.size / 1073741824).toFixed(2)} GiB</dd><dt>Average data rate</dt><dd>${(item.size * 8 / item.duration / 1000000).toFixed(1)} Mb/s</dd></dl><div class="show-actions"><button class="pill small" data-edition-play="${item.id}">Play this edition</button><button class="pill small" data-edition-favorite="${item.id}" ${item.favorite ? 'disabled' : ''}>${item.favorite ? 'Saved favorite' : 'Make favorite'}</button></div>`}</article>`).join('')}</div><button class="text-button" id="refresh-editions">Refresh editions</button></section>`;
}
