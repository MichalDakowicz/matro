export type VideoFit = 'contain' | 'cover';

export function pinchFit(start: number, distance: number, fit: VideoFit, bitmap: boolean): { fit: VideoFit; label: string } | null {
  if (start <= 0 || Math.abs(distance - start) < 16) return null;
  const scale = distance / start;
  if (fit === 'contain' && scale >= 1.18) {
    return bitmap ? { fit, label: 'Fit kept for image subtitles' } : { fit: 'cover', label: 'Fill' };
  }
  if (fit === 'cover' && scale <= 1 / 1.18) return { fit: 'contain', label: 'Fit' };
  return null;
}
