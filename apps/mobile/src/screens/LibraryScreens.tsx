import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { request, type Item, type Library, type ScannerStatus } from '../lib/server';
import { loadRecents, saveRecents } from '../lib/storage';
import { plural, rememberQuery } from '../lib/text';
import { titleShelves } from '../../../../packages/core/client/title-shelves.js';
import { metadataFor, nameFor, statusOf, titleKey } from '../../../../packages/core/client/library';
import { colors, fonts, radius } from '../theme';
import { Chip, Icon, MediaArt, Pill, styles as t } from '../components/Matro';
import { ContinueRow, FeaturedReel, PosterCard, Shelf, gridCardWidth, gridColumns, type ArtProps } from '../components/LibraryParts';

type Layout = { top: number; bottom: number };
const content = (insets: Layout) => ({ paddingTop: insets.top + 76, paddingBottom: insets.bottom + 120, paddingHorizontal: 18 });
const kindNames = { show: ['Shows', 'show'], movie: ['Movies', 'title'], audio: ['Music & audio', 'file'] } as const;

/** Library / Movies / Shows / Music / Folders: the artboard's chips, one level above the dock. */
export function LibraryChips({ tab, audio, admin, onPick }: { tab: string; audio: boolean; admin: boolean; onPick: (tab: string) => void }) {
  const chips = [['home', 'All'], ['movie', 'Movies'], ['show', 'Shows'], ...(audio ? [['audio', 'Music']] : []), ...(admin ? [['folders', 'Folders']] : [])];
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>
    {chips.map(([id, label]) => <Chip key={id} label={label} selected={tab === id} onPress={() => onPick(id)} />)}
  </ScrollView>;
}

type HomeProps = ArtProps & { data: Library; groups: Item[][]; featured: Item[][]; continues: Item[]; layout: Layout; chips: ReactNode; refreshing: boolean; onRefresh: () => void;
  onPlay: (item: Item) => void; onOpen: (items: Item[]) => void; onRemoveContinue: (item: Item) => void; onSeeAll: (tab: string) => void; onAddFolder: () => void };
/** Home: reel first so Play is on screen, then Continue watching, then one short shelf per kind. */
export function HomeView({ data, groups, featured, continues, layout, chips, refreshing, onRefresh, onPlay, onOpen, onRemoveContinue, onSeeAll, onAddFolder, ...art }: HomeProps) {
  const shelves = (['show', 'movie', 'audio'] as const).map(kind => ({ kind, all: groups.filter(items => items[0].kind === kind) })).filter(shelf => shelf.all.length);
  return <ScrollView contentContainerStyle={content(layout)} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} progressViewOffset={layout.top + 70} />}>
    <View style={{ marginBottom: 20 }}>{chips}</View>
    {!data.items.length ? <View style={{ minHeight: 420, justifyContent: 'center', gap: 18 }}><Text style={t.dim}>Matro · your library</Text><Text style={[t.display, { fontSize: 38, lineHeight: 40 }]}>Your collection.{'\n'}Your kind of player.</Text><Text style={t.muted}>All your films, shows and favourite files in one quiet place. Add a folder on your server to build your library.</Text>{data.user.role === 'admin' && <Pill label="Add folder" icon="folder" onPress={onAddFolder} primary />}</View> : <>
      <FeaturedReel key={`${art.base}:${featured.length}`} {...art} data={data} groups={featured} onPlay={onPlay} onDetail={item => onOpen(groups.find(items => titleKey(items[0]) === titleKey(item)) || [item])} />
      <ContinueRow {...art} data={data} items={continues} onPlay={onPlay} onRemove={onRemoveContinue} />
      {titleShelves(groups, data.lists, titleKey, item => metadataFor(data, item)).map(shelf => <Shelf key={shelf.id} title={shelf.name} count={shelf.groups.length} noun="titles" onSeeAll={() => onSeeAll('list:' + shelf.id)}>
        {shelf.groups.slice(0, 8).map(items => <PosterCard key={titleKey(items[0])} {...art} data={data} items={items} width={128} onPress={() => onOpen(items)} />)}
      </Shelf>)}
      {shelves.map(({ kind, all }) => <Shelf key={kind} title={kindNames[kind][0]} count={all.length} noun={kindNames[kind][0].toLowerCase()} onSeeAll={() => onSeeAll(kind)}>
        {all.slice(0, 8).map(items => <PosterCard key={titleKey(items[0])} {...art} data={data} items={items} width={128} onPress={() => onOpen(items)} />)}
      </Shelf>)}
    </>}
  </ScrollView>;
}

