/**
 * Autotitle — interfaccia del plugin: analisi delle chat, titoli proposti, applicazione, costi.
 * Il backend (server.ts) legge i transcript e genera i titoli; la rinomina la fa questa pagina
 * con la chiamata ufficiale di CloudCLI, usando il login già presente nel browser.
 */
import type { AppliedEntry, Proposal, ProposeResponse, SessionRef, StateResponse } from './types.js';

interface PluginAPI {
  readonly context: { theme: 'dark' | 'light' };
  rpc(method: string, path: string, body?: unknown): Promise<unknown>;
}

interface Conversation { sessionId: string; provider: string; projectDisplayName: string; sessionTitle: string }

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = String(value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value as EventListener);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children);
  return node;
}

export const usd = (value: number): string => `$${value.toFixed(value >= 1 ? 2 : 4)}`;
const SOURCE_LABEL: Record<string, string> = { 'ai-title': 'già nel transcript · gratis', haiku: 'Haiku' };
const AUTO_EVERY_MS = 5 * 60_000;
const MAX_SESSIONS = 300;
const PAGE = 100;
const BATCH = 50;
const FIRST_MESSAGES = 12;

const STYLE = `
.atl{font:14px/1.45 system-ui,sans-serif;padding:16px;max-width:880px;margin:0 auto}
.atl.dark{color:#e2e0f0}.atl.light{color:#0f0e1a}
.atl h2{font-size:16px;margin:20px 0 8px}
.atl .card{border:1px solid #8884;border-radius:8px;padding:12px;margin:8px 0}
.atl .err{color:#f43f5e;margin:6px 0}
.atl .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.atl .tile{border:1px solid #8884;border-radius:8px;padding:10px}
.atl .tile b{display:block;font-size:20px}
.atl .tile span,.atl .meta{font-size:12px;opacity:.7}
.atl select{padding:6px 8px;border:1px solid #8886;border-radius:6px;background:transparent;color:inherit;font:inherit}
.atl button{padding:6px 12px;border:1px solid #8886;border-radius:6px;background:#8882;color:inherit;cursor:pointer;margin:6px 6px 0 0}
.atl button.primary{background:#d97706;border-color:#d97706;color:#fff}
.atl button:disabled{opacity:.5;cursor:default}
.atl .item{display:flex;gap:10px;align-items:flex-start}
.atl .item .body{flex:1;min-width:0;overflow-wrap:anywhere}
.atl .old{opacity:.65;text-decoration:line-through;font-size:12px}
.atl .new{font-weight:600}
.atl label.inline{display:flex;gap:8px;align-items:center;margin:6px 0}.atl label.inline.wrap{flex-wrap:wrap}
`;

