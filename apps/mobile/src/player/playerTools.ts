import { reachedOutro } from '../../../../packages/core/client/watch-progress.js';
import type { Segment } from '../lib/server';

export const DOUBLE_TAP_SECONDS = 10;
export const DOUBLE_TAP_MS = 260;
export type TapZone = 'left' | 'center' | 'right';
export type Chapter = { start: number; title: string };
export type MarkerType = Segment['type'];
export const markerTypes: MarkerType[] = ['intro', 'recap', 'outro'];

/** The outer thirds seek, the middle toggles the controls. */
export function tapZone(x: number, width: number): TapZone {
  const share = width > 0 ? x / width : .5;
  return share < .33 ? 'left' : share > .67 ? 'right' : 'center';
}

/** Server preview frames are cached per second; five-second buckets keep scrubbing cheap. */
export function framePath(id: string, time: number, width = 320) {
  return `/api/items/${encodeURIComponent(id)}/frame?t=${Math.max(0, Math.floor(time / 5) * 5)}&w=${width}`;
}

export function chapterIndex(chapters: Chapter[] | undefined, time: number) {
  let found = -1;
  (chapters || []).forEach((chapter, index) => { if (chapter.start <= time + .25) found = index; });
  return found;
}

/** "Next episode" appears from the credits of an episode that has a successor. */
export const showCreditsNext = (markers: Segment[], position: number, duration: number, hasNext: boolean) =>
  hasNext && reachedOutro(position, duration, markers);

/** Marks copied to the other episodes of a season: openings keep their times, an outro keeps its distance from the end. */
export function seasonCopies(manual: Segment[], duration: number, episodes: { id: string; duration: number }[]) {
  return episodes.map(episode => ({
    id: episode.id,
    markers: manual.map(marker => {
      const shift = marker.type === 'outro' ? episode.duration - duration : 0;
      return { ...marker, source: 'manual' as const, start: Math.max(0, marker.start + shift), end: Math.min(episode.duration, marker.end + shift) };
    }).filter(marker => marker.end > marker.start && marker.start < episode.duration),
  }));
}

export type SleepMode = 'off' | 'episode' | '15' | '30' | '60';
export const sleepModes: { mode: SleepMode; label: string }[] = [
  { mode: 'off', label: 'Off' }, { mode: 'episode', label: 'End of episode' }, { mode: '15', label: '15 min' }, { mode: '30', label: '30 min' }, { mode: '60', label: '60 min' },
];
export const sleepMinutes = (mode: SleepMode) => Number(mode) > 0 ? Number(mode) : 0;
