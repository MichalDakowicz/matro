export const kinds = { movie: ['Movies', 'movie'], show: ['Series', 'series'], anime: ['Anime', 'anime'] };
export const seedText = seeds => seeds == null ? 'Seeds unknown' : `${seeds} ${seeds === 1 ? 'seed' : 'seeds'}`;
const score = release => release.seeds ?? -1;
const identityTitle = title => title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const identity = release => JSON.stringify([release.downloadKind, identityTitle(release.title), String(release.year || '')]);

export function groupReleases(releases, knownHashes) {
  const groups = [], ids = new Map(), byTitle = new Map(), hashes = new Set(knownHashes);
  const ranked = [...releases].sort((a, b) => score(b) - score(a));
  for (const release of ranked) {
    if (release.hash && hashes.has(release.hash)) continue;
    if (release.hash) hashes.add(release.hash);
    const titleKey = identity(release), possible = byTitle.get(titleKey) || new Set();
    const idKeys = ['imdbId', 'tmdbId'].filter(field => release[field]).map(field => `${release.downloadKind}:${field}:${release[field]}`);
    const compatible = group => ['imdbId', 'tmdbId'].every(field => !release[field] || !group[field] || String(release[field]) === String(group[field]));
    const exact = [...new Set(idKeys.map(key => ids.get(key)).filter(Boolean))].filter(compatible);
    const candidates = [...possible].filter(compatible);
    let group = exact.length === 1 ? exact[0] : exact.length === 0 && candidates.length === 1 ? candidates[0] : null;
    if (!group) {
      group = { key: release.selectionId, title: release.title, year: release.year, kind: release.kind, downloadKind: release.downloadKind, releases: [] };
      groups.push(group);
    }
    group.imdbId ||= release.imdbId;
    group.tmdbId ||= release.tmdbId;
    group.releases.push(release);
    possible.add(group); byTitle.set(titleKey, possible);
    for (const key of idKeys) if (!ids.has(key)) ids.set(key, group);
  }
  return groups;
}

export function previewTitle(source, kind) {
  const type = kind === 'anime' && source.releases?.every(release => !release.canChooseDownloadKind) ? (source.downloadKind === 'movie' ? 'movie' : 'tv') : undefined;
  return { kind, title: source.title, year: source.year, tmdbId: source.tmdbId, imdbId: source.imdbId, type };
}

export function episodeLabel(release) {
  const season = release.season == null ? '' : `S${String(release.season).padStart(2, '0')}`;
  if (release.pack) return season ? `${season} batch` : 'Batch';
  if (release.episode != null && season) return `${season}E${String(release.episode).padStart(2, '0')}`;
  if (release.absoluteEpisode != null) return `Episode ${release.absoluteEpisode} (absolute)`;
  if (release.episode != null) return `Episode ${release.episode}`;
  return season ? `${season} · unnumbered episode` : release.downloadKind === 'show' && !release.canChooseDownloadKind ? 'Episode unnumbered' : '';
}
