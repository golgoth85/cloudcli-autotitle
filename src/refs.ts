import type { SessionRef } from './types.js';

export const MAX_SESSIONS_PER_CALL = 100;
const MAX_MESSAGES = 12;
const MAX_CONTENT = 2000;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Valida l'elenco che arriva dal browser: solo i campi attesi, messaggi limitati in numero e lunghezza. */
export function parseRefs(body: unknown): SessionRef[] {
  const list = (body as { sessions?: unknown })?.sessions;
  if (!Array.isArray(list)) throw new Error('Elenco sessioni mancante.');
  return list.slice(0, MAX_SESSIONS_PER_CALL).flatMap((item): SessionRef[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const sessionId = str(row.sessionId);
    if (!sessionId) return [];
    const ref: SessionRef = { sessionId, nativeId: str(row.nativeId) || undefined, provider: str(row.provider), title: str(row.title), projectName: str(row.projectName) };
    if (Array.isArray(row.messages)) {
      ref.messages = row.messages.slice(0, MAX_MESSAGES).flatMap((m) => {
        const msg = (m ?? {}) as Record<string, unknown>;
        const role = str(msg.role);
        const content = str(msg.content).slice(0, MAX_CONTENT);
        return (role === 'user' || role === 'assistant') && content ? [{ role, content }] : [];
      });
    }
    return [ref];
  });
}
