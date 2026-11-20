# Changelog

Formato: una sezione per versione, la più recente in alto. Il popup (Salute › Novità) mostra le
ultime tre leggendo questo file dall'estensione installata.

Numerazione `x.y.z`: **x** quando cambia il modo di usarla o i dati salvati in modo non
compatibile, **y** per funzioni nuove, **z** per sole correzioni.

## 2.7.0 · Aggiornamenti verificati e account riconosciuto dalle pagine (20 novembre 2026)

Minor: una funzione nuova e retrocompatibile (verifica dello zip scaricato) più correzioni.
Nessun permesso nuovo, nessun dato da convertire.

### Novità
- **«Scarica lo zip» verifica quello che scarica:** lo zip si legge in memoria, se ne calcola lo
  SHA-256 e si confronta con quello scritto in `version.json` dallo script di pacchetto. Solo se
  coincide si salva in Download › Vinted Relist; altrimenti non si salva niente e il popup spiega
  perché (impronta diversa, non è uno zip, file mancante, rete). Prima si apriva solo una scheda
  di GitHub.

### Corretto
- **«Profilo Vinted: non ancora rilevato» da loggati, con Vinted aperto** (segnalato da un utente
  dopo la 2.6). *Causa:* l'account si leggeva dal cookie solo quando il sito chiamava le sue API;
  le schede aperte prima di installare o ricaricare l'estensione, e le pagine che arrivano già
  pronte dal server, non ne fanno, quindi con un'installazione nuova il profilo poteva non
  arrivare mai. *Correzione:* il cookie si legge anche dal caricamento delle pagine di Vinted
  (stessi siti dei permessi), e anche dal token di rinnovo se quello di accesso manca. Riprodotto
  in Chromium: la 2.6.1 non riconosce l'account da una pagina senza chiamate alle API, la 2.7.0 sì.
- **Controllo degli aggiornamenti e dei link fermato dal limite di GitHub.** *Causa:* si leggevano
  `version.json` e `links.json` dall'API di GitHub, che senza login concede 60 richieste l'ora per
  rete. *Correzione:* si leggono da `raw.githubusercontent.com` (ramo `main`), che non ha quel
  limite e non richiede permessi.
- **Diagnostica:** le righe solo informative uscivano con «ok»; ora con «--».
- **Traduzioni mancanti** in Salute (formato foto e annuncio, colori) e in alcuni messaggi del
  popup (verifica, backup, confronto impostazioni) e della console.

### Migliorato
- **Salute › «Richieste di Vinted»:** quando l'estensione ha visto Vinted l'ultima volta, su quale
  sito, e se il cookie dell'account c'era (mai il valore). Il **Profilo Vinted** non rilevato dice
  perché e cosa fare: ricaricare la scheda, accedere, oppure — se il cookie ha un formato nuovo —
  mandare la diagnostica. Lo stesso nel report completo (`riconoscimento`).
- **Link del progetto:** chiavi comuni a tutti i progetti, `bugs` e `ideas` al posto di
  `bug-report` e `feature-request`. Le chiavi vecchie si leggono ancora (cache e file remoti delle
  versioni precedenti). Chi ha ancora la 2.6 vede «Segnala un problema» e «Proponi un'idea» due
  volte in Salute finché non aggiorna.

### Repository
- `ci.yml`: controllo statico (ESLint), test e pacchetto di prova a ogni push e pull request.
- `package.json` nella radice (solo strumenti di sviluppo: ESLint, jsdom, acorn), `npm test`,
  `npm run build`, `npm run package`.
- Pacchetto riproducibile: la cartella `Vinted_Relist/` dentro lo zip, date e ordine fissi; lo
  script scrive `zip` e `sha256` in `version.json` e aggiorna versione e nome dello zip nei README.
  La release allega anche il file `.sha256`.
- `SECURITY.md`; `docs/SVILUPPO.md` ridotto all'essenziale.
- Tolto codice inutilizzato trovato da ESLint (`titoloDi` nella coda).

## 2.6.1 · Avvertenze e guida in cinque lingue (20 novembre 2026)

Patch: solo documentazione, il codice dell'estensione non cambia.

