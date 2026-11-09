const valid = entry => entry && Number.isFinite(entry.position) && entry.position >= 0 && Number.isFinite(entry.duration) && entry.duration > 0 && Number.isFinite(entry.updated);

const DATABASE = 'matro-playback-recovery', STORE = 'checkpoints';
function openRecovery() {
  return new Promise(resolve => {
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

// Keep a quick checkpoint in localStorage and commit a durable copy on each
// save. Neither copy depends on the server or on unload running successfully.
export function createRecovery(storage, scope, onError = () => {}) {
  const prefix = `matro:recovery:v1:${encodeURIComponent(scope)}:`;
  let database;
  const open = () => database ||= openRecovery();
  const queued = new Map();
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
    persist(progress) {
      const changed = [];
      for (const [id, entry] of Object.entries(progress)) {
        if (!valid(entry)) continue;
        const json = JSON.stringify(entry);
        if (queued.get(id) === json) continue;
        queued.set(id, json); changed.push([id, { ...entry }, json]);
      }
      if (!changed.length) return;
      void open().then(db => {
        if (!db) return;
        const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
        const store = tx.objectStore(STORE);
        tx.onabort = () => { for (const [id, , json] of changed) if (queued.get(id) === json) queued.delete(id); };
        for (const [id, entry] of changed) {
          const key = prefix + id, existing = store.get(key);
          existing.onsuccess = () => { if (!valid(existing.result) || entry.updated >= existing.result.updated) store.put(entry, key); };
        }
      }).catch(() => { for (const [id, , json] of changed) if (queued.get(id) === json) queued.delete(id); });
    },
    async restore(progress, ids) {
      const merged = { ...progress }; let recovered = false;
      const accept = (id, entry) => {
        if (valid(entry) && (!valid(merged[id]) || entry.updated > merged[id].updated)) { merged[id] = entry; recovered = true; }
      };
      for (const id of ids) {
        try { accept(id, JSON.parse(storage().getItem(prefix + id))); } catch { /* Read the durable copy below. */ }
      }
      const db = await open();
      if (db && ids.length) await new Promise(resolve => {
        try {
          const tx = db.transaction(STORE, 'readonly'), store = tx.objectStore(STORE);
          tx.oncomplete = tx.onabort = resolve;
          for (const id of ids) { const request = store.get(prefix + id); request.onsuccess = () => accept(id, request.result); }
        } catch { resolve(); }
      });
      return { progress: merged, recovered };
    }
  };
}
