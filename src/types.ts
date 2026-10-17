/** Tipi condivisi tra server e interfaccia. */

export type TitleSource = 'ai-title' | 'haiku';

/** Sessione come la descrive l'elenco recente di CloudCLI, più l'id nativo se già noto. */
export interface SessionRef {
  sessionId: string;
  nativeId?: string;
  provider: string;
  title: string;
  projectName: string;
  /** Primi messaggi di testo (solo Codex/OpenCode): il server non ha i loro transcript. */
  messages?: { role: string; content: string }[];
}

export type ProposalStatus = 'proposal' | 'ok' | 'manual' | 'unsupported' | 'need-native' | 'no-transcript' | 'deferred' | 'error';

export interface Proposal {
  sessionId: string;
  status: ProposalStatus;
  current: string;
  proposed: string | null;
  source: TitleSource | null;
  /** Costo in dollari della generazione (0 per `ai-title`). */
  costUsd: number;
  detail?: string;
}

export interface CostRun {
  sessionId: string;
  at: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AppliedEntry {
  sessionId: string;
  at: string;
  previous: string;
  title: string;
  source: TitleSource;
  costUsd: number;
  undone: boolean;
}

export interface Stats {
  /** Chat con titolo generato da Haiku (le sole che costano). */
  haikuCount: number;
  /** Chat con titolo già presente nel transcript (gratis). */
  freeCount: number;
  totalCostUsd: number;
  /** Costo medio per chat che ha richiesto Haiku. */
  avgCostPerHaikuChatUsd: number;
  /** Costo medio su tutte le chat rinominate, comprese quelle gratuite. */
  avgCostPerRenamedChatUsd: number;
}

export interface Settings {
  /** Applica da solo i titoli proposti finché la scheda è aperta. */
  auto: boolean;
  /** Tetto di chiamate a Haiku per ogni analisi. */
  maxHaikuPerRun: number;
}

export interface StateResponse {
  settings: Settings;
  stats: Stats;
  applied: AppliedEntry[];
  error?: string;
}

export interface ProposeResponse {
  proposals: Proposal[];
  error?: string;
}

