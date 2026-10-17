import http from 'node:http';
import { generateTitle } from './generator.js';
import { propose } from './propose.js';
import { parseRefs } from './refs.js';
import { cleanTitle } from './policy.js';
import { computeStats, loadState, recordOutcomes, saveState, MAX_APPLIED } from './store.js';
import type { AppliedEntry, StateResponse } from './types.js';

const MAX_BODY = 1_000_000;

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Gli errori escono come 200 `{error}`: il client di CloudCLI per un HTTP non 2xx mostra solo "RPC error <codice>". */
const fail = (res: http.ServerResponse, message: string): void => send(res, 200, { error: message });

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) { reject(new Error('Richiesta troppo grande.')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON non valido.')); }
    });
    req.on('error', reject);
  });
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function stateResponse(): StateResponse {
  const state = loadState();
  return { settings: state.settings, stats: computeStats(state), applied: [...state.applied].reverse().slice(0, 30) };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /state') return send(res, 200, stateResponse());

    if (route === 'PUT /settings') {
      const body = (await readBody(req)) as { auto?: unknown; maxHaikuPerRun?: unknown };
      const state = loadState();
      if (typeof body.auto === 'boolean') state.settings.auto = body.auto;
      if (typeof body.maxHaikuPerRun === 'number' && Number.isInteger(body.maxHaikuPerRun) && body.maxHaikuPerRun >= 0 && body.maxHaikuPerRun <= 50) state.settings.maxHaikuPerRun = body.maxHaikuPerRun;
      saveState(state);
      return send(res, 200, stateResponse());
    }

    if (route === 'POST /propose') {
      const refs = parseRefs(await readBody(req));
      const state = loadState();
      const proposals = await propose(refs, state, state.settings, { generate: (excerpt) => generateTitle(excerpt) });
      saveState(state);
      recordOutcomes(proposals.map((p, i) => ({ sessionId: p.sessionId, provider: refs[i].provider, current: p.current, status: p.status, detail: p.detail ?? '' })));
      return send(res, 200, { proposals });
    }

    // Il browser ha rinominato la chat: si registra per la cronologia e l'annullamento.
    if (route === 'POST /applied') {
      const body = (await readBody(req)) as Record<string, unknown>;
      const sessionId = str(body.sessionId);
      const title = cleanTitle(str(body.title));
      if (!sessionId || !title) return fail(res, 'Dati mancanti.');
      const state = loadState();
      const cached = state.cache[sessionId];
      const source = body.source === 'ai-title' ? 'ai-title' : 'haiku';
      const entry: AppliedEntry = { sessionId, at: new Date().toISOString(), previous: str(body.previous), title, source, costUsd: cached?.costUsd ?? 0, undone: false };
      state.applied.push(entry);
      if (state.applied.length > MAX_APPLIED) state.applied.shift();
      delete state.cache[sessionId];
      saveState(state);
      return send(res, 200, stateResponse());
    }

    if (route === 'POST /undone') {
      const body = (await readBody(req)) as Record<string, unknown>;
      const sessionId = str(body.sessionId);
      const state = loadState();
      const entry = [...state.applied].reverse().find((e) => e.sessionId === sessionId && !e.undone);
      if (!entry) return fail(res, 'Rinomina non trovata.');
      entry.undone = true;
      saveState(state);
      return send(res, 200, stateResponse());
    }

    return send(res, 404, { error: 'Non trovato.' });
  } catch (error) {
    return fail(res, error instanceof Error ? error.message : String(error));
  }
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object') console.log(JSON.stringify({ ready: true, port: address.port }));
});
