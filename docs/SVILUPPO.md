# Vinted Relist — documentazione tecnica

Documento vivo: va aggiornato a ogni versione insieme a `CHANGELOG.md`. Descrive com'è fatta
l'estensione, perché è fatta così e cosa resta da verificare. Aggiornato alla **2.0.0**.

## 1. Architettura

Estensione Manifest V3, nessuna dipendenza esterna, nessun passaggio di build: i file del
repository sono quelli che il browser carica.

| Contesto | File | Ruolo |
|---|---|---|
| Service worker | `background.js` | cattura token, id utente e formati dalle richieste di Vinted; coda (sveglie, watchdog, recupero, rallentamento); archivio code; registro eventi e badge; notifiche; download; apertura pagine |
| Content script (mondo isolato) | `src/utils.js` → `api.js` → `editor-logica.js` → `relist.js` → `editor.js` → `queue.js` → `ui.js` → `content.js` | tutto ciò che parla con Vinted e compare nella pagina. L'ordine nel manifest conta: ogni file usa quelli prima |
| Mondo della pagina | `src/page-bridge.js` | strumenti di sola lettura nella console, solo se `consoleBridge` è attivo |
| Pagine dell'estensione | `src/popup.*`, `src/dashboard.*` | interfaccia; leggono `chrome.storage` e mandano messaggi al service worker |
| Moduli puri | `editor-logica.js`, `analisi.js`, `versione.js`, `impostazioni.js` | logica senza `chrome.*` né rete: si testano in Node e si caricano nel browser con lo stesso file (`module.exports` o `window.*`) |

Tutto il codice del content script scrive su `window.VR`. Le pagine dell'estensione caricano
`utils.js` per riusare `VR.DEFAULTS` e `VR.h` senza duplicarli.

## 2. Flussi principali

### Ripubblicazione di un articolo (`VR.relist`, `src/relist.js`)

1. `GET /api/v2/item_upload/items/{id}` → bozza nel formato del form.
2. Applica opzioni (prezzo, testi, colore) e riempimento dei campi vuoti.
3. Scarica le foto dal CDN tramite il service worker (niente CORS), le ridisegna su canvas con
   rotazione e ritaglio, le esporta in JPEG e le carica con `POST /api/v2/photos`.
4. `POST /api/v2/item_upload/items` → nuovo annuncio.
5. `POST /api/v2/items/{id}/delete` sul vecchio (con ordine «pubblica, poi elimina»).
6. Snapshot prima/dopo in `vrSnapshots`, riga in `vrHistory`, inventario aggiornato.

Con ordine «elimina, poi pubblica» i passi 4 e 5 si invertono e prima di cancellare si salva
`vrBackup:<id>`.

### Esiti

| Esito | Quando | Stato in coda | Riprovabile |
|---|---|---|---|
| ok | creato (e vecchio eliminato) | `done` | — |
| `error` | Vinted ha rifiutato in modo esplicito (4xx con messaggio, campi non validi) | `error` | sì |
| `uncertain` | rete caduta, timeout, 5xx, risposta senza id, watchdog, interruzione a metà | `verify` | **no**, finché non lo confermi |
| `partial` | nuovo pubblicato, vecchio non eliminato | `verify` | **no**: riprovare creerebbe un terzo annuncio |
| `skipped` | saltato a mano, già ripubblicato dal bottone, già in lavorazione | `skipped` | — |
| — | coda interrotta prima del suo turno | `cancelled` | — |

Regola guida: **nel dubbio non si ripubblica**. Un doppione su Vinted costa più di un articolo
fermo un giro in più.

### Coda (`background.js`)

Stati della coda: `waiting` (sveglia impostata), `working` (articolo in corso), `paused`,
`scheduled` (avvio a data e ora), `recovering` (interrotta, aspetta te), `done`.

- **Avvio:** `vr:queueStart`. Gli id duplicati entrano una volta. Se una coda con la stessa
  selezione è già in corso la richiesta è un doppio clic e non cambia niente; con una selezione
  diversa viene rifiutata.
- **Passo:** la sveglia `vr:queueNext` manda `vr:relistOne` alla scheda di Vinted; il content
  script passa da `VR.esclusivo` (lo stesso blocco del bottone) e risponde con `vr:relistDone`.
- **Watchdog:** 6 minuti senza esito → `verify`.
- **Rallentamento:** 429 o 403 → pausa 5, 15, 45 minuti, poi stop. L'articolo non si consuma.
- **Recupero:** all'avvio del service worker, se la coda è attiva ma la sveglia manca, passa in
  `recovering`; l'eventuale articolo in lavorazione diventa `verify`.
