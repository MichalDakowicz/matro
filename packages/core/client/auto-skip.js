/** @typedef {{type: string, start: number, end: number}} SkipMarker */

const contains = (/** @type {SkipMarker} */ marker, /** @type {number} */ position) =>
  position >= marker.start && position < marker.end;

/** Create one tracker for each playback, keeping it through source changes. */
export function createAutoSkip() {
  const skipped = new Set();
  let seekPosition = NaN;
  return {
    /** @param {number} position */
    seek(position) { seekPosition = position; },
    /** @param {SkipMarker[]} markers @param {number} position @param {number} duration */
    target(markers, position, duration) {
      if (!Number.isFinite(duration) || duration <= 0) return null;
      for (const marker of markers) {
        if ((marker.type !== 'intro' && marker.type !== 'recap') || !contains(marker, position) || contains(marker, seekPosition)) continue;
        // Marker lists can be refreshed while the same file is playing.
        const key = JSON.stringify([marker.type, marker.start, marker.end]);
        const end = Math.min(marker.end, duration - .1);
        if (skipped.has(key) || end <= position) continue;
        skipped.add(key);
        return end;
      }
      return null;
    },
  };
}
