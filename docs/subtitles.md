# Embedded subtitles

Embedded text subtitles are converted to WebVTT and cached in the subtitles/
directory inside Electron user-data. Cache keys include the source path, file
size, modification time and stream index. Changing the source or selecting another
track uses a separate cache entry. Concurrent requests for the same track share
one extraction; failures are retryable and are not cached. A cache-write failure
still allows playback for the current session.

Local files use bundled FFmpeg with a three-minute extraction limit. SSH files use
FFmpeg on the server, invoked by the existing temporary Python SSH helper. Only
the WebVTT text is returned to the PC; the movie is not sent across the video
gateway just to extract captions. This fixes the previous 30-second extraction
timeout on larger remote movies. Probing still reads a small amount of the video
through the authenticated gateway.

SSH servers require Python 3 and FFmpeg for embedded text subtitles. On Ubuntu:

    sudo apt-get update
    sudo apt-get install --no-install-recommends ffmpeg

This installs a command-line tool, not a server service. Extraction runs as the SSH
user with argument arrays, no shell interpolation, and local-file-only FFmpeg
protocols. The helper confines the source path to the configured media root and
validates the stream index. Output is limited to 16 MiB, server execution to 180
seconds, and the extraction RPC to 195 seconds. Temporary output files are removed
when extraction finishes. No subtitle sidecar or movie file is written on the server.

Embedded SRT/SubRip and ASS text tracks are covered by generated-media tests.
Text conversion preserves cue times and Unicode but does not preserve advanced
ASS typesetting. Embedded bitmap tracks retain the existing FFmpeg overlay path.
External subtitle loading and saving beside a movie retain their existing behavior.

The full track keeps source timestamps; the player continues adjusting cues after
seeks and applying subtitle delay. Cached subtitles are local to this PC and are
not synchronized. To regenerate the cache manually, close Matro and remove its
user-data subtitles directory; media files and watch progress are separate.

Verification on 2026-10-30: the previous path failed at 30 seconds on a server
movie after reading approximately 1.3 GiB. Server extraction returned 880 cues
in 2.2 seconds with approximately 1 MiB read for probing. A fresh cache client
loaded the stored track in 0.004 seconds without another extraction. Source size
and modification time were unchanged. The real Electron player also verified
loading, a 120-second seek, and disk-cache reuse after restart against that movie.

Useful checks:

    node --test tests/subtitles.test.cjs tests/ssh-media.test.cjs
    npm test
    npm run test:e2e

The opt-in real-server test is in tests/ssh-desktop.spec.cjs. Set MATRO_TEST_SSH=1
and filter for embedded SSH subtitles. It reads the existing Ghost in the Shell
movie without changing server files and uses an isolated local profile.
