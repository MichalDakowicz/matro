import { cacheDirectory, createDownloadResumable, deleteAsync } from 'expo-file-system/legacy';

// The native decoder's bounded RAM buffer must not control how far we download.
// This temporary disk copy continues to EOF and is removed on source changes/exit.
export function downloadPlayback(uri: string, headers: Record<string, string>, ready: (file: string) => void) {
  if (!cacheDirectory) return () => {};
  const file = `${cacheDirectory}matro-playback-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  let cancelled = false;
  const task = createDownloadResumable(uri, file, { headers });
  const finished = task.downloadAsync().then(result => {
    if (!cancelled && result && result.status >= 200 && result.status < 300) ready(file);
  }).catch(() => { /* The ordinary player remains usable if the disk is full. */ });
  return () => {
    cancelled = true;
    void task.cancelAsync().catch(() => {}).then(() => finished).then(() => deleteAsync(file, { idempotent: true })).catch(() => {});
  };
}
