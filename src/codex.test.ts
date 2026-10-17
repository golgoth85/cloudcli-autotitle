import assert from 'node:assert/strict';
import test from 'node:test';
import { propose } from './propose.js';
import { parseRefs } from './refs.js';
import { emptyState } from './store.js';
import { parseMessages } from './transcript.js';

const msgs = [
  { role: 'user', content: 'Si può fare in modo che i nuovi titoli vengano applicati senza ricaricare?' },
  { role: 'assistant', content: 'Sì, rileggo l\'elenco dopo ogni rinomina.' },
];
const ref = (sessionId: string, title: string, messages?: { role: string; content: string }[]) => ({ sessionId, provider: 'codex', title, projectName: 'x', messages });
const generate = async () => ({ title: 'Titoli senza ricarico', costUsd: 0.003, inputTokens: 300, outputTokens: 12 });

test('parseRefs: tiene i messaggi validi, scarta il resto e limita numero e lunghezza', () => {
  const [r] = parseRefs({ sessions: [{ sessionId: 's1', provider: 'codex', title: 't', projectName: 'p', messages: [
    { role: 'user', content: 'ciao' }, { role: 'tool', content: 'x' }, { role: 'assistant', content: '' }, { role: 'assistant', content: 'y'.repeat(5000) }, 'rumore', null,
    ...Array.from({ length: 30 }, () => ({ role: 'user', content: 'z' })),
  ], extra: 'ignorato' }] });
  assert.equal(r.messages!.length, 8); // dei primi 12 elementi, 4 sono scartati
  assert.equal(r.messages![1].content.length, 2000);
  assert.ok(!('extra' in r));
  assert.deepEqual(parseRefs({ sessions: [{ sessionId: 's2', provider: 'claude', title: '', projectName: '' }] })[0].messages, undefined);
  assert.throws(() => parseRefs({}), /mancante/);
});

test('parseMessages: primo messaggio utente ed excerpt, senza rumore di sistema', () => {
  const info = parseMessages([{ role: 'user', content: '<system-reminder>x</system-reminder>' }, ...msgs]);
  assert.equal(info.firstUserText, msgs[0].content);
  assert.match(info.excerpt, /^Utente: Si può fare/);
  assert.doesNotMatch(info.excerpt, /system-reminder/);
});

test('propose per Codex: nome di default → Haiku; nome manuale intatto; senza messaggi non supportata', async () => {
  const state = emptyState();
  const out = await propose([
    ref('c1', 'Si può fare in modo che i nuovi...', msgs),
    ref('c2', 'Il mio nome a mano', msgs),
    ref('c3', 'Si può fare in', undefined),
    ref('c4', 'Si può fare in', []),
    ref('c5', 'Si può fare in', [{ role: 'user', content: '<system-reminder>solo rumore</system-reminder>' }]),
  ], state, { auto: false, maxHaikuPerRun: 5 }, { generate });
  assert.deepEqual(out.map((p) => p.status), ['proposal', 'manual', 'unsupported', 'unsupported', 'no-transcript']);
  assert.equal(out[0].proposed, 'Titoli senza ricarico');
  assert.equal(out[0].source, 'haiku');
  assert.equal(state.runs.length, 1);
  assert.equal(state.cache.c1.title, 'Titoli senza ricarico');
});

test('propose per Codex: rispetta tetto Haiku, cache e chat già gestite', async () => {
  const state = emptyState();
  let calls = 0;
  const counting = async () => { calls += 1; return generate(); };
  const first = await propose([ref('c1', 'Si può fare in', msgs), ref('c2', 'Si può fare in', msgs)], state, { auto: false, maxHaikuPerRun: 1 }, { generate: counting });
  assert.deepEqual(first.map((p) => p.status), ['proposal', 'deferred']);
  const again = await propose([ref('c1', 'Si può fare in', msgs)], state, { auto: false, maxHaikuPerRun: 1 }, { generate: counting });
  assert.equal(again[0].proposed, 'Titoli senza ricarico');
  assert.equal(calls, 1);
  state.applied.push({ sessionId: 'c2', at: '', previous: '', title: '', source: 'haiku', costUsd: 0, undone: true });
  assert.equal((await propose([ref('c2', 'Si può fare in', msgs)], state, { auto: false, maxHaikuPerRun: 5 }, { generate: counting }))[0].status, 'ok');
  assert.equal(calls, 1);
});
