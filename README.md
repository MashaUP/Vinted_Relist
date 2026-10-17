# Vinted Relist

Estensione Chrome e Brave per ripubblicare i tuoi annunci Vinted in un clic, da soli o in coda.
Modifica foto e testi prima di pubblicare, scarica le foto, misura cosa funziona e tiene lo
storico di ogni relist.

**Versione 2.0.0** · [Novità](CHANGELOG.md) · [Documentazione tecnica](docs/SVILUPPO.md) ·
[Supporta lo sviluppo su Ko-fi](https://ko-fi.com/mashaup)

## Cosa fa

- **Ripubblicazione in un clic:** clona l'annuncio (foto, titolo, descrizione, categoria, marca,
  taglia, condizione, colori, prezzo, spedizione) e cancella quello vecchio
  - nessun click simulato: usa le stesse API interne del sito, con la tua sessione
  - foto riscaricate alla risoluzione più alta e riconvertite in JPEG per l'upload
  - a fine lavoro la casella dell'articolo diventa una spunta verde
- **Editor dell'annuncio**, dal bottone Modifica:
  - **foto:** riordino trascinando (la prima è la copertina), rotazione a 90°, ritaglio libero,
    Quadrato e 4:5, rimozione — e le foto tolte si rimettono
  - **testi e prezzo:** titolo con contatore dei 100 caratteri, descrizione, prezzo, colore
    facoltativo
  - **controlli in tempo reale:** errori che bloccano (titolo vuoto o troppo lungo, prezzo
    non valido, nessuna foto) e avvisi che no (colore mancante, titolo corto o tutto maiuscolo,
    descrizione corta, contatti esterni), più il punteggio di completezza
  - **anteprima prima di pubblicare** con l'elenco esatto di cosa cambia (prima → dopo)
  - **bozza locale** salvata da sola e distinta da ciò che viene inviato
  - **scarica le foto:** una, alcune o tutte, nella qualità più alta disponibile e nel formato
    originale (WebP resta WebP, niente ricompressione), nella cartella Download › Vinted Relist
    con nomi `vinted-<id>-foto-01.webp`. Le foto scaricate sono quelle originali: rotazioni,
    ritagli e ordine dell'editor non cambiano
- **Coda:**
  - selezione con le caselle sulle card, Shift+clic per un intervallo, Tutti e Nessuno
  - **opzioni** divise in Prezzo, Testo e descrizione, Dati mancanti, Pianificazione, con errori
    mostrati sul campo, anteprima del prezzo su un articolo selezionato e stato
    «Salvate / Modifiche non salvate»; restano salvate tra una sessione e l'altra (tranne
    l'orario di avvio, che vale una volta)
  - **controllo prima di avviare:** legge ogni articolo selezionato senza pubblicare e li divide
    in pronti, con avvisi e bloccati; parti con i soli utilizzabili
  - pausa (riprende dal tempo residuo), salta, interrompi; doppio clic su Avvia innocuo
  - **stati di ogni articolo:** in attesa, completato, fallito, **da verificare**, saltato,
    annullato. «Da verificare» vuol dire che Vinted non ha dato una risposta chiara (rete,
    timeout, errore del server, vecchio annuncio non eliminato): non viene mai riprovato da solo,
    lo confermi tu con «È stato pubblicato» o «Non è uscito»
  - **Riprova i falliti:** riparte solo con quelli, con le stesse opzioni
- **Modifiche in blocco**, valide per tutti gli articoli in coda:
  - prezzo in percentuale, in euro (−0,50 €, +1,00 €) o fisso, mai sotto 0,50 €
  - cerca e sostituisci su titolo e descrizione, letterale e senza distinguere maiuscole
  - riga da aggiungere in fondo alla descrizione
  - colore dove manca: uno scelto da te, oppure dedotto dai tuoi articoli simili
- **Automazione:**
  - **fasce di picco:** la coda pubblica solo negli orari che scegli (predefiniti
    12:30–14:00 e 19:30–22:30) e fuori fascia aspetta l'apertura
  - **ripubblica da sola gli articoli fermi** da N giorni, con un tetto per volta
  - **ritmo irregolare:** intervalli variabili del ±30% e passi solo quando sei al computer
- **Protezioni:**
  - **rallentamento automatico:** davanti a un 429 o un 403 la coda non consuma l'articolo, si
    mette in pausa 5, poi 15, poi 45 minuti, poi si ferma
  - **un articolo alla volta:** il bottone della card e la coda condividono lo stesso blocco,
    quindi lo stesso articolo non può partire due volte
  - **recupero della coda:** se il browser o l'estensione si fermano a metà, al riavvio la coda
    è «interrotta» e aspetta te; l'articolo che era in lavorazione diventa «da verificare»
  - **ordine delle operazioni:** pubblica-poi-elimina (predefinito) o elimina-poi-pubblica, con
    copia dei dati salvata prima di cancellare
