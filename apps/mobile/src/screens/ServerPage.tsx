import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { request, type Item, type Library } from '../lib/server';
import { groupLibrary } from '../../../../packages/core/client/library';
import { plural } from '../lib/text';
import { colors, fonts, radius } from '../theme';
import { Chip, Icon, Pill, Row, SectionLabel, styles as t } from '../components/Matro';

type Props = { base: string; data: Library; offline: boolean; layout: { top: number; bottom: number }; requests?: string; onGo: (tab: string) => void; onBrowseFolder: (path: string) => void; onRefresh: () => Promise<void> | void; onChangeServer: () => void; notify: (text: string) => void };
const folderName = (path: string) => path.split(/[\/]/).filter(Boolean).pop() || path;

/** MobileServer artboard, built from what the app actually knows: the connection, the libraries, the places admin and offline tools live, and the server link.
 *  Not built (no setting behind them): storage meter, "Quality on mobile data", "Play MKV directly", a list of several saved servers, QR link. */
export default function ServerPage({ base, data, offline, layout, requests, onGo, onBrowseFolder, onRefresh, onChangeServer, notify }: Props) {
  const [scanning, setScanning] = useState(false), admin = !offline && data.user.role === 'admin', host = base.replace(/^https?:\/\//, '');
  const count = (items: Item[]) => plural(groupLibrary(items).length, 'title');
  const libraries = admin && data.folders?.length ? data.folders.map(path => ({ key: path, name: folderName(path), path, count: count(data.items.filter(item => item.root === path)), open: () => onBrowseFolder(path) }))
    : (['show', 'movie', 'audio'] as const).map(kind => ({ key: kind, name: { show: 'Shows', movie: 'Movies', audio: 'Music & audio' }[kind], path: '', count: count(data.items.filter(item => item.kind === kind)), open: () => onGo(kind), total: data.items.filter(item => item.kind === kind).length })).filter(row => row.total);
  const scan = async () => {
    setScanning(true);
    try { await request(base, '/api/admin/rescan', { method: 'POST', body: {} }); await onRefresh(); notify('Scan finished.'); }
    catch { notify('Couldn’t scan the folders. Check the server and try again.'); }
    finally { setScanning(false); }
  };
  const link = () => Alert.alert('Link another server?', 'Matro forgets this server address and asks for a new one. Titles saved on this device stay here.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Link a server', style: 'destructive', onPress: onChangeServer }], { cancelable: true });
  return <ScrollView contentContainerStyle={{ paddingTop: layout.top + 76, paddingBottom: layout.bottom + 120, paddingHorizontal: 18 }} showsVerticalScrollIndicator={false}>
    <Text accessibilityRole="header" style={t.heading}>Server</Text>
    <View style={s.card}>
      <View style={s.icon}><Icon name="network" size={24} /></View>
      <View style={{ flex: 1 }}><Text style={[t.text, { fontFamily: fonts.semibold, fontSize: 17 }]} numberOfLines={1}>{host}</Text><Text style={t.muted} numberOfLines={1}>{count(data.items)} · {data.user.username}</Text></View>
      <View style={s.status} accessible accessibilityLabel={offline ? 'Offline' : 'Online'}><View style={[s.dot, offline && { backgroundColor: colors.warn }]} /><Text style={[t.text, { fontFamily: fonts.semibold, fontSize: 12 }]}>{offline ? 'Offline' : 'Online'}</Text></View>
    </View>
    {offline && <Pill label="Reconnect" icon="refresh" onPress={() => void onRefresh()} style={{ marginTop: 12 }} />}
    <View style={[t.row, { justifyContent: 'space-between', marginTop: 24 }]}><Text accessibilityRole="header" style={t.sectionTitle}>Libraries</Text>{admin && <Chip small label={scanning ? 'Scanning…' : 'Scan now'} onPress={() => { if (!scanning) void scan(); }} />}</View>
    <View style={{ marginTop: 6 }}>{libraries.length ? libraries.map(row => <Row key={row.key} label={row.name} detail={row.path || undefined} onPress={row.open} chevron />) : <Text style={[t.muted, { marginTop: 8 }]}>Nothing in the library yet.</Text>}</View>
    <SectionLabel>On this server</SectionLabel>
    <Row icon="restart" label="Watch history" detail="What you played, and when" chevron onPress={() => onGo('history')} />
    <Row icon="download" label="Saved for offline" detail="Titles stored on this phone" chevron onPress={() => onGo('offline')} />
    {admin && <Row icon="folder" label="Folders" detail="Add or remove media folders" chevron onPress={() => onGo('folders')} />}
    {admin && <Row icon="arrows" label="Host downloads" detail="Find releases and add them to the server" chevron onPress={() => onGo('downloads')} />}
    {!offline && !!requests && <Row icon="requests" label={requests} chevron last onPress={() => onGo('movie-requests')} />}
    <SectionLabel>Your server</SectionLabel>
    <View style={s.current}><View style={s.radio}><View style={s.radioDot} /></View><View style={{ flex: 1 }}><Text style={[t.text, { fontFamily: fonts.semibold, fontSize: 15 }]} numberOfLines={1}>{host}</Text><Text style={t.dim} numberOfLines={1}>{base}</Text></View></View>
    <Pill label="Link a server" icon="plus" onPress={link} style={{ marginTop: 10 }} />
    <Text style={[t.dim, { marginTop: 20, lineHeight: 19 }]}>Matro is open source. Run the Matro server next to your media folders, then link this app to it.</Text>
  </ScrollView>;
}
const s = StyleSheet.create({
  card: { marginTop: 18, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: radius.sheet, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.hairline },
  icon: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: radius.pill, backgroundColor: colors.chip }, dot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.good },
  current: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, borderRadius: radius.panel, backgroundColor: colors.fill },
  radio: { width: 18, height: 18, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, radioDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
});
