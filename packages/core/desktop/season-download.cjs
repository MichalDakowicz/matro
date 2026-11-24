const { createHash } = require('node:crypto');
const { episodeOf, animeAbsoluteEpisode } = require('./download-layout.cjs');

const videoExtension = /\.(?:mkv|mp4|m4v|avi|mov|webm|ts|m2ts)$/i;
const episodeCode = /\b(?:S\d{1,2}[ ._-]*E\d{1,3}|\d{1,2}x\d{2,3}|(?:ep(?:isode)?|e)[ ._-]*\d{1,3})\b/i;
const technicalTag = /\b(?:\d{3,4}p|4k|web(?:[ ._-]?(?:dl|rip))?|hdtv|blu[ ._-]?ray|b[dr]rip|[xh]26[45]|hevc|av1|hi10p|\d{1,2}bit|dual[ ._-]?audio|multi(?:sub)?|dub(?:bed)?|subbed)\b/i;
const normalized = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function seasonEpisodes(list, season, from = 1) {
  if (!Array.isArray(list)) throw new Error('The season episode list is unavailable.');
  const episodes = new Set(), absolute = new Map();
  let sequential = true, previousSeason = 0, previousEpisode = 0;
  for (const { season: number, number: episode } of list) {
    if (!Number.isInteger(number) || number < 1 || !Number.isInteger(episode) || episode < 1 || episode > 999) continue;
    if (number === season && episode >= from) episodes.add(episode);
    if (number === previousSeason + 1) { previousSeason = number; previousEpisode = 0; }
    sequential &&= number === previousSeason && episode === previousEpisode + 1;
    if (sequential) absolute.set(absolute.size + 1, { season: number, episode });
    previousEpisode = episode;
  }
  return { episodes, absolute };
}

function identifyEpisode(item, absolute, anime) {
  const name = item.filename.replace(videoExtension, '').replace(/\[(?:[a-f0-9]{8}|eztvx?\.[a-z0-9.]+)\]/gi, '').trim();
  const code = name.match(episodeCode);
  const absoluteNumber = !code && anime ? animeAbsoluteEpisode(name) : null;
  const marker = code || absoluteNumber;
  if (!marker || !item.release.quality) return null;

  // Ranges, multi-episode filenames and fractional anime specials aren't singles.
  const tail = name.slice(marker.index + marker[0].length);
  if (/^(?:[ ._-]*e\d|[ ._]*[-~][ ._]*(?:s\d{1,2}e|e)?\d|\.\d+\s*[[(])/i.test(tail) || episodeCode.test(tail)) return null;
  const parsed = code ? episodeOf(code[0], item.season ?? 1) : absolute.get(Number(absoluteNumber[1]));
  if (!parsed) return null;
  if (code && ((item.season > 0 && item.season !== parsed.season) || (item.episode > 0 && item.episode !== parsed.episode))) return null;
  if (absoluteNumber && item.episode > 0 && item.episode !== parsed.episode && item.episode !== Number(absoluteNumber[1])) return null;
  if (absoluteNumber && item.season > 1 && item.season !== parsed.season) return null;

  const bracketGroup = name.match(/^\[([^\]]+)\]/);
  const endGroup = tail.match(/-([\w]+(?:-[\w]+)*)$/);
  const group = bracketGroup?.[1] || endGroup?.[1];
  const tags = bracketGroup ? tail : tail.slice(0, endGroup?.index);
  const technical = tags.match(technicalTag);
  if (!group || !technical) return null;
  const format = normalized(tags.slice(technical.index));
  const prefix = normalized(name.slice(bracketGroup?.[0].length || 0, marker.index));
  if (!prefix || !normalized(group)) return null;
  return { ...parsed, absoluteEpisode: absoluteNumber ? Number(absoluteNumber[1]) : undefined, group, key: JSON.stringify([prefix, normalized(group), item.release.quality, format]) };
}

function isSeasonPack(item, season) {
  if (item.episode > 0 || episodeCode.test(item.filename) || /\b(?:part|vol(?:ume)?|cour|episodes)[ ._-]*\d/i.test(item.filename)) return false;
  const code = item.filename.match(/\b(?:S|Season[ ._-]*)(\d{1,2})\b/i);
  if (!code || Number(code[1]) !== season || (item.season > 0 && item.season !== season)) return false;
  const tail = item.filename.slice(code.index + code[0].length);
  return !/^[ ._]*[-~+&][ ._]*(?:s|season[ ._-]*)?\d|\b\d{1,3}\s*[-~]\s*\d{1,3}\b/i.test(tail);
}

const stronger = (a, b) => b.seeds - a.seeds || a.release.hash.localeCompare(b.release.hash);
function addSeasonCandidates(search, items, { anime, season }) {
  for (const item of items) {
    // A pack always holds the whole season, so a from-episode search skips packs.
    if (!(search.from > 1) && isSeasonPack(item, season)) {
      if (!search.pack || stronger(item, search.pack) < 0) search.pack = item;
      continue;
    }
    const match = identifyEpisode(item, search.absolute, anime);
    if (!match || match.season !== season || !search.episodes.has(match.episode)) continue;
    if (!search.groups.has(match.key)) search.groups.set(match.key, { group: match.group, episodes: new Map() });
    const group = search.groups.get(match.key).episodes;
    const previous = group.get(match.episode);
    if (!previous || stronger(item, previous) < 0) group.set(match.episode, { ...item, absoluteEpisode: match.absoluteEpisode });
  }
}

function bestSeasonDownload(search, showId, season) {
  let best = null, coverage = 0;
  for (const { group, episodes } of search.groups.values()) {
    coverage = Math.max(coverage, episodes.size);
    if (episodes.size < 2 || episodes.size !== search.episodes.size) continue;
    const ordered = [...episodes].sort(([a], [b]) => a - b);
    const releases = ordered.map(([episode, item]) => ({ ...item.release, season, episode, absoluteEpisode: item.absoluteEpisode, seasonBatch: true }));
    if (new Set(releases.map(release => release.hash)).size !== releases.length) continue;
    const seeds = Math.min(...ordered.map(([, item]) => item.seeds));
    if (best && best.seeds >= seeds) continue;
    const id = createHash('sha256').update([showId, season, ...releases.map(release => release.hash)].join(':')).digest('hex');
    best = { id, group, season, quality: releases[0].quality, count: releases.length, seeds, releases };
  }
  return { best, coverage };
}

module.exports = { seasonEpisodes, addSeasonCandidates, bestSeasonDownload };
