const path = require('node:path');
const os = require('node:os');
const VIDEO = /\.(mkv|mp4|m4v|avi|mov|webm|flv|wmv|mpg|mpeg|ts|mts|m2ts|vob|ogv|3gp)$/i;
const SUBTITLE = /\.(srt|ass|ssa|vtt)$/i;
const EXTRA = /(?:^|[\/ ._\-])(sample|samples|trailer|trailers|extras?|featurettes?|screenshots?)(?:[\/ ._\-]|$)/i;
const absolute = value => typeof value === 'string' && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) && !/[\0\r\n]/.test(value);
const clean = value => String(value || '').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i, '_$1').slice(0, 140).trim() || 'Untitled';
const join = (root, relative) => (/^[a-z]:[\\/]|^\\\\/i.test(root) ? path.win32 : path.posix).join(root, relative);
function defaultStorage(target, savePath = '', videos = path.join(os.homedir(), 'Videos')) {
  const movieRoot = savePath && !/^\/mnt\/media\/downloads\/(complete|incomplete)\/?$/.test(savePath) ? savePath : target === 'server' ? '/mnt/media/Movies' : path.join(videos, 'Movies');
  const paths = /^[a-z]:[\\/]|^\\\\/i.test(movieRoot) ? path.win32 : path.posix;
  return { movieRoot, showRoot: paths.join(paths.dirname(movieRoot), 'Shows'), movieFolders: 'title', showFolders: 'season', naming: 'clean', subtitles: true };
}
function storageOptions(value, target, savePath, videos) {
  const result = { ...defaultStorage(target, savePath, videos), ...(value || {}) };
  for (const name of ['movieRoot', 'showRoot']) if (!absolute(result[name]) || result[name].length > 1500) throw new Error('Movie and show roots must be absolute folders on the destination machine.');
  if (!['title', 'title-year', 'flat', 'original'].includes(result.movieFolders) || !['season', 'title', 'flat', 'original'].includes(result.showFolders) || !['clean', 'original'].includes(result.naming) || typeof result.subtitles !== 'boolean') throw new Error('Choose a supported storage layout and filename style.');
  return Object.fromEntries(['movieRoot', 'showRoot', 'movieFolders', 'showFolders', 'naming', 'subtitles'].map(key => [key, result[key]]));
}
function safeRelative(value) {
  const name = String(value).replace(/\\/g, '/');
  if (!name || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(part => !part || part === '.' || part === '..' || /[\x00-\x1f]/.test(part))) throw new Error('Torrent contains an unsafe file path; it was left stopped.');
  return name;
}
function episodeOf(name, fallbackSeason = 1) {
  const match = name.match(/\bS(\d{1,2})[ ._-]*E(\d{1,3})\b/i) || name.match(/\b(\d{1,2})x(\d{2,3})\b/i);
  if (match) return { season: +match[1], episode: +match[2] };
  const episode = path.posix.basename(name).match(/(?:^|\b)(?:e|ep|episode|chapter)[ ._-]*(\d{1,3})\b/i);
  const season = name.match(/(?:^|\/)(?:s|season[ ._-]*)(\d{1,2})(?:\/|$)/i);
  return episode ? { season: season ? +season[1] : fallbackSeason, episode: +episode[1] } : null;
}
function planDownload(files, release, storage) {
  if (!Array.isArray(files) || files.length > 10000) throw new Error('Invalid torrent file list.');
  const entries = files.map((file, position) => ({ ...file, index: file.index ?? position, name: safeRelative(file.name) }));
  if (entries.some(file => !Number.isInteger(file.index) || file.index < 0) || new Set(entries.map(file => file.index)).size !== entries.length) throw new Error('Invalid torrent file indexes.');
  let videos = entries.filter(file => VIDEO.test(file.name) && !EXTRA.test(file.name) && Number(file.size) > 0);
  if (!videos.length) throw new Error('No playable movie or episode found; torrent left stopped.');
  const videoCount = videos.length;
  const kind = release.kind === 'show' ? 'show' : 'movie';
  if (kind === 'movie') videos = [videos.sort((a, b) => b.size - a.size)[0]];
  else if (release.episode > 0) {
    const matches = videos.filter(file => { const found = episodeOf(file.name); return found && found.season === release.season && found.episode === release.episode; });
    if (matches.length) videos = matches;
    else if (videos.length !== 1) throw new Error('Could not identify the selected episode inside this torrent; it was left stopped.');
  }
  const title = clean(release.title), year = /^\d{4}$/.test(String(release.year)) ? String(release.year) : videos[0].name.match(/\b(19\d\d|20\d\d)\b/)?.[1] || '';
  const titleYear = title + (year ? ` (${year})` : '');
  const root = kind === 'show' ? storage.showRoot : storage.movieRoot;
  const output = [], used = new Set();
  const unique = (name, index) => {
    let candidate = name;
    if (used.has(candidate.toLowerCase())) { const ext = path.posix.extname(name); candidate = name.slice(0, -ext.length) + `.${index}` + ext; }
    used.add(candidate.toLowerCase()); return candidate;
  };
  for (const video of videos) {
    const episode = kind === 'show' ? episodeOf(video.name, release.season ?? 1) || (videos.length === 1 && release.episode > 0 ? { season: release.season ?? 1, episode: release.episode } : null) : null;
    if (kind === 'show' && !episode && storage.showFolders === 'season') throw new Error('Season/episode numbers are missing. Choose the show-folder layout or use numbered episode files.');
    const code = episode ? `S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}` : '';
    const folderMode = kind === 'show' ? storage.showFolders : storage.movieFolders;
    const folder = folderMode === 'original' ? path.posix.dirname(video.name) : folderMode === 'flat' ? '' : folderMode === 'title-year' ? titleYear : kind === 'show' && folderMode === 'season' ? `${title}/S${String(episode.season).padStart(2, '0')}` : title;
    const original = path.posix.basename(video.name), ext = path.posix.extname(original).toLowerCase();
    const resolution = clean(release.quality || original.match(/\b(\d{3,4}p|4k)\b/i)?.[1] || 'resolution unknown');
    const stem = (storage.naming === 'original' ? clean(original.slice(0, -ext.length)) : kind === 'movie' ? `${titleYear} [${resolution}]` : code ? `${code} ${titleYear} [${resolution}]` : `${clean(original.slice(0, -ext.length))} [${resolution}]`) + (release.edition || '');
    const name = unique(path.posix.join(folder, stem + ext), video.index);
    output.push({ index: video.index, oldPath: video.name, newPath: name, type: 'video' });
    const subtitles = storage.subtitles ? entries.filter(file => SUBTITLE.test(file.name) && !EXTRA.test(file.name) && Number(file.size) <= 16 * 1024 * 1024 && !output.some(chosen => chosen.index === file.index) && (kind === 'movie' || videoCount === 1 && release.episode > 0 || (() => { const sub = episodeOf(file.name, release.season || 1); return sub && episode && sub.season === episode.season && sub.episode === episode.episode || path.posix.basename(file.name).toLowerCase().startsWith(original.slice(0, -ext.length).toLowerCase() + '.'); })())) : [];
    for (const sub of subtitles) {
      const subExt = path.posix.extname(sub.name).toLowerCase();
      const base = path.posix.basename(sub.name, path.posix.extname(sub.name));
      const language = base.match(/(?:^|[ ._\-])(en(?:g(?:lish)?)?|pl|pol(?:ish)?|ja|jpn|fr|fre(?:nch)?|de|ger(?:man)?|es|spa(?:nish)?)(?:[ ._\-]|$)/i)?.[1]?.toLowerCase();
      const normalized = ({ english: 'en', eng: 'en', polish: 'pl', pol: 'pl', jpn: 'ja', french: 'fr', fre: 'fr', german: 'de', ger: 'de', spanish: 'es', spa: 'es' })[language] || language;
      const suffix = [normalized || `sub${sub.index}`, /forced/i.test(base) ? 'forced' : '', /\b(sdh|hi)\b/i.test(base) ? 'sdh' : ''].filter(Boolean).join('.');
      const subName = unique(name.slice(0, -ext.length) + '.' + suffix + subExt, sub.index);
      output.push({ index: sub.index, oldPath: sub.name, newPath: subName, type: 'subtitle' });
    }
  }
  return { root, kind, files: output, skip: entries.filter(file => !output.some(chosen => chosen.index === file.index)).map(file => file.index) };
}
module.exports = { defaultStorage, storageOptions, planDownload, clean, episodeOf, join, absolute };
