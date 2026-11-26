/** @param {string[]} titles @param {string | null} previous */
export function randomReelStart(titles, previous, random = Math.random) {
  if (titles.length < 2) return 0;
  const excluded = previous === null ? -1 : titles.indexOf(previous);
  const index = Math.floor(random() * (titles.length - Number(excluded >= 0)));
  return excluded >= 0 && index >= excluded ? index + 1 : index;
}
