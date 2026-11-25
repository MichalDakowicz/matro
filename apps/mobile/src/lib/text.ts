/** "1 season", "2 seasons". */
export const plural = (count: number, noun: string, many = noun + 's') => `${count} ${count === 1 ? noun : many}`;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Episode names parsed from file names often repeat the show and the code: "Lighthouse Keepers S01E01 Arrival" -> "Arrival". */
export function cleanEpisodeName(name: string, show: string, episode?: number | null) {
  let text = name.trim();
  if (show.trim()) text = text.replace(new RegExp('^' + show.trim().split(/\s+/).map(escape).join('[\\s._-]+') + '[\\s._-]*', 'i'), '');
  text = text.replace(/^(?:S\d{1,2}[\s._-]*E\d{1,3}|\d{1,2}x\d{1,3})\b[\s._:-]*/i, '');
  if (episode != null) text = text.replace(new RegExp('^0*' + episode + '[\\s.)_-]+(?=\\S)'), '');
  return text || (episode != null ? `Episode ${episode}` : name.trim());
}

/** Movies show their year; shows their size. */
export const titleMeta = (kind: string, year: string | number | undefined, seasons: number, episodes: number) =>
  kind === 'show' ? `${plural(seasons, 'season')} · ${plural(episodes, 'ep')}` : kind === 'audio' ? 'Audio' : year ? String(year) : '';

/** Recent searches: newest first, no repeats, nothing shorter than two letters. */
export function rememberQuery(list: string[], query: string, limit = 6) {
  const text = query.trim().replace(/\s+/g, ' ');
  if (text.length < 2) return list;
  return [text, ...list.filter(entry => entry.toLowerCase() !== text.toLowerCase())].slice(0, limit);
}

/** 112 -> "1 h 52 m", 44 -> "44 min". */
export const runtimeText = (minutes: number) => { const h = Math.floor(minutes / 60), m = Math.round(minutes % 60); return h ? `${h} h ${m} m` : `${m} min`; };
