import { overArt } from '../palette.ts';
import type { TextStyle } from 'react-native';

// The same preference the browser and desktop players write (preferences.subtitles), so one choice follows the account.
export type SubtitleStyle = { font: 'sans' | 'classic' | 'serif' | 'mono' | 'casual'; background: 'none' | 'light' | 'dark' | 'solid'; bold: boolean; italic: boolean; edge: 'none' | 'outline' | 'shadow' };
export const subtitleFonts: { id: SubtitleStyle['font']; label: string; family?: string }[] = [
  { id: 'sans', label: 'Sans' }, { id: 'classic', label: 'Classic', family: 'sans-serif-medium' }, { id: 'serif', label: 'Serif', family: 'serif' }, { id: 'mono', label: 'Mono', family: 'monospace' }, { id: 'casual', label: 'Casual', family: 'casual' },
];
export const subtitleBackgrounds: { id: SubtitleStyle['background']; label: string; alpha: number }[] = [
  { id: 'none', label: 'Off', alpha: 0 }, { id: 'light', label: 'Light', alpha: .45 }, { id: 'dark', label: 'Dark', alpha: .75 }, { id: 'solid', label: 'Solid', alpha: 1 },
];
export const subtitleEdges: { id: SubtitleStyle['edge']; label: string }[] = [{ id: 'none', label: 'None' }, { id: 'outline', label: 'Outline' }, { id: 'shadow', label: 'Shadow' }];
export const defaultSubtitleStyle: SubtitleStyle = { font: 'sans', background: 'light', bold: false, italic: false, edge: 'none' };

const pick = <T extends string>(value: unknown, options: { id: T }[], fallback: T) => options.find(option => option.id === value)?.id ?? fallback;
export function parseSubtitleStyle(value: unknown): SubtitleStyle {
  const style = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { font: pick(style.font, subtitleFonts, 'sans'), background: pick(style.background, subtitleBackgrounds, 'light'), bold: style.bold === true, italic: style.italic === true, edge: pick(style.edge, subtitleEdges, 'none') };
}

/** Text style for the caption. The text keeps the app font unless a family is chosen; the box colour carries the background. */
export function subtitleTextStyle(style: SubtitleStyle, boxColor = overArt.black as string): TextStyle & { backgroundColor: string } {
  const alpha = subtitleBackgrounds.find(option => option.id === style.background)?.alpha ?? .45;
  const family = subtitleFonts.find(option => option.id === style.font)?.family;
  const hex = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return {
    ...(family ? { fontFamily: family } : {}),
    fontWeight: style.bold ? '700' : '400', fontStyle: style.italic ? 'italic' : 'normal',
    backgroundColor: alpha ? `${boxColor}${hex}` : 'transparent',
    // React Native draws one shadow, so the outline is a tight shadow with no blur offset.
    ...(style.edge === 'outline' ? { textShadowColor: overArt.black, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 4 }
      : style.edge === 'shadow' ? { textShadowColor: overArt.captionShadow, textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 4 }
      : { textShadowColor: 'transparent', textShadowRadius: 0 }),
  };
}
