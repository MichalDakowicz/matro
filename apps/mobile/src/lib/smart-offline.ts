import AsyncStorage from '@react-native-async-storage/async-storage';
import { recoveryScope } from './storage';
import { removeOffline, saveOfflineBatch, savedBytes, savedTitles } from './offline';
import { planSmart, NO_SMART, type Held, type SmartSettings } from './smart-plan';
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

let running: Promise<{ saved: number; removed: number; capped: number }> | null = null;
/** Applies the "keep the next episodes" rules to the library the server just sent. Safe to call often: it only adds what is missing and removes what is watched. */
export function reconcileSmart(base: string, data: Library, settings: SmartSettings) {
  running ??= (async () => {
    const result = { saved: 0, removed: 0, capped: 0 };
    if (!Object.keys(settings.rules).length) return result;
    const held: Held[] = (await savedTitles(base, data.user)).map(record => ({ id: record.id, bytes: Math.max(record.size || 0, savedBytes(record)), complete: record.complete }));
    const shows = Object.fromEntries(groupLibrary(data.items).filter(group => group[0].kind === 'show').map(group => [titleKey(group[0]), group]));
    const plan = planSmart({ shows, progress: data.progress, settings, held });
    for (const id of plan.remove) await removeOffline(base, data.user, id);
    for (const group of groupLibrary(plan.save)) await saveOfflineBatch(base, data.user, group, item => item.title, { id: `smart:${titleKey(group[0])}`, label: `Keeping ${group[0].group} ready` });
    return { saved: plan.save.length, removed: plan.remove.length, capped: plan.capped };
  })().finally(() => { running = null; });
  return running;
}
