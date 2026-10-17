/**
 * Verifica nel browser (Chromium headless) del plugin, come richiede AGENTS.md del NAS.
 * Uso: ~/.local/bin/ui-node scripts/verifica-browser.cjs   (screenshot in /tmp/ui-check-autotitle)
 * Isolato: server del plugin con HOME temporanea, finto CloudCLI (elenco sessioni, rinomina, id nativo),
 * transcript finti e un finto `claude` (nessuna chiamata vera a Haiku, nessun dato reale).
 */
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawn } = require('child_process');
const DIST = path.join(__dirname, '..', 'dist');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'atlhome-'));
const OUT = '/tmp/ui-check-autotitle'; fs.mkdirSync(OUT, { recursive: true });
const TOKEN = 'token-di-prova';

const ID = (n) => `${String(n).repeat(8)}-0000-4000-8000-00000000000${n}`;
const proj = path.join(HOME, '.claude/projects/-prova'); fs.mkdirSync(proj, { recursive: true });
const tr = (id, q, title) => fs.writeFileSync(path.join(proj, `${id}.jsonl`), [
  JSON.stringify({ type: 'user', sessionId: id, message: { content: q } }),
  JSON.stringify({ type: 'assistant', sessionId: id, message: { content: [{ type: 'text', text: 'Risposta di prova.' }] } }),
  ...(title ? [JSON.stringify({ type: 'ai-title', sessionId: id, aiTitle: title })] : []),
].join('\n') + '\n');
tr(ID(1), 'Come configuro il reverse proxy per Immich dietro Cloudflare con un sottodominio dedicato?', 'Reverse proxy Immich dietro Cloudflare');
tr(ID(2), 'Scrivi uno script che ruota i log di nginx ogni notte e li comprime in archivio', null);
tr(ID(3), 'Domanda qualunque', 'Titolo che non verrà usato');
tr(ID(5), 'Perché il container Frigate riavvia in continuazione dopo l\'aggiornamento?', 'Riavvii continui del container Frigate');

const fakeClaude = path.join(__dirname, 'claude-finto');

// finto CloudCLI: stato modificabile
const sessions = [
  { sessionId: ID(1), provider: 'claude', projectDisplayName: 'prova', sessionTitle: 'Come configuro il reverse proxy per Immich dietro...' },
  { sessionId: ID(2), provider: 'claude', projectDisplayName: 'prova', sessionTitle: 'Scrivi uno script che ruota i log di nginx...' },
  { sessionId: ID(3), provider: 'claude', projectDisplayName: 'prova', sessionTitle: 'Il mio nome scelto a mano' },
  { sessionId: 'app-0000-4000-8000-000000000004', provider: 'codex', projectDisplayName: 'altro', sessionTitle: 'Si può fare in' },
  { sessionId: 'app-0000-4000-8000-000000000006', provider: 'codex', projectDisplayName: 'altro', sessionTitle: 'Nome Codex scelto a mano' },
  { sessionId: 'app-0000-4000-8000-000000000005', provider: 'claude', projectDisplayName: 'prova', sessionTitle: 'Perché il container Frigate riavvia in continuazione...' },
];
const ORIGINAL = sessions.map(s => s.sessionTitle);
const CODEX = [
  { kind: 'text', role: 'user', content: 'Si può fare in modo che i nuovi titoli si vedano senza ricaricare la pagina?' },
  { kind: 'tool_use', toolName: 'Bash', toolInput: { command: 'ls' } },
  { kind: 'thinking', content: 'ragionamento interno' },
  { kind: 'text', role: 'assistant', content: 'Sì: dopo ogni rinomina si rilegge l\'elenco delle chat.' },
];
const messageCalls = [];
const renames = []; let rpcSawAuth = false;

