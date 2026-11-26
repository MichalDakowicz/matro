import { forgetFromHistory, rememberServer } from './server-history';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createProgressRecovery } from '../../../../packages/core/client/recovery';
import type { Library, MatroUser, Progress } from '../../../../packages/core/client/server';
import { activeOfflineAccountKey as active, migrateOfflineAccount, offlineAccount, offlineLibraryKey as libraryKey } from './offline-storage';
export { recoveryScope } from './offline-storage';

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
export async function readStored<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  try { return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
let cacheWrites = Promise.resolve();
function writeCache(task: () => Promise<void>) {
  cacheWrites = cacheWrites.catch(() => {}).then(task);
  return cacheWrites;
}
export const migrateLegacyScope = (base: string, user: MatroUser) => writeCache(() => migrateOfflineAccount(AsyncStorage, base, user));
export const rememberLibrary = (base: string, data: Library) => writeCache(async () => {
  const scope = offlineAccount(base, data.user);
  await AsyncStorage.setItem(libraryKey(scope), JSON.stringify(data));
  await AsyncStorage.setItem(active(base), scope);
});
export const rememberProgress = (base: string, user: MatroUser, progress: Record<string, Progress>) => writeCache(async () => {
  if (!Object.keys(progress).length) return;
  const key = libraryKey(offlineAccount(base, user)), cached = await readStored<Library>(key);
  if (!cached) return;
  for (const [id, entry] of Object.entries(progress)) if ((cached.progress[id]?.updated || 0) <= entry.updated) cached.progress[id] = entry;
  await AsyncStorage.setItem(key, JSON.stringify(cached));
});
export const forgetOfflineAccount = (base: string) => writeCache(() => AsyncStorage.removeItem(active(base)));
export async function cachedLibrary(base: string) {
  await cacheWrites.catch(() => {});
  const scope = await AsyncStorage.getItem(active(base));
  const data = scope ? await readStored<Library>(libraryKey(scope)) : null;
  return data && scope === offlineAccount(base, data.user) ? data : null;
}

const RECENT = 'matro.recent-searches';
export const loadRecents = async (): Promise<string[]> => {
  try { const list = JSON.parse((await AsyncStorage.getItem(RECENT)) || '[]'); return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string').slice(0, 6) : []; }
  catch { return []; }
};
export const saveRecents = (list: string[]) => AsyncStorage.setItem(RECENT, JSON.stringify(list.slice(0, 6))).catch(() => {});
