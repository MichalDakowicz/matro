export const HISTORY_LIMIT = 5;
/** Most recent first, no duplicates, capped. */
export const rememberServer = (list: string[], base: string) => [base, ...list.filter(entry => entry !== base)].slice(0, HISTORY_LIMIT);
export const forgetFromHistory = (list: string[], base: string) => list.filter(entry => entry !== base);
export const serverHost = (base: string) => base.replace(/^https?:\/\//, '');
