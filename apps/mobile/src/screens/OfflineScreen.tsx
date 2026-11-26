import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Text, View, useWindowDimensions } from 'react-native';
import { Paths } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activeDownloads, cancelBatch, isSaved, pauseBatch, pauseOffline, removeOffline, resumeBatch, savedBytes, savedTitles, watchOffline, type OfflineRecord } from '../lib/offline';
import type { Item, Library } from '../lib/server';
import { groupLibrary, metadataFor, nameFor, titleKey } from '../../../../packages/core/client/library';
import { IconButton, MediaArt, Pill, ProgressBar, styles as t } from '../components/Matro';
import { batchesOf, type SmartSettings } from '../lib/smart-plan';
import { SmartSaves } from '../components/SmartSaves';
import { PosterCard, type ArtProps } from '../components/LibraryParts';

const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const shelvesOf = [{ kind: 'show', title: 'Shows' }, { kind: 'movie', title: 'Movies' }];
// Saved titles are browsed like the rest of the library (posters grouped into shows and movies); only
// downloads that are still running, waiting or paused are listed as rows above them.
export default function OfflineScreen({ data, offline, smart, onResume, onOpenTitle, onRemoved, ...art }: ArtProps & {
  data: Library & { catalogIds?: string[] }; offline: boolean; smart: { settings: SmartSettings; capped: number; onCap: (bytes: number | null) => void; onStop: (key: string) => void }; onResume: (id: string) => void; onOpenTitle: (items: Item[]) => void; onRemoved: () => void;
}) {
  const base = art.base, user = data.user;
  const insets = useSafeAreaInsets(), { width } = useWindowDimensions(), columns = Math.max(3, Math.floor((width - 24) / 108)), cardWidth = (width - 36 - (columns - 1) * 12) / columns;
  const [records, setRecords] = useState<OfflineRecord[]>([]);
  const [jobs, setJobs] = useState(() => activeDownloads(base, user));
  const [error, setError] = useState('');
  useEffect(() => {
    let run = 0;
    const refresh = () => {
      const current = ++run;
      setJobs(activeDownloads(base, user).map(job => ({ ...job })));
      void savedTitles(base, user).then(list => { if (current === run) setRecords(list); }).catch(() => {});
    };
    refresh();
    const unsubscribe = watchOffline(refresh);
    return () => { run++; unsubscribe(); };
  }, [base, user.accountKey, user.id, user.username]);
  const free = (() => { try { return Paths.availableDiskSpace; } catch { return 0; } })();
  const active = new Map(jobs.map(job => [job.id, job])), stored = new Map(records.map(record => [record.id, record]));
  const { done, saved, unavailable, bytes } = useMemo(() => {
    const catalog = new Set(data.catalogIds ?? data.items.map(item => item.id));
    const done = new Set(records.filter(isSaved).map(record => record.id));
    return {
      done,
      saved: groupLibrary(data.items.filter(item => done.has(item.id))),
      unavailable: records.filter(record => (
        !catalog.has(record.id) || (record.complete && !done.has(record.id))
      )),
      bytes: records.reduce((total, record) => total + savedBytes(record), 0),
    };
  }, [records, data.items, data.catalogIds]);
  const unavailableIds = new Set(unavailable.map(record => record.id));
  const rows = [...new Set([...active.keys(), ...records.filter(record => !record.complete).map(record => record.id)])]
    .filter(id => !unavailableIds.has(id));
  const names = useMemo(() => Object.fromEntries(groupLibrary(data.items).filter(group => group[0].kind === 'show').map(group => [titleKey(group[0]), nameFor(data, group[0])])), [data.items, data.metadata]);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Could not change this batch.');
  const cancel = (id: string) => Alert.alert('Cancel this batch?', 'Downloads that have not finished are removed from this device. Titles already saved stay.', [
    { text: 'Keep going', style: 'cancel' }, { text: 'Cancel all', style: 'destructive', onPress: () => void cancelBatch(base, user, id).then(onRemoved).catch(fail) },
  ]);
  const remove = (id: string) => void removeOffline(base, user, id).then(onRemoved).catch(e => setError(e.message));
  const shelves = shelvesOf.map(shelf => ({ ...shelf, groups: saved.filter(items => items[0].kind === shelf.kind) })).filter(shelf => shelf.groups.length);
  return <FlatList data={rows} keyExtractor={id => id} contentContainerStyle={{ paddingTop: insets.top + 74, paddingBottom: insets.bottom + 100, paddingHorizontal: 18, gap: 14 }}
    ListHeaderComponent={<View style={{ gap: 8 }}><Text style={t.heading}>Saved for offline</Text><Text style={t.dim}>{done.size} saved · {size(bytes)} on this device</Text>{free > 0 ? <View accessible accessibilityLabel={`Saved titles use ${size(bytes)}. ${size(free)} free on this phone.`} style={{ gap: 6, marginTop: 2 }}><ProgressBar value={bytes / (bytes + free)} /><Text style={t.dim}>{size(free)} free on this phone</Text></View> : null}{error ? <Text style={t.text}>{error}</Text> : null}{smart.capped > 0 && !offline ? <Text style={t.dim}>Storage cap reached: {smart.capped} {smart.capped === 1 ? 'episode was' : 'episodes were'} not saved. Free space or raise the cap.</Text> : null}<SmartSaves settings={smart.settings} names={names} batches={batchesOf(records)} offline={offline} onCap={smart.onCap} onStop={smart.onStop} onPause={id => void pauseBatch(base, user, id).catch(fail)} onResume={id => void resumeBatch(base, user, id).catch(fail)} onCancel={cancel} /></View>}
    ListFooterComponent={<View style={{ gap: 26, marginTop: 14 }}>
      {shelves.map(shelf => <View key={shelf.kind}>
        <View style={t.sectionHeading}><Text style={t.sectionTitle}>{shelf.title}</Text><Text style={t.dim}>{shelf.groups.length}</Text></View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{shelf.groups.map(items => <PosterCard key={items[0].groupId || items[0].id} {...art} data={data} items={items} width={cardWidth} onPress={() => onOpenTitle(items)} />)}</View>
      </View>)}
      {!!unavailable.length && <View>
        <View style={t.sectionHeading}><Text style={t.sectionTitle}>Unavailable</Text><Text style={t.dim}>{unavailable.length}</Text></View>
        {unavailable.map(record => <View key={record.id} style={{ gap: 8, paddingVertical: 10 }}>
          <Text style={t.text}>{record.title}</Text>
          <Text style={t.dim}>{size(savedBytes(record))} on this device</Text>
          {record.error ? <Text style={t.dim}>{record.error}</Text> : null}
          <View style={t.row}><Pill label="Remove" compact onPress={() => remove(record.id)} /></View>
        </View>)}
      </View>}
      {!shelves.length && !rows.length && !unavailable.length ? <Text style={t.muted}>Save a movie or episode to watch it without a connection.</Text> : null}
    </View>}
    renderItem={({ item: id }) => {
      const job = active.get(id), record = stored.get(id), percent = job?.size ? job.have / job.size : job?.prepared ?? 0;
      const queued = record?.state === 'queued' && !record.paused && !record.error;
      const status = job ? job.size ? `${size(job.have)} of ${size(job.size)}` : job.prepared === null ? 'Preparing on the server…' : `Preparing on the server · ${Math.round(job.prepared * 100)}%`
        : queued ? offline ? 'Waiting for a connection' : 'Waiting for a free slot'
        : record?.state === 'preparing' && !record.paused ? `Preparation pending${record.prepared === undefined ? '' : ` · ${Math.round(record.prepared * 100)}%`}`
        : record?.error ? record.paused ? 'Download stopped' : 'Waiting to retry'
        : record?.paused ? 'Paused' : 'Waiting to resume';
      const name = job?.title || record?.title || '', item = data.items.find(entry => entry.id === id);
      const confirmRemove = () => Alert.alert('Remove this download?', `${name} will be deleted from this phone. You can save it again later.`, [
        { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => remove(id) },
      ]);
      return <View style={{ flexDirection: 'row', gap: 14, paddingVertical: 10 }}>
        <MediaArt {...art} path={item ? metadataFor(data, item).poster : undefined} title={name} style={{ width: 56, height: 84, borderRadius: 6 }} />
        <View style={{ flex: 1, gap: 8 }}><Text style={t.text} numberOfLines={2}>{name}</Text>
        <Text style={t.dim}>{status}{!job && !!record?.size ? ` · ${size(savedBytes(record))} of ${size(record.size)}` : ''}</Text>
        {!job && record?.error ? <Text style={t.dim}>{record.error}</Text> : null}
        {!!job && (!!job.size || job.prepared !== null) && <ProgressBar value={percent} />}
        <View style={[t.row, { gap: 8 }]}>
          {job ? <Pill label="Pause" compact onPress={() => void pauseOffline(base, user, id).catch(e => setError(e.message))} /> : queued ? <Pill label="Cancel" compact onPress={() => remove(id)} /> : <>
            <Pill label="Resume" compact primary disabled={offline} onPress={() => onResume(id)} />
            <IconButton name="trash" label={`Remove ${name}`} onPress={confirmRemove} />
          </>}
        </View></View></View>;
    }} />;
}
