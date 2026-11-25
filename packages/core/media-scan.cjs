const path = require('node:path');
const { createHash } = require('node:crypto');

const VIDEO = new Set('mkv mp4 m4v avi mov webm flv wmv mpg mpeg ts mts m2ts vob ogv 3gp'.split(' '));
const idFor = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const numberedSeason = folder => folder.match(/^(?:s|season[ ._-]*)(\d+)$/i)?.[1];
const seasonNumber = folder => /^specials$/i.test(folder) ? '0' : numberedSeason(folder);
const isContainer = folder => /^(?:media|movies?|shows?|tv|tv[ ._-]*shows?|videos?|library|collection)$/i.test(folder);
const clean = value => value.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
const sortPaths = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const releaseTags = /\b(?:480p|720p|1080p|2160p|\d{3,4}x\d{3,4}|BluRay|WEB-DL|x264|x265|HEVC)\b.*$/i;
const stripRelease = name => name.replace(releaseTags, '').replace(/[\s._\[(]+$/, '');
const extraLabel = '(?:samples?|trailers?|extras?|featurettes?|behind[ ._-]+the[ ._-]+scenes)';
const extraDirectory = new RegExp(`^${extraLabel}$`, 'i');
const extraFile = new RegExp(`(?:^|[ ._\\[(\\-])${extraLabel}[)\\]]?$`, 'i');

function titleOf(name) {
  const release = stripRelease(name);
  const year = release.match(/\s*[[(]((?:19|20)\d{2})[)\]]$/) || release.match(/[ ._]((?:19|20)\d{2})$/);
  if (year && Number(year[1]) <= new Date().getFullYear() + 1) {
    const title = clean(release.slice(0, year.index));
    if (title) return { title, year: Number(year[1]) };
  }
  return { title: clean(release) || clean(name), year: null };
}

function describe(file) {
  const name = path.basename(file, path.extname(file));
  const episode = name.match(/S(\d{1,2})[ ._-]*E(\d{1,4})(?!\d)/i) || name.match(/(?<!\d)(\d{1,2})x(\d{2,4})(?!\d)/i);
  const numbered = name.match(/(?:^|[ ._-])(?:chapter|episode|ep)[ ._-]*(\d+)/i)
    || name.match(/^e(\d+)(?:[ ._-]|$)/i) || name.match(/^(?!(?:19|20)\d{2}[ ._-])(\d+)[ ._-]/);
  return {
    ...titleOf(name), season: episode ? Number(episode[1]) : null, episode: episode ? Number(episode[2]) : null,
    folderEpisode: numbered ? Number(numbered[1]) : null,
    group: episode ? clean(name.slice(0, episode.index)).replace(/[-\s]+$/, '') || path.basename(path.dirname(file)) : null
  };
}

async function walk(fs, root, extensions, { allowHiddenFiles = false, onDirectoryError } = {}) {
  const files = [];
  async function visit(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if (dir === root || !onDirectoryError) throw error;
      onDirectoryError(error, dir);
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && (entry.isDirectory() || !allowHiddenFiles)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && !extraDirectory.test(entry.name)) await visit(file);
      else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        const type = ext.slice(1).toLowerCase();
        if (extensions.has(type) && (!VIDEO.has(type) || !extraFile.test(titleOf(path.basename(file, ext)).title))) files.push(file);
      }
    }
  }
  await visit(root);
  return files.sort(sortPaths);
}

function titleFolders(root, files, season, useSeasonRoot = false) {
  const container = isContainer(path.basename(root));
  const seasonRoot = season(path.basename(root)) !== undefined;
  const childSeasons = files.some(file => season(path.relative(root, file).split(path.sep)[0]) !== undefined);
  const rootIsTitle = !container && (childSeasons || files.some(file => path.dirname(file) === root));
  return files.map(file => {
    if (seasonRoot) return path.dirname(root);
    const directories = path.relative(root, path.dirname(file)).split(path.sep).filter(Boolean);
    if (rootIsTitle || useSeasonRoot && childSeasons && (!directories.length || season(directories[0]) !== undefined)) return root;
    let folder = root;
    for (const directory of directories) {
      if (season(directory) !== undefined) break;
      folder = path.join(folder, directory);
      if (!isContainer(directory)) break;
    }
    return folder !== root || !container ? folder : undefined;
  });
}

function locateTitles(root, files, wasShow = () => false) {
  const current = titleFolders(root, files, seasonNumber, true);
  // Existing shows keep their folder ID even when a Specials directory becomes a season.
  const previous = titleFolders(root, files, numberedSeason);
  return files.map((file, i) => ({
    file,
    folder: previous[i] && previous[i] !== current[i] && wasShow(previous[i]) ? previous[i] : current[i]
  }));
}

function groupVideos(entries, wasShow = () => false) {
  const groups = new Map();
  for (const { file, folder, root } of entries) {
    const info = describe(file);
    const key = folder ? `dir:${path.resolve(folder)}` : info.group ? `name:${root || path.dirname(file)}:${info.group.toLowerCase()}` : `file:${file}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ file, info, folder });
  }
  const rows = new Map();
  for (const [key, group] of groups) {
    const folder = group[0].folder;
    const described = group.map(({ file, info }) => {
      const directories = folder ? path.relative(folder, path.dirname(file)).split(path.sep) : [];
      const season = directories.map(seasonNumber).find(value => value !== undefined) ?? seasonNumber(path.basename(folder || ''));
      return { file, info, season };
    });
    const isShow = described.some(({ info, season }) => info.episode !== null || season !== undefined || (folder && info.folderEpisode !== null))
      || Boolean(folder && group.length > 1 && wasShow(folder));
    const first = group[0].info;
    const groupName = folder || first.group ? titleOf(folder ? path.basename(folder) : first.group) : first;
    const seasons = new Map();
    for (const { file, info, season } of described) {
      const separateMovie = !isShow && group.length > 1;
      const row = {
        title: info.title, group: separateMovie ? info.title : groupName.title, year: (separateMovie ? null : groupName.year) ?? info.year,
        groupKey: separateMovie ? `file:${file}` : key, kind: isShow ? 'show' : 'movie', season: null, episode: null
      };
      if (isShow) {
        row.season = info.season ?? Number(season ?? 1);
        row.episode = info.episode ?? info.folderEpisode;
        if (!seasons.has(row.season)) seasons.set(row.season, []);
        seasons.get(row.season).push({ file, row });
      }
      rows.set(file, row);
    }
    for (const episodes of seasons.values()) {
      let highest = 0;
      for (const { row } of episodes) highest = Math.max(highest, row.episode ?? 0);
      for (const { row } of episodes.sort((a, b) => sortPaths(a.file, b.file))) if (row.episode === null) row.episode = ++highest;
    }
  }
  return rows;
}

module.exports = { VIDEO, idFor, describe, walk, locateTitles, groupVideos };
