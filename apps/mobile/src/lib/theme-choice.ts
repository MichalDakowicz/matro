import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemeChoice } from '../palette';

const KEY = 'matro.theme';
let choice: ThemeChoice = 'system';
const listeners = new Set<() => void>();
const set = (next: ThemeChoice) => { if (next === choice) return; choice = next; listeners.forEach(listener => listener()); };

/** Stored per device, like the browser app. Anything unreadable means System. */
export const loadThemeChoice = async () => {
  try { const value = await AsyncStorage.getItem(KEY); if (value === 'light' || value === 'dark' || value === 'system') set(value); } catch { /* keep System */ }
};
export const setThemeChoice = (next: ThemeChoice) => { set(next); void AsyncStorage.setItem(KEY, next).catch(() => {}); };
export const useThemeChoice = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => choice);
