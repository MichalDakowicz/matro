import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, FlatList, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { library, mediaHeaders, request, ServerError, type Item, type Library, type Progress } from '../lib/server';
import { continueItems, groupLibrary, metadataFor, nameFor, statusOf, titleKey } from '../../../../packages/core/client/library';
import { colors, fonts } from '../theme';
import { Icon, Pill, styles as t } from '../components/Matro';
import { AccountSheet, ContinueRow, Corner, Dock, FeaturedReel, PosterCard } from '../components/LibraryParts';
import NativePlayer from './NativePlayer';
import TitleScreen from './TitleScreen';
import DownloadsScreen from './DownloadsScreen';
import FoldersScreen from './FoldersScreen';

type Props = { base: string; onSignedOut: () => void; onChangeServer: () => void };
const kinds = [{ kind: 'show', title: 'Shows', noun: 'shows' }, { kind: 'movie', title: 'Movies', noun: 'titles' }, { kind: 'audio', title: 'Music & audio', noun: 'files' }];
export default function ViewerScreen({ base, onSignedOut, onChangeServer }: Props) {
  const [data, setData] = useState<Library | null>(null), [headers, setHeaders] = useState<Record<string, string>>({});
  const [error, setError] = useState(''), [query, setQuery] = useState(''), [tab, setTab] = useState('home'), [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null), [playing, setPlaying] = useState<{ item: Item; start?: number; queue: Item[] } | null>(null);
  const [refreshing, setRefreshing] = useState(false), [account, setAccount] = useState(false), [folder, setFolder] = useState<string | null>(null);
  const { width } = useWindowDimensions(), insets = useSafeAreaInsets(), columns = Math.max(3, Math.floor((width - 24) / 108)), cardWidth = (width - 36 - (columns - 1) * 12) / columns;
  const load = useCallback(async () => {
    setRefreshing(true); setError('');
    try { const next = await library(base); const auth = await mediaHeaders(base); setData(next); setHeaders(auth); }
    catch (e) { if (e instanceof ServerError && e.status === 401) onSignedOut(); else setError(e instanceof Error ? e.message : 'Could not load the library.'); }
    finally { setRefreshing(false); }
  }, [base, onSignedOut]);
  useEffect(() => { void load(); }, [base]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (playing) return false;
      if (selected) { setSelected(null); return true; }
      if (folder || tab !== 'home') { setFolder(null); setTab('home'); return true; }
      return false;
    }); return () => sub.remove();
  }, [playing, selected, tab, folder, load]);
  const allGroups = useMemo(() => groupLibrary(data?.items || []), [data?.items]);
  const groups = useMemo(() => allGroups.filter(items => !folder || items[0].root === folder), [allGroups, folder]);
  const featured = useMemo(() => data ? [...allGroups].filter(items => items[0].kind !== 'audio').sort((a, b) => {
    const recent = (items: Item[]) => Math.max(0, ...items.map(i => data.progress[i.id]?.hidden ? 0 : data.progress[i.id]?.updated || 0));
    return recent(b) - recent(a) || (b[0].added || 0) - (a[0].added || 0);
  }) : [], [allGroups, data?.progress]);
  const continues = useMemo(() => data ? continueItems(data, allGroups) : [], [data, allGroups]);
  const detail = allGroups.find(items => titleKey(items[0]) === selected);
  const art = { base, headers };
  const updateProgress = async (patch: Record<string, Progress>) => {
    if (!data) return;
    setData({ ...data, progress: { ...data.progress, ...patch } });
    try { await request(base, '/api/state', { method: 'PUT', body: { progress: patch } }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save progress.'); }
  };
  const complete = (item: Item) => { if (data) void updateProgress({ [item.id]: { ...(data.progress[item.id] || { position: 0, duration: 0, updated: 0 }), completed: !data.progress[item.id]?.completed, hidden: false, updated: Date.now() } }); };
  const removeContinue = (item: Item) => {
    if (!data) return;
    const siblings = allGroups.find(items => items.some(i => i.id === item.id)) || [item];
    void updateProgress(Object.fromEntries(siblings.filter(i => data.progress[i.id]).map(i => [i.id, { ...data.progress[i.id], hidden: true, updated: Date.now() }])));
  };
  const enqueue = (items: Item[]) => {
    if (!data) return;
    const queue = [...new Set([...data.queue, ...items.map(i => i.id)])]; setData({ ...data, queue });
    void request(base, '/api/state', { method: 'PUT', body: { queue } }).catch(e => setError(e.message));
  };
  const play = (item: Item, start?: number) => {
    if (!data) return;
    const siblings = allGroups.find(items => items.some(i => i.id === item.id)) || [item];
    const queue = item.kind === 'show' ? siblings : data.queue.includes(item.id) ? data.queue.flatMap(id => data.items.find(i => i.id === id) || []) : [item];
    setPlaying({ item, start, queue });
    void request(base, '/api/state', { method: 'PUT', body: { queue: queue.map(i => i.id) } }).catch(e => setError(e.message));
  };
  const changeTab = (value: string) => { setTab(value); setSelected(null); setFolder(null); setFilter('all'); };
  if (playing && data) return <NativePlayer key={`${playing.item.id}:${playing.start ?? 'resume'}`} {...art} item={playing.item} data={data} initialPosition={playing.start} queue={playing.queue}
    onBack={() => { setPlaying(null); void load(); }} onSelect={item => setPlaying({ item, queue: playing.queue })} onNext={() => {
      const next = playing.queue[playing.queue.findIndex(i => i.id === playing.item.id) + 1];
      if (next && data.preferences.autoplay !== false) setPlaying({ item: next, queue: playing.queue });
      else { setPlaying(null); void load(); }
    }} />;
  if (detail && data) return <TitleScreen key={selected} {...art} data={data} items={detail} onBack={() => setSelected(null)} onPlay={play} onComplete={complete} onEnqueue={enqueue} />;
  const contentStyle = { paddingTop: insets.top + 76, paddingBottom: insets.bottom + 104, paddingHorizontal: 18 };
  const search = tab === 'search';
  const matches = (items: Item[]) => !search || `${nameFor(data!, items[0])} ${metadataFor(data!, items[0]).people?.join(' ')} ${items.map(i => i.title + ' ' + i.path).join(' ')}`.toLowerCase().includes(query.toLowerCase().trim());
  const sections = data ? kinds.map(kind => {
    const found = groups.filter(items => items[0].kind === kind.kind && matches(items));
    return { ...kind, total: found.length, data: Array.from({ length: Math.ceil(found.length / columns) }, (_, i) => found.slice(i * columns, (i + 1) * columns)) };
  }).filter(section => section.total) : [];
  const header = data ? <>
    {folder ? <View style={{ marginBottom: 22 }}><Text style={t.heading}>{folder.split(/[\\/]/).filter(Boolean).pop()}</Text><Pressable onPress={() => { setFolder(null); setTab('folders'); }}><Text style={[t.muted, { marginTop: 10 }]}>Show all folders</Text></Pressable></View> : null}
    {search ? <View style={{ marginBottom: 28 }}><Text style={[t.dim, { marginBottom: 12 }]}>Search movies, shows, people and file names</Text><View style={s.search}><Icon name="search" /><TextInput autoFocus value={query} onChangeText={setQuery} accessibilityLabel="Search library" placeholder="Try a title or a file name" placeholderTextColor={colors.dim} style={s.searchInput} returnKeyType="search" clearButtonMode="while-editing" /></View><Text style={[t.dim, { marginTop: 12 }]}>{query ? `${sections.reduce((sum, section) => sum + section.total, 0)} results across ${data.items.length} files` : 'Searching your whole library — titles, people and file names'}</Text></View> : null}
    {tab === 'home' && !folder && <><ContinueRow {...art} data={data} items={continues} onPlay={play} onRemove={removeContinue} /><FeaturedReel key={`${base}:${featured.length}`} {...art} data={data} groups={featured} onPlay={play} onDetail={item => setSelected(titleKey(item))} /></>}
    {!data.items.length && <View style={{ minHeight: 500, justifyContent: 'center', gap: 18 }}><Text style={t.dim}>Matro · your library</Text><Text style={[t.heading, { fontSize: 38, lineHeight: 40 }]}>Your collection.{"\n"}Your kind of player.</Text><Text style={t.muted}>All your films, shows and favourite files in one quiet place. Add a folder on your server to build your library.</Text>{data.user.role === 'admin' && <Pill label="Add folder" icon="folder" onPress={() => changeTab('folders')} primary />}</View>}
  </> : null;
  const browse = data && ['movie', 'show', 'audio'].includes(tab), allBrowse = browse ? groups.filter(items => items[0].kind === tab) : [];
  const browseItems = browse ? allBrowse.filter(items => filter === 'all' || statusOf(data!, items) === filter) : [];
  return <View style={s.fill}>
    {!data ? <View style={[s.center, { padding: 24 }]}>{refreshing ? <ActivityIndicator color={colors.text} /> : <><Text style={t.heading}>Your library</Text><Text style={[t.muted, { marginVertical: 16 }]}>{error || 'Could not load your library.'}</Text><Pill label="Try again" onPress={() => void load()} /></>}</View> : tab === 'downloads' ? <View style={{ flex: 1, paddingTop: insets.top + 76 }}><DownloadsScreen {...art} /></View> : tab === 'folders' ? <View style={{ flex: 1, paddingTop: insets.top + 76 }}><FoldersScreen base={base} data={data} onRefresh={load} onBrowse={path => { setFolder(path); setTab('home'); }} /></View> : browse ? <FlatList key={`${tab}:${columns}`} data={browseItems} numColumns={columns} keyExtractor={items => titleKey(items[0])} contentContainerStyle={contentStyle} columnWrapperStyle={{ gap: 12 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.text} />}
      ListHeaderComponent={<View style={{ marginBottom: 22 }}><Text style={t.heading}>{kinds.find(kind => kind.kind === tab)?.title}</Text><Text style={[t.muted, { marginTop: 8 }]}>{allBrowse.length} {tab === 'show' ? 'shows' : 'titles'}</Text><View style={[t.row, { flexWrap: 'wrap', marginTop: 18, gap: 7 }]}>{[['all', 'All'], ['new', 'Unwatched'], ['progress', 'In progress'], ['done', 'Watched']].map(([value, label]) => <Pill key={value} label={label} compact style={filter === value ? { backgroundColor: '#ffffff18' } : undefined} onPress={() => setFilter(value)} />)}</View></View>}
      ListEmptyComponent={<Text style={t.muted}>No titles match this filter.</Text>} renderItem={({ item: items }) => <PosterCard {...art} data={data} items={items} width={cardWidth} onPress={() => setSelected(titleKey(items[0]))} />} /> : <SectionList sections={sections} keyExtractor={(row, index) => row[0][0].id + ':' + index} stickySectionHeadersEnabled={false} contentContainerStyle={contentStyle} showsVerticalScrollIndicator={false} initialNumToRender={5} windowSize={5} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.text} />} ListHeaderComponent={header}
      renderSectionHeader={({ section }) => <View style={[t.sectionHeading, { marginTop: 8 }]}><Text style={t.sectionTitle}>{section.title}</Text><Pressable onPress={() => changeTab(section.kind)}><Text style={t.dim}>{section.total} {section.noun}{search ? '' : ' · See all'}</Text></Pressable></View>}
      renderItem={({ item: row }) => <View style={{ flexDirection: 'row', gap: 12 }}>{row.map(items => <PosterCard key={titleKey(items[0])} {...art} data={data} items={items} width={cardWidth} onPress={() => setSelected(titleKey(items[0]))} />)}</View>}
      ListFooterComponent={search && !sections.length ? <Text style={t.muted}>No matches. Check the spelling, or try part of a title or file name.</Text> : <View style={{ height: 12 }} />} />}
    {data && error ? <Pressable onPress={() => setError('')} style={[s.toast, { bottom: insets.bottom + 86 }]}><Text style={t.text}>{error}</Text></Pressable> : null}
    <Corner username={data?.user.username} onHome={() => changeTab('home')} onProfile={() => setAccount(true)} onHelp={() => Alert.alert('Matro', `${data?.items.length || 0} files in your library.\n\nMetadata and artwork from TMDB.\n\nMovies are prepared on your Matro server and played natively on this device.`, [{ text: 'Refresh', onPress: () => void load() }, { text: 'Close' }])} />
    <Dock tab={tab} onChange={changeTab} audio={!!data?.items.some(i => i.kind === 'audio')} admin={data?.user.role === 'admin'} />
    <AccountSheet visible={account} onClose={() => setAccount(false)} data={data} base={base} onRefresh={() => void load()} onServer={onChangeServer} onSignOut={onSignedOut} />
  </View>;
}
const s = StyleSheet.create({ fill: { flex: 1, backgroundColor: colors.ground }, center: { flex: 1, justifyContent: 'center' }, search: { height: 54, borderRadius: 999, borderWidth: 1, borderColor: '#ffffff24', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12, backgroundColor: '#ffffff05' }, searchInput: { flex: 1, color: colors.text, fontSize: 17, fontFamily: fonts.regular, paddingVertical: 0 }, toast: { position: 'absolute', left: 18, right: 18, padding: 16, borderRadius: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.hairline, zIndex: 40 } });
