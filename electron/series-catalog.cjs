const { episodeOf } = require('./download-layout.cjs');
const text = (value, limit = 500) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const integer = (value, max, optional = false) => {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) throw new Error('Invalid series filter.');
  return number;
};
const plain = value => text(value, 4000).replace(/<[^>]*>/g, '').replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, name) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[name]);
function createSeriesCatalog({ request, json, rememberRelease, showsURL = 'https://api.tvmaze.com/', releasesURL = 'https://eztvx.to/api/' }) {
  const shows = new Map(), pages = new Map(), pending = new Map();
  const publicShow = ({ id, title, year, overview, language, status, genres, imdb }) => ({ id, title, year, overview, language, status, genres, indexed: !!imdb });
  function select(id) {
    const show = shows.get(String(id));
    if (!show || show.expires < Date.now()) throw new Error('Search again to refresh this series.');
    return show;
  }
  async function releasePage(show, page) {
    const key = `${show.imdb}:${page}`, cached = pages.get(key);
    if (cached && cached.expires > Date.now()) return cached.data;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const url = new URL('get-torrents', releasesURL);
      url.search = new URLSearchParams({ imdb_id: show.imdb, limit: 100, page }).toString();
      const data = await json(await request(url, { headers: { 'User-Agent': 'Matro' } }));
      if (!data || !Number.isFinite(Number(data.torrents_count)) || data.torrents !== undefined && !Array.isArray(data.torrents)) throw new Error('Series release catalog is unavailable. Try again later.');
      pages.set(key, { expires: Date.now() + 5 * 60 * 1000, data });
      while (pages.size > 50) pages.delete(pages.keys().next().value);
      return data;
    })().finally(() => pending.delete(key));
    pending.set(key, task); return task;
  }
  return {
    async search(options) {
      const query = text(options?.query, 200);
      if (!query) throw new Error('Enter a series title to search.');
      const url = new URL('search/shows', showsURL); url.searchParams.set('q', query);
      const data = await json(await request(url, { headers: { 'User-Agent': 'Matro' } }));
      if (!Array.isArray(data)) throw new Error('Series metadata search returned an invalid response.');
      const found = data.slice(0, 20).flatMap(item => {
        const value = item?.show;
        if (!Number.isInteger(value?.id) || !text(value.name)) return [];
        const show = { id: String(value.id), title: text(value.name, 250), year: text(value.premiered, 10).slice(0, 4), overview: plain(value.summary), language: text(value.language, 50), status: text(value.status, 50), genres: Array.isArray(value.genres) ? value.genres.slice(0, 8).map(value => text(value, 50)) : [], imdb: String(value.externals?.imdb || '').match(/^tt(\d{5,12})$/)?.[1] || '', expires: Date.now() + 60 * 60 * 1000 };
        shows.set(show.id, show); return [publicShow(show)];
      });
      while (shows.size > 200) shows.delete(shows.keys().next().value);
      return { shows: found };
    },
    async releases(options) {
      const show = select(options?.id), page = integer(options?.page ?? 1, 100);
      if (page < 1 || !show.imdb) throw new Error('This series has no release index. You can still add a show magnet manually.');
      const season = integer(options.season, 99, true), episode = integer(options.episode, 999, true);
      const quality = text(options.quality, 20);
      if (quality && !['480p', '720p', '1080p', '1440p', '2160p'].includes(quality)) throw new Error('Invalid resolution filter.');
      const found = [], seen = new Set(); let scanned = 0, total = 0, current = page;
      // With filters, scan a bounded set of provider pages. More releases continues
      // from the last scanned page, so older seasons are never silently discarded.
      const maximum = season !== null || episode !== null || quality ? 3 : 1;
      while (scanned < maximum && current <= 100) {
        const data = await releasePage(show, current); scanned++; total = Math.max(0, Number(data.torrents_count) || 0);
        for (const item of (data.torrents || []).slice(0, 100)) {
          const hash = typeof item.hash === 'string' && /^[a-f0-9]{40}$/i.test(item.hash) ? item.hash.toLowerCase() : null;
          if (!hash || String(item.imdb_id).replace(/^tt/, '').replace(/^0+/, '') !== show.imdb.replace(/^0+/, '') || seen.has(hash)) continue;
          const filename = text(item.filename || item.title, 500), parsed = episodeOf(filename);
          const releaseSeason = /^\d{1,2}$/.test(String(item.season)) ? Number(item.season) : parsed?.season ?? null;
          const releaseEpisode = /^\d{1,3}$/.test(String(item.episode)) ? Number(item.episode) : parsed?.episode ?? null;
          const resolution = filename.match(/\b(480p|720p|1080p|1440p|2160p)\b/i)?.[1]?.toLowerCase() || (/\b4k\b/i.test(filename) ? '2160p' : '');
          if (season !== null && season !== releaseSeason || episode !== null && episode !== releaseEpisode || quality && quality !== resolution) continue;
          seen.add(hash);
          const size = Math.max(0, Number(item.size_bytes) || 0);
          const release = { hash, title: show.title, year: show.year, kind: 'show', season: releaseSeason ?? 1, episode: releaseEpisode ?? 0, quality: resolution, expires: Date.now() + 60 * 60 * 1000 };
          // Only reuse tracker URLs from a matching magnet; arbitrary provider
          // download URLs are not sent to the torrent client.
          try {
            const source = new URL(item.magnet_url), clean = new URL(`magnet:?xt=urn:btih:${hash}`);
            if (source.protocol === 'magnet:' && source.searchParams.get('xt')?.toLowerCase() === `urn:btih:${hash}`) {
              for (const tracker of source.searchParams.getAll('tr').slice(0, 30)) if (/^(https?|udp):\/\//i.test(tracker) && tracker.length < 2000) clean.searchParams.append('tr', tracker);
              release.magnet = clean.href;
            }
          } catch { /* The validated hash is sufficient for a magnet. */ }
          rememberRelease(hash, release);
          found.push({ hash, title: text(item.title || filename), season: releaseSeason, episode: releaseEpisode, quality: resolution || 'Unknown', codec: filename.match(/\b(x26[45]|h26[45]|hevc|av1)\b/i)?.[1] || '', size: size >= 1073741824 ? `${(size / 1073741824).toFixed(2)} GiB` : `${Math.round(size / 1048576)} MiB`, seeds: Math.max(0, Number(item.seeds) || 0), peers: Math.max(0, Number(item.peers) || 0) });
        }
        current++;
        if (found.length || (current - 1) * 100 >= total) break;
      }
      return { show: publicShow(show), releases: found, page, lastPage: current - 1, nextPage: current <= 100 && (current - 1) * 100 < total ? current : null, total, scanned };
    },
    source(id) { if (id === 'license') return 'https://creativecommons.org/licenses/by-sa/4.0/'; const show = select(id); return `https://www.tvmaze.com/shows/${show.id}`; }
  };
}
module.exports = { createSeriesCatalog };
