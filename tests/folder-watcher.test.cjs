const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { watchFolders } = require('../packages/core/desktop/folder-watcher.cjs');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function fakeWatch() {
  const handles = [];
  const watch = (root, _options, listener) => {
    const handle = Object.assign(new EventEmitter(), { root, listener, closed: false, close() { this.closed = true; } });
    handles.push(handle);
    return handle;
  };
  return { watch, handles };
}

test('bursts of changes rescan once, and pending downloads are ignored', async () => {
  const { watch, handles } = fakeWatch(), seen = [];
  const watcher = watchFolders(root => seen.push(root), { watch, delay: 20 });
  watcher.sync(['/media']);
  handles[0].listener('rename', '.matro-pending/Movie.mkv');
  handles[0].listener('change', 'Show/.MATRO-PENDING/a.mkv');
  await wait(60);
  assert.deepEqual(seen, []);
  handles[0].listener('rename', 'A.mkv'); handles[0].listener('change', 'B.mkv');
  await wait(60);
  assert.deepEqual(seen, ['/media']);
  watcher.close();
});

test('removed folders stop watching and a failed watcher restarts and rescans', async () => {
  const { watch, handles } = fakeWatch(), seen = [];
  const watcher = watchFolders(root => seen.push(root), { watch, delay: 10, retry: 20 });
  watcher.sync(['/a', '/b']);
  watcher.sync(['/a']);
  assert.equal(handles.find(h => h.root === '/b').closed, true);
  handles[0].emit('error', new Error('gone'));
  await wait(80);
  assert.equal(handles.filter(h => h.root === '/a').length, 2);
  assert.deepEqual(seen, ['/a']);
  watcher.close();
  assert.equal(handles.every(h => h.closed), true);
});
