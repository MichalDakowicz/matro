import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { login, ServerError, signup, type MatroUser } from '../lib/server';
import { ErrorLine, Field, Page, PrimaryPill, SecondaryPill, TextButton } from '../ui';

type Props = { base: string; setup: boolean; onSignedIn: (user: MatroUser) => void; onChangeServer: () => void };

/** Same two forms as the web sign-in page: sign in, or join with a one-time invite code. */
export default function LoginScreen({ base, setup, onSignedIn, onChangeServer }: Props) {
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(''), [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const userRef = useRef<TextInput>(null);
  const passRef = useRef<TextInput>(null);
  const host = base.replace(/^https?:\/\//, '');

  if (setup) {
    return (
      <Page kicker="Matro · first run" title="This server needs setting up." lede={`Create the head account on the machine that runs Matro with npm run setup --workspace @matro/server, then come back and sign in to ${host}.`}>
        <PrimaryPill label="Back" onPress={onChangeServer} />
      </Page>
    );
  }

  async function submit() {
    setError(''); setHint('');
    setBusy(true);
    try {
      const { user } = joining ? await signup(base, code.trim(), username.trim(), password) : await login(base, username.trim(), password);
      onSignedIn(user);
    } catch (e) {
      if (e instanceof ServerError) {
        setError(e.message);
        setHint(e.status === 429 ? 'Too many attempts. Wait a minute, then try again.'
          : joining ? 'Check the invite code. Each code works once; ask whoever runs the server for a new one.'
          : e.status === 401 || e.status === 403 ? 'Check your username and password.' : '');
      } else {
        setError(`Couldn't reach ${host}.`);
        setHint('Check your connection and that the server is running.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      kicker={joining ? 'Matro · you are invited' : 'Matro · welcome back'}
      title={joining ? 'Create your account.' : 'Sign in to watch.'}
      lede={joining ? 'Enter the one-time code you were sent, then choose your own username and password.' : `Signing in to ${host}. Your progress, dubs and subtitle choices follow your account on every device.`}
    >
      {joining && (
        <Field value={code} onChangeText={setCode} placeholder="Invite code, e.g. ABCD-EFGH-JKMN" autoCapitalize="characters" autoCorrect={false} maxLength={20} returnKeyType="next" onSubmitEditing={() => userRef.current?.focus()} accessibilityLabel="Invite code" />
      )}
      <Field ref={userRef} value={username} onChangeText={setUsername} placeholder="Username" autoCapitalize="none" autoCorrect={false} maxLength={32} textContentType="username" autoComplete="username" returnKeyType="next" onSubmitEditing={() => passRef.current?.focus()} accessibilityLabel="Username" />
      <Field ref={passRef} value={password} onChangeText={setPassword} placeholder={joining ? 'Choose a password (8 or more characters)' : 'Password'} secureTextEntry textContentType={joining ? 'newPassword' : 'password'} autoComplete={joining ? 'new-password' : 'current-password'} returnKeyType="go" onSubmitEditing={submit} accessibilityLabel="Password" />
      <ErrorLine text={error} hint={hint} />
      <PrimaryPill label={joining ? 'Create account' : 'Sign in'} onPress={submit} busy={busy} />
      <SecondaryPill label={joining ? 'I already have an account' : 'I have an invite code'} onPress={() => { setJoining(!joining); setError(''); setHint(''); }} />
      <TextButton label={`Not ${host}? Change server`} onPress={onChangeServer} />
    </Page>
  );
}
