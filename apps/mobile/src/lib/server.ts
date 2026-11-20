export * from '../../../../packages/core/client/server';
import { library as loadLibrary, request } from '../../../../packages/core/client/server';
import { progressRecovery, recoveryScope } from './storage';
export async function library(base: string) {
  const data = await loadLibrary(base);
  const saved = await progressRecovery.restore(recoveryScope(base, data.user), data.progress, data.items.map(item => item.id));
  const pending = Object.fromEntries(Object.entries(saved).filter(([id, entry]) => entry.updated > (data.progress[id]?.updated || 0)));
  if (Object.keys(pending).length) void request(base, '/api/state', { method: 'PUT', body: { progress: pending } }).catch(() => {});
  data.progress = saved;
  return data;
}
