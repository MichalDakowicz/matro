// The web page tells the app about a title being saved for offline use with a "dl:{json}" message.
// This turns those messages into the text of the notification. Pure, so it is tested without a phone.

export type DownloadState = 'saving' | 'saved' | 'stopped' | 'failed';
export type DownloadMessage = { id: string; title: string; state: DownloadState; percent: number };

const STATES: DownloadState[] = ['saving', 'saved', 'stopped', 'failed'];

export function parseDownloadMessage(raw: string): DownloadMessage | null {
  if (!raw.startsWith('dl:')) return null;
  try {
    const m = JSON.parse(raw.slice(3));
    if (typeof m?.id !== 'string' || !STATES.includes(m.state)) return null;
    const percent = Math.max(0, Math.min(100, Math.round(Number(m.percent) || 0)));
    return { id: m.id, title: typeof m.title === 'string' && m.title ? m.title : 'Matro', state: m.state, percent };
  } catch {
    return null;
  }
}

/** A text progress bar, since Android notifications from the Expo module have no native one. */
export function bar(percent: number, width = 10): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

/** Notification text for a message, or null when the notification should go away. */
export function noticeText(m: DownloadMessage): { title: string; body: string } | null {
  if (m.state === 'saving') return { title: `Saving ${m.title}`, body: `${bar(m.percent)} ${m.percent}%` };
  if (m.state === 'saved') return { title: `${m.title} is ready offline`, body: 'Saved on this device. It plays without a connection.' };
  return null;
}
