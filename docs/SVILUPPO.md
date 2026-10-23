# Vinted Relist — documentazione tecnica

Documento vivo: va aggiornato a ogni versione insieme a `CHANGELOG.md`. Descrive com'è fatta
l'estensione, perché è fatta così e cosa resta da verificare. Aggiornato alla **2.1.0**.
I link del progetto e la configurazione remota hanno un documento a parte: [LINK.md](LINK.md).

## 1. Architettura

Estensione Manifest V3, nessuna dipendenza esterna, nessun passaggio di build: i file del
repository sono quelli che il browser carica.

| Contesto | File | Ruolo |
|---|---|---|
| Service worker | `background.js` (+ `src/coda-logica.js` via `importScripts`) | cattura token, id utente e formati dalle richieste di Vinted; **unico scrittore della coda** (modifiche in fila con `conCoda`); sveglie, watchdog, recupero, rallentamento; archivio code; registro eventi e badge; notifiche; download; apertura pagine |
| Content script (mondo isolato) | `src/utils.js` → `api.js` → `editor-logica.js` → `relist.js` → `editor.js` → `coda-logica.js` → `queue.js` → `ui.js` → `content.js` | tutto ciò che parla con Vinted e compare nella pagina. L'ordine nel manifest conta: ogni file usa quelli prima |
| Mondo della pagina | `src/page-bridge.js` | strumenti di sola lettura nella console, solo se `consoleBridge` è attivo |
| Pagine dell'estensione | `src/popup.*`, `src/dashboard.*`, `src/dashboard-coda.js`, `src/link-chrome.js` | interfaccia; leggono `chrome.storage` e mandano messaggi al service worker; non scrivono mai la coda |
| Moduli puri | `editor-logica.js`, `analisi.js`, `versione.js`, `impostazioni.js`, `coda-logica.js`, `link.js` | logica senza `chrome.*` né rete: si testano in Node e si caricano nel browser con lo stesso file (`module.exports` o `window.*`) |

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

### Coda (2.1: `coda-logica.js` + `background.js`)

**Una sola fonte di verità.** La coda vive in `storage.local.vrQueue` e la scrive **solo** il
service worker. Ogni modifica (da pagina, popup, dashboard, sveglie, esiti) è un messaggio che
passa da `conCoda(lavoro)`: una catena di promesse che esegue un lavoro alla volta, legge la coda,
applica una funzione pura di `coda-logica.js`, scrive (`rev` + 1). Le funzioni interne ricevono la
coda già letta e non richiamano `conCoda` (niente stalli). Popup, dashboard e pagina leggono e si
aggiornano con `storage.onChanged`.

**Identità stabile.** Nessuna operazione usa indici: ogni elemento è il suo id Vinted, che compare
una volta per sessione. L'ordine dell'array è l'ordine di esecuzione dei `pending`.

