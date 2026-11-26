import AsyncStorage from '@react-native-async-storage/async-storage';
import { recoveryScope } from './storage';
import { isSaved, removeOffline, saveOfflineBatch, savedBytes, savedTitles } from './offline';
import { planSmart, NO_SMART, type SmartSettings } from './smart-plan';
import type { Library, MatroUser } from './server';
import { groupLibrary, titleKey } from '../../../../packages/core/client/library';

const key = (base: string, user: MatroUser) => `matro:offline:smart:${encodeURIComponent(recoveryScope(base, user))}`;
export async function loadSmart(base: string, user: MatroUser): Promise<SmartSettings> {
  try {
    const saved = JSON.parse(await AsyncStorage.getItem(key(base, user)) || 'null');
    if (saved && typeof saved.rules === 'object') return { rules: saved.rules, capBytes: typeof saved.capBytes === 'number' ? saved.capBytes : null };
  } catch { /* A damaged setting is the same as no setting. */ }
  return NO_SMART;
}
export const saveSmart = (base: string, user: MatroUser, settings: SmartSettings) => AsyncStorage.setItem(key(base, user), JSON.stringify(settings));

const running = new Map<string, Promise<{ capped: number }>>();
/** Applies the "keep the next episodes" rules to the library the server just sent. Safe to call often: it only adds what is missing and removes what is watched. */
export function reconcileSmart(base: string, data: Library, settings: SmartSettings, active: () => boolean) {
  const scope = recoveryScope(base, data.user);
  const pending = (running.get(scope) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (!active()) return { capped: 0 };
    const held = (await savedTitles(base, data.user)).map(record => {
      const bytes = savedBytes(record);
      return { id: record.id, batch: record.batch, bytes: Math.max(record.size || 0, bytes), complete: isSaved(record) };
    });
    const shows = Object.fromEntries(groupLibrary(data.items).filter(group => group[0].kind === 'show').map(group => [titleKey(group[0]), group]));
    const plan = planSmart({ shows, progress: data.progress, settings, held });
    for (const id of plan.remove) {
      if (!active()) return { capped: 0 };
      await removeOffline(base, data.user, id, { smartOnly: true });
    }
    for (const group of groupLibrary(plan.save)) {
      if (!active()) return { capped: 0 };
      const batch = { id: `smart:${titleKey(group[0])}`, label: `Keeping ${group[0].group} ready` };
      await saveOfflineBatch(base, data.user, group, item => item.title, { batch });
    }
    return { capped: plan.capped };
  }).finally(() => { if (running.get(scope) === pending) running.delete(scope); });
  running.set(scope, pending);
  return pending;
}