- **Popup:**
  - **Home:** coda con anello di avanzamento, articolo corrente, Pausa / Salta / Interrompi,
    contatori, problemi da risolvere; attività di oggi, 7 e 30 giorni
  - **Notifiche:** il registro di esiti, errori e aggiornamenti (ultimi 150), filtro Problemi,
    badge sull'icona per quelli non letti; clic per aprire la coda o l'articolo
  - **Salute:** controlli locali, verifica del formato su un articolo, diagnostica da copiare,
    **Cerca aggiornamento**, novità delle ultime versioni
  - **Impostazioni** dall'ingranaggio, a gruppi, con validazione sul campo e backup
- **Avvisi sulla pagina:** successo 3 s, informazione 4 s, avviso 7 s, coda finita 6 s; errori ed
  esiti incerti restano finché non li chiudi. Si fermano col mouse sopra, non si accumulano
  doppioni, si possono allungare o spegnere (errori esclusi)
- **Dashboard dell'armadio**, dal popup:
  - **riepilogo della coda** (attuale e ultime 10 concluse), filtrabile per stato, con verifica e
    «Riprova i falliti»; ci porta anche il clic sulla notifica di fine coda
  - gruppi Recenti, Stagnanti, Da ottimizzare, Mai ripubblicati, In regola
  - tabella con miniatura, prezzo, visite, preferiti, ultimo relist e completezza; **ricerca**
    (ignora maiuscole e accenti) e **ordinamento**
  - possibili duplicati: titoli quasi uguali e stesso prezzo
  - **cosa funziona:** visite a 48 ore di ogni relist, giorno e fascia migliori
  - **storico e ripristino** con **confronto prima/dopo** di titolo, prezzo e descrizione
- **Impara da solo** quello che Vinted cambia senza preavviso: i campi dell'upload foto, quelli
  del payload annuncio, il dizionario dei colori, il tuo id utente
- **17 domini:** `.it`, `.fr`, `.es`, `.de`, `.co.uk`, `.com` e gli altri regionali

## Cosa non fa, e perché

- **Non riporta in vita l'annuncio originale.** Ripubblicare significa crearne uno nuovo: visite,
  preferiti e anzianità ripartono da zero. Il ripristino rimette i contenuti di prima, non quelli.
