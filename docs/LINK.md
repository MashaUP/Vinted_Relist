# Link del progetto e configurazione remota

Come Vinted Relist gestisce GitHub, Discord, Ko-fi e gli altri link ufficiali, come si cambiano
senza pubblicare una versione nuova e come riusare lo stesso sistema in un altro progetto.
Aggiornato alla **2.1.0**.

## In breve

- **Un solo file**, `links.json` nella radice del repository, con tutti i link.
- Lo stesso file **viaggia nel pacchetto** dell'estensione (è la configurazione predefinita) ed
  è **letto dal repository** su GitHub (è la configurazione remota).
- Per cambiare l'invito Discord basta modificare `links.json` sul ramo `main` e aumentare
  `revision`: le estensioni installate lo leggono entro 12 ore, o subito con «Cerca
  aggiornamento».
- Il file remoto contiene **solo dati**: indirizzi, etichette, interruttori. Niente codice,
  niente HTML, niente permessi. Ogni voce si valida da sola: una voce sbagliata viene scartata e
  resta quella installata.
- **Nessun permesso Chrome in più**, nessun servizio da attivare, nessun costo.
- Le code, la ripubblicazione e le notifiche **non usano i link**: se GitHub non risponde non
  cambia niente, al massimo restano i link già noti.

## Perché così