### Novità
- **Avvertenze** ([DISCLAIMER.md](DISCLAIMER.md)) in italiano, inglese, francese, spagnolo e
  tedesco: progetto non ufficiale e non affiliato a Vinted; i termini di Vinted possono vietare
  l'automazione e Vinted può limitare, sospendere o chiudere gli account; uso a proprio rischio,
  software fornito «così com'è»; nessuna responsabilità dell'autore per l'account, per annunci
  persi o duplicati, vendite mancate, dati persi, né per abusi o usi impropri dell'estensione o di
  sue versioni modificate.
- **Guida completa in cinque lingue:** README riscritto (guida rapida, consigli, cosa fare se
  qualcosa non va, privacy e permessi) e tradotto in `README.en.md`, `README.fr.md`,
  `README.es.md`, `README.de.md`. Avvertenze e guide sono anche nello zip dell'estensione.

## 2.6.0 · Lingue e modello dei telefoni (20 novembre 2026)

Minor: funzione nuova (lingue) e una correzione, retrocompatibili.

### Novità
- **Cinque lingue:** italiano, inglese, francese, spagnolo e tedesco. Pannello **«Lingua»**
  (🌐 nell'intestazione del popup e della dashboard): «Automatica» segue la lingua del browser
  (inglese se non è una delle cinque), oppure ne scegli una. Il cambio vale subito ovunque, anche
  sui bottoni già mostrati nelle pagine di Vinted, senza ricaricare. Sulle pagine di Vinted si
  traducono solo gli elementi dell'estensione, mai il sito; titoli e descrizioni dei tuoi annunci
  non vengono mai tradotti. Anche le notifiche di sistema escono nella lingua scelta.

### Corretto
- **Telefoni e altra elettronica:** ripubblicando, Vinted chiedeva di «selezionare il modello»
  anche se l'annuncio lo aveva (segnalato da un utente francese). Il modello letto dall'annuncio
  (`ontology_model_id`, e `ontology_collection_id` per le serie) ora passa nella pubblicazione;
  per le altre categorie non cambia nulla. Se Vinted lo chiede comunque, il messaggio spiega cosa
  fare: modificare e salvare una volta l'annuncio su Vinted (l'estensione impara i campi della
  categoria, ora anche per categoria e non solo dall'ultima modifica) e riprovare.

## 2.5.1 · Correzione per le release su GitHub (14 novembre 2026)

Patch: nessun cambiamento per chi usa l'estensione.

- **Zip della release:** il workflow si fermava ai test perché il DOM simulato della dashboard
  (jsdom) non ha `TextDecoder`, che il lettore ZIP di Vintory creava già al caricamento della
  pagina. Ora il lettore lo crea al primo uso e il test lo fornisce come fa il browser; aggiunto un
  controllo sul pannello «Ripubblica da Vintory».
- Workflow: annuncio della release su Discord, se c'è il secret `DISCORD_WEBHOOK_URL` (vedi
  README, «Pubblicare una versione»).
- Workflow: `actions/checkout@v5` e `actions/setup-node@v5` (Node 24, niente più avviso di
  deprecazione) e `ubuntu-24.04` fisso invece di `ubuntu-latest`.

## 2.5.0 · Ripubblica da Vintory (14 novembre 2026)

Minor: funzione nuova, retrocompatibile. Coda, batch, archivio e impostazioni restano come sono.

### Novità
- **Ripubblica da Vintory.** Nella dashboard, «Ripubblica da Vintory»: scegli o trascini lo ZIP
  «Per Vinted_Relist» esportato da Vintory (formato `vintory-relist`, schema 2). Serve soprattutto
  per gli annunci **già eliminati** da Vinted, che si ripubblicano **senza eliminare niente**.
- **Controlli prima di tutto:** formato e schema (uno più nuovo chiede di aggiornare Vinted
  Relist), ogni foto presente nello ZIP con il suo sha256 (una rovinata esclude l'annuncio, con il
  motivo), proprietario uguale all'account collegato, dati del modulo di vendita presenti.
- **Stato reale su Vinted**, riletto in sola lettura dalla scheda aperta: non più su Vinted
  (spuntato da solo), venduto (escluso), ancora online (escluso, con «usa Ripubblica normale»;
  oppure «ripubblica con la copia di Vintory», che elimina il vecchio come sempre).
