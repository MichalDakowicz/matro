export * from '../../../../packages/core/client/server';
import { library as loadLibrary } from '../../../../packages/core/client/server';
import { progressRecovery, recoveryScope } from './storage';
export async function library(base: string) {
  const data = await loadLibrary(base);
  data.progress = await progressRecovery.restore(recoveryScope(base, data.user), data.progress, data.items.map(item => item.id));
  return data;
}
