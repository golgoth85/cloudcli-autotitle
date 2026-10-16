import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppliedEntry, CostRun, Settings, Stats, TitleSource } from './types.js';

export const MAX_APPLIED = 200;
export const MAX_RUNS = 5000;

export interface CachedProposal {
  title: string;
  source: TitleSource;
  costUsd: number;
  at: string;
}

export interface State {
  version: 1;
  settings: Settings;
  runs: CostRun[];
  applied: AppliedEntry[];
  /** Titoli di Haiku già pagati e non ancora applicati: evitano di pagare due volte. */
  cache: Record<string, CachedProposal>;
}

export const DEFAULT_SETTINGS: Settings = { auto: false, maxHaikuPerRun: 10 };

const dataDir = (): string => process.env.AUTOTITLE_DATA_DIR || path.join(os.homedir(), '.cloudcli-autotitle');
const stateFile = (): string => path.join(dataDir(), 'state.json');

export function emptyState(): State {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, runs: [], applied: [], cache: {} };
}

export function loadState(): State {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Partial<State>;
    return {
      version: 1,
      settings: { ...DEFAULT_SETTINGS, ...raw.settings },
      runs: Array.isArray(raw.runs) ? raw.runs : [],
      applied: Array.isArray(raw.applied) ? raw.applied : [],
      cache: raw.cache && typeof raw.cache === 'object' ? raw.cache : {},
    };
  } catch {
    return emptyState();
  }
}

export function saveState(state: State): void {
  const trimmed: State = { ...state, runs: state.runs.slice(-MAX_RUNS), applied: state.applied.slice(-MAX_APPLIED) };
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const tmp = `${stateFile()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(trimmed, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, stateFile());
}

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

/** Costi in dollari: totale e medie per chat. Le chat gratuite (titolo già nel transcript) pesano solo sulla media complessiva. */
export function computeStats(state: Pick<State, 'runs' | 'applied'>): Stats {
  const haikuChats = new Set(state.runs.map((run) => run.sessionId));
  const freeChats = new Set(state.applied.filter((entry) => entry.source === 'ai-title').map((entry) => entry.sessionId));
  const total = state.runs.reduce((sum, run) => sum + run.costUsd, 0);
  const all = new Set([...haikuChats, ...freeChats]).size;
  return {
    haikuCount: haikuChats.size,
    freeCount: freeChats.size,
    totalCostUsd: round(total),
    avgCostPerHaikuChatUsd: haikuChats.size ? round(total / haikuChats.size) : 0,
    avgCostPerRenamedChatUsd: all ? round(total / all) : 0,
  };
}
