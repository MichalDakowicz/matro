import { useEffect, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { pinchFit, type VideoFit } from './pinchToFill';

type Touches = GestureResponderEvent['nativeEvent']['touches'];
const distance = ([a, b]: Touches) => Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);

export function usePinchToFill(hasVideo: boolean, bitmap: boolean, onTap: () => void) {
  const [requestedFit, setFit] = useState<VideoFit>('contain');
  const [indicator, setIndicator] = useState('');
  const gesture = useRef({ start: 0, multitouch: false, finished: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fit = bitmap ? 'contain' : requestedFit;

  useEffect(() => { if (bitmap) setFit('contain'); }, [bitmap]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const sample = (touches: Touches) => {
    const current = gesture.current;
    if (touches.length > 2) { current.multitouch = true; current.finished = true; }
    if (touches.length !== 2 || current.finished) return;
    const span = distance(touches);
    if (!current.multitouch) { current.multitouch = true; current.start = span; return; }
    if (!hasVideo) return;
    const next = pinchFit(current.start, span, fit, bitmap);
    if (!next) return;
    current.finished = true;
    setFit(next.fit);
    setIndicator(next.label);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setIndicator(''), 1350);
  };
  const end = ({ nativeEvent }: GestureResponderEvent) => { if (nativeEvent.touches.length < 2) gesture.current.finished = true; };

  return { fit, indicator, stageTouches: {
    onTouchStart: ({ nativeEvent }: GestureResponderEvent) => {
      if (nativeEvent.touches.length === 1) gesture.current = { start: 0, multitouch: false, finished: false };
      else sample(nativeEvent.touches);
    },
    onTouchMove: ({ nativeEvent }: GestureResponderEvent) => sample(nativeEvent.touches),
    onTouchEnd: end,
    onTouchCancel: end,
    onPress: () => { if (!gesture.current.multitouch) onTap(); },
  } };
}
