# Native rendering of the Matro web design

The responsive web app is the visual reference. Native rendering changes the UI implementation and video backend, while preserving composition, labels and hierarchy. Do not substitute a generic mobile tab bar, a two-column-only library, or a separate settings form under the video.

| Web source | Native component | Phone layout |
| --- | --- | --- |
| `.window-zone`, `.web-avatar` | `Corner` | Brand mark (a back chevron on screens opened from another screen) at left, 44 px avatar at right, both on a top gradient fade; About Matro lives in the profile sheet |
| `.dock` | `Dock` | Floating 64 px pill with the artboards' four items (Library, Search, Queue, Server); the active item shows its label. 14 px margins above the bottom safe area, hidden while the keyboard is up |
| `.cw-row`, `.continue-card` | `ContinueRow` | Horizontal 240 × 138 cards with title, remaining time and progress |
| `.showcase`, `.reel`, `.show-meta` | `FeaturedReel` | Animated tilted poster reel, wrapped scrolling, dots/count, then title, metadata and two actions |
| `.grid`, `.card` | `PosterCard` | Two columns under 380 dp, three or more above; 2:3 artwork; two-line 13 px title, year or season count as metadata |
| `.detail-hero`, `.detail-head`, `.episode-row` | `TitleScreen` | Faded 420 px hero, 36 px title, play pill, round secondary actions, season chips and 128 px episode stills |
| `.stage`, `.player-top`, `.player-controls` | `NativePlayer` | Video fills the scene. Back/title at top; seeker, time, transport and utilities overlaid at bottom |
| `.tracks-panel`, `.queue-panel` | Native modal sheets | Readable language names, selected rows, subtitle delay/size and season-grouped queue |
| `MobileQueue`, `MobileServer`, `MobileSearch` artboards | `QueueScreen`, `ServerPage`, `SearchView` | Up next with autoplay; the server connection, libraries and admin entry points; Search with Recent and filter chips |
| Downloads / Folders / Profile | Native screens and sheets | Profile is a grouped sheet (Library, Server, Account) with confirmations; Folders sits under the Library chips for admins |

Colors and Geist fonts follow `packages/browser-ui/styles.css`; SVG geometry is shared through `packages/browser-ui/icons.json`, also imported by the web renderer. The brand geometry comes from the existing SVG. Native primitives are centralized in `apps/mobile/src/components/Matro.tsx`.

The player uses `expo-video` with custom React Native controls, rather than a browser video element. Rotation keeps the same player and video surface mounted. It buffers up to 60 seconds / 64 MiB, uses the server's shared preparation endpoint, preserves pause state during seeks and track changes, and changes text subtitles without restarting the video. Track preferences match language/title across episodes. The native seeker uses the complete movie timeline even when the server stream starts at an offset.

Player extras follow the web player: the seek bar shows server frames and chapter ticks while scrubbing and tints intro, recap and outro ranges; the Playback sheet (the more button) lists chapters, edits skip ranges, switches auto-skip, sets a sleep timer and turns on background audio (off by default); the Queue sheet manages Up next and autoplay; text subtitles take font, background, bold, italic and edge on top of size, delay and position. Double-tapping the left or right third seeks 10 seconds, and a vertical drag on the right edge changes the player volume. Volume boost above 100 % and brightness swipes need native modules and are not part of the player.

Native screen-reader labels remain attached to icon-only controls. Controls have at least 44 px touch areas; the play target is 60 px in portrait. Lists and poster shelves are virtualized. Poster animation runs on the native animation driver. The web design's reduced-density phone rules are the reference for spacing, not a screenshot scaled as one bitmap.

Theme: Your profile has System / Light / Dark like the browser app footer, stored on the device. The light palette is `[data-theme=light]` from `packages/browser-ui/styles.css` (a test keeps them equal), the player and artwork overlays stay dark. Palettes live in `apps/mobile/src/palette.ts`; read `colors.*` while rendering and build style sheets with `themed(() => StyleSheet.create(...))`. A new token goes into both palettes. Changing the theme remounts the app tree.
