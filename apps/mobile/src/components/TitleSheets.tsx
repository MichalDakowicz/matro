import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { File } from 'expo-file-system';
import { titleKey } from '../../../../packages/core/client/library';
import type { Item, Metadata } from '../lib/server';
import { assignTmdb, SUBTITLE_KINDS, searchTmdb, setMetadataLanguage, subtitleName, uploadSubtitle, type SubtitleKind, type TmdbMatch } from '../lib/admin';
import { LANGUAGES, languageName } from '../lib/languages';
import { colors, themed } from '../theme';
import { Field } from '../ui';
import { Chip, MediaArt, Pill, Row, SectionLabel, Sheet, styles as t } from './Matro';
import type { ArtProps } from './LibraryParts';

const failure = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

/** Name, language and type for a subtitle file the person just picked. Everyone who watches the title can then choose it in the player. */
export function SubtitleSheet({ base, picked, onClose, onDone }: { base: string; picked: { item: Item; file: File } | null; onClose: () => void; onDone: (message: string) => void }) {
  const [name, setName] = useState(''), [language, setLanguage] = useState('en'), [kind, setKind] = useState<SubtitleKind>('full'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (picked) { setName(subtitleName(picked.file.name)); setError(''); } }, [picked]);
  const send = async () => {
    if (!picked || busy) return;
    setBusy(true); setError('');
    try {
      await uploadSubtitle(base, picked.item.id, picked.file, { name: name.trim(), language, kind });
      onDone(`Added “${name.trim()}”. Pick it in the player’s subtitle list.`); onClose();
    } catch (e) { setError(failure(e, 'Couldn’t upload the subtitles.')); }
    finally { setBusy(false); }
  };
  return <Sheet visible={!!picked} onClose={onClose} title="Add subtitles">
    <Text style={t.muted}>Everyone who watches this title can pick these subtitles. You and the head account can change them later.</Text>
    <Text style={[t.dim, { marginTop: 12 }]} numberOfLines={1}>{picked?.file.name}</Text>
    <SectionLabel>Name shown to everyone</SectionLabel>
    <Field accessibilityLabel="Subtitle name" value={name} onChangeText={setName} maxLength={60} placeholder="e.g. English (fan-timed)" />
    <SectionLabel>Language</SectionLabel>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={{ gap: 8, paddingHorizontal: 22 }}>{LANGUAGES.map(([code, label]) => <Chip key={code} small label={label} selected={language === code} onPress={() => setLanguage(code)} />)}</ScrollView>
    <SectionLabel>Type</SectionLabel>
    <View style={[t.row, { flexWrap: 'wrap' }]}>{SUBTITLE_KINDS.map(([value, label]) => <Chip key={value} small label={label} selected={kind === value} onPress={() => setKind(value)} />)}</View>
    {error ? <Text accessibilityRole="alert" style={[t.muted, { color: colors.warn, marginTop: 14 }]}>{error}</Text> : null}
    <Pill label={busy ? 'Uploading…' : 'Add subtitles'} icon="plus" primary disabled={busy || !name.trim()} onPress={() => void send()} style={{ marginTop: 18 }} />
  </Sheet>;
}

/** Head account only: pick another TMDB entry for a title, clear the match, or change the language TMDB text is fetched in. */
export function MetadataSheet({ base, headers, visible, items, name, onClose, onChanged }: ArtProps & { visible: boolean; items: Item[]; name: string; onClose: () => void; onChanged: (metadata: Record<string, Metadata>, message: string) => void }) {
  const item = items[0], key = titleKey(item), kind = item.kind === 'show' ? 'show' : 'movie';
  const [query, setQuery] = useState(name), [matches, setMatches] = useState<TmdbMatch[] | null>(null), [mode, setMode] = useState<'match' | 'language'>('match'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = useRef(0);
  useEffect(() => { if (visible) { setQuery(name); setMatches(null); setMode('match'); setError(''); } }, [visible]);
  const guard = async (action: () => Promise<void>) => {
    const current = ++run.current;
    setBusy(true); setError('');
    try { await action(); } catch (e) { if (current === run.current) setError(failure(e, 'Couldn’t reach TMDB.')); } finally { if (current === run.current) setBusy(false); }
  };
  const find = () => guard(async () => { setMatches(await searchTmdb(base, kind, query.trim())); });
  const apply = (id: number | null, message: string) => guard(async () => { onChanged(await assignTmdb(base, key, id), message); onClose(); });
  const language = (code: string) => guard(async () => { onChanged(await setMetadataLanguage(base, key, code), `Metadata language set to ${languageName(code)}.`); onClose(); });
  return <Sheet visible={visible} onClose={onClose} title={mode === 'language' ? 'Metadata language' : 'Fix metadata'}>
    {error ? <Text accessibilityRole="alert" style={[t.muted, { color: colors.warn, marginBottom: 10 }]}>{error}</Text> : null}
    {mode === 'language' ? <>
      <Text style={t.muted}>Titles, summaries and episode names come from TMDB in this language, when it has them.</Text>
      <View style={{ marginTop: 8 }}>{LANGUAGES.map(([code, label], index) => <Row key={code} label={label} last={index === LANGUAGES.length - 1} onPress={() => void language(code)} />)}</View>
      <Pill label="Back" compact onPress={() => setMode('match')} style={{ alignSelf: 'flex-start', marginTop: 14 }} />
    </> : <>
      <Text style={t.muted}>Search TMDB for the right {kind === 'show' ? 'series' : 'movie'}. Matro replaces the poster, summary and cast for this title.</Text>
      <Field accessibilityLabel="Search TMDB" value={query} onChangeText={setQuery} onSubmitEditing={() => void find()} returnKeyType="search" style={{ marginTop: 12 }} />
      <Pill label={busy ? 'Searching…' : 'Find on TMDB'} icon="search" primary disabled={busy || !query.trim()} onPress={() => void find()} style={{ marginTop: 10 }} />
      {matches && !matches.length ? <Text style={[t.muted, { marginTop: 14 }]}>No matches. Try another spelling.</Text> : null}
      {matches?.map(match => <View key={match.id} style={s.match}>
        <MediaArt base={base} headers={headers} path={match.thumb || undefined} title={match.title} style={s.thumb} />
        <View style={{ flex: 1, gap: 2 }}><Text style={t.text}>{match.title}{match.year ? ` (${match.year})` : ''}</Text>{match.overview ? <Text numberOfLines={2} style={t.dim}>{match.overview}</Text> : null}</View>
        <Pill label="Use" compact disabled={busy} onPress={() => void apply(match.id, `Matched to “${match.title}”.`)} />
      </View>)}
      <SectionLabel>Other</SectionLabel>
      <Row label="Metadata language" detail="Choose the language TMDB text is fetched in" chevron onPress={() => setMode('language')} />
      <Row label="Remove the match" detail="Go back to the cover Matro generates" destructive last onPress={() => void apply(null, 'Match removed.')} />
    </>}
  </Sheet>;
}
const s = themed(() => StyleSheet.create({
  chips: { marginHorizontal: -22 },
  match: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.hairline },
  thumb: { width: 46, height: 69, borderRadius: 6 },
}));
