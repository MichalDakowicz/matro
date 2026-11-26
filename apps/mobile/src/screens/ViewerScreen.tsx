import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { accountChanged, changeProgress, changeProgressMany, inspect, library, mediaHeaders, request, ServerError, syncDismissal, updateWatchOptions, type Item, type Library, type ListChange, type TitleList, type MovieRequest, type TrackDefaults } from '../lib/server';
import { progressRecovery, recoveryScope, rememberProgress } from '../lib/storage';
import { continueItems, groupLibrary, metadataFor, nameFor, savedServes, titleKey, trackKey } from '../../../../packages/core/client/library';
import { markedProgress, normalizeProgress, queueChange } from '../../../../packages/core/client/watch-progress.js';
import { applyDismissals } from '../../../../packages/core/client/recovery';
import { colors, dock, setSceneOverride, themed } from '../theme';
import { titleShelves } from '../../../../packages/core/client/title-shelves.js';
import { Pill, styles as t } from '../components/Matro';
import { AboutSheet, AccountSheet, Corner, Dock, Grain, OfflinePill, Toast, useKeyboardOpen, useNotice, type DockTab } from '../components/Shell';
import { plural } from '../lib/text';
import NativePlayer from './NativePlayer';
import TitleScreen from './TitleScreen';
import DownloadsScreen from './DownloadsScreen';
import FoldersScreen from './FoldersScreen';
import OfflineScreen from './OfflineScreen';
import MovieRequestsScreen from './MovieRequestsScreen';
import HistoryScreen from './HistoryScreen';
import QueueScreen from './QueueScreen';
import ServerPage from './ServerPage';
import AccountScreen from './AccountScreen';
import { BrowseView, HomeView, LibraryChips, SearchView } from './LibraryScreens';
import { useMovieRequestAlerts } from '../lib/movie-request-alerts';
import { activeDownloads, isSaved, offlineLibrary, removeOffline, resumeInterrupted, retryInterrupted, savedTitle, savedTitles, saveOffline, saveOfflineBatch, watchOffline, type SavedMedia } from '../lib/offline';

