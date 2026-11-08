// Fetch through to EOF even when the decoder stops asking for data. IndexedDB
// holds the full stream on disk; MediaSource only needs the decoder's window.
const sessions = new WeakMap();
const mimeFor = video => video ? 'video/mp4; codecs="avc1.640028, mp4a.40.2"' : 'audio/mp4; codecs="mp4a.40.2"';
export const supportsFullBuffer = video => !!globalThis.MediaSource?.isTypeSupported(mimeFor(video));
export function releaseBuffer(video) { sessions.get(video)?.(); sessions.delete(video); }

export function bufferPlayback(video, source, duration, hasVideo) {
  releaseBuffer(video);
  if (!supportsFullBuffer(hasVideo)) return source;
  const media = new MediaSource(), url = URL.createObjectURL(media), controller = new AbortController();
  const name = `matro-buffer-${crypto.randomUUID()}`;
  let db, stopped = false, fetched = 0, appended = 0, complete = false, pumping = false, buffer, bytes = 0;
  const open = new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('chunks');
    request.onsuccess = () => { db = request.result; if (stopped) { db.close(); indexedDB.deleteDatabase(name); } resolve(db); };
    request.onerror = () => reject(request.error);
  });
  void open.catch(() => {});
  const store = (mode, operation) => new Promise((resolve, reject) => {
    const transaction = db.transaction('chunks', mode), request = operation(transaction.objectStore('chunks'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error);
  });
  function fail() {
    if (stopped) return;
    // Storage or MediaSource may be unavailable on some browsers. Keep the
    // ordinary progressive player usable rather than leaving a broken blob URL.
    const at = video.currentTime, paused = video.paused;
    releaseBuffer(video); video.src = source; video.load();
    video.addEventListener('loadedmetadata', () => { video.currentTime = at; if (!paused) void video.play().catch(() => {}); }, { once: true });
  }
  async function pump() {
    if (pumping || stopped || !buffer || buffer.updating || media.readyState !== 'open') return;
    pumping = true;
    try {
      if (appended < fetched) {
        const blob = await store('readonly', s => s.get(appended)), chunk = await blob.arrayBuffer();
        if (stopped || buffer.updating) return;
        try { buffer.appendBuffer(chunk); appended++; }
        catch (error) {
          if (error.name !== 'QuotaExceededError') throw error;
          // Decoder memory is bounded by the browser, while the downloader
          // continues writing the rest to disk. Free already watched frames.
          if (video.currentTime > 30 && buffer.buffered.length && buffer.buffered.start(0) < video.currentTime - 30) buffer.remove(0, video.currentTime - 30);
        }
      } else if (complete) media.endOfStream();
    } catch { fail(); }
    finally { pumping = false; }
  }
  const cleanup = () => {
    stopped = true; controller.abort(); video.removeEventListener('timeupdate', pump);
    db?.close(); indexedDB.deleteDatabase(name); URL.revokeObjectURL(url);
  };
  sessions.set(video, cleanup);
  video.dataset.bufferComplete = 'false'; video.dataset.bufferBytes = '0';
  video.addEventListener('timeupdate', pump);
  media.addEventListener('sourceopen', async () => {
    try {
      await open; if (stopped) return;
      buffer = media.addSourceBuffer(mimeFor(hasVideo));
      if (duration > 0) media.duration = duration;
      buffer.addEventListener('updateend', () => void pump());
      buffer.addEventListener('error', fail);
      const response = await fetch(source, { signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok || !response.body) throw Error('Could not buffer media');
      const reader = response.body.getReader();
      // Store reasonably sized disk blocks rather than thousands of network packets.
      let parts = [], size = 0;
      const flush = async () => {
        if (!size) return;
        await store('readwrite', s => s.put(new Blob(parts), fetched));
        fetched++; parts = []; size = 0; video.dispatchEvent(new Event('progress')); void pump();
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (stopped) return;
        if (done) break;
        parts.push(value); size += value.byteLength; bytes += value.byteLength;
        video.dataset.bufferBytes = String(bytes);
        // Flush the first bytes immediately so startup doesn't wait for 1 MiB.
        if (!fetched || size >= 1024 * 1024) await flush();
      }
      await flush(); complete = true; video.dataset.bufferComplete = 'true'; video.dispatchEvent(new Event('progress')); void pump();
    } catch { if (!stopped) fail(); }
  }, { once: true });
  return url;
}
