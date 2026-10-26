# Third-party software

The MIT license in this repository covers original Matro source code. Dependencies and bundled executables retain their own licenses.

- Electron: MIT and Chromium/Node.js third-party licenses. The packaged application includes Electron's license files. https://github.com/electron/electron
- ffmpeg-static: GPL-3.0-or-later package; downloaded FFmpeg builds have their own build-specific license and configuration. https://github.com/eugeneware/ffmpeg-static
- ffprobe-static: MIT package wrapper; the bundled FFprobe binary has its own FFmpeg license. https://github.com/joshwnj/ffprobe-static
- FFmpeg/FFprobe: LGPL or GPL depending on build configuration. This application uses libx264, so the packaged build must be treated as GPL-enabled. Upstream source: https://ffmpeg.org/download.html ; legal information: https://ffmpeg.org/legal.html ; binary build source links: https://github.com/eugeneware/ffmpeg-static/releases and https://github.com/joshwnj/ffprobe-static

- Geist and Geist Mono typefaces (Vercel, in collaboration with basement.studio), bundled as `src/assets/fonts/Geist-Variable.woff2` and `GeistMono-Variable.woff2` from the `geist` npm package 1.8.2: SIL Open Font License 1.1. The full licence ships next to the fonts in `src/assets/fonts/OFL.txt`. https://github.com/vercel/geist-font
- TMDB (optional metadata and artwork): "This product uses the TMDB API but is not endorsed or certified by TMDB." Matro shows this notice in the library footer whenever TMDB is enabled. Use is subject to the TMDB API terms: https://www.themoviedb.org/api-terms-of-use . `src/assets/tmdb.svg` is TMDB's "primary short" logo from https://www.themoviedb.org/about/logos-attribution , used unmodified next to TMDB ratings as attribution. Credentials are supplied by each user and are not bundled.

Before distributing installers publicly, audit the exact FFmpeg/FFprobe binaries, preserve their complete license notices, and provide the corresponding source and build instructions required by those builds. The development packaging command is not a substitute for that release check. No claim is made that every upstream codec is enabled or that DRM-protected media is supported.