type Props = { base: string; onSignedOut: () => void; onChangeServer: () => void };
type Nav = { tab: string; folder: string | null };
const friendly = (message: string) => /network request failed|failed to fetch|timed out/i.test(message) ? 'Can’t reach your server right now.' : message;
export default function ViewerScreen({ base, onSignedOut, onChangeServer }: Props) {
  const [data, setData] = useState<(Library & { catalogIds?: string[] }) | null>(null), [headers, setHeaders] = useState<Record<string, string>>({});
  const dataRef = useRef(data); dataRef.current = data;
  const [error, setError] = useState('');
  // Dock tabs and chips replace each other; screens opened from them (Saved, Downloads, a folder) push onto `trail` so Back returns.
  const [nav, setNav] = useState<Nav>({ tab: 'home', folder: null }), [trail, setTrail] = useState<Nav[]>([]), { tab, folder } = nav;
  const { notice, show: notify, dismiss } = useNotice(), keyboard = useKeyboardOpen(), [about, setAbout] = useState(false);
  const [requestSearch, setRequestSearch] = useState<MovieRequest | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [playing, setPlaying] = useState<{ item: Item; start?: number; queue: Item[]; saved?: SavedMedia } | null>(null);
  const [offline, setOffline] = useState(false), playRun = useRef(0);
  const [refreshing, setRefreshing] = useState(false), [account, setAccount] = useState(false);
  const revision = useRef<string | undefined>(undefined), loading = useRef(false);
  const alerts = useMovieRequestAlerts(base, !offline && data?.movieRequestPushEnabled === true, data?.user.role === 'admin');
  const openedAlerts = useRef(0);
  const insets = useSafeAreaInsets();
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    const accountId = dataRef.current?.user.id;
    setRefreshing(true); setError('');
    try {
      const next = await library(base, accountId), auth = await mediaHeaders(base);
      revision.current = next.catalogRevision;
      setData({ ...next, progress: normalizeProgress(next.progress) }); setHeaders(auth); setOffline(false);
    }
    catch (e) {
      if (accountChanged(e) || e instanceof ServerError && e.status === 403) { onSignedOut(); return; }
      const cached = await offlineLibrary(base).catch(() => null);
      if (cached && (accountId === undefined || cached.user.id === accountId)) { setData({ ...cached, progress: normalizeProgress(cached.progress) }); setHeaders({}); setOffline(true); }
      else setError(e instanceof Error ? e.message : 'Could not load the library.');
    }
    finally { loading.current = false; setRefreshing(false); }
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
          const status = await request(base, '/api/status', {}, 4000);
          if (closed || typeof status?.setup !== 'boolean') return;
          if (status.user) await load();
          else onSignedOut();
          return;
        }
        const user = dataRef.current?.user;
        if (!user) return;
        const { catalogRevision, scanStatus } = await request(base, '/api/library/revision', { accountId: user.id });
        if (closed || revision.current !== before) return;
        void retryInterrupted(base, user)?.catch(() => {});
        if (catalogRevision === before) {
          setData(current => current && JSON.stringify(current.scanStatus) !== JSON.stringify(scanStatus) ? { ...current, scanStatus } : current);
          return;
        }
        const next = await library(base, user.id);
        if (closed || revision.current !== before) return;
        revision.current = next.catalogRevision;
        setData(current => current && { ...current, items: next.items, folders: next.folders, metadata: next.metadata, scanner: next.scanner, scanStatus: next.scanStatus, requestUpdates: next.requestUpdates, catalogRevision: next.catalogRevision });
      } catch (error) {
        if (!closed && accountChanged(error)) onSignedOut();
      } finally { checking = false; }
    };
    const timer = setInterval(check, 5000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { closed = true; clearInterval(timer); subscription.remove(); };
  }, [base, load, offline, onSignedOut]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (playing) return false;
      if (selected) { setSelected(null); return true; }
      if (back()) return true;
      if (folder || tab !== 'home') { jump('home'); return true; }
      return false;
    }); return () => sub.remove();
  }, [playing, selected, tab, folder, trail, load]);
  // Errors raised after the library is on screen (progress, queue, saves) become a short toast instead of a stuck banner.
  useEffect(() => { if (error && data) { notify(friendly(error)); setError(''); } }, [error, data]);
  const allGroups = useMemo(() => groupLibrary(data?.items || []), [data?.items]);
  const folderGroups = useMemo(() => allGroups.filter(items => items[0].root === folder), [allGroups, folder]);
  const featured = useMemo(() => data ? [...allGroups].sort((a, b) => {
    const recent = (items: Item[]) => Math.max(0, ...items.map(i => data.progress[i.id]?.hidden ? 0 : data.progress[i.id]?.updated || 0));
    return recent(b) - recent(a) || (b[0].added || 0) - (a[0].added || 0);
  }) : [], [allGroups, data?.progress]);
  const continues = useMemo(() => data ? continueItems(data, allGroups) : [], [data, allGroups]);
  // Titles opened from the Saved tab show only the episodes that are on this device.
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set()), [savingIds, setSavingIds] = useState<Set<string>>(new Set()), [savedOnly, setSavedOnly] = useState(false);
  useEffect(() => {
    if (!data) return;
    let run = 0;
    const refresh = () => {
      const current = ++run;
      void savedTitles(base, data.user).then(list => {
        if (current !== run) return;
        setSavedIds(new Set(list.filter(isSaved).map(record => record.id)));
        // Downloads that are running, waiting or paused: their pills read "Saving…".
        setSavingIds(new Set([...list.filter(record => !record.complete).map(record => record.id), ...activeDownloads(base, data.user).map(job => job.id)]));
      }).catch(() => {});
    };
    refresh();
    const stop = watchOffline(refresh);
    return () => { run++; stop(); };
  }, [base, data?.user.id]);
  const found = allGroups.find(items => titleKey(items[0]) === selected);
  const detail = savedOnly ? found?.filter(item => savedIds.has(item.id)) : found;
  const art = { base, headers };
  const changeTrackDefaults = async (trackDefaults: TrackDefaults) => {
    if (!data || offline) return;
    setData(latest => latest?.user.id === data.user.id ? { ...latest, preferences: { ...latest.preferences, trackDefaults } } : latest);
    try { await updateWatchOptions(base, data.user, { preferences: { trackDefaults } }); }
    catch (error) { if (accountChanged(error)) onSignedOut(); else setError('Could not save this setting. Check the connection.'); }
  };
  const updateProgress = async (item: Item, dismiss: boolean) => {
    if (!data) return;
    const checkpoint = data.progress[item.id], scope = recoveryScope(base, data.user);
    try {
      if (dismiss) {
        const siblings = allGroups.find(items => titleKey(items[0]) === titleKey(item)) || [item];
        const operation = { id: item.id, at: siblings.reduce((at, sibling) => Math.max(at, data.progress[sibling.id]?.updated || 0), Date.now()) };
        await progressRecovery.dismiss(scope, operation);
        setData(latest => latest?.user.id === data.user.id ? { ...latest, progress: applyDismissals(siblings, latest.progress, { [item.id]: operation }) } : latest);
        if (!offline) {
          const resolved = normalizeProgress(await syncDismissal(base, data.user, operation));
          setData(latest => {
            if (latest?.user.id !== data.user.id) return latest;
            const patch = Object.fromEntries(Object.entries(resolved).filter(([id, entry]) => entry.updated >= (latest.progress[id]?.updated || 0)));
            return { ...latest, progress: { ...latest.progress, ...patch } };
          });
        }
        return;
      }
      if (offline) {
        const duration = checkpoint?.duration || (await savedTitle(base, data.user, item.id))?.info.duration || 0;
        const entry = { ...checkpoint, position: checkpoint?.position || 0, duration, completed: !checkpoint?.completed, updated: Date.now() };
        await progressRecovery.write(scope, item.id, entry);
        setData(latest => latest?.user.id === data.user.id ? { ...latest, progress: { ...latest.progress, [item.id]: entry } } : latest);
        return;
      }
      const { progress } = await changeProgress(base, data.user.id, item.id, { completed: !checkpoint?.completed, checkpoint });
      const resolved = normalizeProgress(progress);
      setData(latest => latest?.user.id === data.user.id && latest.progress[item.id] === checkpoint ? { ...latest, progress: { ...latest.progress, ...resolved } } : latest);
      await rememberProgress(base, data.user, resolved);
      if (checkpoint) await progressRecovery.confirm(scope, { [item.id]: checkpoint }, resolved);
    } catch (e) {
      if (accountChanged(e)) onSignedOut();
      else setError(e instanceof Error ? e.message : 'Could not save progress.');
    }
  };
  const removeContinue = (item: Item) => void updateProgress(item, true);
  const updateQueue = (queue: string[], change: ReturnType<typeof queueChange>) => {
    if (!data) return;
    setData(latest => latest?.user.id === data.user.id ? { ...latest, queue } : latest);
    if (offline || !change.add.length && !change.remove.length) return;
    void updateWatchOptions(base, data.user, { queueChange: change }).catch(e => { if (accountChanged(e)) onSignedOut(); else setError(e.message); });
  };
  const enqueue = (items: Item[]) => {
    if (!data) return;
    const add = items.map(i => i.id), queue = [...new Set([...data.queue, ...add])];
    updateQueue(queue, { add, remove: [] });
    const added = queue.length - data.queue.length;
    notify(!added ? 'Already in your queue.' : added === 1 ? `Added “${items.length === 1 ? nameFor(data, items[0]) : 'one item'}” to the queue.` : `Added ${plural(added, 'item')} to the queue.`, { label: 'View queue', run: () => jump('queue') });
  };
  const startPlayback = async (item: Item, queue: Item[], start?: number) => {
    if (!data) return;
    const run = ++playRun.current;
    let saved = await savedTitle(base, data.user, item.id).catch(() => undefined);
    // Online, the saved copy only has the first audio track and text subtitles: stream when the chosen tracks need more.
    if (saved && !offline) {
      const full = await inspect(base, item.id).catch(() => null);
      if (full && !savedServes(saved.info, full, data.preferences.tracks?.[trackKey(item)], data.preferences)) saved = undefined;
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
    if (!offline) {
      const ids = queue.map(i => i.id);
      updateQueue(ids, queueChange(data.queue, ids));
    }
  };
  const saveName = (item: Item) => data && item.kind !== 'show' ? nameFor(data, item) : item.title;
  useEffect(() => {
    if (!data || offline) return;
    const resume = () => void resumeInterrupted(base, data.user).catch(() => {});
    resume();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') resume(); });
    return () => subscription.remove();
  }, [base, offline, data?.user.id, data?.items]);
  const savedLink = { label: 'View', run: () => push('offline') };
  const save = (item: Item) => {
    if (!data) return;
    if (offline) return notify('Reconnect to save titles for offline.');
    void saveOffline(base, data.user, item, saveName(item)).catch(error => notify(`Couldn’t save “${saveName(item)}”. ${friendly(error.message)}`));
    notify(`Saving “${saveName(item)}”. Follow it under Saved.`, savedLink);
  };
  const saveMany = (list: Item[]) => {
    if (!data || !list.length) return;
    if (offline) return notify('Reconnect to save titles for offline.');
    void saveOfflineBatch(base, data.user, list, saveName).catch(error => notify(`Couldn’t save everything. ${friendly(error.message)}`));
    notify(`Saving ${plural(list.length, 'episode')}, two at a time. Follow them under Saved.`, savedLink);
  };
  // Marks a season, a whole show or earlier episodes in one request (or one local change when offline).
  const markMany = async (list: Item[], done: boolean) => {
    const current = dataRef.current, todo = list.filter(item => !!current?.progress[item.id]?.completed !== done);
    if (!current || !todo.length) return;
    try {
      const episodesOf = (item: Item) => allGroups.find(items => titleKey(items[0]) === titleKey(item)) || [item];
      const resolved = offline ? markedProgress(todo, current.progress, done, { episodesOf }) : normalizeProgress((await changeProgressMany(base, current.user.id, todo.map(item => item.id), done)).progress);
      setData(latest => {
        if (latest?.user.id !== current.user.id) return latest;
        const patch = Object.fromEntries(Object.entries(resolved).filter(([id, entry]) => entry.updated >= (latest.progress[id]?.updated || 0)));
        return { ...latest, progress: { ...latest.progress, ...patch } };
      });
      if (offline) {
        const scope = recoveryScope(base, current.user);
        await Promise.all(Object.entries(resolved).map(([id, entry]) => progressRecovery.write(scope, id, entry)));
      } else await rememberProgress(base, current.user, resolved);
    } catch (e) {
      if (accountChanged(e)) onSignedOut();
      else setError(e instanceof Error ? e.message : 'Could not save progress.');
      return;
    }
    notify(todo.length === 1 ? (done ? 'Marked as watched.' : 'Marked as unwatched.') : `Marked ${plural(todo.length, 'episode')} ${done ? 'watched' : 'unwatched'}.`);
  };
  const removeSaved = (list: Item[]) => Alert.alert('Remove from this device?', 'The saved files are deleted. They stay in your library on the server.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => void Promise.all(list.map(item => removeOffline(base, data!.user, item.id))).then(() => { setSelected(null); setSavedOnly(false); }).catch(e => setError(e.message)) },
  ]);
  const resetView = () => { setSavedOnly(false); setSelected(null); setRequestSearch(null); };
  const jump = (value: string) => { resetView(); setTrail([]); setNav({ tab: value, folder: null }); };
  const push = (value: string, next: string | null = null) => { resetView(); setTrail(list => [...list, nav]); setNav({ tab: value, folder: next }); };
  const back = () => { const previous = trail[trail.length - 1]; if (!previous) return false; resetView(); setTrail(list => list.slice(0, -1)); setNav(previous); return true; };
  const go = (value: string) => value === 'folders' ? jump(value) : push(value);
  useEffect(() => {
    if (playing || !alerts.supported || alerts.opened === openedAlerts.current) return;
    openedAlerts.current = alerts.opened;
    setAccount(false);
    push('movie-requests');
  }, [alerts.opened, alerts.supported, playing]);
  useEffect(() => () => setSceneOverride(null), []);
  setSceneOverride(playing && data ? 'dark' : null); // the player draws over video, dark in both themes
  if (playing && data) return <><StatusBar style="light" /><NativePlayer key={`${playing.item.id}:${playing.start ?? 'resume'}`} {...art} item={playing.item} data={data} initialPosition={playing.start} queue={playing.queue}
    saved={playing.saved} offline={offline} onBack={() => { playRun.current++; setPlaying(null); void load(); }} onSelect={item => void startPlayback(item, playing.queue)} onNext={() => {
      const next = playing.queue[playing.queue.findIndex(i => i.id === playing.item.id) + 1];
      if (next && data.preferences.autoplay !== false) void startPlayback(next, playing.queue);
      else { setPlaying(null); void load(); }
    }} /></>;
  const admin = !offline && data?.user.role === 'admin', layout = { top: insets.top + (offline ? 44 : 0), bottom: insets.bottom };
  const list = data && tab.startsWith('list:') ? titleShelves(allGroups, data.lists, titleKey, item => metadataFor(data, item)).find(shelf => 'list:' + shelf.id === tab) : null;
  const editLists = async (body: ListChange) => {
    const { lists }: { lists: TitleList[] } = await request(base, '/api/lists', { method: 'POST', body, accountId: data?.user.id });
    setData(current => current && { ...current, lists });
  };
  const libraryTab = ['home', 'movie', 'show', 'folders'].includes(tab);
  const requestsLabel = !offline && data?.movieRequestsEnabled ? (data.user.role === 'admin' ? 'Movie requests' : 'Request a movie') : undefined;
  const dockTab: DockTab = tab === 'search' ? 'search' : tab === 'queue' ? 'queue' : ['server', 'offline', 'downloads', 'movie-requests', 'history', 'account'].includes(tab) ? 'server' : 'home';
  const chips = data && libraryTab && !folder ? <LibraryChips tab={tab} admin={admin} onPick={jump} /> : null;
  const open = (items: Item[]) => setSelected(titleKey(items[0]));
  // From the Queue screen the player gets the queue itself, not the show's episode list.
  const playFromQueue = (item: Item) => { if (data) void startPlayback(item, data.queue.flatMap(id => data.items.find(i => i.id === id) || [])); };
  const setQueue = (queue: string[]) => {
    if (!data) return;
    updateQueue(queue, queueChange(data.queue, queue));
  };
  const setAutoplay = (autoplay: boolean) => {
    if (!data) return;
    const preferences = { ...data.preferences, autoplay };
    setData({ ...data, preferences });
    if (!offline) void updateWatchOptions(base, data.user, { preferences: { autoplay } }).catch(error => { if (accountChanged(error)) onSignedOut(); else notify('Couldn’t save the autoplay setting.'); });
  };
  const top = (node: React.ReactNode) => <View style={{ flex: 1, paddingTop: layout.top + 76 }}>{node}</View>;
  const common = { ...art, layout, refreshing, onRefresh: () => void load(), onOpen: open };
  const screen = !data ? <View style={[s.center, { padding: 24 }]}>{refreshing ? <ActivityIndicator color={colors.text} /> : <><Text style={t.heading}>Your library</Text><Text style={[t.muted, { marginVertical: 16 }]}>{error || 'Could not load your library.'}</Text><Pill label="Try again" onPress={() => void load()} /></>}</View>
    : tab === 'offline' ? <View style={{ flex: 1, paddingTop: offline ? 44 : 0 }}><OfflineScreen {...art} data={data} offline={offline}
      onOpenTitle={items => { setSavedOnly(true); setSelected(titleKey(items[0])); }}
      onResume={id => { const item = data.items.find(item => item.id === id); if (item) save(item); }}
      onRemoved={() => { if (offline) void load(); }} /></View>
    : tab === 'movie-requests' && !offline && data.movieRequestsEnabled ? top(<MovieRequestsScreen key={alerts.opened} base={base} admin={data.user.role === 'admin'} alerts={alerts} onSearch={request => { push('downloads'); setRequestSearch(request); }} />)
    : tab === 'history' ? <HistoryScreen {...art} data={data} layout={layout} onOpen={item => open(allGroups.find(items => items.some(i => i.id === item.id)) || [item])} />
    : tab === 'account' && !offline ? <AccountScreen onPasswordChanged={async () => setHeaders(await mediaHeaders(base))} base={base} data={data} layout={layout} admin={admin} notify={notify} />
    : tab === 'downloads' && admin ? top(<DownloadsScreen {...art} initialRequest={requestSearch} />)
    : tab === 'folders' && !offline ? top(<FoldersScreen base={base} data={data} header={chips} onRefresh={load} onBrowse={path => push('home', path)} />)
    : tab === 'search' ? <SearchView {...common} data={data} groups={allGroups} />
    : tab === 'queue' ? <QueueScreen {...art} data={data} layout={layout} onPlay={playFromQueue} onQueue={setQueue} onAutoplay={setAutoplay} onBrowse={() => jump('home')} />
    : tab === 'server' ? <ServerPage base={base} data={data} offline={offline} layout={layout} requests={requestsLabel} onGo={go} onBrowseFolder={path => push('home', path)} onRefresh={load} onChangeServer={onChangeServer} notify={notify} />
    : tab.startsWith('list:') ? <BrowseView {...common} data={data} groups={list?.groups || []} title={list?.name || 'List'} chips={null} />
    : folder ? <BrowseView {...common} data={data} groups={folderGroups} title={folder.split(/[\\/]/).filter(Boolean).pop()} chips={null} />
    : ['movie', 'show'].includes(tab) ? <BrowseView {...common} data={data} kind={tab} groups={allGroups.filter(items => items[0].kind === tab)} chips={chips} />
    : <HomeView {...common} data={data} groups={allGroups} featured={featured} continues={continues} chips={chips} onPlay={play} onRemoveContinue={removeContinue} onSeeAll={jump} onAddFolder={() => jump('folders')} />;
  const overlay = !!(detail && data), toastBottom = overlay || keyboard ? insets.bottom + 24 : insets.bottom + dock.bottom + dock.height + 18;
  return <View style={s.fill}>
    <View style={s.fill} importantForAccessibility={overlay ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={overlay}>
      {screen}
      {offline && data && <OfflinePill onReconnect={() => void load()} />}
      <Corner username={data?.user.username} canBack={trail.length > 0} onBack={back} onHome={() => jump('home')} onProfile={() => setAccount(true)} />
      <Dock active={dockTab} onChange={jump} queued={data?.queue.length || 0} hidden={keyboard} />
    </View>
    {/* The title page is an overlay, so the list underneath stays mounted and keeps its scroll position. */}
    {detail && data && <View style={s.overlay}><TitleScreen key={selected} {...art} data={data} items={detail} onBack={() => setSelected(null)} onPlay={play} onEditLists={!offline && !savedOnly && data.lists ? editLists : undefined} onEnqueue={enqueue} onMark={(list, done) => void markMany(list, done)} online={offline || savedOnly ? undefined : { admin, tmdb: data.metadataEnabled === true, notify, onMetadata: metadata => setData(latest => latest && { ...latest, metadata }) }} onSave={offline || savedOnly ? undefined : save} onSaveMany={offline || savedOnly ? undefined : saveMany} onRemoveSaved={savedOnly ? removeSaved : undefined} savedIds={savedIds} savingIds={savingIds} /></View>}
    <Grain />
    <Toast notice={notice} bottom={toastBottom} onDismiss={dismiss} />
    <AccountSheet visible={account} onClose={() => setAccount(false)} data={data} base={base} offline={offline} requests={requestsLabel} onGo={go} onRefresh={() => void load()} onAbout={() => setAbout(true)} onServer={onChangeServer} onSignOut={onSignedOut} onTrackDefaults={changeTrackDefaults} />
    <AboutSheet visible={about} onClose={() => setAbout(false)} files={data?.items.length || 0} />
  </View>;
}
const s = themed(() => StyleSheet.create({ fill: { flex: 1, backgroundColor: colors.ground }, center: { flex: 1, justifyContent: 'center' }, overlay: { ...StyleSheet.absoluteFill, zIndex: 50, elevation: 24, backgroundColor: colors.ground } }));
