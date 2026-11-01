# Matro receiver

An Android app for a self-hosted [Matro server](../server/README.md). Enter the server address, sign in, and the app opens the server's own mobile web UI full screen, so what you see is exactly what the browser gets.

- **Server link**: accepts `matro.example.com` or a LAN address like `192.168.1.5:8484`. It tries HTTPS and HTTP, and checks the address answers like a Matro server before saving it.
- **Sign in**: native screen with the same two forms as the web page (sign in, or join with an invite code). The session cookie is shared with the WebView, so there is no second sign-in.
- **Viewer**: the site in a WebView. Android Back steps out of details and the player (the web UI mirrors its views into history, see `server/public/web/history.js`); the site's own sign-out returns to the sign-in screen; fullscreen turns the phone sideways and back.

Watch progress, queue and preferences live on the server per account, never on the phone. The app stores only the server address.

## Run and build

Expo SDK 57 with a native Android project, because the WebView needs a dev client or a release build (Expo Go is not enough).

```bash
npm install
npm run typecheck && npm test
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/release/app-release.apk
```

Use JDK 17 to 21 for Gradle; pass `-Dorg.gradle.java.home=<jdk>` if the global Gradle properties point somewhere else. `android/` is generated and git-ignored. Plain-HTTP servers on a LAN work because cleartext traffic is enabled in `app.json`.

The release APK is signed with the default debug key. Create a proper keystore before distributing builds that need to update over each other.