- **Anteprima** con foto, titolo, prezzo, stato e avvisi (foto mancanti nell'archivio, marca,
  taglia, colori, condizioni o categoria cambiate a mano in Vintory: Vinted riceve l'id originale,
  lo scegli tu). Gli annunci scelti diventano **una batch nuova** con il Centro di modifica di
  sempre (regole e intervallo); la coda in corso non si ferma.
- **Foto in attesa in IndexedDB** (archivio `vintoryImport`), mai in `chrome.storage`: si
  cancellano quando l'annuncio è pubblicato, tolto dalla coda, saltato o fallito senza rimedio. Una
  coda con articoli da Vintory sopravvive al riavvio del browser.
- **Nessun doppione:** registro `vintoryOrigine` (id originale → nuovo annuncio, data, impronta
  delle foto). Riaprendo lo stesso ZIP i già ripubblicati compaiono come «già ripubblicato il …» e
  si riselezionano solo con «ripubblica di nuovo»; un esito incerto blocca il secondo tentativo
  finché la verifica non chiarisce.
- Nella coda della dashboard gli articoli da Vintory lo dicono («da Vintory, senza eliminare»).

## 2.4.0 · Intervallo per batch, venduti, marcatori, zip automatico delle release (6 novembre 2026)

Minor: funzioni nuove retrocompatibili. Code, archivio, inventario e impostazioni restano come
sono; le batch create prima prendono l'intervallo della loro coda.

### Novità
- **Intervallo per batch.** Nel Centro di modifica di una batch nuova c'è «Intervallo tra gli
  articoli»: è l'attesa prima di ognuno dei suoi articoli. È proposto uguale a quello della batch
  precedente, si cambia anche dopo (dashboard › batch › Modifica). Le altre batch tengono il loro,
  l'attesa già in corso non si azzera mai (né aggiungendo, né modificando, né togliendo articoli),
  pausa e riavvio lo conservano. La dashboard mostra «Intervallo: N min» per ogni batch, la stima
  della fine li somma.
- **Marcatori sulle card.** Ogni articolo che è nella coda mostra il suo stato (In coda · #2,
  In attesa · parte verso le 14:20, In elaborazione, Da verificare, Completato, Errore,
  Annullato), letto solo dallo stato salvato della coda: resta dopo un ricaricamento e si aggiorna
  da solo. In coda, in lavorazione e da verificare spengono la casella e bloccano «Ripubblica».
- **Zip allegato in automatico alle release di GitHub** (`.github/workflows/release.yml`): vedi
  il README, «Pubblicare una versione».

### Corretto
- **Articoli venduti:** le card con «Venduto» non hanno più casella né bottoni, e non c'è modo di
  ripubblicarli o modificarli: se Vinted dice che è venduto (anche quando la card non lo mostra
  ancora) l'operazione si ferma prima di caricare qualunque foto. Un articolo venduto mentre è in
  coda viene saltato e la coda continua. I venduti non contano nel valore dell'armadio e non si
  rimettono in coda.
- **Ripubblica e Modifica nel pannello delle notifiche di Vinted:** le notifiche contengono link
  ai tuoi articoli, e l'estensione li trattava come card dell'armadio. Ora una card deve essere nel
  contenuto principale della pagina, con una foto, e fuori da header, menu, finestre, notifiche e
  popup: lì non compare più niente, neanche nei pannelli che si aprono dopo.
- **Doppioni fra batch:** un articolo già in attesa, in lavorazione o da verificare (anche in una
  sessione passata) non entra in un'altra batch, nemmeno con due aggiunte nello stesso momento; il
  rifiuto dice il motivo.

## 2.3.1 · Pagina da ricaricare dopo un aggiornamento (4 novembre 2026)

Patch: una correzione.

### Corretto
- Dopo aver aggiornato o ricaricato l'estensione, la scheda di Vinted già aperta restava con il
  codice vecchio, scollegato: Modifica, Ripubblica e la coda fallivano con «Non riesco a leggere
  l'articolo: Token CSRF non trovato», anche con la sessione attiva. Ora la pagina se ne accorge,
  toglie i bottoni e dice di ricaricarla; se succede durante un'operazione il messaggio è
  «ricarica questa pagina (F5)», e niente viene inviato a Vinted.

