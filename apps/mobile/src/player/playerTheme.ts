import { Easing } from 'react-native';
import { colors } from '../theme';

// The player stays dark in both themes. Tokens for its floating chrome; the monochrome palette itself lives in ../theme.
export const chrome = {
  video: '#000',
  scrim: '#0005',
  fadeStart: '#000c',
  fadeEnd: '#000e',
  // Translucent glass: Matro's #1a1a1c at about 80 %. React Native has no backdrop blur without a native module.
  glass: '#1a1a1ccc',
  glassLine: colors.hairline,
  line: '#ffffff24',
  fill: '#ffffff0e',
  fillOn: '#ffffff1f',
  track: '#ffffff24',
  buffer: '#ffffff40',
  tick: '#ffffffb0',
  dimTime: '#ffffff4d',
} as const;

/** One curve and two durations for everything that moves in the player. */
export const motion = { curve: Easing.bezier(.2, .75, .15, 1), base: 320, quick: 200 } as const;
