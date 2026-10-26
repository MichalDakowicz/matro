const fs = require('node:fs/promises');
const path = require('node:path');
const { ffmpeg, run } = require('../electron/media.cjs');
const dir = path.resolve(__dirname, '../.test-media');
async function fixtures() {
  await fs.mkdir(dir, { recursive: true });
  const sub = path.join(dir, 'dialogue.srt');
  await fs.writeFile(sub, '1\n00:00:00,100 --> 00:00:04,000\nA place for your collection.\n\n2\n00:00:05,000 --> 00:00:11,000\nSubtitles after a seek.\n');
  const mkv = path.join(dir, 'Northbound.S01E03.The.Long.Thaw.mkv');
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-i', sub, '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-c:s', 'srt', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:0', 'title=Original mix', '-metadata:s:a:1', 'language=pol', '-metadata:s:a:1', 'title=Dub', '-metadata:s:s:0', 'language=eng', '-t', '12', mkv]);
  const audio = path.join(dir, 'Evening.flac');
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '4', audio]);
  return { dir, mkv, audio, sub };
}
async function bitmapFixture() {
  await fs.mkdir(dir, { recursive: true });
  const segments = [];
  function segment(time, type, payload) { const header = Buffer.alloc(13); header.write('PG'); header.writeUInt32BE(time * 90000, 2); header.writeUInt32BE(time * 90000, 6); header[10] = type; header.writeUInt16BE(payload.length, 11); segments.push(header, payload); }
  function composition(time, number, visible) {
    const pcs = Buffer.alloc(visible ? 19 : 11); pcs.writeUInt16BE(640); pcs.writeUInt16BE(360, 2); pcs[4] = 0x10; pcs.writeUInt16BE(number, 5); pcs[7] = 0x80; pcs[10] = visible ? 1 : 0;
    if (visible) { pcs.writeUInt16BE(240, 15); pcs.writeUInt16BE(290, 17); }
    segment(time, 0x16, pcs);
    if (visible) {
      const window = Buffer.alloc(10); window[0] = 1; window.writeUInt16BE(240, 2); window.writeUInt16BE(290, 4); window.writeUInt16BE(160, 6); window.writeUInt16BE(24, 8); segment(time, 0x17, window);
      segment(time, 0x14, Buffer.from([0, 0, 0, 16, 128, 128, 0, 1, 235, 128, 128, 255]));
      const rle = Buffer.from(Array.from({ length: 24 }, () => [0, 0xc0, 160, 1, 0, 0]).flat());
      const object = Buffer.alloc(11); object[3] = 0xc0; object.writeUIntBE(rle.length + 4, 4, 3); object.writeUInt16BE(160, 7); object.writeUInt16BE(24, 9); segment(time, 0x15, Buffer.concat([object, rle]));
    }
    segment(time, 0x80, Buffer.alloc(0));
  }
  composition(1, 0, true); composition(4, 1, false); composition(5, 2, true); composition(8, 3, false);
  const sup = path.join(dir, 'rectangle.sup'); await fs.writeFile(sup, Buffer.concat(segments));
  const pgs = path.join(dir, 'bitmap-pgs.mkv');
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:size=640x360:rate=24', '-itsoffset', '1', '-i', sup, '-map', '0:v', '-map', '1:s', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:s', 'copy', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=Bitmap test', '-t', '12', pgs]);
  const dvd = path.join(dir, 'bitmap-dvd.mkv'); await run(ffmpeg, ['-y', '-v', 'error', '-fix_sub_duration', '-i', pgs, '-map', '0', '-c:v', 'copy', '-c:s', 'dvdsub', dvd]);
  return { pgs, dvd };
}
module.exports = { fixtures, bitmapFixture, dir };
