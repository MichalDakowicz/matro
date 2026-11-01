// Matro's tokens (matro/src/styles.css :root). Monochrome warm, no accent. No raw hex in screens: use these.
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
} from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';

export const colors = {
  ground: '#0a0a0b',
  panel: '#161618',
  text: '#ece9e4',
  muted: '#a9a59d',
  dim: '#8f8c87',
  hairline: '#ffffff14',
  fieldBorder: '#ece9e438',
  inputFill: '#1a1a1cb3',
  placeholder: '#6f6c68',
  primary: '#f3f1ec',
  onPrimary: '#0a0a0b',
  warn: '#e3a58b',
  good: '#9fd6b0',
} as const;

export const fontAssets = { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_400Regular };
export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
} as const;