- **Non altera le foto per renderle irriconoscibili** ai controlli di Vinted (micro-ritagli o
  rotazioni impercettibili per cambiarne l'impronta). Rotazione e ritaglio dell'editor sono
  modifiche che vedi e scegli tu.
- **Non tocca ISBN, misure e produttore**, e non sceglie la dimensione del pacco.
- **Non conosce gli articoli che non hai mai visto.** L'inventario si costruisce mentre navighi il
  tuo armadio, senza chiamate in più.
- **Non lavora a browser chiuso.** Serve Brave aperto e almeno una scheda su Vinted.
- **Non si aggiorna da sola.** Un'estensione caricata da cartella non può sostituire i propri
  file: «Cerca aggiornamento» ti dice se c'è una versione nuova e ti porta allo zip, l'estrazione
  la fai tu.
- **Non usa API pubbliche**, perché Vinted non ne ha: dipende da quelle interne del sito, che
  possono cambiare.
- **Non manda i tuoi dati da nessuna parte:** bozze, storico, statistiche e notifiche restano nel
  browser. L'unica richiesta fuori da Vinted è il controllo aggiornamenti, e parte solo quando
  premi il bottone.

## Installazione

Nella radice del repo c'è `Vinted_Relist-2.0.0.zip`: è l'estensione già pronta.

1. Scompatta lo zip **in una posizione stabile**, non nella cartella temporanea che Windows crea
   aprendo uno zip con doppio clic.
2. Apri `brave://extensions` (o `chrome://extensions`).
3. Attiva **Modalità sviluppatore** in alto a destra.
4. **Carica estensione non pacchettizzata** e seleziona la cartella `Vinted_Relist`.
5. Apri il tuo armadio su Vinted e ricarica la pagina.

## Aggiornamento

1. Popup › **Salute** › **Cerca aggiornamento**. Se c'è una versione nuova vedi le note.
2. **Scarica lo zip** ed estrailo **sopra la cartella attuale** dell'estensione, sostituendo i file.
3. **Installa l'aggiornamento**: l'estensione si ricarica con i file nuovi. Poi ricarica le schede
   di Vinted.

Se un articolo è in pubblicazione il bottone aspetta; con una coda attiva, dopo l'aggiornamento
la coda risulta «interrotta» e riparte con Riprendi.

Il controllo legge `version.json` dal repository `MashaUP/Vinted_Relist` con l'API pubblica di
GitHub: funziona solo se il repository è **pubblico**. Se ha un altro nome, cambialo in
Impostazioni › Avanzate › Repository per gli aggiornamenti.

## Permessi

| Permesso | Perché serve |
|---|---|
| `storage` | impostazioni, coda, inventario, storico, notifiche: tutto in locale |
| `webRequest` | leggere dalle richieste di Vinted il token di sessione, il tuo id e i formati |
| `alarms` | svegliare la coda all'orario giusto anche a popup chiuso |
| `notifications` | la notifica di fine coda |
| `idle` | il ritmo irregolare: niente passi quando non sei al computer |
| `downloads` | salvare le foto scaricate dall'editor e il backup delle impostazioni |
| siti `vinted.*` e `*.vinted.net` | chiamare le API di Vinted e scaricare le foto dal suo CDN |

## Quando ripubblicare

Vinted ordina feed e ricerche per data di aggiornamento: ripubblicare rimette l'articolo in cima,
e l'algoritmo misura l'interesse nelle prime ore. Se quella spinta parte alle tre di notte, si
consuma nel vuoto.

Indice di rendimento su oltre 12.000 annunci (gennaio–aprile 2026), 100 = media settimanale:

| Giorno | 7–9 | 12–14 | 19–22 | Totale |
|---|---|---|---|---|
| Lunedì | **105** | 98 | 102 | 97 |
| Martedì | **103** | 100 | 99 | 95 |
| Mercoledì | 98 | **110** | 106 | 104 |
| Giovedì | 101 | 97 | **108** | 100 |
| Venerdì | 96 | 95 | 94 | 92 |
| Sabato | 112 | **115** | 110 | 112 |
| Domenica | 108 | 118 | **125** | 123 |

- **Domenica sera, 20:00–22:00** è il momento migliore: traffico del 25% sopra la media.
- **Venerdì** è il giorno peggiore.
- **Da evitare:** 1:00–6:00, venerdì dopo le 21, sabato prima delle 10.

Quanto spesso:

- **Tra articoli diversi, 15–20 minuti**, che è l'intervallo predefinito della coda.
- **Lo stesso articolo, ogni 4–7 giorni, mai ogni giorno.** Su 2,4 milioni di articoli:

| Frequenza | Venduti in 14 giorni | Visite medie |
|---|---|---|
| 1× al giorno | 4% | 12 |
| Ogni 2 giorni | 9% | 28 |
| **Ogni 5–7 giorni** | **23%** | **94** |
| Ogni 10 giorni | 17% | 67 |
| Ogni 14 giorni | 11% | 43 |
| Mai | 6% | 21 |

Le fonti ([Relisted](https://relisted.io/en/blog/best-time-post-vinted),
[Vinkit](https://vinkit.co/it/blog/con-quale-frequenza-ripubblicare-annunci-vinted-studio-24m-articoli))
vendono entrambe strumenti di ripubblicazione e i dati vengono dai loro utenti: non sono
verificabili, e su frequenza si contraddicono. La risposta per il tuo armadio te la dà la
dashboard, dopo qualche settimana di relist misurati.

## Come funziona

| Passo | Chiamata |
|---|---|
| Legge l'articolo nel formato del form di pubblicazione | `GET /api/v2/item_upload/items/{id}` |
| Scarica le foto originali | `images*.vinted.net` |
| Ricarica ogni foto come nuova | `POST /api/v2/photos` |
| Crea il nuovo annuncio | `POST /api/v2/item_upload/items` |
| Elimina il vecchio | `POST /api/v2/items/{id}/delete` |

Lettura e scrittura non usano lo stesso formato: le conversioni stanno in `DERIVATIONS`
(`src/relist.js`). I dettagli, gli stati della coda e le scelte di progetto sono in
[docs/SVILUPPO.md](docs/SVILUPPO.md).

### Campi vuoti

| Campo | Cosa succede |
|---|---|
| `color_ids`, `is_unisex` | **Riempiti** se vuoti e se gli altri tuoi articoli della stessa categoria concordano; altrimenti l'annuncio parte senza, con un avviso. Se Vinted lo pretende, lo dice. |
| `package_size_id` | **Solo segnalato**: sbagliarlo si paga in spedizione. |
| `isbn`, misure, `manufacturer` | **Mai toccati**: sono dati del singolo oggetto. |

## L'ordine conta

- **Pubblica, poi elimina** (predefinito). Se la creazione fallisce il vecchio annuncio è ancora
  lì; il rischio opposto è un doppione da togliere a mano.
- **Elimina, poi pubblica**. Relist pulito, ma se Vinted rifiuta la creazione l'annuncio è già
  sparito. Prima di cancellare l'estensione salva una copia dei dati, recuperabile dalle
  Impostazioni › Avanzate.

## Se qualcosa non va

Popup › **Salute** › **Prepara la diagnostica**: un testo con versione, impostazioni, stato della
coda ed errori recenti, senza token, cookie, id o indirizzi. Lo vedi prima di copiarlo.

**I bottoni non compaiono.** In console cerca `[Relist] attivo su`: se c'è, aggiungi il selettore
della card in `CARD_SELECTORS` (`src/content.js`). Se il riconoscimento del profilo sbaglia, attiva
«Mostra i bottoni ovunque» nelle Avanzate.

**«Apri armadio» porta alla home.** Il popup non conosce ancora il tuo id: apri una pagina
qualsiasi di Vinted da loggato e il link si sistema da solo.

**Icona rotta e popup con `ERR_FILE_NOT_FOUND`.** Il browser non trova più la cartella da cui hai
caricato l'estensione. Estrai in una posizione stabile, rimuovi l'estensione e ricaricala da lì.

**«Errore durante il caricamento della foto».** Carica una foto a mano da `/items/new` per far
imparare il formato, poi riprova.

**Errore 403 o 429.** È l'anti-bot: la coda rallenta da sola. Da fuori coda, aspetta qualche minuto.

**«Repository non trovato» cercando aggiornamenti.** Il repository è privato o ha un altro nome:
vedi [Aggiornamento](#aggiornamento).

### Strumenti nella console

Spenti di default. Con Impostazioni › Avanzate › **Strumenti nella console** attivo, dalla
console della pagina (F12):

```js
await VR.settings()        // impostazioni (senza id e dati appresi)
await VR.source(ID)        // payload grezzo che Vinted restituisce per l'articolo
await VR.captured()        // payload catturato da una modifica fatta a mano
await VR.compare(ID)       // confronto: campi mancanti, di troppo, tipi diversi
await VR.debugDraft(ID)    // cosa verrebbe inviato, senza pubblicare niente
await VR.canary(ID)        // prova a vuoto: legge e prepara tutto senza pubblicare
```

Sono tutti in sola lettura: dalla console non si può pubblicare né cancellare.

## Struttura

```
manifest.json          permessi e registrazione degli script
background.js          token, id utente, formati, coda, archivio, notifiche, download, recupero
version.json           (solo nel repository) versione pubblicata, letta da «Cerca aggiornamento»
CHANGELOG.md           novità per versione, mostrate anche nel popup
docs/SVILUPPO.md       architettura, flussi, decisioni, debito tecnico, registro proposte
src/utils.js           impostazioni, avvisi, blocco per articolo
src/api.js             tutte le chiamate a Vinted
src/relist.js          clonazione, foto, campi, snapshot, controllo preventivo, download foto
src/editor-logica.js   controlli dell'editor, prezzi, validazione delle opzioni: funzioni pure
src/editor.js          l'editor dell'annuncio
src/queue.js           selezione, opzioni della coda, controllo preventivo, pannello
src/ui.js              onboarding, finestre e bottoni sulle card
src/styles.css         stile di tutto quello che compare dentro Vinted
src/content.js         rilevamento articoli e inventario
src/page-bridge.js     strumenti di sola lettura nella console della pagina (opzionali)
src/versione.js        confronto versioni, aggiornamenti, diagnostica: funzioni pure
src/impostazioni.js    validazione, backup e ripristino delle impostazioni: funzioni pure
src/popup.*            Home, Notifiche, Salute, Impostazioni
src/analisi.js         gruppi, duplicati, misure: funzioni pure
src/dashboard.*        la pagina dell'armadio
```

## Supporta lo sviluppo

Vinted Relist è gratuito. Se ti fa risparmiare tempo puoi offrirmi un caffè su
[Ko-fi](https://ko-fi.com/mashaup).

## Nota

Automatizzare azioni sul sito non è previsto dai termini di servizio di Vinted. Uso personale,
poche richieste, pause generose: è quello per cui questa estensione è scritta. Prova la prima
volta su un articolo a cui tieni poco.