- **Fine:** `fermaCoda` annulla i `pending`, archivia una copia compatta (ultime 10 in
  `vrQueueArchive`), registra l'evento e manda la notifica `vr-coda-<startedAt>`.
- **Verifica:** `vr:queueResolve {itemId, pubblicato, queue}` aggiorna la coda corrente e
  l'archivio.
- **Riprova:** `vr:queueRetry {queue?}` riparte con i soli `error`, con le opzioni della coda di
  origine (anche archiviata).

### Controllo preventivo (`queue.js` → `VR.canary`)

Legge ogni articolo selezionato (foto provata solo sul primo), 400 ms di pausa tra uno e l'altro,
e lo classifica: pronto, con avvisi, bloccato. Si ferma al primo errore di sessione (401/403).
Non garantisce l'esito: la decisione finale è di Vinted.

### Notifiche

Un solo registro, `vrEvents` (max 150, doppioni identici entro 60 s ignorati), scritto solo dal
service worker (`vr:event`). Tipi: `ok`, `info`, `warn`, `end`, `error`, `uncertain`.

| Canale | Cosa mostra |
|---|---|
| Avvisi sulla pagina (`VR.toast`) | esito immediato; durate 3/4/7/6 s, errori e incerti fissi; pausa al passaggio del mouse; stessa chiave = stesso avviso aggiornato; si chiudono aprendo le opzioni della coda |
| Badge sull'icona | numero di `error` e `uncertain` non letti |
| Popup › Notifiche | il registro completo; aprirlo segna tutto come letto |
| Notifica di sistema | fine coda; clic → dashboard su quella coda, riusando la scheda |

### Aggiornamenti (`versione.js`, popup › Salute)

1. `GET https://api.github.com/repos/<repo>/contents/version.json` con `Accept: application/vnd.github.raw+json`,
   senza credenziali, al massimo una volta al minuto, solo su richiesta.
2. Il JSON è trattato come dato non attendibile: semver obbligatorio, nome dello zip vincolato a
   `Vinted_Relist-x.y.z.zip`, note troncate e mostrate come testo.
3. «Scarica lo zip» apre `github.com/<repo>/raw/HEAD/<zip>`; l'utente estrae sopra la cartella;
   «Installa l'aggiornamento» chiama `chrome.runtime.reload()`. Nessun codice remoto viene
   eseguito: gira solo quello che è nella cartella.

