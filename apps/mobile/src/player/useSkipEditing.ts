import { useState } from 'react';
import { inspect, request, type Item, type Segment } from '../lib/server';
import { markerTypes, seasonCopies, type MarkerType } from './playerTools';

type Draft = { type: MarkerType; start: number };

/** Marking, saving, removing and copying skip ranges through the same routes the web player uses. */
export function useSkipEditing({ base, item, queue, markers, position, duration, applyMarkers }: { base: string; item: Item; queue: Item[]; markers: Segment[]; position: number; duration: number; applyMarkers: (markers: Segment[]) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const guard = async (work: () => Promise<void>) => {
    setBusy(true); setStatus('');
    try { await work(); } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save the marks.'); }
    finally { setBusy(false); }
  };
  return {
    draft, status, busy, markerTypes,
    begin: (type: MarkerType) => { setStatus(''); setDraft({ type, start: position }); },
    cancel: () => setDraft(null),
    saveEnd: () => guard(async () => {
      if (!draft || position <= draft.start) { setStatus('The end must come after the start.'); return; }
      const saved = await request(base, '/api/segments/manual', { method: 'POST', body: { changes: [{ id: item.id, markers: [{ ...draft, end: position, source: 'manual' }] }] } });
      applyMarkers(saved.markers[item.id] || []); setDraft(null);
    }),
    remove: (marker: Segment) => guard(async () => {
      const saved = await request(base, `/api/items/${encodeURIComponent(item.id)}/segments/remove`, { method: 'POST', body: { marker } });
      applyMarkers(saved.markers || []);
    }),
    applyToSeason: () => guard(async () => {
      const manual = markers.filter(marker => marker.source === 'manual');
      const siblings = queue.filter(other => other.kind === 'show' && other.season === item.season && other.id !== item.id);
      const episodes = await Promise.all(siblings.map(async other => ({ id: other.id, duration: (await inspect(base, other.id)).duration })));
      const changes = seasonCopies(manual, duration, episodes).filter(change => change.markers.length);
      if (!changes.length) { setStatus('No other episodes to mark.'); return; }
      await request(base, '/api/segments/manual', { method: 'POST', body: { changes, replaceType: true } }, 60000);
      setStatus(`Saved for ${changes.length + 1} episodes in this season.`);
    }),
  };
}
