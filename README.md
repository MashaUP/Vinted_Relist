# Vinted Relist

Estensione Chrome/Brave per uso personale. Aggiunge due bottoni sotto ogni articolo del tuo
armadio su `vinted.it`:

- **Ripubblica** — clona l'annuncio identico (foto, titolo, descrizione, categoria, marca,
  taglia, condizione, colori, prezzo, spedizione) e cancella quello vecchio.
- **Modifica** — apre una finestra per cambiare titolo, descrizione e prezzo prima di pubblicare.

Con la casella accanto ai bottoni ne selezioni piu' d'uno e li metti in coda, ripubblicati a
intervalli che scegli tu.

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

### Coda automatica

Ogni articolo ha una casella accanto ai bottoni. Selezionandone alcuni compare un pannello in
basso: scegli ogni quanti minuti ripubblicare e premi **Avvia**. Il primo parte subito, gli
altri a intervalli regolari.

La coda vive nel service worker con `chrome.alarms`, non nella pagina: puoi navigare su Vinted,
ricaricare, aprire altre schede. Deve però restare **aperta almeno una scheda su `vinted.it`**,
perche' e' li' che la ripubblicazione viene eseguita. Se la chiudi, la coda aspetta fino a
un'ora controllando ogni minuto, poi si interrompe.

Il bottone **Opzioni** apre modifiche che valgono per tutti i selezionati e l'orario di avvio:
lasciandolo vuoto parte subito, altrimenti aspetta il momento che scegli.

Il prezzo si può toccare in tre modi: **in percentuale** (−10%), **in euro** (−0,50 € o +1,00 €)
o **fisso** per tutti. Percentuale e variazione in euro si calcolano sul prezzo di ogni articolo
al momento della ripubblicazione, non quando lo selezioni, e non scendono mai sotto 0,50 €.
Puoi anche aggiungere una riga in fondo alla descrizione.

### Campi vuoti

Molti annunci vecchi hanno campi che oggi Vinted pretende, e la ripubblicazione fallisce.
Con **Riempi i campi vuoti** attivo, l'estensione li completa — ma non tutti, e il criterio è
quanto costa sbagliare:

| Campo | Cosa succede |
|---|---|
| `color_ids`, `is_unisex` | **Riempiti.** Senza colore Vinted rifiuta la pubblicazione; un valore sbagliato costa al massimo una ricerca persa. |
| `package_size_id` | **Solo segnalato.** Sbagliare la dimensione del pacco si paga in spedizione: la scelta resta tua. |
| `isbn`, misure, `manufacturer` | **Mai toccati.** Sono dati del singolo oggetto: copiarli da un altro articolo significa pubblicare il falso. |

I valori non sono inventati né dedotti dal titolo: vengono da quello che hai messo tu sugli altri
articoli **della stessa categoria**. Servono almeno due articoli che concordano, e il valore deve
essere usato in almeno il 60% dei casi — altrimenti l'estensione non sceglie. Un campo già
compilato non viene mai sovrascritto, e una tua scelta esplicita nelle Opzioni ha sempre la
precedenza.

Prima di avviare una coda, il controllo ti dice cosa riempirà e cosa resta vuoto.

**Colore se manca.** Vinted rifiuta la pubblicazione di un articolo senza colore, e molti annunci
vecchi non ne hanno: è l'errore `color: Compila il campo "colore"`. Qui scegli il colore da
assegnare, applicato **solo** dove manca — gli articoli che ne hanno già uno non vengono toccati.
L'elenco non è una lista inventata: si riempie da solo con i colori incontrati negli articoli che
l'estensione legge, perché la lettura espone sia l'id sia il nome.

Per selezionare in fretta: **Shift+clic** estende dall'ultima casella toccata a quella cliccata.

Prima di partire la coda fa una **prova a vuoto** su un articolo — legge, costruisce il payload,
scarica e converte una foto, senza pubblicare né cancellare niente. Se Vinted ha cambiato
qualcosa te lo dice subito, invece di farti scoprire l'errore venti volte di fila. Puoi comunque
forzare l'avvio.

Mentre la coda gira, ogni card mostra gli stessi riscontri del bottone singolo: l'avanzamento
sotto i bottoni e, a ripubblicazione avvenuta, la casella che diventa una **spunta verde** con
accanto "Ripubblicato". Cosi' si vede a colpo d'occhio quali articoli sono gia' passati.

Un articolo che fallisce non blocca gli altri: viene segnato e si passa al successivo. Se una
scheda non risponde entro sei minuti, un watchdog lo chiude come fallito e prosegue.

