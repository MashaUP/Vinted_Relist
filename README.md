# Vinted Relist

Estensione per **Brave e Chrome** che ripubblica i tuoi annunci Vinted in un clic, uno alla volta
o in coda, per riportarli in cima ai risultati senza rifarli a mano.

**Versione 2.1.0** · [Novità](CHANGELOG.md) · [Community su Discord](https://discord.gg/EPsbQCuAkx) ·
[Segnala un problema](https://github.com/MashaUP/Vinted_Relist/issues/new?template=segnalazione-bug.yml) ·
[Supporta lo sviluppo su Ko-fi](https://ko-fi.com/mashaup)

---

## A chi serve

A chi vende su Vinted dal proprio armadio e ripubblica spesso gli stessi articoli: libri, manga,
abbigliamento, lotti. Invece di copiare foto e testi in un annuncio nuovo e cancellare il vecchio,
premi **Ripubblica** sulla card dell'articolo, oppure selezionane tanti e mettili in **coda** con
un intervallo tra uno e l'altro.

È un progetto personale, gratuito e senza server: tutto resta nel tuo browser.

## Stato del progetto

| | |
|---|---|
| Distribuzione | zip su GitHub, da caricare come estensione non pacchettizzata. **Non è sul Chrome Web Store** (vedi [perché](docs/SVILUPPO.md#11-chrome-web-store-rischi)) |
| Verificato su Vinted reale | la ripubblicazione, nelle versioni precedenti usate dall'autore |
| Verificato solo nei test | le novità della 2.1 (code dinamiche, annullamento, link): oltre 750 controlli automatici e prove in Chromium con l'estensione caricata, senza pubblicazioni vere |
| Dipendenze | nessuna libreria, nessun passaggio di build |

Prima di usarla su tanti articoli, provala su uno a cui tieni poco.

## Installazione

1. Scarica dal repository lo zip **`Vinted_Relist-2.1.0.zip`** (nella radice).
2. Estrailo **in una cartella stabile** (non nella cartella temporanea che Windows apre con il
   doppio clic): ottieni la cartella `Vinted_Relist`.
3. Apri `brave://extensions` (o `chrome://extensions`) e attiva **Modalità sviluppatore**.
4. **Carica estensione non pacchettizzata** › scegli la cartella `Vinted_Relist`.
5. Apri il tuo armadio su Vinted da loggato e ricarica la pagina: sulle card compaiono i bottoni.

### Aggiornare

1. Popup › **Salute** › **Cerca aggiornamento**: se c'è una versione nuova vedi le note.
2. **Scarica lo zip** ed estrailo **sopra la cartella attuale**, sostituendo i file.
3. **Installa l'aggiornamento**: l'estensione si ricarica. Poi ricarica le schede di Vinted.

Un'estensione caricata da cartella non può sostituire i propri file: l'estrazione la fai tu. Se un
articolo è in pubblicazione il bottone aspetta; una coda attiva risulta «interrotta» e riparte con
Riprendi.

## Primi passi

**Un articolo.** Sulla card: **Ripubblica** per farlo subito, **Modifica** per cambiare foto,
testi o prezzo prima, con l'anteprima di cosa cambia.

**Tanti articoli.** Spunta le caselle sulle card (Shift+clic per un intervallo) › **Coda** › scegli
le opzioni (prezzo, testi, intervallo, orario) › il controllo legge ogni articolo senza pubblicare e
li divide in pronti, con avvisi e bloccati › **Avvia**.

**Con la coda in corso.** Puoi continuare a selezionare articoli e premere **Aggiungi alla coda**
(in fondo o in cima). **Gestisci** apre la pagina della coda, dove vedi e modifichi tutto.

## Cosa fa

### Ripubblicazione
- Clona l'annuncio (foto, titolo, descrizione, categoria, marca, taglia, condizione, colori,
  prezzo, spedizione) e cancella quello vecchio, con le stesse API interne del sito e la tua
  sessione: niente clic simulati.
- **Ordine sicuro:** pubblica, poi elimina (predefinito). In alternativa elimina, poi pubblica, con
  una copia dei dati salvata prima di cancellare.
- **Nel dubbio non ripubblica:** se Vinted non dà una risposta chiara l'articolo diventa «da
  verificare» e lo confermi tu. Un doppione costa più di un articolo fermo un giro in più.

### Editor dell'annuncio
- Foto: riordino, rotazione, ritaglio (libero, quadrato, 4:5), rimozione e ripristino.
- Titolo con contatore, descrizione, prezzo, colore; controlli in tempo reale (errori, avvisi e
  note) e punteggio di completezza; anteprima di cosa cambia; bozza salvata da sola.
- **Scarica le foto** originali, nella qualità più alta, in Download › Vinted Relist.

### Coda (novità 2.1)
- **Dinamica:** aggiungi, rimuovi e riordina gli articoli anche mentre la coda lavora o è in pausa;
  alla ripresa vale l'elenco aggiornato.
- **Pagina di gestione** (Dashboard › Coda, o «Gestisci»): per ogni articolo miniatura, titolo,
  prezzo, posizione, stato con etichetta e icona, errore e cosa fare. Azioni sulla riga (apri,
  dettagli, su/giù/cima/fondo, rimuovi, riprova, conferma esito) e su più articoli selezionati.
  Ricerca, filtri (in attesa, problemi, completati…), ordinamento solo visivo.
- **Riordino** trascinando, oppure da tastiera con Alt+↑/↓/Home/Fine.
- **Tre gesti diversi, tre bottoni diversi:**
  - *Rimuovi dalla coda* toglie un articolo in attesa dalla pianificazione: **non cancella niente
    su Vinted**;
  - *Annulla operazione* ferma l'articolo in corso, solo se la richiesta a Vinted non è ancora
    partita;
  - *Interrompi la sessione* annulla quelli in attesa e lascia finire quello in corso.
- **Pausa** subito o dopo l'articolo in corso, anche **a tempo** (15, 30, 60, 120 minuti), con
  ripresa affidabile anche a popup chiuso.
- **Avanzamento e stima** dei tempi dalle durate osservate, dichiarata come stima.
- **Salute della coda:** in corso, in pausa, bloccata, da verificare, con il perché e cosa fare.
- **Errori per categoria** (temporaneo, dati, sessione, non consentito, rete, incerto) con
  l'indicazione se riprovare serve. Tre problemi di fila mettono la coda in pausa da sola.
- **Cronologia** filtrabile (modifiche tue, esiti di Vinted, eventi di sistema); esportazione **CSV
  e JSON** e resoconto da copiare, senza dati sensibili.
- **Sessioni precedenti** (ultime 10): riprendi gli articoli non elaborati o riprova i falliti;
  quelli già ripubblicati non vengono mai ripubblicati di nuovo.
- **Modelli di opzioni** con nome, da riusare.
- **Opzioni in blocco:** prezzo in percentuale, in euro o fisso (mai sotto 0,50 €), cerca e
  sostituisci, riga in fondo alla descrizione, colore dove manca.
- **Automazione facoltativa:** fasce orarie di picco, ripubblicazione degli articoli fermi da N
  giorni, ritmo irregolare e passi solo quando sei al computer.
- **Protezioni:** un articolo alla volta; davanti a un 429/403 rallenta (5, 15, 45 minuti) e poi si
  ferma; dopo un'interruzione del browser l'articolo a metà diventa «da verificare».

### Popup e dashboard
- **Popup:** Home con la coda e l'attività, Notifiche, Salute (controlli, diagnostica da copiare,
  Cerca aggiornamento, novità, link del progetto), Impostazioni con backup.
- **Dashboard dell'armadio:** gestione della coda, gruppi (recenti, stagnanti, da ottimizzare…),
  tabella con ricerca e ordinamento, possibili duplicati, cosa funziona (visite a 48 ore per giorno
  e fascia), storico con confronto prima/dopo e ripristino.
- **Avvisi sulla pagina:** 3 s per i successi, 4 s per le informazioni, 7 s per gli avvisi, 6 s per
  la coda finita; errori ed esiti incerti restano finché non li chiudi.

### Scorciatoie (pagina della coda)

| Tasto | Azione |
|---|---|
| `P` | pausa / riprendi |
| `A` | apri l'articolo in corso |
| `F` | mostra solo i problemi |
| `S` | seleziona tutti gli articoli in attesa |
| `Canc` | rimuovi dalla coda i selezionati |
| `H` | apri la cronologia |
| `C` | copia il resoconto |
| `Alt` + `↑` `↓` `Home` `Fine` | sposta l'articolo |
| `?` | elenco delle scorciatoie |

Non scattano mentre scrivi in un campo.

## Cosa non fa

- **Non riporta in vita l'annuncio originale:** visite, preferiti e anzianità ripartono da zero.
- **Non altera le foto per renderle irriconoscibili** ai controlli di Vinted.
- **Non tocca ISBN, misure e produttore**, e non sceglie la dimensione del pacco.
- **Non lavora a browser chiuso:** serve il browser aperto e una scheda su Vinted.
- **Non si aggiorna da sola** (vedi [Aggiornare](#aggiornare)).
- **Non usa API pubbliche**, perché Vinted non ne ha: un cambiamento del sito può romperla.

## Privacy e permessi

Bozze, storico, statistiche, coda e notifiche restano nel browser. Nessuna telemetria. Le sole
richieste fuori da Vinted vanno all'API pubblica di GitHub, senza cookie né dati tuoi:

- **Cerca aggiornamento** legge `version.json`, solo quando premi il bottone;
- i **link del progetto** (GitHub, Discord, Ko-fi…) si rileggono da `links.json` al massimo ogni
  12 ore aprendo popup o dashboard. Si spegne in Impostazioni › Avanzate › «Aggiorna i link del
  progetto».

| Permesso | Perché serve |
|---|---|
| `storage` | impostazioni, coda, inventario, storico, notifiche: tutto in locale |
| `webRequest` | leggere dalle richieste di Vinted il token di sessione, il tuo id e i formati |
| `alarms` | svegliare la coda all'orario giusto e riprendere una pausa a tempo a popup chiuso |
| `notifications` | la notifica di fine coda |
| `idle` | il ritmo irregolare: niente passi quando non sei al computer |
| `downloads` | foto scaricate, backup delle impostazioni, esportazioni della coda |
| siti `vinted.*` e `*.vinted.net` | chiamare le API di Vinted e scaricare le foto dal suo CDN |

## Quando ripubblicare

Vinted ordina feed e ricerche per data di aggiornamento: ripubblicare rimette l'articolo in cima, e
l'algoritmo misura l'interesse nelle prime ore.

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

- **Domenica sera, 20:00–22:00** è il momento migliore; **venerdì** il giorno peggiore.
- **Da evitare:** 1:00–6:00, venerdì dopo le 21, sabato prima delle 10.
- **Tra articoli diversi, 15–20 minuti** (l'intervallo predefinito della coda).
- **Lo stesso articolo ogni 4–7 giorni, mai ogni giorno.** Su 2,4 milioni di articoli:

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
vendono strumenti di ripubblicazione e i dati vengono dai loro utenti: non sono verificabili. La
risposta per il tuo armadio te la dà la dashboard, dopo qualche settimana di relist misurati.

## Come funziona

| Passo | Chiamata |
|---|---|
| Legge l'articolo nel formato del form di pubblicazione | `GET /api/v2/item_upload/items/{id}` |
| Scarica le foto originali | `images*.vinted.net` |
| Ricarica ogni foto come nuova | `POST /api/v2/photos` |
| Crea il nuovo annuncio | `POST /api/v2/item_upload/items` |
| Elimina il vecchio | `POST /api/v2/items/{id}/delete` |

La coda la scrive **solo il service worker**, una modifica alla volta: pagina, popup e dashboard
mandano richieste e mostrano lo stato salvato. Ogni articolo è identificato dal suo id Vinted,
mai dalla posizione, così aggiunte e spostamenti durante l'esecuzione non scambiano articoli.
Dettagli, stati e decisioni in [docs/SVILUPPO.md](docs/SVILUPPO.md).

### Campi che dipendono dalla categoria

Un libro, un manga e una giacca non hanno gli stessi campi. Le prove sono solo i tuoi articoli con
**lo stesso `catalog_id`**; categorie diverse non si mescolano mai.

| Campo | Cosa succede |
|---|---|
| `color_ids` | Presente: inviato com'è. Assente: riempito solo se tutti gli altri tuoi articoli della categoria (almeno 2) hanno un colore e concordano. Avviso solo se tutta la categoria lo usa, altrimenti nota. Mai dedotto da titolo o copertina. |
| `is_unisex` | `true` e `false` si conservano. Assente (libri, manga): resta assente. Mai impostato d'ufficio. |
| `package_size_id` | Solo segnalato. |
| `isbn`, misure, `manufacturer` | Mai toccati. |

## Se qualcosa non va

Popup › **Salute** › **Prepara la diagnostica**: versione, impostazioni, stato della coda ed errori
recenti, senza token, cookie, id o indirizzi. Lo vedi prima di copiarlo.

- **I bottoni non compaiono.** In console cerca `[Relist] attivo su`; se il riconoscimento del
  profilo sbaglia, attiva «Mostra i bottoni ovunque» nelle Avanzate.
- **«Apri armadio» porta alla home.** Apri una pagina qualsiasi di Vinted da loggato.
- **Icona rotta, `ERR_FILE_NOT_FOUND`.** Il browser non trova più la cartella: estrai in una
  posizione stabile e ricarica l'estensione da lì.
- **«Errore durante il caricamento della foto».** Carica una foto a mano da `/items/new` per far
  imparare il formato, poi riprova.
- **Errore 403 o 429.** È l'anti-bot: la coda rallenta da sola.
- **«Repository non trovato» cercando aggiornamenti.** Il repository è privato o ha un altro nome:
  Impostazioni › Avanzate › Repository per gli aggiornamenti.

### Strumenti nella console

Spenti di default (Impostazioni › Avanzate › **Strumenti nella console**), tutti in sola lettura:

```js
await VR.settings()        // impostazioni, senza id utente né contenuti degli annunci
await VR.diagnosi(ID)      // colore, unisex, pacco: originale → convertito → inviato, fonte, motivo
await VR.source(ID)        // payload grezzo che Vinted restituisce per l'articolo
await VR.captured()        // payload catturato da una modifica fatta a mano
await VR.compare(ID)       // confronto con il formato appreso: campi mancanti, di troppo
await VR.debugDraft(ID)    // cosa verrebbe inviato, senza pubblicare niente
await VR.canary(ID)        // prova a vuoto: legge e prepara tutto senza pubblicare
```

## Segnalare un problema, proporre un'idea, contribuire

- **Bug:** [apri una segnalazione](https://github.com/MashaUP/Vinted_Relist/issues/new?template=segnalazione-bug.yml)
  con versione, browser, cosa è successo e la diagnostica. Non incollare cookie, token o dati
  dell'account.
- **Idee:** [proponi una funzione](https://github.com/MashaUP/Vinted_Relist/issues/new?template=proposta.yml),
  partendo dal problema che risolve.
- **Domande e aiuto:** la [community su Discord](https://discord.gg/EPsbQCuAkx).
- **Codice:** fai un fork, modifica, esegui i test e apri una pull request. Niente telemetria,
  codice scaricato da Internet o alterazioni delle foto per eludere i controlli.

```
cd tests && npm install && node run.js
```

Servono Node 18+ e, per i test dell'interfaccia, jsdom (lo installa `npm install`).

## Struttura

```
manifest.json            permessi e registrazione degli script
background.js            service worker: token, formati, coda (unico scrittore), archivio, notifiche, download
links.json               link del progetto (GitHub, Discord, Ko-fi…): predefiniti e remoti, vedi docs/LINK.md
version.json             (solo nel repository) versione pubblicata, letta da «Cerca aggiornamento»
CHANGELOG.md             novità per versione, mostrate anche nel popup
docs/SVILUPPO.md         architettura, flussi, decisioni, debito tecnico, registro proposte
docs/LINK.md             link centralizzati e configurazione remota
src/coda-logica.js       modello della coda: stati, transizioni, stime, salute, errori (funzioni pure)
src/relist.js            clonazione, foto, campi, controllo preventivo, annullamento
src/api.js               tutte le chiamate a Vinted
src/editor*.js           editor dell'annuncio e i suoi controlli
src/queue.js             selezione, opzioni e modelli della coda, controllo preventivo, pannello
src/ui.js, content.js    bottoni sulle card, finestre, rilevamento articoli e inventario
src/popup.*              Home, Notifiche, Salute, Impostazioni
src/dashboard*.{html,js,css}  armadio e gestione della coda
src/link.js              validazione e precedenza dei link (funzioni pure, riusabile)
src/link-chrome.js       lettura, cache e collegamento dei link nelle pagine dell'estensione
src/versione.js          versioni, aggiornamenti, diagnostica (funzioni pure)
src/impostazioni.js      validazione, backup e ripristino delle impostazioni (funzioni pure)
src/utils.js, styles.css impostazioni predefinite, avvisi, stile dentro Vinted
src/page-bridge.js       strumenti di sola lettura nella console (facoltativi)
tests/                   test automatici e valida-link.js
```

Tecnologie: JavaScript senza framework, Chrome Manifest V3 (service worker, `chrome.storage`,
`chrome.alarms`), HTML e CSS; test con Node e jsdom.

## Link del progetto

GitHub, Discord, Ko-fi, guida, segnalazioni e novità stanno in un unico file, `links.json`. Per
cambiare l'invito Discord senza pubblicare una versione nuova basta modificarlo sul repository e
aumentare `revision`: le estensioni installate lo leggono entro 12 ore. Procedura completa,
formato, sicurezza e riuso in altri progetti in [docs/LINK.md](docs/LINK.md).

## Supporta lo sviluppo

Vinted Relist è gratuito. Se ti fa risparmiare tempo puoi offrirmi un caffè su
[Ko-fi](https://ko-fi.com/mashaup).

## Nota

Automatizzare azioni sul sito non è previsto dai termini di servizio di Vinted. Uso personale,
poche richieste, pause generose: è quello per cui questa estensione è scritta.
