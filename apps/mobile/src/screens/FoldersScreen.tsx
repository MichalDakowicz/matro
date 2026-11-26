import { useState, type ReactNode } from 'react';
import { scanMessage } from '../../../../packages/core/client/scan-status.js';
import { Alert, FlatList, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FocusPressable as Pressable, isAndroidTv } from '../components/TvFocus';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { request, type Library } from '../lib/server';
import { Icon, IconButton, Pill, styles as t } from '../components/Matro';
import { plural } from '../lib/text';
import { colors, radius, themed } from '../theme';
type Folder = { id: number; path: string };
type Browser = { path: string; parent: string | null; dirs: string[] };
export default function FoldersScreen({ base, data, onRefresh, onBrowse, header }: { base: string; data: Library; onRefresh: () => Promise<void>; onBrowse: (path: string) => void; header?: ReactNode }) {
  const [picker, setPicker] = useState<Browser | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update folders.'); } finally { setBusy(false); } };
  const browse = async (path?: string) => setPicker(await request(base, '/api/admin/browse' + (path ? '?path=' + encodeURIComponent(path) : '')));
  const remove = (path: string) => Alert.alert('Remove folder from the library?', 'Files on the server will be kept.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void run(async () => { const { folders }: { folders: Folder[] } = await request(base, '/api/admin/folders'); const folder = folders.find(f => f.path === path); if (folder) await request(base, '/api/admin/folders/' + folder.id, { method: 'DELETE' }); await onRefresh(); }) }]);
  return <>
    <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}>{header ? <View style={{ marginBottom: 20 }}>{header}</View> : null}<Text style={t.heading}>Folders</Text><Text style={[t.muted, { marginTop: 8 }]}>{plural(data.folders?.length || 0, 'source')} · {plural(data.items.length, 'item')}</Text>{data.scanStatus && <Text accessibilityLiveRegion="polite" style={[t.muted, { marginTop: 8 }]}>{scanMessage(data.scanStatus)}</Text>}<View style={[t.row, { marginVertical: 20 }]}><Pill label={busy ? 'Scanning…' : 'Rescan'} icon="refresh" disabled={busy} onPress={() => void run(async () => { await request(base, '/api/admin/rescan', { method: 'POST', body: {} }); await onRefresh(); })} style={{ flex: 1 }} /><Pill label="Add folder" icon="plus" primary onPress={() => void run(() => browse())} style={{ flex: 1 }} /></View>{error ? <Text style={[t.muted, { color: colors.warn, marginBottom: 16 }]}>{error}</Text> : null}
      {data.scanStatus?.errors.map((row, index) => <Text key={index} style={[t.muted, { marginBottom: 8 }]}>{row.folder}: {row.error}</Text>)}
      {data.folders?.map(path => { const name = path.split(/[\\/]/).filter(Boolean).pop(); return <View key={path} style={s.source}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${name} in the library`} onPress={() => onBrowse(path)} style={({ pressed }) => [s.open, pressed && { opacity: .68 }]}>
          <View style={s.sourceIcon}><Icon name="folder" /></View>
          <View style={{ flex: 1, gap: 4 }}><Text style={t.text}>{name}</Text><Text style={[t.mono, { fontSize: 12 }]} numberOfLines={2}>{path}</Text></View>
          <Icon name="chevron" size={18} color={colors.dim} />
        </Pressable>
        <IconButton name="trash" label={`Remove ${path}`} onPress={() => remove(path)} />
      </View>; })}
      <Text style={[t.dim, { marginTop: 24, lineHeight: 20 }]}>Removing a folder never deletes files on disk. Progress and queue entries stay with your account.</Text>
    </ScrollView>
    <Modal visible={!!picker} transparent animationType={isAndroidTv ? 'none' : 'slide'} onRequestClose={() => setPicker(null)}><Pressable focusable={isAndroidTv ? false : undefined} style={s.scrim} onPress={() => setPicker(null)} /><View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}><View style={t.sectionHeading}><Text style={t.sectionTitle}>Choose a folder on the server</Text><IconButton name="close" preferredFocus={isAndroidTv} label="Close folder picker" onPress={() => setPicker(null)} /></View><Text style={[t.mono, { marginBottom: 14 }]}>{picker?.path}</Text>{error ? <Text style={{ color: colors.warn }}>{error}</Text> : null}<FlatList removeClippedSubviews={isAndroidTv ? false : undefined} data={picker?.dirs || []} keyExtractor={name => name} ListHeaderComponent={picker?.parent ? <Pressable style={s.directory} onPress={() => void run(() => browse(picker.parent!))}><Icon name="back" /><Text style={t.text}>Parent folder</Text></Pressable> : null} renderItem={({ item: name }) => <Pressable style={s.directory} onPress={() => void run(() => browse(picker!.path.replace(/\/$/, '') + '/' + name))}><Icon name="folder" /><Text style={t.text}>{name}</Text></Pressable>} /><Pill label="Add this folder" icon="plus" primary disabled={busy} onPress={() => void run(async () => { await request(base, '/api/admin/folders', { method: 'POST', body: { path: picker?.path } }); setPicker(null); await onRefresh(); })} /></View></Modal>
  </>;
}
const s = themed(() => StyleSheet.create({ source: { borderRadius: radius.panel, backgroundColor: colors.fill, borderWidth: 1, borderColor: colors.hairline, flexDirection: 'row', paddingLeft: 14, paddingRight: 6, paddingVertical: 6, gap: 6, alignItems: 'center', marginBottom: 12 }, open: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }, sourceIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center' }, scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim }, sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '75%', backgroundColor: colors.panel, padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22 }, directory: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.hairline } }));
