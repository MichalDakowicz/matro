const { randomUUID } = require('node:crypto');
const { animeAbsoluteEpisode } = require('./download-layout.cjs');

const hashPattern = /^[a-f0-9]{40}$/i;
const text = (value, limit = 500) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const number = value => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};
const resolution = value => value.match(/\b(480p|576p|720p|1080p|1440p|2160p)\b/i)?.[1].toLowerCase() || (/\b(?:4k|uhd)\b/i.test(value) ? '2160p' : '');
const yearOf = value => /^(?:19|20)\d{2}$/.test(String(value)) ? String(value) : '';

function canonicalHash(value) {
  if (typeof value !== 'string') return null;
  if (hashPattern.test(value)) return value.toLowerCase();
  if (!/^[a-z2-7]{32}$/i.test(value)) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = Buffer.alloc(20);
  let accumulator = 0, bits = 0, offset = 0;
  for (const character of value.toUpperCase()) {
    accumulator = (accumulator << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = accumulator >> bits;
    }
  }
  return bytes.toString('hex');
}

function cleanMagnet(value, expectedHash, allowTracker = () => true) {
  if (typeof value !== 'string' || !/^magnet:\?/i.test(value) || value.length > 64000) return null;
  const source = new URL(value);
  const hashes = new Set(source.searchParams.getAll('xt').map(value => canonicalHash(value.match(/^urn:btih:(.+)$/i)?.[1])).filter(Boolean));
  if (hashes.size !== 1) return null;
  const [hash] = hashes;
  if (expectedHash && hash !== expectedHash) return null;
  const clean = new URL(`magnet:?xt=urn:btih:${hash}`);
  for (const tracker of new Set(source.searchParams.getAll('tr').slice(0, 30))) {
    if (/^(https?|udp):\/\//i.test(tracker) && tracker.length < 2000 && allowTracker(tracker)) clean.searchParams.append('tr', tracker);
  }
  return { hash, magnet: clean.href };
}

function normalizeImdbId(value) {
  const digits = String(value ?? '').match(/^(?:tt)?(\d{1,12})$/)?.[1];
  return digits && /[1-9]/.test(digits) ? 'tt' + digits.padStart(7, '0') : undefined;
}
const normalizeTmdbId = value => number(value) || undefined;

function sizeDisplay(item) {
  const bytes = number(item.sizeBytes);
  if (bytes > 0) return bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GiB` : `${Math.max(1, Math.round(bytes / 1048576))} MiB`;
  const size = text(item.size, 30);
  return /^\d+(?:\.\d+)?\s*(?:[KMGT]i?B|Bytes?|B)$/i.test(size) ? size : '';
}

function episodeDetails(value, item, anime) {
  const numbered = /\bS(\d{1,2})[ ._-]*E(\d{1,4})(?=\b|E\d)/i.exec(value) || /\b(\d{1,2})x(\d{2,4})\b/i.exec(value);
  const seasonTag = /\b(?:S|Season[ ._-]+)(\d{1,2})\b/i.exec(value);
  const absolute = anime && animeAbsoluteEpisode(value);
  const range = anime && /(?:\s-\s|\[)(\d{1,4})\s*[-~–]\s*\d{1,4}(?=$|\s|\])/i.exec(value);
  const explicitEpisode = /\b(?:EP|Episode)[ ._-]*(\d{1,3})\b/i.exec(value);
  const multiEpisode = /\bS\d{1,2}[ ._-]*E\d{1,4}(?:[ ._-]*E\d{1,4}|\s*[-–]\s*\d{1,4})\b/i.test(value);
  const pack = Boolean(item.pack || multiEpisode || /(?:[\[(]|\s-\s)(?:batch|complete|season pack)\b|\bseason[ ._-]+\d{1,2}[ ._-]+complete\b/i.test(value) || range && !numbered || seasonTag && !numbered && !explicitEpisode && !absolute && !number(item.episode));
  const season = number(item.season) ?? number(numbered?.[1]) ?? number(seasonTag?.[1]);
  const episode = pack ? null : (number(item.episode) || number(numbered?.[2]) || (anime && season === null ? null : number(explicitEpisode?.[1])));
  const absoluteEpisode = anime && !pack && !episode ? (number(absolute?.[1]) || (season === null ? number(explicitEpisode?.[1]) : null) || null) : null;
  const indices = [numbered, seasonTag, absolute, range, explicitEpisode].filter(Boolean).map(match => match.index);
  return { season, episode, absoluteEpisode, pack, index: indices.length ? Math.min(...indices) : value.length };
}

function normalizeRelease(kind, item) {
  const releaseTitle = text(item.releaseTitle);
  if (!releaseTitle || (!item.hash && !item.proxies?.length)) return null;
  const anime = kind === 'anime';
  const ungrouped = anime ? releaseTitle.replace(/^(?:\[[^\]]+\]\s*)+/, '') : releaseTitle;
  const movieMark = /(?:[\[(](?:movie|film)[\])]|\s-\s(?:movie|film)(?=\s*(?:[\[(]|$)))/i;
  const explicitMovie = anime && (item.movie || movieMark.test(ungrouped) || /^\[(?:movie|film)\]/i.test(releaseTitle));
  const label = explicitMovie ? ungrouped.replace(movieMark, '').trim() : ungrouped;
  const { season, episode, absoluteEpisode, pack, index } = kind === 'movie' ? { index: label.length } : episodeDetails(label, item, anime);
  const unnumbered = season == null && !episode && !absoluteEpisode && !pack;
  const downloadKind = kind === 'movie' || explicitMovie && unnumbered ? 'movie' : 'show';
  const canChooseDownloadKind = anime && !explicitMovie && unnumbered;
  const format = /(?:^|[ ._[(])(?:480p|576p|720p|1080p|1440p|2160p|4k|uhd|web[ ._-]?(?:dl|rip)|bluray|hdtv|dvdrip|remux)(?=$|[ ._\])_-])/i.exec(label);
  const yearTag = /(?:^|[ ._[(])((?:19|20)\d{2})(?=$|[ ._\])_-])/g;
  const boundary = Math.min(index, format ? format.index : label.length, label.indexOf('[') < 0 ? label.length : label.indexOf('['));
  const yearMatch = [...label.slice(0, boundary).matchAll(yearTag)].pop();
  // A bare leading year can be the title. Otherwise require a trailing title-year tag.
  const releaseYear = yearMatch && yearMatch.index > 0 && /^[\s)_.-]*$/.test(label.slice(yearMatch.index + yearMatch[0].length, boundary)) ? yearMatch : null;
  const title = text(item.title, 300) || text(label.slice(0, releaseYear?.index ?? boundary).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').replace(/[\s_-]+$/, ''), 300) || releaseTitle;
  const tags = label.slice(releaseYear?.index ?? boundary);
  const audioHint = /\bdual[ ._-]*audio\b/i.test(tags) ? 'Dual audio' : /\b(?:multi(?:ple)?[ ._-]*audio|tri[ ._-]*audio)\b/i.test(tags) ? 'Multiple audio' : /\b(?:english|eng)[ ._-]*dub(?:bed)?\b/i.test(tags) ? 'English dub' : '';
  const subtitleHint = /\bmulti(?:ple)?[ ._-]*sub(?:s|titles?)?\b/i.test(tags) ? 'Multiple subtitles' : /\b(?:english|eng|en)[ ._-]*sub(?:s|titles?)?\b/i.test(tags) ? 'English subtitles' : '';
  return {
    hash: item.hash ?? null, kind, downloadKind, canChooseDownloadKind, title, releaseTitle, year: yearOf(item.year) || releaseYear?.[1] || '',
    tmdbId: normalizeTmdbId(item.tmdbId), imdbId: normalizeImdbId(item.imdbId),
    quality: resolution(text(item.quality, 30)) || resolution(releaseTitle) || 'Unknown', size: sizeDisplay(item),
    provider: item.provider, seeds: number(item.seeds), peers: number(item.peers),
    season: season ?? undefined, episode: episode ?? undefined, absoluteEpisode: absoluteEpisode ?? undefined,
    pack: pack || undefined, audioHint: audioHint || undefined, subtitleHint: subtitleHint || undefined
  };
}

const score = release => release.seeds ?? -1;

function acquisitionFor({ release, magnet, proxies, bareHash }) {
  if (magnet || !proxies.size) return { magnet };
  return {
    async resolve() {
      let failure;
      for (const resolve of proxies.values()) {
        try { return await resolve(); } catch (error) { failure = error; }
      }
      if (bareHash) return { hash: release.hash };
      throw failure;
    }
  };
}

function createReleaseDiscovery(providers, { prowlarrEnabled }) {
  const selections = new Map(), recent = new Map(), pending = new Map();

  async function discover(kind, terms, additionalOnly) {
    const requests = providers.filter(provider => provider.kinds.includes(kind) && (!terms[0] || provider.search) && (!additionalOnly || provider.additional))
      .flatMap(provider => terms.map(query => ({ provider, query })));
    const data = await Promise.allSettled(requests.map(({ provider, query }) => provider.list(kind, query)));
    const warnings = new Set(), found = new Map();
    for (const [index, response] of data.entries()) {
      if (response.status === 'rejected') {
        warnings.add(`${requests[index].provider.name} is unavailable. Try again later.`);
        continue;
      }
      for (const item of response.value) {
        const release = normalizeRelease(kind, item);
        if (!release) continue;
        const key = release.hash || item.identity;
        let entry = found.get(key);
        if (!entry) {
          entry = { release, proxies: new Map(), bareHash: false };
          found.set(key, entry);
        } else if (score(release) > score(entry.release)) {
          release.tmdbId ??= entry.release.tmdbId;
          release.imdbId ??= entry.release.imdbId;
          entry.release = release;
        } else {
          entry.release.tmdbId ??= release.tmdbId;
          entry.release.imdbId ??= release.imdbId;
        }
        if (item.magnet && (!entry.magnet || !entry.magnet.includes('&tr=') && item.magnet.includes('&tr='))) entry.magnet = item.magnet;
        if (item.hash && !item.magnet && !item.proxies?.length) entry.bareHash = true;
        for (const { identity, resolve } of item.proxies || []) {
          if (entry.proxies.size === 2) break;
          if (!entry.proxies.has(identity)) entry.proxies.set(identity, resolve);
        }
      }
    }
    const ranked = [...found.values()].sort((a, b) => score(b.release) - score(a.release)).slice(0, 100);
    const results = ranked.map(entry => {
      const { release } = entry;
      const selectionId = randomUUID();
      selections.set(selectionId, { release, ...acquisitionFor(entry), expires: Date.now() + 60 * 60_000 });
      return { ...release, selectionId };
    });
    while (selections.size > 1500) selections.delete(selections.keys().next().value);
    return { results, warnings: [...warnings], prowlarrEnabled };
  }

  return {
    async list(options) {
      const kind = options?.kind;
      if (!['movie', 'show', 'anime'].includes(kind)) throw new Error('Choose Movies, Series, or Anime.');
      const query = text(options.query, 200);
      const terms = [query];
      if (query && kind === 'anime' && Array.isArray(options.aliases)) {
        const seen = new Set([query.toLowerCase()]);
        for (const value of options.aliases.slice(0, 6)) {
          const term = text(value, 200);
          if (!term || seen.has(term.toLowerCase())) continue;
          seen.add(term.toLowerCase());
          terms.push(term);
          if (terms.length === 3) break;
        }
      }
      const additionalOnly = kind === 'movie' && !!query && options.additionalOnly === true;
      const key = JSON.stringify([kind, terms, additionalOnly]);
      const cached = recent.get(key);
      if (cached?.expires > Date.now() && cached.result.results.every(({ selectionId }) => selections.has(selectionId))) return cached.result;
      if (pending.has(key)) return pending.get(key);
      const task = discover(kind, terms, additionalOnly).then(result => {
        if (!result.warnings.length) {
          recent.set(key, { result, expires: Date.now() + 60_000 });
          while (recent.size > 20) recent.delete(recent.keys().next().value);
        }
        return result;
      }).finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    },
    select(selectionId) {
      const item = selections.get(selectionId);
      if (!item || item.expires < Date.now()) throw new Error('Search again to refresh this release before downloading.');
      return item;
    }
  };
}

module.exports = { canonicalHash, cleanMagnet, createReleaseDiscovery, normalizeImdbId, normalizeTmdbId };
