# Vinted Relist

**🇮🇹 Italiano** · [🇬🇧 English](README.en.md) · [🇫🇷 Français](README.fr.md) · [🇪🇸 Español](README.es.md) · [🇩🇪 Deutsch](README.de.md)

Estensione per **Brave e Chrome** che ripubblica i tuoi annunci Vinted in un clic, uno alla volta
o in coda, per riportarli in cima ai risultati senza rifarli a mano.

**Versione 2.7.1** · [Novità](CHANGELOG.md) · [Community su Discord](https://discord.gg/EPsbQCuAkx) ·
[Segnala un problema](https://github.com/MashaUP/Vinted_Relist/issues/new?template=segnalazione-bug.yml) ·
[Supporta lo sviluppo su Ko-fi](https://ko-fi.com/mashaup)

> [!WARNING]
> **Progetto non ufficiale, da usare a tuo rischio.** Non è affiliato né approvato da Vinted, e
> automatizzare azioni sul sito può non essere consentito dai termini di Vinted, che può limitare o
> sospendere gli account. **L'autore non è responsabile** di ciò che succede al tuo account, di
> annunci persi o eliminati, di vendite mancate né di abusi o usi impropri dell'estensione.
> Ripubblicare **elimina** l'annuncio vecchio: visite e preferiti ripartono da zero.
> Installandola accetti le [avvertenze complete](DISCLAIMER.md#italiano).

---

## Indice

- [A chi serve](#a-chi-serve)
- [Installazione](#installazione) · [Aggiornare](#aggiornare)
- [Guida rapida](#guida-rapida)
- [Cosa fa](#cosa-fa)
- [Consigli: quando ripubblicare](#consigli-quando-ripubblicare)
- [Se qualcosa non va](#se-qualcosa-non-va)
- [Privacy e permessi](#privacy-e-permessi)
- [Cosa non fa](#cosa-non-fa)
- [Aiuto, idee, contributi](#aiuto-idee-contributi)
- [Per sviluppatori](#per-sviluppatori)
- [Licenza e avvertenze](#licenza-e-avvertenze)

## A chi serve

A chi vende su Vinted dal proprio armadio e ripubblica spesso gli stessi articoli: libri, manga,
abbigliamento, lotti. Invece di copiare foto e testi in un annuncio nuovo e cancellare il vecchio,
premi **Ripubblica** sulla card dell'articolo, oppure selezionane tanti e mettili in **coda** con
un intervallo tra uno e l'altro.

È un progetto personale, gratuito e senza server: tutto resta nel tuo browser. L'interfaccia è in
**italiano, inglese, francese, spagnolo e tedesco**.

| | |
|---|---|
| Distribuzione | zip su GitHub, da caricare come estensione non pacchettizzata. **Non è sul Chrome Web Store** (vedi [perché](docs/SVILUPPO.md#11-chrome-web-store-rischi)) |
| Verificato su Vinted reale | la ripubblicazione, nelle versioni usate dall'autore |
| Verificato solo nei test | molte funzioni recenti (code dinamiche, batch, Vintory, lingue…): oltre 1100 controlli automatici e prove in Chromium su un Vinted simulato, senza pubblicazioni vere |
| Dipendenze | nessuna libreria, nessun passaggio di build |

**Prima di usarla su tanti articoli, provala su uno a cui tieni poco.**

## Installazione

1. Scarica **`Vinted_Relist-2.7.1.zip`** dalla pagina della
   [release su GitHub](https://github.com/MashaUP/Vinted_Relist/releases) (tra gli allegati) o
   dalla radice del repository.
2. Estrailo **in una cartella stabile**, per esempio `Documenti\Vinted_Relist` (non nella cartella
   temporanea che Windows apre con il doppio clic sullo zip). La cartella giusta è quella che
   contiene `manifest.json`.
3. Apri `brave://extensions` (o `chrome://extensions`) e attiva **Modalità sviluppatore** in alto
   a destra.
4. **Carica estensione non pacchettizzata** › scegli la cartella con `manifest.json`.
5. Apri il tuo armadio su Vinted **da loggato** e ricarica la pagina: sulle card compaiono i
   bottoni **Ripubblica** e **Modifica**.

> Non cancellare né spostare la cartella dopo l'installazione: il browser la usa ogni volta.

### Aggiornare

1. Popup › **Salute** › **Cerca aggiornamento** (controlla anche da sola ogni 12 ore e ti avvisa).
2. **Scarica lo zip**: il popup ne controlla l'impronta SHA-256 e lo salva in Download › Vinted Relist.
   Estrailo **nella cartella che contiene `Vinted_Relist`**, sostituendo i file (lo zip contiene già
   la cartella `Vinted_Relist/`).
3. **Installa l'aggiornamento**: l'estensione si ricarica. Poi ricarica le schede di Vinted (F5).

Un'estensione caricata da cartella non può sostituire i propri file: l'estrazione la fai tu. Se un
articolo è in pubblicazione il bottone aspetta; una coda attiva risulta «interrotta» e riparte con
**Riprendi**.

## Guida rapida

**0. Lingua.** Il pulsante 🌐 in alto nel popup e nella dashboard apre il pannello **Lingua**:
«Automatica» segue la lingua del browser, oppure scegli Italiano, English, Français, Español o
Deutsch. Il cambio vale subito ovunque.

**1. Un articolo.** Sulla card del tuo armadio:
- **Ripubblica**: clona l'annuncio e cancella il vecchio, subito;
- **Modifica**: prima cambi foto, titolo, descrizione o prezzo, vedi l'anteprima di cosa cambia e
  poi pubblichi.

**2. Tanti articoli (coda).** Spunta le caselle sulle card (Shift+clic per un intervallo) ›
**Coda** › scegli le opzioni (prezzo, testi, intervallo tra gli articoli, orario di partenza) ›
il controllo legge ogni articolo **senza pubblicare** e li divide in pronti, con avvisi e
bloccati › **Avvia**. Tieni aperta una scheda di Vinted finché la coda lavora.

**3. Con la coda in corso.** Continua a selezionare articoli e premi **Aggiungi alla coda**: si
apre il **Centro di modifica** e diventano una **batch** nuova, con regole e intervallo suoi. La
coda non si ferma. **Gestisci** apre la pagina della coda, dove vedi, riordini, metti in pausa e
correggi tutto.

**4. Annunci già eliminati da Vinted.** Con [Vintory](https://github.com/MashaUP/Vintory) esporta
gli annunci («Per Vinted_Relist»), poi Dashboard › **Ripubblica da Vintory** › scegli lo ZIP:
l'anteprima ti dice quali si possono ripubblicare, senza eliminare niente.

**5. Se qualcosa va storto.** Popup › **Salute**: stato dell'estensione, diagnostica da copiare e
cosa fare. Un esito incerto diventa «da verificare» e non viene mai ripubblicato da solo.

## Cosa fa

### Ripubblicazione
- Clona l'annuncio (foto, titolo, descrizione, categoria, marca, taglia, condizione, colori,
  modello per i telefoni, prezzo, spedizione) e cancella quello vecchio, con le API interne del
  sito e la tua sessione: niente clic simulati.
- **Ordine sicuro:** pubblica, poi elimina (predefinito). Se Vinted rifiuta il nuovo, il vecchio
  resta. In alternativa elimina, poi pubblica, con una copia dei dati salvata prima.
- **Nel dubbio non ripubblica:** se Vinted non dà una risposta chiara l'articolo diventa «da
  verificare» e lo confermi tu (anche con **Verifica pubblicazione**, che guarda su Vinted senza
  pubblicare niente). Un doppione costa più di un articolo fermo un giro in più.
- **Solo i tuoi annunci:** bottoni e azioni compaiono solo nel tuo armadio; i venduti non si
  ripubblicano e in coda vengono saltati.

### Editor dell'annuncio
- Foto: riordino, rotazione, ritaglio (libero, quadrato, 4:5), rimozione e ripristino.
- Titolo con contatore, descrizione, prezzo, colore; controlli in tempo reale e punteggio di
  completezza; anteprima di cosa cambia; bozza salvata da sola.
- **Scarica le foto** originali, nella qualità più alta, in Download › Vinted Relist.

### Coda
- **Dinamica:** aggiungi, rimuovi e riordina anche mentre lavora o è in pausa.
- **Batch:** ogni gruppo aggiunto ha regole proprie (prezzo, descrizione, dati mancanti) e il suo
  intervallo; l'attesa in corso non si azzera mai.
- **Marcatori sulle card:** In coda, In attesa, In elaborazione, Da verificare, Completato,
  Errore. Niente doppioni, neanche fra batch diverse.
- **Pausa** subito, dopo l'articolo in corso o **a tempo**; ripresa affidabile anche a popup chiuso.
- **Ripubblica ora:** l'articolo scelto diventa il prossimo, senza interrompere quello in corso.
- **Opzioni in blocco:** prezzo in percentuale, in euro o fisso (mai sotto 0,50 €), cerca e
  sostituisci, riga in fondo alla descrizione, colore dove manca. **Modelli** da riusare.
- **Protezioni:** un articolo alla volta; davanti a un 429/403 rallenta e poi si ferma; tre
  problemi di fila mettono la coda in pausa; dopo un'interruzione del browser decide con le prove
  («Interrotto» se non era partito niente, «da verificare» se sì).
- **Automazione facoltativa:** fasce orarie di picco, articoli fermi da N giorni, ritmo irregolare.
- **Cronologia**, esportazione **CSV/JSON** e sessioni precedenti da riprendere.

### Popup e dashboard
- **Popup:** Home (coda e attività), Notifiche, Salute (controlli, diagnostica, Cerca
  aggiornamento, novità, link), Impostazioni con backup.
- **Dashboard dell'armadio:** gestione della coda, gruppi (recenti, stagnanti, da ottimizzare…),
  tabella con ricerca, possibili duplicati, cosa funziona (visite a 48 ore per giorno e fascia),
  storico con confronto prima/dopo e ripristino, **Ripubblica da Vintory**.

### Scorciatoie (pagina della coda)

| Tasto | Azione |
|---|---|
| `P` | pausa / riprendi |
| `A` | apri l'articolo in corso |
| `F` | mostra solo i problemi |
| `R` | sull'articolo selezionato: ripubblica ora |
| `S` | seleziona tutti gli articoli in attesa |
| `Canc` | rimuovi dalla coda i selezionati |
| `H` | apri la cronologia |
| `C` | copia il resoconto |
| `Alt` + `↑` `↓` `Home` `Fine` | sposta l'articolo |
| `?` | elenco delle scorciatoie |

## Consigli: quando ripubblicare

Vinted ordina feed e ricerche per data di aggiornamento: ripubblicare rimette l'articolo in cima, e
l'algoritmo misura l'interesse nelle prime ore.

- **Tra articoli diversi, 15–20 minuti** (l'intervallo predefinito della coda). Pochi articoli
  alla volta, pause generose.
- **Lo stesso articolo ogni 5–7 giorni, mai ogni giorno.**
- **Domenica sera, 20:00–22:00** risulta il momento migliore; **venerdì** il giorno peggiore;
  meglio evitare 1:00–6:00.

| Frequenza per lo stesso articolo | Venduti in 14 giorni | Visite medie |
|---|---|---|
| 1× al giorno | 4% | 12 |
| Ogni 2 giorni | 9% | 28 |
| **Ogni 5–7 giorni** | **23%** | **94** |
| Ogni 10 giorni | 17% | 67 |
| Mai | 6% | 21 |

Le fonti ([Relisted](https://relisted.io/en/blog/best-time-post-vinted),
[Vinkit](https://vinkit.co/it/blog/con-quale-frequenza-ripubblicare-annunci-vinted-studio-24m-articoli))
vendono strumenti di ripubblicazione e i dati vengono dai loro utenti: non sono verificabili. La
risposta per il tuo armadio te la dà la dashboard, dopo qualche settimana di relist misurati.

## Se qualcosa non va

Popup › **Salute** › **Prepara la diagnostica**: versione, impostazioni, stato della coda ed errori
recenti, senza token, cookie, id o indirizzi. Lo vedi prima di copiarlo e puoi incollarlo su
Discord o in una segnalazione.

- **I bottoni non compaiono / «Profilo non rilevato».** Compaiono solo nel tuo armadio
  (`/member/<tuo id>`) e quando l'estensione ha riconosciuto il tuo account. Ricarica una scheda di
  Vinted (F5) da loggato: le schede aperte prima di installare o aggiornare l'estensione non
  contano. In Salute, **«Richieste di Vinted»** dice quando l'estensione ha visto Vinted l'ultima
  volta e se c'era il cookie dell'account; se dice «formato nuovo», manda la diagnostica.
- **«Ricarica questa pagina» dopo un aggiornamento.** Ricarica la scheda di Vinted (F5): le pagine
  già aperte restano con il codice vecchio.
- **Errori di sessione** (dalla 2.7.1 il messaggio dice quale). In Salute la riga **«Sessione»**
  dice se la scheda di Vinted è pronta. «Sessione scaduta»: accedi di nuovo a Vinted in quella
  scheda. «Token non trovato nelle forme conosciute»: Vinted potrebbe aver cambiato la pagina,
  manda la diagnostica su Discord. Il profilo rilevato da solo non basta per pubblicare.
- **Telefoni: Vinted chiede di selezionare il modello.** Dalla 2.6 il modello passa da solo. Se
  succede ancora: apri l'annuncio su Vinted › **Modifica** › controlla il modello › salva, poi
  riprova (l'estensione impara i campi della categoria). Se non basta, mandaci la diagnostica.
- **La coda si ferma con «Problema dell'estensione».** Il motivo è nella pausa e nella
  diagnostica. Di solito basta ricaricare la scheda di Vinted; poi **Riprendi**. Niente era stato
  inviato a Vinted.
- **Errore 403 o 429.** È la protezione anti-bot di Vinted: la coda rallenta da sola. Aumenta
  l'intervallo.
- **«Errore durante il caricamento della foto».** Carica una foto a mano da `/items/new` per far
  imparare il formato, poi riprova.
- **Icona rotta, `ERR_FILE_NOT_FOUND`.** Il browser non trova più la cartella: estrai in una
  posizione stabile e ricarica l'estensione da lì.
- **Su due computer va diversamente.** Salute › **Report di confronto** su tutte e due, poi
  incolla quello dell'altra in «Confronta»: escono solo le differenze.

<details>
<summary>Strumenti nella console (per utenti esperti)</summary>

Spenti di default (Impostazioni › Avanzate › **Strumenti nella console**), tutti in sola lettura:

```js
await VR.settings()        // impostazioni, senza id utente né contenuti degli annunci
await VR.diagnosi(ID)      // colore, unisex, pacco, modello: originale → convertito → inviato
await VR.source(ID)        // payload grezzo che Vinted restituisce per l'articolo
await VR.captured()        // payload catturato da una modifica fatta a mano
await VR.compare(ID)       // confronto con il formato appreso: campi mancanti, di troppo
await VR.debugDraft(ID)    // cosa verrebbe inviato, senza pubblicare niente
await VR.canary(ID)        // prova a vuoto: legge e prepara tutto senza pubblicare
```
</details>

## Privacy e permessi

Bozze, storico, statistiche, coda e notifiche restano nel browser. **Nessuna telemetria, nessun
server, nessun dato inviato all'autore.** Le sole richieste fuori da Vinted vanno a GitHub, senza
cookie né dati tuoi: `version.json` per gli aggiornamenti e `links.json` per i link del progetto
(si spegne in Impostazioni › Avanzate).

| Permesso | Perché serve |
|---|---|
| `storage` | impostazioni, coda, inventario, storico, notifiche, lingua: tutto in locale |
| `webRequest` | leggere dalle richieste di Vinted il token di sessione, il tuo id e i formati |
| `alarms` | svegliare la coda all'orario giusto e riprendere una pausa a tempo |
| `notifications` | la notifica di fine coda e degli aggiornamenti |
| `idle` | il ritmo irregolare: niente passi quando non sei al computer |
| `downloads` | foto scaricate, backup delle impostazioni, esportazioni della coda |
| siti `vinted.*` e `*.vinted.net` | chiamare le API di Vinted e scaricare le foto dal suo CDN |

## Cosa non fa

- **Non riporta in vita l'annuncio originale:** visite, preferiti e anzianità ripartono da zero.
- **Non altera le foto per renderle irriconoscibili** ai controlli di Vinted.
- **Non lavora a browser chiuso:** serve il browser aperto e una scheda su Vinted.
- **Non si aggiorna da sola:** ti avvisa, l'estrazione la fai tu.
- **Non usa API pubbliche**, perché Vinted non ne ha: un cambiamento del sito può romperla.

## Aiuto, idee, contributi

- **Domande e aiuto:** la [community su Discord](https://discord.gg/EPsbQCuAkx).
- **Bug:** [apri una segnalazione](https://github.com/MashaUP/Vinted_Relist/issues/new?template=segnalazione-bug.yml)
  con versione, browser, cosa è successo e la diagnostica. **Non incollare mai cookie, token o
  dati dell'account.**
- **Idee:** [proponi una funzione](https://github.com/MashaUP/Vinted_Relist/issues/new?template=proposta.yml),
  partendo dal problema che risolve.
- **Supporta lo sviluppo:** Vinted Relist è gratuito; se ti fa risparmiare tempo puoi offrirmi un
  caffè su [Ko-fi](https://ko-fi.com/mashaup).

## Per sviluppatori

La documentazione tecnica è in italiano: architettura, flussi, dati e limiti in
[docs/SVILUPPO.md](docs/SVILUPPO.md), link centralizzati in [docs/LINK.md](docs/LINK.md), dati
trattati e segnalazioni in [SECURITY.md](SECURITY.md).

### Come funziona

| Passo | Chiamata |
|---|---|
| Legge l'articolo nel formato del form di pubblicazione | `GET /api/v2/item_upload/items/{id}` |
| Scarica le foto originali | `images*.vinted.net` |
| Ricarica ogni foto come nuova | `POST /api/v2/photos` |
| Crea il nuovo annuncio | `POST /api/v2/item_upload/items` |
| Elimina il vecchio | `POST /api/v2/items/{id}/delete` |

La coda la scrive **solo il service worker**, una modifica alla volta: pagina, popup e dashboard
mandano richieste e mostrano lo stato salvato. Ogni articolo è identificato dal suo id Vinted, mai
dalla posizione.

I campi che dipendono dalla categoria (colore, unisex, pacco, modello) si deducono solo dai tuoi
articoli con **lo stesso `catalog_id`**; ISBN, misure e produttore non si toccano mai.

### Lingue

I testi sono scritti in italiano nel codice; `src/lang/{en,fr,es,de}.json` hanno come chiave il
testo italiano. Dopo aver aggiunto testi, `node scripts/i18n-estrai.js` elenca quelli da tradurre.

### Test e controlli

```
npm ci          # solo strumenti di sviluppo: ESLint, jsdom, acorn
npm test        # ESLint (no-undef, no-unused-vars…) e tutti i test di unità
npm run build   # dist/Vinted_Relist-x.y.z.zip e .sha256
```

Servono Node 22 e `zip`/`unzip`. Le stesse cose le fa `ci.yml` a ogni push. Contributi: fork,
modifica, `npm test`, pull request. Niente telemetria, codice scaricato da Internet o alterazioni
delle foto per eludere i controlli.

### Struttura

```
manifest.json            permessi, script e la versione (fonte unica)
background.js            service worker: token, account, formati, coda e inventario (unico scrittore), esiti, notifiche
links.json, version.json link del progetto (docs/LINK.md) e ultima versione pubblicata, letti da raw
CHANGELOG.md             novità per versione, mostrate anche nel popup
DISCLAIMER.md, SECURITY.md   avvertenze in cinque lingue; dati trattati e segnalazioni di sicurezza
README.*.md              guida in inglese, francese, spagnolo, tedesco
src/                     codice dell'estensione (coda, editor, popup, dashboard, lingue, Vintory, link)
tests/                   test di unità e dell'interfaccia (jsdom)
scripts/                 pacchetto.sh (zip, SHA-256, consegna), i18n-estrai.js (testi da tradurre)
.github/workflows/       ci.yml (a ogni push), release.yml (zip allegato e annuncio su Discord)
```

### Pubblicare una versione

1. Versione in `manifest.json` (fonte unica) e nelle tre costanti che il pacchetto controlla
   (`BUILD` in `background.js`, `VR.BUILD` in `src/utils.js`, `VERSIONE` in `src/coda-logica.js`),
   `version.json` (versione, data, note) e la sezione nel `CHANGELOG.md`.
2. `npm test`, poi `npm run package`: sostituisce lo zip nella radice, scrive `zip` e `sha256` in
   `version.json`, aggiorna versione e nome dello zip nei README e crea
   `dist/Vinted_Relist_GitHub.zip`.
3. Carica i file su `main` e cancella dalla radice lo zip della versione precedente.
4. GitHub › **Releases** › **Draft a new release**, tag `v` + versione (es. `v2.7.0`) ›
   **Publish release**. Il workflow controlla il tag, ripete lint e test, allega lo zip e il suo
   `.sha256` (rilanciandolo si sostituiscono) e, con il secret `DISCORD_WEBHOOK_URL`, annuncia la
   release su Discord. Si rilancia da **Actions** › «Zip della release» › **Run workflow**.

«Cerca aggiornamento» legge `version.json` da `raw.githubusercontent.com` e scarica lo zip della
radice, controllandone lo SHA-256. Per cambiare l'invito Discord senza una versione nuova basta
modificare `links.json` su `main` e aumentare `revision` ([docs/LINK.md](docs/LINK.md)).

## Licenza e avvertenze

[MIT](LICENSE): puoi usare, modificare e ridistribuire il codice, anche in progetti tuoi, purché
mantieni l'avviso di copyright. Il software è fornito **così com'è, senza garanzie**.

Vinted Relist è un progetto indipendente, **non affiliato né approvato da Vinted**. L'uso è a tuo
rischio: l'autore non risponde di sospensioni o blocchi dell'account, annunci persi, vendite
mancate, né di abusi o usi impropri. Uso personale, poche richieste, pause generose: è quello per
cui questa estensione è scritta. Leggi le [avvertenze complete](DISCLAIMER.md) (in cinque lingue).
