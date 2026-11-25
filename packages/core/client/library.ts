import type { Item, Library, Metadata } from './server';
import { compareEpisodes, continueWatching, groupTitles, isCompleted, resumeTarget } from './watch-progress.js';
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
  return groupTitles(items).map(group => group.sort(compareEpisodes));
}
export const resumeItem = (data: Library, items: Item[]) => resumeTarget(items, data.progress);
export const statusOf = (data: Library, items: Item[]) => items.every(i => isCompleted(data.progress[i.id])) ? 'done' : items.some(i => data.progress[i.id]?.position > 0 || isCompleted(data.progress[i.id])) ? 'progress' : 'new';
export const continueItems = (data: Library, groups: Item[][]) => continueWatching(groups, data.progress);
export { initialTracks, matchTrack } from './track-preferences.js';
export function languageName(value: string) {
  if (!value || value === 'und') return 'Unknown language';
  const aliases: Record<string, string> = { eng: 'en', pol: 'pl', jpn: 'ja', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', rus: 'ru', por: 'pt', chi: 'zh', zho: 'zh', kor: 'ko' };
  const code = aliases[value] || value;
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch { return ({ en: 'English', pl: 'Polish', ja: 'Japanese', es: 'Spanish', fr: 'French', de: 'German' } as Record<string, string>)[code] || code; }
}
