# Native rendering of the Matro web design

The responsive web app is the visual reference. Native rendering changes the UI implementation and video backend, while preserving composition, labels and hierarchy. Do not substitute a generic mobile tab bar, a two-column-only library, or a separate settings form under the video.

| Web source | Native component | Phone layout |
| --- | --- | --- |
| `.window-zone`, `.help-button`, `.web-avatar` | `Corner` | Help at left; 34 px brand mark and 36 px avatar at right |
| `.dock` | `Dock` | Floating 56 px icon pill, 14 px margins, above the bottom safe area |
| `.cw-row`, `.continue-card` | `ContinueRow` | Horizontal 240 × 138 cards with title, remaining time and progress |
| `.showcase`, `.reel`, `.show-meta` | `FeaturedReel` | Animated tilted poster reel, wrapped scrolling, dots/count, then title, metadata and two actions |
| `.grid`, `.card` | `PosterCard` | Minimum three columns on phones; 2:3 artwork; 12.5 px title / 11 px metadata |
| `.detail-hero`, `.detail-head`, `.episode-row` | `TitleScreen` | Faded 420 px hero, 36 px title, play pill, round secondary actions, season chips and 128 px episode stills |
| `.stage`, `.player-top`, `.player-controls` | `NativePlayer` | Video fills the scene. Back/title at top; seeker, time, transport and utilities overlaid at bottom |
| `.tracks-panel`, `.queue-panel` | Native modal sheets | Readable language names, selected rows, subtitle delay/size and season-grouped queue |
| Downloads / Folders / Profile | Native screens and sheets | Existing information structure, controls, cards and rounded surfaces |

Colors and Geist fonts follow `packages/browser-ui/styles.css`; SVG geometry is shared through `packages/browser-ui/icons.json`, also imported by the web renderer. The brand geometry comes from the existing SVG. Native primitives are centralized in `apps/mobile/src/components/Matro.tsx`.

The player uses `expo-video` with custom React Native controls, rather than a browser video element. Rotation keeps the same player and video surface mounted. It buffers up to 60 seconds / 64 MiB, uses the server's shared preparation endpoint, preserves pause state during seeks and track changes, and changes text subtitles without restarting the video. Track preferences match language/title across episodes. The native seeker uses the complete movie timeline even when the server stream starts at an offset.

Native screen-reader labels remain attached to icon-only controls. Controls have at least 44 px touch areas; the play target is 60 px in portrait. Lists and poster shelves are virtualized. Poster animation runs on the native animation driver. The web design's reduced-density phone rules are the reference for spacing, not a screenshot scaled as one bitmap.
