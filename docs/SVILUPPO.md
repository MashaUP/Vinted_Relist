# Vinted Relist — documentazione tecnica

Com'è fatta l'estensione, le regole da non rompere e cosa non è verificato su Vinted reale.
Aggiornata alla **2.7.1**. La storia delle scelte e dei bug è nel [CHANGELOG](../CHANGELOG.md);
i link del progetto in [LINK.md](LINK.md); dati trattati e privacy in [SECURITY.md](../SECURITY.md).

## 1. Architettura

Manifest V3, nessuna dipendenza a runtime, nessuna build: i file del repository sono quelli che il
browser carica. `npm` serve solo per ESLint e i test.

| Contesto | File | Ruolo |
|---|---|---|
| Service worker | `background.js` (+ `coda-logica.js`, `armadio-logica.js`, `versione.js`, `i18n.js`, `vintory-*.js` via `importScripts`) | legge token, account e formati dalle richieste di Vinted; **unico scrittore** di coda (`conCoda`) e inventario (`conInventario`); sveglie, recupero, esiti incerti, archivio, eventi, notifiche, download |
| Content script | `utils.js` → `api.js` → `editor-logica.js` → `relist.js` → `editor.js` → `coda-logica.js` → `queue.js` → `ui.js` → `content.js` (+ `i18n*.js`) | tutto ciò che parla con Vinted e compare nella pagina; l'ordine nel manifest conta |
| Mondo della pagina | `page-bridge.js` | strumenti di sola lettura in console, solo con `consoleBridge` acceso |
| Pagine dell'estensione | `popup.*`, `dashboard*.js`, `link-chrome.js`, `i18n-pagina.js` | interfaccia: leggono `chrome.storage`, mandano messaggi; non scrivono mai la coda |
| Moduli puri | `coda-logica`, `armadio-logica`, `editor-logica`, `analisi`, `versione`, `impostazioni`, `link`, `i18n`, `vintory-logica` | niente `chrome.*` né rete: si testano in Node con lo stesso file (`module.exports` o globale) |

## 2. Regole da non rompere

- **Nel dubbio non si ripubblica.** Un doppione su Vinted costa più di un articolo fermo un giro.
  Un esito incerto diventa `verify` e non si riprova da solo; «interrotto» solo con la fase
  `preparazione` registrata (il permesso di invio negato è la prova che niente è arrivato a Vinted).
- **Un solo scrittore.** `vrQueue` e `inventory` li scrive solo il service worker, una modifica
  alla volta. Con scritture concorrenti (2.0) un esito si perdeva 11 volte su 40 (`test-gara`).
- **Identità stabile.** Ogni articolo è il suo id Vinted, mai una posizione nell'elenco.
- **Regole per batch.** Si leggono con `overridesDi(coda, id)`, mai con `coda.overrides`.
- **Solo il tuo armadio.** L'account lo scrive solo il service worker dal cookie; la pagina non
  deduce mai l'id da link o dati. `relist()` ricontrolla il proprietario.
- **Link solo in `links.json`**, niente URL nell'HTML o nel codice (il README è l'unica copia).
- Niente telemetria, codice remoto, alterazioni delle foto per eludere i controlli.

## 3. Flussi

**Ripubblicazione** (`VR.relist`, `relist.js`): `GET /api/v2/item_upload/items/{id}` → bozza →
regole della batch e campi da riempire → foto scaricate dal service worker, ridisegnate (rotazione,
ritaglio) e caricate con `POST /api/v2/photos` → permesso di invio (`vr:relistConfirm`) →
`POST /api/v2/item_upload/items` → `POST /api/v2/items/{id}/delete` sul vecchio. Con «elimina, poi
pubblica» gli ultimi due si invertono e prima si salva `vrBackup:<id>`.

**Esiti:** `ok` → `done`; rifiuto esplicito → `error` (riprovabile secondo `sicuroRiprovare`);
dopo il permesso, rete caduta / 5xx / pagina morta → `verify`; nuovo pubblicato ma vecchio rimasto →
`verify`; fermato prima del permesso → `interrupted`; venduto → `skipped`. Tre esiti negativi di
fila mettono in pausa; 403/429: pausa di 5, 15, 45 minuti, poi stop.

**Coda:** messaggi `vr:queue*` in `MESSAGGI_CODA`, ognuno passa da `conCoda` e da una funzione pura
di `coda-logica.js`. La pagina scrive il giornale `vrOp:<id>` (fase, foto, id nuovo, esito). A 6
minuti `controllaLavoro` guarda il giornale e sonda la scheda; `verificaArticolo` cerca il nuovo
annuncio (id o foto caricate) con sole letture. All'avvio `recupera` riparte da giornale e fase.
Batch: `coda.batches[]` con regole e intervallo propri; aggiunte e modifiche non toccano l'attesa
già programmata.

