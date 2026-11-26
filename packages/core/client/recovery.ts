import type { Item, Progress } from './server';
import { groupTitles } from './watch-progress.js';

type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<unknown>;
  getAllKeys: () => Promise<readonly string[]>;
  removeItem: (key: string) => Promise<unknown>;
};
type ProgressMap = Record<string, Progress>;
export type Dismissal = { id: string; at: number };
type Pending = { progress: ProgressMap; dismissals: Record<string, Dismissal> };
const valid = (entry: Progress | null | undefined): entry is Progress => !!entry && Number.isFinite(entry.position) && entry.position >= 0 && Number.isFinite(entry.duration) && entry.duration > 0 && Number.isFinite(entry.updated);
const same = (a?: Progress, b?: Progress) => !!a && !!b && a.updated === b.updated && a.position === b.position && a.duration === b.duration && a.completed === b.completed && a.hidden === b.hidden;
function parse<T>(raw: string | null): T | null { try { return raw && JSON.parse(raw); } catch { return null; } }

export function applyDismissals(items: Item[], progress: ProgressMap, dismissals: Record<string, Dismissal>): ProgressMap {
  if (!Object.keys(dismissals).length) return progress;
  const merged = { ...progress };
  for (const group of groupTitles(items)) {
    const at = group.reduce((latest, item) => Math.max(latest, dismissals[item.id]?.at ?? -1), -1);
    if (at < 0) continue;
    for (const { id } of group) {
      const entry = progress[id];
      if (entry && !entry.hidden && (entry.updated || 0) <= at) merged[id] = { ...entry, hidden: true };
    }
  }
  return merged;
}

export function createProgressRecovery(storage: Storage) {
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>) => {
    const run = pending.catch(() => {}).then(task);
    pending = run;
    return run;
  };
  const key = (scope: string) => `matro:recovery:v2:${encodeURIComponent(scope)}`;
  const save = (scope: string, data: Pending) => storage.setItem(key(scope), JSON.stringify(data));
  async function read(scope: string): Promise<Pending> {
    const stored = await storage.getItem(key(scope));
    const data: Pending = { progress: {}, dismissals: {} };
    if (stored !== null) {
      const saved = parse<Pending>(stored);
      return { progress: saved?.progress || {}, dismissals: saved?.dismissals || {} };
    }
    // Existing versions wrote one key per checkpoint. Scan the key list once for this account.
    const prefix = `matro:recovery:v1:${encodeURIComponent(scope)}:`;
    const keys = (await storage.getAllKeys()).filter(candidate => candidate.startsWith(prefix));
    const legacy = await Promise.all(keys.map(async candidate => [candidate.slice(prefix.length), parse<Progress>(await storage.getItem(candidate))] as const));
    data.progress = Object.fromEntries(legacy.filter(([, entry]) => valid(entry))) as ProgressMap;
    await save(scope, data);
    await Promise.all(keys.map(candidate => storage.removeItem(candidate).catch(() => {})));
    return data;
  }
  return {
    write(scope: string, id: string, entry: Progress) {
      if (!valid(entry)) return Promise.resolve();
      return serialize(async () => {
        const data = await read(scope), previous = data.progress[id];
        if (!valid(previous) || previous.updated <= entry.updated) {
          data.progress = { ...data.progress, [id]: entry };
          await save(scope, data);
        }
      });
    },
    dismiss(scope: string, operation: Dismissal) {
      return serialize(async () => {
        const data = await read(scope);
        if ((data.dismissals[operation.id]?.at ?? -1) <= operation.at) {
          data.dismissals = { ...data.dismissals, [operation.id]: operation };
          await save(scope, data);
        }
      });
    },
    confirm(scope: string, sent: ProgressMap, confirmed: ProgressMap = {}, dismissal?: Dismissal) {
      return serialize(async () => {
        const data = await read(scope);
        let changed = false;
        for (const [id, entry] of Object.entries(sent)) {
          // A checkpoint written while the request was in flight must survive its response.
          if (confirmed[id] && same(data.progress[id], entry)) { delete data.progress[id]; changed = true; }
        }
        if (dismissal && data.dismissals[dismissal.id]?.at === dismissal.at) {
          delete data.dismissals[dismissal.id]; changed = true;
        }
        if (changed) await save(scope, data);
      });
    },
    snapshot(scope: string, items: Item[], progress: ProgressMap, online = false) {
      return serialize(async () => {
        const data = await read(scope);
        const ids = new Set(items.map(item => item.id));
        const local: ProgressMap = {};
        let pruned = false;
        for (const [id, entry] of Object.entries(data.progress)) {
          if (!valid(entry)) continue;
          const remote = progress[id];
          if (online && remote && remote.updated >= entry.updated) {
            delete data.progress[id]; pruned = true;
          } else if (ids.has(id) && (!valid(remote) || entry.updated > remote.updated)) {
            local[id] = entry;
          }
        }
        if (pruned) await save(scope, data);
        const dismissals = Object.fromEntries(Object.entries(data.dismissals).filter(([id, entry]) => ids.has(id) && entry?.id === id && Number.isFinite(entry.at)));
        return { progress: applyDismissals(items, { ...progress, ...local }, dismissals), pending: { progress: local, dismissals } };
      });
    }
  };
}
