import { createContext, useContext, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, AppState, PixelRatio, Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { BlurTargetView, BlurView } from 'expo-blur';
import { activeScheme, colors, themed } from '../theme';
import { blurProps, canBlur } from '../lib/glass';
import { isAndroidTv } from './TvFocus';

type Power = { powerSaveMode?(): boolean };
const power = Platform.OS === 'android' ? requireOptionalNativeModule<Power>('MatroKeepAlive') : null;
let highContrast = false, powerSave = false, on = false;
const listeners = new Set<() => void>();
const update = () => {
  try { powerSave = !!power?.powerSaveMode?.(); } catch { powerSave = false; }
  on = canBlur({ os: Platform.OS, version: Platform.Version, tv: isAndroidTv, highContrast, powerSave });
  listeners.forEach(listener => listener());
};
update();
if (Platform.OS === 'android') {
  AccessibilityInfo.isHighTextContrastEnabled().then(value => { highContrast = value; update(); }).catch(() => {});
  AccessibilityInfo.addEventListener('highTextContrastChanged', value => { highContrast = value; update(); });
  // shortcut: battery saver is read at start and when the app comes back to the foreground, not live; add a native listener if that proves too slow.
  AppState.addEventListener('change', state => { if (state === 'active') update(); });
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const useBlur = () => useSyncExternalStore(subscribe, () => on, () => false);

const Target = createContext<RefObject<View | null> | null>(null);
const InsideTarget = createContext(false);

/** Gives the glass below it something to blur: the one `Backdrop` rendered inside. */
export function GlassScope({ children }: { children: ReactNode }) {
  const target = useRef<View>(null);
  return <Target.Provider value={target}>{children}</Target.Provider>;
}
/**
 * The content glass blurs (Android draws it into a blur target). Floating glass must sit outside it, as a sibling,
 * or it would sample itself; glass inside a Backdrop stays solid unless it is in a modal (its own window).
 */
export function Backdrop({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const target = useContext(Target);
  return <BlurTargetView ref={target ?? undefined} style={style}><InsideTarget.Provider value>{children}</InsideTarget.Provider></BlurTargetView>;
}

/**
 * Matro glass: `fill` over an 18 dp blur of the Backdrop. Without blur (no Backdrop, Android below 12, TV,
 * high text contrast, battery saver) it is a plain View and keeps the solid fill in `style`.
 */
export function Glass({ fill = colors.glassBlur, modal, style, children, ...props }: ViewProps & { fill?: string; modal?: boolean }) {
  const target = useContext(Target), inside = useContext(InsideTarget), blur = useBlur() && !!target && (modal || !inside);
  if (!blur) return <View {...props} style={style}>{children}</View>;
  return <View {...props} style={[style, s.clear]}>
    <BlurView pointerEvents="none" blurTarget={target} blurMethod="dimezisBlurViewSdk31Plus" tint={activeScheme()} {...blurProps(PixelRatio.get())} style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
    </BlurView>
    {children}
  </View>;
}

const s = themed(() => StyleSheet.create({
  clear: { backgroundColor: 'transparent', overflow: 'hidden' },
}));
