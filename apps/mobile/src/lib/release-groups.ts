// Groups discovery releases (Prowlarr, anime sources) into one entry per title, most seeded first.
// Same rules as packages/browser-ui/downloads-discovery.js groupReleases, which is plain JavaScript the phone build does not type-check.
export type DiscoveryRelease = {
  hash: string | null; selectionId?: string; title: string; year?: string | number | null; kind?: string; downloadKind?: string;
  imdbId?: string; tmdbId?: string | number; seeds?: number | null; quality: string; size: string; [field: string]: unknown;
};
export type ReleaseGroup = { key: string; title: string; year?: string | number | null; kind?: string; downloadKind?: string; imdbId?: string; tmdbId?: string | number; releases: DiscoveryRelease[] };

export const seedText = (seeds?: number | null) => seeds == null ? 'Seeds unknown' : `${seeds} ${seeds === 1 ? 'seed' : 'seeds'}`;
const score = (release: DiscoveryRelease) => release.seeds ?? -1;
const identityTitle = (title: string) => title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const identity = (release: DiscoveryRelease) => JSON.stringify([release.downloadKind, identityTitle(release.title), String(release.year || '')]);

export function groupReleases(releases: DiscoveryRelease[], knownHashes: string[] = []): ReleaseGroup[] {
  const groups: ReleaseGroup[] = [], ids = new Map<string, ReleaseGroup>(), byTitle = new Map<string, Set<ReleaseGroup>>(), hashes = new Set(knownHashes);
  const fields = ['imdbId', 'tmdbId'] as const;
  for (const release of [...releases].sort((a, b) => score(b) - score(a))) {
    if (release.hash && hashes.has(release.hash)) continue;
    if (release.hash) hashes.add(release.hash);
    const titleKey = identity(release), possible = byTitle.get(titleKey) || new Set<ReleaseGroup>();
    const idKeys = fields.filter(field => release[field]).map(field => `${release.downloadKind}:${field}:${release[field]}`);
    const compatible = (group: ReleaseGroup) => fields.every(field => !release[field] || !group[field] || String(release[field]) === String(group[field]));
    const exact = [...new Set(idKeys.map(key => ids.get(key)).filter((group): group is ReleaseGroup => !!group))].filter(compatible);
    const candidates = [...possible].filter(compatible);
    let group = exact.length === 1 ? exact[0] : exact.length === 0 && candidates.length === 1 ? candidates[0] : null;
    if (!group) {
      group = { key: release.selectionId || `${titleKey}:${groups.length}`, title: release.title, year: release.year, kind: release.kind, downloadKind: release.downloadKind, releases: [] };
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
