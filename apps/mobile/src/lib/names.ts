// Pure helpers behind the subtitle upload and release discovery requests in admin.ts.
export const SUBTITLE_TYPES = /\.(srt|vtt|ass|ssa)$/i;
/** The name a subtitle file gets on the web form: no extension, separators as spaces, at most 60 characters. */
export const subtitleName = (filename: string) => filename.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').trim().slice(0, 60);
/** The names TMDB knows a title by, without the one already searched. */
export const alternateTitles = (metadata: { originalTitle?: string; title?: string; aliases?: string[] } | null | undefined, searched: string) =>
  [...new Set([metadata?.originalTitle, metadata?.title, ...(metadata?.aliases || [])].filter((title): title is string => !!title))].filter(title => title.toLowerCase() !== searched.toLowerCase());