Formato di `version.json` (nella radice del repository, non dentro l'estensione):

```json
{ "version": "2.0.0", "date": "2026-10-17", "zip": "Vinted_Relist-2.0.0.zip", "notes": ["…"] }
```

### Download delle foto (`VR.scaricaFoto`)

Usa le foto già scaricate dall'editor (nessuna richiesta in più), legge i primi 16 byte per
riconoscere il formato reale (JPEG, PNG, WebP, GIF, AVIF; in mancanza il tipo MIME), non
ricomprime, passa al service worker un data URL; il service worker accetta solo immagini e nomi
`[A-Za-z0-9_-]+.ext` e salva in `Download/Vinted Relist/` con `conflictAction: uniquify`.
Due download alla volta; un errore su una foto non ferma le altre.

## 3. Stato e persistenza

`chrome.storage.local` (resta finché non disinstalli):

| Chiave | Contenuto |
|---|---|
| impostazioni (`VR.DEFAULTS`) | scelte dell'utente, più `userId`, `vintedOrigin`, `colorMap`, `itemStats`, `photoFormat`, `itemFormat` imparati |
| `inventory` | articoli visti nell'armadio: titolo, prezzo, visite, preferiti, miniatura, serie storica |
| `qualityScores` | completezza per articolo |
| `vrSnapshots` | ultimi 60 relist con prima/dopo |
| `vrHistory` | relist degli ultimi 30 giorni (statistiche) |
| `vrQueue` | coda corrente |
| `vrQueueArchive` | ultime 10 code concluse, compatte |
| `vrEvents` | registro notifiche |
| `queueDraft` | opzioni della coda (senza orario di avvio) |
| `editorDrafts` | bozze dell'editor |
| `vrBackup:<id>` | copia di un annuncio cancellato prima che il nuovo fosse pubblicato |
| `updateCheck` | ultimo controllo aggiornamenti |

`chrome.storage.session` (si svuota alla chiusura del browser): `vrTokens` (CSRF e anon-id).
Non vengono mai scritti in `local`, nei log, negli eventi o nella diagnostica.

## 4. Sicurezza e privacy

- Nessuna telemetria. Unica richiesta esterna: il controllo aggiornamenti, manuale.
- Token e cookie: letti dal service worker, tenuti in `storage.session`, mai mostrati (il popup
  dice solo se la sessione c'è), mai nei nomi dei file né nella diagnostica.
- Diagnostica: elenco bianco delle impostazioni, niente titoli, `ripulisci()` oscura JWT, uuid,
  email e URL; anteprima obbligatoria prima di copiare.
- Messaggi al service worker trattati come input non attendibile: pagine apribili limitate a
  `src/dashboard.html` e `src/popup.html`; immagini scaricabili solo da `*.vinted.net|com`;
  download solo `data:image/*` con nomi semplici; id negli eventi ridotti a cifre.
- Ponte della console: sola lettura, spento di default.
- Backup delle impostazioni: solo le chiavi di `impostazioni.js`, validate anche all'import.
- Nessuna elusione: nessuna alterazione delle foto per cambiarne l'impronta, nessun
  aggiramento dei limiti (davanti a 429/403 si rallenta e ci si ferma).

## 5. Deduzioni

| Affermazione | Grado | Base |
|---|---|---|
| Le API `item_upload` e `photos` hanno la forma descritta in `DERIVATIONS` | **Confermato** | payload osservati in sessioni reali e funzionamento delle versioni precedenti |
| L'id utente è nel cookie `v_uid` (HttpOnly) o nel `sub` del token | **Confermato** | letto dal service worker; il link all'armadio funziona |
| Un annuncio online senza colore è stato accettato così, quindi il colore non è sempre obbligatorio | **Probabile** | deduzione logica; può cambiare per categoria o nel tempo |
| Rete caduta o 5xx durante la creazione possono aver pubblicato comunque | **Probabile** | comportamento tipico di un POST interrotto; per questo diventa «da verificare» |
| La tabella degli id colore di Vinted | **Da verificare** | fonti pubbliche in contraddizione (es. 12 = bianco o rosso): nessun elenco di riserva, i colori si imparano dagli annunci |
| Il repository si chiama `MashaUP/Vinted_Relist` ed è pubblico | **Da verificare** | dedotto dal nome del progetto e dell'account; modificabile nelle Avanzate |
| Il selettore di file chiude il popup prima di restituire il file | **Probabile** | comportamento noto di Chrome; per questo l'import si apre in una scheda |
| Gli alarm non sopravvivono al ricaricamento dell'estensione | **Probabile** | documentazione Chrome e comportamento osservato; il recupero copre entrambi i casi |

## 6. Problemi noti e limiti

- Dipendenza da API interne non documentate: un cambiamento di Vinted può rompere la
  pubblicazione. Mitigazioni: apprendimento dei formati, controllo preventivo, diagnostica.
- L'aggiornamento richiede l'estrazione manuale dello zip (limite delle estensioni non
  pacchettizzate).
- Con repository privato il controllo aggiornamenti risponde «non trovato».
- Le miniature dell'inventario possono puntare a foto di annunci cancellati: al primo errore di
  caricamento compare un riquadro vuoto.
- Il confronto prima/dopo mostra la descrizione «dopo» solo per i relist dalla 2.0.0.
- Lo storico delle versioni prima della 1.9.0 non è stato conservato.

## 7. Debito tecnico

| Voce | Impatto | Note |
|---|---|---|
| Elenco dei 17 domini ripetuto in manifest, `background.js`, `popup.js`, `dashboard.js` | medio | va tenuto allineato a mano; un modulo condiviso per le pagine è possibile, il manifest resta a parte |
| Impostazioni predefinite del service worker (`impostazioni()`) separate da `VR.DEFAULTS` | basso | il service worker non carica `utils.js`; valori oggi coincidenti |
| `background.js` oltre le 1000 righe | medio | candidati a moduli: coda, eventi, download, formati (richiede `importScripts` o service worker di tipo module) |
| `dashboard.js` ridisegna tutta la pagina a ogni cambio di inventario | basso | accettabile fino a qualche centinaio di articoli |
| Test non eseguiti in CI | medio | si lanciano a mano con `node tests/run.js` |
| Nessun test end-to-end su Vinted reale | alto | vietato per scelta (niente pubblicazioni di prova su larga scala); serve una prova manuale guidata |

## 8. Registro proposte

| # | Proposta | Priorità | Complessità | Stato |
|---|---|---|---|---|
| 1 | Popup a schede con centro notifiche e salute | alta | media | **fatto 2.0.0** |
| 2 | Stato «da verificare» e niente riprova alla cieca | alta | media | **fatto 2.0.0** |
| 3 | Blocco unico bottone/coda | alta | bassa | **fatto 2.0.0** |
| 4 | Download delle foto dall'editor | media | media | **fatto 2.0.0** |
| 5 | Opzioni della coda a sezioni con validazione e persistenza | alta | media | **fatto 2.0.0** |
| 6 | Controllo preventivo su tutti gli articoli | media | bassa | **fatto 2.0.0** |
| 7 | Cerca aggiornamento + changelog nel popup | alta | media | **fatto 2.0.0** |
| 8 | Archivio code e riepilogo in dashboard | media | media | **fatto 2.0.0** |
| 9 | Ricerca, ordinamento, miniature, confronto in dashboard | media | media | **fatto 2.0.0** |
| 10 | Backup/ripristino impostazioni | bassa | bassa | **fatto 2.0.0** |
| 11 | Controllo aggiornamenti automatico una volta al giorno (opzionale, spento di default) | bassa | bassa | proposta |
| 12 | Modulo unico per l'elenco dei domini | bassa | bassa | proposta |
| 13 | Dividere `background.js` in moduli | media | media | proposta |
| 14 | Esportazione CSV dell'inventario e dello storico | bassa | bassa | proposta |
| 15 | Prova manuale guidata (checklist) prima di ogni rilascio | alta | bassa | proposta |
| 16 | Controllo qualità e ritaglio automatico delle foto | — | alta | **escluso** dall'autore |
| 17 | Finestra di annullamento dopo la pubblicazione | — | media | **escluso** dall'autore |
| 18 | Micro-alterazioni delle foto per eludere i controlli di somiglianza | — | — | **rifiutato**: è elusione dei controlli di Vinted |

## 9. Roadmap

- **2.0.x** — correzioni dalla prova reale della 2.0.0.
- **2.1** — proposte 11, 12, 14 se servono.
- **3.0** — solo se cambia il modo di distribuire (per esempio Chrome Web Store, vedi §11).

## 10. Test

Nella cartella `tests/` del repository (non nell'estensione). Requisiti: Node 18+ e, per i test
dell'interfaccia, `npm install` in `tests/` (installa jsdom).

```
cd tests && npm install && node run.js
```

| Suite | Cosa copre |
|---|---|
| `test-mapping`, `test-sconto`, `test-prezzi`, `test-riempimento` | conversione lettura → scrittura, prezzi, campi vuoti |
| `test-analisi`, `test-qualita`, `test-geometria` | dashboard, completezza, ritaglio |
| `test-editor`, `test-flusso` | controlli dell'editor, flusso di ripubblicazione con API finte |
| `test-13`, `test-14`, `test-17`, `test-coda`, `test-coda2` | service worker: coda, recupero, watchdog, esiti, archivio, eventi, badge, notifiche |
| `test-versione` | versioni, aggiornamenti, diagnostica, impostazioni |
| `dom/test-ui` | editor in un DOM simulato: controlli, download foto, ritaglio, anteprima, pubblica |
| `dom/test-opzioni` | opzioni della coda, controllo preventivo, avvio |
| `dom/test-popup` | popup: coda, notifiche, salute, diagnostica, aggiornamenti, impostazioni |
| `dom/test-dashboard` | riepilogo coda, ricerca, ordinamento, miniature, confronto |

**Non eseguibili qui** e da fare a mano su Vinted reale, su uno o due articoli a cui tieni poco:
pubblicazione vera, upload foto, eliminazione, risposta reale a 403/429, notifica di sistema,
download effettivo nella cartella, `chrome.runtime.reload()`, controllo aggiornamenti contro il
repository vero.

## 11. Chrome Web Store: rischi

L'estensione **non è pronta** per il Chrome Web Store, e la distribuzione resta lo zip su GitHub.

- Marchio: nome e icona richiamano Vinted («V»), possibile violazione delle norme sui marchi.
- API interne non documentate e automazione non prevista dai termini di servizio di Vinted.
- Permessi ampi (`webRequest` con header, 17 domini) da giustificare in revisione.
- Mancano informativa sulla privacy e prova end-to-end documentata.

## 12. Note per le sessioni future

- Numerazione: x per cambi incompatibili o di flusso, y per funzioni, z per correzioni. Aggiorna
  insieme `manifest.json`, `version.json`, `CHANGELOG.md` e il nome dello zip nel README.
- Rilascio: `Vinted_Relist_GitHub.zip` con dentro la cartella `Vinted_Relist_GitHub` (tutti i file
  del repository) e lo zip `Vinted_Relist-x.y.z.zip` con la cartella `Vinted_Relist` da installare.
- Prima di dire che una cosa «funziona su Vinted», distingui: verificata sul sito, verificata nei
  test, dedotta.
- Il link Ko-fi è `https://ko-fi.com/mashaup`: non cambiarlo.
- Non introdurre telemetria, codice remoto o alterazioni delle foto per eludere i controlli.
