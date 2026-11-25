import { useEffect, useState } from 'react';
import { Appearance, View, useColorScheme } from 'react-native';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { forgetServer, loadServer, saveServer } from './lib/storage';
import { logout, status, type Status } from './lib/server';
import LoginScreen from './screens/LoginScreen';
import ServerScreen from './screens/ServerScreen';
import ViewerScreen from './screens/ViewerScreen';
import * as SystemUI from 'expo-system-ui';
import { colors, fontAssets, setPreferredScheme } from './theme';
import { resolveScheme } from './palette';
import { loadThemeChoice, useThemeChoice } from './lib/theme-choice';
import * as SecureStore from 'expo-secure-store';
import { configureTokenStorage } from './lib/server';
import { forgetOfflineAccount, offlineLibrary } from './lib/offline';
import { forgetMovieRequestAlerts } from './lib/movie-request-alerts';

const tokenKey = (base: string) => 'matro.session.' + Array.from(base).map(c => c.charCodeAt(0).toString(16)).join('');
configureTokenStorage({
  get: base => SecureStore.getItemAsync(tokenKey(base)),
  set: (base, token) => token ? SecureStore.setItemAsync(tokenKey(base), token) : SecureStore.deleteItemAsync(tokenKey(base)),
});

type Route =
  | { name: 'boot' }
  | { name: 'server'; initial?: string; notice?: string }
  | { name: 'login'; base: string; setup: boolean }
  | { name: 'viewer'; base: string };

export default function App() {
  const [fontsReady] = useFonts(fontAssets);
  const [route, setRoute] = useState<Route>({ name: 'boot' });
  const choice = useThemeChoice(), [themeReady, setThemeReady] = useState(false);
  const scheme = resolveScheme(choice, useColorScheme());
  setPreferredScheme(scheme); // before any child renders, so every colors.* read below follows it
  useEffect(() => { void loadThemeChoice().finally(() => setThemeReady(true)); }, []);
  // Native dialogs, the keyboard and the window background follow the choice too.
  useEffect(() => { Appearance.setColorScheme(choice === 'system' ? 'unspecified' : choice); }, [choice]);
  useEffect(() => { void SystemUI.setBackgroundColorAsync(colors.ground).catch(() => {}); }, [scheme]);

  // Reopen straight into the library when the saved server still has a live session.
  useEffect(() => {
    (async () => {
      const base = await loadServer();
      if (!base) return setRoute({ name: 'server' });
      try {
        const s = await status(base);
        if (!s.user) await forgetOfflineAccount(base).catch(() => {});
        setRoute(s.user ? { name: 'viewer', base } : { name: 'login', base, setup: s.setup });
      } catch {
        if (await offlineLibrary(base).catch(() => null)) return setRoute({ name: 'viewer', base });
        setRoute({ name: 'server', initial: base.replace(/^https?:\/\//, ''), notice: "Couldn't reach your server." });
      }
    })();
  }, []);

  const connected = (base: string, s: Status) => {
    saveServer(base);
    setRoute(s.user ? { name: 'viewer', base } : { name: 'login', base, setup: s.setup });
  };
  const changeServer = () => { forgetServer(); setRoute({ name: 'server' }); };

  let screen = null;
  if (fontsReady && themeReady) {
    switch (route.name) {
      case 'server':
        screen = <ServerScreen initial={route.initial} notice={route.notice} onConnected={connected} />;
        break;
      case 'login':
        screen = <LoginScreen base={route.base} setup={route.setup} onSignedIn={() => setRoute({ name: 'viewer', base: route.base })} onChangeServer={changeServer} />;
        break;
      case 'viewer':
        screen = (
          <ViewerScreen
            base={route.base}
            onSignedOut={() => { void forgetOfflineAccount(route.base).catch(() => {}); void forgetMovieRequestAlerts(route.base).catch(() => {}); logout(route.base).catch(() => {}); setRoute({ name: 'login', base: route.base, setup: false }); }}
            onChangeServer={() => { void forgetMovieRequestAlerts(route.base, true).catch(() => {}); changeServer(); }}
          />
        );
        break;
    }
  }

  return (
    <SafeAreaProvider>
      <View key={scheme} style={{ flex: 1, backgroundColor: colors.ground }}>{screen}</View>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
    </SafeAreaProvider>
  );
}
