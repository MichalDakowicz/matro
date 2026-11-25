import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, FlatList, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { changeProgress, inspect, library, mediaHeaders, request, ServerError, type Item, type Library, type MovieRequest, type ScannerStatus } from '../lib/server';
import { progressRecovery, recoveryScope } from '../lib/storage';
import { continueItems, groupLibrary, metadataFor, nameFor, savedServes, statusOf, titleKey, trackKey } from '../../../../packages/core/client/library';
import { dismissedProgress, normalizeProgress } from '../../../../packages/core/client/watch-progress.js';
import { colors, fonts } from '../theme';
import { Icon, Pill, styles as t } from '../components/Matro';
import { AccountSheet, ContinueRow, Corner, Dock, FeaturedReel, PosterCard } from '../components/LibraryParts';
import NativePlayer from './NativePlayer';
import TitleScreen from './TitleScreen';
import DownloadsScreen from './DownloadsScreen';
import FoldersScreen from './FoldersScreen';
import OfflineScreen from './OfflineScreen';
import MovieRequestsScreen from './MovieRequestsScreen';
import { useMovieRequestAlerts } from '../lib/movie-request-alerts';
import { isSaved, offlineLibrary, rememberLibrary, removeOffline, resumeInterrupted, retryInterrupted, savedTitle, savedTitles, saveOffline, saveOfflineBatch, watchOffline, type SavedMedia } from '../lib/offline';

