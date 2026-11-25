const { randomUUID } = require('node:crypto');
const watchLater = 'watch-later';

function editTitleLists(lists, change, hasTitle) {
  const { action, listId, titleId, present } = change || {};
  if (action === 'create') {
    const name = typeof change.name === 'string' ? change.name.trim() : '';
    if (!name || name.length > 60) throw new Error('Enter a list name up to 60 characters.');
    if (name.toLowerCase() === 'watch later' || lists.some(list => list.name.toLowerCase() === name.toLowerCase())) throw new Error('A list already has that name.');
    if (lists.filter(list => list.id !== watchLater).length >= 29) throw new Error('You can create up to 29 lists.');
    if (titleId && !hasTitle(titleId)) throw new Error('That title is no longer in the library.');
    return [...lists, { id: randomUUID(), name, titles: titleId ? [titleId] : [] }];
  }
  if (action === 'delete' && listId !== watchLater) return lists.filter(list => list.id !== listId);
  if (action !== 'set' || typeof present !== 'boolean' || typeof titleId !== 'string') throw new Error('Invalid list change.');
  const list = lists.find(list => list.id === listId) || (listId === watchLater ? { id: watchLater, name: 'Watch Later', titles: [] } : null);
  if (!list) throw new Error('That list no longer exists.');
  if (present && !hasTitle(titleId)) throw new Error('That title is no longer in the library.');
  const titles = present ? [...new Set([...list.titles, titleId])] : list.titles.filter(id => id !== titleId);
  if (titles.length > 2000) throw new Error('This list is full.');
  return lists.some(existing => existing.id === list.id) ? lists.map(existing => existing.id === list.id ? { ...list, titles } : existing) : [{ ...list, titles }, ...lists];
}
module.exports = { editTitleLists };
