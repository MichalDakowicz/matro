import AsyncStorage from '@react-native-async-storage/async-storage';
import { createProgressRecovery } from '../../../../packages/core/client/recovery';

const KEY = 'matro.server';

export const loadServer = (): Promise<string | null> => AsyncStorage.getItem(KEY).catch(() => null);
export const saveServer = (base: string) => AsyncStorage.setItem(KEY, base).catch(() => {});
export const forgetServer = () => AsyncStorage.removeItem(KEY).catch(() => {});
export const progressRecovery = createProgressRecovery(AsyncStorage);
export const recoveryScope = (base: string, user: { id: number; username: string }) => `${base}:account:${user.id}:${user.username}`;

const RECENT = 'matro.recent-searches';
export const loadRecents = async (): Promise<string[]> => {
  try { const list = JSON.parse((await AsyncStorage.getItem(RECENT)) || '[]'); return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string').slice(0, 6) : []; }
  catch { return []; }
};
export const saveRecents = (list: string[]) => AsyncStorage.setItem(RECENT, JSON.stringify(list.slice(0, 6))).catch(() => {});
