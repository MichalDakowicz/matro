const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mediaArgs } = require('../packages/core/desktop/open-with.cjs');

const cwd = path.resolve('videos'), film = path.join(cwd, 'Film.MKV'), other = path.resolve('other', 'song.flac');
test('a packaged app reads media files from argv[1] onward and ignores switches and other files', () => {
  assert.deepEqual(mediaArgs(['Matro.exe', film, '--user-data-dir=profile', 'notes.txt'], { cwd, defaultApp: false }), [film]);
  assert.deepEqual(mediaArgs(['Matro.exe'], { cwd, defaultApp: false }), []);
});
test('a development run skips the app folder argument', () => {
  assert.deepEqual(mediaArgs(['electron.exe', path.resolve('repo'), 'clip.mp4'], { cwd, defaultApp: true }), [path.join(cwd, 'clip.mp4')]);
  assert.deepEqual(mediaArgs(['electron.exe', path.resolve('repo', 'movie.mkv')], { cwd, defaultApp: true }), []);
});
test('a second instance resolves relative names against its own working directory', () => {
  assert.deepEqual(mediaArgs(['Matro.exe', path.join('..', 'other', 'song.flac')], { cwd, defaultApp: false }), [other]);
});
test('server addresses are not mistaken for files', () => {
  assert.deepEqual(mediaArgs(['Matro.exe', '--server', 'https://example.test/a.mkv', 'https://example.test/b.mp4'], { cwd, defaultApp: false }), []);
});