type Props = { base: string; onSignedOut: () => void; onChangeServer: () => void };
const kinds = [{ kind: 'show', title: 'Shows', noun: 'shows' }, { kind: 'movie', title: 'Movies', noun: 'titles' }];
export default function ViewerScreen({ base, onSignedOut, onChangeServer }: Props) {
  const [data, setData] = useState<(Library & { catalogIds?: string[] }) | null>(null), [headers, setHeaders] = useState<Record<string, string>>({});
  const dataRef = useRef(data); dataRef.current = data;
  const [error, setError] = useState(''), [query, setQuery] = useState(''), [tab, setTab] = useState('home'), [filter, setFilter] = useState('all');
  const [requestSearch, setRequestSearch] = useState<MovieRequest | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [playing, setPlaying] = useState<{ item: Item; start?: number; queue: Item[]; saved?: SavedMedia } | null>(null);
  const [offline, setOffline] = useState(false), playRun = useRef(0);
  const [refreshing, setRefreshing] = useState(false), [account, setAccount] = useState(false), [folder, setFolder] = useState<string | null>(null);
  const revision = useRef<string | undefined>(undefined), loadRun = useRef(0);
  const alerts = useMovieRequestAlerts(base, !offline && data?.user.role === 'admin' && data.movieRequestPushEnabled === true);
  const openedAlerts = useRef(0);
  const { width } = useWindowDimensions(), insets = useSafeAreaInsets(), columns = Math.max(3, Math.floor((width - 24) / 108)), cardWidth = (width - 36 - (columns - 1) * 12) / columns;
  const load = useCallback(async () => {
    const run = ++loadRun.current;
    setRefreshing(true); setError('');
    try {
      const next = await library(base), auth = await mediaHeaders(base);
      if (run !== loadRun.current) return;
      revision.current = next.catalogRevision;
      setData({ ...next, progress: normalizeProgress(next.progress) }); setHeaders(auth); setOffline(false);
      void rememberLibrary(base, next).catch(() => {});
    }
    catch (e) {
      if (run !== loadRun.current) return;
      if (e instanceof ServerError && [401, 403].includes(e.status || 0)) { onSignedOut(); return; }
      const cached = await offlineLibrary(base).catch(() => null);
      if (run !== loadRun.current) return;
      if (cached) { setData({ ...cached, progress: normalizeProgress(cached.progress) }); setHeaders({}); setOffline(true); }
      else setError(e instanceof Error ? e.message : 'Could not load the library.');
    }
    finally { if (run === loadRun.current) setRefreshing(false); }
  }, [base, onSignedOut]);
  useEffect(() => { revision.current = undefined; void load(); }, [base]);
  useEffect(() => {
    let closed = false, checking = false;
    const check = async () => {
      const before = revision.current;
      if (closed || checking || AppState.currentState !== 'active' || (!offline && !before)) return;
      checking = true;
      try {
        if (offline) {
          const status = await request(base, '/api/status');
          if (closed || typeof status?.setup !== 'boolean') return;
          if (status.user) await load();
          else onSignedOut();
          return;
        }
        const { catalogRevision } = await request(base, '/api/library/revision');
        if (closed || revision.current !== before) return;
        const user = dataRef.current?.user;
        if (user) void retryInterrupted(base, user)?.catch(() => {});
        if (catalogRevision === before) return;
        const next = await library(base);
        if (closed || revision.current !== before) return;
        revision.current = next.catalogRevision;
        void rememberLibrary(base, next).catch(() => {});
        setData(current => current && { ...current, items: next.items, folders: next.folders, metadata: next.metadata, scanner: next.scanner, catalogRevision: next.catalogRevision });
      } catch (error) {
        if (!closed && error instanceof ServerError && error.status === 401) onSignedOut();
      } finally { checking = false; }
    };
    const timer = setInterval(check, 5000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
    return () => { closed = true; clearInterval(timer); subscription.remove(); };
  }, [base, load, offline, onSignedOut]);
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
  const featured = useMemo(() => data ? [...allGroups].sort((a, b) => {
    const recent = (items: Item[]) => Math.max(0, ...items.map(i => data.progress[i.id]?.hidden ? 0 : data.progress[i.id]?.updated || 0));
    return recent(b) - recent(a) || (b[0].added || 0) - (a[0].added || 0);
  }) : [], [allGroups, data?.progress]);
  const continues = useMemo(() => data ? continueItems(data, allGroups) : [], [data, allGroups]);
  // Titles opened from the Saved tab show only the episodes that are on this device.
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set()), [savedOnly, setSavedOnly] = useState(false);
  useEffect(() => {
    if (!data) return;
    let run = 0;
    const refresh = () => {
      const current = ++run;
      void savedTitles(base, data.user).then(list => { if (current === run) setSavedIds(new Set(list.filter(isSaved).map(record => record.id))); }).catch(() => {});
    };
    refresh();
    const stop = watchOffline(refresh);
    return () => { run++; stop(); };
  }, [base, data?.user.id]);
  const found = allGroups.find(items => titleKey(items[0]) === selected);
  const detail = savedOnly ? found?.filter(item => savedIds.has(item.id)) : found;
  const art = { base, headers };
  const updateProgress = async (item: Item, dismiss: boolean) => {
    if (!data) return;
    const checkpoint = data.progress[item.id];
    try {
      if (offline) {
        const siblings = allGroups.find(items => titleKey(items[0]) === titleKey(item)) || [item];
        const duration = checkpoint?.duration || (await savedTitle(base, data.user, item.id))?.info.duration || 0;
        const patch = dismiss ? dismissedProgress(siblings, data.progress, data.progress, {})
          : { [item.id]: { ...checkpoint, position: checkpoint?.position || 0, duration, completed: !checkpoint?.completed, updated: Date.now() } };
        setData(latest => latest ? { ...latest, progress: { ...latest.progress, ...patch } } : latest);
        await Promise.all(Object.entries(patch).map(([id, entry]) => progressRecovery.write(recoveryScope(base, data.user), id, entry)));
        return;
      }
      const { progress } = await changeProgress(base, item.id, dismiss ? { dismiss: true } : { completed: !checkpoint?.completed, checkpoint });
      const current = dataRef.current;
      if (!current || current.user.id !== data.user.id) return;
      const resolved = normalizeProgress(progress);
      if (!dismiss && resolved[item.id].updated < (current.progress[item.id]?.updated || 0)) return;
      const siblings = allGroups.find(items => titleKey(items[0]) === titleKey(item)) || [item];
      const patch = dismiss ? dismissedProgress(siblings, data.progress, current.progress, resolved) : resolved;
      setData(latest => latest ? { ...latest, progress: { ...latest.progress, ...patch } } : latest);
      const scope = recoveryScope(base, data.user);
      await Promise.all(Object.entries(patch).map(([id, entry]) => progressRecovery.write(scope, id, entry)));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save progress.'); }
  };
  const complete = (item: Item) => void updateProgress(item, false);
  const removeContinue = (item: Item) => void updateProgress(item, true);
  const enqueue = (items: Item[]) => {
    if (!data) return;
    const queue = [...new Set([...data.queue, ...items.map(i => i.id)])]; setData({ ...data, queue });
    if (!offline) void request(base, '/api/state', { method: 'PUT', body: { queue } }).catch(e => setError(e.message));
  };
  const startPlayback = async (item: Item, queue: Item[], start?: number) => {
    if (!data) return;
    const run = ++playRun.current;
    let saved = await savedTitle(base, data.user, item.id).catch(() => undefined);
    // Online, the saved copy only has the first audio track and text subtitles: stream when the chosen tracks need more.
    if (saved && !offline) {
      const full = await inspect(base, item.id).catch(() => null);
      if (full && !savedServes(saved.info, full, data.preferences.tracks?.[trackKey(item)])) saved = undefined;
    }
    if (run !== playRun.current) return;
    if (offline && !saved) { setError('This title is not saved on this device.'); return; }
    setPlaying({ item, start, queue, saved });
  };
  const play = (item: Item, start?: number) => {
    if (!data) return;
    const siblings = allGroups.find(items => items.some(i => i.id === item.id)) || [item];
    const queue = item.kind === 'show' ? siblings : data.queue.includes(item.id) ? data.queue.flatMap(id => data.items.find(i => i.id === id) || []) : [item];
    void startPlayback(item, queue, start);
    if (!offline) void request(base, '/api/state', { method: 'PUT', body: { queue: queue.map(i => i.id) } }).catch(e => setError(e.message));
  };
  const saveName = (item: Item) => data && item.kind !== 'show' ? nameFor(data, item) : item.title;
  useEffect(() => {
    if (!data || offline) return;
    const resume = () => void resumeInterrupted(base, data.user).catch(() => {});
    resume();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') resume(); });
    return () => subscription.remove();
  }, [base, offline, data?.user.id, data?.user.username]);
  const save = (item: Item) => {
    if (!data || offline) return;
    void saveOffline(base, data.user, item, saveName(item))
      .then(() => Alert.alert('Save offline', 'Follow preparation and download progress under Saved.'))
      .catch(error => Alert.alert('Could not save title', error.message));
  };
  const saveMany = (list: Item[]) => {
    if (!data || offline || !list.length) return;
    void saveOfflineBatch(base, data.user, list, saveName)
      .then(() => Alert.alert('Saving offline', 'Matro prepares two titles at a time. Follow progress under Saved.'))
      .catch(error => Alert.alert('Could not save everything', error.message));
  };
  const removeSaved = (list: Item[]) => Alert.alert('Remove from this device?', 'The saved files are deleted. They stay in your library on the server.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => void Promise.all(list.map(item => removeOffline(base, data!.user, item.id))).then(() => { setSelected(null); setSavedOnly(false); }).catch(e => setError(e.message)) },
  ]);
  const changeTab = (value: string) => { setSavedOnly(false); setTab(value); setSelected(null); setFolder(null); setFilter('all'); setRequestSearch(null); };
  useEffect(() => {
    if (playing || !alerts.supported || alerts.opened === openedAlerts.current) return;
    openedAlerts.current = alerts.opened;
    setAccount(false);
    changeTab('movie-requests');
  }, [alerts.opened, alerts.supported, playing]);
  if (playing && data) return <NativePlayer key={`${playing.item.id}:${playing.start ?? 'resume'}`} {...art} item={playing.item} data={data} initialPosition={playing.start} queue={playing.queue}
    saved={playing.saved} offline={offline} onBack={() => { playRun.current++; setPlaying(null); void load(); }} onSelect={item => void startPlayback(item, playing.queue)} onNext={() => {
      const next = playing.queue[playing.queue.findIndex(i => i.id === playing.item.id) + 1];
      if (next && data.preferences.autoplay !== false) void startPlayback(next, playing.queue);
      else { setPlaying(null); void load(); }
    }} />;
  if (detail && data) return <TitleScreen key={selected} {...art} data={data} items={detail} onBack={() => setSelected(null)} onPlay={play} onComplete={complete} onEnqueue={enqueue} onSave={offline || savedOnly ? undefined : save} onSaveMany={offline || savedOnly ? undefined : saveMany} onRemoveSaved={savedOnly ? removeSaved : undefined} savedIds={savedIds} />;
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
  const browse = data && kinds.some(kind => kind.kind === tab), allBrowse = browse ? groups.filter(items => items[0].kind === tab) : [];
  const browseItems = browse ? allBrowse.filter(items => filter === 'all' || statusOf(data!, items) === filter) : [];
  return <View style={s.fill}>
    {tab === 'offline' && data ? <OfflineScreen {...art} data={data} offline={offline}
      onOpenTitle={items => { setSavedOnly(true); setSelected(titleKey(items[0])); }}
      onResume={id => { const item = data.items.find(item => item.id === id); if (item) save(item); }}
      onRemoved={() => { if (offline) void load(); }} /> :
    !data ? <View style={[s.center, { padding: 24 }]}>{refreshing ? <ActivityIndicator color={colors.text} /> : <><Text style={t.heading}>Your library</Text><Text style={[t.muted, { marginVertical: 16 }]}>{error || 'Could not load your library.'}</Text><Pill label="Try again" onPress={() => void load()} /></>}</View> :
    tab === 'movie-requests' && !offline && data.movieRequestsEnabled ? <View style={{ flex: 1, paddingTop: insets.top + 76 }}><MovieRequestsScreen key={alerts.opened} base={base} admin={data.user.role === 'admin'} alerts={alerts} onSearch={request => { changeTab('downloads'); setRequestSearch(request); }} /></View> :
    tab === 'downloads' && !offline && data.user.role === 'admin' ? <View style={{ flex: 1, paddingTop: insets.top + 76 }}><DownloadsScreen {...art} initialRequest={requestSearch} /></View> : tab === 'folders' && !offline ? <View style={{ flex: 1, paddingTop: insets.top + 76 }}><FoldersScreen base={base} data={data} onRefresh={load} onBrowse={path => { setFolder(path); setTab('home'); }} /></View> : browse ? <FlatList key={`${tab}:${columns}`} data={browseItems} numColumns={columns} keyExtractor={items => titleKey(items[0])} contentContainerStyle={contentStyle} columnWrapperStyle={{ gap: 12 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.text} />}
      ListHeaderComponent={<View style={{ marginBottom: 22 }}><Text style={t.heading}>{kinds.find(kind => kind.kind === tab)?.title}</Text><Text style={[t.muted, { marginTop: 8 }]}>{allBrowse.length} {tab === 'show' ? 'shows' : 'titles'}</Text><View style={[t.row, { flexWrap: 'wrap', marginTop: 18, gap: 7 }]}>{[['all', 'All'], ['new', 'Unwatched'], ['progress', 'In progress'], ['done', 'Watched']].map(([value, label]) => <Pill key={value} label={label} compact style={filter === value ? { backgroundColor: '#ffffff18' } : undefined} onPress={() => setFilter(value)} />)}</View>{tab === 'show' && <ShowScanStatus key={base} base={base} initial={data.scanner} />}</View>}
      ListEmptyComponent={<Text style={t.muted}>No titles match this filter.</Text>} renderItem={({ item: items }) => <PosterCard {...art} data={data} items={items} width={cardWidth} onPress={() => setSelected(titleKey(items[0]))} />} /> : <SectionList sections={sections} keyExtractor={(row, index) => row[0][0].id + ':' + index} stickySectionHeadersEnabled={false} contentContainerStyle={contentStyle} showsVerticalScrollIndicator={false} initialNumToRender={5} windowSize={5} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.text} />} ListHeaderComponent={header}
      renderSectionHeader={({ section }) => <View style={[t.sectionHeading, { marginTop: 8 }]}><Text style={t.sectionTitle}>{section.title}</Text><Pressable onPress={() => changeTab(section.kind)}><Text style={t.dim}>{section.total} {section.noun}{search ? '' : ' · See all'}</Text></Pressable></View>}
      renderItem={({ item: row }) => <View style={{ flexDirection: 'row', gap: 12 }}>{row.map(items => <PosterCard key={titleKey(items[0])} {...art} data={data} items={items} width={cardWidth} onPress={() => setSelected(titleKey(items[0]))} />)}</View>}
      ListFooterComponent={search && !sections.length ? <Text style={t.muted}>No matches. Check the spelling, or try part of a title or file name.</Text> : <View style={{ height: 12 }} />} />}
    {data && error ? <Pressable onPress={() => setError('')} style={[s.toast, { bottom: insets.bottom + 86 }]}><Text style={t.text}>{error}</Text></Pressable> : null}
    <Corner username={data?.user.username} onHome={() => changeTab('home')} onProfile={() => setAccount(true)} onHelp={() => Alert.alert('Matro', `${data?.items.length || 0} files in your library.\n\nMetadata and artwork from TMDB.\n\nMovies are prepared on your Matro server and played natively on this device.`, [{ text: 'Refresh', onPress: () => void load() }, { text: 'Close' }])} />
    <Dock tab={tab} onChange={changeTab} requests={!offline && data?.movieRequestsEnabled ? (data.user.role === 'admin' ? 'Movie requests' : 'Request a movie') : undefined} />
    <AccountSheet visible={account} onClose={() => setAccount(false)} data={data} base={base} offline={offline} onGo={changeTab} onRefresh={() => void load()} onServer={onChangeServer} onSignOut={onSignedOut} />
  </View>;
}
function ShowScanStatus({ base, initial }: { base: string; initial?: ScannerStatus }) {
  const [scan, setScan] = useState(initial);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const { scanner } = await request(base, '/api/segments'); if (active) setScan(scanner); }
      catch { /* Keep the last known status when offline. */ }
      if (active) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [base]);
  if (!scan || (scan.complete ?? (scan.message === 'Background scan complete'))) return null;
  const { ready, total, message } = scan;
  return <View style={{ marginTop: 16, gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.hairline }}>
    <Text style={t.text}>Intro &amp; outro scanning</Text>
    {total > 0 && <>
      <Text style={t.muted}>{ready} of {total} episodes checked</Text>
      <View accessibilityRole="progressbar" accessibilityLabel="Episodes checked for intros and outros" accessibilityValue={{ min: 0, now: ready, max: total }} style={{ height: 5, borderRadius: 5, backgroundColor: colors.hairline }}>
        <View style={{ height: 5, borderRadius: 5, backgroundColor: colors.text, width: `${100 * ready / total}%` }} />
      </View>
    </>}
    <Text style={t.muted}>{message}</Text>
  </View>;
}
const s = StyleSheet.create({ fill: { flex: 1, backgroundColor: colors.ground }, center: { flex: 1, justifyContent: 'center' }, search: { height: 54, borderRadius: 999, borderWidth: 1, borderColor: '#ffffff24', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12, backgroundColor: '#ffffff05' }, searchInput: { flex: 1, color: colors.text, fontSize: 17, fontFamily: fonts.regular, paddingVertical: 0 }, toast: { position: 'absolute', left: 18, right: 18, padding: 16, borderRadius: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.hairline, zIndex: 40 } });
