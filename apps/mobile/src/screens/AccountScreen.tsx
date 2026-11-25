import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import type { Library } from '../lib/server';
import { changePassword, createInvite, listInvites, listPeople, removePerson, resetPassword, revokeInvite, type Invite, type Person } from '../lib/admin';
import { colors, fonts } from '../theme';
import { Field } from '../ui';
import { Pill, Row, SectionLabel, Sheet, styles as t } from '../components/Matro';

type Props = { base: string; data: Library; layout: { top: number; bottom: number }; admin: boolean; onPasswordChanged: () => Promise<void>; notify: (text: string) => void };
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const failure = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

/** Mirrors the web profile: everyone can change their password; the head account also sees the people on the server and their invite codes. */
export default function AccountScreen({ base, data, layout, admin, onPasswordChanged, notify }: Props) {
  const [current, setCurrent] = useState(''), [fresh, setFresh] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [people, setPeople] = useState<Person[]>([]), [invites, setInvites] = useState<Invite[]>([]), [loadError, setLoadError] = useState('');
  const [resetFor, setResetFor] = useState<Person | null>(null), [reset, setReset] = useState(''), [code, setCode] = useState<{ code: string; expires: number } | null>(null);

  const load = useCallback(async () => {
    if (!admin) return;
    try { const [users, list] = await Promise.all([listPeople(base), listInvites(base)]); setPeople(users); setInvites(list); setLoadError(''); }
    catch (e) { setLoadError(failure(e, 'Couldn’t load the people on this server.')); }
  }, [base, admin]);
  useEffect(() => { void load(); }, [load]);
  const act = async (action: () => Promise<void>, fallback: string) => { try { await action(); } catch (e) { notify(failure(e, fallback)); } };

  const savePassword = async () => {
    setBusy(true); setError('');
    try { await changePassword(base, current, fresh); await onPasswordChanged(); setCurrent(''); setFresh(''); notify('Password changed. Other devices were signed out.'); }
    catch (e) { setError(failure(e, 'Couldn’t change the password.')); }
    finally { setBusy(false); }
  };
  const confirmRemove = (person: Person) => Alert.alert(`Remove ${person.username}?`, 'Their watch history and settings go too. Subtitles they added stay.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => void act(async () => { await removePerson(base, person.id); await load(); notify(`${person.username} was removed.`); }, 'Couldn’t remove this account.') },
  ], { cancelable: true });
  const invite = () => void act(async () => { setCode(await createInvite(base)); await load(); }, 'Couldn’t create an invite code.');

  return <ScrollView contentContainerStyle={{ paddingTop: layout.top + 76, paddingBottom: layout.bottom + 120, paddingHorizontal: 18 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    <Text accessibilityRole="header" style={t.heading}>Account</Text>
    <Text style={[t.muted, { marginTop: 8 }]}>{data.user.username} · {admin ? 'Head account' : 'Viewer'}</Text>

    <SectionLabel>Password</SectionLabel>
    <View style={s.form}>
      <Field accessibilityLabel="Current password" placeholder="Current password" secureTextEntry autoCapitalize="none" autoComplete="current-password" value={current} onChangeText={setCurrent} />
      <Field accessibilityLabel="New password" placeholder="New password (8 or more characters)" secureTextEntry autoCapitalize="none" autoComplete="new-password" value={fresh} onChangeText={setFresh} />
      {error ? <Text accessibilityRole="alert" style={[t.muted, { color: colors.warn }]}>{error}</Text> : null}
      <Pill label={busy ? 'Changing…' : 'Change password'} disabled={busy || !current || fresh.length < 8} onPress={() => void savePassword()} style={{ alignSelf: 'flex-start' }} />
    </View>

    {admin && <>
      <SectionLabel>People</SectionLabel>
      <Text style={t.dim}>Viewers keep their own progress and choices and can add subtitles. Only you can add or remove films and shows.</Text>
      {loadError ? <Text accessibilityRole="alert" style={[t.muted, { color: colors.warn, marginTop: 10 }]}>{loadError}</Text> : null}
      <View style={{ marginTop: 8 }}>{people.map(person => <View key={person.id} style={s.person}>
        <View style={{ flex: 1 }}>
          <Text style={[t.text, { fontFamily: fonts.medium }]}>{person.username}</Text>
          <Text style={t.dim}>{person.role === 'admin' ? 'Head account' : `Viewer${person.lastWatched ? ` · last watched ${day(person.lastWatched)}` : ''} · ${person.subtitles} subtitle file${person.subtitles === 1 ? '' : 's'} added`}</Text>
        </View>
        {person.role !== 'admin' && <View style={s.actions}>
          <Pill label="Reset password" accessibilityLabel={`Reset password for ${person.username}`} compact onPress={() => { setReset(''); setResetFor(person); }} />
          <Pill label="Remove" accessibilityLabel={`Remove ${person.username}`} compact onPress={() => confirmRemove(person)} />
        </View>}
      </View>)}</View>

      <SectionLabel>Invites</SectionLabel>
      <Text style={t.dim}>A code works once. The person you invite chooses their own username and password.</Text>
      <View style={{ marginTop: 8 }}>{invites.map(item => <View key={item.id} style={s.person}>
        <View style={{ flex: 1 }}>
          <Text style={[t.text, { fontFamily: fonts.medium }]}>{item.status === 'used' ? `Used by ${item.usedBy || 'a removed account'}` : item.status === 'expired' ? 'Expired' : 'Waiting to be used'}</Text>
          <Text style={t.dim}>{item.status === 'used' && item.usedAt ? `Joined ${day(item.usedAt)}` : `Created ${day(item.created)} · ${item.status === 'expired' ? 'ended' : 'valid until'} ${day(item.expires)}`}</Text>
        </View>
        {item.status === 'waiting' && <Pill label="Revoke" compact onPress={() => void act(async () => { await revokeInvite(base, item.id); await load(); }, 'Couldn’t revoke this code.')} />}
      </View>)}</View>
      <Pill label="Create invite code" icon="plus" primary onPress={invite} style={{ marginTop: 14, alignSelf: 'flex-start' }} />
    </>}

    <Sheet visible={!!resetFor} onClose={() => setResetFor(null)} title={`Reset password for ${resetFor?.username || ''}`}>
      <Text style={t.muted}>They are signed out everywhere. Give them the new password.</Text>
      <Field accessibilityLabel={`New password for ${resetFor?.username || 'this account'}`} placeholder="New password (8 or more characters)" autoCapitalize="none" autoCorrect={false} value={reset} onChangeText={setReset} style={{ marginTop: 12 }} />
      <Pill label="Set password" accessibilityLabel={`Set password for ${resetFor?.username || 'this account'}`} primary disabled={reset.length < 8} style={{ marginTop: 14 }} onPress={() => void act(async () => {
        if (!resetFor) return;
        await resetPassword(base, resetFor.id, reset); setResetFor(null); notify(`${resetFor.username} was signed out everywhere. Give them the new password.`);
      }, 'Couldn’t reset the password.')} />
    </Sheet>
    <Sheet visible={!!code} onClose={() => setCode(null)} title="Invite code">
      <Text style={t.muted}>Send this to the person you are inviting. It works once and stops working on {code ? day(code.expires) : ''}. This is the only time the code is shown.</Text>
      <Text selectable style={s.code}>{code?.code}</Text>
      <Row icon="arrows" label="Share the code" onPress={() => { if (code) void Share.share({ message: `Your Matro invite code: ${code.code}` }).catch(() => {}); }} last />
    </Sheet>
  </ScrollView>;
}
const s = StyleSheet.create({
  form: { gap: 10, maxWidth: 460 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.hairline, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  code: { color: colors.text, fontFamily: fonts.mono, fontSize: 24, letterSpacing: 1.5, marginVertical: 18 },
});
