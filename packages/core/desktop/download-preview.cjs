const BATCH_LIMIT = 24;
const CONCURRENT = 4;
const PENDING_LIMIT = BATCH_LIMIT * 4;
const CACHE_LIMIT = 512;
const MATCH_TTL = 60 * 60 * 1000;
const MISS_TTL = 5 * 60 * 1000;
const SEARCH_LIMIT = 12;
const CAST_LIMIT = 12;

const mediaTypes = new Map([['movie', ['movie']], ['show', ['tv']], ['anime', ['tv', 'movie']]]);
const trim = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const normalize = value => trim(value).normalize('NFKD').toLowerCase()
  .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
  .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
const integer = (value, min = 1) => {
  const number = typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : value;
  return Number.isInteger(number) && number >= min && number <= 2147483647 ? number : null;
};
const displayTitle = ({ type, data }) => trim(type === 'movie' ? data.title : data.name);
const originalTitle = ({ type, data }) => trim(type === 'movie' ? data.original_title : data.original_name);
const releaseYear = ({ type, data }) => {
  const date = type === 'movie' ? data.release_date : data.first_air_date;
  return typeof date === 'string' ? date.match(/^([1-9]\d{3})-/)?.[1] || null : null;
};
const aliasTitles = (type, data) => (type === 'movie' ? data?.titles : data?.results)?.map(row => trim(row.title)).filter(Boolean) || [];
const hasTitle = (candidate, title) => !!title && [displayTitle(candidate), originalTitle(candidate)].some(value => normalize(value) === title);
const animation = ({ data }) => data.genre_ids?.includes(16) || data.genres?.some(genre => genre.id === 16);
const candidateKey = ({ type, id }) => `${type}:${id}`;

function candidateOf(type, data) {
  const id = integer(data?.id);
  const candidate = { type, id, data };
  return id && displayTitle(candidate) ? candidate : null;
}

function uniqueMatch(candidates, anime) {
  const matches = [...new Map(candidates.map(candidate => [candidateKey(candidate), candidate])).values()];
  if (matches.length === 1) return matches[0];
  const animated = anime ? matches.filter(animation) : [];
  return animated.length === 1 ? animated[0] : null;
}

