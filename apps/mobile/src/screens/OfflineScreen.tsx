import { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activeDownloads, pauseOffline, removeOffline, savedTitles, watchOffline, type SavedMedia } from '../lib/offline';
import type { MatroUser } from '../lib/server';
import { Pill, ProgressBar, styles as t } from '../components/Matro';

const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
export default function OfflineScreen({ base, user, offline, onOpen, onResume, onRemoved }: {
  base: string; user: MatroUser; offline: boolean; onOpen: (id: string) => void; onResume: (id: string) => void; onRemoved: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [records, setRecords] = useState<SavedMedia[]>([]);
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
  }, [base, user.id, user.username]);
  const active = new Map(jobs.map(job => [job.id, job])), stored = new Map(records.map(record => [record.id, record]));
  const rows = [...new Set([...active.keys(), ...stored.keys()])];
  return <FlatList data={rows} keyExtractor={id => id} contentContainerStyle={{ paddingTop: insets.top + 74, paddingBottom: insets.bottom + 100, paddingHorizontal: 18, gap: 14 }}
    ListHeaderComponent={<View style={{ gap: 8 }}><Text style={t.heading}>Saved for offline</Text><Text style={t.dim}>{records.filter(record => record.complete).length} saved · {size(records.reduce((total, record) => total + record.have, 0))} on this device</Text>{error ? <Text style={t.text}>{error}</Text> : null}</View>}
    ListEmptyComponent={<Text style={t.muted}>Save a movie or episode to watch it without a connection.</Text>}
    renderItem={({ item: id }) => {
      const job = active.get(id), record = stored.get(id), percent = job?.size ? job.have / job.size : 0;
      return <View style={{ gap: 8, paddingVertical: 10 }}><Text style={t.text}>{job?.title || record?.title}</Text>
        <Text style={t.dim}>{job ? job.size ? `${size(job.have)} of ${size(job.size)}` : 'Preparing download…' : record?.complete ? size(record.size) : `${size(record?.have || 0)} · Paused`}</Text>
        {!!job?.size && <ProgressBar value={percent} />}
        <View style={[t.row, { gap: 8 }]}>
          {job ? <Pill label="Pause" compact onPress={() => pauseOffline(base, user, id)} /> : <>
            {record?.complete ? <Pill label="Play" compact onPress={() => onOpen(id)} /> : <Pill label="Resume" compact disabled={offline} onPress={() => onResume(id)} />}
            <Pill label="Remove" compact onPress={() => void removeOffline(base, user, id).then(onRemoved).catch(e => setError(e.message))} />
          </>}
        </View></View>;
    }} />;
}
