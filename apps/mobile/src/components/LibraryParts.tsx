import { memo, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { Item, Library } from '../lib/server';
import { episodeName, formatTime, metadataFor, nameFor, resumeItem, statusOf } from '../../../../packages/core/client/library';
import { colors, fonts } from '../theme';
import { Brand, Icon, IconButton, MediaArt, Pill, ProgressBar, styles as t, type Glyph } from './Matro';
export type ArtProps = { base: string; headers: Record<string, string> };

export const PosterCard = memo(function PosterCard({ data, items, width, onPress, ...art }: ArtProps & { data: Library; items: Item[]; width: number; onPress: () => void }) {
  const item = items[0], m = metadataFor(data, item), status = statusOf(data, items), target = resumeItem(data, items), progress = data.progress[target.id];
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${nameFor(data, item)}`} onPress={onPress} style={({ pressed }) => [{ width, marginBottom: 22 }, pressed && { opacity: .7 }]}>
    <MediaArt {...art} path={m.poster} title={nameFor(data, item)} style={{ width, height: width * 1.5, borderRadius: 8 }}>
      {status === 'done' && <View style={s.watched}><Icon name="check" size={13} /></View>}
      {status === 'progress' && progress?.duration > 0 && <View style={s.posterProgress}><ProgressBar value={progress.position / progress.duration} /></View>}
    </MediaArt>
    <Text numberOfLines={1} style={s.cardName}>{nameFor(data, item)}</Text>
    <Text numberOfLines={1} style={s.cardMeta}>{item.kind === 'show' ? `${new Set(items.map(i => i.season)).size} seasons · ${items.length} episodes` : `${m.year ? m.year + ' · ' : ''}${item.format} · ${item.kind === 'audio' ? 'Audio' : 'Movie'}`}</Text>
  </Pressable>;
});

export function FeaturedReel({ data, groups, onPlay, onDetail, ...art }: ArtProps & { data: Library; groups: Item[][]; onPlay: (item: Item) => void; onDetail: (item: Item) => void }) {
  const { width } = useWindowDimensions(), reelScale = Math.max(.62, Math.min(1.1, (width - 1) / 1040)) * 1.08, posterWidth = 340 * reelScale, stride = posterWidth * .74065, start = groups.length > 1 ? groups.length : 0;
  const scroll = useRef(new Animated.Value(start * stride)).current, list = useRef<FlatList<Item[]>>(null), activeRef = useRef(start);
  const [active, setActive] = useState(start);
  const slots = useMemo(() => groups.length > 1 ? [...groups, ...groups, ...groups] : groups, [groups]);
  const centre = active % (groups.length || 1), items = groups[centre];
  if (!items) return null;
  const item = items[0], m = metadataFor(data, item), target = resumeItem(data, items), resume = data.progress[target.id]?.position > 0 && !data.progress[target.id]?.completed;
  const rows = [[m.peopleLabel || 'Director', m.people?.slice(0, 2).join(', ')], ['Year', m.year], ['Genre', m.genres?.slice(0, 2).join(', ')]].filter(([, value]) => value);
  if (!rows.length) rows.push(['Type', item.kind === 'show' ? 'Series' : 'Movie'], ['Format', item.format], ['Folder', item.root?.split(/[\\/]/).filter(Boolean).pop() || 'Library']);
  return <View style={{ marginBottom: 32 }}>
    <View style={{ height: 438, marginHorizontal: -18 }}>
      <Animated.FlatList ref={list} horizontal data={slots} keyExtractor={(group, index) => group[0].id + ':' + index} initialScrollIndex={start} showsHorizontalScrollIndicator={false} snapToInterval={stride} decelerationRate="fast" disableIntervalMomentum
        removeClippedSubviews={false} initialNumToRender={5} windowSize={5} contentContainerStyle={{ paddingHorizontal: (width - stride) / 2 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scroll } } }], { useNativeDriver: true, listener: (e: { nativeEvent: { contentOffset: { x: number } } }) => { const index = Math.max(0, Math.min(slots.length - 1, Math.round(e.nativeEvent.contentOffset.x / stride))); if (index !== activeRef.current) { activeRef.current = index; setActive(index); } } })} scrollEventThrottle={16}
        onMomentumScrollEnd={e => { const raw = Math.max(0, Math.min(slots.length - 1, Math.round(e.nativeEvent.contentOffset.x / stride))); const index = groups.length > 1 && (raw < groups.length / 2 || raw >= groups.length * 2.5) ? groups.length + raw % groups.length : raw; activeRef.current = index; setActive(index); if (index !== raw) { scroll.setValue(index * stride); list.current?.scrollToOffset({ offset: index * stride, animated: false }); } }}
        getItemLayout={(_, index) => ({ length: stride, offset: stride * index, index })}
        renderItem={({ item: group, index }) => {
          const range = [(index - 2) * stride, (index - 1) * stride, index * stride, (index + 1) * stride, (index + 2) * stride];
          return <View style={{ width: stride, height: 404, zIndex: index === active ? 10 : 1 }}><Animated.View style={{ position: 'absolute', top: 19, left: (stride - posterWidth) / 2,
            opacity: scroll.interpolate({ inputRange: range, outputRange: [.2, .55, 1, .55, .2], extrapolate: 'clamp' }),
            transform: [{ translateY: scroll.interpolate({ inputRange: range, outputRange: [78.86 * reelScale, 42.71 * reelScale, 0, -24.14 * reelScale, -44.57 * reelScale], extrapolate: 'clamp' }) }, { rotate: scroll.interpolate({ inputRange: range, outputRange: ['-11deg', '-7deg', '-2deg', '3deg', '7deg'], extrapolate: 'clamp' }) }, { scale: scroll.interpolate({ inputRange: range, outputRange: [.72, .86, 1, .86, .72], extrapolate: 'clamp' }) }] }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${nameFor(data, group[0])}, featured`} onPress={() => onDetail(group[0])}><MediaArt {...art} path={metadataFor(data, group[0]).poster} title={nameFor(data, group[0])} style={{ width: posterWidth, height: posterWidth * 1.5, borderRadius: 6 }} /></Pressable>
          </Animated.View></View>;
        }} />
      <View pointerEvents="none" style={s.dots}>{groups.length > 12 ? <Text style={t.mono}>{centre + 1} / {groups.length}</Text> : groups.map((group, index) => <View key={group[0].id} style={[s.dot, index === centre && { backgroundColor: colors.text }]} />)}</View>
    </View>
    <Text style={s.kicker}>{resume ? 'Pick up where you left off' : 'Featured from your library'}</Text>
    <Text style={[t.heading, { marginBottom: 18 }]}>{nameFor(data, item)}</Text>
    <View style={s.metaList}>{rows.map(([label, value]) => <View key={String(label)} style={s.metaRow}><Text style={t.dim}>{label}</Text><Text style={[t.text, { flexShrink: 1, textAlign: 'right', fontSize: 15 }]} numberOfLines={1}>{value}</Text></View>)}</View>
    <View style={[t.row, { marginTop: 20 }]}><Pill label={resume ? 'Resume watching' : 'Play'} icon="play" primary style={{ flex: 1 }} onPress={() => onPlay(target)} /><Pill label="Details" style={{ flex: 1 }} onPress={() => onDetail(item)} /></View>
  </View>;
}

