const fs = require('node:fs');

function watchFolders(onChange, { watch = fs.watch, delay = 750, retry = 30000 } = {}) {
  const watchers = new Map();
  const cancel = entry => { clearTimeout(entry.timer); entry.handle?.close(); };

  function start(root, entry, recovered = false) {
    if (watchers.get(root) !== entry) return;
    const changed = () => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        if (watchers.get(root) === entry) void Promise.resolve(onChange(root)).catch(() => {});
      }, delay);
      entry.timer.unref();
    };
    const failed = () => {
      if (watchers.get(root) !== entry) return;
      cancel(entry);
      entry.handle = null;
      entry.timer = setTimeout(() => start(root, entry, true), retry);
      entry.timer.unref();
    };
    try {
      entry.handle = watch(root, { persistent: false, recursive: true }, (_event, file) => {
        if (String(file || '').split(/[\\/]/).some(name => name.toLowerCase() === '.matro-pending')) return;
        changed();
      });
      entry.handle.on('error', failed);
      if (recovered) changed();
    } catch { failed(); }
  }
  function sync(roots) {
    const wanted = new Set(roots);
    for (const [root, entry] of watchers) if (!wanted.has(root)) { watchers.delete(root); cancel(entry); }
    for (const root of wanted) if (!watchers.has(root)) {
      const entry = {};
      watchers.set(root, entry);
      start(root, entry);
    }
  }
  return { sync, close: () => sync([]) };
}
module.exports = { watchFolders };
