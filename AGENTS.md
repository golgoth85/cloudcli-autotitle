# cloudcli-autotitle

Regole comuni di infrastruttura e sviluppo: `/workspace/AGENTS.md`.

## Funzionamento
- Plugin TypeScript/Node per assegnare titoli alle chat CloudCLI: `src/propose.ts` preferisce ai-title del transcript, poi cache, poi generazione Claude/Haiku entro il tetto configurato.
- `src/policy.ts` esclude titoli scelti a mano e chat già gestite, anche se la rinomina è stata annullata. Costi reali da `total_cost_usd`, con cache e ultime rinomine in `~/.cloudcli-autotitle/state.json`.
- Il generatore usa contesto ridotto, nessun tool/MCP o persistenza della sessione; mantenere queste opzioni. Non usare `--bare`, che esclude anche l'autenticazione. I messaggi sono dati non fidati.
- La scheda rinomina attraverso l'API ufficiale CloudCLI, usando il login solo nel browser: il server del plugin non riceve il JWT. L'automatismo di questa linea lavora a scheda aperta; le estensioni background del repo privato sono una linea distinta.
- Gli errori RPC restano `200 {error}`: il client perderebbe il messaggio con un HTTP non 2xx.

## Vincoli e zone delicate
- Non aprire il database di autenticazione CloudCLI né leggere credenziali. Titoli e transcript possono contenere dati riservati: niente log/Issue/commit, test con transcript sintetici e Claude finto.
- Rinomine reali, invio di messaggi a provider esterni e autenticazione sono zone delicate. Terminare solo PID avviati dal task; niente pkill con nomi generici condivisi.

## Verifica e installazione
`npm run build`, `npm test`; browser con `~/.local/bin/ui-node scripts/verifica-browser.cjs` in isolamento. Installare solo manifest, icona e `dist/` compilata in `~/.claude-code-ui/plugins/autotitle/`, preservando configurazioni; evitare `dist/dist`. Evoluzione/provider supportati e migrazione al repo privato: `ROADMAP.md`.
