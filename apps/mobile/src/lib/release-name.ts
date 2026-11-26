// Torrent names arrive as "www.UIndex.org - Ghost in the Shell 1995 BluRay 1080p DDP 5 1 x264-hallowed".
// Show the title and year, and keep the quality/source as a short detail line.
const SOURCE = /\b(blu-?ray|bdrip|brrip|web-?dl|web-?rip|hdtv|dvdrip|hdrip|remux)\b/i;
const QUALITY = /\b(480p|576p|720p|1080p|2160p|4k)\b/i;
const MARKER = /\b(?:(?:19|20)\d{2}|S\d{1,2}(?:E\d{1,3})?|\d{3,4}p|4k|blu-?ray|bdrip|brrip|web-?dl|web-?rip|hdtv|dvdrip|hdrip|remux)\b/i;

export function releaseName(raw: string): { title: string; detail: string } {
  let name = raw.trim()
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^(?:www\.)?[\w-]+(?:\.[\w-]+)*\.(?:org|com|net|to|cc|io|me|ws)\s*[-–—]\s*/i, '');
  if (!/\s/.test(name)) name = name.replace(/[._]+/g, ' ');
  const year = name.match(/\b((?:19|20)\d{2})\b/)?.[1];
  const marker = name.search(MARKER);
  const title = (marker > 0 ? name.slice(0, marker) : name).replace(/[\s([\-–—._]+$/, '').replace(/\s+/g, ' ').trim();
  if (!title) return { title: raw.trim(), detail: '' };
  const detail = [name.match(QUALITY)?.[1]?.replace(/^4k$/i, '2160p'), name.match(SOURCE)?.[1]].filter(Boolean).join(' · ');
  return { title: year && !title.includes(year) ? `${title} (${year})` : title, detail };
}

/** qBittorrent state names in plain words. */
export function transferLabel(state: string) {
  if (/^(downloading|forcedDL|metaDL|forcedMetaDL|allocating)$/.test(state)) return 'Downloading';
  if (state === 'stalledDL') return 'Waiting for sources';
  if (/^(pausedDL|stoppedDL|pausedUP|stoppedUP)$/.test(state)) return 'Paused';
  if (/^(queuedDL|queuedUP)$/.test(state)) return 'Queued';
  if (/^(checking|moving)/.test(state)) return 'Checking files';
  if (/^(error|missingFiles|unknown)$/.test(state)) return 'Needs attention';
  if (/UP$/.test(state)) return 'Seeding';
  return state;
}
