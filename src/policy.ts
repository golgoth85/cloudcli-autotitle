import type { TranscriptInfo } from './transcript.js';

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();
const withoutEllipsis = (text: string): string => text.replace(/(\.\.\.|…)$/, '').trim();

/**
 * Il nome attuale è quello di default (non scelto a mano)?
 * Lo sono: l'id della sessione, "Untitled …", il nome ricavato dai primi messaggi (prefisso del
 * primo messaggio o dell'ultimo prompt). Qualunque altro nome è considerato manuale e non si tocca.
 */
export function isDefaultName(title: string, sessionId: string, info: Pick<TranscriptInfo, 'firstUserText' | 'lastPrompt'>): boolean {
  const name = squash(title);
  if (!name || name === sessionId || /^untitled\b/i.test(name)) return true;
  const stem = withoutEllipsis(name).toLowerCase();
  if (stem.length < 3) return false;
  return [info.firstUserText, info.lastPrompt].some((source) => !!source && squash(source).toLowerCase().startsWith(stem));
}

export const MAX_TITLE_CHARS = 60;

/** Pulisce la risposta del modello: una riga, senza virgolette, markdown o punto finale. */
export function cleanTitle(raw: string): string {
  let title = raw.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  title = title.replace(/^#+\s*/, '').replace(/^(titolo|title)\s*:\s*/i, '');
  title = title.replace(/[*_`]+/g, '').replace(/^["'“”«»‘’]+|["'“”«»‘’]+$/g, '').replace(/[.:;,!\s]+$/, '').trim();
  if (title.length > MAX_TITLE_CHARS) title = `${title.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
  return title;
}
