const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Folder grouping follows the desktop player: one video in a title folder is a movie, several are a show, and
// S01/Season 1 folders stay seasons of their parent title.
const VIDEO = new Set('mkv mp4 m4v avi mov webm flv wmv mpg mpeg ts mts m2ts vob ogv 3gp'.split(' '));
const idFor = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const seasonNumber = folder => folder.match(/^(?:s|season[ ._-]*)(\d+)$/i)?.[1];
const isContainer = folder => /^(?:media|movies?|shows?|tv|tv[ ._-]*shows?|videos?|library|collection)$/i.test(folder);
const clean = value => value.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();

function titleOf(name) {
  const year = name.match(/[(\[. ]((?:19|20)\d{2})[)\]. ]?/)?.[1];
  const stripped = clean(name.replace(/[(\[]?\b(?:19|20)\d{2}\b[)\]]?.*$/, '').replace(/\b(480p|720p|1080p|2160p|BluRay|WEB-DL|x264|x265|HEVC)\b.*$/i, ''));
  return { title: stripped || clean(name), year: year ? Number(year) : null };
}
function describe(file) {
  const name = path.basename(file, path.extname(file));
  const episode = name.match(/S(\d{1,2})[ ._-]*E(\d{1,3})/i) || name.match(/(\d{1,2})x(\d{2,3})/i);
  return { title: titleOf(name).title, year: titleOf(name).year, season: episode ? Number(episode[1]) : null, episode: episode ? Number(episode[2]) : null,
    group: episode ? clean(name.slice(0, episode.index)).replace(/[-\s]+$/, '') || path.basename(path.dirname(file)) : null };
}

async function walk(root) {
  const files = [];
  async function visit(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (error) { if (dir === root) throw error; return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && VIDEO.has(path.extname(entry.name).slice(1).toLowerCase())) files.push(file);
    }
  }
  await visit(root);
  return files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function titleFolder(root, rootIsTitle, file) {
  if (seasonNumber(path.basename(root)) !== undefined) return path.dirname(root);
  if (rootIsTitle) return root;
  let titlePath = root;
  for (const directory of path.relative(root, path.dirname(file)).split(path.sep).filter(Boolean)) {
    if (seasonNumber(directory) !== undefined) break;
    titlePath = path.join(titlePath, directory);
    if (!isContainer(directory)) break;
  }
  return titlePath !== root || !isContainer(path.basename(root)) ? titlePath : null;
}

// Returns catalog rows (without ids of the folder or timestamps) for every video under root.
async function scan(root) {
  root = path.resolve(root);
  const files = await walk(root);
  const directVideo = files.some(file => path.dirname(file) === root);
  const seasonChildren = files.some(file => seasonNumber(path.relative(root, file).split(path.sep)[0]) !== undefined);
  const rootIsTitle = !isContainer(path.basename(root)) && (directVideo || seasonChildren);
  const groups = new Map();
  for (const file of files) {
    const info = describe(file), folder = titleFolder(root, rootIsTitle, file);
    // Files loose in a collection root group by the name in the file, so Show.S01E01 and Show.S01E02 still pair up.
    const key = folder ? `dir:${path.resolve(folder)}` : info.group ? `name:${root}:${info.group.toLowerCase()}` : `file:${file}`;
    if (!groups.has(key)) groups.set(key, { folder, name: info.group, entries: [] });
    groups.get(key).entries.push({ file, info });
  }
  const rows = [];
  for (const [key, group] of groups) {
    const groupId = idFor(key), isShow = group.entries.length > 1 || (group.entries[0].info.episode !== null && !group.folder);
    const name = group.folder ? path.basename(group.folder) : group.name || group.entries[0].info.title;
    const { title, year } = titleOf(name);
    const seasons = new Map();
    for (const { file, info } of group.entries) {
      const row = { path: file, title: info.title, groupId, groupTitle: title, year: year ?? info.year, kind: isShow ? 'show' : 'movie', season: null, episode: null };
      if (isShow) {
        const folders = group.folder ? path.relative(group.folder, path.dirname(file)).split(path.sep) : [];
        row.season = info.season ?? Number(folders.map(seasonNumber).find(value => value !== undefined) ?? 1);
        const numbered = path.basename(file).match(/(?:chapter|episode|ep)[ ._-]*(\d+)/i) || path.basename(file).match(/^(\d+)[ ._-]/);
        row.episode = info.episode ?? (numbered ? Number(numbered[1]) : null);
        if (!seasons.has(row.season)) seasons.set(row.season, []);
        seasons.get(row.season).push(row);
      }
      rows.push(row);
    }
    for (const episodes of seasons.values()) {
      const used = new Set(episodes.map(row => row.episode).filter(value => value !== null));
      let next = used.has(1) ? 0 : 1;
      for (const row of episodes) if (row.episode === null) { while (used.has(next)) next++; row.episode = next; used.add(next++); }
    }
  }
  return rows.map(row => ({ ...row, id: idFor(row.path) }));
}
module.exports = { scan, describe, idFor, VIDEO };
