const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');

test('downloading reaches EOF on disk while a paused decoder has stopped consuming, and exit removes the buffer', async () => {
  const profile = path.resolve(__dirname, '../.test-media', `disk-buffer-${Date.now()}`);
  await fs.mkdir(profile, { recursive: true });
  const env = { ...process.env, MATRO_USER_DATA: profile, MATRO_METADATA: 'off' }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve(__dirname, '..')], env });
  try {
    const page = await app.firstWindow();
    const result = await page.evaluate(async () => {
      const { bufferPlayback, releaseBuffer } = await import('matro://app/playback-buffer.js');
      const original = { MediaSource: window.MediaSource, fetch: window.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
      let appendCount = 0;
      class Media extends EventTarget {
        static isTypeSupported() { return true; }
        readyState = 'open';
        constructor() { super(); setTimeout(() => this.dispatchEvent(new Event('sourceopen')), 0); }
        addSourceBuffer() {
          const buffer = new EventTarget(); buffer.updating = false;
          buffer.appendBuffer = () => { appendCount++; buffer.updating = true; }; // Decoder stays full/paused.
          return buffer;
        }
      }
      window.MediaSource = Media; URL.createObjectURL = () => 'blob:test-buffer'; URL.revokeObjectURL = () => {};
      const payload = new Uint8Array(1024 * 1024);
      let sent = 0;
      window.fetch = async () => new Response(new ReadableStream({
        async pull(controller) {
          await new Promise(resolve => setTimeout(resolve, 20));
          if (sent++ < 4) controller.enqueue(payload); else controller.close();
        }
      }));
      const video = document.createElement('video');
      const before = (await indexedDB.databases()).map(db => db.name);
      try {
        bufferPlayback(video, '/test-stream', 60, true);
        const deadline = Date.now() + 5000;
        while (video.dataset.bufferComplete !== 'true' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        const during = (await indexedDB.databases()).map(db => db.name).filter(name => !before.includes(name));
        const state = { complete: video.dataset.bufferComplete, bytes: Number(video.dataset.bufferBytes), paused: video.paused, appendCount, diskFiles: during.length };
        releaseBuffer(video);
        for (let n = 0; n < 100 && (await indexedDB.databases()).some(db => during.includes(db.name)); n++) await new Promise(resolve => setTimeout(resolve, 20));
        return { ...state, remaining: (await indexedDB.databases()).filter(db => during.includes(db.name)).length };
      } finally {
        releaseBuffer(video); window.MediaSource = original.MediaSource; window.fetch = original.fetch; URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke;
      }
    });
    expect(result).toEqual({ complete: 'true', bytes: 4 * 1024 * 1024, paused: true, appendCount: 1, diskFiles: 1, remaining: 0 });
  } finally { await app.close(); }
});
