# Roadmap - cloudcli-autotitle

Ultimo aggiornamento: 2026-10-16 (v0.2.0)

## Fatto (v0.2.0)
### v0.1.0: base
- Titoli da `ai-title` del transcript (gratis) o da Haiku (circa 0,003 $), con tetto per analisi e cache.
- Nomi scelti a mano mai toccati; chat già gestite non riproposte.
- Scheda con costi (medio per chat con Haiku, medio su tutte, totale, titoli gratuiti), proposte, "Applica"/"Applica tutti", cronologia con "Annulla", modalità automatica a scheda aperta.
- Rinomina dal browser con il login già presente; il server del plugin non vede mai il token.
- 8 test (transcript, regole di nome, proposta, costo, statistiche); prova reale del backend con Haiku vero (0,0037 $ per un titolo); verifica nel browser sui tre formati con finto CloudCLI.

### v0.2.0: multi-agente
- Supporto Codex/OpenCode: lettura messaggi via `GET /api/providers/sessions/:id/messages`, estrazione excerpt, generazione titolo con Haiku.
- Endpoint server `/excerpt-from-messages` per ricavare titoli da messaggi grezzi.
- Tutti gli agenti supportati; niente più `unsupported` per provider diversi da Claude.

## Da fare
- **Provarlo in CloudCLI vero**: caricamento della scheda, presenza di `auth-token` nel `localStorage`, rinomina reale e aggiornamento della sidebar.
- Verificare se il plugin resta attivo quando si cambia scheda (oggi si assume di no: l'automatico vale a scheda aperta).
- Altri agenti (Codex, OpenCode): leggere i primi messaggi dalla cronologia (`GET /api/providers/sessions/:id/messages`) e passarli al server.
- Il titolo `ai-title` può cambiare durante la chat: valutare un aggiornamento periodico (oggi si propone una volta sola).
- Ordinare/filtrare le proposte per progetto.
- Cronologia dei costi per giorno.
