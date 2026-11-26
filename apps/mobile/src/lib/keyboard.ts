import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/** True while the on-screen keyboard is open, so floating chrome can get out of its way. */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  return visible;
}
