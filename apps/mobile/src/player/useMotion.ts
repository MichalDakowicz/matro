import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { motion } from './playerTheme';

export function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduce(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduce;
}

/** An animated value that glides to its target on the player's curve, or jumps there when reduce-motion is on. */
export function useGlide(target: number, duration: number = motion.base, native = true) {
  const reduce = useReduceMotion(), value = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    if (reduce) { value.setValue(target); return; }
    const run = Animated.timing(value, { toValue: target, duration, easing: motion.curve, useNativeDriver: native });
    run.start();
    return () => run.stop();
  }, [target, duration, reduce, native, value]);
  return value;
}
