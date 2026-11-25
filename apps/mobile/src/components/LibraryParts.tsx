import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, FlatList, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Item, Library } from '../lib/server';
import { formatTime, metadataFor, nameFor, resumeItem, statusOf } from '../../../../packages/core/client/library';
import { titleMeta } from '../lib/text';
import { colors, fonts, radius } from '../theme';
import { Icon, MediaArt, Pill, ProgressBar, styles as t } from './Matro';
import { Lift, useReduceMotion } from './Motion';
export type ArtProps = { base: string; headers: Record<string, string> };

/** Phones under 380 dp get two columns; wider ones three or more. */
export const gridColumns = (width: number) => width < 380 ? 2 : Math.max(3, Math.floor((width - 24) / 108));
export const gridCardWidth = (width: number, columns: number) => (width - 36 - (columns - 1) * 12) / columns;

export const PosterCard = memo(function PosterCard({ data, items, width, onPress, ...art }: ArtProps & { data: Library; items: Item[]; width: number; onPress: () => void }) {
  const item = items[0], m = metadataFor(data, item), status = statusOf(data, items), target = resumeItem(data, items), progress = data.progress[target.id];
  const meta = titleMeta(item.kind, m.year, new Set(items.map(i => i.season)).size, items.length);
  return <Lift accessibilityRole="button" accessibilityLabel={`Open ${nameFor(data, item)}`} onPress={onPress} style={{ width, marginBottom: 22 }}>
    <MediaArt {...art} sheen path={m.poster} title={nameFor(data, item)} style={{ width, height: width * 1.5, borderRadius: radius.poster }}>
      {status === 'done' && <View style={s.watched}><Icon name="check" size={13} /></View>}
      {status === 'progress' && progress?.duration > 0 && <View style={s.posterProgress}><ProgressBar value={progress.position / progress.duration} /></View>}
    </MediaArt>
    <Text numberOfLines={2} style={s.cardName}>{nameFor(data, item)}</Text>
    {meta ? <Text numberOfLines={1} style={s.cardMeta}>{meta}</Text> : null}
  </Lift>;
});

/** One row of posters on Home: a heading with "See all", then a short horizontal shelf. */
export function Shelf({ title, count, noun, onSeeAll, children }: { title: string; count: number; noun: string; onSeeAll: () => void; children: ReactNode }) {
  return <View style={t.section}>
    <View style={t.sectionHeading}><Text accessibilityRole="header" style={t.sectionTitle}>{title}</Text>
      <Pressable onPress={onSeeAll} accessibilityRole="button" accessibilityLabel={`See all ${count} ${noun}`} hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }} style={s.seeAll}><Text style={t.dim}>See all {count}</Text><Icon name="chevron" size={14} color={colors.dim} /></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 12 }}>{children}</ScrollView>
  </View>;
}

/** The reel is capped to about 300 dp (52% of the window) so its title and Play button sit above the dock on first paint. */
const reelScaleFor = (width: number, height: number) => Math.min(Math.max(.62, Math.min(1.1, (width - 1) / 1040)) * 1.08, (Math.min(300, height * .52) - 96) / 1.5 / 340);

