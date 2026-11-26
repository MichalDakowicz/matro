import { useCallback, useEffect, useRef, useState } from 'react';
import { sleepMinutes, type SleepMode } from './playerTools';

/** Stops playback at the end of the episode or after 15, 30 or 60 minutes. The deadline is also checked on playback ticks, so a timer survives a suspended JS thread. */
export function useSleepTimer(onExpire: () => void) {
  const [mode, setMode] = useState<SleepMode>('off');
  const deadline = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null), expire = useRef(onExpire), modeRef = useRef<SleepMode>('off');
  expire.current = onExpire;
  const choose = useCallback((next: SleepMode) => {
    if (timer.current) clearTimeout(timer.current);
    modeRef.current = next; setMode(next);
    const ms = sleepMinutes(next) * 60_000;
    deadline.current = ms ? Date.now() + ms : 0;
    timer.current = ms ? setTimeout(() => fire(), ms) : null;
  }, []);
  const fire = useCallback(() => { choose('off'); expire.current(); }, [choose]);
  /** Call on playback ticks; true when the countdown has just ended. */
  const check = useCallback(() => { if (deadline.current && Date.now() >= deadline.current) { fire(); return true; } return false; }, [fire]);
  /** True when playback should stay stopped after this episode (end-of-episode mode or an elapsed countdown). Clears the timer. */
  const stopAtEnd = useCallback(() => {
    const stop = modeRef.current === 'episode' || (deadline.current > 0 && Date.now() >= deadline.current);
    if (stop) choose('off');
    return stop;
  }, [choose]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { mode, choose, check, stopAtEnd };
}
