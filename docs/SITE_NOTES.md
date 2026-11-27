# Osservazioni sul sito di Vinted

Cosa si sa della struttura di Vinted che l'estensione usa, con la data e la fonte. **Misurato** =
visto sul sito vero; **dedotto** = da codice di terzi o da ipotesi, da confermare. Quando Vinted
cambia qualcosa, aggiungere una riga qui e nel CHANGELOG.

| Data | Cosa | Stato | Fonte |
|---|---|---|---|
| 2026-10 | `GET /api/v2/item_upload/items/:id` e `POST /api/v2/photos`, forma della bozza | misurato | sviluppo 2.0–2.4 |
| 2026-11 | Id dell'account nel cookie `v_uid` (HttpOnly) | misurato | sviluppo 2.3 |
| 2026-11-20 | `raw.githubusercontent.com` risponde con `Access-Control-Allow-Origin: *`; il redirect di `github.com/…/raw/HEAD` no | misurato | `curl` (2.7.0) |
| 2026-11-25 | Su vinted.fr, profilo e cookie `v_uid` visti ma nessun token CSRF nelle richieste viste dal service worker | misurato da un utente | diagnostica della segnalazione (2.7.0) |
| 2026-11-27 | Token CSRF nei dati di Next.js negli `<script>`, con virgolette precedute da `\`: `\"CSRF_TOKEN\":\"<uuid>\"` | dedotto | `Vintrack-Vinted-Monitor` (`client.go`, espressione `CSRF_TOKEN\\?":\s*\\?"…`), `vinted_scraper` (marcatore `CSRF_TOKEN`, valore UUID) |
| 2026-11-27 | `/items/new` di chi non è connesso rimanda a una pagina d'accesso o registrazione (`/member/signup/…`) | dedotto | ipotesi, usata solo per scegliere il messaggio |

## Da misurare

Sulla pagina del proprio armadio, da loggati, nella console (F12) — non mostra il token:

```js
(() => { const h = document.documentElement.innerHTML; return { meta: !!document.querySelector('meta[name="csrf-token"]'), nextData: !!document.getElementById('__NEXT_DATA__'), conBarra: /CSRF_TOKEN\\+":\\+"[^"\\]{16,}/.test(h), senzaBarra: /"CSRF_TOKEN"\s*:\s*"[^"\\]{16,}"/.test(h) }; })()
```
