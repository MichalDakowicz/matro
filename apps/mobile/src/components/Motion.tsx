import { useRef, useSyncExternalStore, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

/** Matro's one motion curve, cubic-bezier(.2,.75,.15,1). */
export const curve = Easing.bezier(.2, .75, .15, 1);

let reduced = false;
const listeners = new Set<() => void>();
const setReduced = (value: boolean) => { reduced = value; listeners.forEach(listener => listener()); };
AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The system "remove animations" setting. Tilt, lift and scale motion check it; fades and colour changes may stay. */
export const useReduceMotion = () => useSyncExternalStore(subscribe, () => reduced, () => false);

/** Press feedback for cards: the card rises and grows a little on the Matro curve. With reduce-motion on it only dims. */
export function Lift({ style, children, ...props }: PressableProps & { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const reduce = useReduceMotion(), value = useRef(new Animated.Value(0)).current;
  const to = (target: number) => { if (!reduce) Animated.timing(value, { toValue: target, duration: 380, easing: curve, useNativeDriver: true }).start(); };
  return <Pressable {...props} style={({ pressed }) => [style as ViewStyle, reduce && pressed && { opacity: .7 }]} onPressIn={event => { to(1); props.onPressIn?.(event); }} onPressOut={event => { to(0); props.onPressOut?.(event); }}>
    <Animated.View style={{ transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }, { scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) }] }}>{children}</Animated.View>
  </Pressable>;
}
