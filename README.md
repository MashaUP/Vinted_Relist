# Vinted Relist

Estensione Chrome/Brave per uso personale. Aggiunge due bottoni sotto ogni articolo del tuo
armadio su `vinted.it`:

- **Ripubblica** — clona l'annuncio identico (foto, titolo, descrizione, categoria, marca,
  taglia, condizione, colori, prezzo, spedizione) e cancella quello vecchio.
- **Modifica** — apre una finestra per cambiare titolo, descrizione e prezzo prima di pubblicare.

Al primo avvio compare una schermata di benvenuto con i tre passaggi, una volta sola.
Puoi rivederla dal popup dell'estensione.

---

## Quando ripubblicare

Lo strumento ti fa ripubblicare in un clic, ma *quando* lo fai conta quanto il come. Vinted
ordina il feed e le ricerche per data di aggiornamento: ripubblicare rimette l'articolo in
cima, e l'algoritmo misura l'interesse iniziale nelle prime ore. Se quella spinta parte alle
tre di notte, si consuma nel vuoto.

### Fasce per giorno

Indice di rendimento su oltre 12.000 annunci (gennaio–aprile 2026). 100 = media settimanale.

| Giorno | 7–9 | 12–14 | 19–22 | Totale |
|---|---|---|---|---|
| Lunedì | **105** | 98 | 102 | 97 |
| Martedì | **103** | 100 | 99 | 95 |
| Mercoledì | 98 | **110** | 106 | 104 |
| Giovedì | 101 | 97 | **108** | 100 |
| Venerdì | 96 | 95 | 94 | 92 |
| Sabato | 112 | **115** | 110 | 112 |
| Domenica | 108 | 118 | **125** | 123 |

**Domenica sera, 20:00–22:00** è il momento migliore della settimana: traffico del 25% sopra
la media, perché i compratori preparano la settimana e chiudono gli acquisti prima del lunedì.

**Venerdì** è il giorno peggiore. **Mercoledì** spicca a metà settimana, soprattutto per
l'abbigliamento bambini.

La mattina presto ha un vantaggio che il totale non mostra: il 28% di annunci pubblicati in
meno rispetto alla sera, con conversione al 2,1% contro l'1,7% medio. Per questo lunedì e
martedì, giorni mediocri, rendono meglio alle 7–9 che alle 21.

**Da evitare:** l'1:00–6:00 (sotto il 3% del traffico), il venerdì dopo le 21, il sabato prima
delle 10, e le due ore di una partita importante (fino a −40% di traffico).

### Ogni quanto

Due intervalli diversi, da non confondere.

**Tra articoli distinti, 15–20 minuti.** Uno o due articoli alla volta ti tengono in cima più
spesso ed evitano l'effetto spam. Svuotare l'armadio in un blocco unico occupa il feed per
cinque minuti e poi sparisce.

**Tra due ripubblicazioni dello stesso articolo, 4–7 giorni. Mai ogni giorno.** Uno studio su
2,4 milioni di articoli trova una curva a U:

| Frequenza | Venduti in 14 giorni | Visualizzazioni medie |
|---|---|---|
| 1× al giorno | 4% | 12 |
| Ogni 2 giorni | 9% | 28 |
| **Ogni 5–7 giorni** | **23%** | **94** |
| Ogni 10 giorni | 17% | 67 |
| Ogni 14 giorni | 11% | 43 |
| Mai | 6% | 21 |

Ripubblicare tutti i giorni rende meno che non ripubblicare affatto. Una seconda fonte
consiglia ogni 3–4 giorni sostenendo che la visibilità cala dell'80% dopo tre giorni: le due
stime si contraddicono, ma concordano sul fatto che la frequenza quotidiana è controproducente.

### Quanto fidarsi di questi numeri

