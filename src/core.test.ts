import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CLAUDE_ARGS, generateTitle } from './generator.js';
import { cleanTitle, isDefaultName } from './policy.js';
import { propose } from './propose.js';
import { computeStats, emptyState } from './store.js';
import { findTranscript, parseTranscript } from './transcript.js';

const row = (o: unknown): string => JSON.stringify(o);
const SID = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';

function transcript(extra: string[] = []): string {
  return [
    row({ type: 'user', sessionId: SID, message: { role: 'user', content: 'Configura il backup notturno del NAS verso il disco esterno' } }),
    row({ type: 'assistant', sessionId: SID, message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'segreto' }, { type: 'text', text: 'Certo, ecco i passi.' }, { type: 'tool_use', name: 'Bash' }] } }),
    row({ type: 'user', sessionId: SID, message: { role: 'user', content: '<system-reminder>rumore</system-reminder>' } }),
    row({ type: 'user', sessionId: SID, isMeta: true, message: { role: 'user', content: 'meta' } }),
    'riga rotta {',
    ...extra,
  ].join('\n');
}

test('parseTranscript: primi scambi puliti, senza ragionamento, strumenti e rumore', () => {
  const info = parseTranscript(transcript([row({ type: 'ai-title', sessionId: SID, aiTitle: ' Backup  notturno NAS ' })]), SID);
  assert.equal(info.aiTitle, 'Backup notturno NAS');
  assert.equal(info.firstUserText, 'Configura il backup notturno del NAS verso il disco esterno');
  assert.match(info.excerpt, /^Utente: Configura/);
  assert.match(info.excerpt, /Assistente: Certo, ecco i passi\.$/);
  assert.doesNotMatch(info.excerpt, /segreto|rumore|meta/);
});

test('parseTranscript: ignora le righe di altre sessioni e usa l\'ultimo titolo', () => {
  const info = parseTranscript(transcript([
    row({ type: 'ai-title', sessionId: SID, aiTitle: 'Primo' }),
    row({ type: 'ai-title', sessionId: 'altro', aiTitle: 'Estraneo' }),
    row({ type: 'ai-title', sessionId: SID, aiTitle: 'Secondo' }),
  ]), SID);
  assert.equal(info.aiTitle, 'Secondo');
});

test('isDefaultName: riconosce i nomi di default e rispetta quelli manuali', () => {
  const info = { firstUserText: 'Configura il backup notturno del NAS verso il disco esterno', lastPrompt: null };
  assert.equal(isDefaultName(SID, SID, info), true);
  assert.equal(isDefaultName('Untitled Claude Session', SID, info), true);
  assert.equal(isDefaultName('Configura il backup notturno del NAS...', SID, info), true);
  assert.equal(isDefaultName('  configura   il backup ', SID, info), true);
  assert.equal(isDefaultName('Backup NAS (da rifinire)', SID, info), false);
  assert.equal(isDefaultName('ok', SID, info), false);
});

test('cleanTitle: una riga, senza virgolette né markdown né punto finale, al massimo 60 caratteri', () => {
  assert.equal(cleanTitle('**"Backup notturno del NAS."**\naltro'), 'Backup notturno del NAS');
  assert.equal(cleanTitle('Titolo: Prova'), 'Prova');
  assert.equal(cleanTitle('x'.repeat(100)).length, 60);
  assert.equal(cleanTitle('   '), '');
});

test('generateTitle: titolo e costo reale dalla risposta di claude, con le opzioni di contesto minimo', async () => {
  let seen: string[] = [];
  const reply = JSON.stringify({ result: '"Backup NAS notturno."', total_cost_usd: 0.002654, usage: { input_tokens: 395, cache_creation_input_tokens: 0, cache_read_input_tokens: 10, output_tokens: 256 } });
  const generated = await generateTitle('Utente: ciao', async (_c, args, input) => { seen = args; assert.match(input, /Utente: ciao/); return reply; }, 'claude');
  assert.deepEqual(generated, { title: 'Backup NAS notturno', costUsd: 0.002654, inputTokens: 405, outputTokens: 256 });
  for (const flag of ['--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources']) assert.ok(seen.includes(flag), flag);
  assert.ok(!CLAUDE_ARGS.includes('--bare'));
  await assert.rejects(generateTitle('x', async () => JSON.stringify({ is_error: true, terminal_reason: 'api_error' }), 'claude'), /api_error/);
  await assert.rejects(generateTitle('x', async () => 'non json', 'claude'), /non valida/);
});

