import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Item, Library } from '../lib/server';
import { episodeName, formatTime, metadataFor, nameFor } from '../../../../packages/core/client/library';
import { cleanEpisodeName, plural, runtimeText } from '../lib/text';
import { colors, fonts, radius } from '../theme';
import { IconButton, MediaArt, Pill, ProgressBar, styles as t } from '../components/Matro';
import type { ArtProps } from '../components/LibraryParts';

type Props = ArtProps & { data: Library; layout: { top: number; bottom: number }; onPlay: (item: Item) => void; onQueue: (ids: string[]) => void; onAutoplay: (on: boolean) => void; onBrowse: () => void };

/** MobileQueue artboard: what plays next, in order, with autoplay. The player itself stays a full-screen takeover. */
export default function QueueScreen({ data, layout, onPlay, onQueue, onAutoplay, onBrowse, ...art }: Props) {
  const items = data.queue.flatMap(id => data.items.find(item => item.id === id) || []).filter(item => !data.progress[item.id]?.completed), [next, ...rest] = items, autoplay = data.preferences.autoplay !== false;
  const artFor = (item: Item) => { const m = metadataFor(data, item); return m.episodes?.[String(item.season)]?.[String(item.episode)]?.still || m.backdrop || m.poster; };
  const kicker = (item: Item) => item.kind === 'show' ? `${nameFor(data, item)} · S${item.season} E${item.episode}` : `Movie${metadataFor(data, item).year ? ' · ' + metadataFor(data, item).year : ''}`;
  const title = (item: Item) => item.kind === 'show' ? cleanEpisodeName(episodeName(data, item), nameFor(data, item), item.episode) : nameFor(data, item);
  const length = (item: Item) => {
    const progress = data.progress[item.id], m = metadataFor(data, item), minutes = item.kind === 'show' ? m.episodes?.[String(item.season)]?.[String(item.episode)]?.runtime : m.runtime;
    return progress?.duration > 0 && progress.position > 0 && !progress.completed ? `${formatTime(progress.duration - progress.position)} left` : minutes ? runtimeText(minutes) : item.format;
  };
  const clear = () => Alert.alert('Clear the queue?', 'Everything waiting in Up next is removed. Your library and watch progress are not touched.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => onQueue([]) }], { cancelable: true });
  const progress = next && data.progress[next.id], resume = !!progress && progress.position > 0 && !progress.completed;
  return <ScrollView contentContainerStyle={{ paddingTop: layout.top + 76, paddingBottom: layout.bottom + 120, paddingHorizontal: 18 }} showsVerticalScrollIndicator={false}>
    <View style={[t.row, { justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }]}>
      <View><Text accessibilityRole="header" style={t.heading}>Queue</Text><Text style={[t.muted, { marginTop: 2 }]}>{items.length ? `${plural(items.length, 'item')} waiting` : 'Nothing waiting'}</Text></View>
      {items.length > 0 && <Pressable onPress={clear} accessibilityRole="button" accessibilityLabel="Clear the queue" hitSlop={8} style={s.textButton}><Text style={[t.text, { fontFamily: fonts.medium }]}>Clear</Text></Pressable>}
    </View>
    {next && <View style={s.hero}>
      <MediaArt {...art} sheen path={artFor(next)} title={nameFor(data, next)} style={{ height: 170 }} />
      <View style={{ padding: 18, gap: 12 }}>
        <View style={{ gap: 2 }}><Text style={t.muted} numberOfLines={1}>{resume ? 'Resume · ' : 'Next · '}{kicker(next)}</Text><Text style={[t.sectionTitle, { fontSize: 20 }]} numberOfLines={2}>{title(next)}</Text></View>
        {resume && <ProgressBar value={progress!.position / progress!.duration} />}
        <Pill label={resume ? 'Resume' : 'Play'} icon="play" primary onPress={() => onPlay(next)} />
      </View>
    </View>}
    {rest.length > 0 && <View style={{ marginTop: 24 }}>
      <Text accessibilityRole="header" style={[t.sectionTitle, { marginBottom: 8 }]}>Up next</Text>
      {rest.map(item => <View key={item.id} style={s.row}>
        <Pressable onPress={() => onPlay(item)} accessibilityRole="button" accessibilityLabel={`Play ${title(item)}`} style={({ pressed }) => [s.play, pressed && { opacity: .7 }]}>
          <MediaArt {...art} path={artFor(item)} title={nameFor(data, item)} quiet style={{ width: 96, height: 54, borderRadius: radius.poster }} />
          <View style={{ flex: 1, gap: 2 }}><Text style={[t.dim, { fontFamily: fonts.medium }]} numberOfLines={1}>{kicker(item)}</Text><Text style={[t.text, { fontSize: 15, fontFamily: fonts.semibold }]} numberOfLines={1}>{title(item)}</Text><Text style={t.dim}>{length(item)}</Text></View>
        </Pressable>
        <IconButton name="close" label={`Remove ${title(item)} from the queue`} onPress={() => onQueue(data.queue.filter(id => id !== item.id))} />
      </View>)}
    </View>}
    {!items.length && <View style={s.empty}>
      <Text style={[t.text, { fontFamily: fonts.semibold, fontSize: 15 }]}>Nothing up next</Text>
      <Text style={[t.muted, { textAlign: 'center' }]}>Add episodes or movies from their title page, or press + Add to queue.</Text>
      <Pill label="Browse library" primary onPress={onBrowse} style={{ alignSelf: 'stretch' }} />
    </View>}
    <Pressable onPress={() => onAutoplay(!autoplay)} accessibilityRole="switch" accessibilityState={{ checked: autoplay }} accessibilityLabel="Autoplay next" style={s.autoplay}>
      <View style={{ flex: 1, gap: 2 }}><Text style={[t.text, { fontFamily: fonts.medium, fontSize: 15 }]}>Autoplay next</Text><Text style={t.dim}>Plays the next item when one ends</Text></View>
      <View style={[s.toggle, autoplay && { backgroundColor: colors.primary }]}><View style={[s.knob, autoplay ? { left: 23, backgroundColor: colors.onPrimary } : { left: 3, backgroundColor: colors.text }]} /></View>
    </Pressable>
  </ScrollView>;
}
const s = StyleSheet.create({
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  hero: { borderRadius: radius.sheet, overflow: 'hidden', backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.hairline },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 }, play: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  empty: { padding: 24, gap: 12, alignItems: 'center', borderRadius: radius.sheet, backgroundColor: colors.fill },
  autoplay: { marginTop: 28, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderRadius: radius.panel, backgroundColor: colors.fill },
  toggle: { width: 48, height: 28, borderRadius: radius.pill, backgroundColor: colors.track }, knob: { position: 'absolute', top: 3, width: 22, height: 22, borderRadius: radius.pill },
});
