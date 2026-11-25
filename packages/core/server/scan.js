const fs = require('node:fs/promises');
const path = require('node:path');
const { movieEditions } = require('./movie-editions');
const { VIDEO, idFor, describe, walk, locateTitles, groupVideos } = require('../media-scan.cjs');

async function scan(root, exclude, knownShows) {
  root = path.resolve(root);
  const walked = await walk(fs, root, VIDEO);
  const excluded = await exclude?.(root);
  const files = excluded ? walked.filter(file => !excluded.has(file)) : walked;
  const wasShow = folder => knownShows?.has(idFor(`dir:${folder}`));
  const entries = locateTitles(root, files, wasShow).map(entry => ({ ...entry, root }));
  // Clear the old multi-file show classification when the files identify a movie with editions.
  const current = groupVideos(entries);
  const editions = movieEditions(entries, current);
  const editionFolders = new Set(entries.filter(({ file }) => editions.has(file)).map(({ folder }) => folder).filter(Boolean));
  const groups = knownShows?.size ? groupVideos(entries, folder => !editionFolders.has(folder) && wasShow(folder)) : current;
  return files.map(file => {
    const { groupKey, group, ...row } = groups.get(file);
    const edition = editions.get(file);
    return { ...row, path: file, id: idFor(file), groupId: idFor(groupKey), groupTitle: edition?.title || group,
      year: edition?.year ?? row.year, editionGroup: edition?.group ?? null, editionLabel: edition?.label ?? null };
  });
}

module.exports = { scan, describe, idFor, VIDEO };