export function ContinueRow({ data, items, onPlay, onRemove, ...art }: ArtProps & { data: Library; items: Item[]; onPlay: (item: Item) => void; onRemove: (item: Item) => void }) {
  if (!items.length) return null;
  return <View style={t.section}><View style={t.sectionHeading}><View style={t.row}><Text style={t.sectionTitle}>Continue watching</Text><Icon name="chevron" size={16} /></View><Text style={t.dim}>{items.length} in progress</Text></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 12 }}>
      {items.map(item => { const m = metadataFor(data, item), progress = data.progress[item.id]; return <View key={item.id} style={{ width: 240 }}><Pressable accessibilityLabel={`Resume ${nameFor(data, item)}`} onPress={() => onPlay(item)}><MediaArt {...art} path={m.backdrop || m.poster} title={nameFor(data, item)} style={{ width: 240, height: 138, borderRadius: 12 }}>
        <LinearGradient colors={['transparent', '#000000e8']} style={StyleSheet.absoluteFill} />
        <View style={s.cwPlay}><Icon name="play" size={19} /></View><View style={s.cwText}><Text numberOfLines={1} style={[t.text, { fontSize: 13, fontFamily: fonts.medium }]}>{nameFor(data, item)}{item.kind === 'show' ? ` · S${item.season} E${item.episode}` : ''}</Text><Text style={[t.dim, { fontSize: 11 }]}>{progress?.duration ? `${formatTime(progress.duration - progress.position)} left` : 'Up next'}</Text><ProgressBar value={progress?.duration ? progress.position / progress.duration : 0} /></View>
      </MediaArt></Pressable><Pressable accessibilityLabel={`Remove ${nameFor(data, item)} from Continue watching`} onPress={() => onRemove(item)} style={s.remove}><Icon name="close" size={14} /></Pressable></View>; })}
    </ScrollView>
  </View>;
}

