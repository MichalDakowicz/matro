// What "keep the next episodes saved" means, as a pure function of the library, watch progress and what is already on the device.
import type { Item, Progress } from '../../../../packages/core/client/server';

export type SmartRule = { keep: number; removeWatched: boolean };
export type SmartSettings = { rules: Record<string, SmartRule>; /** Stop saving once this much is on the device. Null means no cap. */ capBytes: number | null };
/** One record on the device. `bytes` is 0 while the size is not known yet. */
export type Held = { id: string; bytes: number; complete: boolean; batch?: string };
export const isSmartBatch = (batch?: string) => batch?.startsWith('smart:') === true;
export const NO_SMART: SmartSettings = { rules: {}, capBytes: null };
export const KEEP_CHOICES = [1, 3, 5, 10];
export const CAP_CHOICES: [label: string, bytes: number | null][] = [['No cap', null], ['5 GB', 5 * 1024 ** 3], ['10 GB', 10 * 1024 ** 3], ['25 GB', 25 * 1024 ** 3], ['50 GB', 50 * 1024 ** 3]];
const GUESS = 1024 ** 3;

export type Batch = { id: string; label: string; waiting: number; paused: number };
/** Groups the unfinished saves that were started together, so each group can be paused, resumed or cancelled in one tap. A single save is not a batch. */
export function batchesOf(records: { title: string; complete: boolean; paused?: boolean; batch?: string; batchLabel?: string }[]): Batch[] {
  const batches = new Map<string, Batch>();
  for (const record of records) {
    if (record.complete || !record.batch) continue;
    const batch = batches.get(record.batch) ?? { id: record.batch, label: record.batchLabel || record.title, waiting: 0, paused: 0 };
    if (record.paused) batch.paused++; else batch.waiting++;
    batches.set(record.batch, batch);
  }
  return [...batches.values()].filter(batch => batch.waiting + batch.paused > 1);
}

/** `shows` maps a title key to that show's episodes in watching order. */
export function planSmart({ shows, progress, settings, held }: { shows: Record<string, Item[]>; progress: Record<string, Progress>; settings: SmartSettings; held: Held[] }) {
  const have = new Map(held.map(entry => [entry.id, entry])), watched = (id: string) => !!progress[id]?.completed;
  const sizes = held.filter(entry => entry.complete && entry.bytes > 0).map(entry => entry.bytes);
  const typical = sizes.length ? sizes.reduce((sum, size) => sum + size, 0) / sizes.length : GUESS;
  const remove: string[] = [], save: Item[] = [];
  let capped = 0, used = held.reduce((sum, entry) => sum + (entry.bytes || typical), 0);
  const ruled = Object.entries(settings.rules).flatMap(([key, rule]) => shows[key] ? [{ group: shows[key], rule }] : []);
  for (const { group, rule } of ruled) {
    if (!rule.removeWatched) continue;
    for (const episode of group) {
      const record = have.get(episode.id);
      if (!watched(episode.id) || !record?.complete || !isSmartBatch(record.batch)) continue;
      remove.push(episode.id);
      used -= record.bytes || typical;
    }
  }
  for (const { group, rule } of ruled) {
    const wanted = group.filter(episode => !watched(episode.id)).slice(0, rule.keep);
    // A record that exists is left alone: it may be paused or failed on purpose.
    for (const episode of wanted) if (!have.has(episode.id)) {
      if (settings.capBytes !== null && used + typical > settings.capBytes) { capped++; continue; }
      save.push(episode); used += typical;
    }
  }
  return { save, remove, capped };
}
