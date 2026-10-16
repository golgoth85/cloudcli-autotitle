import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TranscriptInfo {
  aiTitle: string | null;
  customTitle: string | null;
  lastPrompt: string | null;
  firstUserText: string | null;
  /** Testo compatto dei primi scambi, da dare al modello. */
  excerpt: string;
}

const MAX_EXCERPT_CHARS = 3000;
const MAX_MESSAGE_CHARS = 700;
const MAX_MESSAGES = 6;

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Testo visibile di un messaggio: stringa, oppure i blocchi `text` (niente strumenti né ragionamento). */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: string; text: string } => !!block && typeof block === 'object' && (block as { type?: unknown }).type === 'text' && typeof (block as { text?: unknown }).text === 'string')
    .map((block) => block.text)
    .join(' ');
}

/** I messaggi che l'utente non ha scritto (comandi, avvisi di sistema, risultati di strumenti). */
function isNoise(text: string): boolean {
  return /^<(command-|local-command|system-reminder|task-notification|user-prompt-submit-hook)/.test(text.trimStart());
}

/** Estrae titoli già presenti e i primi scambi da un transcript JSONL di Claude Code. Tollerante a righe rotte. */
export function parseTranscript(text: string, sessionId?: string): TranscriptInfo {
  let aiTitle: string | null = null;
  let customTitle: string | null = null;
  let lastPrompt: string | null = null;
  let firstUserText: string | null = null;
  const turns: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (sessionId && typeof row.sessionId === 'string' && row.sessionId !== sessionId) continue;
    const type = row.type;
    if (type === 'ai-title' && typeof row.aiTitle === 'string' && row.aiTitle.trim()) aiTitle = squash(row.aiTitle);
    else if (type === 'custom-title' && typeof row.customTitle === 'string' && row.customTitle.trim()) customTitle = squash(row.customTitle);
    else if (type === 'last-prompt' && typeof row.lastPrompt === 'string' && row.lastPrompt.trim()) lastPrompt = squash(row.lastPrompt);
    else if ((type === 'user' || type === 'assistant') && row.isSidechain !== true && row.isMeta !== true && turns.length < MAX_MESSAGES) {
      const message = row.message as { content?: unknown } | undefined;
      const body = squash(messageText(message?.content));
      if (!body || (type === 'user' && isNoise(body))) continue;
      if (type === 'user' && firstUserText === null) firstUserText = body;
      turns.push(`${type === 'user' ? 'Utente' : 'Assistente'}: ${body.slice(0, MAX_MESSAGE_CHARS)}`);
    }
  }
  return { aiTitle, customTitle, lastPrompt, firstUserText, excerpt: turns.join('\n').slice(0, MAX_EXCERPT_CHARS) };
}

/** Cartella dei transcript di Claude Code. Sovrascrivibile per i test. */
export function projectsRoot(): string {
  return process.env.AUTOTITLE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
}

/** Cerca `<id>.jsonl` nelle cartelle dei progetti. Id non valido o file assente → null. */
export function findTranscript(nativeId: string, root = projectsRoot()): string | null {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(nativeId)) return null;
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const candidate = path.join(root, dir, `${nativeId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function readTranscript(file: string, sessionId: string): TranscriptInfo {
  return parseTranscript(fs.readFileSync(file, 'utf8'), sessionId);
}
