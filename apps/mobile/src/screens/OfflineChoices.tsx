import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton, Pill, styles as t } from '../components/Matro';
import { inspect, type Info, type Item, type TrackPreference } from '../lib/server';
import type { OfflineChoice } from '../lib/offline';
import { colors } from '../theme';
import { languageName } from '../../../../packages/core/client/library';
import { matchOfflineTrack } from '../../../../packages/core/client/offline-rules.js';
import { qualityOptions } from '../../../../packages/core/client/quality.js';

const name = (track: { language: string; title?: string }) => [languageName(track.language), track.title].filter(Boolean).join(' · ');

export default function OfflineChoices({ base, items, preferred, close, save }: {
  base: string; items: Item[]; preferred?: TrackPreference; close: () => void; save: (choices: Map<string, OfflineChoice>) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [first, setFirst] = useState<Info | null>(null), [error, setError] = useState('');
  const [choice, setChoice] = useState<OfflineChoice>({ audio: null, burn: null, quality: 'original' });
  const [saving, setSaving] = useState(false);
  const firstId = items[0].id;
  const preferredAudio = preferred?.audio, preferredSubtitle = preferred?.subtitle, subtitlesOff = preferred?.off;
  useEffect(() => {
    const run = new AbortController();
    setFirst(null); setError('');
    void inspect(base, firstId, run.signal).then(info => {
      if (run.signal.aborted) return;
      setChoice({
        audio: (matchOfflineTrack(info.audio, preferredAudio) ?? info.audio[0])?.index ?? null,
        burn: subtitlesOff ? null : matchOfflineTrack(info.embedded.filter(track => track.bitmap), preferredSubtitle)?.index ?? null,
        quality: 'original',
      });
      setFirst(info);
    }).catch(reason => { if (!run.signal.aborted) setError(reason.message); });
    return () => run.abort();
  }, [base, firstId, preferredAudio, preferredSubtitle, subtitlesOff]);
  const bitmaps = first?.embedded.filter(track => track.bitmap) ?? [];
  const text = first ? [...first.embedded.filter(track => track.text && !track.bitmap).map(name), ...first.uploaded.map(track => name({ ...track, title: track.name }))] : [];
  async function confirm() {
    if (!first || saving) return;
    setSaving(true); setError('');
    try {
      const audio = first.audio.find(track => track.index === choice.audio);
      const burn = bitmaps.find(track => track.index === choice.burn);
      const choices = new Map([[items[0].id, choice]]);
      for (const item of items.slice(1)) {
        const info = await inspect(base, item.id);
        choices.set(item.id, {
          audio: matchOfflineTrack(info.audio, audio)?.index ?? null,
          burn: matchOfflineTrack(info.embedded.filter(track => track.bitmap), burn)?.index ?? null,
          quality: info.video ? choice.quality : 'original',
        });
      }
      await save(choices);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the download.');
      setSaving(false);
    }
  }
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!saving) close(); }}>
    <ScrollView style={{ flex: 1, backgroundColor: colors.ground }} contentContainerStyle={{ padding: 18, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 24, gap: 12 }}>
      <View style={t.sectionHeading}><Text accessibilityRole="header" style={t.sectionTitle}>Save offline</Text><IconButton name="close" label="Close offline choices" disabled={saving} onPress={close} /></View>
      {first ? <>
        <Text style={t.muted}>{first.audio.length ? 'Audio' : 'No audio tracks'}</Text>
        <View style={[t.row, { flexWrap: 'wrap' }]}>{first.audio.map(track => <Pill key={track.index} label={name(track)} accessibilityLabel={`Audio track: ${name(track)}`} selected={choice.audio === track.index} primary={choice.audio === track.index} disabled={saving} onPress={() => setChoice({ ...choice, audio: track.index })} />)}</View>
        {bitmaps.length > 0 && <><Text style={t.muted}>Burn bitmap subtitles into the video</Text><View style={[t.row, { flexWrap: 'wrap' }]}>
          <Pill label="None" accessibilityLabel="Do not burn subtitles into the video" selected={choice.burn === null} primary={choice.burn === null} disabled={saving} onPress={() => setChoice({ ...choice, burn: null })} />
          {bitmaps.map(track => <Pill key={track.index} label={name(track)} accessibilityLabel={`Burn subtitles: ${name(track)}`} selected={choice.burn === track.index} primary={choice.burn === track.index} disabled={saving} onPress={() => setChoice({ ...choice, burn: track.index })} />)}
        </View></>}
        {first.video && <><Text style={t.muted}>Size preset</Text><View style={[t.row, { flexWrap: 'wrap' }]}>
          {qualityOptions(first.video).map(tier => <Pill key={tier.id} label={tier.label} accessibilityLabel={`Size preset: ${tier.label}`} selected={choice.quality === tier.id} primary={choice.quality === tier.id} disabled={saving} onPress={() => setChoice({ ...choice, quality: tier.id })} />)}
        </View></>}
        <Text style={t.muted}>{text.length ? `Selectable text subtitles · ${text.join(', ')}` : 'No text subtitles'}</Text>
        {items.length > 1 && <Text style={t.muted}>Tracks shown are from the first episode. Other episodes use matching tracks where available, their first audio otherwise, and include their available text subtitles.</Text>}
        <Pill label={saving ? 'Preparing…' : 'Start download'} primary disabled={saving} onPress={() => void confirm()} />
      </> : !error && <ActivityIndicator color={colors.text} />}
      {!!error && <Text accessibilityRole="alert" style={t.text}>{error}</Text>}
    </ScrollView>
  </Modal>;
}
