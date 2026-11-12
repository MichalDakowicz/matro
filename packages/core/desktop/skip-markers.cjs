// Repeated shots can yield several disjoint candidates. Keep the longest
// continuous sequence per type rather than exposing every match as a skip.
// Do not bridge long gaps: those may contain story material or a post-credit scene.
function primaryMarkers(markers) {
  const manual = markers.filter(m => m.source !== 'automatic');
  const selected = [];
  for (const type of ['intro', 'outro', 'recap']) {
    if (manual.some(m => m.type === type)) continue;
    const candidates = markers.filter(m => m.source === 'automatic' && m.type === type && !manual.some(s => s.start < m.end && s.end > m.start)).sort((a, b) => a.start - b.start);
    const merged = [];
    for (const marker of candidates) {
      const prior = merged.at(-1);
      if (prior && marker.start <= prior.end + (type === 'outro' ? 10 : 2)) prior.end = Math.max(prior.end, marker.end);
      else merged.push({ ...marker });
    }
    merged.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    if (merged.length) selected.push(merged[0]);
  }
  const intro = [...manual, ...selected].find(m => m.type === 'intro');
  // Short story matches after the opening were being labelled as recaps too.
  // Only suggest an automatic recap before the opening; manual marks are kept.
  return [...manual, ...selected.filter(m => m.type !== 'recap' || !intro || m.end <= intro.start)].sort((a, b) => a.start - b.start);
}
module.exports = { primaryMarkers };
