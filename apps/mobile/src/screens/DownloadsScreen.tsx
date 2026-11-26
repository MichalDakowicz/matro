import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { request, type MovieRequest } from '../lib/server';
import { releaseName, transferLabel } from '../lib/release-name';
import { Icon, IconButton, MediaArt, Pill, ProgressBar, styles as t } from '../components/Matro';
import type { ArtProps } from '../components/LibraryParts';
import { colors, fonts, radius, overArt, themed } from '../theme';

type Job = { id: string; hash: string; title: string; phase: string; season?: number; episode?: number; error?: string; banner?: string; finalRoot?: string };
type Transfer = { hash: string; name: string; progress: number; state: string; speed: number; banner?: string; savePath: string };
type Release = { hash: string | null; selectionId?: string; title?: string; quality: string; size: string; seeds?: number; codec?: string; season?: number; episode?: number; absoluteEpisode?: number; releaseTitle?: string; downloadKind?: string };
type Title = { id: string; title: string; year: string; overview?: string; status?: string; poster?: string; torrents?: Release[]; indexed?: boolean };
type Config = { server?: { username: string; passwordSaved?: boolean; storage?: { movieRoot?: string; showRoot?: string } } };
type SeasonDownload = { season: number; from: number | null; expected: number; coverage: number; nextPage: number | null; pack: Release | null; batch: { id: string; group: string; quality: string; count: number } | null };
type Confirm = { title: string; detail: string; body: Record<string, unknown>; seasonKey: string };
const SEED_KEY = 'matro.downloads.seed';
const qualities = ['', '480p', '720p', '1080p', '2160p'];
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;
function animeTitles(releases: (Release & { title: string; year: string })[]) {
  const titles = new Map<string, Title>();
  for (const release of releases) {
    const id = release.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') + ':' + release.year;
    if (!titles.has(id)) titles.set(id, { id, title: release.title, year: release.year, torrents: [] });
    titles.get(id)?.torrents?.push(release);
  }
  return [...titles.values()];
}
export default function DownloadsScreen({ base, headers, initialRequest }: ArtProps & { initialRequest?: MovieRequest | null }) {
  const insets = useSafeAreaInsets(), { width } = useWindowDimensions(), columns = Math.max(3, Math.floor((width - 24) / 108)), cardWidth = (width - 36 - (columns - 1) * 12) / columns;
  const [jobs, setJobs] = useState<Job[]>([]), [transfers, setTransfers] = useState<Transfer[]>([]), [titles, setTitles] = useState<Title[] | null>(null), [selected, setSelected] = useState<Title | null>(null), [releases, setReleases] = useState<Release[]>([]);
  const [kind, setKind] = useState('movie'), [query, setQuery] = useState(initialRequest?.title || ''), [username, setUsername] = useState(''), [password, setPassword] = useState(''), [config, setConfig] = useState<Config>({});
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [settings, setSettings] = useState(false), [page, setPage] = useState(1), [total, setTotal] = useState(0), [nextPage, setNextPage] = useState<number | null>(null);
  const [season, setSeason] = useState(''), [episode, setEpisode] = useState(''), [quality, setQuality] = useState(''), [magnetOpen, setMagnetOpen] = useState(false), [magnet, setMagnet] = useState(''), [magnetTitle, setMagnetTitle] = useState('');
  const [seasonDownload, setSeasonDownload] = useState<SeasonDownload | null>(null), [seasonNotice, setSeasonNotice] = useState(''), [addedSeason, setAddedSeason] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null), [seed, setSeed] = useState(false), [showDone, setShowDone] = useState(false);
  const catalogLabel = kind === 'movie' ? 'Movies' : kind === 'anime' ? 'Anime' : 'Series';
  const searchRun = useRef(0), mounted = useRef(true);
  const call = async (route: string, body?: unknown) => (await request(base, '/api/admin/downloads/' + route, body === undefined ? {} : { method: 'POST', body }, route === 'series-releases' ? 55000 : 20000)).result;
  const refresh = async () => { const [j, tr] = await Promise.all([call('jobs'), call('list')]); if (mounted.current) { setJobs(j); setTransfers(tr); } };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Download request failed.'); } finally { if (mounted.current) setBusy(false); } };
  useEffect(() => {
    mounted.current = true; let running = false;
    void AsyncStorage.getItem(SEED_KEY).then(value => { if (mounted.current) setSeed(value === '1'); }).catch(() => {});
    void call('config').then((value: Config) => { if (mounted.current) { setConfig(value); setUsername(value.server?.username || ''); } }).catch(e => setError(e.message));
    const poll = async () => { if (running) return; running = true; try { await refresh(); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Could not load downloads.'); } finally { running = false; } };
    void poll(); const timer = setInterval(() => void poll(), 5000);
    if (initialRequest) search();
    return () => { mounted.current = false; searchRun.current++; clearInterval(timer); };
  }, [base]);
  const changeSeed = (value: boolean) => { setSeed(value); void AsyncStorage.setItem(SEED_KEY, value ? '1' : '0').catch(() => {}); };
  const search = (at = 1) => void run(async () => {
    const current = ++searchRun.current;
    const route = kind === 'anime' ? 'discover' : kind === 'movie' ? 'search' : 'series-search';
    const result = await call(route, { kind, query, page: at });
    if (current !== searchRun.current) return;
    const found = kind === 'anime' ? animeTitles(result.results) : kind === 'movie' ? result.movies : result.shows;
    setTitles(found); setPage(at); setTotal(result.total ?? found.length);
  });
  const findReleases = async (title: Title, at = 1) => {
    if (at === 1) { setSeasonDownload(null); setSeasonNotice(''); setAddedSeason(''); }
    setSelected(title); const result = kind !== 'show' ? { releases: title.torrents || [], nextPage: null } : await call('series-releases', { id: title.id, page: at, ...(season ? { season: +season } : {}), ...(episode ? { episode: +episode } : {}), quality });
    setReleases(result.releases); setNextPage(result.nextPage);
  };
  const findSeason = (at = 1) => void run(async () => {
    if (!selected) return;
    if (at === 1) setSeasonDownload(null);
    const seasonNumber = kind === 'anime' ? season || '1' : season;
    if (!/^\d{1,2}$/.test(seasonNumber)) {
      setSeasonNotice(kind === 'show' ? 'Enter a season to find a season download. Add an episode to start from it.' : 'Enter a season to find a season download.');
      return;
    }
    setSeasonNotice('Finding matching season releases…');
    try {
      const options = kind === 'anime' ? { animeSelections: releases.map(item => item.selectionId).filter(Boolean) } : { id: selected.id, page: at, seasonDownload: true, ...(episode ? { fromEpisode: +episode } : {}) };
      setSeasonDownload(await call('series-releases', { ...options, season: +seasonNumber, quality: kind === 'anime' ? '' : quality }));
      setSeasonNotice('');
    } catch (error) { setSeasonNotice(error instanceof Error ? error.message : 'Could not find a season download.'); }
  });
  const send = ({ title, body, seasonKey }: Confirm) => { setConfirm(null); void run(async () => {
    const batch = !!body.seasonDownloadId;
    if (seasonKey) setSeasonNotice('Sending to Matro host…');
    try {
      const result = await call('add', { target: 'server', ...body, seed });
      if (batch) {
        const count = result.queued.length;
        const duplicates = result.duplicates.length ? ` ${result.duplicates.length} already in Downloads.` : '';
        setSeasonNotice(`${count} episode${count === 1 ? '' : 's'} queued on Matro host.${duplicates}`);
      } else if (seasonKey) {
        setSeasonNotice(result.duplicate ? 'Season already in qBittorrent.' : 'Season sent to Matro host.');
      } else {
        setNotice(`${title} sent to Matro host.`); setMagnetOpen(false); setSelected(null);
      }
      if (seasonKey) setAddedSeason(seasonKey);
    } catch (error) {
      if (!seasonKey) throw error;
      setSeasonNotice(error instanceof Error ? error.message : 'Could not send this season.');
    }
    await refresh();
  }); };
  const seasonItem = seasonDownload?.pack || seasonDownload?.batch;
  const seasonKey = seasonDownload?.pack?.hash || seasonDownload?.batch?.id || '';
  const remove = (hash: string) => Alert.alert('Remove download?', 'Downloaded files will be kept.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void run(async () => { await call('remove', { target: 'server', hash }); await refresh(); }) }]);
  const closeSheet = () => { setSelected(null); setSettings(false); setMagnetOpen(false); setConfirm(null); };
  const pending = jobs.filter(job => !['ready', 'complete'].includes(job.phase));
  const known = transfers.filter(tr => !pending.some(job => job.hash === tr.hash));
  const active = known.filter(tr => tr.progress < 1), done = known.filter(tr => tr.progress >= 1);
  const activity = <View>
    {(pending.length || active.length) ? <Text style={[t.sectionTitle, { marginBottom: 16 }]}>Activity</Text> : null}
    {pending.map(job => {
      const title = job.episode ? `${job.title} · S${String(job.season).padStart(2, '0')}E${String(job.episode).padStart(2, '0')}` : job.title;
      const state = { error: 'Error', reconnecting: 'Reconnecting', queued: 'Queued' }[job.phase] || 'Preparing';
      const note = job.error || (job.phase === 'queued' ? 'Waiting for a season download slot.' : 'Fetching metadata, selecting media and arranging files…');
      return <MediaArt key={job.id} base={base} headers={headers} path={job.banner} style={s.transfer}>
        <LinearGradient colors={[overArt.card, overArt.cardDeep]} style={StyleSheet.absoluteFill} /><View style={s.transferTop}><Text style={[t.dim, { color: colors.text }]}>{state}</Text><IconButton name="close" label={`Remove ${title}`} size={44} onPress={() => remove(job.hash)} /></View><View style={s.transferBody}><Text style={t.text}>{title}</Text><Text style={[t.dim, { lineHeight: 18, marginTop: 8, color: job.phase === 'error' ? colors.warn : colors.muted }]}>{note}</Text>{job.phase === 'error' && <Pill label="Retry preparation" compact style={{ alignSelf: 'flex-start', marginTop: 12 }} onPress={() => void run(async () => { await call('retry', { id: job.id }); await refresh(); })} />}</View>
      </MediaArt>;
    })}
    {active.map(tr => {
      const name = releaseName(tr.name), line = [transferLabel(tr.state), name.detail, tr.speed ? `${(tr.speed / 1048576).toFixed(1)} MB/s` : ''].filter(Boolean).join(' · ');
      return <MediaArt key={tr.hash} base={base} headers={headers} path={tr.banner} style={s.transfer}>
        <LinearGradient colors={[overArt.card, overArt.cardDeep]} style={StyleSheet.absoluteFill} /><View style={s.transferTop}><Text style={[t.dim, { color: colors.text }]}>{line}</Text><IconButton name="close" label={`Remove ${name.title}`} size={44} onPress={() => remove(tr.hash)} /></View><View style={s.transferBody}><View style={[t.row, { justifyContent: 'space-between', marginBottom: 12 }]}><Text numberOfLines={2} style={[t.text, { flex: 1 }]}>{name.title}</Text><Text style={t.mono}>{Math.round(tr.progress * 100)}%</Text></View><ProgressBar value={tr.progress} /></View>
      </MediaArt>;
    })}
    {done.length ? <View style={s.doneBlock}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDone }} accessibilityLabel={`Done, ${done.length}`} onPress={() => setShowDone(!showDone)} style={s.doneHeader}>
        <Text style={t.sectionTitle}>Done</Text><View style={t.row}><Text style={t.dim}>{done.length}</Text><View style={{ transform: [{ rotate: showDone ? '-90deg' : '90deg' }] }}><Icon name="chevron" size={16} /></View></View>
      </Pressable>
      {showDone && done.map(tr => {
        const name = releaseName(tr.name), where = jobs.find(job => job.hash === tr.hash)?.finalRoot || tr.savePath;
        return <View key={tr.hash} style={s.doneRow}><View style={{ flex: 1, gap: 2 }}><Text numberOfLines={2} style={t.text}>{name.title}</Text><Text numberOfLines={1} style={t.dim}>{[name.detail, where ? `Saved to ${folderName(where)}` : ''].filter(Boolean).join(' · ')}</Text></View><IconButton name="trash" label={`Remove ${name.title}`} onPress={() => remove(tr.hash)} /></View>;
      })}
    </View> : null}
  </View>;
  const header = <>
    <View style={[t.sectionHeading, { alignItems: 'flex-start' }]}><View><Text accessibilityRole="header" style={t.heading}>Downloads</Text><Text style={[t.dim, { marginTop: 8 }]}>Matro host</Text></View><View style={t.row}><IconButton name="plus" label="Add magnet link" onPress={() => setMagnetOpen(true)} /><IconButton name="wrench" label="Download settings" onPress={() => setSettings(true)} /></View></View>
    {error ? <Text accessibilityRole="alert" style={[t.muted, { color: colors.warn, marginBottom: 16 }]}>{error}</Text> : null}{notice ? <Pressable accessibilityHint="Dismiss" onPress={() => setNotice('')}><Text style={[t.muted, { marginBottom: 16 }]}>{notice}</Text></Pressable> : null}
    <View style={[t.row, { marginTop: 6, marginBottom: 18, flexWrap: 'wrap' }]}>{[['movie', 'Movies'], ['show', 'Series'], ['anime', 'Anime']].map(([value, label]) => <Pill key={value} compact label={label} selected={kind === value} onPress={() => { searchRun.current++; setKind(value); setTitles(null); setSelected(null); setReleases([]); setSeason(''); setEpisode(''); setQuality(''); }} />)}</View>
    <View style={s.search}><Icon name="search" /><TextInput accessibilityLabel={`Search ${catalogLabel.toLowerCase()}`} placeholder={`Search ${catalogLabel.toLowerCase()}`} placeholderTextColor={colors.dim} value={query} onChangeText={setQuery} onSubmitEditing={() => search()} returnKeyType="search" style={s.input} /><Pill label="Search" compact primary disabled={busy || !query.trim()} onPress={() => search()} /></View>
    {kind === 'movie' && initialRequest?.year ? <Text style={[t.dim, { marginTop: 12 }]}>Requested movie · {initialRequest.title} ({initialRequest.year})</Text> : null}
    {!config.server && <Pressable accessibilityRole="button" onPress={() => setSettings(true)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={[t.dim, { lineHeight: 19 }]}>Connect your download client in Download settings before sending a release.</Text></Pressable>}
    <View style={[t.sectionHeading, { marginTop: 30 }]}><Text style={t.sectionTitle}>{catalogLabel}</Text><Text style={t.dim}>{titles ? `${total} results${kind === 'movie' ? ' · YTS' : kind === 'show' ? ' · TVmaze' : ''}` : ''}</Text></View>
    {!titles ? <View style={s.empty}><Text style={t.sectionTitle}>Find your next {kind === 'movie' ? 'movie' : 'series'}.</Text><Text style={[t.muted, { textAlign: 'center', marginTop: 10 }]}>Search the catalog, choose a release, and send it to Matro host.</Text></View> : !titles.length ? <View style={s.empty}><Text style={t.sectionTitle}>No results found.</Text><Text style={t.muted}>Try another title or spelling.</Text></View> : null}
  </>;
  const sheetTitle = confirm ? 'Download to Matro host?' : settings ? 'Download settings' : magnetOpen ? 'Add magnet link' : selected?.title;
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
    <FlatList key={`${kind}:${columns}`} data={titles || []} numColumns={columns} keyExtractor={title => title.id} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 104 }} columnWrapperStyle={{ gap: 12 }} ListHeaderComponent={header} ListFooterComponent={<View>{titles && kind === 'movie' ? <View style={[t.row, { marginVertical: 18 }]}><Pill label="Previous page" compact disabled={page <= 1 || busy} onPress={() => search(page - 1)} /><Pill label="Next page" compact disabled={page * 20 >= total || busy} onPress={() => search(page + 1)} /></View> : null}{kind === 'show' && titles?.length ? <Text style={[t.dim, { marginBottom: 24 }]} onPress={() => void Linking.openURL('https://creativecommons.org/licenses/by-sa/4.0/')}>Metadata from TVmaze · CC BY-SA 4.0</Text> : null}{activity}</View>}
      renderItem={({ item: title }) => <Pressable onPress={() => { setReleases([]); void run(() => findReleases(title)); }} accessibilityLabel={`Open ${title.title}`} style={{ width: cardWidth, marginBottom: 22 }}><MediaArt base={base} headers={headers} path={title.poster} title={title.poster ? undefined : title.title} style={{ width: cardWidth, height: cardWidth * 1.5, borderRadius: 8 }} />{title.poster ? <Text numberOfLines={1} style={s.cardTitle}>{title.title}</Text> : null}<Text numberOfLines={1} style={[t.dim, { fontSize: 11, marginTop: title.poster ? 3 : 8 }]}>{[title.year, title.torrents ? `${title.torrents.length} releases` : title.status].filter(Boolean).join(' · ')}</Text></Pressable>} />
    <Modal visible={!!selected || settings || magnetOpen} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={closeSheet}><KeyboardAvoidingView style={s.modalRoot} behavior="padding"><Pressable accessibilityLabel="Close download details" style={s.scrim} onPress={closeSheet} /><View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}><View style={t.sectionHeading}><Text accessibilityRole="header" style={[t.sectionTitle, { flex: 1 }]}>{sheetTitle}</Text><IconButton name="close" label="Close download details" onPress={closeSheet} /></View><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {error ? <Text accessibilityRole="alert" style={[t.muted, { color: colors.warn, marginBottom: 14 }]}>{error}</Text> : null}
      {confirm ? <View style={{ gap: 14 }}>
        <View style={{ gap: 4 }}><Text style={[t.text, { fontFamily: fonts.medium }]}>{confirm.title}</Text>{confirm.detail ? <Text style={t.dim}>{confirm.detail}</Text> : null}</View>
        <Pill label="Download" icon="download" primary disabled={busy} onPress={() => send(confirm)} />
        <Pill label="Cancel" onPress={() => setConfirm(null)} />
        <Text style={[t.dim, { lineHeight: 20 }]}>{seed ? 'Sharing continues after it finishes.' : 'Sharing stops when it finishes.'} You can change this in Download settings.</Text>
      </View> : settings ? <View style={{ gap: 14 }}><Text style={t.muted}>Connect the download client on your Matro server.</Text><TextInput accessibilityLabel="qBittorrent username" placeholder="Username" placeholderTextColor={colors.dim} autoCapitalize="none" value={username} onChangeText={setUsername} style={s.field} /><TextInput accessibilityLabel="qBittorrent password" placeholder={config.server?.passwordSaved ? 'Leave blank to keep saved password' : 'Password'} placeholderTextColor={colors.dim} secureTextEntry value={password} onChangeText={setPassword} style={s.field} /><Pill label={busy ? 'Connecting…' : 'Save connection'} primary disabled={busy} onPress={() => void run(async () => { const saved = await call('configure', { target: 'server', username, password }); setConfig(saved); setPassword(''); setNotice('Download client connected.'); setSettings(false); })} />
        <View style={s.switchRow}><View style={{ flex: 1, gap: 2 }}><Text style={t.text}>Keep sharing after download</Text><Text style={[t.dim, { lineHeight: 18 }]}>Uploads the finished file to other people (seeding). Off stops as soon as it is complete.</Text></View><Switch accessibilityLabel="Keep sharing after download" value={seed} onValueChange={changeSeed} trackColor={{ false: colors.hairline, true: colors.primary }} thumbColor={colors.text} /></View>
        <Text style={[t.dim, { lineHeight: 20 }]}>Movies: {config.server?.storage?.movieRoot || 'Server library'}{"\n"}Shows: {config.server?.storage?.showRoot || 'Server library'}</Text></View> : magnetOpen ? <View style={{ gap: 14 }}><TextInput accessibilityLabel="Magnet title" value={magnetTitle} onChangeText={setMagnetTitle} placeholder="Title" placeholderTextColor={colors.dim} style={s.field} /><TextInput accessibilityLabel="Magnet link" value={magnet} onChangeText={setMagnet} placeholder="magnet:?xt=…" placeholderTextColor={colors.dim} autoCapitalize="none" style={s.field} /><Pill label="Download to Matro host" icon="download" primary disabled={busy || !magnetTitle.trim() || !magnet.trim()} onPress={() => send({ title: magnetTitle, detail: '', body: { magnet, title: magnetTitle, kind: kind === 'anime' ? 'show' : kind }, seasonKey: '' })} /></View> : <>
        <Text style={t.dim}>{selected?.year}</Text>{selected?.overview ? <Text style={[t.muted, { marginTop: 12, marginBottom: 18 }]}>{selected.overview}</Text> : null}
        {kind === 'show' && <View style={{ gap: 12, marginVertical: 14 }}><View style={t.row}><TextInput accessibilityLabel="Season filter" value={season} onChangeText={setSeason} placeholder="All seasons" placeholderTextColor={colors.dim} keyboardType="number-pad" style={[s.field, { flex: 1 }]} /><TextInput accessibilityLabel="Episode filter" value={episode} onChangeText={setEpisode} placeholder="All episodes" placeholderTextColor={colors.dim} keyboardType="number-pad" style={[s.field, { flex: 1 }]} /></View><View accessibilityRole="radiogroup" accessibilityLabel="Resolution" style={[t.row, { flexWrap: 'wrap', gap: 8 }]}>{qualities.map(value => <Pill key={value || 'any'} compact label={value || 'Any'} selected={quality === value} onPress={() => setQuality(value)} />)}</View><Pill label="Apply filters" compact disabled={busy} style={{ alignSelf: 'flex-start' }} onPress={() => void run(() => findReleases(selected!))} /></View>}
        {(kind === 'show' || kind === 'anime' && releases.some(item => item.downloadKind === 'show')) && <View style={{ gap: 12, marginBottom: 14 }}>
          {kind === 'anime' && <TextInput accessibilityLabel="Season" value={season} onChangeText={setSeason} placeholder="Season 1" placeholderTextColor={colors.dim} keyboardType="number-pad" style={s.field} />}
          <Pill label="Find season download" compact disabled={busy} onPress={() => findSeason()} />
          {seasonNotice ? <Text accessibilityLiveRegion="polite" style={t.muted}>{seasonNotice}</Text> : null}
          {seasonDownload && (seasonItem ? <View style={s.release}>
            <View style={{ flex: 1 }}>
              <Text style={t.text}>Season {seasonDownload.season}{seasonDownload.from ? ` from episode ${seasonDownload.from}` : ''} · {seasonItem.quality}</Text>
              <Text style={t.dim}>{seasonDownload.batch ? `${seasonDownload.batch.count} episodes from ${seasonDownload.batch.group} · up to two transfers at a time` : seasonDownload.pack?.title}</Text>
            </View>
            <Pill label={addedSeason === seasonKey ? (seasonDownload.batch ? 'Queued' : 'Added') : 'Download season'} compact disabled={busy || !config.server || addedSeason === seasonKey} onPress={() => {
              const batch = seasonDownload.batch;
              const selectionId = seasonDownload.pack?.selectionId;
              setConfirm({ title: `${selected?.title} · Season ${seasonDownload.season}`, detail: batch ? `${batch.count} episodes · ${batch.quality}` : seasonItem.quality, body: batch ? { seasonDownloadId: batch.id } : selectionId ? { selectionId } : { hash: seasonKey }, seasonKey });
            }} />
          </View> : <Text style={t.dim}>{seasonDownload.expected ? `Found ${seasonDownload.coverage} of ${seasonDownload.expected} listed episodes from a matching release group for Season ${seasonDownload.season}.` : `No numbered episodes are listed for Season ${seasonDownload.season}.`}</Text>)}
          {seasonDownload?.nextPage && <Pill label="Search older releases for this season" compact disabled={busy} onPress={() => findSeason(seasonDownload.nextPage!)} />}
        </View>}
        {busy && !releases.length && !seasonNotice ? <Text style={[t.muted, { marginVertical: 18 }]}>Finding releases…</Text> : null}{!busy && !releases.length ? <Text style={[t.muted, { marginVertical: 18 }]}>No matching releases. Try another filter.</Text> : null}
        {releases.map(release => <View key={release.selectionId || release.hash} style={s.release}><View style={{ flex: 1 }}><Text style={[t.text, { fontFamily: fonts.medium }]}>{release.quality}{release.codec ? ' · ' + release.codec.toUpperCase() : ''}</Text><Text style={[t.dim, { marginTop: 5 }]}>{release.size} · {release.seeds || 0} seeds{release.episode ? ` · S${release.season ?? 1} E${release.episode}` : release.absoluteEpisode ? ` · Episode ${release.absoluteEpisode}` : ''}</Text>{release.releaseTitle ? <Text numberOfLines={2} style={t.dim}>{release.releaseTitle}</Text> : null}</View><Pill label="Download" compact disabled={busy || !config.server} onPress={() => setConfirm({ title: `${selected?.title}${selected?.year ? ` (${selected.year})` : ''}`, detail: [release.quality, release.size].filter(Boolean).join(' · '), body: release.selectionId ? { selectionId: release.selectionId } : { hash: release.hash }, seasonKey: '' })} /></View>)}
        {nextPage && <Pill label="More releases" compact onPress={() => void run(() => findReleases(selected!, nextPage))} />}
      </>}
    </ScrollView></View></KeyboardAvoidingView></Modal>
  </KeyboardAvoidingView>;
}
const s = themed(() => StyleSheet.create({
  search: { height: 54, borderRadius: 999, borderWidth: 1, borderColor: colors.hairlineStrong, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 18, paddingRight: 5, backgroundColor: colors.fill },
  input: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 17, paddingVertical: 0 },
  field: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.track, borderRadius: 8, color: colors.text, fontFamily: fonts.regular, fontSize: 14, backgroundColor: colors.fill },
  cardTitle: { color: colors.text, fontFamily: fonts.medium, fontSize: 12.5, marginTop: 8 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 42, paddingHorizontal: 12 },
  transfer: { borderRadius: 16, marginBottom: 14, minHeight: 160 },
  transferTop: { paddingLeft: 16, paddingRight: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  transferBody: { padding: 16, paddingTop: 10 },
  doneBlock: { marginTop: 8 },
  doneHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.hairline },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  sheet: { maxHeight: '85%', borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: 22, paddingTop: 12 },
  release: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 16, borderTopWidth: 1, borderTopColor: colors.hairline },
}));