const filters = [['all', 'All'], ['new', 'Unwatched'], ['progress', 'In progress'], ['done', 'Watched']] as const;
const sorts = [['az', 'A–Z'], ['added', 'Recently added'], ['year', 'Year']] as const;
type Sort = typeof sorts[number][0];
/** A poster grid (Movies, Shows, Music or one folder) with one scrolling row of status filters and sorts. */
export function BrowseView({ data, groups, kind, title, layout, chips, refreshing, onRefresh, onOpen, ...art }: ArtProps & { data: Library; groups: Item[][]; kind?: string; title?: string; layout: Layout; chips: ReactNode; refreshing: boolean; onRefresh: () => void; onOpen: (items: Item[]) => void }) {
  const [filter, setFilter] = useState<string>('all'), [sort, setSort] = useState<Sort>('az');
  const { width } = useWindowDimensions(), columns = gridColumns(width), cardWidth = gridCardWidth(width, columns);
  const added = (items: Item[]) => Math.max(0, ...items.map(item => item.added || 0));
  const shown = useMemo(() => {
    const order: Record<Sort, (a: Item[], b: Item[]) => number> = {
      az: (a, b) => nameFor(data, a[0]).localeCompare(nameFor(data, b[0])),
      added: (a, b) => added(b) - added(a),
      year: (a, b) => Number(metadataFor(data, b[0]).year || 0) - Number(metadataFor(data, a[0]).year || 0),
    };
    return groups.filter(items => filter === 'all' || statusOf(data, items) === filter).sort(order[sort]);
  }, [groups, data, filter, sort]);
  const noun = kind === 'show' ? 'show' : 'title';
  return <FlatList key={columns} data={shown} numColumns={columns} keyExtractor={items => titleKey(items[0])} contentContainerStyle={content(layout)} columnWrapperStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} progressViewOffset={layout.top + 70} />}
    ListHeaderComponent={<View style={{ marginBottom: 18 }}>
      {chips}
      {title ? <Text accessibilityRole="header" style={[t.heading, { marginTop: 20 }]} numberOfLines={2}>{title}</Text> : null}
      <Text style={[t.muted, { marginTop: title ? 6 : 16 }]}>{plural(groups.length, noun)}{filter !== 'all' ? ` · ${shown.length} shown` : ''}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginTop: 14 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 8, alignItems: 'center' }}>
        {filters.map(([value, label]) => <Chip key={value} label={label} small selected={filter === value} onPress={() => setFilter(value)} />)}
        <View style={s.divider} />
        {sorts.map(([value, label]) => <Chip key={value} label={label} small selected={sort === value} onPress={() => setSort(value)} />)}
      </ScrollView>
      {kind === 'show' && data.user.role === 'admin' && <ShowScanStatus key={art.base} base={art.base} initial={data.scanner} />}
    </View>}
    ListEmptyComponent={<Text style={t.muted}>No titles match this filter.</Text>} renderItem={({ item: items }) => <PosterCard {...art} data={data} items={items} width={cardWidth} onPress={() => onOpen(items)} />} />;
}

/** Admin-only, one line: how far the intro and outro scan has got. */
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
  const { ready, total } = scan;
  return <View style={s.scan} accessible accessibilityLabel={total > 0 ? `Checking intros and outros, ${ready} of ${total} episodes` : 'Checking intros and outros'}>
    <Text style={[t.dim, { fontSize: 12 }]}>{total > 0 ? `Checking intros & outros · ${ready} of ${total}` : 'Checking intros & outros…'}</Text>
    {total > 0 && <View style={s.scanTrack}><View style={[s.scanFill, { width: `${100 * ready / total}%` }]} /></View>}
  </View>;
}

