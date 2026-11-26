/** @typedef {import('./server.ts').Item} Item */
/** @typedef {import('./server.ts').Progress} Progress */
/** @typedef {Record<string, Progress>} ProgressMap */

/** @param {Item} a @param {Item} b */
export function compareEpisodes(a, b) {
  return (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0)
    || a.title.localeCompare(b.title, undefined, { numeric: true }) || a.id.localeCompare(b.id);
}

/** Season 0 is Specials; an item with no season counts as season 1. @param {Item} item */
export const seasonOf = item => item.season ?? 1;

/** @param {number} season */
export const seasonLabel = season => season === 0 ? 'Specials' : `Season ${season}`;

/** @param {Item[]} items */
export const seasonNumbers = items => [...new Set(items.map(seasonOf))].sort((a, b) => a - b);

/** @param {Item[]} items */
export function groupTitles(items) {
  /** @type {Map<string, Item[]>} */
  const groups = new Map();
  for (const item of items) {
    const key = item.kind === 'show' ? item.groupId || item.group : item.id;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

/** @param {Progress | undefined} entry */
export function isCompleted(entry) {
  if (!entry) return false;
  return entry.completed ?? (entry.duration > 0 && entry.position >= entry.duration - Math.min(10, entry.duration * .05));
}

/** @param {ProgressMap} progress */
export function normalizeProgress(progress) {
  return Object.fromEntries(Object.entries(progress).map(([id, entry]) => {
    if (!entry || (entry.completed !== undefined && Number.isFinite(entry.updated))) return [id, entry];
    // Undated legacy records must stay older than later playback even after a full state save.
    const updated = Number.isFinite(entry.updated) ? entry.updated : 0;
    return [id, { ...entry, completed: isCompleted(entry), updated }];
  }));
}

/** @param {string[]} previous @param {string[]} next */
export function queueChange(previous, next) {
  // Appending the reordered suffix leaves any items added by other devices alone.
  let prefix = 0;
  for (const id of previous) if (id === next[prefix]) prefix++;
  const kept = new Set(next.slice(0, prefix));
  return { add: next.slice(prefix), remove: previous.filter(id => !kept.has(id)) };
}

/** @param {Progress | undefined} entry */
function hasActivity(entry) {
  return !!entry && (entry.position > 0 || isCompleted(entry));
}

/** @param {Item[]} items @param {ProgressMap} progress */
export function isContinueDismissed(items, progress) {
  return items.some(item => progress[item.id]?.hidden)
    && !items.some(item => !progress[item.id]?.hidden && hasActivity(progress[item.id]));
}

/** @param {Item[]} items @param {ProgressMap} previous @param {ProgressMap} current @param {ProgressMap} [resolved] */
export function dismissedProgress(items, previous, current, resolved = {}) {
  const ids = new Set([...items.map(item => item.id), ...Object.keys(resolved)]);
  /** @type {ProgressMap} */
  const patch = {};
  for (const id of ids) {
    const local = current[id], remote = resolved[id];
    if (remote && (remote.updated || 0) >= (local?.updated || 0)) patch[id] = remote;
    // Keep a newer local checkpoint, unless playback created it after the request started.
    else if (local && local === previous[id]) patch[id] = { ...local, hidden: true };
  }
  return patch;
}

/** @param {Item[]} items @param {ProgressMap} progress */
function continuationForTitle(items, progress) {
  const anchor = items.filter(item => !progress[item.id]?.hidden && hasActivity(progress[item.id])).sort((a, b) => {
    const aTime = progress[a.id].updated || 0, bTime = progress[b.id].updated || 0;
    const order = compareEpisodes(a, b);
    if (aTime || bTime) return bTime - aTime || order;
    const aDone = isCompleted(progress[a.id]), bDone = isCompleted(progress[b.id]);
    return Number(aDone) - Number(bDone) || (aDone ? -order : order);
  })[0];
  if (!anchor) return undefined;
  const updated = progress[anchor.id].updated || 0;
  if (!isCompleted(progress[anchor.id])) return { item: anchor, updated };
  if (anchor.kind !== 'show') return undefined;

  const unfinished = items.filter(item => !isCompleted(progress[item.id])).sort(compareEpisodes);
  const item = unfinished.find(item => compareEpisodes(item, anchor) > 0) || unfinished[0];
  return item ? { item, updated } : undefined;
}

/** @param {Item[][]} groups @param {ProgressMap} progress */
export function continueWatching(groups, progress) {
  return groups.flatMap(items => continuationForTitle(items, progress) ?? [])
    .sort((a, b) => b.updated - a.updated).map(({ item }) => item);
}

/** @param {Item[]} items @param {ProgressMap} progress @param {Item} [fallback] */
export function resumeTarget(items, progress, fallback = items[0]) {
  const continuation = continuationForTitle(items, progress);
  if (continuation) return continuation.item;

  // A dismissed show can still be resumed from its title page.
  const unfinished = items.filter(item => !isCompleted(progress[item.id])).sort(compareEpisodes);
  const partial = unfinished.filter(item => progress[item.id]?.position > 0)
    .sort((a, b) => (progress[b.id].updated || 0) - (progress[a.id].updated || 0) || compareEpisodes(a, b))[0];
  return partial || unfinished[0] || fallback;
}
