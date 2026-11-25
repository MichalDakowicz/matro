import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { playbackPath } from '../../../../packages/core/client/server.ts';
import { parseVtt } from '../../../../packages/core/client/subtitles.ts';
import { isContinueDismissed } from '../../../../packages/core/client/watch-progress.js';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const code = ts.transpileModule(readFileSync(new URL('../player/usePlayback.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

// Exercise the real hook with asynchronous native replacements and events. The
// platform boundary is fake; playback URLs, subtitles and hook logic are real.
function harness(t: any, directPlay = false, savedAtOpen = false) {
  const effects: (() => (() => void) | void)[] = [], states: any[] = [], listeners = new Map<string, Function>();
  const pending: { source: any; resolve: () => void; reject: (error: Error) => void }[] = [], downloads: { ready: (uri: string) => void; cancelled: boolean }[] = [];
  const saved: any[] = [], activity: { session: string; playing: boolean }[] = [];
  const app = { currentState: 'active', addEventListener: (_: string, callback: Function) => { listeners.set('appState', callback); return { remove() {} }; } };
  const player = {
    currentTime: 0, playbackRate: 1, playing: false, status: 'readyToPlay', bufferedPosition: 20,
    pause() { this.playing = false; }, play() { this.playing = true; },
    replaceAsync(source: any) { return new Promise<void>((resolve, reject) => pending.push({ source, resolve, reject })); },
    addListener(name: string, callback: Function) { listeners.set(name, callback); return { remove() {} }; },
  };
  const info = { duration: 200, directPlay, audio: [{ index: 1 }], embedded: [], uploaded: [{ id: 1, name: 'English', language: 'en' }] };
  const data = { user: {}, preferences: { tracks: {} }, progress: {}, markers: {} };
  const localCopy = { uri: 'file:///saved.mp4', info, text: {} };
  let available = savedAtOpen, inspections = 0;
  const modules: Record<string, any> = {
    react: { useCallback: (fn: Function) => fn, useEffect: (fn: any) => effects.push(fn), useRef: (current: any) => ({ current }), useState: (initial: any) => { const value = typeof initial === 'function' ? initial() : initial; const i = states.push(value) - 1; return [value, (next: any) => { states[i] = next; }]; } },
    'react-native': { AppState: app, Platform: { OS: 'android' } },
    'expo-video': { useVideoPlayer: () => player },
    '../lib/server': { inspect: async () => { inspections++; return info; }, mediaHeaders: async () => ({}), playbackPath, request: async () => ({ markers: {} }), saveProgress: async (_: any, __: any, entry: any) => saved.push(entry),
      playbackState: async (_: string, session: string, playing: boolean) => activity.push({ session, playing }), stopPlayback: async () => {} },
    '../../../../packages/core/client/library': { trackKey: () => 'movie', matchTrack: () => undefined },
    '../../../../packages/core/client/watch-progress.js': { isContinueDismissed },
    '../../../../packages/core/client/subtitles': { parseVtt },
    './diskBuffer': { downloadPlayback: (_: any, __: any, ready: any) => { const job = { ready, cancelled: false }; downloads.push(job); return () => { job.cancelled = true; }; } },
    '../lib/storage': { recoveryScope: () => 'test', progressRecovery: { write: async () => {} } },
    '../lib/offline': { savedTitle: async () => available ? localCopy : undefined },
  };
  const context = { exports: {} as any, require: (name: string) => { assert.ok(modules[name], name); return modules[name]; },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, AbortController, Date,
    fetch: async () => ({ ok: true, text: async () => 'WEBVTT\n\n00:00:05.000 --> 00:00:10.000\nCaption' }),
  };
  vm.runInNewContext(code, context);
  let ended = 0;
  const hook = context.exports.usePlayback({ base: 'http://server', data, item: { id: 'movie', kind: 'movie', format: 'MKV' }, saved: savedAtOpen ? localCopy : undefined, onEnd: () => { ended++; } });
  const cleanups = effects.map(fn => fn());
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup?.(); });
  return { hook, player, pending, downloads, saved, activity, app, states, localCopy, inspections: () => inspections,
    finishOfflineSave: () => { available = true; },
    emit: (name: string, event: any = {}) => listeners.get(name)?.(event), ended: () => ended };
}

test('a completed download leaves the decoder running and is used on the next seek', async t => {
  const h = harness(t); await flush();
  h.pending[0].resolve(); await flush();
  h.player.currentTime = 6; h.emit('timeUpdate', { currentTime: 6 });
  h.downloads[0].ready('file:///complete.mp4'); await flush();
  assert.equal(h.pending.length, 1);
  assert.equal(h.player.playing, true);
  h.hook.seek(30); await flush();
  assert.equal(h.pending[1].source.uri, 'file:///complete.mp4');
  assert.equal(h.downloads[0].cancelled, false, 'the cached file stays alive while in use');
  h.pending[1].resolve(); await flush();
  assert.equal(h.player.currentTime, 30);
});

test('rapid seeks serialize native loads and skip superseded requests', async t => {
  const h = harness(t); await flush();
  h.hook.seek(30); h.hook.seek(60); await flush();
  assert.equal(h.pending.length, 1, 'the initial native load must finish first');
  h.pending[0].resolve(); await flush();
  assert.equal(h.pending.length, 2);
  assert.match(h.pending[1].source.uri, /t=60&audio=1/);
  h.pending[1].resolve(); await flush();
  h.player.currentTime = .25; h.emit('timeUpdate', { currentTime: 190 });
  await h.hook.persist();
  assert.equal(h.saved.at(-1).position, 60.25);
  assert.equal(h.downloads.length, 1, 'stale loads must not start downloads');
});

test('backward seeks ignore the old clock and old event payloads, and clear subtitles immediately', async t => {
  const h = harness(t, true); await flush(); h.pending[0].resolve(); await flush();
  assert.equal(h.downloads.length, 0, 'direct play needs no temporary disk copy');
  h.hook.chooseSubtitle(10001); await flush();
  h.player.currentTime = 0; h.emit('timeUpdate');
  h.player.currentTime = 6; h.emit('timeUpdate');
  assert.equal(h.states[6], 'Caption');
  h.hook.seek(2);
  assert.equal(h.states[6], '');
  h.player.currentTime = 80; h.emit('timeUpdate', { currentTime: 80 });
  h.emit('playToEnd'); await flush();
  assert.equal(h.pending.length, 1, 'an old end event cannot restart a pending seek');
  await h.hook.persist(); assert.equal(h.saved.at(-1).position, 2);
  h.player.currentTime = 2; h.emit('timeUpdate', { currentTime: 80 });
  await h.hook.persist(); assert.equal(h.saved.at(-1).position, 2);
  assert.equal(h.ended(), 0);
});

test('online playback selects saved media before inspection', async t => {
  const h = harness(t, false, true); await flush();
  assert.equal(h.pending[0].source.uri, h.localCopy.uri);
  assert.equal(h.inspections(), 0);
  h.pending[0].resolve(); await flush();
  assert.equal(h.downloads.length, 0);
});

test('a stream failure selects a saved copy that became available during playback', async t => {
  const h = harness(t, true); await flush(); h.pending[0].resolve(); await flush();
  h.finishOfflineSave();
  h.player.status = 'error';
  h.emit('statusChange', { status: 'error' }); await flush();
  assert.ok(h.states.includes(h.localCopy));
  assert.equal(h.pending.length, 1, 'recovery does not restart the stream');
});

test('pausing during a replacement and backgrounding never resume playback on completion', async t => {
  const h = harness(t); await flush();
  h.hook.toggle(); h.pending[0].resolve(); await flush();
  assert.equal(h.player.playing, false);
  h.hook.toggle(); assert.equal(h.player.playing, true);
  h.emit('playingChange', { isPlaying: true });
  const session = new URL(h.pending[0].source.uri).searchParams.get('session');
  assert.ok(session);
  assert.deepEqual(h.activity.at(-1), { session, playing: true });
  h.hook.seek(30); await flush();
  h.app.currentState = 'background'; h.emit('appState', 'background');
  assert.deepEqual(h.activity.at(-1), { session, playing: false });
  h.pending[1].resolve(); await flush();
  assert.equal(h.player.playing, false);
  h.app.currentState = 'active'; h.emit('appState', 'active');
  h.hook.toggle(); assert.equal(h.player.playing, true, 'one tap resumes after returning from the background');
});

test('a failed native replacement does not block a later seek', async t => {
  const h = harness(t); await flush();
  h.pending[0].reject(Error('decoder failed')); await flush();
  h.hook.seek(30); await flush();
  assert.equal(h.pending.length, 2);
  h.pending[1].resolve(); await flush();
  assert.equal(h.player.playing, true);
});
