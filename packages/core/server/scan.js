const fs = require('node:fs/promises');
const path = require('node:path');
const { VIDEO, idFor, describe, walk, locateTitles, groupVideos } = require('../media-scan.cjs');

async function scan(root, exclude) {
  root = path.resolve(root);
  const walked = await walk(fs, root, VIDEO);
  const excluded = await exclude?.(root);
  const files = excluded ? walked.filter(file => !excluded.has(file)) : walked;
  const entries = locateTitles(root, files).map(entry => ({ ...entry, root }));
  const groups = groupVideos(entries);
  return files.map(file => {
    const { groupKey, group, ...row } = groups.get(file);
    return { ...row, path: file, id: idFor(file), groupId: idFor(groupKey), groupTitle: group };
  });
}

module.exports = { scan, describe, idFor, VIDEO };