Un **blocco di Vinted** (429, o un 403 che resta dopo aver rinnovato il token) è trattato
diversamente da un errore di contenuto: non è colpa dell'articolo, quindi non viene consumato.
La coda si mette in pausa 5 minuti, poi 15, poi 45; se continua, si ferma. Insistere dopo un
429 è il modo migliore per peggiorare la situazione.

Con il **ritmo irregolare** attivo (predefinito) l'intervallo varia del ±30% a ogni passo e i
passi avvengono solo quando sei davvero al computer: venti minuti esatti per tre ore di fila
sono una firma che nessuna persona lascerebbe. L'avvio programmato è l'unica eccezione — se
chiedi le 20:00, parte alle 20:00.

A coda finita arriva una **notifica di sistema** con il riepilogo: la coda gira per ore e nel
frattempo starai guardando altro. Avanzamento
ed errori li vedi nel pannello e nel popup, anche con Vinted in secondo piano.

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

## Domini

Funziona su `vinted.it`, `.fr`, `.es`, `.de`, `.co.uk`, `.com` e altri domini regionali. Il
codice usa l'origine della pagina, quindi non c'è niente da configurare: il popup ricorda
l'ultimo dominio visitato per i collegamenti.

## Installazione

Nella radice del repo c'e' `Vinted_Relist-1.8.0.zip`: e' l'estensione gia' pronta, se preferisci
scaricare solo quello invece dell'intero repo.

1. Scompatta lo zip (o scarica il repo con `Code → Download ZIP` / `git clone`) **in una
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

## Automazione

**Fasce di picco.** Con l'opzione attiva la coda pubblica solo dentro gli orari che imposti
(predefiniti `12:30-14:00, 19:30-22:30`). Fuori fascia aspetta l'apertura successiva, con qualche
minuto di scarto casuale: partire all'istante esatto dell'apertura è un orario sospetto quanto
un intervallo a metronomo.

**Ripubblica da sola gli articoli fermi.** Ogni ora l'estensione controlla quali articoli non
ripubblichi da più di N giorni e ne accoda fino a un massimo che scegli tu. Non parte se una
coda è già in corso, e segue tutte le regole normali: ritmo irregolare, fasce, pause anti-bot.

L'elenco degli articoli non viene da un endpoint indovinato: si costruisce da solo mentre
navighi il tuo armadio. Un articolo che non hai mai aperto non esiste per l'automazione — il
popup ti dice quanti ne conosce. L'anzianità si conta dall'ultima ripubblicazione fatta
dall'estensione, o dal primo avvistamento per quelli che non ha mai toccato.

## Dashboard dell'armadio

Si apre dal popup. Mostra solo dati che l'estensione ha già raccolto, quindi si riempie man mano
che navighi il tuo armadio: prezzo, visite e preferiti vengono letti dalle card che hai davanti,
senza chiamate in più a Vinted.

**Gruppi**, disgiunti e cliccabili per filtrare la tabella:

| Gruppo | Criterio |
|---|---|
| Recenti | ripubblicati negli ultimi 7 giorni |
| Stagnanti | fermi da 21 giorni o più |
| Da ottimizzare | completezza sotto 70 |
| Mai ripubblicati | mai toccati dall'estensione |
| In regola | tutto il resto |

L'anzianità di un articolo mai toccato si conta dal primo avvistamento: la data vera di
pubblicazione non la conosciamo, e non la inventiamo.

**Possibili duplicati**: titoli quasi uguali (somiglianza sulle parole, maiuscole e punteggiatura
ignorate) **e** stesso prezzo. Due DVD uguali a prezzi diversi sono quasi sempre due copie vere.

**Completezza**: un punteggio da 0 a 100 su cose verificabili — numero di foto, marca, colore,
condizione, taglia dove serve, lunghezza di titolo e descrizione, dimensione del pacco. Compare
anche nel dialog Modifica, che è il momento in cui puoi ancora sistemare.

### Cosa funziona

Ogni ripubblicazione viene misurata con le **visite del nuovo annuncio a circa 48 ore**. Un
annuncio ripubblicato parte da zero, quindi quel numero è il risultato di quel relist e di
nient'altro: relist diversi si possono confrontare.

La misura si registra quando riapri il tuo armadio tra 1 e 3 giorni dopo una ripubblicazione.
Con almeno 3 misure per gruppo la dashboard indica giorno e fascia oraria che hanno reso di più;
per un singolo articolo, con almeno 3 relist misurati, aggiunge la fascia di prezzo delle visite
migliori e se ha reso di più tenendo il prezzo fermo o cambiandolo. Sotto quelle soglie dice
quante misure mancano: con due punti qualunque differenza è rumore.

