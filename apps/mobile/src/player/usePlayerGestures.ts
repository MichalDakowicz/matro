import { useEffect, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { isBoosted, volumeLabel } from './volume';
import { DOUBLE_TAP_MS, DOUBLE_TAP_SECONDS, tapZone, type TapZone } from './playerTools';

type Touches = GestureResponderEvent['nativeEvent']['touches'];
type Stage = { onTouchStart: (event: GestureResponderEvent) => void; onTouchMove: (event: GestureResponderEvent) => void; onTouchEnd: (event: GestureResponderEvent) => void; onTouchCancel: (event: GestureResponderEvent) => void; onPress: () => void };

/**
 * Double-tap on the left or right third seeks 10 seconds; a vertical drag on the right edge changes the player volume.
 * It wraps the pinch handlers instead of replacing them: a second finger cancels both gestures, so pinch-to-fill is untouched.
 * Brightness needs a native module, so it is not offered here.
 */
export function usePlayerGestures({ stage, width, onTap, seekBy, volume, setVolume, maxVolume = 1 }: { stage: Stage; width: number; onTap: () => void; seekBy: (seconds: number) => void; volume: () => number; setVolume: (value: number) => void; maxVolume?: number }) {
  const [label, setLabel] = useState('');
  const touch = useRef({ x: 0, y: 0, volume: 0, multi: false, swiped: false });
  const last = useRef<{ at: number; zone: TapZone } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null), labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); if (labelTimer.current) clearTimeout(labelTimer.current); }, []);
  const show = (text: string) => { setLabel(text); if (labelTimer.current) clearTimeout(labelTimer.current); labelTimer.current = setTimeout(() => setLabel(''), 800); };

  const tap = () => {
    if (touch.current.multi || touch.current.swiped) return;
    const zone = tapZone(touch.current.x, width), now = Date.now();
    if (pending.current) { clearTimeout(pending.current); pending.current = null; }
    if (zone !== 'center' && last.current?.zone === zone && now - last.current.at < DOUBLE_TAP_MS) {
      last.current = null;
      const seconds = zone === 'left' ? -DOUBLE_TAP_SECONDS : DOUBLE_TAP_SECONDS;
      seekBy(seconds); show(`${seconds > 0 ? '+' : '−'}${DOUBLE_TAP_SECONDS} s`);
      return;
    }
    last.current = { at: now, zone };
    // A side tap waits briefly in case it is the first half of a double tap.
    if (zone === 'center') onTap(); else pending.current = setTimeout(() => { pending.current = null; onTap(); }, DOUBLE_TAP_MS);
  };
  const first = (touches: Touches) => touches[0];
  return { label, tap, bind: {
    ...stage,
    onTouchStart: (event: GestureResponderEvent) => {
      const { touches } = event.nativeEvent, point = first(touches);
      if (touches.length === 1) touch.current = { x: point.pageX, y: point.pageY, volume: volume(), multi: false, swiped: false };
      else touch.current.multi = true;
      stage.onTouchStart(event);
    },
    onTouchMove: (event: GestureResponderEvent) => {
      const { touches } = event.nativeEvent, point = first(touches), state = touch.current;
      if (touches.length > 1) state.multi = true;
      else if (!state.multi && tapZone(state.x, width) === 'right') {
        const dy = state.y - point.pageY;
        if (state.swiped || (Math.abs(dy) > 28 && Math.abs(dy) > Math.abs(point.pageX - state.x) * 1.5)) {
          state.swiped = true;
          const next = Math.max(0, Math.min(maxVolume, state.volume + dy / 320));
          setVolume(next); show(`Volume ${volumeLabel(next)}${isBoosted(next) ? ' · Boost' : ''}`);
        }
      }
      stage.onTouchMove(event);
    },
  } };
}
