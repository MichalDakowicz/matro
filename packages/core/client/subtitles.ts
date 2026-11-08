export type Cue = { start: number; end: number; text: string };
const seconds = (value: string) => value.split(':').reduce((total, part) => total * 60 + Number(part.replace(',', '.')), 0);
export function parseVtt(text: string): Cue[] {
  return text.replace(/\r/g, '').split(/\n\n+/).flatMap(block => {
    const lines = block.split('\n'), index = lines.findIndex(line => line.includes(' --> '));
    if (index < 0) return [];
    const times = lines[index].match(/([\d:.,]+)\s+-->\s+([\d:.,]+)/);
    if (!times) return [];
    return [{ start: seconds(times[1]), end: seconds(times[2]), text: lines.slice(index + 1).join('\n').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') }];
  });
}
