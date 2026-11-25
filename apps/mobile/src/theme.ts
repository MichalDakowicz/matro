// Matro's tokens (packages/browser-ui/styles.css :root). Monochrome warm, no accent. No raw hex in screens: use these.
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';

export const colors = {
  ground: '#0a0a0b',
  panel: '#161618',
  text: '#ece9e4',
  muted: '#a9a59d',
  dim: '#8f8c87',
  hairline: '#ffffff14',
  hairlineStrong: '#ffffff24',
  // Chips, round icon buttons and quiet panels: one fill each, selected chips go warm white.
  chip: '#ffffff14',
  chipSelected: '#f3f1ec',
  onChipSelected: '#0a0a0b',
  fill: '#ffffff0a',
  track: '#ffffff30',
  soft: '#bebab3',
  fieldBorder: '#ece9e438',
  inputFill: '#1a1a1cb3',
  placeholder: '#6f6c68',
  primary: '#f3f1ec',
  onPrimary: '#0a0a0b',
  warn: '#e3a58b',
  good: '#9fd6b0',
  // Floating chrome. expo-blur is not installed, so glass is a translucent fill plus a gradient fade (`fade`).
  glass: '#1a1a1c8c',
  glassStrong: '#1a1a1cd9',
  dock: '#1c1c1ff2',
  scrim: '#0009',
  veil: '#0a0a0b99',
  shade: '#000000e8',
  fade: '#0a0a0bf2',
  clear: '#0a0a0b00',
  sheenHigh: '#ffffff1f',
  sheenLow: '#00000026',
} as const;

/** The artboards' 52 px dock items inside a 64 px pill. */
export const dock = { height: 64, item: 52, bottom: 14 } as const;

/** One heading scale: hero titles, page titles, sheet titles. */
export const type = {
  display: { fontSize: 34, lineHeight: 38, letterSpacing: -1.2 },
  page: { fontSize: 28, lineHeight: 32, letterSpacing: -1 },
  sheet: { fontSize: 22, lineHeight: 26, letterSpacing: -.7 },
} as const;

export const radius = { poster: 6, panel: 14, sheet: 22, pill: 999 } as const;

/** Warm tint for a poster that has no artwork, from a hash of the title: the cover is never a flat grey. */
export function coverTint(title = '') {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = 14 + (hash % 46), shift = 18 + ((hash >> 8) % 24);
  return [`hsl(${hue} 18% 19%)`, `hsl(${(hue + shift) % 360} 16% 12%)`, `hsl(${(hue + 2 * shift) % 360} 17% 16%)`] as const;
}

export const fontAssets = { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_400Regular };
export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
} as const;