export function mount(container: HTMLElement, api: PluginAPI): void {
  const root = el('div', { class: `atl ${api.context.theme}` });
  container.append(el('style', {}, STYLE), root);

  let disposed = false;
  let busy = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let state: StateResponse | null = null;
  let proposals: Proposal[] = [];
  let summary = '';
  let error = '';
  let refsById = new Map<string, SessionRef>();

  /** Chiamata autenticata a CloudCLI col login del browser. Il token non esce da questa funzione. */
  async function appFetch(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = localStorage.getItem('auth-token');
    if (!token) throw new Error('Login di CloudCLI non trovato nel browser: accedi di nuovo.');
    const response = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    if (!response.ok) throw new Error(response.status === 401 ? 'Sessione scaduta: ricarica CloudCLI.' : `CloudCLI ha risposto ${response.status}.`);
    return ((await response.json()) as { data?: unknown }).data;
  }

  async function rpc<T extends { error?: string }>(method: string, path: string, body?: unknown): Promise<T> {
    const result = (await api.rpc(method, path, body)) as T;
    if (result.error) throw new Error(result.error);
    return result;
  }

  async function loadState(): Promise<void> {
    state = await rpc<StateResponse>('GET', 'state');
  }

  async function listConversations(): Promise<Conversation[]> {
    const all: Conversation[] = [];
    for (let offset = 0; offset < MAX_SESSIONS; offset += PAGE) {
      const data = (await appFetch(`/api/providers/sessions/recent?limit=${PAGE}&offset=${offset}`)) as { conversations: Conversation[]; hasMore: boolean };
      all.push(...data.conversations);
      if (!data.hasMore) break;
    }
    return all;
  }

  /** Primi messaggi di testo di una chat. CloudCLI pagina dalla coda: una richiesta per il totale, una per l'inizio. */
  async function firstMessages(sessionId: string): Promise<{ role: string; content: string }[]> {
    const base = `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages`;
    try {
      const head = (await appFetch(`${base}?limit=1`)) as { total?: number };
      const total = typeof head.total === 'number' ? head.total : 0;
      const page = (await appFetch(`${base}?limit=${FIRST_MESSAGES}&offset=${Math.max(0, total - FIRST_MESSAGES)}`)) as { messages?: { kind?: string; role?: string; content?: unknown }[] };
      return (page.messages ?? [])
        .filter((m) => m.kind === 'text' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role as string, content: m.content as string }));
    } catch {
      return [];
    }
  }

  async function analyze(): Promise<void> {
    if (busy) return;
    busy = true;
    error = '';
    summary = 'Analisi in corso…';
    render();
    try {
      const conversations = await listConversations();
      refsById = new Map(conversations.map((c) => [c.sessionId, { sessionId: c.sessionId, provider: c.provider, title: c.sessionTitle, projectName: c.projectDisplayName }]));
      const found: Proposal[] = [];
      const counts: Record<string, number> = {};
      let firstError = '';
      const refs = [...refsById.values()];
      for (let i = 0; i < refs.length; i += BATCH) {
        const batchRefs = refs.slice(i, i + BATCH);
        // Codex/OpenCode: il server non ha i loro transcript, si leggono i primi messaggi da CloudCLI.
        for (const r of batchRefs) if (r.provider !== 'claude') r.messages = await firstMessages(r.sessionId);
        let batch = (await rpc<ProposeResponse>('POST', 'propose', { sessions: batchRefs })).proposals;
        // Le sessioni nate da CloudCLI hanno un id diverso da quello del transcript: si chiede quello nativo e si riprova.
        const need = batch.filter((p) => p.status === 'need-native');
        if (need.length) {
          const retry: SessionRef[] = [];
          for (const p of need) {
            const ref = refsById.get(p.sessionId)!;
            try {
              const data = (await appFetch(`/api/providers/sessions/${encodeURIComponent(p.sessionId)}/provider-id`)) as { sessionId: string | null };
              if (data.sessionId) retry.push({ ...ref, nativeId: data.sessionId });
            } catch { /* resta need-native */ }
          }
          if (retry.length) {
            const again = (await rpc<ProposeResponse>('POST', 'propose', { sessions: retry })).proposals;
            const byId = new Map(again.map((p) => [p.sessionId, p]));
            batch = batch.map((p) => byId.get(p.sessionId) ?? p);
          }
        }
        for (const p of batch) {
          counts[p.status] = (counts[p.status] ?? 0) + 1;
          if (p.status === 'proposal') found.push(p);
          if (p.status === 'error' && !firstError) firstError = p.detail ?? '';
        }
      }
      proposals = found;
      summary = `${refs.length} chat esaminate · ${found.length} con un titolo da proporre · ${counts.manual ?? 0} con nome scelto a mano · ${counts.ok ?? 0} già a posto`
        + (counts.deferred ? ` · ${counts.deferred} rimandate (tetto Haiku)` : '')
        + (counts.unsupported ? ` · ${counts.unsupported} di altri agenti (non supportate)` : '')
        + (counts.error ? ` · ${counts.error} con errore${firstError ? ` (${firstError})` : ''}` : '');
      await loadState();
      if (state?.settings.auto) await applyMany(proposals);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      summary = '';
    } finally {
      busy = false;
      render();
    }
  }

  async function applyOne(p: Proposal): Promise<void> {
    if (!p.proposed) return;
    await appFetch(`/api/providers/sessions/${encodeURIComponent(p.sessionId)}`, { method: 'PUT', body: JSON.stringify({ summary: p.proposed }) });
    state = await rpc<StateResponse>('POST', 'applied', { sessionId: p.sessionId, title: p.proposed, previous: p.current, source: p.source });
    proposals = proposals.filter((x) => x.sessionId !== p.sessionId);
    // Aggiorna localmente la sessione rinominata, così la sidebar di CloudCLI si vede aggiornata
    const ref = refsById.get(p.sessionId);
    if (ref) ref.title = p.proposed;
  }

  async function applyMany(list: Proposal[]): Promise<void> {
    let done = 0;
    for (const p of [...list]) {
      try { await applyOne(p); done += 1; } catch (e) { error = e instanceof Error ? e.message : String(e); break; }
    }
    if (done) {
      summary = `${done} chat rinominate.`;
      // Dopo un attimo, ricarica l'elenco sessioni per aggiornare la sidebar di CloudCLI (non avviene automaticamente via REST)
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        const conversations = await listConversations();
        refsById = new Map(conversations.map((c) => [c.sessionId, { sessionId: c.sessionId, provider: c.provider, title: c.sessionTitle, projectName: c.projectDisplayName }]));
      } catch { /* continua comunque */ }
    }
  }

  async function undo(entry: AppliedEntry): Promise<void> {
    busy = true;
    render();
    try {
      await appFetch(`/api/providers/sessions/${encodeURIComponent(entry.sessionId)}`, { method: 'PUT', body: JSON.stringify({ summary: entry.previous || entry.sessionId }) });
      state = await rpc<StateResponse>('POST', 'undone', { sessionId: entry.sessionId });
      // Aggiorna localmente e ricarica l'elenco sessioni
      const ref = refsById.get(entry.sessionId);
      if (ref) ref.title = entry.previous || entry.sessionId;
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        const conversations = await listConversations();
        refsById = new Map(conversations.map((c) => [c.sessionId, { sessionId: c.sessionId, provider: c.provider, title: c.sessionTitle, projectName: c.projectDisplayName }]));
      } catch { /* continua comunque */ }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      render();
    }
  }

  async function setSettings(patch: Record<string, unknown>): Promise<void> {
    try {
      state = await rpc<StateResponse>('PUT', 'settings', patch);
      if (patch.auto === true) void analyze();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    render();
  }

  function renderStats(): Node {
    const s = state?.stats;
    const tile = (value: string, label: string): HTMLElement => el('div', { class: 'tile' }, el('b', {}, value), el('span', {}, label));
    return el('div', { class: 'tiles' },
      tile(usd(s?.avgCostPerHaikuChatUsd ?? 0), `costo medio per chat con Haiku (${s?.haikuCount ?? 0})`),
      tile(usd(s?.avgCostPerRenamedChatUsd ?? 0), 'costo medio su tutte le chat rinominate'),
      tile(usd(s?.totalCostUsd ?? 0), 'speso in totale'),
      tile(String(s?.freeCount ?? 0), 'titoli presi dal transcript (gratis)'));
  }

  function renderProposal(p: Proposal): HTMLElement {
    const ref = refsById.get(p.sessionId);
    return el('div', { class: 'card item' },
      el('div', { class: 'body' },
        el('div', { class: 'meta' }, `${ref?.projectName ?? ''} · ${SOURCE_LABEL[p.source ?? ''] ?? ''}${p.costUsd ? ` · ${usd(p.costUsd)}` : ''}`),
        el('div', { class: 'old' }, p.current),
        el('div', { class: 'new' }, p.proposed ?? '')),
      el('button', { type: 'button', disabled: busy, onclick: async () => { try { await applyOne(p); } catch (e) { error = e instanceof Error ? e.message : String(e); } render(); } }, 'Applica'));
  }

  function renderApplied(entry: AppliedEntry): HTMLElement {
    return el('div', { class: 'card item' },
      el('div', { class: 'body' },
        el('div', { class: 'meta' }, `${new Date(entry.at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' })} · ${SOURCE_LABEL[entry.source]}${entry.costUsd ? ` · ${usd(entry.costUsd)}` : ''}${entry.undone ? ' · annullata' : ''}`),
        el('div', { class: 'old' }, entry.previous),
        el('div', { class: 'new' }, entry.title)),
      entry.undone ? '' : el('button', { type: 'button', disabled: busy, onclick: () => void undo(entry) }, 'Annulla'));
  }

  function render(): void {
    if (disposed) return;
    const settings = state?.settings;
    const autoBox = el('input', { type: 'checkbox', onchange: (e: Event) => void setSettings({ auto: (e.target as HTMLInputElement).checked }) });
    autoBox.checked = !!settings?.auto;
    const cap = el('select', { onchange: (e: Event) => void setSettings({ maxHaikuPerRun: Number((e.target as HTMLSelectElement).value) }) },
      ...[0, 5, 10, 20, 50].map((n) => el('option', { value: n }, n === 0 ? 'nessuna (solo titoli gratuiti)' : String(n))));
    cap.value = String(settings?.maxHaikuPerRun ?? 10);
    const worst = (settings?.maxHaikuPerRun ?? 0) * (state?.stats.avgCostPerHaikuChatUsd || 0.003);

    root.replaceChildren(
      el('h2', {}, 'Costi'),
      renderStats(),
      el('h2', {}, 'Titoli'),
      el('div', { class: 'card' },
        el('div', {},
          el('label', { class: 'inline' }, autoBox, 'Applica da solo (finché questa scheda è aperta, ogni 5 minuti)'),
          el('label', { class: 'inline wrap' }, 'Chiamate a Haiku per analisi: ', cap)),
        el('div', { class: 'meta' }, `Al massimo circa ${usd(worst)} per analisi. I nomi scelti a mano non si toccano.`),
        el('button', { type: 'button', class: 'primary', disabled: busy, onclick: () => void analyze() }, busy ? 'Un attimo…' : 'Analizza le chat'),
        proposals.length ? el('button', { type: 'button', disabled: busy, onclick: async () => { busy = true; render(); await applyMany(proposals); busy = false; render(); } }, `Applica tutti (${proposals.length})`) : ''),
      error ? el('div', { class: 'err' }, error) : '',
      summary ? el('div', { class: 'meta' }, summary) : '',
      ...proposals.map(renderProposal),
      el('h2', {}, 'Ultime rinomine'),
      ...(state?.applied.length ? state.applied.map(renderApplied) : [el('div', { class: 'meta' }, 'Nessuna ancora.')]));
  }

  void loadState().catch((e) => { error = e instanceof Error ? e.message : String(e); }).finally(render);
  render();
  timer = setInterval(() => { if (state?.settings.auto) void analyze(); }, AUTO_EVERY_MS);
  (container as HTMLElement & { _atlStop?: () => void })._atlStop = () => { disposed = true; if (timer) clearInterval(timer); };
}

export function unmount(container: HTMLElement): void {
  (container as HTMLElement & { _atlStop?: () => void })._atlStop?.();
  container.replaceChildren();
}
