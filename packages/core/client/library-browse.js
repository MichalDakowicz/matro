const nameOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function browseTitles(groups, { sort, genre, short }, metadata, name, progress) {
  const rows = groups.flatMap(items => {
    const title = items[0], meta = metadata(title);
    if (genre && !meta?.genres?.includes(genre)) return [];
    if (short) {
      const seconds = title.duration || progress[title.id]?.duration || (meta?.runtime || 0) * 60;
      if (!(seconds > 0 && seconds < 40 * 60)) return [];
    }
    const value = sort === 'added' ? items.reduce((latest, item) => Math.max(latest, item.added || 0), 0)
      : sort === 'year' ? Number(meta?.year) || 0
      : sort === 'rating' ? Number(meta?.rating) || 0 : 0;
    return [{ items, value, name: name(title) }];
  });
  return rows.sort((a, b) => b.value - a.value || nameOrder.compare(a.name, b.name)).map(row => row.items);
}
