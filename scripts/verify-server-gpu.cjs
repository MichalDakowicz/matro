// Run inside the Matro NVIDIA image. Generates its own short fixture; no library
// files, accounts or watch progress are accessed.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = process.cwd();
const { ffmpeg } = require(path.join(root, 'packages/core/server/config.js'));
const { probe } = require(path.join(root, 'packages/core/server/media.js'));
const { createPlaybackCache } = require(path.join(root, 'packages/core/playback/cache.cjs'));

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matro-gpu-check-'));
  let cache;
  try {
    const file = path.join(dir, 'source.mkv');
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24000/1001:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file], { timeout: 30000 });
    // Requiring CUDA frames here proves decode works, rather than accepting
    // FFmpeg's automatic fallback to CPU decoding.
    execFileSync(ffmpeg, ['-v', 'error', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-i', file, '-frames:v', '1', '-an', '-c:v', 'h264_nvenc', '-preset', 'p4', '-f', 'null', '-'], { timeout: 30000 });
    const info = await probe(file);
    cache = createPlaybackCache({ ffmpeg, dir: path.join(dir, 'cache'), stallMs: 15000 });
    const entry = await cache.get({ file, input: file, info, offset: 1, audio: null, burn: null, delay: 0 });
    const deadline = Date.now() + 45000;
    while (!entry.done && !entry.error && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    if (entry.error) throw entry.error;
    if (!entry.done) throw Error('GPU preparation timed out.');
    const args = entry.child.spawnargs, encoder = args[args.indexOf('-c:v') + 1];
    if (encoder !== 'h264_nvenc') throw Error(`Expected NVIDIA NVENC but preparation used ${encoder}.`);
    const output = await probe(entry.file);
    if (output.video?.codec !== 'h264' || output.duration < 3) throw Error('GPU output did not validate.');
    const { ffprobe } = require(path.join(root, 'packages/core/server/config.js'));
    const timing = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,start_time', '-of', 'json', entry.file], { encoding: 'utf8', timeout: 30000 }));
    if (timing.streams.some(stream => Math.abs(Number(stream.start_time)) > .25)) throw Error('Prepared stream contains an invalid audio/video timestamp offset.');
    console.log(JSON.stringify({ encoder, hardwareDecodeVerified: true, hardwareDecodeRequested: args.includes('-hwaccel'), timestampsVerified: true, outputCodec: output.video.codec, duration: output.duration, bytes: entry.size }));
  } finally { cache?.close(); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