const searchKinds = [['all', 'All'], ['movie', 'Movies'], ['show', 'Shows'], ['audio', 'Music']] as const;
/** Search: idle shows Recent and a hint; results (artboard rows) appear only once there is a query or a filter. */
export function SearchView({ data, groups, layout, onOpen, ...art }: ArtProps & { data: Library; groups: Item[][]; layout: Layout; onOpen: (items: Item[]) => void }) {
  const [query, setQuery] = useState(''), [kind, setKind] = useState<string>('all'), [unwatched, setUnwatched] = useState(false), [recents, setRecents] = useState<string[]>([]);
  useEffect(() => { void loadRecents().then(setRecents); }, []);
  const remember = (text: string) => setRecents(list => { const next = rememberQuery(list, text); if (next !== list) void saveRecents(next); return next; });
  const kinds = searchKinds.filter(([id]) => id === 'all' || groups.some(items => items[0].kind === id));
  const text = query.toLowerCase().trim(), searching = !!text || kind !== 'all' || unwatched;
  const results = useMemo(() => !searching ? [] : groups.filter(items => (kind === 'all' || items[0].kind === kind) && (!unwatched || statusOf(data, items) === 'new')
    && (!text || `${nameFor(data, items[0])} ${metadataFor(data, items[0]).people?.join(' ')} ${items.map(i => i.title + ' ' + i.path).join(' ')}`.toLowerCase().includes(text))), [groups, data, kind, unwatched, text, searching]);
  const open = (items: Item[]) => { remember(query); onOpen(items); };
  const meta = (items: Item[]) => { const item = items[0], m = metadataFor(data, item); return [item.kind === 'show' ? 'Series' : item.kind === 'audio' ? 'Music' : 'Movie', m.year, item.kind === 'show' ? plural(new Set(items.map(i => i.season)).size, 'season') : ''].filter(Boolean).join(' · '); };
  const tags = (items: Item[]) => [...new Set(items.map(i => i.format))].slice(0, 3).concat(statusOf(data, items) === 'new' ? ['Unwatched'] : statusOf(data, items) === 'done' ? ['Watched'] : ['In progress']);
  return <FlatList data={results} keyExtractor={items => titleKey(items[0])} contentContainerStyle={content(layout)} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    ListHeaderComponent={<View style={{ gap: 16, marginBottom: 14 }}>
      <Text accessibilityRole="header" style={t.heading}>Search</Text>
      <View style={s.search}><Icon name="search" color={colors.muted} />
        <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => remember(query)} accessibilityLabel="Search library" placeholder="Titles, people, files" placeholderTextColor={colors.dim} style={s.searchInput} returnKeyType="search" autoCorrect={false} />
        {!!query && <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" style={s.clear}><Icon name="close" size={18} /></Pressable>}</View>
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 8, alignItems: 'center' }}>
        {kinds.map(([id, label]) => <Chip key={id} label={label} selected={kind === id} onPress={() => setKind(id)} />)}
        <View style={s.divider} /><Chip label="Unwatched" selected={unwatched} onPress={() => setUnwatched(value => !value)} />
      </ScrollView>
      {searching ? <Text style={t.muted} accessibilityLiveRegion="polite">{plural(results.length, 'title')}{text ? ` for “${query.trim()}”` : ''}</Text> : null}
    </View>}
    ListEmptyComponent={searching ? <Text style={[t.muted, { textAlign: 'center', marginTop: 28 }]}>Nothing in your library matches. Check the spelling, or try part of a title or file name.</Text>
      : <View>
        {recents.length > 0 && <>
          <View style={t.sectionHeading}><Text accessibilityRole="header" style={t.sectionTitle}>Recent</Text><Pressable onPress={() => { setRecents([]); void saveRecents([]); }} accessibilityRole="button" accessibilityLabel="Clear recent searches" hitSlop={8} style={s.textButton}><Text style={t.dim}>Clear</Text></Pressable></View>
          {recents.map(entry => <Pressable key={entry} onPress={() => setQuery(entry)} accessibilityRole="button" accessibilityLabel={`Search for ${entry}`} style={s.recent}><View style={s.recentIcon}><Icon name="search" size={18} color={colors.muted} /></View><Text style={[t.text, { fontSize: 15, fontFamily: fonts.medium }]}>{entry}</Text></Pressable>)}
        </>}
        <Text style={[t.dim, { marginTop: 18, lineHeight: 19 }]}>Search looks through titles, people and file names in your library.</Text>
      </View>}
    renderItem={({ item: items }) => <Pressable onPress={() => open(items)} accessibilityRole="button" accessibilityLabel={`Open ${nameFor(data, items[0])}`} style={({ pressed }) => [s.result, pressed && { opacity: .7 }]}>
      <MediaArt {...art} sheen path={metadataFor(data, items[0]).poster} title={nameFor(data, items[0])} style={{ width: 56, height: 84, borderRadius: radius.poster }} />
      <View style={{ flex: 1, gap: 3 }}><Text numberOfLines={2} style={[t.text, { fontSize: 15, fontFamily: fonts.semibold }]}>{nameFor(data, items[0])}</Text><Text numberOfLines={1} style={t.dim}>{meta(items)}</Text>
        <View style={s.tags}>{tags(items).map(tag => <Text key={tag} style={s.tag}>{tag}</Text>)}</View></View>
    </Pressable>} />;
}

const s = StyleSheet.create({
  divider: { width: 1, height: 24, backgroundColor: colors.hairlineStrong, marginHorizontal: 4 },
  scan: { marginTop: 14, gap: 6 }, scanTrack: { height: 3, borderRadius: 2, backgroundColor: colors.hairline }, scanFill: { height: 3, borderRadius: 2, backgroundColor: colors.muted },
  search: { height: 52, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 4, gap: 12, backgroundColor: colors.chip },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, fontFamily: fonts.regular, paddingVertical: 0 }, clear: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6, marginVertical: -12 },
  recent: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14 }, recentIcon: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  result: { flexDirection: 'row', gap: 14, paddingVertical: 8 }, tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  tag: { color: colors.soft, fontFamily: fonts.medium, fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.chip, overflow: 'hidden' },
});