export function Corner({ username, onHome, onProfile, onHelp }: { username?: string; onHome: () => void; onProfile: () => void; onHelp: () => void }) {
  const insets = useSafeAreaInsets();
  return <View pointerEvents="box-none" style={[s.corner, { top: insets.top + 12 }]}><Pressable onPress={onHelp} accessibilityLabel="About Matro and this library" style={s.help}><Text style={[t.text, { fontSize: 15 }]}>?</Text></Pressable><View style={t.row}><Pressable onPress={onHome} accessibilityRole="button" accessibilityLabel="Matro, back to landing" style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}><Brand /></Pressable><Pressable onPress={onProfile} accessibilityRole="button" accessibilityLabel="Your profile" style={s.avatar}><Text style={[t.text, { fontSize: 14, fontFamily: fonts.medium }]}>{(username || 'M').slice(0, 1).toUpperCase()}</Text></Pressable></View></View>;
}
export function Dock({ tab, onChange, audio, admin }: { tab: string; onChange: (tab: string) => void; audio: boolean; admin: boolean }) {
  const insets = useSafeAreaInsets();
  const items: { id: string; label: string; icon: Glyph }[] = [{ id: 'movie', label: 'Movies', icon: 'movies' }, { id: 'show', label: 'Shows', icon: 'shows' }, ...(audio ? [{ id: 'audio', label: 'Music', icon: 'music' as Glyph }] : []), { id: 'search', label: 'Search', icon: 'search' }, ...(admin ? [{ id: 'folders', label: 'Folders', icon: 'folder' as Glyph }, { id: 'downloads', label: 'Downloads', icon: 'download' as Glyph }] : [])];
  return <View style={[s.dockWrap, { bottom: insets.bottom + 14 }]}><View style={s.dock}>{items.map(item => <Pressable key={item.id} onPress={() => onChange(tab === item.id ? 'home' : item.id)} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: tab === item.id }} style={({ pressed }) => [s.dockItem, tab === item.id && { backgroundColor: '#ffffff1f' }, pressed && { opacity: .65 }]}><Icon name={item.icon} color={tab === item.id ? colors.text : '#bebab3'} /></Pressable>)}</View></View>;
}
export function AccountSheet({ visible, onClose, data, base, onRefresh, onServer, onSignOut }: { visible: boolean; onClose: () => void; data: Library | null; base: string; onRefresh: () => void; onServer: () => void; onSignOut: () => void }) {
  const insets = useSafeAreaInsets();
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}><Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close profile" /><View style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}><View style={t.sectionHeading}><Text style={[t.heading, { fontSize: 28 }]}>Your profile</Text><IconButton name="close" label="Close profile" onPress={onClose} /></View><Text style={[t.text, { fontSize: 20 }]}>{data?.user.username}</Text><Text style={t.muted}>{data?.user.role === 'admin' ? 'Head account' : 'Viewer'} · {base.replace(/^https?:\/\//, '')}</Text><View style={[t.row, { marginVertical: 24, gap: 36 }]}><View><Text style={s.stat}>{data?.items.length || 0}</Text><Text style={t.dim}>Files</Text></View><View><Text style={s.stat}>{Object.values(data?.progress || {}).filter(p => p.completed).length}</Text><Text style={t.dim}>Watched</Text></View></View><View style={{ gap: 12 }}><Pill label="Refresh library" icon="refresh" onPress={() => { onClose(); onRefresh(); }} /><Pill label="Change server" icon="network" onPress={onServer} /><Pill label="Sign out" onPress={onSignOut} /></View></View></Modal>;
}

const s = StyleSheet.create({
  watched: { position: 'absolute', top: 7, right: 7, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0ba0', borderRadius: 99 }, posterProgress: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  cardName: { color: colors.text, fontFamily: fonts.medium, fontSize: 12.5, marginTop: 8, lineHeight: 17 }, cardMeta: { color: colors.dim, fontFamily: fonts.regular, fontSize: 11, marginTop: 3, lineHeight: 16 },
  dots: { position: 'absolute', top: 408, alignSelf: 'center', flexDirection: 'row', gap: 7, alignItems: 'center' }, dot: { width: 5, height: 5, borderRadius: 9, backgroundColor: '#ffffff33' }, kicker: { color: colors.dim, fontSize: 13, fontFamily: fonts.medium, marginBottom: 12 },
  metaList: { borderTopColor: '#ffffff33', borderTopWidth: 1, paddingTop: 5 }, metaRow: { paddingVertical: 7, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 },
  cwPlay: { position: 'absolute', top: 48, left: 108 }, cwText: { position: 'absolute', left: 12, right: 12, bottom: 12, gap: 5 }, remove: { position: 'absolute', top: 7, right: 7, backgroundColor: '#0a0a0b99', borderRadius: 99, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', left: 14, right: 14, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 20 }, help: { width: 40, height: 40, borderRadius: 99, borderWidth: 1, borderColor: colors.hairline, backgroundColor: '#1a1a1c99', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 99, borderWidth: 1, borderColor: '#ffffff26', backgroundColor: '#1a1a1c99', justifyContent: 'center', alignItems: 'center' },
  dockWrap: { position: 'absolute', left: 14, right: 14, alignItems: 'center', zIndex: 30 }, dock: { width: '100%', maxWidth: 420, height: 56, padding: 4, borderRadius: 99, borderWidth: 1, borderColor: colors.hairline, backgroundColor: '#171719f5', flexDirection: 'row', gap: 2, elevation: 12, boxShadow: '0 10px 30px #0006' }, dockItem: { flex: 1, height: 46, borderRadius: 99, justifyContent: 'center', alignItems: 'center' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: '#0009' }, sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 24, backgroundColor: colors.ground, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: colors.hairline }, stat: { color: colors.text, fontFamily: fonts.medium, fontSize: 28, letterSpacing: -1 }
});