function withProjects(files: Record<string, string>, fn: (root: string) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atl-proj-'));
  fs.mkdirSync(path.join(root, '-workspace-x'), { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(root, '-workspace-x', `${name}.jsonl`), body);
  return fn(root).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

test('findTranscript: trova per id, rifiuta id non validi', async () => {
  await withProjects({ [SID]: '' }, async (root) => {
    assert.ok(findTranscript(SID, root)?.endsWith(`${SID}.jsonl`));
    assert.equal(findTranscript('../etc/passwd', root), null);
    assert.equal(findTranscript('cccccccc-0000-0000-0000-000000000000', root), null);
  });
});

test('propose: gratis se c\'è ai-title, Haiku solo dove manca, tetto, cache, nomi manuali intatti, annullate escluse', async () => {
  const ids = ['10000000-aaaa', '20000000-aaaa', '30000000-aaaa', '40000000-aaaa', '50000000-aaaa'];
  const mk = (id: string, extra: string[] = []) => [row({ type: 'user', sessionId: id, message: { content: `Domanda numero ${id}` } }), ...extra].join('\n');
  await withProjects({
    [ids[0]]: mk(ids[0], [row({ type: 'ai-title', sessionId: ids[0], aiTitle: 'Titolo gratuito' })]),
    [ids[1]]: mk(ids[1]),
    [ids[2]]: mk(ids[2]),
    [ids[3]]: mk(ids[3]),
  }, async (root) => {
    process.env.AUTOTITLE_PROJECTS_DIR = root;
    const state = emptyState();
    state.applied.push({ sessionId: ids[3], at: '', previous: '', title: '', source: 'haiku', costUsd: 0, undone: true });
    let calls = 0;
    const generate = async () => { calls += 1; return { title: `Titolo ${calls}`, costUsd: 0.003, inputTokens: 400, outputTokens: 20 }; };
    const ref = (id: string, title = `Domanda numero ${id}`, provider = 'claude') => ({ sessionId: id, provider, title, projectName: 'x' });
    const refs = [ref(ids[0]), ref(ids[1]), ref(ids[2]), ref(ids[3]), ref(ids[1] + 'zz', 'x', 'codex'), ref(ids[4]), ref('60000000-aaaa', 'Nome mio')];
    const out = await propose(refs, state, { auto: false, maxHaikuPerRun: 1 }, { generate });
    const by = Object.fromEntries(out.map((p) => [p.sessionId, p]));
    assert.deepEqual([by[ids[0]].status, by[ids[0]].source, by[ids[0]].proposed, by[ids[0]].costUsd], ['proposal', 'ai-title', 'Titolo gratuito', 0]);
    assert.equal(calls, 1);
    assert.equal(by[ids[1]].status, 'proposal');
    assert.equal(by[ids[1]].source, 'haiku');
    assert.equal(by[ids[2]].status, 'deferred');
    assert.equal(by[ids[3]].status, 'ok');
    assert.equal(by[ids[1] + 'zz'].status, 'unsupported');
    assert.equal(by[ids[4]].status, 'need-native');
    assert.equal(by['60000000-aaaa'].status, 'need-native');
    assert.equal(state.runs.length, 1);
    assert.equal(state.cache[ids[1]].title, 'Titolo 1');
    // seconda analisi: la sessione già pagata esce dalla cache senza nuova chiamata
    const again = await propose([ref(ids[1])], state, { auto: false, maxHaikuPerRun: 5 }, { generate });
    assert.equal(again[0].proposed, 'Titolo 1');
    assert.equal(calls, 1);
    // nome scelto a mano
    const manual = await propose([ref(ids[2], 'Il mio nome')], state, { auto: false, maxHaikuPerRun: 5 }, { generate });
    assert.equal(manual[0].status, 'manual');
    assert.equal(calls, 1);
    delete process.env.AUTOTITLE_PROJECTS_DIR;
  });
});

test('computeStats: medie per chat con Haiku e su tutte le chat rinominate', () => {
  const state = emptyState();
  state.runs.push({ sessionId: 'a', at: '', costUsd: 0.003, inputTokens: 0, outputTokens: 0 }, { sessionId: 'b', at: '', costUsd: 0.001, inputTokens: 0, outputTokens: 0 });
  state.applied.push({ sessionId: 'c', at: '', previous: '', title: 't', source: 'ai-title', costUsd: 0, undone: false });
  const s = computeStats(state);
  assert.deepEqual(s, { haikuCount: 2, freeCount: 1, totalCostUsd: 0.004, avgCostPerHaikuChatUsd: 0.002, avgCostPerRenamedChatUsd: 0.001333 });
  assert.equal(computeStats(emptyState()).avgCostPerHaikuChatUsd, 0);
});
