import { Text, View } from 'react-native';
import { KEEP_CHOICES, CAP_CHOICES, type Batch, type SmartRule, type SmartSettings } from '../lib/smart-plan';
import { Pill, styles as t } from './Matro';

const choice = { height: 44, paddingHorizontal: 16, minWidth: 56 } as const;

/** On a show's page: how many unwatched episodes Matro keeps saved, and whether it clears them once watched. */
export function SmartKeep({ rule, onChange }: { rule?: SmartRule; onChange: (rule: SmartRule | null) => void }) {
  return <View style={{ marginBottom: 14, gap: 10 }}>
    <Text accessibilityRole="header" style={t.sectionTitle}>Keep next episodes saved</Text>
    <Text style={t.dim}>Whenever your server is reachable, Matro saves the next unwatched episodes in order. Unwatched episodes are never removed.</Text>
    <View style={[t.row, { flexWrap: 'wrap', gap: 8 }]}>
      <Pill label="Off" style={choice} primary={!rule} onPress={() => onChange(null)} />
      {KEEP_CHOICES.map(keep => <Pill key={keep} label={String(keep)} style={choice} primary={rule?.keep === keep} onPress={() => onChange({ keep, removeWatched: rule?.removeWatched ?? false })} />)}
    </View>
    {rule && <Pill label={rule.removeWatched ? 'Removing watched episodes' : 'Keep watched episodes'} icon={rule.removeWatched ? 'check' : undefined} style={{ ...choice, alignSelf: 'flex-start' }} onPress={() => onChange({ ...rule, removeWatched: !rule.removeWatched })} />}
  </View>;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** On the Saved screen: the storage cap, the shows being kept ready, and controls for whole batches. */
export function SmartSaves({ settings, names, batches, offline, onCap, onStop, onPause, onResume, onCancel }: {
  settings: SmartSettings; names: Record<string, string>; batches: Batch[]; offline: boolean;
  onCap: (bytes: number | null) => void; onStop: (key: string) => void; onPause: (id: string) => void; onResume: (id: string) => void; onCancel: (id: string) => void;
}) {
  const rules = Object.entries(settings.rules);
  if (!rules.length && !batches.length) return null;
  return <View style={{ gap: 22 }}>
    {!!batches.length && <View style={{ gap: 14 }}>
      <Text accessibilityRole="header" style={t.sectionTitle}>Batches</Text>
      {batches.map(batch => <View key={batch.id} style={{ gap: 8 }}>
        <Text style={t.text}>{batch.label}</Text>
        <Text style={t.dim}>{[batch.waiting && `${batch.waiting} saving or waiting`, batch.paused && `${batch.paused} paused`].filter(Boolean).join(' · ')}</Text>
        <View style={[t.row, { flexWrap: 'wrap', gap: 8 }]}>
          {batch.waiting > 0 && <Pill label="Pause all" style={choice} onPress={() => onPause(batch.id)} />}
          {batch.paused > 0 && <Pill label="Resume all" style={choice} disabled={offline} onPress={() => onResume(batch.id)} />}
          <Pill label="Cancel all" style={choice} onPress={() => onCancel(batch.id)} />
        </View>
      </View>)}
    </View>}
    {!!rules.length && <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={t.sectionTitle}>Kept ready</Text>
      <Text style={t.dim}>Storage cap for saved titles. Matro stops adding episodes when it is reached and never removes anything you saved yourself.</Text>
      <View style={[t.row, { flexWrap: 'wrap', gap: 8 }]}>{CAP_CHOICES.map(([label, bytes]) => <Pill key={label} label={label} style={choice} primary={settings.capBytes === bytes} onPress={() => onCap(bytes)} />)}</View>
      {rules.map(([key, rule]) => <View key={key} style={[t.row, { justifyContent: 'space-between' }]}>
        <View style={{ flex: 1 }}><Text style={t.text} numberOfLines={1}>{names[key] || 'Show'}</Text><Text style={t.dim}>{`Next ${count(rule.keep, 'episode')}${rule.removeWatched ? ' · removes watched' : ''}`}</Text></View>
        <Pill label="Stop" style={choice} onPress={() => onStop(key)} />
      </View>)}
    </View>}
  </View>;
}