Entrambe le fonti ([Relisted](https://relisted.io/en/blog/best-time-post-vinted),
[Vinkit](https://vinkit.co/it/blog/con-quale-frequenza-ripubblicare-annunci-vinted-studio-24m-articoli))
vendono strumenti di ripubblicazione automatica, e i dati vengono dai loro stessi utenti:
nessuno è verificabile dall'esterno, e hanno interesse a far sembrare il timing decisivo.
Vinted non pubblica le proprie statistiche di traffico. La direzione generale è comunque
credibile, perché descrive soltanto quando la gente sta sul telefono.

Il conteggio delle visualizzazioni per articolo è nei dati che l'estensione già legge: se vuoi
una risposta misurata sul tuo catalogo invece che sulla media di altri, ripubblica metà armadio
in una fascia e metà in un'altra, poi confronta le visite dopo 24 ore.

---

## Installazione

1. Scarica questa cartella (`Code → Download ZIP`, oppure `git clone`) e scompattala **in una
   posizione stabile**, non nella cartella temporanea che Windows crea aprendo uno zip.
2. Apri `brave://extensions` (o `chrome://extensions`).
3. Attiva **Modalità sviluppatore** in alto a destra.
4. **Carica estensione non pacchettizzata** e seleziona la cartella.
5. Apri il tuo armadio su Vinted e ricarica la pagina.

Dopo ogni modifica ai file, premi **Ricarica** sulla scheda dell'estensione e ricarica Vinted.
Servono entrambe le cose: il content script vecchio resta in memoria.

## Come funziona

L'estensione non simula i click sul sito: usa le stesse API interne di Vinted
(`/api/v2/...`) con i cookie della tua sessione.

| Passo | Chiamata |
|---|---|
| Legge l'articolo nel formato del form di pubblicazione | `GET /api/v2/item_upload/items/{id}` |
| Scarica le foto originali | `images*.vinted.net` |
| Ricarica ogni foto come nuova | `POST /api/v2/photos` |
| Crea il nuovo annuncio | `POST /api/v2/item_upload/items` |
| Elimina il vecchio | `POST /api/v2/items/{id}/delete` |

Le foto vengono ridisegnate su canvas e riesportate in JPEG a 1600px sul lato lungo: il CDN
di Vinted risponde in WebP, che l'upload rifiuta.

### Dalla lettura alla scrittura

I due formati non coincidono, e questa è la parte che conta. Le differenze, ricavate
confrontando una richiesta reale di Vinted con quello che restituisce la lettura, stanno
tutte in `DERIVATIONS` (`src/relist.js`):

| Lettura | Scrittura |
|---|---|
| `brand_dto: {id, title}` | `brand: "Star Wars"` + `brand_id: 62370` |
| `color1_id: 3`, `color2_id: 1` | `color_ids: [3, 1]` |
| `price: {amount: "10.0", currency_code}` | `price: 10` (numero, non stringa) |
| `shipment_prices: null` + `domestic_shipment_price` | `shipment_prices: {domestic, international}` |

L'involucro della richiesta è `{item, push_up, parcel, upload_session_id}`: la sessione di
upload sta **fuori** da `item`. La lettura restituisce anche `photos`, `promoted`,
`can_push_up`, `is_draft`, `item_alert`, `ontology_*`, che non vanno inviati.

### Formati che si imparano da soli

Vinted cambia questi dettagli senza preavviso, quindi il service worker osserva le richieste
che fa il sito stesso e ne registra la forma:

- carica una foto a mano da `vinted.it/items/new` → registra i campi del multipart;
- modifica un annuncio a mano e salva → registra i campi del payload dell'annuncio.

Entrambe le cose sono silenziose. Nel popup, le righe "Formato foto" e "Formato annuncio"
mostrano *appreso* o *predefinito*: il pallino spento non è un errore, significa che sta
usando la mappatura scritta nel codice. I campi imparati si **sommano** a quelli predefiniti,
non li sostituiscono: una cattura fatta su un articolo da collezione non deve far sparire
`size_id` da una maglietta.

## L'ordine conta

Nelle impostazioni ci sono due modalità:

- **Pubblica, poi elimina** (predefinita). Se la creazione fallisce, il vecchio annuncio è
  ancora lì. Il rischio opposto è un doppione da rimuovere a mano: il guaio meno grave.
- **Elimina, poi pubblica**. Relist pulito, ma se Vinted rifiuta la creazione l'annuncio è già
  sparito. Prima di cancellare l'estensione salva sempre una copia dei dati: la recuperi dal
  popup, dove la sezione bozze compare solo se c'è qualcosa da recuperare.

## Impostazioni (popup)

- Elimina il vecchio annuncio — se lo disattivi ottieni un duplicato invece di un relist
- Ricarica la pagina dopo la pubblicazione
- Mostra i bottoni ovunque — utile se il riconoscimento del tuo profilo sbaglia
- Ordine delle operazioni
- Pausa — tempo tra una chiamata e l'altra e tra due ripubblicazioni in coda. Alzala a
  2500–3000 ms se ne fai molte di fila. Non è l'intervallo di 15–20 minuti tra articoli
  descritto sopra: quello per ora va distanziato a mano.

## Diagnostica

Le funzioni sono disponibili nella console normale della pagina (F12), senza cambiare contesto:

```js
await VR.settings()        // impostazioni e formati imparati
await VR.source(ID)        // payload grezzo che Vinted restituisce per l'articolo
await VR.captured()        // payload vero catturato da una modifica fatta a mano
await VR.compare(ID)       // confronto: campi mancanti, di troppo, tipi diversi
await VR.debugDraft(ID)    // cosa verrebbe inviato, senza pubblicare niente
await VR.debug(ID)         // prova il ciclo delle foto su un articolo
```

`VR.compare` è lo strumento da usare quando Vinted cambia qualcosa: se stampa liste vuote il
payload è allineato, altrimenti dice esattamente quale campo non torna.

## Se qualcosa non va

**I bottoni non compaiono.** Vinted cambia spesso le classi CSS. In console cerca
`[Relist] attivo su`: se c'è, il problema è il selettore della card — aggiungi il tuo in
`CARD_SELECTORS` (`src/content.js`). Se il riconoscimento del profilo sbaglia, attiva
"Mostra i bottoni ovunque".

**Icona rotta e popup con `ERR_FILE_NOT_FOUND`.** Il browser non trova più la cartella da cui
hai caricato l'estensione: nome e versione restano in cache, il resto no. Succede caricando
dalla cartella temporanea di uno zip aperto con doppio clic. Estrai in una posizione stabile,
rimuovi l'estensione e ricaricala da lì. In **Dettagli** controlli il percorso di origine.

**"Errore durante il caricamento della foto".** È Vinted a rifiutare il file. Carica una foto
a mano da `/items/new` per far imparare il formato, poi riprova.

**"Ci dispiace, si sono verificati degli errori".** Il payload dell'annuncio non va. Il
messaggio sotto i bottoni elenca i campi rifiutati; `VR.compare(ID)` dice quali mancano.
Modifica un annuncio a mano e salva per far imparare il formato aggiornato.

**Errore 403 o schermata anti-bot.** Vinted usa DataDome. Ricarica la pagina, disattiva
l'ad-blocker su vinted.it, aspetta qualche minuto.

**Errore 429.** Troppe richieste: alza la pausa e riprendi più tardi.

## Struttura

```
manifest.json        permessi e registrazione degli script
background.js        cattura token e formati, download foto senza CORS
src/utils.js         impostazioni, toast, coda seriale
src/api.js           tutte le chiamate a Vinted
src/relist.js        clonazione, conversione dei campi, diagnostica
src/ui.js            onboarding, bottoni, dialog di modifica
src/content.js       rilevamento articoli e injection
src/page-bridge.js   espone VR nella console della pagina
src/popup.*          impostazioni e recupero bozze
```

## Nota

Automatizzare azioni sul sito non è previsto dai termini di servizio di Vinted. Uso personale,
poche richieste, pause generose: è quello per cui questa estensione è scritta. Prova la prima
volta su un articolo a cui tieni poco.
