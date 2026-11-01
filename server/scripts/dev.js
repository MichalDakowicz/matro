// Runs the server against a throwaway data folder with a few generated sample videos, for trying the UI.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const data = path.join(__dirname, '..', '.dev-data');
process.env.MATRO_DATA ||= data;
process.env.MATRO_MEDIA ||= path.join(data, 'media');
process.env.PORT ||= '8484';
const { ffmpeg } = require('../src/config');
const media = process.env.MATRO_MEDIA;
function make(file, label, extra = []) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=24:duration=90`, '-f', 'lavfi', '-i', 'sine=frequency=330:duration=90', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=90',
    ...extra, '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=jpn', '-shortest', file]);
  console.log('generated', label);
}
make(path.join(media, 'Sample Film (2020)', 'Sample.Film.2020.mkv'), 'film');
for (const n of [1, 2, 3]) make(path.join(media, 'Sample Show', `Sample.Show.S01E0${n}.mkv`), `episode ${n}`);

require('../src/index.js').main();
