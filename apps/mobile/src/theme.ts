// Matro's tokens (packages/browser-ui/styles.css :root and [data-theme=light]). Monochrome warm, no accent.
// No raw hex in screens: use these. A new token goes into BOTH palettes below.
//
// `colors` and `themed()` follow the active scheme, so existing `colors.x` reads and style sheets keep working:
// build style sheets with `themed(() => StyleSheet.create({ ... }))` and read `colors.*` while rendering.
// A StyleSheet.create at module level (or colors read at module level) is frozen to one scheme.
import { useSyncExternalStore } from 'react';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { overArt as overArtColors, palettes, type Palette, type Scheme } from './palette';

export type { Palette, Scheme, ThemeChoice } from './palette';
/** Always-dark colours for text and shades drawn over artwork (it stays dark in both schemes). */
export const overArt = overArtColors;

let preferred: Scheme = 'dark', override: Scheme | null = null;
/** Scheme every `colors` / `themed` read follows right now. */
export const activeScheme = (): Scheme => override ?? preferred;
export const setPreferredScheme = (scheme: Scheme) => { preferred = scheme; };
/** The player draws over video and is dark in both schemes; set from the screen that renders it. */
export const setSceneOverride = (scheme: Scheme | null) => {
  const was = override !== null;
  override = scheme;
  if (was !== (scheme !== null)) queueMicrotask(() => sceneListeners.forEach(listener => listener())); // not during a render
};
const sceneListeners = new Set<() => void>();
/** True while the player is up, so the app can hold a re-theme until it closes. */
export const useSceneActive = () => useSyncExternalStore(listener => { sceneListeners.add(listener); return () => { sceneListeners.delete(listener); }; }, () => override !== null);

export const colors: Palette = new Proxy(palettes.dark, { get: (_, key: string) => palettes[activeScheme()][key as keyof Palette] });

/** Style sheets per scheme, built on first use. `factory` runs with the scheme active, so it can read `colors`. */
export function themed<T extends object>(factory: () => T): T {
  const cache: Partial<Record<Scheme, T>> = {};
  return new Proxy({} as T, {
    get: (_, key) => ((cache[activeScheme()] ??= factory()) as Record<string | symbol, unknown>)[key],
  });
}

export const fontAssets = { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_400Regular };
export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
} as const;
