# Vinted Relist

Estensione Chrome e Brave per ripubblicare i tuoi annunci Vinted in un clic, da soli o in coda.
Modifica foto e testi prima di pubblicare, misura cosa funziona e tiene lo storico di ogni relist.

## Cosa fa

- **Ripubblicazione in un clic:** clona l'annuncio identico (foto, titolo, descrizione, categoria,
  marca, taglia, condizione, colori, prezzo, spedizione) e cancella quello vecchio
  - nessun click simulato: usa le stesse API interne del sito, con la tua sessione
  - foto riscaricate alla risoluzione più alta e riconvertite in JPEG
  - a fine lavoro la casella dell'articolo diventa una spunta verde
- **Editor dell'annuncio**, dal bottone Modifica:
  - **foto:** anteprima, riordino trascinando (la prima è la copertina), rotazione a 90°,
    ritaglio libero o con i formati Quadrato e 4:5, rimozione — e le foto tolte si rimettono
  - **testi e prezzo:** titolo con contatore dei 100 caratteri, descrizione, prezzo, colore
    quando manca
  - **controlli in tempo reale:** errori che bloccano la pubblicazione (titolo vuoto o troppo
    lungo, prezzo zero, nessuna foto, colore mancante) e avvisi che no (titolo corto o tutto
    maiuscolo, descrizione corta, contatti esterni in descrizione), più il punteggio di completezza
  - **anteprima prima di pubblicare:** la card come apparirà, l'elenco esatto di cosa cambia
    rispetto all'annuncio online (prima → dopo) e cosa resta uguale
  - **bozza locale distinta da ciò che viene inviato:** le modifiche si salvano da sole nel
    browser e un'etichetta dice sempre "Bozza locale · non ancora inviata"; a Vinted arriva
    qualcosa solo premendo Pubblica, e solo quello che l'anteprima elenca. Riaprendo l'editor
    la bozza viene ripresa; "Annulla modifiche" torna all'originale
