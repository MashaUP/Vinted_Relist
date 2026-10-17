# Changelog

Formato: una sezione per versione, la più recente in alto. Il popup (Salute › Novità) mostra le
ultime tre leggendo questo file dall'estensione installata.

Numerazione `x.y.z`: **x** quando cambia il modo di usarla o i dati salvati in modo non
compatibile, **y** per funzioni nuove, **z** per sole correzioni.

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
