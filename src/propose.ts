import { isDefaultName } from './policy.js';
import { excerptFromMessages, findTranscript, readTranscript } from './transcript.js';
import type { Generated } from './generator.js';
import type { Proposal, SessionRef, Settings } from './types.js';
import type { State } from './store.js';

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();
const CONCURRENCY = 3;

export interface ProposeDeps {
  generate: (excerpt: string) => Promise<Generated>;
  findTranscript?: typeof findTranscript;
  now?: () => Date;
}

function base(ref: SessionRef): Proposal {
  return { sessionId: ref.sessionId, status: 'ok', current: ref.title, proposed: null, source: null, costUsd: 0 };
}

/**
 * Decide per ogni sessione se proporre un titolo. Ordine: titolo già scritto da Claude Code (gratis),
 * poi titolo già pagato in cache, poi Haiku (entro `maxHaikuPerRun`). I nomi scelti a mano non si toccano.
 * Aggiorna `state` (costi e cache); chi chiama deve salvarlo.
 */
export async function propose(refs: SessionRef[], state: State, settings: Settings, deps: ProposeDeps): Promise<Proposal[]> {
  const find = deps.findTranscript ?? findTranscript;
  const now = deps.now ?? (() => new Date());
  let haikuLeft = Math.max(0, settings.maxHaikuPerRun);
  const handled = new Set(state.applied.map((entry) => entry.sessionId));
  const results = new Map<string, Proposal>();
  const toGenerate: { ref: SessionRef; excerpt: string }[] = [];

  for (const ref of refs) {
    const out = base(ref);
    results.set(ref.sessionId, out);
    // Già rinominata dal plugin (anche se poi annullata): non si ripropone né si ripaga.
    if (handled.has(ref.sessionId)) { out.status = 'ok'; continue; }

    // Per Codex/OpenCode: usa l'excerpt se passato, altrimenti unsupported
    if (ref.provider !== 'claude') {
      const excerpt = ref.excerpt;
      if (!excerpt) { out.status = 'unsupported'; continue; }
      const cached = state.cache[ref.sessionId];
      if (cached) {
        Object.assign(out, { status: 'proposal', proposed: cached.title, source: cached.source, costUsd: cached.costUsd });
        continue;
      }
      if (haikuLeft <= 0) { out.status = 'deferred'; continue; }
      haikuLeft -= 1;
      toGenerate.push({ ref, excerpt });
      continue;
    }
    const nativeId = ref.nativeId ?? ref.sessionId;
    const file = find(nativeId);
    if (!file) { out.status = ref.nativeId ? 'no-transcript' : 'need-native'; continue; }
    let info;
    try {
      info = readTranscript(file, nativeId);
    } catch {
      out.status = 'error';
      out.detail = 'Transcript illeggibile.';
      continue;
    }
    const current = squash(ref.title);
    if (info.customTitle && squash(info.customTitle) === current) { out.status = 'manual'; continue; }
    if (info.aiTitle && squash(info.aiTitle) === current) { out.status = 'ok'; continue; }
    if (!isDefaultName(ref.title, ref.sessionId, info)) { out.status = 'manual'; continue; }
    if (info.aiTitle) {
      Object.assign(out, { status: 'proposal', proposed: info.aiTitle, source: 'ai-title' });
      continue;
    }
    const cached = state.cache[ref.sessionId];
    if (cached) {
      Object.assign(out, { status: 'proposal', proposed: cached.title, source: cached.source, costUsd: cached.costUsd });
      continue;
    }
    if (!info.excerpt) { out.status = 'no-transcript'; out.detail = 'Chat ancora vuota.'; continue; }
    if (haikuLeft <= 0) { out.status = 'deferred'; continue; }
    haikuLeft -= 1;
    toGenerate.push({ ref, excerpt: info.excerpt });
  }

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < toGenerate.length) {
      const { ref, excerpt } = toGenerate[next++];
      const out = results.get(ref.sessionId)!;
      try {
        const generated = await deps.generate(excerpt);
        const at = now().toISOString();
        state.runs.push({ sessionId: ref.sessionId, at, costUsd: generated.costUsd, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens });
        state.cache[ref.sessionId] = { title: generated.title, source: 'haiku', costUsd: generated.costUsd, at };
        Object.assign(out, { status: 'proposal', proposed: generated.title, source: 'haiku', costUsd: generated.costUsd });
      } catch (error) {
        out.status = 'error';
        out.detail = error instanceof Error ? error.message : String(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toGenerate.length) }, worker));

  return refs.map((ref) => results.get(ref.sessionId)!);
}
