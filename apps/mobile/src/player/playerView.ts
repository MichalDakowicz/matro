/** Playback speeds offered in the speed sheet. */
export const speeds = [.75, 1, 1.25, 1.5, 2];
export const speedLabel = (rate: number) => `${rate}×`;

/** Audio and subtitle tracks without a language read "Track 2", not "Unknown language". */
export const trackName = (language: string | undefined, position: number, nameOf: (language: string) => string) => !language || language === 'und' ? `Track ${position}` : nameOf(language);

export const runtimeLabel = (minutes: number) => `${Math.floor(minutes / 60) ? Math.floor(minutes / 60) + 'h ' : ''}${Math.round(minutes % 60)}m`;
/** Player subtitle for a movie: "2019 · 1h 52m". Falls back to the kind when nothing is known. */
export function movieFacts({ year, runtime, duration, kind }: { year?: string | number; runtime?: number; duration?: number; kind: string }) {
  const minutes = runtime || (duration ? Math.round(duration / 60) : 0);
  return [year, minutes ? runtimeLabel(minutes) : ''].filter(Boolean).join(' · ') || (kind === 'audio' ? 'Audio' : 'Movie');
}

export const delayLabel = (delay: number) => `${delay >= 0 ? '+' : '−'}${Math.abs(delay).toFixed(1)} s`;
export const sizeLabel = (size: number) => `${Math.round(size * 100)}%`;
/** Preview text is drawn at the size the caption will have (the caption base size is 20). */
export const previewFontSize = (size: number) => Math.round(20 * size);

/** Wait before the nth repeat while a stepper is held: a pause, then faster and faster. */
export const holdDelay = (count: number) => count === 0 ? 420 : Math.max(45, 170 - count * 14);

/** One line while the server prepares a file; the elapsed time shows that it is still working. */
export const preparingLabel = (clock: string) => `Preparing playback · ${clock}`;

/** How far the captions must rise to clear whatever sits over the picture. Zero when nothing overlaps them. */
export const captionLift = (captionBottom: number, obstacleTops: (number | null)[]) => {
  const tops = obstacleTops.filter((top): top is number => top !== null);
  return tops.length ? Math.max(0, captionBottom - Math.min(...tops)) : 0;
};
