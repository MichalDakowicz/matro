# Matro native mobile

The Expo SDK 57 application renders the responsive web design with React Native screens and expo-video (Android ExoPlayer / iOS AVPlayer). There is no WebView. The floating icon dock, tilted poster reel, continue cards, three-column shelves, title heroes and player overlays follow the web composition. See [the native design mapping](../../docs/native-design.md). The server still owns media and performs compatibility preparation when the device needs it.

From the repository root:

```sh
npm install
npm run start:mobile
npm run android --workspace @matro/mobile
npm run ios --workspace @matro/mobile
npm run typecheck:mobile
npm test --workspace @matro/mobile
```

Android builds require Android Studio's SDK and a supported JDK; iOS builds require macOS and Xcode. `expo run:android` / `expo run:ios` generate their native projects. Generated platform folders are ignored; app identity is preserved to allow existing installations to update.

The server address is stored with AsyncStorage. Sessions are stored with Expo SecureStore and sent as bearer headers to the API, artwork and native player. Login still uses the same accounts and invitations; logout and server-side password resets revoke sessions. An existing valid WebView cookie is exchanged for a native session through the authenticated, CSRF-protected session endpoint.

Library shelves and grids are virtualized. Only four font files are bundled. Video buffers ahead natively, while the server prepares the movie on disk. Recovery retries twice from the current position, then shows an explicit retry action. Progress saves every five seconds and when backgrounding/leaving. Next-episode autoplay follows season/episode order. Text VTT subtitles render as native text; bitmap subtitles are composited by the host. Basic text cues are supported; advanced ASS styling is not. Rotation preserves the player instance, fullscreen hides Android's status and gesture bars, and exiting restores the entry orientation even with system rotation locked.

Plain HTTP is enabled for Android LAN servers; use HTTPS for remote access. iOS retains platform transport restrictions, so use an HTTPS server there. Native screens provide movie/series release search, host download management and administrator folder browsing/add/remove/rescan. Subtitle uploads remain available through the web app.

Bundle validation without Android SDK:

```sh
npm exec --workspace @matro/mobile -- expo export --platform android --output-dir ../../.test-media/mobile-export
```

This creates native JavaScript/Hermes assets, not an installable APK. A release build and device playback check are required before distribution.

The native release APK was built and installed in place on the connected ARM64 phone, preserving its matching app signature and data. On this Windows setup the SDK is at `C:\Android\sdk`; set `ANDROID_HOME` and `JAVA_HOME` before building. If the global Gradle properties reference a missing Android Studio JBR, override it with `-Dorg.gradle.java.home=<your JDK>` when invoking Gradle. The validated local build used JDK 20 and `:app:assembleRelease -PreactNativeArchitectures=arm64-v8a`. The standalone APK is under `android/app/build/outputs/apk/release/app-release.apk` and contains its JavaScript/Hermes bundle.
