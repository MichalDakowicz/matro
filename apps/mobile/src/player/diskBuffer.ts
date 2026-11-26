import { File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';

const MAX_PLAYBACK_BYTES = 256 * 1024 * 1024;
const PLAYBACK_FILE = /^matro-playback-.*\.mp4$/;

export function clearPlaybackCache() {
  for (const entry of Paths.cache.list()) {
    if (entry instanceof File && PLAYBACK_FILE.test(entry.name)) {
      try { entry.delete(); } catch { /* A missing cache entry is already clear. */ }
    }
  }
}

// Only the caller's transcodes use this cache. Playable copies must reach EOF within the size limit.
export function downloadPlayback(uri: string, headers: Record<string, string>, ready: (file: string) => void) {
  const file = new File(Paths.cache, `matro-playback-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  const controller = new AbortController(), { signal } = controller;
  let complete = false;
  const clear = () => {
    try { if (file.exists) file.delete(); } catch { /* Retry cleanup during the next launch. */ }
  };
  const finished = (async () => {
    const response = await fetch(uri, { headers, signal });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_PLAYBACK_BYTES || signal.aborted) return;
    file.create();
    const writer = file.open();
    try {
      const reader = response.body.getReader();
      try {
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (signal.aborted || size > MAX_PLAYBACK_BYTES) return;
          writer.writeBytes(value);
        }
        complete = size > 0 && !signal.aborted;
      } finally { reader.releaseLock(); }
    } finally { writer.close(); }
    if (complete) ready(file.uri);
  })().catch(() => { complete = false; }).finally(() => {
    if (!complete) { controller.abort(); clear(); }
  });
  return () => {
    controller.abort();
    void finished.then(clear);
  };
}