export function FeaturedReel({ data, groups, onPlay, onDetail, ...art }: ArtProps & { data: Library; groups: Item[][]; onPlay: (item: Item) => void; onDetail: (item: Item) => void }) {
  const { width, height } = useWindowDimensions(), reduce = useReduceMotion(), reelScale = reelScaleFor(width, height), posterWidth = 340 * reelScale, stride = posterWidth * (reduce ? 1.06 : .74065), start = groups.length > 1 ? groups.length : 0;
  const scroll = useRef(new Animated.Value(start * stride)).current, list = useRef<FlatList<Item[]>>(null), activeRef = useRef(start);
  const [active, setActive] = useState(start), box = posterWidth * 1.5 + 62;
  const slots = useMemo(() => groups.length > 1 ? [...groups, ...groups, ...groups] : groups, [groups]);
  const centre = active % (groups.length || 1), items = groups[centre];
  if (!items) return null;
  const item = items[0], m = metadataFor(data, item), target = resumeItem(data, items), resume = data.progress[target.id]?.position > 0 && !data.progress[target.id]?.completed;
  const rows = [[m.peopleLabel || 'Director', m.people?.slice(0, 2).join(', ')], ['Year', m.year], ['Genre', m.genres?.slice(0, 2).join(', ')]].filter(([, value]) => value);
  if (!rows.length) rows.push(['Type', item.kind === 'show' ? 'Series' : 'Movie'], ['Format', item.format], ['Folder', item.root?.split(/[\\/]/).filter(Boolean).pop() || 'Library']);
  return <View style={{ marginBottom: 32 }}>
    <View style={{ height: box + 34, marginHorizontal: -18 }}>
      <Animated.FlatList ref={list} horizontal data={slots} keyExtractor={(group, index) => group[0].id + ':' + index} initialScrollIndex={start} showsHorizontalScrollIndicator={false} snapToInterval={stride} decelerationRate="fast" disableIntervalMomentum
        removeClippedSubviews={false} initialNumToRender={5} windowSize={5} contentContainerStyle={{ paddingHorizontal: (width - stride) / 2 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scroll } } }], { useNativeDriver: true, listener: (e: { nativeEvent: { contentOffset: { x: number } } }) => { const index = Math.max(0, Math.min(slots.length - 1, Math.round(e.nativeEvent.contentOffset.x / stride))); if (index !== activeRef.current) { activeRef.current = index; setActive(index); } } })} scrollEventThrottle={16}
        onMomentumScrollEnd={e => { const raw = Math.max(0, Math.min(slots.length - 1, Math.round(e.nativeEvent.contentOffset.x / stride))); const index = groups.length > 1 && (raw < groups.length / 2 || raw >= groups.length * 2.5) ? groups.length + raw % groups.length : raw; activeRef.current = index; setActive(index); if (index !== raw) { scroll.setValue(index * stride); list.current?.scrollToOffset({ offset: index * stride, animated: false }); } }}
        getItemLayout={(_, index) => ({ length: stride, offset: stride * index, index })}
        renderItem={({ item: group, index }) => {
          const range = [(index - 2) * stride, (index - 1) * stride, index * stride, (index + 1) * stride, (index + 2) * stride];
          return <View style={{ width: stride, height: box, zIndex: index === active ? 10 : 1 }}><Animated.View style={{ position: 'absolute', top: 19, left: (stride - posterWidth) / 2,
            opacity: scroll.interpolate({ inputRange: range, outputRange: [.2, .55, 1, .55, .2], extrapolate: 'clamp' }),
            transform: reduce ? [] : [{ translateY: scroll.interpolate({ inputRange: range, outputRange: [78.86 * reelScale, 42.71 * reelScale, 0, -24.14 * reelScale, -44.57 * reelScale], extrapolate: 'clamp' }) }, { rotate: scroll.interpolate({ inputRange: range, outputRange: ['-11deg', '-7deg', '-2deg', '3deg', '7deg'], extrapolate: 'clamp' }) }, { scale: scroll.interpolate({ inputRange: range, outputRange: [.72, .86, 1, .86, .72], extrapolate: 'clamp' }) }] }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${nameFor(data, group[0])}, featured`} onPress={() => onDetail(group[0])}><MediaArt {...art} sheen path={metadataFor(data, group[0]).poster} title={nameFor(data, group[0])} style={{ width: posterWidth, height: posterWidth * 1.5, borderRadius: radius.poster }} /></Pressable>
          </Animated.View></View>;
        }} />
      <View pointerEvents="none" style={[s.dots, { top: box + 4 }]}>{groups.length > 12 ? <Text style={t.mono}>{centre + 1} / {groups.length}</Text> : groups.map((group, index) => <View key={group[0].id} style={[s.dot, index === centre && { backgroundColor: colors.text }]} />)}</View>
    </View>
    <Text style={s.kicker}>{resume ? 'Pick up where you left off' : 'Featured from your library'}</Text>
    <Text numberOfLines={2} style={[t.display, { marginBottom: 8 }]}>{nameFor(data, item)}</Text>
    <Text numberOfLines={1} style={[t.muted, { marginBottom: 18 }]}>{rows.map(([, value]) => value).join(' · ')}</Text>
    <View style={t.row}><Pill label={resume ? 'Resume watching' : 'Play'} icon="play" primary style={{ flex: 1 }} onPress={() => onPlay(target)} /><Pill label="Details" style={{ flex: 1 }} onPress={() => onDetail(item)} /></View>
  </View>;
}

export function ContinueRow({ data, items, onPlay, onRemove, ...art }: ArtProps & { data: Library; items: Item[]; onPlay: (item: Item) => void; onRemove: (item: Item) => void }) {
  if (!items.length) return null;
  return <View style={t.section}><View style={t.sectionHeading}><Text accessibilityRole="header" style={t.sectionTitle}>Continue watching</Text><Text style={t.dim}>{items.length} in progress</Text></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 12 }}>
      {items.map(item => { const m = metadataFor(data, item), progress = data.progress[item.id], known = progress?.duration > 0; return <View key={item.id} style={{ width: 240 }}><Lift accessibilityRole="button" accessibilityLabel={`Resume ${nameFor(data, item)}`} onPress={() => onPlay(item)}><MediaArt {...art} sheen path={m.backdrop || m.poster} title={nameFor(data, item)} style={{ width: 240, height: 138, borderRadius: radius.panel }}>
        <LinearGradient colors={[colors.clear, colors.shade]} style={StyleSheet.absoluteFill} />
        <View style={s.cwPlay}><Icon name="play" size={19} /></View><View style={s.cwText}><Text numberOfLines={1} style={[t.text, { fontSize: 13, fontFamily: fonts.medium }]}>{nameFor(data, item)}{item.kind === 'show' ? ` · S${item.season} E${item.episode}` : ''}</Text><Text style={[t.dim, { fontSize: 11 }]}>{known ? `${formatTime(progress.duration - progress.position)} left` : 'Up next'}</Text>{known && <ProgressBar value={progress.position / progress.duration} />}</View>
      </MediaArt></Lift><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${nameFor(data, item)} from Continue watching`} onPress={() => onRemove(item)} hitSlop={8} style={s.remove}><Icon name="close" size={14} /></Pressable></View>; })}
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  watched: { position: 'absolute', top: 7, right: 7, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.veil, borderRadius: radius.pill }, posterProgress: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  cardName: { color: colors.text, fontFamily: fonts.medium, fontSize: 13, marginTop: 8, lineHeight: 17 }, cardMeta: { color: colors.dim, fontFamily: fonts.regular, fontSize: 12, marginTop: 3, lineHeight: 16 },
  seeAll: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2, justifyContent: 'flex-end', marginVertical: -12 },
  dots: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', gap: 7, alignItems: 'center' }, dot: { width: 5, height: 5, borderRadius: 9, backgroundColor: colors.track }, kicker: { color: colors.dim, fontSize: 13, fontFamily: fonts.medium, marginBottom: 12 },
  cwPlay: { position: 'absolute', top: 48, left: 108 }, cwText: { position: 'absolute', left: 12, right: 12, bottom: 12, gap: 5 }, remove: { position: 'absolute', top: 7, right: 7, backgroundColor: colors.veil, borderRadius: radius.pill, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