// Limit work across concurrent batches, and share matching and detail requests across callers.
function createDownloadPreview({ enabled, api, image, loaded }) {
  const cache = new Map(), pending = new Map(), queue = [];
  let running = 0;

  function drain() {
    while (running < CONCURRENT && queue.length) {
      running++;
      void queue.shift()();
    }
  }

  function run(key, load, remember = true) {
    const entry = cache.get(key);
    if (entry?.expires > Date.now()) return Promise.resolve(entry.value);
    cache.delete(key);
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= PENDING_LIMIT) return Promise.reject(new Error('TMDB preview queue is full'));
    const promise = new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          const value = await load();
          if (remember) {
            if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
            cache.set(key, { value, expires: Date.now() + (value ? MATCH_TTL : MISS_TTL) });
          }
          resolve(value);
        } catch (error) {
          reject(error);
        } finally {
          running--;
          pending.delete(key);
          drain();
        }
      });
    });
    pending.set(key, promise);
    drain();
    return promise;
  }

  async function byId(type, id, params) {
    const candidate = candidateOf(type, await api(`/${type}/${id}`, params));
    return candidate?.id === id ? candidate : null;
  }

  async function findByTitle(types, query, year, anime) {
    async function search(restrictYear) {
      const candidates = [];
      for (const type of types) {
        const yearParam = type === 'tv' ? 'first_air_date_year' : 'year';
        const response = await api(`/search/${type}`, { query, ...(restrictYear ? { [yearParam]: year } : {}) });
        const results = (response?.results || []).slice(0, SEARCH_LIMIT).map(data => candidateOf(type, data));
        candidates.push(...results.filter(candidate => candidate && (!year || releaseYear(candidate) === year)
          && (!anime || !candidate.data.genre_ids?.length || animation(candidate))));
      }
      return candidates;
    }

    let candidates = await search(!!year);
    if (year && !candidates.length) candidates = await search(false);
    const title = normalize(query);
    const exact = candidates.filter(candidate => hasTitle(candidate, title));
    if (exact.length) return uniqueMatch(exact, anime);

    // TMDB searches alternate titles but returns canonical titles in each result.
    // Verify aliases for up to two of the highest-ranked candidates, covering both media types for anime.
    const first = types.map(type => candidates.find(candidate => candidate.type === type)).filter(Boolean);
    const shortlist = [...new Set([...first, ...candidates])].slice(0, 2);
    const matched = [];
    for (const candidate of shortlist) {
      const aliases = aliasTitles(candidate.type, await api(`/${candidate.type}/${candidate.id}/alternative_titles`));
      if (aliases.some(alias => normalize(alias) === title)) matched.push(candidate);
    }
    return uniqueMatch(matched, anime);
  }

  async function match({ types, query, year, anime, tmdbId, imdbId }) {
    const title = normalize(query);
    const agrees = candidate => hasTitle(candidate, title) && (!year || releaseYear(candidate) === year);
    if (tmdbId) {
      const byType = [];
      for (const type of types) {
        const found = await byId(type, tmdbId);
        if (found) byType.push(found);
      }
      const known = types.length === 1 ? byType[0] : uniqueMatch(byType.filter(agrees), anime);
      if (known) return known;
    }
    if (imdbId) {
      const found = await api(`/find/${imdbId}`, { external_source: 'imdb_id' });
      const matches = types.flatMap(type => (found?.[`${type}_results`] || [])
        .slice(0, SEARCH_LIMIT).map(data => candidateOf(type, data)).filter(Boolean));
      const known = uniqueMatch(matches, false) || uniqueMatch(matches.filter(agrees), anime);
      if (known) return known;
    }
    return title ? findByTitle(types, query, year, anime) : null;
  }

  function artwork(pathname, size, filename) {
    if (typeof pathname !== 'string' || !/^\/[\w-]+\.(?:jpe?g|png|webp)$/i.test(pathname)) return null;
    return run(`art:${filename}`, () => image(pathname, size, filename), false).catch(() => null);
  }

  async function metadataOf(item, detail) {
    const types = mediaTypes.get(item.kind);
    if (!types) return null;
    const year = trim(typeof item.year === 'number' ? String(item.year) : item.year, 12);
    const input = {
      types: types.includes(item.type) ? [item.type] : types,
      query: trim(item.title), year: /^[1-9]\d{3}$/.test(year) ? year : null,
      anime: item.kind === 'anime', tmdbId: item.type == null || types.includes(item.type) ? integer(item.tmdbId) : null,
      imdbId: typeof item.imdbId === 'string' && /^tt\d{7,12}$/i.test(item.imdbId) ? item.imdbId.toLowerCase() : null,
    };
    const found = await run(`match:${JSON.stringify(input)}`, () => match(input));
    if (!found) return null;

    const { type, id } = found;
    const detailKey = `detail:${candidateKey(found)}`;
    const full = detail ? await run(detailKey, () => byId(type, id, { append_to_response: 'alternative_titles,credits' })).catch(() => null) : null;
    const selected = full || found;
    const { data } = selected;
    const season = detail && type === 'tv' ? integer(item.season, 0) : null;
    const [poster, backdrop, seasonData] = await Promise.all([
      artwork(data.poster_path || found.data.poster_path, 'w500', `${type}-${id}-poster.jpg`),
      detail ? artwork(data.backdrop_path, 'w1280', `${type}-${id}-backdrop.jpg`) : null,
      season !== null ? run(`season:${id}:${season}`, () => api(`/tv/${id}/season/${season}`)).catch(() => null) : null,
    ]);
    const title = displayTitle(selected), original = originalTitle(selected);
    const result = {
      tmdbId: id, type, title, ...(original ? { originalTitle: original } : {}), year: releaseYear(selected) || releaseYear(found),
      overview: trim(data.overview, 3000) || trim(found.data.overview, 3000), poster,
    };
    if (detail) {
      const aliases = [...new Set([original, ...aliasTitles(type, data.alternative_titles)])].filter(alias => alias && alias !== title);
      const genres = (data.genres || []).map(genre => trim(genre.name)).filter(Boolean);
      const cast = (data.credits?.cast || []).slice(0, CAST_LIMIT).map(person => ({ name: trim(person.name), role: trim(person.character) })).filter(person => person.name);
      const runtime = integer(type === 'movie' ? data.runtime : data.episode_run_time?.[0]);
      const rating = data.vote_count > 0 && Number.isFinite(data.vote_average) ? Math.round(data.vote_average * 10) / 10 : null;
      Object.assign(result, { aliases, genres, cast, runtime, rating, backdrop });
      if (type === 'tv') result.seasonCount = integer(data.number_of_seasons, 0);
      if (seasonData?.episodes) result.episodes = { [season]: Object.fromEntries(seasonData.episodes
        .filter(episode => integer(episode.episode_number, 0) !== null)
        .map(episode => [episode.episode_number, { name: trim(episode.name), runtime: integer(episode.runtime), overview: trim(episode.overview, 240) }])) };
    }
    return result;
  }

  return async request => {
    const titles = Array.isArray(request?.titles) ? request.titles.slice(0, BATCH_LIMIT) : [];
    const results = await Promise.all(titles.filter(item => typeof item?.key === 'string' && item.key.length > 0 && item.key.length <= 512)
      .map(async item => ({
        key: item.key,
        metadata: enabled ? await loaded.then(() => metadataOf(item, request.detail === true)).catch(() => null) : null,
      })));
    return { enabled, results };
  };
}

module.exports = { createDownloadPreview };
