import type { Info, Item, Library, Metadata, Preferences, Track, TrackChoice, TrackPreference } from './server';
import { initialTracks } from './track-preferences.js';
import { compareEditions, compareEpisodes, continueWatching, groupTitles, isCompleted, resumeTarget } from './watch-progress.js';
export const trackKey = (item: Item) => item.groupId || item.group;
export const titleKey = (item: Item) => item.kind === 'show' ? item.groupId || item.group : item.editionGroup || item.id;
export const metadataFor = (data: Library, item: Item): Metadata => data.metadata[titleKey(item)] || (!item.editionGroup && data.metadata[item.id]) || {};
export const nameFor = (data: Library, item: Item) => metadataFor(data, item).title || item.group;
export const episodeName = (data: Library, item: Item) => metadataFor(data, item).episodes?.[String(item.season)]?.[String(item.episode)]?.name || item.title;
export const formatTime = (value: number) => {
  const n = Math.max(0, Math.floor(value || 0));
  return `${n >= 3600 ? Math.floor(n / 3600) + ':' : ''}${String(Math.floor(n / 60) % 60).padStart(n >= 3600 ? 2 : 1, '0')}:${String(n % 60).padStart(2, '0')}`;
};
export function groupLibrary(items: Item[]) {
  return groupTitles(items).map(group => group[0].editionGroup
    ? group.sort(compareEditions)
    : group.sort(compareEpisodes));
}
export const resumeItem = (data: Library, items: Item[]) => resumeTarget(items, data.progress);
export const statusOf = (data: Library, items: Item[]) => (items[0].editionGroup ? items.some(i => isCompleted(data.progress[i.id])) : items.every(i => isCompleted(data.progress[i.id]))) ? 'done' : items.some(i => data.progress[i.id]?.position > 0 || isCompleted(data.progress[i.id])) ? 'progress' : 'new';
export const continueItems = (data: Library, groups: Item[][]) => continueWatching(groups, data.progress);
export function subtitleTracks(info: Info): Track[] {
  return [
    ...info.embedded,
    ...info.uploaded.map(track => ({ index: 10000 + track.id, language: track.language, title: track.name, codec: 'vtt', text: true, forced: track.kind === 'forced', sdh: track.kind === 'sdh' })),
    ...(info.files || []).map(track => ({ ...track, index: 20000 + track.id, text: true })),
  ];
}

export function savedServes(saved: Info, full: Info, choice?: TrackPreference, preferences?: Preferences) {
  const { audio, subtitle } = initialTracks({ audio: full.audio, subtitles: subtitleTracks(full) }, choice, preferences);
  return audio === (saved.audio[0]?.index ?? null) && (subtitle === null || subtitleTracks(saved).some(track => track.index === subtitle));
}
// A save starts with the tracks the player would open: that audio, and the subtitle burned in only when it is a bitmap.
export function offlineStart(info: Info, choice?: TrackPreference, preferences?: Preferences) {
  const { audio, subtitle } = initialTracks({ audio: info.audio, subtitles: subtitleTracks(info) }, choice, preferences);
  return { audio, burn: info.embedded.some(track => track.index === subtitle && track.bitmap) ? subtitle : null };
}
// The per-title choice to remember when a save leaves that start, so streaming opens with the same tracks.
export function offlineTrackPatch(info: Info, start: { audio: number | null; burn: number | null }, picked: { audio?: number | null; burn?: number | null }) {
  const pick = (track?: Track): TrackChoice | null => track ? { language: track.language, title: track.title, codec: track.codec, channels: track.channels } : null;
  const patch: TrackPreference = {};
  if ((picked.audio ?? null) !== start.audio) patch.audio = pick(info.audio.find(track => track.index === picked.audio));
  if ((picked.burn ?? null) !== start.burn) Object.assign(patch, picked.burn == null ? { off: true } : { subtitle: pick(info.embedded.find(track => track.index === picked.burn)), off: false });
  return Object.keys(patch).length ? patch : null;
}
export { initialTracks, matchTrack } from './track-preferences.js';
export function languageName(value: string) {
  if (!value || value === 'und') return 'Unknown language';
  const aliases: Record<string, string> = { eng: 'en', pol: 'pl', jpn: 'ja', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', rus: 'ru', por: 'pt', chi: 'zh', zho: 'zh', kor: 'ko' };
  const code = aliases[value] || value;
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch { return ({ en: 'English', pl: 'Polish', ja: 'Japanese', es: 'Spanish', fr: 'French', de: 'German' } as Record<string, string>)[code] || code; }
}
