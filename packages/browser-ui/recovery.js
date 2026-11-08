const valid = entry => entry && Number.isFinite(entry.position) && entry.position >= 0 && Number.isFinite(entry.duration) && entry.duration > 0 && Number.isFinite(entry.updated);

// Synchronous local checkpoints do not depend on the server or unload handlers.
// The browser origin separates servers; the scope separates signed-in accounts.
export function createRecovery(storage, scope, onError = () => {}) {
  const prefix = `matro:recovery:v1:${encodeURIComponent(scope)}:`;
  let warned = false;
  const failed = () => { if (!warned) { warned = true; onError('Local playback recovery could not be saved. Check browser storage.'); } };
  return {
    write(id, entry) {
      if (!valid(entry)) return;
      try {
        let previous; try { previous = JSON.parse(storage().getItem(prefix + id)); } catch {}
        if (valid(previous) && previous.updated > entry.updated) return;
        storage().setItem(prefix + id, JSON.stringify(entry));
      } catch { failed(); }
    },
    restore(progress, ids) {
      const merged = { ...progress }; let recovered = false;
      for (const id of ids) {
        let entry;
        try { entry = JSON.parse(storage().getItem(prefix + id)); } catch { continue; }
        if (valid(entry) && (!valid(merged[id]) || entry.updated > merged[id].updated)) { merged[id] = entry; recovered = true; }
      }
      return { progress: merged, recovered };
    }
  };
}