### Storico e ripristino

Ogni ripubblicazione salva com'era l'annuncio prima: titolo, descrizione, prezzo. **Ripristina**
ripubblica l'annuncio attuale con quei dati. Non riporta in vita l'originale — è stato cancellato
con le sue visite — ma rimette i contenuti di prima. Un relist che è stato ripubblicato a sua
volta compare come superato: il suo annuncio non esiste più.

## Se la coda si interrompe

Gli alarm non sopravvivono al ricaricamento dell'estensione. Prima la coda restava bloccata in
stato "in corso" senza niente che la svegliasse, e l'unica via d'uscita era Interrompi.

Ora, al risveglio, il service worker controlla se la sveglia esiste ancora. Se manca, la coda
passa in **recovering** e aspetta: nel pannello e nel popup trovi quanti articoli sono stati
completati e quanti restano, con **Riprendi** e **Annulla**. L'articolo che era in lavorazione
torna da fare, perché non è mai arrivato in fondo.

Il controllo ha un margine di tre minuti, altrimenti scambierebbe per guasto il risveglio
normale: quando è l'alarm stesso a svegliare il worker, risulta già consumato.

## L'ordine conta

Nelle impostazioni ci sono due modalità:

- **Pubblica, poi elimina** (predefinita). Se la creazione fallisce, il vecchio annuncio è
  ancora lì. Il rischio opposto è un doppione da rimuovere a mano: il guaio meno grave.
- **Elimina, poi pubblica**. Relist pulito, ma se Vinted rifiuta la creazione l'annuncio è già
  sparito. Prima di cancellare l'estensione salva sempre una copia dei dati: la recuperi dal
  popup, dove la sezione bozze compare solo se c'è qualcosa da recuperare.

## Il popup

Si apre sull'icona dell'estensione e segue il tema del browser, chiaro o scuro.

**Coda** in cima quando è attiva: avanzamento, articolo in lavorazione, conto alla rovescia che
scorre davvero, e i comandi **Pausa**, **Salta** e **Interrompi**. La pausa non spezza l'articolo
in corso: lo lascia finire e si ferma dopo, riprendendo poi dal tempo residuo. Gli articoli
falliti sono cliccabili e aprono l'annuncio. Senza coda attiva, qui trovi il collegamento al tuo
armadio.

**Ripubblicazione** — elimina il vecchio annuncio (se lo disattivi ottieni un duplicato),
ricarica la pagina dopo, ordine delle operazioni.

**Coda** — ritmo irregolare, controllo prima di avviare, notifica a fine coda.

**Attività** — quante ripubblicazioni hai fatto oggi, negli ultimi 7 e negli ultimi 30 giorni, e
quanti articoli hai ripubblicato più di una volta nell'ultima settimana. È il numero che ti
protegge dall'errore più costoso: ripubblicare ogni giorno rende meno che non farlo affatto.

**Formati** — stato dei due formati appresi, e il bottone **Verifica formato** che esegue la
prova a vuoto sul primo articolo del tuo armadio senza aprire la console.

**Avanzate**, richiudibile — mostra i bottoni ovunque, e la pausa tra le chiamate (2500–3000 ms
se ne fai molte di fila). È altra cosa dall'intervallo della coda, che si imposta nel pannello
in basso alla pagina.

## Diagnostica

Le funzioni sono disponibili nella console normale della pagina (F12), senza cambiare contesto:

```js
await VR.settings()        // impostazioni e formati imparati
await VR.source(ID)        // payload grezzo che Vinted restituisce per l'articolo
await VR.captured()        // payload vero catturato da una modifica fatta a mano
await VR.compare(ID)       // confronto: campi mancanti, di troppo, tipi diversi
await VR.debugDraft(ID)    // cosa verrebbe inviato, senza pubblicare niente
await VR.canary(ID)        // prova a vuoto: legge e prepara tutto senza pubblicare
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
src/queue.js         selezione multipla e pannello della coda
src/ui.js            onboarding, bottoni, dialog di modifica
src/content.js       rilevamento articoli e injection
src/page-bridge.js   espone VR nella console della pagina
src/popup.*          impostazioni, coda, attività
src/analisi.js       gruppi, duplicati, misure: funzioni pure, testabili senza browser
src/dashboard.*      la pagina dell'armadio
```

## Nota

Automatizzare azioni sul sito non è previsto dai termini di servizio di Vinted. Uso personale,
poche richieste, pause generose: è quello per cui questa estensione è scritta. Prova la prima
volta su un articolo a cui tieni poco.
