import { useEffect, useState } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FocusInput as TextInput, FocusPressable as Pressable, isAndroidTv } from '../components/TvFocus';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { File } from 'expo-file-system';
import { request, type Item, type Library, type ListChange, type Metadata, type ScheduledEpisode } from '../lib/server';
import { seasonLabel, seasonNumbers, seasonOf } from '../../../../packages/core/client/watch-progress.js';
import { episodeName, formatTime, metadataFor, nameFor, resumeItem, titleKey } from '../../../../packages/core/client/library';
import { listChoices } from '../../../../packages/core/client/title-shelves.js';
import { cleanEpisodeName, plural, runtimeText } from '../lib/text';
import { Chip, Icon, IconButton, MediaArt, Pill, ProgressBar, Row, Sheet, styles as t } from '../components/Matro';
import type { ArtProps } from '../components/LibraryParts';
import { SmartKeep } from '../components/SmartSaves';
import type { SmartRule } from '../lib/smart-plan';
import { TopFade } from '../components/Shell';
import { Backdrop, Glass, GlassScope } from '../components/Glass';
import { MetadataSheet, SubtitleSheet } from '../components/TitleSheets';
import { colors, fonts, overArt, radius, themed } from '../theme';

type Props = ArtProps & {
  data: Library; items: Item[]; onBack: () => void; onPlay: (item: Item, start?: number) => void; onEnqueue: (items: Item[]) => void;
  /** Marks every item watched (done) or unwatched; items already in that state are skipped. */
  onMark: (items: Item[], done: boolean) => void;
  /** Present when the server can be reached: subtitle upload for everyone, TMDB fixes for the head account when the server has TMDB. */
  online?: { admin: boolean; tmdb: boolean; notify: (text: string) => void; onMetadata: (metadata: Record<string, Metadata>) => void };
  onDevices?: (item: Item) => void;
  onEditLists?: (change: ListChange) => Promise<void>;
  onFollow?: (groupId: string, follow: boolean) => Promise<void>;
  onSearchEpisode?: (item: Item, episode: ScheduledEpisode) => void;
  smart?: { rule?: SmartRule; onChange: (rule: SmartRule | null) => void };
  onSave?: (item: Item) => void; onSaveMany?: (items: Item[]) => void; onRemoveSaved?: (items: Item[]) => void; savedIds?: Set<string>; savingIds?: Set<string>;
};
type Menu = null | 'save' | 'watched' | 'metadata' | 'lists' | 'schedule' | { episode: Item };

