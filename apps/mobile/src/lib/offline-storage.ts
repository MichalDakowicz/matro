import type { MatroUser } from '../../../../packages/core/client/server';

export const recoveryScope = (base: string, user: MatroUser) => `${base}:account-v2:${user.accountKey || `legacy:${user.id}:${user.username}`}`;
export const offlineAccount = (base: string, user: MatroUser) => encodeURIComponent(recoveryScope(base, user));
export const activeOfflineAccountKey = (base: string) => `matro:offline:active:${encodeURIComponent(base)}`;
export const offlineLibraryKey = (scope: string) => `matro:offline:library:${scope}`;
export const offlineMediaPrefix = (scope: string) => `matro:offline:media:${scope}:`;

type ScopeStorage = {
  getAllKeys: () => Promise<readonly string[]>;
  multiGet: (keys: string[]) => Promise<readonly (readonly [string, string | null])[]>;
  multiSet: (entries: [string, string][]) => Promise<unknown>;
  multiRemove: (keys: string[]) => Promise<unknown>;
};

export async function migrateOfflineAccount(storage: ScopeStorage, base: string, user: MatroUser) {
  if (!user.legacyScope || !user.accountKey) return;
  const from = encodeURIComponent(`${base}:account:${user.id}:${user.username}`), to = offlineAccount(base, user);
  const oldLibrary = offlineLibraryKey(from), active = activeOfflineAccountKey(base);
  const fromMedia = offlineMediaPrefix(from), toMedia = offlineMediaPrefix(to);
  const fromRecovery = `matro:recovery:v1:${from}:`, toRecovery = `matro:recovery:v1:${to}:`;
  const targets = new Map<string, string>();
  for (const key of await storage.getAllKeys()) {
    if (key === oldLibrary) targets.set(key, offlineLibraryKey(to));
    else if (key.startsWith(fromMedia)) targets.set(key, toMedia + key.slice(fromMedia.length));
    else if (key.startsWith(fromRecovery)) targets.set(key, toRecovery + key.slice(fromRecovery.length));
  }
  const originals = [...targets.keys()];
  const values = new Map(await storage.multiGet([active, ...originals, ...targets.values()]));
  const copies: [string, string][] = [];
  for (const [key, target] of targets) {
    const value = values.get(key);
    if (value == null || values.get(target) != null) continue;
    copies.push([target, key === oldLibrary ? JSON.stringify({ ...JSON.parse(value), user }) : value]);
  }
  if (values.get(active) === from) copies.push([active, to]);
  if (copies.length) await storage.multiSet(copies);
  if (originals.length) await storage.multiRemove(originals);
}
