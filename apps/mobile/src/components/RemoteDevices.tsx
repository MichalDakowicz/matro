import { useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field } from '../ui';
import { colors, themed } from '../theme';
import { isAndroidTv } from './TvFocus';
import { IconButton, Pill, styles as t } from './Matro';
import type { RemoteController, RemotePlayback, RemoteState } from '../../../../packages/core/client/remote';

export type RemoteTransfer = Pick<RemotePlayback, 'itemId' | 'position'> & { pause?: () => Promise<void> };

export function RemoteDevices({ visible, onClose, remote, state, outgoing, continueHere, title }: {
  visible: boolean; onClose: () => void; remote: RemoteController; state: RemoteState;
  outgoing?: { label: string; snapshot: () => RemoteTransfer | null };
  continueHere: (playback: RemotePlayback) => Promise<void>; title: (id: string) => string | undefined;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(Platform.isTV ? 'Android TV' : 'Android');
  const [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const device = state.devices.find(peer => peer.id === selected) || state.devices[0];
  const playing = device?.playback;

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not reach that device.'); }
    finally { setBusy(false); }
  }

  function send(action: 'play' | 'pause' | 'seek', delta = 0) {
    if (!device || !playing) return;
    void run(() => remote.command(device.id, action === 'seek'
      ? { action, itemId: playing.itemId, position: Math.max(0, playing.position + delta) }
      : { action, itemId: playing.itemId }));
  }

  function moveOut() {
    if (!device || !outgoing) return;
    void run(async () => {
      const transfer = outgoing.snapshot();
      if (!transfer) throw new Error('This playback is no longer available.');
      await remote.command(device.id, { action: 'start', itemId: transfer.itemId, position: transfer.position });
      await transfer.pause?.();
      setMessage(`Playing on ${device.name}.`);
    });
  }

  function moveHere() {
    if (!device || !playing) return;
    void run(async () => {
      await continueHere(playing);
      try { await remote.command(device.id, { action: 'pause', itemId: playing.itemId }); onClose(); }
      catch { throw new Error(`Playing here. Pause ${device.name} on that device.`); }
    });
  }

  return <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
    <View style={[s.backdrop, { paddingBottom: insets.bottom + 16 }]}>
      <View style={s.panel}>
        <View style={t.sectionHeading}>
          <Text style={t.sectionTitle}>Connected devices</Text>
          <IconButton name="close" preferredFocus={isAndroidTv} label="Close connected devices" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Text style={t.muted}>Devices signed in to this Matro server can control playback here while remote playback is enabled.</Text>
          {!state.enabled && <Field value={name} onChangeText={setName} maxLength={48} accessibilityLabel="This device’s name" placeholder="This device’s name" />}
          <Pill label={state.enabled ? 'Disable remote playback' : 'Enable remote playback'} disabled={busy || !name.trim()} onPress={() => {
            if (state.enabled) { remote.disable(); setMessage(''); }
            else void run(() => remote.enable(name.trim()));
          }} />
          {state.enabled && <>
            <Text style={t.sectionTitle}>Other devices</Text>
            {state.devices.map(peer => <Pill key={peer.id} label={peer.name} primary={device?.id === peer.id} onPress={() => { setMessage(''); setSelected(peer.id); }} />)}
            <Text style={t.muted}>{playing ? `${title(playing.itemId) || 'Title open'} · ${playing.playing ? 'Playing' : 'Paused'}`
              : device ? 'Ready to play' : 'Enable remote playback on another device signed in to this account.'}</Text>
            {outgoing && <Pill label={outgoing.label} primary disabled={busy || !device} onPress={moveOut} />}
            {playing && <>
              <Pill label="Continue on this device" disabled={busy} onPress={moveHere} />
              <View style={[t.row, { flexWrap: 'wrap' }]}>
                <Pill label="Play" disabled={busy} onPress={() => send('play')} />
                <Pill label="Pause" disabled={busy} onPress={() => send('pause')} />
                <Pill label="Back 10 s" disabled={busy} onPress={() => send('seek', -10)} />
                <Pill label="Ahead 10 s" disabled={busy} onPress={() => send('seek', 10)} />
              </View>
            </>}
          </>}
          <Text accessibilityLiveRegion="polite" style={t.muted}>{busy ? 'Sending to Matro…' : message || state.error}</Text>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const s = themed(() => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: colors.scrim },
  panel: { width: '100%', maxWidth: 530, maxHeight: '90%', padding: 18, borderRadius: 22, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.panel },
  content: { gap: 12 },
}));
