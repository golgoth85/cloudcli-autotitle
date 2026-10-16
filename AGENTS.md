# cloudcli-autotitle

Guida generale del NAS: vedi `/workspace/AGENTS.md`.

## Scopo
Plugin per CloudCLI (scheda "Autotitle") che dà alle conversazioni un nome leggibile al posto del primo messaggio troncato, e mostra in dollari quanto costa farlo.

## Funzionamento
- **Titoli**, in quest'ordine (`src/propose.ts`): (1) la riga `ai-title` che Claude Code scrive già nel transcript (gratis; c'è nella maggior parte delle sessioni); (2) un titolo già generato e in cache (non si paga due volte); (3) Haiku, solo dove manca, entro il tetto "Chiamate a Haiku per analisi" (default 10).
- **Chat toccate**: solo quelle con nome di default (id, "Untitled…", prefisso del primo messaggio o dell'ultimo prompt; `src/policy.ts`). Un nome diverso è considerato scelto a mano e non si tocca. Le chat già passate dal plugin (anche se poi annullate) non si riproporranno.
- **Solo Claude** nella v0.1: le sessioni di altri agenti risultano "non supportate".
- **Generazione** (`src/generator.ts`): `claude -p --model haiku` con contesto ridotto (`--tools "" --strict-mcp-config --disable-slash-commands --setting-sources "" --system-prompt …`, cwd dedicata, `--no-session-persistence`): circa **0,003 $** a titolo contro 0,16 $ con le opzioni di default (circa 80.000 token di contesto). Non usare `--bare`: salta anche l'autenticazione. Il costo vero è `total_cost_usd` della risposta JSON. Il testo della chat si passa come dati; il prompt dice di ignorare istruzioni al suo interno.
- **Costi** (`src/store.ts`, `computeStats`): costo medio per chat con Haiku, costo medio su tutte le chat rinominate (comprese quelle gratuite), totale, numero di titoli gratuiti. Stato in `~/.cloudcli-autotitle/state.json` (permessi 600): impostazioni, costi, ultime 200 rinomine con titolo precedente, cache.
- **Rinomina**: la fa la pagina, non il server. Il server del plugin non ha il login di CloudCLI e riceve un ambiente senza segreti. La scheda legge il token del login già presente nel browser (`localStorage`, chiave `auth-token`) solo al momento della chiamata e usa la rinomina ufficiale `PUT /api/providers/sessions/:id`. Il token non si salva né si invia al server del plugin (verificato: nessun header `Authorization` sulle RPC).
- **Automatico**: l'opzione "Applica da solo" lavora **solo finché la scheda Autotitle è aperta** (la scheda si smonta quando la si lascia), ogni 5 minuti. Non è un servizio in background.
- Gli errori del server escono come `200 {error}` (il client di CloudCLI per un HTTP non 2xx mostra solo "RPC error <codice>").

## Perché non si scrive nel database di CloudCLI
Il database di autenticazione di CloudCLI (cartella `~/.cloudcli`) contiene anche utenti, chiavi API e credenziali: è un file di segreti, e il controllo di sicurezza dell'ambiente ne blocca l'accesso. Non riaprire questa strada. Neanche scrivere `custom-title` nel transcript serve: per le chat nate da CloudCLI il sincronizzatore salta quelle che hanno già un nome.

## Sicurezza e privacy
- Il contenuto delle chat (anche sanitarie o legali) va solo a Anthropic, come già avviene nella chat stessa. I titoli finiscono nello stato locale: non metterli in log, Issue o commit.
- Test e verifica usano transcript inventati e un finto `claude` (`scripts/claude-finto`): mai dati reali.

## Comandi
- `npm run build`, `npm test` (compila ed esegue i test `node --test`). `node_modules` è un collegamento a quello di `cloudcli-scheduler`.
- **Verifica nel browser** (obbligatoria per le modifiche UI): `~/.local/bin/ui-node scripts/verifica-browser.cjs`, screenshot in `/tmp/ui-check-autotitle` (1440×900, 1280×850, 390×844). Finto CloudCLI, finto `claude`, HOME temporanea. `/tmp` è noexec: i finti eseguibili stanno in `scripts/`.
- Installazione: copiare `manifest.json`, `icon.svg` e `dist/` in `~/.claude-code-ui/plugins/autotitle/`, poi abilitarlo dalle Impostazioni > Plugins. `dist/` è in `.gitignore`: va compilato dopo il clone.
- Non usare `pkill -f` con parole che compaiono nel proprio comando né con nomi generici come `dist/server.js`: chiude la propria shell e i server degli altri plugin.

## Regole
- Sviluppo qui, non nella cartella dei plugin di CloudCLI. Un task = un branch.
- Niente segreti in codice, log, commit, Issue. Tutto in italiano (interfaccia e documentazione); identificatori in inglese.
