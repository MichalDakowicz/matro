// Stream quality for server playback. The ids match the server's tiers in playback/encoding.cjs.
export const QUALITIES = [
  { id: 'original', label: 'Original', detail: 'As stored, no re-encoding when possible' },
  { id: '1080p', label: '1080p', height: 1080, detail: 'Up to 8 Mbit/s' },
  { id: '720p', label: '720p', height: 720, detail: 'Up to 4 Mbit/s' },
  { id: '480p', label: '480p', height: 480, detail: 'Up to 1.5 Mbit/s' }
];
// Each tier caps both height and bitrate, including on sources below its height.
export const qualityOptions = video => video ? QUALITIES : [];
export const knownQuality = id => QUALITIES.some(q => q.id === id) ? id : 'original';
