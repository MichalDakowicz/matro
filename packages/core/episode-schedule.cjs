function coveredEpisodes({ path, season, episode }) {
  const name = path?.split(/[\\/]/).pop() || '';
  const code = name.match(/S(\d{1,2})[ ._-]*E(\d{1,4})(?!\d)((?:-?E\d{1,4}(?!\d))*)/i);
  const covered = [episode];
  if (!code || Number(code[1]) !== season || Number(code[2]) !== episode) return covered;
  let previous = episode;
  for (const [, dash, number] of code[3].matchAll(/(-?)E(\d{1,4})/gi)) {
    const end = Number(number);
    for (let current = dash && end > previous ? previous + 1 : end; current <= end; current++) covered.push(current);
    previous = end;
  }
  return covered;
}

function episodeGaps(episodes, owned, today = new Date().toISOString().slice(0, 10)) {
  const present = new Set(owned.flatMap(item => coveredEpisodes(item).map(episode => item.season + ':' + episode)));
  return episodes.filter(episode => episode.airDate && !present.has(episode.season + ':' + episode.episode)).map(episode => ({
    ...episode, status: episode.airDate > today ? 'upcoming' : 'missing',
  })).sort((a, b) => a.status.localeCompare(b.status)
    || (a.status === 'upcoming' ? a.airDate.localeCompare(b.airDate) : b.airDate.localeCompare(a.airDate))
    || a.season - b.season || a.episode - b.episode);
}
module.exports = { episodeGaps };
