import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { colors, fonts } from '../theme';
import { PrimaryPill, TextButton } from '../ui';

type Props = { base: string; onSignedOut: () => void; onChangeServer: () => void };

// The status bar is padded natively, but the WebView also reports it as env(safe-area-inset-top), so the two rules that add it again are cancelled (a constructed sheet, since the site CSP blocks style elements).
// The site's own sign-out calls POST /api/logout and reloads. Tell the app so it returns to the native sign-in.
const HOOK = `(function(){var f=window.fetch;window.fetch=function(u,o){try{if(String(u).indexOf('/api/logout')>-1&&o&&o.method==='POST'){window.ReactNativeWebView.postMessage('logout');}}catch(e){}return f.apply(this,arguments);};var fsNow=function(){window.ReactNativeWebView.postMessage(document.fullscreenElement?'fs:1':'fs:0');};document.addEventListener('fullscreenchange',fsNow);window.addEventListener('resize',fsNow);document.addEventListener('DOMContentLoaded',function(){var sh=new CSSStyleSheet();sh.replaceSync('.help-button{top:14px!important}.player-top{padding-top:12px!important}');document.adoptedStyleSheets=document.adoptedStyleSheets.concat(sh);});true;})();`;

/** The Matro mobile website, full screen. It is the real web app, so the layout is exactly what the browser gets. */
export default function ViewerScreen({ base, onSignedOut, onChangeServer }: Props) {
  const ref = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const fullscreen = useRef(false);
  const insets = useSafeAreaInsets();
  const [failed, setFailed] = useState('');
  const origin = new URL(base).origin;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack.current) return false;
      ref.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    const msg = e.nativeEvent.data;
    if (msg === 'logout') onSignedOut();
    // Fullscreen: turn the phone sideways so the picture fills the screen, and back when it ends.
    if (msg === 'fs:1' && !fullscreen.current) {
      fullscreen.current = true;
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    }
    if (msg === 'fs:0' && fullscreen.current) {
      // Unlocking alone leaves the screen sideways when auto-rotate is off, so go back to portrait first.
      fullscreen.current = false;
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
        .then(() => setTimeout(() => ScreenOrientation.unlockAsync().catch(() => {}), 600))
        .catch(() => {});
    }
  }, [onSignedOut]);

  return (
    <View style={[s.fill, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: insets.bottom }]}>
      <WebView
        ref={ref}
        source={{ uri: base }}
        style={s.web}
        containerStyle={s.web}
        originWhitelist={[origin]}
        injectedJavaScriptBeforeContentLoaded={HOOK}
        onMessage={onMessage}
        onNavigationStateChange={n => { canGoBack.current = n.canGoBack; }}
        onShouldStartLoadWithRequest={req => {
          if (req.url.startsWith(origin) || req.url.startsWith('about:') || req.url.startsWith('blob:') || req.url.startsWith('data:')) return true;
          Linking.openURL(req.url).catch(() => {});
          return false;
        }}
        onLoadStart={() => setFailed('')}
        onError={e => setFailed(e.nativeEvent.description || "Couldn't load the server.")}
        onHttpError={e => { if (e.nativeEvent.statusCode >= 500) setFailed(`Server answered ${e.nativeEvent.statusCode}.`); }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        setSupportMultipleWindows={false}
        overScrollMode="never"
        pullToRefreshEnabled={false}
        setBuiltInZoomControls={false}
        textZoom={100}
        androidLayerType="hardware"
      />
      {failed !== '' && (
        <View style={s.error}>
          <Text style={s.kicker}>Matro · offline</Text>
          <Text style={s.title}>Can't reach the server.</Text>
          <Text style={s.lede}>{failed}</Text>
          <View style={s.actions}>
            <PrimaryPill label="Try again" onPress={() => { setFailed(''); ref.current?.reload(); }} />
            <TextButton label="Change server" onPress={onChangeServer} />
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.ground },
  web: { flex: 1, backgroundColor: colors.ground },
  error: { ...StyleSheet.absoluteFill, backgroundColor: colors.ground, padding: 28, justifyContent: 'center' },
  kicker: { fontFamily: fonts.mono, fontSize: 12, color: colors.dim, marginBottom: 14 },
  title: { fontFamily: fonts.semibold, fontSize: 36, letterSpacing: -1.4, color: colors.text },
  lede: { fontFamily: fonts.regular, fontSize: 15, color: colors.muted, marginTop: 12 },
  actions: { gap: 12, marginTop: 28, maxWidth: 420 },
});
