# Sicurezza e dati

Vinted Relist è un'estensione MV3 che lavora solo nel tuo browser. Questo documento dice quali dati
tratta, dove restano, cosa non fa mai e come segnalare un problema di sicurezza.

## Dati che tratta

| Dato | Da dove arriva | Dove resta |
|---|---|---|
| Token di sessione di Vinted (CSRF, anon-id) | letti dal service worker nelle richieste che il browser fa a Vinted, oppure dalla pagina di Vinted aperta | `chrome.storage.session`, per sito: si svuota alla chiusura del browser; ogni scheda riceve solo quelli del proprio sito |
| Id del tuo account Vinted | cookie `v_uid` (o `sub` del token `access_token_web` / `refresh_token_web`), letto dal service worker | `chrome.storage.local`, solo l'id; il valore dei cookie non si salva mai |
| Annunci (titolo, descrizione, prezzo, campi, miniature, statistiche) | API di Vinted, con la tua sessione | `chrome.storage.local`: inventario, storico, bozze, coda, confronti prima/dopo |
| Foto | CDN di Vinted (`*.vinted.net`), o lo ZIP di Vintory che scegli tu | in memoria durante la pubblicazione; quelle di Vintory in IndexedDB (`vintoryImport`) finché servono |
| Impostazioni, lingua, notifiche, errori tecnici | l'estensione | `chrome.storage.local` |

Niente lascia il browser se non verso Vinted (le stesse chiamate che fa il sito, con la tua
sessione) e verso GitHub (`raw.githubusercontent.com`, senza cookie né dati tuoi): `version.json`
per gli aggiornamenti, `links.json` per i link del progetto (si spegne in Impostazioni ›
Avanzate) e lo zip della versione nuova quando premi «Scarica lo zip».

## Cosa non fa mai

- Nessuna telemetria, nessun server dell'autore, nessun dato inviato a terzi.
- Nessun codice scaricato ed eseguito: gira solo quello che c'è nella cartella installata. Lo zip
  degli aggiornamenti si salva solo se il suo SHA-256 coincide con quello di `version.json`, e lo
  installi tu.
- Non esporta né mostra cookie, token o password: il report diagnostico ha un elenco chiuso di
  impostazioni, toglie id, indirizzi, email e token, e lo vedi prima di copiarlo.
- Non agisce sugli annunci di altri: i bottoni compaiono solo nel tuo armadio e ogni
  pubblicazione ricontrolla il proprietario.
- Non aggira le protezioni di Vinted: davanti a 403, 429 o CAPTCHA rallenta e si ferma; non altera
  le foto per eludere i controlli di somiglianza.
- Non ripete da sola un'operazione dall'esito incerto: diventa «da verificare».

## Permessi

`storage`, `webRequest` (leggere token, account e formati dalle richieste di Vinted), `alarms`,
`notifications`, `idle`, `downloads` e i siti `vinted.*` / `*.vinted.net`. Nessun permesso su
GitHub: `raw.githubusercontent.com` consente le richieste dalle pagine dell'estensione. Il
dettaglio è nel [README](README.md#privacy-e-permessi).

## Segnalare un problema di sicurezza

Non aprire una issue pubblica per una vulnerabilità. Scrivi in privato all'autore su
[Discord](https://discord.gg/EPsbQCuAkx) oppure usa **Security › Report a vulnerability** sul
repository GitHub, se è attivo. Indica versione, browser e i passi per riprodurre il problema.

**Non mandare mai** cookie, token, password o il contenuto di `chrome.storage`: il report
diagnostico del popup (Salute › Prepara diagnostica) basta e non contiene segreti.

Si corregge l'ultima versione pubblicata; le correzioni escono come versione PATCH con il
CHANGELOG che spiega sintomo, causa e correzione.
