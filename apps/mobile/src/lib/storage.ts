import AsyncStorage from '@react-native-async-storage/async-storage';
import { createProgressRecovery } from '../../../../packages/core/client/recovery';
import { forgetFromHistory, rememberServer } from './server-history';

const KEY = 'matro.server';

export const loadServer = (): Promise<string | null> => AsyncStorage.getItem(KEY).catch(() => null);
export const saveServer = (base: string) => AsyncStorage.setItem(KEY, base).catch(() => {});
const HISTORY = 'matro.servers';
export const loadServerHistory = async (): Promise<string[]> => {
  try { const list = JSON.parse(await AsyncStorage.getItem(HISTORY) || '[]'); return Array.isArray(list) ? list.filter(entry => typeof entry === 'string') : []; } catch { return []; }
};
export const addServerToHistory = async (base: string) => AsyncStorage.setItem(HISTORY, JSON.stringify(rememberServer(await loadServerHistory(), base))).catch(() => {});
export const removeServerFromHistory = async (base: string) => AsyncStorage.setItem(HISTORY, JSON.stringify(forgetFromHistory(await loadServerHistory(), base))).catch(() => {});
export const forgetServer = () => AsyncStorage.removeItem(KEY).catch(() => {});
export const progressRecovery = createProgressRecovery(AsyncStorage);
export const recoveryScope = (base: string, user: { id: number; username: string }) => `${base}:account:${user.id}:${user.username}`;
