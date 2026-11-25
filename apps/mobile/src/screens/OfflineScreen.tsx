import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Text, View, useWindowDimensions } from 'react-native';
import { Paths } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activeDownloads, cancelQueued, pauseOffline, queuedDownloads, removeOffline, savedTitles, watchOffline, type SavedMedia } from '../lib/offline';
import type { Item, Library } from '../lib/server';
import { groupLibrary, metadataFor } from '../../../../packages/core/client/library';
import { IconButton, MediaArt, Pill, ProgressBar, styles as t } from '../components/Matro';
import { PosterCard, type ArtProps } from '../components/LibraryParts';

const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const shelvesOf = [{ kind: 'show', title: 'Shows' }, { kind: 'movie', title: 'Movies' }, { kind: 'audio', title: 'Music & audio' }];
// Saved titles are browsed like the rest of the library (posters grouped into shows and movies); only
// downloads that are still running, waiting or paused are listed as rows above them.
export default function OfflineScreen({ data, offline, onResume, onOpenTitle, onRemoved, ...art }: ArtProps & {
  data: Library; offline: boolean; onResume: (id: string) => void; onOpenTitle: (items: Item[]) => void; onRemoved: () => void;
}) {
  const base = art.base, user = data.user;
  const insets = useSafeAreaInsets(), { width } = useWindowDimensions(), columns = Math.max(3, Math.floor((width - 24) / 108)), cardWidth = (width - 36 - (columns - 1) * 12) / columns;
  const [records, setRecords] = useState<SavedMedia[]>([]);
  const [jobs, setJobs] = useState(() => activeDownloads(base, user));
  const [waiting, setWaiting] = useState(() => queuedDownloads(base, user));
  const [error, setError] = useState('');
  useEffect(() => {
    let run = 0;
    const refresh = () => {
      const current = ++run;
      setJobs(activeDownloads(base, user).map(job => ({ ...job })));
      setWaiting(queuedDownloads(base, user));
      void savedTitles(base, user).then(list => { if (current === run) setRecords(list); }).catch(() => {});
    };
    refresh();
    const unsubscribe = watchOffline(refresh);
    return () => { run++; unsubscribe(); };
  }, [base, user.id, user.username]);
  const used = records.reduce((total, record) => total + record.have, 0), free = (() => { try { return Paths.availableDiskSpace; } catch { return 0; } })();
  const active = new Map(jobs.map(job => [job.id, job])), stored = new Map(records.map(record => [record.id, record])), queued = new Map(waiting.map(entry => [entry.id, entry]));
  const rows = [...new Set([...active.keys(), ...queued.keys(), ...records.filter(record => !record.complete).map(record => record.id)])];
  const saved = useMemo(() => {
    const done = new Set(records.filter(record => record.complete).map(record => record.id));
    return groupLibrary(data.items.filter(item => done.has(item.id)));
  }, [records, data.items]);
  const shelves = shelvesOf.map(shelf => ({ ...shelf, groups: saved.filter(items => items[0].kind === shelf.kind) })).filter(shelf => shelf.groups.length);
  return <FlatList data={rows} keyExtractor={id => id} contentContainerStyle={{ paddingTop: insets.top + 74, paddingBottom: insets.bottom + 100, paddingHorizontal: 18, gap: 14 }}
    ListHeaderComponent={<View style={{ gap: 8 }}><Text style={t.heading}>Saved for offline</Text><Text style={t.dim}>{records.filter(record => record.complete).length} saved · {size(used)} on this device</Text>{free > 0 ? <View accessible accessibilityLabel={`Saved titles use ${size(used)}. ${size(free)} free on this phone.`} style={{ gap: 6, marginTop: 2 }}><ProgressBar value={used / (used + free)} /><Text style={t.dim}>{size(free)} free on this phone</Text></View> : null}{error ? <Text style={t.text}>{error}</Text> : null}</View>}
    ListFooterComponent={<View style={{ gap: 26, marginTop: 14 }}>
      {shelves.map(shelf => <View key={shelf.kind}>
        <View style={t.sectionHeading}><Text style={t.sectionTitle}>{shelf.title}</Text><Text style={t.dim}>{shelf.groups.length}</Text></View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{shelf.groups.map(items => <PosterCard key={items[0].groupId || items[0].id} {...art} data={data} items={items} width={cardWidth} onPress={() => onOpenTitle(items)} />)}</View>
      </View>)}
      {!shelves.length && !rows.length ? <Text style={t.muted}>Save a movie or episode to watch it without a connection.</Text> : null}
    </View>}
    renderItem={({ item: id }) => {
      const job = active.get(id), record = stored.get(id), line = queued.get(id), percent = job?.size ? job.have / job.size : job?.prepared ?? 0;
      const name = job?.title || record?.title || line?.title || '', item = data.items.find(entry => entry.id === id);
      const status = job ? job.size ? `${size(job.have)} of ${size(job.size)}` : job.prepared === null ? 'Preparing on the server…' : `Preparing on the server · ${Math.round(job.prepared * 100)}%`
        : line ? 'Waiting for a free slot' : `${size(record?.have || 0)} of ${size(record?.size || 0)} · Paused`;
      const progress = job ? (job.size || job.prepared !== null ? percent : null) : record?.size ? record.have / record.size : 0;
      const confirmRemove = () => Alert.alert('Remove this download?', `${name} will be deleted from this phone. You can save it again later.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void removeOffline(base, user, id).then(onRemoved).catch(e => setError(e.message)) }]);
      return <View style={{ flexDirection: 'row', gap: 14, paddingVertical: 10 }}>
        <MediaArt {...art} path={item ? metadataFor(data, item).poster : undefined} title={name} style={{ width: 56, height: 84, borderRadius: 6 }} />
        <View style={{ flex: 1, gap: 8 }}><Text style={t.text} numberOfLines={2}>{name}</Text>
          <Text style={t.dim}>{status}</Text>
          {progress !== null && <ProgressBar value={progress} />}
          <View style={[t.row, { gap: 8 }]}>
            {job ? <Pill label="Pause" compact onPress={() => pauseOffline(base, user, id)} /> : line ? <Pill label="Cancel" compact onPress={() => cancelQueued(base, user, id)} /> : <>
              <Pill label="Resume" compact primary disabled={offline} onPress={() => onResume(id)} />
              <IconButton name="trash" label={`Remove ${name}`} onPress={confirmRemove} />
            </>}
          </View></View></View>;
    }} />;
}