**Account (2.7.0):** `accountDaCookie(cookie)` → `{ id, fonte }` (`v_uid`, `token`, `nessuno`,
`illeggibile`, `assente`) da due ascoltatori `webRequest.onSendHeaders` con `extraHeaders`: le
chiamate `/api/*` (anche token CSRF e formati) e il caricamento delle pagine (`main_frame`,
`sub_frame`). `vrVisto` registra quando e con quale fonte, mai i valori; Salute e report ne
ricavano «Richieste di Vinted» e il perché di un profilo mancante.

**Token di sessione (2.7.1):** `getCsrf` in `api.js` prova, in ordine: il token visto nelle
chiamate `/api/*` di Vinted (il service worker lo tiene in `vrTokens` **per sito** e lo dà solo
alla scheda di quel sito, `vr:getTokens`), la pagina aperta (`<meta name="csrf-token">`,
`__NEXT_DATA__`, dati negli `<script>`), poi `GET /items/new`. Le espressioni riconoscono
`"CSRF_TOKEN":"…"` anche con le virgolette precedute da `\` (dati di Next.js). Errori:
`sessione-scaduta` (rimando all'accesso o 401), `pagina-non-letta`, `token-assente`,
`comunicazione`, più `scollegata`; tutti con `e.sessione` (in coda «Sessione di Vinted non letta»,
riprovabile). Su 403 si riprova una sola volta con un token diverso (`vr:tokenRifiutato` lo toglie
al service worker). L'esito va al service worker (`vr:statoSessione` → `vrSessione`, senza
valori); `VR.provaSessione()` lo prova senza rete per la Salute (`vr:provaSessione`). Le forme
osservate o dedotte sono in [SITE_NOTES.md](SITE_NOTES.md).

**Campi per categoria:** si copia ogni chiave presente nella lettura (anche `false`/`null`); i
vuoti si riempiono solo se tutti gli altri tuoi articoli con lo stesso `catalog_id` (almeno 2) li
hanno e un valore ha almeno il 60%. Il formato appreso è per categoria (`itemFormats`). Telefoni:
`ontology_model_id` / `ontology_collection_id`.

**Ripubblica da Vintory (2.5):** contratto `vintory-relist` schema 2 (`docs/RELIST_BRIDGE.md` nel
repository di Vintory). ZIP letto senza librerie (`vintory-zip.js`), controlli puri
(`vintory-logica.js`), foto in IndexedDB (`vintory-db.js`), stato su Vinted riletto anche al
momento di pubblicare; registro `vintoryOrigine` contro i doppioni.

**Lingue (2.6):** testi in italiano nel codice; `src/lang/{en,fr,es,de}.json` con chiave il testo
italiano e `{0}` per le parti variabili. Ricerca: esatto → « — » → modello → numero + testo →
pezzi su « · », «: », «. ». Sulle pagine di Vinted si traducono solo gli elementi dell'estensione;
il dizionario lo dà il service worker. Dopo aver scritto testi nuovi: `node scripts/i18n-estrai.js`.

**Aggiornamenti e link (2.7.0):** `version.json` e `links.json` da
`raw.githubusercontent.com/<repo>/main/` (CORS aperto, nessun permesso, nessun limite di 60
richieste l'ora come l'API). Controllo a mano al massimo una volta al minuto, automatico ogni 12
ore con una notifica per versione. «Scarica lo zip» legge lo zip da raw in memoria, controlla che
sia uno zip, al massimo 50 MB, con lo SHA-256 di `version.json`; solo allora
`chrome.downloads.download` in `Download/Vinted Relist/`. `github.com/…/raw/HEAD` non va bene: il
redirect verso raw non ha CORS. Chiavi dei link: `bugs`, `ideas` (le vecchie `bug-report`,
`feature-request` valgono ancora, la nuova vince).

## 4. Dati salvati

`chrome.storage.local`: impostazioni (`VR.DEFAULTS`) con `userId`, `vintedOrigin`, `colorMap`,
`photoFormat`, `itemFormat`; `itemFormats` (per categoria, max 40); `inventory` e
`vrInventoryReplaced`; `vrQueue` (modello v3 con batch, le code 2.0/2.1 si migrano alla lettura),
`vrQueueArchive` (10), `vrQueuePrimaRiparazione`; `vrOp:<id>` (giornali, potati a 14 giorni);
`vrSnapshots` (60), `vrHistory` (30 giorni), `qualityScores`; `vrEvents` (150), `vrErrori` (50);
`queueDraft`, `queueTemplates` (20), `editorDrafts`, `vrBackup:<id>`; `updateCheck`,
`updateNotified`, `vrLinks`, `vrVisto`, `vintoryOrigine`, `lingua`.

`chrome.storage.session`: `vrTokens` (CSRF, anon-id, per sito), `vrSessione` (esito dell'ultima lettura per sito, senza valori), `vrQueueStep`. Mai in `local`, nei log,
negli eventi o nella diagnostica. IndexedDB `vintoryImport`: foto importate da Vintory.

## 5. Non verificato su Vinted reale

| Cosa | Se è diverso |
|---|---|
| Nome del campo del modello dei telefoni in pubblicazione (`ontology_model_id`) | Vinted chiede il modello; una modifica a mano di un telefono lo fa imparare |
| Risposta per un annuncio eliminato (404 atteso) e per uno venduto (Vintory) | lo stato risulta «non chiaro» e l'annuncio resta fuori |
| `/api/v2/wardrobe/<id>/items` per la verifica degli incerti | «non riesco a leggere»: l'articolo resta da verificare |
| Bollino «Venduto» e zone escluse nel DOM | il controllo dei dati (`is_closed`, `item_closing_action`) ferma comunque |
| Che il caricamento delle pagine porti `v_uid` o il token nel cookie | lo dice Salute › «Richieste di Vinted» (fonte del cookie) |
| Forma del token CSRF nelle pagine (`\"CSRF_TOKEN\":\"…\"` nei dati di Next.js) | «token non trovato nelle forme conosciute»: la diagnostica dice da quali fonti si è provato |
| Indirizzo a cui `/items/new` rimanda chi non è connesso | l'errore è «token non trovato» invece di «sessione scaduta» |
| Tabella degli id colore | nessun elenco di riserva: i colori si imparano dagli annunci |

