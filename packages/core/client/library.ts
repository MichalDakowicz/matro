import type { Item, Library, Metadata, Track, TrackChoice } from './server';
export const trackKey = (item: Item) => item.groupId || item.group;
export const titleKey = (item: Item) => item.kind === 'show' ? item.groupId || item.group : item.id;
export const metadataFor = (data: Library, item: Item): Metadata => data.metadata[titleKey(item)] || data.metadata[item.id] || {};
export const nameFor = (data: Library, item: Item) => metadataFor(data, item).title || item.group;
export const episodeName = (data: Library, item: Item) => metadataFor(data, item).episodes?.[String(item.season)]?.[String(item.episode)]?.name || item.title;
export const formatTime = (value: number) => {
  const n = Math.max(0, Math.floor(value || 0));
  return `${n >= 3600 ? Math.floor(n / 3600) + ':' : ''}${String(Math.floor(n / 60) % 60).padStart(n >= 3600 ? 2 : 1, '0')}:${String(n % 60).padStart(2, '0')}`;
};
export function groupLibrary(items: Item[]) {
  const groups = new Map<string, Item[]>();
  for (const item of items) { const key = titleKey(item); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(item); }
  for (const group of groups.values()) group.sort((a, b) => (a.season || 0) - (b.season || 0) || (a.episode || 0) - (b.episode || 0) || a.title.localeCompare(b.title, undefined, { numeric: true }));
  return [...groups.values()];
}
export const resumeItem = (data: Library, items: Item[]) => items.find(i => data.progress[i.id]?.position > 0 && !data.progress[i.id]?.completed) || items.find(i => !data.progress[i.id]?.completed) || items[0];
export const statusOf = (data: Library, items: Item[]) => items.every(i => data.progress[i.id]?.completed) ? 'done' : items.some(i => data.progress[i.id]?.position > 0 || data.progress[i.id]?.completed) ? 'progress' : 'new';
export function continueItems(data: Library, groups: Item[][]) {
  return groups.flatMap(items => {
    const recent = items.filter(i => data.progress[i.id] && !data.progress[i.id].hidden).sort((a, b) => data.progress[b.id].updated - data.progress[a.id].updated)[0];
    if (!recent) return [];
    const target = data.progress[recent.id].completed ? items.find(i => !data.progress[i.id]?.completed && ((i.season || 0) > (recent.season || 0) || ((i.season || 0) === (recent.season || 0) && (i.episode || 0) > (recent.episode || 0)))) : recent;
    return target && (recent.kind === 'show' || !data.progress[recent.id]?.completed) ? [{ item: target, updated: data.progress[recent.id].updated }] : [];
  }).sort((a, b) => b.updated - a.updated).map(value => value.item);
}
export function matchTrack(tracks: Track[], choice?: TrackChoice | null) {
  if (!choice) return null;
  const score = (track: Track) => Number(track.title === choice.title) * 4 + Number(track.channels === choice.channels) * 2 + Number(track.codec === choice.codec);
  return tracks.filter(t => t.language === choice.language).sort((a, b) => score(b) - score(a))[0] || null;
}
export function languageName(value: string) {
  if (!value || value === 'und') return 'Unknown language';
  const aliases: Record<string, string> = { eng: 'en', pol: 'pl', jpn: 'ja', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', rus: 'ru', por: 'pt', chi: 'zh', zho: 'zh', kor: 'ko' };
  const code = aliases[value] || value;
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch { return ({ en: 'English', pl: 'Polish', ja: 'Japanese', es: 'Spanish', fr: 'French', de: 'German' } as Record<string, string>)[code] || code; }
}
