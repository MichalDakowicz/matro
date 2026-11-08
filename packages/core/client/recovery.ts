import type { Progress } from './server';
type Storage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<unknown> };
const valid = (entry: Progress | null | undefined): entry is Progress => !!entry && Number.isFinite(entry.position) && entry.position >= 0 && Number.isFinite(entry.duration) && entry.duration > 0 && Number.isFinite(entry.updated);
export function createProgressRecovery(storage: Storage) {
  let writes = Promise.resolve();
  const key = (scope: string, id: string) => `matro:recovery:v1:${encodeURIComponent(scope)}:${id}`;
  return {
    write(scope: string, id: string, entry: Progress) {
      if (!valid(entry)) return Promise.resolve();
      const snapshot = JSON.stringify(entry);
      const write = writes.catch(() => {}).then(async () => {
        let previous; try { previous = JSON.parse(await storage.getItem(key(scope, id)) || 'null'); } catch {}
        if (!valid(previous) || previous.updated <= entry.updated) await storage.setItem(key(scope, id), snapshot);
      });
      writes = write; return write;
    },
    async restore(scope: string, progress: Record<string, Progress>, ids: string[]) {
      await writes.catch(() => {});
      const merged = { ...progress };
      await Promise.all(ids.map(async id => {
        let entry; try { entry = JSON.parse(await storage.getItem(key(scope, id)) || 'null'); } catch { return; }
        if (valid(entry) && (!valid(merged[id]) || entry.updated > merged[id].updated)) merged[id] = entry;
      }));
      return merged;
    }
  };
}
