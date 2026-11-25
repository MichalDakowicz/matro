export * from '../../../../packages/core/client/server';
import { changeProgress, library as loadLibrary, ServerError, writeWatchState, type MatroUser, type Progress } from '../../../../packages/core/client/server';
import type { Dismissal } from '../../../../packages/core/client/recovery';
import { progressRecovery, recoveryScope, rememberLibrary, rememberProgress } from './storage';

export const accountChanged = (error: unknown) => error instanceof ServerError && (error.status === 401 || error.status === 409);

const updates = new Map<string, Promise<unknown>>();
export function updateWatchOptions(base: string, user: MatroUser, patch: Pick<Parameters<typeof writeWatchState>[2], 'queueChange' | 'preferences'>) {
  const scope = recoveryScope(base, user);
  const update = (updates.get(scope) || Promise.resolve()).catch(() => {}).then(() => writeWatchState(base, user.id, patch));
  updates.set(scope, update);
  return update.finally(() => { if (updates.get(scope) === update) updates.delete(scope); });
}

async function syncProgress(base: string, user: MatroUser, progress: Record<string, Progress>) {
  const result = await writeWatchState(base, user.id, { progress });
  if (result.progress) {
    await rememberProgress(base, user, result.progress);
    await progressRecovery.confirm(recoveryScope(base, user), progress, result.progress);
  }
  return result.progress;
}
export const saveProgress = (base: string, id: string, entry: Progress, user: MatroUser) => syncProgress(base, user, { [id]: entry });

export async function syncDismissal(base: string, user: MatroUser, dismissal: Dismissal) {
  const { progress } = await changeProgress(base, user.id, dismissal.id, { dismiss: true, dismissedAt: dismissal.at });
  await rememberProgress(base, user, progress);
  await progressRecovery.confirm(recoveryScope(base, user), {}, progress, dismissal);
  return progress;
}

export async function library(base: string, accountId?: number) {
  const data = await loadLibrary(base, accountId), scope = recoveryScope(base, data.user);
  const cached = await rememberLibrary(base, data).then(() => true, () => false);
  const initial = await progressRecovery.snapshot(scope, data.items, data.progress, cached).catch(() => null);
  if (!initial) return data;
  const { pending } = initial;
  if (!Object.keys(pending.progress).length && !Object.keys(pending.dismissals).length) return { ...data, progress: initial.progress };
  try {
    if (Object.keys(pending.progress).length) {
      const confirmed = await syncProgress(base, data.user, pending.progress);
      Object.assign(data.progress, confirmed);
    }
    for (const dismissal of Object.values(pending.dismissals)) {
      try { Object.assign(data.progress, await syncDismissal(base, data.user, dismissal)); }
      catch (error) { if (!(error instanceof ServerError && error.status === 404)) throw error; }
    }
  } catch (error) { if (accountChanged(error)) throw error; }
  const recovered = await progressRecovery.snapshot(scope, data.items, data.progress).catch(() => null);
  return recovered ? { ...data, progress: recovered.progress } : data;
}
