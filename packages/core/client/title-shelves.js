const WATCH_LATER = { id: 'watch-later', name: 'Watch Later', titles: [] };

/** @param {import('./server.ts').TitleList[]} [lists] */
export function listChoices(lists = []) {
  return [lists.find(list => list.id === WATCH_LATER.id) || WATCH_LATER, ...lists.filter(list => list.id !== WATCH_LATER.id)];
}

/**
 * @param {import('./server.ts').Item[][]} groups
 * @param {import('./server.ts').TitleList[] | undefined} lists
 * @param {(item: import('./server.ts').Item) => string} key
 * @param {(item: import('./server.ts').Item) => import('./server.ts').Metadata | null} metadata
 */
export function titleShelves(groups, lists, key, metadata) {
  const index = new Map(groups.map(items => [key(items[0]), items]));
  const shelves = listChoices(lists).map(list => ({
    id: list.id, name: list.name, groups: list.titles.flatMap(id => { const items = index.get(id); return items ? [items] : []; }),
  }));
  /** @type {Map<string, { id: string, name: string, groups: import("./server.ts").Item[][] }>} */
  const collections = new Map();
  for (const items of groups) {
    const collection = metadata(items[0])?.collection;
    if (!collection || items[0].kind !== 'movie') continue;
    const id = 'tmdb-' + collection.id;
    const shelf = collections.get(id);
    if (shelf) shelf.groups.push(items);
    else collections.set(id, { id, name: collection.name, groups: [items] });
  }
  return [...shelves.filter(shelf => shelf.groups.length), ...[...collections.values()].filter(shelf => shelf.groups.length > 1)];
}