export default function TitleScreen({ data, items, onBack, onPlay, onEnqueue, onMark, onDevices, online, onEditLists, onFollow, onSearchEpisode, onSave, onSaveMany, onRemoveSaved, savedIds, savingIds, smart, ...art }: Props) {
  const item = items[0], m = metadataFor(data, item), target = resumeItem(data, items), p = data.progress[target.id], name = nameFor(data, item);
  const insets = useSafeAreaInsets(), seasons = seasonNumbers(items);
  const [season, setSeason] = useState(seasonOf(target)), [menu, setMenu] = useState<Menu>(null), [scrolled, setScrolled] = useState(false), [picked, setPicked] = useState<{ item: Item; file: File } | null>(null);
  const editions = item.editionGroup && items.length > 1;
  const [listName, setListName] = useState(''), [editingList, setEditingList] = useState(false), [listError, setListError] = useState('');
  const titleId = titleKey(item);
  const editList = async (change: ListChange) => {
    if (editingList || !onEditLists) return;
    setEditingList(true); setListError('');
    try { await onEditLists(change); if (change.action === 'create') setListName(''); }
    catch (error) { setListError(error instanceof Error ? error.message : 'Could not update the list.'); }
    finally { setEditingList(false); }
  };
  const groupId = titleId, following = data.followed?.includes(groupId) === true;
  const [scheduled, setScheduled] = useState<ScheduledEpisode[] | null>(null), [scheduleError, setScheduleError] = useState(''), [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState('');
  useEffect(() => {
    if (menu !== 'schedule' || !following) return;
    let live = true;
    setScheduled(null); setScheduleError('');
    void request(art.base, '/api/follows/' + encodeURIComponent(groupId) + '/episodes', {}, 120000)
      .then(({ episodes }) => { if (live) setScheduled(episodes); })
      .catch(error => { if (live) setScheduleError(error.message); });
    return () => { live = false; };
  }, [art.base, groupId, menu, following]);
  const toggleFollow = async () => {
    if (!onFollow || followBusy) return;
    setFollowBusy(true); setFollowError('');
    try { await onFollow(groupId, !following); if (!following) setMenu('schedule'); }
    catch (error) { setFollowError(error instanceof Error ? error.message : 'Could not update followed shows.'); }
    finally { setFollowBusy(false); }
  };
  const resume = p?.position > 0 && !p.completed, show = item.kind === 'show';
  const done = (list: Item[]) => list.length > 0 && list.every(i => data.progress[i.id]?.completed);
  const inSeason = items.filter(i => seasonOf(i) === season);
  // From the episode Play would start now to the end of its season.
  const rest = items.filter(i => seasonOf(i) === seasonOf(target) && (i.episode || 0) >= (target.episode || 0));
  const facts = [m.year, m.genres?.slice(0, 3).join(' · '), show ? `${plural(seasons.length, 'season')} · ${plural(items.length, 'episode')}` : m.runtime ? runtimeText(m.runtime) : '', item.format].filter(Boolean).join(' · ');
  const state = (id: string) => savedIds?.has(id) ? 'saved' : savingIds?.has(id) ? 'saving' : 'idle';
  const saveLabel = (id: string) => ({ saved: 'Saved offline', saving: 'Saving…', idle: 'Save offline' })[state(id)];
  const close = (run: () => void) => { setMenu(null); run(); };
  const pickSubtitles = async (target: Item) => {
    try {
      const result = await File.pickFileAsync({ mimeTypes: ['*/*'] });
      if (!result.canceled) setPicked({ item: target, file: result.result });
    } catch { online?.notify('Couldn’t open the file picker.'); }
  };
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
        <Pill preferredFocus={isAndroidTv} label={resume ? `Resume  ${formatTime(p.position)}` : 'Play now'} icon="play" primary onPress={() => onPlay(target)} style={{ flex: 1 }} />
        {resume && <View style={s.circleAction}><IconButton name="restart" label="Play from start" size={50} onPress={() => onPlay(target, 0)} /></View>}
      </View>
      <View style={[t.row, { marginTop: 10, flexWrap: 'wrap' }]}>
        <Pill label="Add to queue" icon="plus" style={s.action} onPress={() => onEnqueue(show ? items : [target])} />
        {onEditLists && <Pill label="Add to list" icon="plus" style={s.action} onPress={() => { setListError(''); setMenu('lists'); }} />}
        {show && onFollow && <Pill label={following ? 'Unfollow show' : 'Follow show'} icon={following ? 'check' : 'plus'} style={s.action} disabled={followBusy} onPress={() => void toggleFollow()} />}
        {show && following && onFollow && <Pill label="Episode schedule" style={s.action} onPress={() => setMenu('schedule')} />}
        {show ? <Pill label="Mark watched" icon="check" style={s.action} onPress={() => setMenu('watched')} />
          : <Pill label={done([target]) ? 'Mark unwatched' : 'Mark watched'} icon="check" style={s.action} onPress={() => onMark([target], !done([target]))} />}
        {onSave && (show ? onSaveMany && <Pill label="Save offline" icon="download" style={s.action} onPress={() => setMenu('save')} />
          : <Pill label={saveLabel(target.id)} icon={state(target.id) === 'saved' ? 'check' : 'download'} style={s.action} disabled={state(target.id) !== 'idle'} onPress={() => onSave(target)} />)}
        {online && !show && <Pill label="Add subtitles" icon="plus" style={s.action} onPress={() => void pickSubtitles(target)} />}
        {online?.admin && online.tmdb && <Pill label="Fix metadata" icon="search" style={s.action} onPress={() => setMenu('metadata')} />}
        {onRemoveSaved && <Pill label="Remove from this device" icon="trash" style={s.action} onPress={() => onRemoveSaved(items)} />}
      </View>
      {followError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={t.muted}>{followError}</Text> : null}
      {m.rating ? <View style={s.ratings}><Text style={[t.mono, { marginBottom: 6 }]}>TMDB</Text><View style={[t.row, { alignItems: 'baseline', gap: 5 }]}><Text style={s.score}>{m.rating.toFixed(1)}</Text><Text style={t.dim}>/10{m.votes ? ` · ${m.votes.toLocaleString()} votes` : ''}</Text></View></View> : null}
      {show && <View style={{ marginTop: 28 }}><View style={t.sectionHeading}><Text accessibilityRole="header" style={t.sectionTitle}>Episodes</Text><Text style={t.dim}>{items.filter(i => data.progress[i.id]?.completed).length} / {items.length} watched</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 18, paddingBottom: 14 }}>{seasons.map(value => <Chip key={value} small label={seasonLabel(value)} selected={season === value} onPress={() => setSeason(value)} />)}</ScrollView></View>}
    </View>
    {onDevices && <View style={{ alignSelf: 'flex-start', marginTop: 12 }}><Pill label="Play on device" icon="network" onPress={() => onDevices(target)} /></View>}
    {editions && <View style={{ marginTop: 24, gap: 8 }}>
      <Text accessibilityRole="header" style={t.sectionTitle}>Editions</Text>
      {items.map(edition => {
        const progress = data.progress[edition.id], bytes = edition.size;
        const size = bytes ? bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + ' GB' : Math.ceil(bytes / 1e6) + ' MB' : null;
        const position = progress?.position > 0 && !progress.completed ? 'Resume at ' + formatTime(progress.position) : null;
        const label = [edition.editionLabel || edition.title, edition.format, size, position].filter(Boolean).join(' · ');
        return <Pill key={edition.id} label={label} icon="play" onPress={() => onPlay(edition)} />;
      })}
    </View>}
  </View>;
  const footer = <View style={{ gap: 28, marginTop: 28 }}>
    {!!m.cast?.length && <View><Text style={[t.sectionTitle, { marginBottom: 18 }]}>Cast</Text><View style={s.castGrid}>{m.cast.map(person => <View key={person.name} style={s.castMember}><MediaArt {...art} path={person.photo} title={person.name} style={{ width: '100%', aspectRatio: 2 / 3, borderRadius: radius.poster }} /><Text numberOfLines={2} style={[t.text, { fontSize: 12.5, fontFamily: fonts.medium, marginTop: 8 }]}>{person.name}</Text><Text numberOfLines={2} style={[t.dim, { fontSize: 11, marginTop: 3 }]}>{person.role}</Text></View>)}</View></View>}
    <View><Text style={[t.sectionTitle, { marginBottom: 18 }]}>File</Text><View style={[t.row, { gap: 40, alignItems: 'flex-start' }]}><View><Text style={t.dim}>Format</Text><Text style={[t.text, { fontFamily: fonts.medium, marginTop: 6 }]}>{item.format}</Text><Text style={[t.dim, { marginTop: 4 }]}>{show ? 'Series' : 'Movie'}</Text></View><View style={{ flex: 1 }}><Text style={t.dim}>Source</Text><Text style={[t.text, { fontFamily: fonts.medium, marginTop: 6 }]} numberOfLines={2}>{item.root?.split(/[\\/]/).filter(Boolean).pop() || 'Library'}</Text><Text style={[t.dim, { marginTop: 4 }]}>Matro server</Text></View></View></View>
  </View>;
  const episode = menu && typeof menu === 'object' ? menu.episode : null;
  // Episodes before the chosen one that are not watched yet (items are in play order).
  const earlier = episode ? items.slice(0, items.indexOf(episode)).filter(i => !data.progress[i.id]?.completed) : [];
  return <GlassScope><View style={s.fill}>
    <Backdrop style={s.fill}><FlatList removeClippedSubviews={isAndroidTv ? false : undefined} data={show ? inSeason : []} keyExtractor={i => i.id} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }} ListHeaderComponent={header} ListFooterComponent={footer} showsVerticalScrollIndicator={false}
      scrollEventThrottle={64} onScroll={e => { const far = e.nativeEvent.contentOffset.y > 160; if (far !== scrolled) setScrolled(far); }}
      renderItem={({ item: ep }) => {
        const e = metadataFor(data, ep).episodes?.[String(ep.season)]?.[String(ep.episode)], progress = data.progress[ep.id], watched = progress?.completed, label = episodeTitle(ep);
        return <View style={s.episodeEntry}>
          <Pressable onPress={() => onPlay(ep)} onLongPress={() => setMenu({ episode: ep })} accessibilityLabel={`Play ${label}`} accessibilityHint="Long press for more actions" style={s.episodeRow}>
            <MediaArt {...art} quiet path={e?.still} title={name} style={s.episodeStill}><LinearGradient colors={[colors.clear, overArt.shade]} style={StyleSheet.absoluteFill} /><Text style={s.episodeCode}>S{ep.season} E{ep.episode}</Text>{progress?.duration > 0 && !watched && <View style={s.episodeProgress}><ProgressBar onArt value={progress.position / progress.duration} /></View>}</MediaArt>
            <View style={{ flex: 1, gap: 4 }}><Text style={[t.text, { fontFamily: fonts.medium, lineHeight: 20 }, watched && { color: colors.dim }]} numberOfLines={2}>{ep.episode}. {label}</Text><Text style={[t.dim, { fontSize: 11 }]}>{[e?.runtime ? e.runtime + 'm' : '', watched ? 'Watched' : progress?.position ? formatTime(progress.position) + ' watched' : '', state(ep.id) === 'saved' ? 'Saved offline' : state(ep.id) === 'saving' ? 'Saving…' : ''].filter(Boolean).join(' · ')}</Text>{e?.overview && <Text numberOfLines={2} style={[t.dim, { fontSize: 11, lineHeight: 17 }]}>{e.overview}</Text>}</View>
          </Pressable>
          <IconButton name="more" label={`More actions for ${label}`} onPress={() => setMenu({ episode: ep })} />
        </View>;
      }} />
    {scrolled && <TopFade />}</Backdrop>
    <Glass style={[s.back, { top: insets.top + 12 }]}><IconButton name="back" label="Close details" onPress={onBack} /></Glass>
    <Sheet visible={menu === 'lists'} onClose={() => setMenu(null)} title="Add to list">
      {listChoices(data.lists).map(list => {
        const added = list.titles.includes(titleId);
        return <View key={list.id} style={t.row}>
          <View style={{ flex: 1 }}><Row icon={added ? 'check' : 'plus'} label={list.name} detail={added ? 'Added · tap to remove' : undefined}
            onPress={() => void editList({ action: 'set', listId: list.id, titleId, present: !added })} /></View>
          {list.id !== 'watch-later' && <IconButton name="trash" label={`Delete ${list.name}`} onPress={() => Alert.alert('Delete list?', list.name, [
            { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void editList({ action: 'delete', listId: list.id }) },
          ])} />}
        </View>;
      })}
      <TextInput accessibilityLabel="New list" placeholder="New list" placeholderTextColor={colors.dim} maxLength={60}
        value={listName} onChangeText={setListName} style={s.listInput} />
      <Pill label="Create and add" disabled={!listName.trim() || editingList} onPress={() => void editList({ action: 'create', name: listName, titleId })} />
      {listError ? <Text accessibilityLiveRegion="polite" style={t.muted}>{listError}</Text> : null}
    </Sheet>
    <Sheet visible={menu === 'schedule'} onClose={() => setMenu(null)} title="Episode schedule">
      {scheduled?.length ? (['upcoming', 'missing'] as const).map(status => {
        const episodes = scheduled.filter(episode => episode.status === status);
        return episodes.length ? <View key={status}>
          <Text accessibilityRole="header" style={[t.sectionTitle, { marginTop: 12 }]}>{status === 'upcoming' ? 'Upcoming' : 'Missing'}</Text>
          {episodes.map(episode => <View key={episode.season + ':' + episode.episode} style={{ paddingVertical: 8, gap: 4 }}>
            <Text style={t.text}>S{episode.season} E{episode.episode} {episode.title}</Text>
            <Text style={t.dim}>{episode.airDate}</Text>
            {status === 'missing' && onSearchEpisode && <Pill label="Search releases" onPress={() => close(() => onSearchEpisode(item, episode))} />}
          </View>)}
        </View> : null;
      }) : <Text accessibilityLiveRegion="polite" style={t.muted}>{scheduleError || (scheduled ? 'No missing or upcoming episodes with announced dates.' : 'Loading episode schedule…')}</Text>}
    </Sheet>
    <Sheet visible={menu === 'watched'} onClose={() => setMenu(null)} title="Mark as watched">
      <Row icon="check" label={done(inSeason) ? `${seasonLabel(season)} as unwatched` : seasonLabel(season)} detail={plural(inSeason.length, 'episode')} onPress={() => close(() => onMark(inSeason, !done(inSeason)))} />
      <Row icon="check" label={done(items) ? 'Whole show as unwatched' : 'Whole show'} detail={plural(items.length, 'episode')} last onPress={() => close(() => onMark(items, !done(items)))} />
    </Sheet>
    <Sheet visible={menu === 'save'} onClose={() => setMenu(null)} title="Save offline">
      {smart && <SmartKeep rule={smart.rule} onChange={smart.onChange} />}
      <Row icon="download" label={seasonLabel(season)} detail={`${plural(inSeason.length, 'episode')} · saved two at a time`} last={rest.length <= 1} onPress={() => close(() => onSaveMany?.(inSeason))} />
      {rest.length > 1 && <Row icon="download" label={`From S${seasonOf(target)} E${target.episode} to season end`} detail={plural(rest.length, 'episode')} last onPress={() => close(() => onSaveMany?.(rest))} />}
    </Sheet>
    {online && <SubtitleSheet base={art.base} picked={picked} onClose={() => setPicked(null)} onDone={online.notify} />}
    {online?.admin && online.tmdb && <MetadataSheet {...art} visible={menu === 'metadata'} items={items} name={name} onClose={() => setMenu(null)} onChanged={(metadata, message) => { online.onMetadata(metadata); online.notify(message); }} />}
    <Sheet visible={!!episode} onClose={() => setMenu(null)} title={episode ? `${episode.episode}. ${episodeTitle(episode)}` : 'Episode'}>
      {episode && <>
        <Row icon="play" label="Play" onPress={() => close(() => onPlay(episode))} />
        <Row icon="check" label={data.progress[episode.id]?.completed ? 'Mark unwatched' : 'Mark watched'} onPress={() => close(() => onMark([episode], !data.progress[episode.id]?.completed))} />
        {earlier.length > 0 && <Row icon="check" label="Mark earlier episodes watched" detail={plural(earlier.length, 'episode')} onPress={() => close(() => onMark(earlier, true))} />}
        <Row icon="plus" label="Add to queue" onPress={() => close(() => onEnqueue([episode]))} />
        {online && <Row icon="plus" label="Add subtitles" last={!onSave} onPress={() => close(() => void pickSubtitles(episode))} />}
        {onSave && <Row icon={state(episode.id) === 'saved' ? 'check' : 'download'} label={saveLabel(episode.id)} last onPress={() => state(episode.id) === 'idle' ? close(() => onSave(episode)) : setMenu(null)} />}
      </>}
    </Sheet>
  </View></GlassScope>;
}
const s = themed(() => StyleSheet.create({
  listInput: { minHeight: 44, color: colors.text, borderColor: colors.hairlineStrong, borderWidth: 1, borderRadius: radius.poster, paddingHorizontal: 12, marginVertical: 12 },
  fill: { flex: 1, backgroundColor: colors.ground }, circleAction: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.hairlineStrong }, action: { height: 44, paddingHorizontal: 16 },
  back: { position: 'absolute', left: 14, borderRadius: radius.pill, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.hairlineStrong, zIndex: 20 },
  ratings: { marginTop: 26, paddingLeft: 12, borderLeftWidth: 1, borderColor: colors.hairlineStrong }, score: { color: colors.text, fontSize: 22, fontFamily: fonts.medium },
  episodeEntry: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 }, episodeRow: { flex: 1, flexDirection: 'row', gap: 14, alignItems: 'center' }, episodeStill: { width: 128, height: 76, borderRadius: radius.poster },
  episodeCode: { position: 'absolute', bottom: 8, left: 8, color: overArt.text, fontSize: 10, fontFamily: fonts.mono }, episodeProgress: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  castGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, castMember: { width: '30%', maxWidth: 150 },
}));