| Alternativa | Pro | Contro | Scelta |
|---|---|---|---|
| URL scritti nel codice | semplice | ogni cambio = nuova versione; Ko-fi era ripetuto in 4 punti | superata |
| **JSON nel repository, letto dall'API di GitHub** | gratuito, già usato per `version.json`, aggiornamento in un minuto (cache dell'API ~60 s), nessun permesso (l'API consente CORS), lo stesso file fa da predefinito | serve validazione e cache; limite di 60 richieste l'ora per IP condiviso col controllo aggiornamenti | **adottata** |
| `raw.githubusercontent.com` | nessun limite di richieste stretto | cache CDN di ~5 minuti, a volte di più | non serve: con una richiesta ogni 12 ore il limite dell'API non pesa |
| Redirect stabile (es. `mashaup.github.io/discord`) | l'estensione non conosce la destinazione finale | serve un sito GitHub Pages o un dominio; un salto in più; dipende da un altro servizio; un link alla volta | **non attivato**, ma predisposto: `mashaup.github.io` è già tra i siti ammessi (vedi sotto) |
| Cloudflare Workers / backend | controllo totale | un servizio da mantenere, credenziali, costi potenziali | sproporzionato per sette link |
| Un documento unico per tutti i progetti | un file da curare | un errore in un progetto rompe gli altri; legare repository diversi | **un file per progetto**, nel suo repository; il formato è lo stesso ovunque |

Per Discord il rimedio più robusto resta a monte: crea l'invito con **Scadenza: mai** e **Numero
massimo di utilizzi: nessun limite**. Il JSON serve per quando l'invito va comunque sostituito.

## Il formato (schema 1)

```json
{
  "schemaVersion": 1,
  "project": "vinted-relist",
  "revision": 1,
  "links": {
    "discord": {
      "url": "https://discord.gg/EPsbQCuAkx",
      "enabled": true,
      "label": "Discord",
      "description": "Community: domande, idee e aiuto"
    }
  }
}
```

| Campo | Obbligatorio | Regola |
|---|---|---|
| `schemaVersion` | sì | intero; un numero più alto di quello che l'estensione conosce (1) rende il file **incompatibile**: viene ignorato e restano i link installati |
| `project` | sì | deve essere `vinted-relist`: un file di un altro progetto viene rifiutato |
| `revision` | consigliato | intero ≥ 0, **da aumentare a ogni modifica**. Un remoto con `revision` minore di quella del pacchetto installato è considerato vecchio e ignorato |
| `links.<id>` | — | id stabile, minuscole, cifre e trattini (`bug-report`), al massimo 20 link |
| `url` | se acceso | solo `https://`, niente credenziali né porte, solo siti ammessi (sotto) |
| `enabled` | no (vero) | `false` spegne il link ovunque; per spegnere non serve l'`url` |
| `label` | no | testo breve (40 caratteri), mostrato come testo, mai come HTML. Vuoto: resta quello installato |
| `description` | no | testo breve (120 caratteri), sotto l'etichetta in Salute |
| altri campi | — | ignorati: un file più nuovo con campi in più resta leggibile |

Id usati oggi: `github`, `discord`, `kofi`, `documentation`, `bug-report`, `feature-request`,
`changelog`.

**Siti ammessi** (`HOST_CONSENTITI` in `src/link.js`): `github.com`, `discord.gg`, `discord.com`,
`ko-fi.com`, `mashaup.github.io`. Per tre id l'host è ancora più stretto: `github` solo
`github.com`, `discord` solo `discord.gg`/`discord.com`, `kofi` solo `ko-fi.com`. Il confronto è
esatto: `github.com.altrosito.it` o `evilgithub.com` non passano.

Aggiungere un sito nuovo richiede una versione nuova dell'estensione. È voluto: se qualcuno
modificasse il file remoto, non potrebbe far aprire un sito qualsiasi.

## Precedenza, cache e funzionamento offline

Dalla più debole alla più forte:

1. **`links.json` del pacchetto**: sempre presente, la base affidabile.
2. **L'ultima configurazione remota valida** (in `chrome.storage.local`, chiave `vrLinks`),
   voce per voce, solo se:
   - viene dallo stesso repository impostato per gli aggiornamenti;
   - la sua `revision` non è minore di quella del pacchetto (dopo un aggiornamento
     dell'estensione una cache vecchia non vince sul file nuovo);
   - «Aggiorna i link del progetto» è acceso (Impostazioni › Avanzate; acceso di default).

Una voce remota sostituisce quella con lo stesso id, può spegnerla o aggiungerne una nuova, ma non
può cancellare una voce del pacchetto.

| Quando | Cosa succede |
|---|---|
| Apri il popup o la dashboard | i link compaiono subito da pacchetto + cache, senza aspettare la rete |
| Ultimo aggiornamento riuscito più di 12 ore fa | parte una richiesta in background; se riesce, i link si aggiornano sulla pagina aperta |
| «Cerca aggiornamento» | rinnova anche i link, al massimo una volta al minuto |
| Richiesta fallita (offline, 404, 5xx, timeout di 8 s, JSON rotto, schema nuovo) | la cache **non** si tocca; nuovo tentativo non prima di un'ora; una riga discreta in Salute, nessuna notifica |
| `links.json` del pacchetto illeggibile | i link restano nascosti; tutto il resto funziona |
| Due pagine aperte insieme | il tentativo si segna prima della richiesta: parte una richiesta sola |

Il service worker non è coinvolto: la richiesta parte dalla pagina aperta e lo stato vive in
`storage.local`, quindi un service worker sospeso o riavviato non cambia niente.

## Procedure

### Aggiornare l'invito Discord senza una nuova versione

1. Su GitHub apri `links.json` nel ramo `main` › matita (Modifica).
2. Sostituisci `links.discord.url` con il nuovo invito (`https://discord.gg/…`).
3. Aumenta `revision` di 1.
4. Facoltativo ma consigliato: aggiorna anche il link nel `README.md` (il README è una pagina
   statica e non legge il JSON).
5. Commit. Gli utenti vedono il nuovo invito entro 12 ore, o subito premendo «Cerca
   aggiornamento» in Salute.

Prima del commit, se hai il repository in locale: `node tests/valida-link.js`.

### Spegnere un link

Metti `"enabled": false` e aumenta `revision`. L'elemento sparisce dal popup e dalla dashboard
(niente link vuoti o grigi).

### Aggiungere un link

- **Su un sito già ammesso** (per esempio una pagina su `github.com`): aggiungi la voce con un id
  nuovo, `label` e `description`. Compare da solo in fondo all'elenco di Salute › Progetto e
  community, con un'icona generica; non serve toccare l'interfaccia.
- **Con un'icona sua o in un punto preciso** (piede del popup): serve una versione nuova. L'icona
  si aggiunge in `ICONE` di `src/link-chrome.js`, il punto con `<a data-link="id" hidden>`.
- **Su un sito nuovo**: aggiungi l'host a `HOST_CONSENTITI` in `src/link.js` e pubblica una
  versione nuova.

### Validare una configurazione

```
node tests/valida-link.js            # il links.json del repository
node tests/valida-link.js altro.json # un file qualsiasi
```

Usa le stesse regole dell'estensione: dice cosa è acceso, cosa è spento e cosa verrebbe scartato,
ed esce con errore se qualcosa non va.

### Attivare la configurazione remota

Non c'è niente da attivare oltre a **pubblicare `links.json` nella radice del ramo `main`** del
repository pubblico `MashaUP/Vinted_Relist` (è già nella cartella del rilascio). Finché il file
non c'è, l'estensione riceve 404, usa i link del pacchetto e in Salute scrive «file non ancora
pubblicato sul repository».

### Redirect stabile (facoltativo, non attivo)

Se un giorno vuoi un indirizzo fisso per Discord indipendente dal JSON:

1. Crea il repository `MashaUP/mashaup.github.io` e attiva GitHub Pages.
2. Aggiungi `discord/index.html` con un redirect (`<meta http-equiv="refresh" content="0; url=https://discord.gg/…">`).
3. In `links.json` metti `"url": "https://mashaup.github.io/discord/"` per `discord`… ma **non
   funzionerebbe**: per l'id `discord` sono ammessi solo `discord.gg` e `discord.com`. Usalo per un
   id nuovo (es. `community`) o allarga `HOST_PER_ID.discord` in una versione nuova.

Oggi non conviene: il JSON fa già lo stesso lavoro senza un servizio in più.

## Riusare il sistema in un altro progetto

| Pezzo | File | Dipende da |
|---|---|---|
| Formato | `links.json` | niente |
| Validazione e precedenza | `src/link.js` | niente (Node e browser, UMD) |
| Adattatore per estensioni Chrome | `src/link-chrome.js` | `link.js`, `chrome.storage.local`, `fetch` |

**Un'altra estensione Chrome** (per esempio Keep_Watching):

1. Copia `src/link.js`, `src/link-chrome.js` e crea il suo `links.json` con `"project"` proprio.
2. In `link.js` cambia `PROGETTO` e, se serve, `HOST_CONSENTITI`/`HOST_PER_ID` (oppure passali
   come opzioni a `valida()`).
3. In `link-chrome.js` la funzione `repo()` legge `updateRepo` e `Versione.REPO`: sostituiscila con
   il repository del progetto.
4. Carica i due script nella pagina e chiama `LinkChrome.avvia(document)`. Nell'HTML:
   `<a data-link="discord" hidden>…</a>`, oppure un contenitore `<div data-link-elenco hidden>`.

**Un'app web o desktop**: `link.js` funziona così com'è (`require` o `<script>`); scrivi un
adattatore di poche righe con `localStorage` o un file al posto di `chrome.storage`, e la stessa
logica: mostra pacchetto + cache, poi rinnova ogni 12 ore.

**Libreria condivisa**: non ancora. Ha senso estrarre un pacchetto comune quando un secondo
progetto lo usa davvero; prima sarebbe solo un'astrazione da mantenere.

## Accorgimenti per Manifest V3

- **Permessi**: nessuno in più. Le pagine dell'estensione possono chiedere `api.github.com` perché
  risponde con `Access-Control-Allow-Origin: *`; `host_permissions` per GitHub non servono.
- **CSP**: quella predefinita (`script-src 'self'`) va bene: niente script remoti, niente `eval`.
- **Niente codice remoto**: il JSON non può contenere funzioni, HTML o istruzioni; i testi vanno in
  `textContent`, gli indirizzi passano dalla validazione prima di diventare `href`.
- **Richieste**: `credentials: "omit"` (nessun cookie), `cache: "no-store"`, nessun dato
  dell'utente nella richiesta; IP e user agent li vede GitHub come per ogni pagina web.
- **Service worker**: non serve; se in futuro i link servissero alle notifiche, il service worker
  può leggere la stessa chiave `vrLinks`.
- **Chrome Web Store**: una configurazione che cambia solo dati dichiarativi è ammessa; cambiare
  comportamento con dati remoti no. Qui il remoto non può attivare funzioni né cambiare permessi.

## Rischi residui

- **Account GitHub compromesso**: chi modifica `links.json` può puntare i link a un altro
  repository, a un altro server Discord o a un'altra pagina Ko-fi. Non può far aprire siti fuori
  elenco né eseguire codice. Mitigazione: autenticazione a due fattori sull'account.
- **Limite dell'API di GitHub** (60 richieste l'ora per IP, condiviso con il controllo
  aggiornamenti): con una richiesta ogni 12 ore non pesa; se scatta, restano i link in cache.
- **Console**: quando GitHub risponde con un errore (per esempio 404 finché il file non è
  pubblicato) Chrome scrive «Failed to load resource» nella console della pagina. Non è un errore
  del codice e non si può silenziare da JavaScript; capita al massimo una volta l'ora.
- **Invito Discord**: non verificabile automaticamente da qui. Se scade, il link porta a un invito
  non valido finché non aggiorni il JSON.
