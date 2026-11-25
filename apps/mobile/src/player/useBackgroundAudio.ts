import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const key = 'matro.backgroundAudio';

/** Per-device choice to keep playing with the screen off. Off unless the user turns it on. */
export function useBackgroundAudio() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(key).then(saved => { if (active) setEnabled(saved === '1'); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const update = (value: boolean) => { setEnabled(value); void AsyncStorage.setItem(key, value ? '1' : '0').catch(() => {}); };
  return [enabled, update] as const;
}
