const path = require('node:path');
const { describe, idFor } = require('../media-scan.cjs');

const CUT = /\b(?:director['’]?s[ ._-]+cut|(?:the[ ._-]+)?(?:theatrical|extended|final|alternate|special|collector['’]?s)(?:[ ._-]+(?:cut|edition|version))?|unrated|remastered|restored|imax)\b/gi;
const QUALITY = /\b(?:\d{3,4}p|4k|uhd|x26[45]|h[ .]?[ ]?26[45]|hevc|av1)\b/gi;
const separator = /^[ ._[\]()-]+|[ ._[\]()-]+$/g;
const normalized = name => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function movieEditions(entries, rows) {
  const candidates = new Map(), editions = new Map();
  for (const { file, folder } of entries) {
    const row = rows.get(file);
    if (row.kind !== 'movie' || !folder) continue;
    const filename = path.basename(file, path.extname(file));
    const words = filename.replace(/[._]/g, ' '), cuts = words.match(CUT) || [], qualities = words.match(QUALITY) || [];
    const stem = words.replace(CUT, '').replace(/\(\s*\)|\[\s*\]/g, '').replace(/^[ ._-]+|[ ._-]+$/g, '');
    const parsed = describe(stem + path.extname(file)), directory = describe(folder + '.mkv');
    const title = parsed.title.replace(QUALITY, '').replace(separator, '').replace(/\s+/g, ' ').trim() || directory.title;
    const year = parsed.year ?? row.year ?? directory.year ?? null;
    const key = path.resolve(folder) + ':' + normalized(title) + ':' + (year || '');
    const qualifiers = [...cuts, ...qualities].map(label => label.trim());
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push({ file, title, year, label: qualifiers.length ? qualifiers.join(' · ') : filename });
  }
  for (const [key, members] of candidates) {
    if (members.length < 2) continue;
    const group = idFor('editions:' + key);
    for (const member of members) editions.set(member.file, { ...member, group });
  }
  return editions;
}
module.exports = { movieEditions };
