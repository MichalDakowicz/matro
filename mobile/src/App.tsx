import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { forgetServer, loadServer, saveServer } from './lib/storage';
import { logout, status, type Status } from './lib/server';
import LoginScreen from './screens/LoginScreen';
import ServerScreen from './screens/ServerScreen';
import ViewerScreen from './screens/ViewerScreen';
import { colors, fontAssets } from './theme';

type Route =
  | { name: 'boot' }
  | { name: 'server'; initial?: string; notice?: string }
  | { name: 'login'; base: string; setup: boolean }
  | { name: 'viewer'; base: string };

export default function App() {
  const [fontsReady] = useFonts(fontAssets);
  const [route, setRoute] = useState<Route>({ name: 'boot' });

  // Reopen straight into the library when the saved server still has a live session.
  useEffect(() => {
    (async () => {
      const base = await loadServer();
      if (!base) return setRoute({ name: 'server' });
      try {
        const s = await status(base);
        setRoute(s.user ? { name: 'viewer', base } : { name: 'login', base, setup: s.setup });
      } catch {
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
  if (fontsReady) {
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
            onSignedOut={() => { logout(route.base).catch(() => {}); setRoute({ name: 'login', base: route.base, setup: false }); }}
            onChangeServer={changeServer}
          />
        );
        break;
    }
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.ground }}>{screen}</View>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
