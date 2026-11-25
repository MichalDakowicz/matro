import { useEffect, useRef, useState } from 'react';
import { Alert, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { markMovieRequestHandled, movieRequests, removeMovieRequest, sendMovieRequest, type MovieRequest, type MovieRequests } from '../lib/server';
import { colors, themed } from '../theme';
import { Field, ErrorLine } from '../ui';
import { Pill, styles as t } from '../components/Matro';
import type { MovieRequestAlerts } from '../lib/movie-request-alerts';

type Props = { base: string; admin: boolean; alerts: MovieRequestAlerts; onSearch: (request: MovieRequest) => void };

export default function MovieRequestsScreen({ base, admin, alerts, onSearch }: Props) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState(''), [year, setYear] = useState('');
  const [data, setData] = useState<MovieRequests | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const active = useRef(false);

  async function run(action: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update movie requests.'); }
    finally { active.current = false; setBusy(false); }
  }

  const load = async () => setData(await movieRequests(base, admin));
  useEffect(() => { void run(load); }, [base, admin]);

  const submit = () => void run(async () => {
    const result = await sendMovieRequest(base, title, year);
    setTitle(''); setYear('');
    setNotice(result.duplicate ? 'You already requested this movie.' : 'Request sent.');
    if (!data) await load();
    else if (!data.pending.some(row => row.id === result.request.id)) {
      setData({ ...data, pending: [result.request, ...data.pending] });
    }
  });

  const handle = (id: number) => void run(async () => {
    const { request } = await markMovieRequestHandled(base, id);
    setData(current => current && ({
      ...current, pending: current.pending.filter(row => row.id !== id),
      handled: [request, ...current.handled.filter(row => row.id !== id)].sort((a, b) => b.id - a.id).slice(0, 30),
    }));
    setNotice('Request marked handled.');
  });

  const remove = (item: MovieRequest) => {
    const name = item.year ? `${item.title} (${item.year})` : item.title;
    Alert.alert('Remove movie request?', name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove request', style: 'destructive', onPress: () => void run(async () => {
        await removeMovieRequest(base, item.id);
        setData(current => current && ({
          ...current, pending: current.pending.filter(row => row.id !== item.id), handled: current.handled.filter(row => row.id !== item.id),
        }));
        setNotice('Request removed.');
      }) },
    ], { cancelable: true });
  };

  const heading = admin ? 'Movie requests' : 'Request a movie';
  const header = <View style={s.header}>
    <Text accessibilityRole="header" style={t.heading}>{heading}</Text>
    <Text style={t.muted}>{admin ? 'Review requests and search for releases to add to your library.' : 'Send a title to the person who manages your library.'}</Text>
    {!admin && <View style={s.form}>
      <Text style={t.text}>Movie title</Text>
      <Field accessibilityLabel="Movie title" value={title} onChangeText={setTitle} maxLength={200} />
      <Text style={t.text}>Release year (optional)</Text>
      <Field accessibilityLabel="Release year (optional)" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} />
      <Pill label="Send request" primary disabled={busy || !title.trim()} onPress={submit} />
    </View>}
    {notice ? <Text accessibilityLiveRegion="polite" style={t.muted}>{notice}</Text> : null}
    <ErrorLine text={error} />
    {admin && data?.alertsConfigured === false && <Text style={t.muted}>Phone alerts aren’t configured on this server.</Text>}
    {admin && alerts.supported && alerts.ready && <View style={s.alerts}>
      <Text style={t.muted}>{alerts.enabled ? 'Movie request alerts are enabled on this phone.' : 'Receive a Matro notification when a movie is requested.'}</Text>
      <View style={[t.row, s.actions]}>
        <Pill label={alerts.enabled ? 'Turn off alerts' : 'Enable phone alerts'} compact disabled={busy}
          onPress={() => void run(alerts.enabled ? alerts.disable : alerts.enable)} />
        {alerts.enabled && <Pill label="Send test alert" compact disabled={busy} onPress={() => void run(async () => {
          await alerts.test();
          setNotice('Test alert sent.');
        })} />}
      </View>
    </View>}
    <Pill label="Refresh requests" icon="refresh" compact disabled={busy} style={s.refresh} onPress={() => void run(load)} />
    {busy && !data ? <Text style={t.muted}>Loading requests…</Text> : null}
  </View>;

  return <SectionList
    contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 104 }}
    keyboardShouldPersistTaps="handled"
    stickySectionHeadersEnabled={false}
    sections={data ? [
      { title: 'Pending', data: data.pending, empty: 'No pending movie requests.' },
      { title: 'Recently handled', data: data.handled, empty: 'No handled movie requests yet.' },
    ] : []}
    ListHeaderComponent={header}
    keyExtractor={row => String(row.id)}
    renderSectionHeader={({ section }) => <View style={s.section}>
      <Text accessibilityRole="header" style={t.sectionTitle}>{section.title}</Text>
      {!section.data.length && <Text style={t.muted}>{section.empty}</Text>}
    </View>}
    renderItem={({ item }) => <View style={s.card}>
      <Text style={t.sectionTitle}>{item.title}{item.year ? ` (${item.year})` : ''}</Text>
      <Text style={t.muted}>{admin ? `${item.requester || 'Removed account'} · ` : ''}{new Date(item.created).toLocaleDateString()}</Text>
      {((admin && item.status === 'pending') || data?.canRemove) && <View style={[t.row, s.actions]}>
        {admin && item.status === 'pending' && <>
          <Pill label="Search releases" icon="search" primary compact disabled={busy} onPress={() => onSearch(item)} />
          <Pill label="Mark handled" compact disabled={busy} onPress={() => handle(item.id)} />
        </>}
        {data?.canRemove && <Pill label="Remove" compact disabled={busy} onPress={() => remove(item)} />}
      </View>}
    </View>}
  />;
}

const s = themed(() => StyleSheet.create({
  header: { gap: 10 },
  form: { gap: 8, marginTop: 12, maxWidth: 460 },
  alerts: { gap: 4, paddingVertical: 6 },
  refresh: { alignSelf: 'flex-start' },
  section: { marginTop: 22, marginBottom: 10, gap: 8 },
  card: { padding: 14, gap: 6, marginBottom: 8, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, backgroundColor: colors.panel },
  actions: { flexWrap: 'wrap', marginTop: 4 },
}));
