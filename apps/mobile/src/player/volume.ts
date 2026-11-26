/** Matches the desktop and web players: the saved volume runs to 150%, and anything above 100% is boost gain. */
export const MAX_VOLUME = 1.5;

/** A saved or dragged volume as 0–max, in whole percent. Missing values fall back to the server default. */
export function clampVolume(value: unknown, max = MAX_VOLUME) {
  const volume = Number(value);
  return Math.round(Math.max(0, Math.min(max, Number.isFinite(volume) ? volume : .72)) * 100) / 100;
}

/** Boost of 100–150% as LoudnessEnhancer gain in millibels (0 at 100% or below, about 352 at 150%). */
export function boostMillibels(percent: number) {
  const boost = Math.max(100, Math.min(MAX_VOLUME * 100, Number(percent) || 0));
  return Math.round(2000 * Math.log10(boost / 100));
}

export const isBoosted = (volume: number) => volume > 1.005;
export const volumeLabel = (volume: number) => `${Math.round(volume * 100)}%`;