Verificato sul sito vero nelle versioni passate: forma di `item_upload` e `photos`, id nel cookie
`v_uid`, `raw.githubusercontent.com` con `Access-Control-Allow-Origin: *` (misurato il 20/11/2026).

## 6. Limiti noti

- API interne non documentate: un cambiamento di Vinted può rompere la pubblicazione (mitigazioni:
  formati appresi, controllo preventivo, diagnostica).
- L'aggiornamento richiede di estrarre lo zip a mano (estensione non pacchettizzata).
- Repository privato: «Cerca aggiornamento» risponde «version.json non trovato».
- Gli articoli aggiunti dalla dashboard non passano dal controllo preventivo: si controllano al
  loro turno.
- Non è pronta per il Chrome Web Store (marchio, API interne, permessi ampi).
- Debito: elenco dei 17 domini ripetuto in manifest, `background.js`, `popup.js`, `dashboard.js`;
  `background.js` oltre 2000 righe; README oltre le 200 righe.

## 7. Test

```
npm ci && npm test           # ESLint + node tests/run.js (tutte le suite)
node tests/<suite>.js        # una suite
node tests/valida-link.js    # controlla un links.json prima di pubblicarlo
```

| Area | Suite |
|---|---|
| Ripubblicazione, campi, prezzi, editor | `test-mapping`, `test-sconto`, `test-prezzi`, `test-riempimento`, `test-campi`, `test-editor`, `test-flusso`, `test-260`, `dom/test-ui` |
| Coda nel service worker | `test-13`, `test-14`, `test-17`, `test-coda`, `test-coda2`, `test-coda-logica`, `test-coda-dinamica`, `test-gara`, `test-annulla`, `test-batch`, `test-ripubblica-ora`, `test-240` |
| Esiti incerti e permesso | `test-esito-incerto`, `test-pagina-coda`, `test-permesso` |
| Account e proprietà | `test-proprietario`, `test-account` |
| Token di sessione | `test-sessione` (fonti, forme, errori, 403/401, prova della Salute), `test-sessione-sw` (per sito, rifiutati, esiti, report, domini) |
| Inventario e dashboard | `test-armadio`, `test-analisi`, `test-qualita`, `test-geometria`, `dom/test-dashboard` |
| Vintory | `test-vintory` (con `VINTORY_ZIP` anche un'esportazione vera), `test-vintory-sw` |
| Lingue | `test-i18n` |
| Popup, link, aggiornamenti | `dom/test-popup`, `dom/test-opzioni`, `test-link`, `test-versione` |
| Pacchetto e `version.json` | `test-pacchetto` (cartella `Vinted_Relist/`, niente file di sviluppo, zip riproducibile, SHA-256) |

Le prove in Chromium vero (Playwright, con un Vinted simulato e, per l'account, un server HTTPS
locale) non sono nel repository. **Da fare a mano su Vinted reale**, su un articolo a cui tieni
poco: lettura del token (Salute › «Sessione» dopo aver aperto il proprio armadio); pubblicazione ed eliminazione vere, 403/429 veri, riconoscimento dell'account dopo
un'installazione nuova, «Scarica lo zip» contro il repository vero, notifiche di sistema,
`chrome.runtime.reload()`.
