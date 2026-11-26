export type SubtitlePosition = { x: number; y: number };

export const subtitlePresets = { Bottom: { x: 50, y: 100 }, Top: { x: 50, y: 0 } };

export function parseSubtitlePosition(raw: string | null): SubtitlePosition {
  const axis = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value)) : fallback;
  try {
    const position = raw && JSON.parse(raw);
    return { x: axis(position?.x, 50), y: axis(position?.y, 100) };
  } catch { return subtitlePresets.Bottom; }
}

export function subtitleOffset(percent: number, space: number, size: number): number {
  return Math.max(0, space - size) * percent / 100;
}
