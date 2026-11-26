import type { Info, Item, Library, Metadata, Track, TrackChoice, TrackPreference } from './server';
import { compareEpisodes, continueWatching, groupTitles, isCompleted, resumeTarget } from './watch-progress.js';
export const trackKey = (item: Item) => item.groupId || item.group;
export const titleKey = (item: Item) => item.kind === 'show' ? item.groupId || item.group : item.editionGroup || item.id;
export const metadataFor = (data: Library, item: Item): Metadata => data.metadata[titleKey(item)] || data.metadata[item.id] || {};
export const nameFor = (data: Library, item: Item) => metadataFor(data, item).title || item.group;
export const episodeName = (data: Library, item: Item) => metadataFor(data, item).episodes?.[String(item.season)]?.[String(item.episode)]?.name || item.title;
export const formatTime = (value: number) => {
  const n = Math.max(0, Math.floor(value || 0));
  return `${n >= 3600 ? Math.floor(n / 3600) + ':' : ''}${String(Math.floor(n / 60) % 60).padStart(n >= 3600 ? 2 : 1, '0')}:${String(n % 60).padStart(2, '0')}`;
};
export function groupLibrary(items: Item[]) {
  return groupTitles(items).map(group => group[0].editionGroup
    ? group.sort((a, b) => (a.added ?? 0) - (b.added ?? 0) || a.id.localeCompare(b.id))
    : group.sort(compareEpisodes));
}
export const resumeItem = (data: Library, items: Item[]) => resumeTarget(items, data.progress);
export const statusOf = (data: Library, items: Item[]) => (items[0].editionGroup ? items.some(i => isCompleted(data.progress[i.id])) : items.every(i => isCompleted(data.progress[i.id]))) ? 'done' : items.some(i => data.progress[i.id]?.position > 0 || isCompleted(data.progress[i.id])) ? 'progress' : 'new';
export const continueItems = (data: Library, groups: Item[][]) => continueWatching(groups, data.progress);
export function matchTrack(tracks: Track[], choice?: TrackChoice | null) {
  if (!choice) return null;
  const score = (track: Track) => Number(track.title === choice.title) * 4 + Number(track.channels === choice.channels) * 2 + Number(track.codec === choice.codec);
  return tracks.filter(t => t.language === choice.language).sort((a, b) => score(b) - score(a))[0] || null;
}
// A saved copy keeps the first audio track and the text subtitles only, so stream whenever the chosen tracks need more.
export function savedServes(saved: Info & { text?: Record<string, string> }, full: Info, choice?: TrackPreference) {
  const audio = matchTrack(full.audio, choice?.audio)?.index ?? full.audio.find(t => t.default)?.index ?? full.audio[0]?.index ?? null;
  if (audio !== (saved.audio[0]?.index ?? null)) return false;
  const subtitle = choice?.off ? null : matchTrack([...full.embedded, ...full.uploaded.map(t => ({ index: 10000 + t.id, language: t.language, title: t.name } as Track)), ...(full.files || []).map(t => ({ ...t, index: 20000 + t.id }))], choice?.subtitle)?.index ?? null;
  return subtitle === null || saved.embedded.some(t => t.index === subtitle) || saved.uploaded.some(t => 10000 + t.id === subtitle) || !!saved.files?.some(t => 20000 + t.id === subtitle);
}
export function languageName(value: string) {
  if (!value || value === 'und') return 'Unknown language';
  const aliases: Record<string, string> = { eng: 'en', pol: 'pl', jpn: 'ja', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', rus: 'ru', por: 'pt', chi: 'zh', zho: 'zh', kor: 'ko' };
  const code = aliases[value] || value;
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch { return ({ en: 'English', pl: 'Polish', ja: 'Japanese', es: 'Spanish', fr: 'French', de: 'German' } as Record<string, string>)[code] || code; }
}
