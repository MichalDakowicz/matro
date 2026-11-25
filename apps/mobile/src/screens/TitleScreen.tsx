import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { Item, Library } from '../lib/server';
import { episodeName, formatTime, metadataFor, nameFor, resumeItem } from '../../../../packages/core/client/library';
import { cleanEpisodeName, plural, runtimeText } from '../lib/text';
import { Chip, Icon, IconButton, MediaArt, Pill, ProgressBar, Row, Sheet, styles as t } from '../components/Matro';
import type { ArtProps } from '../components/LibraryParts';
import { TopFade } from '../components/Shell';
import { colors, fonts, radius } from '../theme';

type Props = ArtProps & {
  data: Library; items: Item[]; onBack: () => void; onPlay: (item: Item, start?: number) => void; onEnqueue: (items: Item[]) => void;
  /** Marks every item watched (done) or unwatched; items already in that state are skipped. */
  onMark: (items: Item[], done: boolean) => void;
  onSave?: (item: Item) => void; onSaveMany?: (items: Item[]) => void; onRemoveSaved?: (items: Item[]) => void; savedIds?: Set<string>; savingIds?: Set<string>;
};
type Menu = null | 'save' | 'watched' | { episode: Item };

export default function TitleScreen({ data, items, onBack, onPlay, onEnqueue, onMark, onSave, onSaveMany, onRemoveSaved, savedIds, savingIds, ...art }: Props) {
  const item = items[0], m = metadataFor(data, item), target = resumeItem(data, items), p = data.progress[target.id], name = nameFor(data, item);
  const insets = useSafeAreaInsets(), seasons = [...new Set(items.map(i => i.season || 1))];
  const [season, setSeason] = useState(target.season || seasons[0]), [menu, setMenu] = useState<Menu>(null), [scrolled, setScrolled] = useState(false);
  const resume = p?.position > 0 && !p.completed, show = item.kind === 'show';
  const done = (list: Item[]) => list.length > 0 && list.every(i => data.progress[i.id]?.completed);
  const inSeason = items.filter(i => (i.season || 1) === season);
  // From the episode Play would start now to the end of its season.
  const rest = items.filter(i => (i.season || 1) === (target.season || 1) && (i.episode || 0) >= (target.episode || 0));
  const facts = [m.year, m.genres?.slice(0, 3).join(' · '), show ? `${plural(seasons.length, 'season')} · ${plural(items.length, 'episode')}` : m.runtime ? runtimeText(m.runtime) : '', item.kind === 'audio' ? 'Audio' : '', item.format].filter(Boolean).join(' · ');
  const state = (id: string) => savedIds?.has(id) ? 'saved' : savingIds?.has(id) ? 'saving' : 'idle';
  const saveLabel = (id: string) => ({ saved: 'Saved offline', saving: 'Saving…', idle: 'Save offline' })[state(id)];
  const close = (run: () => void) => { setMenu(null); run(); };
  const episodeTitle = (episode: Item) => cleanEpisodeName(episodeName(data, episode), name, episode.episode);

  const header = <View>
    <MediaArt {...art} quiet path={m.backdrop || m.poster} title={name} style={{ position: 'absolute', top: 0, left: -18, right: -18, height: 420 + insets.top }}><LinearGradient colors={[colors.veil, colors.clear, colors.veil, colors.ground]} locations={[0, .24, .64, .96]} style={StyleSheet.absoluteFill} /></MediaArt>
    <View style={{ paddingTop: 260 + insets.top }}>
      <Text accessibilityRole="header" style={t.display}>{name}</Text>
      {m.tagline ? <Text style={[t.dim, { fontStyle: 'italic', marginTop: 12 }]}>{m.tagline}</Text> : null}
      {m.people?.length ? <Text style={[t.muted, { marginTop: 12 }]}>{m.peopleLabel} <Text style={t.text}>{m.people.slice(0, 3).join(', ')}</Text></Text> : null}
      <Text style={[t.dim, { marginTop: 12, lineHeight: 20 }]}>{facts}</Text>
      {m.overview ? <Text style={[t.muted, { fontSize: 14, lineHeight: 23, marginTop: 14 }]}>{m.overview}</Text> : null}
      <View style={[t.row, { marginTop: 20 }]}>
        <Pill label={resume ? `Resume  ${formatTime(p.position)}` : 'Play now'} icon="play" primary onPress={() => onPlay(target)} style={{ flex: 1 }} />
        {resume && <View style={s.circleAction}><IconButton name="restart" label="Play from start" size={50} onPress={() => onPlay(target, 0)} /></View>}
      </View>
      <View style={[t.row, { marginTop: 10, flexWrap: 'wrap' }]}>
        <Pill label="Add to queue" icon="plus" style={s.action} onPress={() => onEnqueue(items)} />
        {show ? <Pill label="Mark watched" icon="check" style={s.action} onPress={() => setMenu('watched')} />
          : <Pill label={done(items) ? 'Mark unwatched' : 'Mark watched'} icon="check" style={s.action} onPress={() => onMark(items, !done(items))} />}
        {onSave && (show ? onSaveMany && <Pill label="Save offline" icon="download" style={s.action} onPress={() => setMenu('save')} />
          : <Pill label={saveLabel(target.id)} icon={state(target.id) === 'saved' ? 'check' : 'download'} style={s.action} disabled={state(target.id) !== 'idle'} onPress={() => onSave(target)} />)}
        {onRemoveSaved && <Pill label="Remove from this device" icon="trash" style={s.action} onPress={() => onRemoveSaved(items)} />}
      </View>
      {m.rating ? <View style={s.ratings}><Text style={[t.mono, { marginBottom: 6 }]}>TMDB</Text><View style={[t.row, { alignItems: 'baseline', gap: 5 }]}><Text style={s.score}>{m.rating.toFixed(1)}</Text><Text style={t.dim}>/10{m.votes ? ` · ${m.votes.toLocaleString()} votes` : ''}</Text></View></View> : null}
      {show && <View style={{ marginTop: 28 }}><View style={t.sectionHeading}><Text accessibilityRole="header" style={t.sectionTitle}>Episodes</Text><Text style={t.dim}>{items.filter(i => data.progress[i.id]?.completed).length} / {items.length} watched</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 18, paddingBottom: 14 }}>{seasons.map(value => <Chip key={value} small label={`Season ${value}`} selected={season === value} onPress={() => setSeason(value)} />)}</ScrollView></View>}
    </View>
  </View>;
  const footer = <View style={{ gap: 28, marginTop: 28 }}>
    {!!m.cast?.length && <View><Text style={[t.sectionTitle, { marginBottom: 18 }]}>Cast</Text><View style={s.castGrid}>{m.cast.map(person => <View key={person.name} style={s.castMember}><MediaArt {...art} path={person.photo} title={person.name} style={{ width: '100%', aspectRatio: 2 / 3, borderRadius: radius.poster }} /><Text numberOfLines={2} style={[t.text, { fontSize: 12.5, fontFamily: fonts.medium, marginTop: 8 }]}>{person.name}</Text><Text numberOfLines={2} style={[t.dim, { fontSize: 11, marginTop: 3 }]}>{person.role}</Text></View>)}</View></View>}
    <View><Text style={[t.sectionTitle, { marginBottom: 18 }]}>File</Text><View style={[t.row, { gap: 40, alignItems: 'flex-start' }]}><View><Text style={t.dim}>Format</Text><Text style={[t.text, { fontFamily: fonts.medium, marginTop: 6 }]}>{item.format}</Text><Text style={[t.dim, { marginTop: 4 }]}>{show ? 'Series' : 'Movie'}</Text></View><View style={{ flex: 1 }}><Text style={t.dim}>Source</Text><Text style={[t.text, { fontFamily: fonts.medium, marginTop: 6 }]} numberOfLines={2}>{item.root?.split(/[\\/]/).filter(Boolean).pop() || 'Library'}</Text><Text style={[t.dim, { marginTop: 4 }]}>Matro server</Text></View></View></View>
  </View>;
  const episode = menu && typeof menu === 'object' ? menu.episode : null;
  return <View style={s.fill}>
    <FlatList data={show ? inSeason : []} keyExtractor={i => i.id} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }} ListHeaderComponent={header} ListFooterComponent={footer} showsVerticalScrollIndicator={false}
      scrollEventThrottle={64} onScroll={e => { const far = e.nativeEvent.contentOffset.y > 160; if (far !== scrolled) setScrolled(far); }}
      renderItem={({ item: ep }) => {
        const e = metadataFor(data, ep).episodes?.[String(ep.season)]?.[String(ep.episode)], progress = data.progress[ep.id], watched = progress?.completed, label = episodeTitle(ep);
        return <View style={s.episodeEntry}>
          <Pressable onPress={() => onPlay(ep)} onLongPress={() => setMenu({ episode: ep })} accessibilityLabel={`Play ${label}`} accessibilityHint="Long press for more actions" style={s.episodeRow}>
            <MediaArt {...art} quiet path={e?.still} title={name} style={s.episodeStill}><LinearGradient colors={[colors.clear, colors.veil]} style={StyleSheet.absoluteFill} /><Text style={s.episodeCode}>S{ep.season} E{ep.episode}</Text>{progress?.duration > 0 && !watched && <View style={s.episodeProgress}><ProgressBar value={progress.position / progress.duration} /></View>}</MediaArt>
            <View style={{ flex: 1, gap: 4 }}><Text style={[t.text, { fontFamily: fonts.medium, lineHeight: 20 }, watched && { color: colors.dim }]} numberOfLines={2}>{ep.episode}. {label}</Text><Text style={[t.dim, { fontSize: 11 }]}>{[e?.runtime ? e.runtime + 'm' : '', watched ? 'Watched' : progress?.position ? formatTime(progress.position) + ' watched' : '', state(ep.id) === 'saved' ? 'Saved offline' : state(ep.id) === 'saving' ? 'Saving…' : ''].filter(Boolean).join(' · ')}</Text>{e?.overview && <Text numberOfLines={2} style={[t.dim, { fontSize: 11, lineHeight: 17 }]}>{e.overview}</Text>}</View>
          </Pressable>
          <IconButton name="more" label={`More actions for ${label}`} onPress={() => setMenu({ episode: ep })} />
        </View>;
      }} />
    {scrolled && <TopFade />}
    <View style={[s.back, { top: insets.top + 12 }]}><IconButton name="back" label="Close details" onPress={onBack} /></View>
    <Sheet visible={menu === 'watched'} onClose={() => setMenu(null)} title="Mark as watched">
      <Row icon="check" label={done(inSeason) ? `Season ${season} as unwatched` : `Season ${season}`} detail={plural(inSeason.length, 'episode')} onPress={() => close(() => onMark(inSeason, !done(inSeason)))} />
      <Row icon="check" label={done(items) ? 'Whole show as unwatched' : 'Whole show'} detail={plural(items.length, 'episode')} last onPress={() => close(() => onMark(items, !done(items)))} />
    </Sheet>
    <Sheet visible={menu === 'save'} onClose={() => setMenu(null)} title="Save offline">
      <Row icon="download" label={`Season ${season}`} detail={`${plural(inSeason.length, 'episode')} · saved two at a time`} last={rest.length <= 1} onPress={() => close(() => onSaveMany?.(inSeason))} />
      {rest.length > 1 && <Row icon="download" label={`From S${target.season || 1} E${target.episode} to season end`} detail={plural(rest.length, 'episode')} last onPress={() => close(() => onSaveMany?.(rest))} />}
    </Sheet>
    <Sheet visible={!!episode} onClose={() => setMenu(null)} title={episode ? `${episode.episode}. ${episodeTitle(episode)}` : 'Episode'}>
      {episode && <>
        <Row icon="play" label="Play" onPress={() => close(() => onPlay(episode))} />
        <Row icon="check" label={data.progress[episode.id]?.completed ? 'Mark unwatched' : 'Mark watched'} onPress={() => close(() => onMark([episode], !data.progress[episode.id]?.completed))} />
        <Row icon="plus" label="Add to queue" onPress={() => close(() => onEnqueue([episode]))} />
        {onSave && <Row icon={state(episode.id) === 'saved' ? 'check' : 'download'} label={saveLabel(episode.id)} last onPress={() => state(episode.id) === 'idle' ? close(() => onSave(episode)) : setMenu(null)} />}
      </>}
    </Sheet>
  </View>;
}
const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.ground }, circleAction: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.hairlineStrong }, action: { height: 44, paddingHorizontal: 16 },
  back: { position: 'absolute', left: 14, borderRadius: radius.pill, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.hairlineStrong, zIndex: 20 },
  ratings: { marginTop: 26, paddingLeft: 12, borderLeftWidth: 1, borderColor: colors.hairlineStrong }, score: { color: colors.text, fontSize: 22, fontFamily: fonts.medium },
  episodeEntry: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 }, episodeRow: { flex: 1, flexDirection: 'row', gap: 14, alignItems: 'center' }, episodeStill: { width: 128, height: 76, borderRadius: radius.poster },
  episodeCode: { position: 'absolute', bottom: 8, left: 8, color: colors.text, fontSize: 10, fontFamily: fonts.mono }, episodeProgress: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  castGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, castMember: { width: '30%', maxWidth: 150 },
});
