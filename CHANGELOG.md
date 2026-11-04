# Changelog

Formato: una sezione per versione, la più recente in alto. Il popup (Salute › Novità) mostra le
ultime tre leggendo questo file dall'estensione installata.

Numerazione `x.y.z`: **x** quando cambia il modo di usarla o i dati salvati in modo non
compatibile, **y** per funzioni nuove, **z** per sole correzioni.

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