- **Coda:**
  - selezione con le caselle sulle card, Shift+clic per un intervallo, Tutti e Nessuno
  - intervallo in minuti, avvio subito o a data e ora
  - pausa (finisce l'articolo in corso e riprende dal tempo residuo), salta, interrompi
  - avanzamento sotto ogni card, nel pannello in basso e nel popup
  - notifica di sistema a coda finita
- **Modifiche in blocco**, valide per tutti gli articoli in coda:
  - prezzo in percentuale, in euro (−0,50 €, +1,00 €) o fisso, mai sotto 0,50 €
  - cerca e sostituisci su titolo e descrizione, letterale e senza distinguere maiuscole
  - riga da aggiungere in fondo alla descrizione
  - colore da mettere solo dove manca
- **Automazione:**
  - **fasce di picco:** la coda pubblica solo negli orari che scegli (predefiniti
    12:30–14:00 e 19:30–22:30) e fuori fascia aspetta l'apertura
  - **ripubblica da sola gli articoli fermi** da N giorni, con un tetto per volta
  - **ritmo irregolare:** intervalli variabili del ±30% e passi solo quando sei al computer
- **Protezioni:**
  - **sentinella anti-bot:** davanti a un 429 o un 403 la coda non consuma l'articolo, si mette
    in pausa 5, poi 15, poi 45 minuti, poi si ferma
  - **controllo prima di avviare:** una prova a vuoto su un articolo, senza pubblicare niente
  - **recupero della coda:** se ricarichi l'estensione a metà, al riavvio ti mostra completati e
    rimanenti con Riprendi e Annulla
  - **ordine delle operazioni:** pubblica-poi-elimina (predefinito) o elimina-poi-pubblica, con
    copia dei dati salvata prima di cancellare
- **Campi vuoti:** colore e unisex riempiti con quello che usi negli altri articoli della stessa
  categoria (almeno due che concordano, maggioranza del 60%); la dimensione del pacco solo
  segnalata
- **Dashboard dell'armadio**, dal popup:
  - gruppi Recenti, Stagnanti, Da ottimizzare, Mai ripubblicati, In regola, cliccabili
  - valore totale in vendita, tabella con prezzo, visite, preferiti, ultimo relist e completezza
  - possibili duplicati: titoli quasi uguali e stesso prezzo
  - **cosa funziona:** visite a 48 ore di ogni relist, giorno e fascia migliori, e per singolo
    articolo la fascia di prezzo delle visite migliori
- **Storico e ripristino:** ogni relist salva com'era l'annuncio prima; Ripristina lo ripubblica
  con titolo, descrizione e prezzo di prima
- **Popup:** coda in cima con conto alla rovescia, ripubblicazioni di oggi, 7 e 30 giorni, stato
  dei formati, collegamento al tuo armadio, tema chiaro e scuro
- **Impara da solo** quello che Vinted cambia senza preavviso: i campi dell'upload foto, quelli
  del payload annuncio, il dizionario dei colori, il tuo id utente
- **17 domini:** `.it`, `.fr`, `.es`, `.de`, `.co.uk`, `.com` e gli altri regionali
- **Diagnostica da console** per capire cosa non torna quando Vinted cambia qualcosa

## Cosa non fa, e perché

- **Non riporta in vita l'annuncio originale.** Ripubblicare significa crearne uno nuovo: visite,
  preferiti e anzianità ripartono da zero. Il ripristino rimette i contenuti di prima, non quelli.
- **Non altera le foto per renderle irriconoscibili** ai controlli di Vinted (micro-ritagli o
  rotazioni impercettibili per cambiarne l'impronta). Rotazione e ritaglio dell'editor sono
  modifiche che vedi e scegli tu.
- **Non tocca ISBN, misure e produttore**, e non sceglie la dimensione del pacco: sono dati del
  singolo oggetto, copiarli da un altro significa pubblicare il falso o pagare la spedizione sbagliata.
- **Non conosce gli articoli che non hai mai visto.** L'inventario si costruisce mentre navighi il
  tuo armadio, senza chiamate in più: automazione e dashboard lavorano su quelli.
- **Non sa la data vera di pubblicazione** degli articoli mai toccati: l'anzianità si conta dal
  primo avvistamento.
- **Non conta le visite in tempo reale:** le legge dalle card quando apri l'armadio, quindi le
  misure a 48 ore arrivano se ci torni tra uno e tre giorni dopo un relist.
- **Non lavora a browser chiuso.** Serve Brave aperto e almeno una scheda su Vinted, anche in
  secondo piano.
- **Non usa API pubbliche**, perché Vinted non ne ha: dipende da quelle interne del sito, che
  possono cambiare. Per questo impara i formati da solo e ha la diagnostica.
- **Non manda i tuoi dati da nessuna parte:** bozze, storico e statistiche restano nel browser.

## Installazione

Nella radice del repo c'è `Vinted_Relist-1.9.0.zip`: è l'estensione già pronta.

1. Scompatta lo zip **in una posizione stabile**, non nella cartella temporanea che Windows crea
   aprendo uno zip con doppio clic.
2. Apri `brave://extensions` (o `chrome://extensions`).
3. Attiva **Modalità sviluppatore** in alto a destra.
4. **Carica estensione non pacchettizzata** e seleziona la cartella `Vinted_Relist`.
5. Apri il tuo armadio su Vinted e ricarica la pagina.

Dopo ogni aggiornamento premi **Ricarica** sulla scheda dell'estensione e ricarica Vinted.

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
- **La mattina presto** ha il 28% di annunci in meno della sera e converte al 2,1% contro l'1,7%:
  per questo lunedì e martedì rendono meglio alle 7–9.
- **Da evitare:** 1:00–6:00, venerdì dopo le 21, sabato prima delle 10, le ore di una partita importante.

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
verificabili, e su frequenza si contraddicono. La direzione generale è credibile; la risposta per
il tuo armadio te la dà la dashboard, dopo qualche settimana di relist misurati.

## Come funziona

| Passo | Chiamata |
|---|---|
| Legge l'articolo nel formato del form di pubblicazione | `GET /api/v2/item_upload/items/{id}` |
| Scarica le foto originali | `images*.vinted.net` |
| Ricarica ogni foto come nuova | `POST /api/v2/photos` |
| Crea il nuovo annuncio | `POST /api/v2/item_upload/items` |
| Elimina il vecchio | `POST /api/v2/items/{id}/delete` |

Le foto vengono ridisegnate su canvas, con rotazione e ritaglio dell'editor applicati nello stesso
passaggio, e riesportate in JPEG a 1600 px sul lato lungo: il CDN risponde in WebP, che l'upload rifiuta.

### Dalla lettura alla scrittura

I due formati non coincidono. Le differenze stanno tutte in `DERIVATIONS` (`src/relist.js`):

| Lettura | Scrittura |
|---|---|
| `brand_dto: {id, title}` | `brand: "Star Wars"` + `brand_id: 62370` |
| `color1_id: 3`, `color2_id: 1` | `color_ids: [3, 1]` |
| `price: {amount: "10.0", currency_code}` | `price: 10` (numero) |
| `shipment_prices: null` + `domestic_shipment_price` | `shipment_prices: {domestic, international}` |

L'involucro è `{item, push_up, parcel, upload_session_id}`, con la sessione **fuori** da `item`.

### Cosa impara da solo

Il service worker osserva le richieste che fa Vinted stessa:

- caricando una foto a mano da `/items/new` impara i campi dell'upload;
- modificando un annuncio a mano impara i campi del payload, che si **sommano** ai predefiniti;
- dall'header delle chiamate legge il tuo id utente: il cookie `v_uid` è HttpOnly e la pagina non
  lo vede, ed è quello che serve al collegamento "Apri il tuo armadio".

Il popup mostra *appreso* o *predefinito*: il pallino spento non è un errore.

### Campi vuoti

| Campo | Cosa succede |
|---|---|
| `color_ids`, `is_unisex` | **Riempiti** se vuoti. Senza colore Vinted rifiuta la pubblicazione. |
| `package_size_id` | **Solo segnalato**: sbagliarlo si paga in spedizione. |
| `isbn`, misure, `manufacturer` | **Mai toccati**: sono dati del singolo oggetto. |

Un campo già compilato non viene sovrascritto, e una tua scelta esplicita vince sempre.

## L'ordine conta

- **Pubblica, poi elimina** (predefinito). Se la creazione fallisce il vecchio annuncio è ancora
  lì; il rischio opposto è un doppione da togliere a mano.
- **Elimina, poi pubblica**. Relist pulito, ma se Vinted rifiuta la creazione l'annuncio è già
  sparito. Prima di cancellare l'estensione salva sempre una copia dei dati, recuperabile dal popup.

## Se la coda si interrompe

Gli alarm del browser non sopravvivono al ricaricamento dell'estensione. Al risveglio il service
worker controlla se la sveglia della coda esiste ancora; se manca, la coda passa in **interrotta**
e aspetta te. L'articolo che era in lavorazione torna da fare. Il controllo ha tre minuti di
margine per non scambiare per guasto un risveglio normale.

## Diagnostica

Dalla console normale della pagina (F12):

```js
await VR.settings()        // impostazioni e formati imparati
await VR.source(ID)        // payload grezzo che Vinted restituisce per l'articolo
await VR.captured()        // payload vero catturato da una modifica fatta a mano
await VR.compare(ID)       // confronto: campi mancanti, di troppo, tipi diversi
await VR.debugDraft(ID)    // cosa verrebbe inviato, senza pubblicare niente
await VR.canary(ID)        // prova a vuoto: legge e prepara tutto senza pubblicare
```

## Se qualcosa non va

**I bottoni non compaiono.** In console cerca `[Relist] attivo su`: se c'è, aggiungi il selettore
della card in `CARD_SELECTORS` (`src/content.js`). Se il riconoscimento del profilo sbaglia, attiva
"Mostra i bottoni ovunque" nelle Avanzate.

**"Apri il tuo armadio" porta alla home.** Il popup non conosce ancora il tuo id: apri una pagina
qualsiasi di Vinted da loggato e il link si sistema da solo. Finché non succede, il link dice
"Apri Vinted".

**Icona rotta e popup con `ERR_FILE_NOT_FOUND`.** Il browser non trova più la cartella da cui hai
caricato l'estensione. Estrai in una posizione stabile, rimuovi l'estensione e ricaricala da lì.

**"Errore durante il caricamento della foto".** Carica una foto a mano da `/items/new` per far
imparare il formato, poi riprova.

**"Ci dispiace, si sono verificati degli errori".** Il messaggio sotto i bottoni elenca i campi
rifiutati; `VR.compare(ID)` dice quali mancano.

**Errore 403 o 429.** È l'anti-bot: la coda rallenta da sola. Da fuori coda, aspetta qualche minuto.

## Struttura

```
manifest.json          permessi e registrazione degli script
background.js          token, id utente, formati, coda, automazione, recupero
src/utils.js           impostazioni, toast, coda seriale
src/api.js             tutte le chiamate a Vinted
src/relist.js          clonazione, foto (rotazione e ritaglio), campi, snapshot, diagnostica
src/editor-logica.js   controlli e differenze dell'editor: funzioni pure, testabili
src/editor.js          l'editor dell'annuncio
src/queue.js           selezione, coda, modifiche in blocco
src/ui.js              onboarding e bottoni sulle card
src/styles.css         stile di bottoni, pannello, editor dentro Vinted
src/content.js         rilevamento articoli e inventario
src/page-bridge.js     espone VR nella console della pagina
src/popup.*            impostazioni, coda, attività
src/analisi.js         gruppi, duplicati, misure: funzioni pure, testabili
src/dashboard.*        la pagina dell'armadio
```

## Nota

Automatizzare azioni sul sito non è previsto dai termini di servizio di Vinted. Uso personale,
poche richieste, pause generose: è quello per cui questa estensione è scritta. Prova la prima
volta su un articolo a cui tieni poco.
