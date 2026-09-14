# Vinted Relist

Estensione Chrome/Brave ad uso personale. Aggiunge due bottoni sotto ogni tuo articolo
su `vinted.it`:

- **Ripubblica** — clona l'annuncio identico (foto, titolo, descrizione, categoria, marca, taglia, colori, prezzo, spedizione) e cancella quello vecchio.
- **Modifica** — apre una finestra dove cambi titolo, descrizione, prezzo e condizione prima di pubblicare.

Al primo avvio compare una schermata di benvenuto con i tre passaggi. Si vede una volta sola;
puoi rivederla dal popup dell'estensione.

## Installazione

1. `chrome://extensions` (o `brave://extensions`).
2. Attiva **Modalità sviluppatore** in alto a destra.
3. **Carica estensione non pacchettizzata** e scegli questa cartella.
4. Apri `https://www.vinted.it/member/<tuo-id>` e ricarica la pagina.

Dopo ogni modifica ai file, premi **Ricarica** sulla scheda dell'estensione e ricarica Vinted.

## Come funziona

L'estensione non simula i click sul sito: usa le stesse API interne che usa Vinted
(`/api/v2/...`) con i cookie della tua sessione.

| Passo | Chiamata |
|---|---|
| Leggo l'articolo nel formato del form di pubblicazione | `GET /api/v2/item_upload/items/{id}` |
| Scarico le foto originali dal CDN | `images*.vinted.net` (dal service worker, per aggirare il CORS) |
| Ricarico ogni foto come nuova | `POST /api/v2/photos` |
| Creo il nuovo annuncio | `POST /api/v2/item_upload/items` |
| Elimino il vecchio | `POST /api/v2/items/{id}/delete` |

Il token `x-csrf-token` viene catturato dal service worker mentre Vinted stesso lo manda
alle sue API; se non c'è, viene cercato nella pagina e, come ultima spiaggia, in `/items/new`.

## L'ordine conta

Nelle impostazioni trovi due modalità:

- **Prima pubblica, poi elimina** (predefinita). Se la creazione fallisce, il vecchio annuncio è ancora lì. Il rischio è il contrario: nuovo pubblicato e vecchio non eliminato, cioè un doppione da rimuovere a mano. È il guaio meno grave dei due.
- **Prima elimina, poi pubblica**. Relist "pulito", ma se Vinted rifiuta la creazione l'annuncio è già sparito. Prima di cancellare, l'estensione salva sempre una copia dei dati in `chrome.storage.local`: la recuperi dal popup con **Copia le bozze salvate**.

Prova la prima volta su un articolo a cui tieni poco.

## Impostazioni (popup)

- Elimina il vecchio annuncio (se lo disattivi, ottieni un duplicato invece di un relist)
- Ricarica la pagina dopo la pubblicazione
- Mostra i bottoni ovunque (utile se il riconoscimento del tuo profilo non funziona)
- Ordine delle operazioni
- Pausa tra le chiamate — alzala a 2500–3000 ms se ripubblichi molti articolli di fila

## Se qualcosa non va

**I bottoni non compaiono.** Vinted cambia spesso le classi CSS. Apri la console e guarda se
compare `[Relist] attivo su`. Se sì, il problema è il selettore della card: aggiungi il tuo in
`CARD_SELECTORS` dentro `src/content.js`. Se il riconoscimento del profilo sbaglia, attiva
"Mostra i bottoni ovunque".

**Errore 403 o schermata anti-bot.** Vinted usa DataDome. Ricarica la pagina, disattiva
ad-blocker su vinted.it, aspetta qualche minuto.

**Errore 429.** Stai andando troppo veloce: alza la pausa e riprendi più tardi.

**La condizione impostata è sbagliata.** Gli id in `CONDITIONS` (`src/ui.js`) possono cambiare.
Per trovare quelli giusti: apri DevTools → Network, modifica un articolo a mano su Vinted,
guarda il `status_id` nella richiesta.

**Un endpoint è cambiato.** Sono tutti raccolti in `src/api.js`. Apri Network, fai l'azione
a mano sul sito, copia il path aggiornato.

## Struttura

```
manifest.json      permessi e registrazione degli script
background.js      cattura token + download foto senza CORS
src/utils.js       impostazioni, toast, coda seriale
src/api.js         tutte le chiamate a Vinted
src/relist.js      logica di clonazione
src/ui.js          onboarding, bottoni, dialog di modifica
src/content.js     rilevamento articoli e injection
src/popup.*        impostazioni e recupero bozze
```

## Nota

Automatizzare azioni sul sito non è previsto dai termini di servizio di Vinted. Uso personale,
poche richieste, pause generose: è quello per cui questa estensione è scritta.
