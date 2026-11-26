import AsyncStorage from '@react-native-async-storage/async-storage';
import { createProgressRecovery } from '../../../../packages/core/client/recovery';
import type { MatroUser } from '../../../../packages/core/client/server';
import { migrateOfflineAccount } from './offline-storage';
export { recoveryScope } from './offline-storage';

const KEY = 'matro.server';

export const loadServer = (): Promise<string | null> => AsyncStorage.getItem(KEY).catch(() => null);
export const saveServer = (base: string) => AsyncStorage.setItem(KEY, base).catch(() => {});
export const forgetServer = () => AsyncStorage.removeItem(KEY).catch(() => {});
export const progressRecovery = createProgressRecovery(AsyncStorage);
let migration = Promise.resolve();
export function migrateLegacyScope(base: string, user: MatroUser) {
  migration = migration.catch(() => {}).then(() => migrateOfflineAccount(AsyncStorage, base, user));
  return migration;
}
