import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { markMovieRequestHandled, movieRequests, removeMovieRequest, sendMovieRequest, type MovieRequest, type MovieRequests } from '../lib/server';
import { colors } from '../theme';
import { Field, ErrorLine } from '../ui';
import { Icon, IconButton, Pill, styles as t } from '../components/Matro';
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

  const [alertsOpen, setAlertsOpen] = useState(false);
  const heading = admin ? 'Movie requests' : 'Request a movie';
  const header = <View style={s.header}>
    <View style={s.titleRow}>
      <Text accessibilityRole="header" style={[t.heading, { flex: 1 }]}>{heading}</Text>
      <IconButton name="refresh" label="Refresh requests" disabled={busy} onPress={() => void run(load)} />
    </View>
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
    {busy && !data ? <Text style={t.muted}>Loading requests…</Text> : null}
  </View>;
  const alertsRow = admin && (alerts.supported && alerts.ready || data?.alertsConfigured === false) ? <View style={s.alerts}>
    {data?.alertsConfigured === false ? <Text style={t.muted}>Phone alerts aren’t configured on this server.</Text> : <>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: alertsOpen }} accessibilityLabel={`Phone alerts, ${alerts.enabled ? 'on' : 'off'}`} onPress={() => setAlertsOpen(!alertsOpen)} style={s.alertsHeader}>
        <Text style={t.text}>Phone alerts</Text>
        <View style={t.row}><Text style={t.dim}>{alerts.enabled ? 'On' : 'Off'}</Text><View style={{ transform: [{ rotate: alertsOpen ? '-90deg' : '90deg' }] }}><Icon name="chevron" size={16} /></View></View>
      </Pressable>
      {alertsOpen && <>
        <Text style={t.muted}>{alerts.enabled ? 'Movie request alerts are enabled on this phone.' : 'Receive a Matro notification when a movie is requested.'}</Text>
        <View style={[t.row, s.actions]}>
          <Pill label={alerts.enabled ? 'Turn off alerts' : 'Enable phone alerts'} compact disabled={busy}
            onPress={() => void run(alerts.enabled ? alerts.disable : alerts.enable)} />
          {alerts.enabled && <Pill label="Send test alert" compact disabled={busy} onPress={() => void run(async () => {
            await alerts.test();
            setNotice('Test alert sent.');
          })} />}
        </View>
      </>}
    </>}
  </View> : null;

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding"><SectionList
    contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 104 }}
    keyboardShouldPersistTaps="handled"
    stickySectionHeadersEnabled={false}
    sections={data ? [
      { title: 'Pending', data: data.pending, empty: admin ? 'Nothing waiting' : 'Nothing pending', hint: admin ? 'Requests from the people you share with show up here.' : 'Requests you send stay here until they are handled.' },
      { title: 'Recently handled', data: data.handled, empty: 'Nothing handled yet', hint: 'Handled requests are kept here for a while.' },
    ] : []}
    ListHeaderComponent={header}
    ListFooterComponent={alertsRow}
    keyExtractor={row => String(row.id)}
    renderSectionHeader={({ section }) => <View style={s.section}>
      <Text accessibilityRole="header" style={t.sectionTitle}>{section.title}</Text>
      {section.data.length ? <Text style={t.dim}>{section.data.length}</Text> : null}
    </View>}
    renderSectionFooter={({ section }) => section.data.length ? null : <View style={s.emptyCard}>
      <Text style={t.text}>{section.empty}</Text>
      <Text style={t.dim}>{section.hint}</Text>
    </View>}
    renderItem={({ item }) => <View style={s.card}>
      <Text style={t.sectionTitle}>{item.title}{item.year ? ` (${item.year})` : ''}</Text>
      <Text style={t.muted}>{admin ? `${item.requester || 'Removed account'} · ` : ''}{new Date(item.created).toLocaleDateString()}</Text>
      {((admin && item.status === 'pending') || data?.canRemove) && <View style={[t.row, s.actions]}>
        {admin && item.status === 'pending' && <>
          <Pill label="Search releases" icon="search" primary compact disabled={busy} onPress={() => onSearch(item)} />
          <Pill label="Mark handled" compact disabled={busy} onPress={() => handle(item.id)} />
        </>}
        {data?.canRemove && <View style={{ marginLeft: 'auto' }}><IconButton name="trash" label={`Remove ${item.title}`} disabled={busy} onPress={() => remove(item)} /></View>}
      </View>}
    </View>}
  /></KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  header: { gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  form: { gap: 8, marginTop: 12, maxWidth: 460 },
  alerts: { gap: 8, marginTop: 28, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.hairline },
  alertsHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { marginTop: 22, marginBottom: 10, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  emptyCard: { gap: 4, padding: 14, borderWidth: 1, borderColor: colors.hairline, borderStyle: 'dashed', borderRadius: 12 },
  card: { padding: 14, gap: 6, marginBottom: 8, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, backgroundColor: colors.panel },
  actions: { flexWrap: 'wrap', marginTop: 4 },
});