## 2.3.0 · Permesso della coda, diagnostica, aggiornamenti, solo il tuo armadio (4 novembre 2026)

Minor: funzioni nuove retrocompatibili. Code, archivio, inventario e impostazioni restano come
sono; l'opzione «Mostra i bottoni ovunque» non c'è più.

### Corretto
- **«Fermato prima dell'invio a Vinted: permesso negato»**: la frase usciva ogni volta che la
  risposta del service worker alla richiesta di permesso arrivava **senza motivo**, cioè quando il
  service worker andava in errore mentre la concedeva (per esempio un salvataggio della coda
  rifiutato da `chrome.storage`) o rispondeva vuoto. La causa vera restava nascosta, l'articolo
  risultava «Annullato» e la coda passava al successivo, con lo stesso esito. Ora ogni no ha un
  codice e il suo motivo (salvataggio, errore interno, versioni diverse fra pagina e service
  worker, estensione ricaricata, service worker irraggiungibile, risposta vuota, tentativo già
  chiuso, annullamento), le risposte vuote e gli errori ritentabili si riprovano, e un problema
  dell'estensione **mette in pausa la coda** con il motivo: l'articolo torna in cima, «Interrotto»
  e non «Annullato», e gli altri non vengono toccati.
- Lo spazio pieno di `chrome.storage` non blocca più il permesso alla prima occasione: si
  compattano i dati che non servono più (giornali di tentativi chiusi, registri lunghi
  dell'archivio) e si riprova una volta.
- L'invio dell'articolo alla scheda ha un limite di 15 s: una scheda che non risponde non tiene
  più ferma la coda.
- Bottoni negli armadi altrui: l'id dell'account veniva dedotto anche da link o dati della pagina
  (che possono essere del profilo visitato) e, se non si riconosceva l'account, i bottoni
  comparivano comunque. Ora conta solo l'account letto dal cookie di Vinted dal service worker;
  nel dubbio non compare niente.
- La ripubblicazione usava come ripiego la scheda pubblica dell'articolo anche se l'annuncio non
  era tuo: ora controlla il proprietario prima di caricare qualunque foto.

### Nuovo
- **Report di confronto** (popup › Salute): versioni dei tre componenti, browser, permessi
  richiesti e concessi (anche per dominio), spazio usato per gruppo di chiavi, struttura della
  coda, sveglie, schede Vinted che rispondono e con che codice, errori recenti. Si scarica, si
  copia, e si **confronta** con quello di un'altra installazione: escono solo le differenze. Niente
  cookie, token, id utente, titoli o testi degli annunci.
- **Registro degli errori tecnici** (ultimi 50) e **riparazione mirata** dei dati della coda, con
  copia di com'era; la stessa riparazione all'avvio del service worker se la struttura non torna.
- **Aggiornamenti automatici**: ogni 12 ore (anche a popup chiuso, sopravvive al riavvio del
  browser) si legge il `version.json` del repository; una notifica **una volta sola** per ogni
  versione nuova; le prerelease solo a chi ne ha già una. Si spegne in Impostazioni.
- **Solo nel tuo armadio**: barre, caselle, selezione, pannello della coda e benvenuto compaiono
  solo nella pagina del tuo armadio (e il bottone sulla pagina di un tuo annuncio), e spariscono
  quando navighi altrove, anche senza ricaricare. Ripubblica, Modifica e Avvia ricontrollano al
  clic.

## 2.2.0 · Esiti certi, batch, «Ripubblica ora» (31 ottobre 2026)

Minor: funzioni nuove retrocompatibili. Le code della 2.1 si convertono da sole: i loro articoli
diventano la «Batch 1» con le regole con cui erano partite. Impostazioni, storico e inventario
restano com'erano.

### Corretto
- **«Nessuna risposta dalla scheda in 6 minuti»**: dopo 6 minuti l'articolo diventava «da
  verificare» senza guardare niente, e se l'esito arrivava dopo veniva scartato. Un articolo
  pubblicato restava così da verificare per sempre. Ora a 6 minuti si **chiede alla scheda** se
  sta ancora lavorando (foto lente, scheda in secondo piano): se sì si aspetta, fino a 30 minuti.
  Se la pagina è stata chiusa o ricaricata si decide con le prove, e un esito che arriva tardi
  vale ancora.
- **Prova certa prima dell'invio:** la pagina chiede il permesso al service worker subito prima
  della prima richiesta che cambia qualcosa su Vinted. Un tentativo dato per interrotto, o
  annullato, non può più pubblicare: niente doppioni.
- L'esito si ritrasmette finché il service worker non conferma di averlo ricevuto, e prima di
  partire viene scritto in un giornale del tentativo (`vrOp:<id>`): se il messaggio si perde, il
  risultato non si perde.
- «Annulla operazione» e la sonda vanno alla **scheda che lavora l'articolo**, non alla prima
  scheda Vinted aperta.
- Valore dell'armadio: una card del vecchio annuncio rimasta a schermo dopo la ripubblicazione lo
  rimetteva nell'inventario (contato due volte), e letture delle card e ripubblicazioni potevano
  cancellarsi a vicenda. Ora l'inventario lo scrive solo il service worker, una modifica alla volta.
- Il download di una foto bloccata non ferma più la pubblicazione per sempre (limite di 60 s).
- Riprendere i falliti di una sessione passata usava le opzioni della coda in corso: ora ognuno
  torna con le regole della sua batch.

### Nuovo
- **Stati distinti:** Completato, In elaborazione, Da verificare, Fallito e il nuovo
  **Interrotto** (fermato prima dell'invio: niente creato o eliminato, riprovarlo è sicuro; la
  prima volta torna in cima da solo).
- **«Verifica pubblicazione»** (dashboard e popup) e verifica automatica: controlla su Vinted, solo
  in lettura, se il vecchio annuncio esiste ancora e se c'è il nuovo, riconoscendolo dall'id
  restituito da Vinted o dalle foto caricate in quel tentativo, mai da titolo o prezzo. Lo stato
  cambia solo con una prova; altrimenti dice cosa manca.
- Messaggi degli esiti incerti più chiari: quale articolo, a che ora è partito, che la conferma
  non è arrivata, che potrebbe essere già online, di non riprovare e cosa fare.
- **Batch con regole indipendenti:** con una coda in corso, «Aggiungi alla coda» apre il **Centro
  di modifica** per i nuovi articoli (prezzo, descrizione, dati mancanti: le opzioni di sempre).
  Diventano una nuova batch con le sue regole; la coda non si ferma e le batch già in coda non
  cambiano. Si può partire copiando le regole di una batch esistente.
- **Pannello delle batch** nella dashboard: articoli, stato, regole, completati, in attesa,
  problemi; «Mostra solo questa», vista «Batch», chip della batch su ogni riga.
- **Modifica regole** di una batch: valgono solo per i suoi articoli in attesa, con un riepilogo
  di chi cambia e chi no; l'articolo in corso e i completati restano registrati con la revisione
  che hanno usato.
- **«Ripubblica ora»** su ogni articolo in attesa (anche tasto `R`): diventa il prossimo, con le
  regole della sua batch, senza interrompere quello in corso; in pausa sarà il primo alla
  ripresa. Mai su un «da verificare».
- **Valore dell'armadio** anche nel popup, aggiornato a ogni pubblicazione confermata; se una
  pubblicazione è in corso o da verificare lo dice invece di dare il numero per definitivo.

## 2.1.0 · Code dinamiche e link del progetto (23 ottobre 2026)

Minor: funzioni nuove retrocompatibili. Le code della 2.0 si convertono da sole alla prima lettura;
impostazioni, storico e inventario restano com'erano.

### Nuovo
- **Code dinamiche:** aggiungi, rimuovi e riordina articoli anche mentre la coda lavora o è in
  pausa; alla ripresa vale l'elenco aggiornato. «Aggiungi alla coda» dalla pagina, in fondo o in cima.
- **Pagina di gestione della coda** nella dashboard: stato di ogni articolo con etichetta e icona,
  azioni sulla riga e su più articoli, ricerca, filtri, trascinamento e riordino da tastiera.
- **Rimuovi dalla coda, Annulla operazione, Interrompi la sessione** sono tre gesti distinti;
  rimuovere non cancella niente su Vinted, annullare funziona solo prima dell'invio.
- Pausa dopo l'articolo in corso e **pausa a tempo**, ripresa affidabile anche a popup chiuso.
- **Stima dei tempi**, salute della coda, errori per categoria con cosa fare; pausa prudente
  dopo tre problemi di fila.
- **Cronologia** filtrabile, esportazione CSV e JSON, resoconto da copiare; sessioni precedenti da
  riprendere senza mai ripubblicare quelle già fatte; **modelli** di opzioni.
- **Link del progetto centralizzati** in `links.json`: icone GitHub e Discord nel popup e nella
  dashboard, sezione «Progetto e community» in Salute. L'invito Discord si cambia sul repository
  senza una versione nuova (si spegne in Impostazioni › Avanzate).
- Modelli per segnalare un problema e proporre un'idea su GitHub; `tests/valida-link.js`.

### Corretto
- **Esito perso con passo ed esito simultanei** (possibile doppia pubblicazione): le modifiche
  alla coda ora le fa solo il service worker, una alla volta. In prova: 11 esiti persi su 40
  prima, 0 dopo.
- «Interrompi» e «Salta» durante una pubblicazione segnavano annullato o saltato un articolo
  forse già pubblicato: ora si aspetta il suo esito.
- Nella pagina della coda comparivano scritte «null» accanto ai contatori e ai bottoni.
- Dopo un'azione su più articoli la selezione cambiava ma la vista no.

## 2.0.1 · Campi per categoria: niente falsi allarmi su libri e manga (19 ottobre 2026)

Patch: cambia come vengono classificati i campi mancanti, non il flusso di pubblicazione.

### Corretto
- **«Campi assenti rispetto al formato appreso: is_unisex» sui libri e sui manga.** Il confronto
  usava un unico formato appreso, quello dell'ultima modifica fatta a mano, anche se di un'altra
  categoria. Ora il formato si impara e si confronta **per categoria**; un campo che Vinted manda
  vuoto o `false` equivale ad assente (nota), solo un campo con un valore è una differenza reale
  (avviso). `is_unisex` non viene mai impostato d'ufficio.
- **«Nessun colore» su ogni libro.** È un avviso solo se tutti gli altri tuoi articoli della stessa
  categoria hanno un colore; altrimenti è una nota, visibile ma non un problema.
- Il riempimento automatico poteva assegnare un colore in una categoria dove solo alcuni articoli
  ce l'hanno: ora riempie solo se il campo c'è su tutti gli altri articoli della categoria.
- L'anteprima dei riempimenti li annunciava anche con il riempimento spento.
- Il punteggio di completezza toglieva punti ai libri per il colore.
- «Dimensione del pacco non impostata» compariva due volte nel controllo preventivo.
- Id colore non validi nella lettura venivano inviati così com'erano: ora si scartano.
- `VR.settings()` nella console mostrava l'id utente e il payload catturato, al contrario di quanto
  diceva il README: ora riassume i formati come elenchi di campi.

### Nuovo
- `VR.diagnosi(ID)` nella console: per colore, unisex, pacco e i campi del formato della
  categoria mostra valore originale, convertito e inviato, fonte (originale, derivazione,
  riempimento, opzioni della coda) e motivo.
- Nel controllo prima di avviare le **note** (assenze legittime) sono separate dagli avvisi.

## 2.0.0 · Popup nuovo, coda affidabile, download delle foto (17 ottobre 2026)

Major perché cambiano insieme il popup, il ciclo di vita della coda (nuovi stati, archivio) e
il ponte della console, che non pubblica più.

### Nuovo
- **Popup a schede** Home, Notifiche, Salute, più le Impostazioni dall'ingranaggio: anello di
  avanzamento della coda, articolo corrente con miniatura, contatori, problemi da risolvere.
- **Centro notifiche**: esiti, errori ed esiti incerti restano in un registro (ultimi 150), con
  badge sull'icona per quelli non letti; clic su una notifica di sistema → riepilogo di quella coda,
  riusando la scheda della dashboard se è già aperta.
- **Salute**: controlli locali (profilo, scheda, sessione, formati, colori, coda), verifica del
  formato su un articolo, **diagnostica** da copiare con anteprima e senza segreti.
- **Cerca aggiornamento**: confronta la versione installata con `version.json` del repository
  GitHub, mostra le note, scarica lo zip e ricarica l'estensione dopo che hai estratto i file.
  Nessun codice scaricato viene eseguito.
- **Scarica le foto** dall'editor: selezione multipla o singola, qualità più alta disponibile,
  formato originale (WebP resta WebP), nomi `vinted-<id>-foto-NN`, due download alla volta,
  riepilogo finale. Non cambia le foto da ripubblicare.
- **Stato «da verificare»** per gli esiti incerti (rete, timeout, errori 5xx, eliminazione del
  vecchio non riuscita): non vengono mai riprovati alla cieca; si risolvono con «È stato
  pubblicato» / «Non è uscito».
- **Riprova i falliti**: riparte solo con gli articoli falliti, anche da una coda archiviata.
- **Archivio** delle ultime 10 code concluse, consultabile dalla dashboard (`#coda-<id>`).
- **Opzioni della coda** riorganizzate in Prezzo, Testo e descrizione, Dati mancanti,
  Pianificazione: errori in linea, anteprima del prezzo, stato salvate/non salvate, Ripristina,
  Annulla, Salva, Salva e avvia; le scelte restano salvate tra una sessione e l'altra.
- **Controllo prima di avviare** su tutti gli articoli selezionati, con riepilogo pronti / con
  avvisi / bloccati e avvio dei soli utilizzabili.
- **Dashboard**: ricerca senza accenti, ordinamento (relist, prezzo, visite, preferiti, qualità,
  titolo), miniature caricate quando servono, confronto prima/dopo di ogni relist.
- **Impostazioni** con validazione in linea (fasce orarie, numeri, repository), durata e
  attivazione degli avvisi sulla pagina, backup e ripristino delle sole impostazioni.
- Nuova icona, link Ko-fi nel popup e nella dashboard.

### Corretto
- La scritta «null» compariva tra i controlli dell'editor.
- Il colore mancante bloccava la pubblicazione anche dove Vinted non lo chiede (es. libri), con il
  menu dei colori disattivato: ora è un avviso e il campo è facoltativo.
- Testo grigio e poco leggibile nei campi dell'estensione dentro Vinted.
- Il bottone della card e la coda potevano lavorare sullo stesso articolo nello stesso momento.
- Un secondo clic su Avvia poteva sostituire una coda in corso.
- Recupero e watchdog ripubblicavano un articolo forse già uscito: ora lo segnano «da verificare».
- Pubblicato ma con il vecchio annuncio non eliminato veniva contato come fallito e riprovato.
- Gli avvisi in basso coprivano il pannello della coda e le sue opzioni.
- L'anteprima del prezzo nelle opzioni diceva «invariato» se un altro campo era sbagliato.
- Il bottone Avvia restava spento se l'avvio veniva annullato.

### Sicurezza
- Il ponte della console è in sola lettura, spento di default e attivabile dalle Avanzate:
  gli script della pagina non possono più avviare una ripubblicazione.
- Il service worker scarica immagini solo dal CDN di Vinted; i download accettano solo immagini
  con nomi semplici; le pagine aperte dai messaggi sono solo quelle dell'estensione.

## 1.9.0 · Editor dell'annuncio

Ricostruita dal README di quella versione.

- Editor dal bottone Modifica: riordino delle foto, rotazione, ritaglio libero, quadrato e 4:5,
  rimozione e ripristino delle foto tolte.
- Controlli in tempo reale, punteggio di completezza, anteprima con le differenze prima → dopo.
- Bozza locale salvata da sola e distinta da ciò che viene inviato.
- Il collegamento «Apri il tuo armadio» usa l'id utente letto dal service worker.

## Versioni precedenti

Lo storico dettagliato delle versioni dalla 1.0.0 alla 1.8.x non è stato conservato.
