const { episodeOf } = require('./download-layout.cjs');
const { canonicalHash, cleanMagnet, normalizeImdbId } = require('./release-discovery.cjs');
const { seasonEpisodes, addSeasonCandidates, bestSeasonDownload } = require('./season-download.cjs');
const text = (value, limit = 500) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const integer = (value, max, optional = false) => {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) throw new Error('Invalid series filter.');
  return number;
};
const plain = value => text(value, 4000).replace(/<[^>]*>/g, '').replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, name) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[name]);
const titleKey = value => text(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const qualities = ['480p', '576p', '720p', '1080p', '1440p', '2160p'];
function createSeriesCatalog({ request, json, rememberRelease, showsURL = 'https://api.tvmaze.com/', releasesURL = 'https://eztvx.to/api/' }) {
  const shows = new Map(), pages = new Map(), pending = new Map();
  const seasonSearches = new Map(), seasonDownloads = new Map();
  const expiresAt = () => Date.now() + 60 * 60 * 1000;
  const publicShow = ({ id, title, year, overview, language, status, genres, imdb }) => ({ id, title, year, overview, language, status, genres, imdbId: normalizeImdbId(imdb), indexed: !!imdb });
  function select(id) {
    const show = shows.get(String(id));
    if (!show || show.expires < Date.now()) throw new Error('Search again to refresh this series.');
    return show;
  }
  async function releasePage(show, page) {
    const key = `${show?.imdb || 'recent'}:${page}`, cached = pages.get(key);
    if (cached && cached.expires > Date.now()) return cached.data;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const url = new URL('get-torrents', releasesURL);
      url.search = new URLSearchParams({ limit: 100, page });
      if (show) url.searchParams.set('imdb_id', show.imdb);
      const data = await json(await request(url, { headers: { 'User-Agent': 'Matro' } }));
      if (!data || !Number.isFinite(Number(data.torrents_count)) || data.torrents !== undefined && !Array.isArray(data.torrents)) throw new Error('Series release catalog is unavailable. Try again later.');
      pages.set(key, { expires: Date.now() + 5 * 60 * 1000, data });
      while (pages.size > 50) pages.delete(pages.keys().next().value);
      return data;
    })().finally(() => pending.delete(key));
    pending.set(key, task); return task;
  }
  function readReleases(show, data, quality) {
    const found = [];
    for (const item of (data.torrents || []).slice(0, 100)) {
      const hash = typeof item?.hash === 'string' && /^[a-f0-9]{40}$/i.test(item.hash) ? item.hash.toLowerCase() : null;
      if (!hash || String(item.imdb_id).replace(/^tt/, '').replace(/^0+/, '') !== show.imdb.replace(/^0+/, '')) continue;
      const filename = text(item.filename, 500) || text(item.title, 500);
      if (!filename) continue;
      const parsed = episodeOf(filename);
      const season = /^\d{1,2}$/.test(String(item.season)) ? Number(item.season) : parsed?.season ?? null;
      const episode = /^\d{1,3}$/.test(String(item.episode)) ? Number(item.episode) : parsed?.episode ?? null;
      const resolution = filename.match(/\b(480p|720p|1080p|1440p|2160p)\b/i)?.[1]?.toLowerCase() || (/\b4k\b/i.test(filename) ? '2160p' : '');
      if (quality && quality !== resolution) continue;
      const size = Math.max(0, Number(item.size_bytes) || 0);
      const release = { hash, title: show.title, year: show.year, kind: 'show', season: season ?? 1, episode: episode ?? 0, quality: resolution, expires: expiresAt() };
      // Keep only trackers from a magnet that matches the validated hash.
      try {
        const source = new URL(item.magnet_url), clean = new URL(`magnet:?xt=urn:btih:${hash}`);
        if (source.protocol === 'magnet:' && source.searchParams.get('xt')?.toLowerCase() === `urn:btih:${hash}`) {
          for (const tracker of source.searchParams.getAll('tr').slice(0, 30)) if (/^(https?|udp):\/\//i.test(tracker) && tracker.length < 2000) clean.searchParams.append('tr', tracker);
          release.magnet = clean.href;
        }
      } catch { /* The validated hash is sufficient for a magnet. */ }
      const display = { hash, title: text(item.title || filename), season, episode, quality: resolution || 'Unknown', codec: filename.match(/\b(x26[45]|h26[45]|hevc|av1)\b/i)?.[1] || '', size: size >= 1073741824 ? `${(size / 1073741824).toFixed(2)} GiB` : `${Math.round(size / 1048576)} MiB`, seeds: Math.max(0, Number(item.seeds) || 0), peers: Math.max(0, Number(item.peers) || 0) };
      found.push({ ...display, filename, release });
    }
    return found;
  }
  const displayRelease = ({ filename, release, ...display }) => display;
  const metadataEpisodes = show => request(new URL(`shows/${show.id}/episodes`, showsURL), { headers: { 'User-Agent': 'Matro' } }).then(json);
  async function scanSeason(show, season, quality, search) {
    const anime = show.type === 'Animation' || show.language === 'Japanese';
    const start = search.nextPage;
    if (start === 1) {
      const [episodes, first] = await Promise.all([metadataEpisodes(show), releasePage(show, 1)]);
      Object.assign(search, seasonEpisodes(episodes, season));
      search.lastPage = Math.min(100, Math.max(1, Math.ceil(Number(first.torrents_count) / 100)));
      addSeasonCandidates(search, readReleases(show, first, quality), { anime, season });
    }
    const end = Math.min(search.lastPage, start + 3);
    if (!search.pack) {
      const first = Math.max(start, 2);
      const pages = await Promise.all(Array.from({ length: Math.max(0, end - first + 1) }, (_, index) => releasePage(show, first + index)));
      for (const data of pages) addSeasonCandidates(search, readReleases(show, data, quality), { anime, season });
    }
    search.nextPage = !search.pack && end < search.lastPage ? end + 1 : null;
    return seasonResult(show, season, search);
  }
  function seasonResult(show, season, search) {
    const { best, coverage } = bestSeasonDownload(search, show.id, season);
    let pack = null;
    if (search.pack) {
      const { release } = search.pack;
      if (!search.pack.selectionId) rememberRelease(release.hash, { ...release, season, episode: 0, expires: expiresAt() });
      pack = { ...displayRelease(search.pack), season };
    }
    let batch = null;
    if (!pack && best) {
      const { releases, ...details } = best;
      seasonDownloads.delete(best.id);
      seasonDownloads.set(best.id, { releases, expires: expiresAt() });
      while (seasonDownloads.size > 100) seasonDownloads.delete(seasonDownloads.keys().next().value);
      batch = details;
    }
    return { season, pack, batch, expected: search.episodes.size, coverage, nextPage: search.nextPage };
  }
  async function findSeason(show, season, quality, page) {
    if (season === null) throw new Error('Choose a season to find a season download.');
    const key = JSON.stringify([show.id, season, quality]);
    let search = seasonSearches.get(key);
    if (!search || search.expires < Date.now()) {
      search = { nextPage: 1, groups: new Map(), expires: Date.now() + 5 * 60 * 1000 };
      seasonSearches.delete(key); seasonSearches.set(key, search);
      while (seasonSearches.size > 10) seasonSearches.delete(seasonSearches.keys().next().value);
    }
    if (search.pending) return search.pending;
    if (search.result && page !== search.nextPage) return search.result;
    search.pending = scanSeason(show, season, quality, search).then(result => {
      search.result = result; search.expires = Date.now() + 5 * 60 * 1000;
      return result;
    }).finally(() => { search.pending = null; });
    return search.pending;
  }
  return {
    async recent() {
      const data = await releasePage(null, 1);
      return (data.torrents || []).slice(0, 100).flatMap(item => {
        const hash = canonicalHash(item?.hash);
        if (!hash) return [];
        return [{
          hash, magnet: cleanMagnet(item.magnet_url, hash)?.magnet, provider: 'EZTV',
          releaseTitle: text(item.filename || item.title, 500), imdbId: item.imdb_id,
          season: /^\d{1,2}$/.test(String(item.season)) ? Number(item.season) : null,
          episode: /^\d{1,3}$/.test(String(item.episode)) ? Number(item.episode) : null,
          sizeBytes: item.size_bytes, seeds: item.seeds, peers: item.peers
        }];
      });
    },
    async search(options) {
      const query = text(options?.query, 200);
      if (!query) throw new Error('Enter a series title to search.');
      const url = new URL('search/shows', showsURL); url.searchParams.set('q', query);
      const data = await json(await request(url, { headers: { 'User-Agent': 'Matro' } }));
      if (!Array.isArray(data)) throw new Error('Series metadata search returned an invalid response.');
      const found = data.slice(0, 20).flatMap(item => {
        const value = item?.show;
        if (!Number.isInteger(value?.id) || !text(value.name)) return [];
        const show = { id: String(value.id), title: text(value.name, 250), year: text(value.premiered, 10).slice(0, 4), overview: plain(value.summary), language: text(value.language, 50), type: text(value.type, 50), status: text(value.status, 50), genres: Array.isArray(value.genres) ? value.genres.slice(0, 8).map(value => text(value, 50)) : [], imdb: String(value.externals?.imdb || '').match(/^tt(\d{5,12})$/)?.[1] || '', expires: expiresAt() };
        shows.set(show.id, show); return [publicShow(show)];
      });
      while (shows.size > 200) shows.delete(shows.keys().next().value);
      return { shows: found };
    },
    async animeSeason(options, candidates) {
      const season = integer(options.season, 99), quality = text(options.quality, 20);
      if (quality && !qualities.includes(quality)) throw new Error('Invalid resolution filter.');
      const first = candidates[0]?.release;
      if (!first) throw new Error('Search anime releases before finding a season download.');
      const names = [...new Set([first.title, ...(Array.isArray(options.aliases) ? options.aliases.slice(0, 2).map(value => text(value, 200)).filter(Boolean) : [])])];
      const lookups = await Promise.allSettled(names.map(query => this.search({ query })));
      const matches = new Map();
      for (const result of lookups) if (result.status === 'fulfilled') for (const show of result.value.shows) {
        const exact = names.some(name => titleKey(name) === titleKey(show.title)) && (!first.year || !show.year || show.year === first.year);
        if (first.imdbId ? normalizeImdbId(first.imdbId) === show.imdbId : exact) matches.set(show.id, show);
      }
      if (matches.size !== 1) throw new Error('Could not verify the episode list for this anime. Try its alternate title or choose individual releases.');
      const show = select(matches.keys().next().value);
      const search = { ...seasonEpisodes(await metadataEpisodes(show), season), groups: new Map(), nextPage: null };
      const items = candidates.flatMap(({ selectionId, release, magnet }) => {
        if ((first.imdbId && release.imdbId ? first.imdbId !== release.imdbId : titleKey(first.title) !== titleKey(release.title)) || quality && release.quality !== quality) return [];
        return [{ ...release, selectionId, filename: release.releaseTitle, title: release.releaseTitle, seeds: release.seeds ?? 0,
          release: { hash: release.hash, magnet, title: show.title, year: show.year, kind: 'show', quality: release.quality === 'Unknown' ? '' : release.quality, expires: expiresAt() } }];
      });
      addSeasonCandidates(search, items, { anime: true, season });
      return seasonResult(show, season, search);
    },
    async releases(options) {
      const show = select(options?.id), page = integer(options?.page ?? 1, 100);
      if (page < 1 || !show.imdb) throw new Error('This series has no release index. You can still add a show magnet manually.');
      const season = integer(options.season, 99, true), episode = integer(options.episode, 999, true);
      const quality = text(options.quality, 20);
      if (quality && !qualities.includes(quality)) throw new Error('Invalid resolution filter.');
      if (options.seasonDownload === true) {
        if (episode !== null) throw new Error('Leave Episode blank to find a season download.');
        return findSeason(show, season, quality, page);
      }
      const found = [], seen = new Set(); let scanned = 0, total = 0, current = page;
      // With filters, scan a bounded set of provider pages. More releases continues
      // from the last scanned page, so older seasons are never silently discarded.
      const maximum = season !== null || episode !== null || quality ? 3 : 1;
      while (scanned < maximum && current <= 100) {
        const data = await releasePage(show, current); scanned++; total = Math.max(0, Number(data.torrents_count) || 0);
        for (const item of readReleases(show, data, quality)) {
          const { hash, release } = item;
          if (seen.has(hash) || season !== null && season !== item.season || episode !== null && episode !== item.episode) continue;
          seen.add(hash);
          rememberRelease(hash, release);
          found.push(displayRelease(item));
        }
        current++;
        if (found.length || (current - 1) * 100 >= total) break;
      }
      return { show: publicShow(show), releases: found, page, lastPage: current - 1, nextPage: current <= 100 && (current - 1) * 100 < total ? current : null, total, scanned };
    },
    seasonBatch(id) {
      const batch = seasonDownloads.get(id);
      if (!batch || batch.expires < Date.now()) throw new Error('Find the season download again to refresh these releases.');
      return batch.releases;
    },
    source(id) { if (id === 'license') return 'https://creativecommons.org/licenses/by-sa/4.0/'; const show = select(id); return `https://www.tvmaze.com/shows/${show.id}`; }
  };
}
module.exports = { createSeriesCatalog };
