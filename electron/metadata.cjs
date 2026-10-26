const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const API = 'https://api.themoviedb.org/3', IMAGES = 'https://image.tmdb.org/t/p/';
const RECHECK_MISSING = 7 * 24 * 3600 * 1000;
const artworkName = /^(?:(?:movie|tv)-\d+-(?:poster|backdrop|thumb)|tv-\d+-s\d+e\d+)\.jpg$/;

// Minimal KEY=VALUE reader so secrets stay in a local, unpackaged .env file.
function readEnv(files) {
  const env = {};
  for (const file of files) {
    let text; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/);
      if (match && !line.trim().startsWith('#')) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return env;
}
function credentials(env) {
  const token = env.TMDB_ACCESS_TOKEN || env.VITE_TMDB_ACCESS_TOKEN || '', key = env.TMDB_API_KEY || env.VITE_TMDB_API_KEY || '';
  return token || key ? { token, key } : null;
}
// The release year is the last plausible year after the title ("Blade.Runner.2049.2017" → 2017); everything from it on is dropped.
function yearMatch(text) {
  let last = null;
  for (const match of String(text || '').matchAll(/(?:^|[\s.(\[_-])((?:19|20)\d{2})(?=$|[\s.)\]_-])/g)) if (match.index > 0 && Number(match[1]) <= new Date().getFullYear() + 1) last = match;
  return last;
}
const yearOf = text => yearMatch(text)?.[1] || null;
function cleanQuery(text) {
  let value = String(text || ''); const year = yearMatch(value); if (year) value = value.slice(0, year.index);
  return value.replace(/\b(?:480p|576p|720p|1080p|2160p|4k|uhd|bluray|blu-ray|bdrip|web-?dl|webrip|hdr10?|x264|x265|h\.?26[45]|hevc|remux|proper|repack)\b.*$/i, '')
    .replace(/[._]+/g, ' ').replace(/[[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
}
const keyFor = item => item.kind === 'show' ? item.groupId || item.group : item.id;
const MATCHER = 2;
// Bumped when stored details gain fields; matched titles are then refreshed by their TMDB id, never searched again.
const DETAILS = 2;
const norm = text => String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(?:the|a|an) /, '');
// Accept a result only when its title really is the file's title; a nearby release year helps, a distant one counts against it.
function pick(results, query, year, dateKey, titleKeys) {
  const q = norm(query), words = new Set(q.split(' '));
  let best = null, bestScore = 0;
  for (const result of (results || []).slice(0, 8)) {
    const released = result[dateKey]?.slice(0, 4);
    for (const title of titleKeys.map(key => result[key]).filter(Boolean)) {
      const n = norm(title), own = n.split(' '), common = own.filter(word => words.has(word)).length;
      let score = n === q ? 1 : 2 * common / (own.length + words.size) * .9;
      if (year) score += !released ? -.2 : Math.abs(Number(released) - Number(year)) <= 1 ? .15 : -.3;
      if (score > bestScore) { bestScore = score; best = result; }
    }
  }
  return bestScore >= .9 ? best : null;
}

function createMetadata({ dir, fetch, auth, onUpdate }) {
  const file = path.join(dir, 'metadata.json'), artwork = path.join(dir, 'artwork');
  let entries = {}, queue = [], running = 0, saveTimer, updateTimer;
  const pending = new Set(), failed = new Set();
  const loaded = (async () => {
    try { entries = JSON.parse(await fsp.readFile(file, 'utf8')).entries || {}; } catch { entries = {}; }
    await fsp.mkdir(artwork, { recursive: true });
  })();
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { const contents = JSON.stringify({ version: 1, entries }); void fsp.writeFile(file + '.tmp', contents).then(() => fsp.rename(file + '.tmp', file)).catch(() => {}); }, 500); }
  function changed() { clearTimeout(updateTimer); updateTimer = setTimeout(() => onUpdate?.(snapshot()), 300); }
  function snapshot() { return Object.fromEntries(Object.entries(entries).filter(([, e]) => e.status === 'matched' && e.matcher === MATCHER).map(([key, { status, query, checked, matcher, ...rest }]) => [key, rest])); }
  async function api(route, params = {}) {
    const url = new URL(API + route);
    for (const [name, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') url.searchParams.set(name, value);
    if (!auth.token) url.searchParams.set('api_key', auth.key);
    const response = await fetch(url.href, { headers: { accept: 'application/json', ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}) } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`TMDB ${response.status}`);
    return response.json();
  }
  async function image(pathname, size, name) {
    if (!pathname) return null;
    const target = path.join(artwork, name);
    try { await fsp.access(target); return `artwork/${name}`; } catch { /* Not cached yet. */ }
    const response = await fetch(IMAGES + size + pathname);
    if (!response.ok) return null;
    await fsp.writeFile(target, Buffer.from(await response.arrayBuffer()));
    return `artwork/${name}`;
  }
  async function movieDetails(id) {
    const movie = await api(`/movie/${id}`, { append_to_response: 'credits' });
    if (!movie) return null;
    return { tmdbId: movie.id, type: 'movie', title: movie.title, year: movie.release_date?.slice(0, 4) || null, genres: (movie.genres || []).map(g => g.name),
      people: [...new Set((movie.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name))], peopleLabel: 'Directed by',
      cast: (movie.credits?.cast || []).slice(0, 4).map(c => c.name), overview: movie.overview || '', tagline: movie.tagline || '', runtime: movie.runtime || null,
      rating: movie.vote_count ? Math.round(movie.vote_average * 10) / 10 : null, votes: movie.vote_count || 0,
      poster: await image(movie.poster_path, 'w500', `movie-${movie.id}-poster.jpg`), backdrop: await image(movie.backdrop_path, 'w1280', `movie-${movie.id}-backdrop.jpg`) };
  }
  async function tvDetails(id, seasons) {
    const show = await api(`/tv/${id}`, { append_to_response: 'credits' });
    if (!show) return null;
    const episodes = {};
    for (const season of seasons) {
      const data = await api(`/tv/${show.id}/season/${season}`).catch(() => null);
      if (data?.episodes) episodes[season] = Object.fromEntries(await Promise.all(data.episodes.map(async e => [e.episode_number, { name: e.name, runtime: e.runtime || null, overview: (e.overview || '').slice(0, 240),
        still: await image(e.still_path, 'w300', `tv-${show.id}-s${season}e${e.episode_number}.jpg`).catch(() => null) }])));
    }
    return { tmdbId: show.id, type: 'tv', title: show.name, year: show.first_air_date?.slice(0, 4) || null, genres: (show.genres || []).map(g => g.name),
      people: (show.created_by || []).map(c => c.name), peopleLabel: 'Created by', cast: (show.credits?.cast || []).slice(0, 4).map(c => c.name),
      overview: show.overview || '', tagline: show.tagline || '', runtime: show.episode_run_time?.[0] || null, seasonCount: show.number_of_seasons || null,
      rating: show.vote_count ? Math.round(show.vote_average * 10) / 10 : null, votes: show.vote_count || 0, episodes,
      poster: await image(show.poster_path, 'w500', `tv-${show.id}-poster.jpg`), backdrop: await image(show.backdrop_path, 'w1280', `tv-${show.id}-backdrop.jpg`) };
  }
  async function lookup({ kind, query, year, seasons, tmdbId }) {
    // A manual match only refreshes its own TMDB entry (for newly added seasons); it is never searched again.
    if (tmdbId) return kind === 'movie' ? movieDetails(tmdbId) : tvDetails(tmdbId, seasons);
    if (kind === 'movie') {
      const choose = async params => pick((await api('/search/movie', params))?.results, query, year, 'release_date', ['title', 'original_title']);
      const found = await choose({ query, year }) || (year ? await choose({ query }) : null);
      return found ? movieDetails(found.id) : null;
    }
    const choose = async params => pick((await api('/search/tv', params))?.results, query, year, 'first_air_date', ['name', 'original_name']);
    const found = await choose({ query, first_air_date_year: year }) || (year ? await choose({ query }) : null);
    return found ? tvDetails(found.id, seasons) : null;
  }
  function record(job, result, manual) {
    entries[job.key] = { status: result ? 'matched' : 'missing', query: job.query, checked: Date.now(), matcher: MATCHER, details: DETAILS, ...(manual ? { manual: true } : {}), ...(result || {}) };
    save();
  }
  async function work() {
    while (queue.length && running < 4) {
      const job = queue.shift(); running++;
      void lookup(job).then(result => { if (job.tmdbId && !result) return; record(job, result, job.manual); if (result) changed(); })
        .catch(() => failed.add(job.key)).finally(() => { running--; pending.delete(job.key); void work(); });
    }
  }
  function titlesOf(items) {
    const titles = new Map();
    for (const item of items) if (item.kind === 'movie' || item.kind === 'show') {
      const key = keyFor(item);
      if (!titles.has(key)) titles.set(key, { key, kind: item.kind, query: cleanQuery(item.group), year: yearOf(item.group) || (item.kind === 'movie' ? yearOf(path.basename(item.path)) : null), seasons: new Set() });
      if (item.season !== null && item.season !== undefined) titles.get(key).seasons.add(item.season);
    }
    for (const job of titles.values()) job.seasons = [...job.seasons].sort((a, b) => a - b);
    return [...titles.values()];
  }
  async function sync(items) {
    if (!auth) return;
    await loaded;
    for (const job of titlesOf(items)) {
      const entry = entries[job.key];
      const missingSeason = entry?.status === 'matched' && entry.type === 'tv' && job.seasons.some(s => !entry.episodes?.[s]);
      // Matched titles with a new season or older stored details are refreshed by id, keeping the match (and whether it was manual).
      const stale = entry?.status === 'matched' && entry.matcher === MATCHER && (missingSeason || entry.details !== DETAILS);
      if (stale || entry?.manual) { if ((stale || missingSeason) && entry.status === 'matched' && !pending.has(job.key) && !failed.has(job.key)) { pending.add(job.key); queue.push({ ...job, query: entry.query, tmdbId: entry.tmdbId, manual: !!entry.manual }); } continue; }
      const fresh = entry && entry.matcher === MATCHER && entry.query === job.query && (entry.status === 'matched' || Date.now() - entry.checked < RECHECK_MISSING);
      if (!job.query || pending.has(job.key) || failed.has(job.key) || (fresh && !missingSeason)) continue;
      pending.add(job.key); queue.push(job);
    }
    void work();
  }
  // Manual matching from the title page: search TMDB, then pin a result (or no result) to a title.
  async function search(kind, query, year) {
    if (!auth) throw new Error('TMDB is not configured. Add a key to .env to search.');
    const type = kind === 'show' ? 'tv' : 'movie', text = String(query || '').trim().slice(0, 200);
    if (!text) return [];
    const data = await api('/search/' + type, { query: text, ...(year ? { [type === 'tv' ? 'first_air_date_year' : 'year']: year } : {}) });
    return Promise.all((data?.results || []).slice(0, 10).map(async r => ({ id: r.id, title: type === 'tv' ? r.name : r.title, year: (type === 'tv' ? r.first_air_date : r.release_date)?.slice(0, 4) || null,
      overview: (r.overview || '').slice(0, 180), thumb: await image(r.poster_path, 'w92', type + '-' + r.id + '-thumb.jpg').catch(() => null) })));
  }
  async function assign(items, tmdbId) {
    if (!auth) throw new Error('TMDB is not configured.');
    await loaded;
    const [job] = titlesOf(items); if (!job) throw new Error('Only movies and shows can be matched.');
    const id = tmdbId === null ? null : Number(tmdbId);
    if (id !== null && !(Number.isInteger(id) && id > 0)) throw new Error('Invalid TMDB id');
    const result = id === null ? null : await lookup({ ...job, tmdbId: id });
    if (id !== null && !result) throw new Error('That TMDB entry could not be loaded.');
    record(job, result, true); failed.delete(job.key);
    return snapshot();
  }
  return { enabled: !!auth, sync, search, assign, snapshot: () => snapshot(), loaded, artworkFile: name => artworkName.test(name) ? path.join(artwork, name) : null };
}
module.exports = { readEnv, credentials, createMetadata, cleanQuery, yearOf, keyFor };