(async () => {
  const child = spawn('node', [path.join(DIST, 'server.js')], { env: { PATH: process.env.PATH, HOME, AUTOTITLE_CLAUDE_BIN: fakeClaude }, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise(r => child.stdout.on('data', d => { const m = /"port":(\d+)/.exec(String(d)); if (m) r(Number(m[1])); }));
  const pageHtml = (withToken) => `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;font-family:system-ui;background:#fff"><div id=root></div><script type=module>
    ${withToken ? `localStorage.setItem('auth-token','${TOKEN}');` : `localStorage.clear();`}
    const code = await (await fetch('/plugin.js')).text();
    const m = await import(URL.createObjectURL(new Blob([code], {type:'text/javascript'})));
    m.mount(document.getElementById('root'), { context:{theme:'light'},
      rpc: async (method, path, body) => { const r = await fetch('/rpc/'+path, {method, headers:{'content-type':'application/json'}, body: body?JSON.stringify(body):undefined}); if(!r.ok) throw new Error('RPC error '+r.status); return r.json(); } });
  </script>`;
  const json = (res, data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  const host = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(pageHtml(url.searchParams.get('login') !== '0')); }
    if (url.pathname === '/plugin.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(DIST, 'index.js'))); }
    if (url.pathname === '/rpc/excerpt-from-messages') { if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, { error: 'no' }, 401); let raw = ''; req.on('data', d => raw += d); req.on('end', async () => { const p = http.request({ host: '127.0.0.1', port, path: '/excerpt-from-messages', method: 'POST', headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }); p.write(raw); p.end(); }); return; } if (url.pathname.startsWith('/rpc/')) {
      if (req.headers.authorization) rpcSawAuth = true;
      const p = http.request({ host: '127.0.0.1', port, path: '/' + req.url.slice(5), method: req.method, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      return req.pipe(p);
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, { error: 'no' }, 401);
      if (url.pathname === '/api/providers/sessions/recent') return json(res, { success: true, data: { conversations: sessions, total: sessions.length, hasMore: false } });
      const mm = /^\/api\/providers\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
      if (mm) {
        const limit = Number(url.searchParams.get('limit')), offset = Number(url.searchParams.get('offset') || 0);
        messageCalls.push({ limit, offset });
        const end = CODEX.length - offset, page = CODEX.slice(Math.max(0, end - limit), end);
        return json(res, { success: true, data: { messages: page, total: CODEX.length, hasMore: false, offset, limit } });
      }
      const m = /^\/api\/providers\/sessions\/([^/]+)(\/provider-id)?$/.exec(url.pathname);
      if (m && m[2]) return json(res, { success: true, data: { sessionId: m[1].endsWith('5') ? ID(5) : null } });
      if (m && req.method === 'PUT') {
        let raw = ''; req.on('data', d => raw += d); req.on('end', () => {
          const summary = JSON.parse(raw).summary; renames.push({ id: m[1], summary });
          const s = sessions.find(x => x.sessionId === m[1]); if (s) s.sessionTitle = summary; json(res, { success: true, data: { sessionId: m[1], summary } });
        }); return;
      }
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => host.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${host.address().port}/`;

  const browser = await chromium.launch(); const report = [];
  for (const [name, vp, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['medio', { width: 1280, height: 850 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
    // stato pulito a ogni formato: titoli originali e nessuna rinomina registrata
    sessions.forEach((s, i) => { s.sessionTitle = ORIGINAL[i]; }); renames.length = 0;
    fs.rmSync(path.join(HOME, '.cloudcli-autotitle/state.json'), { force: true });
    const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage(); const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base); await page.waitForSelector('text=Costi');
    await page.screenshot({ path: `${OUT}/${name}-1-iniziale.png`, fullPage: true });
    await page.click('button:has-text("Analizza le chat")');
    await page.waitForSelector('text=chat esaminate');
    const summary = await page.locator('.meta', { hasText: 'chat esaminate' }).innerText();
    const proposed = await page.locator('.new').allInnerTexts();
    await page.screenshot({ path: `${OUT}/${name}-2-proposte.png`, fullPage: true });
    const info = { viewport: name, riepilogo: summary, proposte: proposed };
    if (name === 'desktop') {
      await page.locator('.card:has(.new:text-is("Reverse proxy Immich dietro Cloudflare")) button:has-text("Applica")').click();
      await page.waitForSelector('h2:has-text("Ultime rinomine") ~ .card .new:text-is("Reverse proxy Immich dietro Cloudflare")');
      await page.click('button:has-text("Applica tutti")');
      await page.waitForSelector('text=Nessuna ancora.', { state: 'detached' });
      await page.waitForFunction(() => document.querySelectorAll('.card.item button').length >= 3);
      await page.screenshot({ path: `${OUT}/desktop-3-applicate.png`, fullPage: true });
      info.rinomineRicevute = renames.map(r => r.summary);
      info.costiDopo = await page.locator('.tile').allInnerTexts();
      await page.locator('.card:has(.new:text-is("Reverse proxy Immich dietro Cloudflare")) button:has-text("Annulla")').click();
      await page.waitForSelector('text=annullata');
      info.dopoAnnulla = renames[renames.length - 1];
      await page.screenshot({ path: `${OUT}/desktop-4-annullata.png`, fullPage: true });
      await page.click('button:has-text("Analizza le chat")'); await page.waitForSelector('text=chat esaminate');
      info.riAnalisi = await page.locator('.meta', { hasText: 'chat esaminate' }).innerText();
      info.proposteRimaste = await page.locator('.new').count() - (await page.locator('h2:has-text("Ultime rinomine") ~ .card .new').count());
      const noLogin = await ctx.newPage(); await noLogin.goto(base + '?login=0'); await noLogin.waitForSelector('text=Costi');
      await noLogin.click('button:has-text("Analizza le chat")'); await noLogin.waitForSelector('.err');
      info.senzaLogin = await noLogin.locator('.err').innerText();
    }
    info.scrollOrizzontale = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    info.erroriConsole = errors; report.push(info);
    await ctx.close();
  }
  console.log(JSON.stringify(report, null, 1));
  console.log('Richieste ai messaggi (limit/offset):', JSON.stringify(messageCalls.slice(0, 4)));
  console.log('Il token di login è arrivato al server del plugin:', rpcSawAuth);
  const st = JSON.parse(fs.readFileSync(path.join(HOME, '.cloudcli-autotitle/state.json'), 'utf8'));
  console.log('Stato del plugin: rinomine', st.applied.length, '| chiamate Haiku registrate', st.runs.length, '| file stato permessi', (fs.statSync(path.join(HOME, '.cloudcli-autotitle/state.json')).mode & 0o777).toString(8));
  await browser.close(); child.kill(); host.close(); fs.rmSync(HOME, { recursive: true, force: true });
})().catch(e => { console.error('ERRORE', e.message); try { fs.rmSync(HOME, { recursive: true, force: true }); } catch {} process.exit(1); });
