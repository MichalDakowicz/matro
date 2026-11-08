import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { Item, Library } from '../lib/server';
import { episodeName, formatTime, metadataFor, nameFor, resumeItem } from '../../../../packages/core/client/library';
import { Icon, IconButton, MediaArt, Pill, ProgressBar, styles as t } from '../components/Matro';
import type { ArtProps } from '../components/LibraryParts';
import { colors, fonts } from '../theme';

export default function TitleScreen({ data, items, onBack, onPlay, onComplete, onEnqueue, ...art }: ArtProps & { data: Library; items: Item[]; onBack: () => void; onPlay: (item: Item, start?: number) => void; onComplete: (item: Item) => void; onEnqueue: (items: Item[]) => void }) {
  const item = items[0], m = metadataFor(data, item), target = resumeItem(data, items), p = data.progress[target.id];
  const insets = useSafeAreaInsets(), seasons = [...new Set(items.map(i => i.season || 1))];
  const [season, setSeason] = useState(target.season || seasons[0]);
  const resume = p?.position > 0 && !p.completed;
  const facts = [m.year, m.genres?.slice(0, 3).join(' · '), item.kind === 'show' ? `${seasons.length} seasons · ${items.length} episodes` : m.runtime ? `${Math.floor(m.runtime / 60) ? Math.floor(m.runtime / 60) + 'h ' : ''}${m.runtime % 60}m` : '', item.kind === 'show' ? 'Series' : item.kind === 'audio' ? 'Audio' : 'Movie', item.format].filter(Boolean).join(' · ');
  const header = <View style={{ paddingTop: 260 + insets.top }}>
    <Text style={[t.heading, { fontSize: 36, lineHeight: 39 }]}>{nameFor(data, item)}</Text>
    {m.tagline ? <Text style={[t.dim, { fontStyle: 'italic', marginTop: 12 }]}>{m.tagline}</Text> : null}
    {m.people?.length ? <Text style={[t.muted, { marginTop: 12 }]}>{m.peopleLabel} <Text style={t.text}>{m.people.slice(0, 3).join(', ')}</Text></Text> : null}
    <Text style={[t.dim, { marginTop: 12, lineHeight: 20 }]}>{facts}</Text>
    {m.overview ? <Text style={[t.muted, { fontSize: 14, lineHeight: 23, marginTop: 14 }]}>{m.overview}</Text> : null}
    <View style={[t.row, { marginTop: 20, flexWrap: 'wrap', gap: 8 }]}>
      <Pill label={resume ? `Resume  ${formatTime(p.position)}` : 'Play now'} icon="play" primary onPress={() => onPlay(target)} style={{ flex: 1, minWidth: 150 }} />
      {resume && <View style={s.circleAction}><IconButton name="restart" label="Play from start" size={50} onPress={() => onPlay(target, 0)} /></View>}
      <View style={s.circleAction}><IconButton name="plus" label="Add to queue" size={50} onPress={() => onEnqueue(items)} /></View>
      <View style={s.circleAction}><IconButton name="check" label={data.progress[item.id]?.completed ? 'Mark incomplete' : 'Mark complete'} size={50} active={!!data.progress[item.id]?.completed} onPress={() => onComplete(item)} /></View>
    </View>
    {m.rating ? <View style={s.ratings}><Text style={[t.mono, { marginBottom: 6 }]}>TMDB</Text><View style={[t.row, { alignItems: 'baseline', gap: 5 }]}><Text style={s.score}>{m.rating.toFixed(1)}</Text><Text style={t.dim}>/10{m.votes ? ` · ${m.votes.toLocaleString()} votes` : ''}</Text></View></View> : null}
    {item.kind === 'show' && <View style={{ marginTop: 28 }}><View style={t.sectionHeading}><Text style={t.sectionTitle}>Episodes</Text><Text style={t.dim}>{items.filter(i => data.progress[i.id]?.completed).length} / {items.length} watched</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 14 }}>{seasons.map(value => <Pill key={value} compact label={`Season ${value}`} style={season === value ? { backgroundColor: '#ffffff18' } : undefined} onPress={() => setSeason(value)} />)}</ScrollView></View>}
  </View>;
  const footer = <View style={{ gap: 28, marginTop: 28 }}>
    {!!m.cast?.length && <View><Text style={[t.sectionTitle, { marginBottom: 18 }]}>Cast</Text><View style={s.castGrid}>{m.cast.map(person => <View key={person.name} style={s.castMember}><MediaArt {...art} path={person.photo} title={person.name} style={{ width: '100%', aspectRatio: 2 / 3, borderRadius: 6 }} /><Text numberOfLines={2} style={[t.text, { fontSize: 12.5, fontFamily: fonts.medium, marginTop: 8 }]}>{person.name}</Text><Text numberOfLines={2} style={[t.dim, { fontSize: 11, marginTop: 3 }]}>{person.role}</Text></View>)}</View></View>}
    <View><Text style={[t.sectionTitle, { marginBottom: 18 }]}>File</Text><View style={[t.row, { gap: 40, alignItems: 'flex-start' }]}><View><Text style={t.dim}>Format</Text><Text style={[t.text, { fontFamily: fonts.medium, marginTop: 6 }]}>{item.format}</Text><Text style={[t.dim, { marginTop: 4 }]}>{item.kind === 'show' ? 'Series' : 'Movie'}</Text></View><View style={{ flex: 1 }}><Text style={t.dim}>Source</Text><Text style={[t.text, { fontFamily: fonts.medium, marginTop: 6 }]} numberOfLines={2}>{item.root?.split(/[\\/]/).filter(Boolean).pop() || 'Library'}</Text><Text style={[t.dim, { marginTop: 4 }]}>Matro server</Text></View></View></View>
  </View>;
  return <View style={s.fill}>
    <MediaArt {...art} path={m.backdrop || m.poster} title={nameFor(data, item)} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 420 + insets.top }}><LinearGradient colors={['#0a0a0b4d', 'transparent', '#0a0a0b8c', colors.ground]} locations={[0, .24, .64, .96]} style={StyleSheet.absoluteFill} /></MediaArt>
    <FlatList data={item.kind === 'show' ? items.filter(i => (i.season || 1) === season) : []} keyExtractor={i => i.id} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }} ListHeaderComponent={header} ListFooterComponent={footer} showsVerticalScrollIndicator={false}
      renderItem={({ item: episode }) => {
        const e = metadataFor(data, episode).episodes?.[String(episode.season)]?.[String(episode.episode)], progress = data.progress[episode.id], done = progress?.completed;
        return <View style={s.episodeEntry}><Pressable onPress={() => onPlay(episode)} accessibilityLabel={`Play ${episodeName(data, episode)}`} style={s.episodeRow}>
          <MediaArt {...art} path={e?.still} style={s.episodeStill}><LinearGradient colors={['transparent', '#000a']} style={StyleSheet.absoluteFill} /><Text style={s.episodeCode}>S{episode.season} E{episode.episode}</Text>{progress?.duration > 0 && !done && <View style={s.episodeProgress}><ProgressBar value={progress.position / progress.duration} /></View>}</MediaArt>
          <View style={{ flex: 1, gap: 4 }}><Text style={[t.text, { fontFamily: fonts.medium, lineHeight: 20 }]} numberOfLines={2}>{episode.episode}. {episodeName(data, episode)}</Text><Text style={[t.dim, { fontSize: 11 }]}>{[e?.runtime ? e.runtime + 'm' : '', episode.format, done ? 'Watched' : progress?.position ? formatTime(progress.position) + ' watched' : ''].filter(Boolean).join(' · ')}</Text>{e?.overview && <Text numberOfLines={2} style={[t.dim, { fontSize: 11, lineHeight: 17 }]}>{e.overview}</Text>}</View>
        </Pressable><Pressable onPress={() => onComplete(episode)} accessibilityLabel={`${done ? 'Mark incomplete' : 'Mark complete'} ${episodeName(data, episode)}`} style={[s.episodeCheck, done && { backgroundColor: colors.primary }]}><Icon name="check" size={13} color={done ? colors.onPrimary : colors.text} /></Pressable></View>;
      }} />
    <View style={{ position: 'absolute', top: insets.top + 12, left: 14, borderRadius: 999, backgroundColor: '#171719aa', borderWidth: 1, borderColor: colors.hairline }}><IconButton name="back" label="Close details" onPress={onBack} /></View>
  </View>;
}
const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.ground }, circleAction: { borderRadius: 999, borderWidth: 1, borderColor: '#ffffff24' }, ratings: { marginTop: 26, paddingLeft: 12, borderLeftWidth: 1, borderColor: '#ffffff26' }, score: { color: colors.text, fontSize: 22, fontFamily: fonts.medium },
  episodeEntry: { position: 'relative', marginBottom: 16 }, episodeRow: { flexDirection: 'row', gap: 14, alignItems: 'center' }, episodeStill: { width: 128, height: 76, borderRadius: 7 }, episodeCode: { position: 'absolute', bottom: 8, left: 8, color: colors.text, fontSize: 10, fontFamily: fonts.mono }, episodeCheck: { position: 'absolute', left: 99, top: 5, width: 24, height: 24, borderWidth: 1, borderColor: '#ffffff59', borderRadius: 99, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0b99' }, episodeProgress: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  castGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, castMember: { width: '30%', maxWidth: 150 }
});
