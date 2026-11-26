export const CHUNK = 8 * 1024 * 1024;
export const DOWNLOAD_SLOTS = 2;
export const PREFETCH_PIECES = 3;
export const RETRY_DELAY_MS = 30_000;
const PREPARATION_IDLE_MS = 30 * 60 * 1000;

/** @param {number} size */
export const chunkCount = size => Math.ceil(size / CHUNK);
/** @param {number} size @param {number} index */
export const chunkRange = (size, index) => ({ start: index * CHUNK, end: Math.min(size, (index + 1) * CHUNK) - 1 });
/** @param {string} id */
export const offlinePath = id => `/api/items/${encodeURIComponent(id)}/offline`;
/** @param {{text?: boolean, bitmap?: boolean}} track */
export const isTextCaption = track => track.text && !track.bitmap;

export class RetryableDownloadError extends Error {}

/** @param {AbortSignal} signal */
function checkAbort(signal) {
  if (signal.aborted) throw signal.reason || Object.assign(new Error('Download cancelled.'), { name: 'AbortError' });
}

/** @param {number} ms @param {AbortSignal} signal */
const wait = (ms, signal) => new Promise((resolve, reject) => {
  checkAbort(signal);
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(undefined); }, ms);
  function abort() {
    clearTimeout(timer);
    try { checkAbort(signal); } catch (error) { reject(error); }
  }
  signal.addEventListener('abort', abort, { once: true });
});

/** @template T @param {AbortSignal} signal @param {() => Promise<T>} run @param {number} [retries] @returns {Promise<T>} */
export async function retrying(signal, run, retries = 6) {
  for (let tries = 0;; tries++) {
    checkAbort(signal);
    try { return await run(); }
    catch (error) {
      if (signal.aborted || error?.name === 'AbortError' || (error?.status >= 400 && error.status < 500)) throw error;
      if (tries >= retries) throw new RetryableDownloadError(error?.message || 'Could not reach the server.');
      await wait(Math.min(RETRY_DELAY_MS, 1500 * 2 ** tries), signal);
    }
  }
}

/** @typedef {{state: 'preparing', progress?: number | null}} Preparing */
/** @typedef {{state: 'ready', size: number, type: string, version: string}} Ready */
/**
 * @param {AbortSignal} signal
 * @param {() => Promise<Preparing | Ready>} load
 * @param {(progress: number | undefined, advancedAt: number) => void | Promise<void>} report
 * @param {{lastProgress?: number, advancedAt?: number, stallWithoutProgress?: boolean}} [options]
 */
export async function prepareDownload(signal, load, report, { lastProgress, advancedAt = Date.now(), stallWithoutProgress = true } = {}) {
  for (;;) {
    const status = await retrying(signal, load);
    checkAbort(signal);
    if (status?.state === 'ready') {
      if (!Number.isSafeInteger(status.size) || status.size < 1 || !/^[a-f0-9]{64}$/.test(status.version)) {
        throw new Error('Invalid prepared file.');
      }
      return status;
    }
    if (status?.state !== 'preparing') throw new Error('Invalid preparation status.');
    const progress = typeof status.progress === 'number' && Number.isFinite(status.progress) ? status.progress : undefined;
    if (progress !== undefined) {
      if (lastProgress === undefined || progress > lastProgress) advancedAt = Date.now();
      lastProgress = progress;
    }
    await report(progress, advancedAt);
    if ((progress !== undefined || stallWithoutProgress) && Date.now() - advancedAt >= PREPARATION_IDLE_MS) {
      throw new RetryableDownloadError('Server preparation has not advanced for 30 minutes. Resume to check again.');
    }
    await wait(2000, signal);
  }
}

/**
 * The body deadline restarts when the reader calls touch after receiving more bytes.
 * @template R, T
 * @param {(signal: AbortSignal) => Promise<R>} send
 * @param {(response: R, touch: () => void) => Promise<T>} read
 * @param {{signal?: AbortSignal, requestMs?: number, bodyMs?: number}} [options]
 * @returns {Promise<T>}
 */
export async function fetchWithDeadline(send, read, { signal, requestMs = 15000, bodyMs = 30000 } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel);
  if (signal?.aborted) cancel();
  /** @template V @param {(touch: () => void) => Promise<V>} run @param {number} ms @param {string} message */
  async function phase(run, ms, message) {
    checkAbort(controller.signal);
    let timedOut = false, rejectAbort = () => {};
    /** @type {Promise<never>} */
    const aborted = new Promise((_, reject) => {
      rejectAbort = () => reject(new Error(timedOut ? message : 'Request cancelled.'));
      controller.signal.addEventListener('abort', rejectAbort);
    });
    const arm = () => setTimeout(() => { timedOut = true; cancel(); }, ms);
    let timer = arm();
    const touch = () => { clearTimeout(timer); if (!controller.signal.aborted) timer = arm(); };
    try { return await Promise.race([aborted, run(touch)]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', rejectAbort); }
  }
  try {
    const response = await phase(() => send(controller.signal), requestMs, 'The server took too long to respond.');
    return await phase(touch => read(response, touch), bodyMs, 'The server took too long to send the response.');
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

/** @param {number} status @param {string} message */
const responseError = (status, message) => Object.assign(new Error(message), { status });
/** @typedef {Pick<Response, 'status' | 'ok' | 'headers' | 'body' | 'arrayBuffer' | 'text'>} TransferResponse */
/**
 * @param {(path: string, headers: Record<string, string>, signal: AbortSignal) => Promise<TransferResponse>} send
 * @param {string} path
 * @param {Ready} prepared
 * @param {{start: number, end: number}} range
 * @param {AbortSignal} signal
 */
export function fetchPiece(send, path, { version, size }, { start, end }, signal) {
  return retrying(signal, () => fetchWithDeadline(
    requestSignal => send(`${path}/file?version=${encodeURIComponent(version)}`, { range: `bytes=${start}-${end}` }, requestSignal),
    async (response, touch) => {
      if (response.status === 401) throw responseError(401, 'Sign in again to finish the download.');
      if (response.status === 409) throw responseError(409, 'The prepared file changed. Retry the download.');
      if (!response.ok) throw responseError(response.status, `Could not download media (HTTP ${response.status}).`);
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`) {
        throw responseError(422, 'The server returned an invalid byte range.');
      }
      const expected = end - start + 1, reader = response.body?.getReader();
      if (!reader) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length === expected) return bytes;
        throw new Error('The server sent an incomplete piece.');
      }
      const bytes = new Uint8Array(expected);
      let have = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (have + chunk.value.length > expected) throw new Error('The server sent too much data.');
          bytes.set(chunk.value, have);
          have += chunk.value.length;
          if (chunk.value.length) touch();
        }
      } finally { reader.releaseLock(); }
      if (have !== expected) throw new Error('The server sent an incomplete piece.');
      return bytes;
    }, { signal },
  ));
}

/** @param {(signal: AbortSignal) => Promise<TransferResponse>} send @param {AbortSignal} signal */
export async function optionalCaption(send, signal) {
  try {
    const text = await retrying(signal, () => fetchWithDeadline(send, async response => {
      if (!response.ok) throw responseError(response.status, `Could not download subtitles (HTTP ${response.status}).`);
      return response.text();
    }, { signal }));
    checkAbort(signal);
    return text;
  } catch (error) {
    checkAbort(signal);
    if (error?.status === 404 || error?.status === 410) return undefined;
    throw error;
  }
}