| Stato dell'articolo | Etichetta | Terminale | Cosa si può fare |
|---|---|---|---|
| `pending` | In attesa | no | spostare, rimuovere dalla coda |
| `working` | In elaborazione | no | «Annulla operazione» (solo prima dell'invio) |
| `done` | Completato | sì | niente: l'annuncio vecchio non esiste più |
| `error` | Fallito | sì | riprovare, se `sicuro` ≠ `no` |
| `verify` | Da verificare | sì | «È stato pubblicato» / «Non è uscito»; mai riprovato da solo |
| `skipped` | Saltato | sì | riattivare aggiungendolo di nuovo |
| `cancelled` | Annullato | sì | riprendere la sessione |
| `removed` | Rimosso | sì | riaggiungere (non conta nel totale) |

Stati della sessione: `waiting`, `working`, `paused`, `scheduled`, `recovering`, `done`; più i flag
`stopDopoCorrente`, `pausaDopoCorrente` (+ `pausaMinuti`), `pausaAuto`/`motivoPausa`,
`riprendiAlle`, `erroriDiFila`, `backoff`.

Messaggi (`MESSAGGI_CODA` in `background.js`):

| Messaggio | Effetto |
|---|---|
| `vr:queueStart` | crea la sessione; stessa selezione già in corso = doppio clic, ignorato; selezione diversa con una coda attiva = rifiutata («usa Aggiungi alla coda») |
| `vr:queueAdd {items, dove}` | aggiunge in fondo o in cima, anche in esecuzione o in pausa; `valutaAggiunta` dice per ognuno aggiungi / riattiva / rifiuta e perché (già in coda, in elaborazione, già ripubblicato, da verificare, errore definitivo, limite di 500) |
| `vr:queueRemove {ids}` | solo `pending` → `removed`; l'articolo in corso è rifiutato con il motivo. **Non cancella nulla su Vinted.** Coda vuota → si chiude |
| `vr:queueMove {ids, dove}` / `vr:queueReorder {ordine}` | su, giù, cima, fondo; riordino completo (trascinamento) rifiutato se l'insieme è cambiato nel frattempo |
| `vr:queueRetry {ids?, queue?}` | solo `error` riprovabili, in fondo, `tentativi`+1; da una sessione archiviata li aggiunge alla coda attiva o ne avvia una nuova |
| `vr:queueRestore {queue}` | riprende una sessione archiviata: `cancelled`, `error` riprovabili, `pending`; **mai** `done` né `verify` |
| `vr:queueResolve` | conferma l'esito di un `verify` (coda corrente e archivio) |
| `vr:queuePause {minuti?}` / `vr:queueResume` | pausa subito se nessuno è in corso, altrimenti dopo l'articolo corrente; a tempo con la sveglia `vr:queueResume` |
| `vr:queueCancelCurrent` | annullamento cooperativo (sotto) |
| `vr:queueStop` | interrompe: i `pending` diventano `cancelled`; se un articolo è in corso aspetta il suo esito (`stopDopoCorrente`) |
| `vr:queueSkip` | salta il prossimo; rifiutato mentre un articolo è in corso |
| `vr:queueRecover`, `vr:queueClear` | riprende dopo un'interruzione; nasconde la sessione (resta in archivio) |
| `vr:relistDone` | esito dalla pagina → `concludiArticolo` |

**Annullare l'articolo in corso** è diverso da rimuoverlo e da interrompere la sessione.
`relist()` riceve un `segnale` e controlla prima di ogni foto e prima della prima chiamata
distruttiva (creazione, o eliminazione con l'ordine «elimina, poi pubblica»): oltre quel punto
`vr:relistCancel` risponde `troppoTardi` e si aspetta l'esito. La fase (`preparazione` / `invio`)
sta in `storage.session.vrQueueStep`, così la dashboard sa se il bottone è ancora utile.

**Esiti ed errori.** `classificaErrore` mette ogni esito in una categoria (temporaneo, dati,
sessione, non consentito, rete, interno, incerto) con `cosaFare` e `sicuroRiprovare`
(`si` / `dopo-correzione` / `no`). Tre esiti negativi di fila (`error` o `verify`) mettono la
coda in **pausa prudente** con il motivo. 403/429: l'articolo non si consuma, pausa di 5, 15,
45 minuti, poi stop.

**Recupero.** All'avvio del service worker (`recupera`): un `working` rimasto a metà diventa
`verify`, mai ripetuto; una pausa a tempo con la sveglia persa lo dice nella nota. Watchdog di
6 minuti senza esito → `verify`.

**Stima.** `stima()` usa la durata media osservata degli articoli conclusi in questa sessione più
l'intervallo; con meno di 2 campioni lo dice («stima indicativa»).

**Cronologia.** `coda.log` (max 300, 200 in archivio) con `natura`: `locale` (modifiche della coda:
niente inviato a Vinted), `vinted` (esiti), `sistema` (pause, recuperi). Esportazione CSV (con BOM,
protetta dalle formule) e JSON, resoconto da copiare: niente token, cookie, titoli nel resoconto.

**Perché il service worker scrive da solo.** Nella 2.0 popup, pagina e service worker scrivevano la
coda e `vr:queueProgress` (passo) e `vr:relistDone` (esito) potevano intrecciarsi: in un test che
li fa arrivare insieme l'esito andava perso **11 volte su 40**, e l'articolo sarebbe stato
ripubblicato due volte. Con `conCoda` e il passo spostato in `storage.session`: 40 su 40
(`test-gara`).

### Campi che dipendono dalla categoria (2.0.1)

Percorso di un campo, dalla lettura all'invio, con il punto in cui si decide:

1. **Lettura** `GET item_upload/items/{id}` → `source`. Un campo può esserci con un valore, esserci
   a `null`, o **mancare del tutto** (i libri non hanno `is_unisex`).
2. **Copia** (`buildDraft`): ogni chiave di `ALLOWED_FIELDS` presente in `source` viene copiata,
   `null` e `false` compresi. Una chiave assente resta assente.
3. **Derivazioni** (`DERIVATIONS`): `color1_id`/`color2_id` → `color_ids` (solo id interi positivi;
   nessun colore → `[]`).
4. **Opzioni della coda**: colore scelto, solo dove manca.
5. **Riempimento** (`valorePrevalente`): solo se il campo c'è su **tutti** gli altri tuoi articoli
   letti con lo stesso `catalog_id` (almeno 2) e un valore ha almeno il 60%. Altrimenti niente.
6. **Classificazione** (`VR.diagnosiCampi`, regole pure in `editor-logica.js`):
   - colore → `statoColore`: avviso solo se tutta la categoria lo usa, altrimenti nota;
   - campo mancante → `campoMancante`, confrontato **solo** con il formato appreso per la stessa
     categoria (`VR.formatoPerCategoria`): vuoto/`false` per Vinted = nota, con valore = avviso,
     nessun formato per la categoria = nota.
7. Editor, controllo preventivo e `VR.diagnosi(ID)` usano tutti la stessa classificazione.

Livelli: **bloccante** (titolo, prezzo, categoria, foto: Vinted rifiuterebbe), **avviso**
(differenza reale o dato che la categoria usa sempre), **nota** (assenza legittima, visibile ma
non conta come problema).

**Causa dei falsi allarmi della 2.0.0** (libri e manga):

- `is_unisex`: il controllo preventivo confrontava ogni articolo con **un solo** formato appreso,
  quello dell'ultima modifica fatta a mano su Vinted, di qualunque categoria. Se veniva da un
  articolo che manda `is_unisex` (abbigliamento, o anche un articolo che lo manda `false`), ogni
  libro — la cui lettura non ha quella chiave — risultava "con campi assenti". Il valore `false`
  non c'entrava: `buildDraft` copia anche i `false` e i `null`; l'avviso nasceva solo se la chiave
  mancava proprio.
- Colore: qualunque `color_ids` vuoto produceva un avviso, senza guardare se la categoria usa
  i colori. In più il riempimento contava solo gli articoli **con** colore: in una categoria mista
  avrebbe potuto assegnare un colore a un libro che non l'ha mai avuto. Anche il punteggio di
  completezza toglieva 10 punti ai libri per il colore.

### Controllo preventivo (`queue.js` → `VR.canary`)

Legge ogni articolo selezionato (foto provata solo sul primo), 400 ms di pausa tra uno e l'altro,
e lo classifica: pronto, con avvisi, bloccato. Le note si mostrano a parte e non trasformano un
articolo pronto in uno «con avvisi». Si ferma al primo errore di sessione (401/403).
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
| `itemFormats` | dalla 2.0.1: per ogni `catalog_id` (max 40) i nomi dei campi che Vinted manda e quali erano vuoti; nessun contenuto dell'annuncio |
| `inventory` | articoli visti nell'armadio: titolo, prezzo, visite, preferiti, miniatura, serie storica |
| `qualityScores` | completezza per articolo |
| `vrSnapshots` | ultimi 60 relist con prima/dopo |
| `vrHistory` | relist degli ultimi 30 giorni (statistiche) |
| `vrQueue` | coda corrente (modello v3; le code 2.0 si migrano alla lettura) |
| `vrQueueArchive` | ultime 10 code concluse, compatte |
| `vrEvents` | registro notifiche |
| `queueDraft` | opzioni della coda (senza orario di avvio) |
| `queueTemplates` | dalla 2.1: modelli di opzioni con nome (max 20) |
| `vrLinks` | dalla 2.1: ultima configurazione dei link valida letta da GitHub, ora dell'ultimo tentativo ed errore (vedi [LINK.md](LINK.md)) |
| `editorDrafts` | bozze dell'editor |
| `vrBackup:<id>` | copia di un annuncio cancellato prima che il nuovo fosse pubblicato |
| `updateCheck` | ultimo controllo aggiornamenti |

`chrome.storage.session` (si svuota alla chiusura del browser): `vrTokens` (CSRF e anon-id),
`vrQueueStep` (passo e fase dell'articolo in corso).
Non vengono mai scritti in `local`, nei log, negli eventi o nella diagnostica.

## 4. Sicurezza e privacy

- Nessuna telemetria. Richieste fuori da Vinted, tutte verso `api.github.com`, senza cookie né dati
  dell'utente: il controllo aggiornamenti (manuale) e la lettura di `links.json` (al massimo ogni
  12 ore aprendo popup o dashboard; si spegne in Impostazioni › Avanzate).
- La configurazione remota dei link è un dato non attendibile: solo `https`, host in elenco,
  testi in `textContent`, nessun codice (vedi [LINK.md](LINK.md)).
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
| L'avviso «campi assenti: is_unisex» sui libri nasceva da una chiave **assente** nella lettura, non da un `false` scartato | **Confermato** | `is_unisex` è in `ALLOWED_FIELDS` e `buildDraft` copia ogni chiave presente, anche `false`/`null`: l'unico modo di finire tra i «mancanti» è non esserci nella lettura |
| Il formato confrontato era di un'altra categoria | **Confermato** | fino alla 2.0.0 c'era un solo `itemFormat`, sovrascritto a ogni modifica fatta a mano, senza categoria |
| Per i libri `is_unisex` non è richiesto da Vinted | **Probabile** | gli annunci sono online senza; da confermare con una modifica a mano di un libro (`VR.settings()` → `formatiPerCategoria`) e una ripubblicazione di prova |
| Un campo che il form di Vinted manda `false`/`null` equivale a non mandarlo | **Probabile** | è il valore predefinito; resta una nota, non un'ipotesi usata per riempire |
| Rete caduta o 5xx durante la creazione possono aver pubblicato comunque | **Probabile** | comportamento tipico di un POST interrotto; per questo diventa «da verificare» |
| La tabella degli id colore di Vinted | **Da verificare** | fonti pubbliche in contraddizione (es. 12 = bianco o rosso): nessun elenco di riserva, i colori si imparano dagli annunci |
| Il repository si chiama `MashaUP/Vinted_Relist` ed è pubblico | **Confermato** (2.0.1) | clonato senza credenziali; `version.json` raggiungibile |
| Il selettore di file chiude il popup prima di restituire il file | **Probabile** | comportamento noto di Chrome; per questo l'import si apre in una scheda |
| Senza scritture serializzate l'esito di un articolo poteva perdersi (doppia pubblicazione) | **Confermato** (2.1) | `test-gara`: 11 esiti persi su 40 con il codice 2.0, 0 su 40 dopo |
| «Interrompi» o «Salta» durante una pubblicazione segnavano annullato/saltato un articolo forse già pubblicato | **Confermato** (2.1) | lettura del codice 2.0 e test; ora si aspetta l'esito |
| `api.github.com` consente richieste CORS dalle pagine dell'estensione senza `host_permissions` | **Confermato** (2.1) | Chromium reale con l'estensione caricata: lettura di `links.json` e `version.json` riuscita |
| L'invito Discord `EPsbQCuAkx` è valido | **Da verificare** | indicato dall'autore; da qui Discord non è raggiungibile |
| Le Issues del repository sono attive | **Probabile** | attive di default su GitHub; i link «Segnala» e «Proponi» le usano |
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
- Il confronto con il formato appreso funziona per le categorie in cui hai modificato e salvato
  a mano almeno un articolo dalla 2.0.1 (o l'ultima modifica prima era della stessa categoria);
  per le altre resta una nota «nessun formato per questa categoria».
- Le statistiche per categoria usano il `catalog_id` esatto: due sottocategorie di libri sono
  categorie diverse e non si prestano dati.
- Lo storico delle versioni prima della 1.9.0 non è stato conservato.
- Gli articoli aggiunti dalla dashboard non passano dal controllo preventivo (che legge da Vinted
  e vive nella pagina): vengono comunque letti e controllati quando arriva il loro turno.
- Intervallo e opzioni di una sessione non si cambiano a sessione avviata: valgono per tutti gli
  articoli, anche quelli aggiunti dopo.
- Finché `links.json` non è sul ramo `main`, Chrome scrive un 404 nella console delle pagine
  dell'estensione al massimo una volta l'ora.

## 7. Debito tecnico

| Voce | Impatto | Note |
|---|---|---|
| Elenco dei 17 domini ripetuto in manifest, `background.js`, `popup.js`, `dashboard.js` | medio | va tenuto allineato a mano; un modulo condiviso per le pagine è possibile, il manifest resta a parte |
| Impostazioni predefinite del service worker (`impostazioni()`) separate da `VR.DEFAULTS` | basso | il service worker non carica `utils.js`; valori oggi coincidenti |
| `background.js` oltre le 1000 righe | medio | la logica della coda è già in `coda-logica.js` (2.1); restano eventi, download, formati |
| `dashboard.js` ridisegna tutta la pagina a ogni cambio di inventario | basso | accettabile fino a qualche centinaio di articoli |
| Test non eseguiti in CI | medio | si lanciano a mano con `node tests/run.js` |
| Link nel README scritti a mano | basso | il README è statico: va allineato a `links.json` quando cambia l'invito |
| Verifica in Chromium reale fuori dai test automatici | basso | script a parte, non nel repository |
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
| 19 | Classificazione dei campi per categoria (note vs avvisi), formato appreso per categoria | alta | media | **fatto 2.0.1** |
| 20 | Raggruppare sottocategorie affini (es. tutti i libri) per avere più prove | bassa | media | da valutare: rischio di mescolare categorie con requisiti diversi |
| 21 | Code dinamiche: aggiunta/rimozione/riordino in esecuzione, menu di gestione, cronologia, esportazione, modelli | alta | alta | **fatto 2.1.0** |
| 22 | Scritture della coda serializzate nel service worker | alta | media | **fatto 2.1.0** (correzione di un bug reale) |
| 23 | Link centralizzati in `links.json` con aggiornamento da GitHub | media | media | **fatto 2.1.0** |
| 24 | Opzioni diverse per singolo articolo nella stessa coda | bassa | alta | proposta: oggi un modello per sessione, più semplice da capire |
| 25 | Cambiare intervallo e opzioni a sessione avviata | media | media | proposta |
| 26 | Controllo preventivo anche per gli articoli aggiunti dalla dashboard | media | media | proposta: richiede una scheda Vinted aperta |
| 27 | Ripristino di un articolo rimosso per errore («annulla rimozione») | bassa | bassa | proposta; oggi si riaggiunge |
| 28 | Redirect stabile su GitHub Pages per Discord | bassa | bassa | da valutare: il JSON basta (vedi LINK.md) |
| 29 | Libreria condivisa dei link per più progetti | bassa | media | rimandata finché un secondo progetto non la usa |
| 16 | Controllo qualità e ritaglio automatico delle foto | — | alta | **escluso** dall'autore |
| 17 | Finestra di annullamento dopo la pubblicazione | — | media | **escluso** dall'autore |
| 18 | Micro-alterazioni delle foto per eludere i controlli di somiglianza | — | — | **rifiutato**: è elusione dei controlli di Vinted |

## 9. Roadmap

- **2.1.x** — correzioni dalla prova reale delle code dinamiche e dei link.
- **2.2** — proposte 25, 26, 12, 14 se servono.
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
| `test-campi` | 2.0.1: `is_unisex` vero/falso/assente, colore, formato per categoria, nessun travaso fra libri, manga e abbigliamento, coerenza fra controllo preventivo e invio |
| `test-13`, `test-14`, `test-17`, `test-coda`, `test-coda2` | service worker: coda, recupero, watchdog, esiti, archivio, eventi, badge, notifiche |
| `test-coda-logica` | 2.1: modello puro della coda: aggiunta, rimozione, spostamento, riordino, riprova, stima, salute, errori, esportazione, migrazione |
| `test-coda-dinamica` | 2.1: code dinamiche nel service worker vero: aggiunte e rimozioni in corsa e in pausa, posizioni, stop e pausa dopo l'articolo, prudenza, pausa a tempo, recupero, ripresa di sessioni |
| `test-gara` | 2.1: passo ed esito che arrivano insieme, 40 volte: l'esito non si perde |
| `test-annulla` | 2.1: annullamento prima e dopo il punto di non ritorno |
| `test-link` | 2.1: `links.json` del pacchetto, validazione, protocolli e siti vietati, precedenza, cache, tempi, timeout |
| `test-versione` | versioni, aggiornamenti, diagnostica, impostazioni |
| `dom/test-ui` | editor in un DOM simulato: controlli, download foto, ritaglio, anteprima, pubblica |
| `dom/test-opzioni` | opzioni della coda, controllo preventivo, avvio |
| `dom/test-popup` | popup: coda, notifiche, salute, diagnostica, aggiornamenti, impostazioni; link (remoto valido, offline, JSON rotto, schema nuovo, spento, protocolli vietati, cache, repository diverso, interruttore) |
| `dom/test-dashboard` | menu di gestione della coda (azioni, selezione, trascinamento e tastiera, filtri, cronologia, esportazione, sessioni), ricerca, ordinamento, miniature, confronto, link nel piede |

`node tests/valida-link.js` controlla un `links.json` prima di pubblicarlo.

**Non eseguibili qui** e da fare a mano su Vinted reale, su uno o due articoli a cui tieni poco:
pubblicazione vera, upload foto, eliminazione, risposta reale a 403/429, notifica di sistema,
download effettivo nella cartella, `chrome.runtime.reload()`, controllo aggiornamenti e lettura
di `links.json` contro il repository vero, annullamento durante una pubblicazione vera, notifica
di sistema con il service worker sospeso.

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
- I link (Ko-fi `https://ko-fi.com/mashaup`, Discord, GitHub) stanno **solo** in `links.json`:
  niente URL nell'HTML o nel codice. Il README è l'unica copia a mano.
- La coda la scrive solo il service worker, attraverso `conCoda`: non aggiungere scritture di
  `vrQueue` altrove.
- Non introdurre telemetria, codice remoto o alterazioni delle foto per eludere i controlli.
