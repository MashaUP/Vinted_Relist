/**
 * Service worker.
 * Due compiti:
 *  1. Intercetta gli header che Vinted stesso manda alle sue API e memorizza
 *     x-csrf-token / x-anon-id. E' il modo piu' affidabile per avere token validi.
 *  2. Scarica le foto dal CDN (images*.vinted.net) senza incappare nel CORS:
 *     una fetch dal service worker con host_permissions non e' soggetta a CORS.
 */

const TOKEN_KEY = "vrTokens";

/**
 * Vinted ha un dominio per paese e il codice usa gia' location.origin lato
 * pagina; qui servono invece pattern espliciti, perche' il carattere jolly
 * sul dominio di primo livello non e' ammesso.
 * Questo elenco deve restare allineato a host_permissions nel manifest.
 */
const DOMINI = ["it","fr","es","de","co.uk","com","be","nl","at","pt","pl","cz","sk","lt","lu","ro","hu"];
const SITI = DOMINI.map((d) => `https://www.vinted.${d}/*`);
const apiDi = (coda) => DOMINI.map((d) => `https://www.vinted.${d}/api/${coda}`);

// ---------------------------------------------------------------- token sniff

/** v_uid dal cookie; in mancanza, il "sub" del token di accesso (stesso valore). */
function idDaCookie(cookie) {
  if (!cookie) return null;
  const diretto = cookie.match(/(?:^|;\s*)v_uid=(\d+)/);
  if (diretto) return diretto[1];

  const token = cookie.match(/(?:^|;\s*)access_token_web=[^.;]+\.([^.;]+)\./);
  if (!token) return null;
  try {
    const base64 = token[1].replace(/-/g, "+").replace(/_/g, "/");
    const sub = JSON.parse(atob(base64 + "===".slice((base64.length + 3) % 4)))?.sub;
    return /^\d+$/.test(String(sub)) ? String(sub) : null;
  } catch {
    return null;
  }
}

let ultimoUtente = null;

/** Scrive solo quando cambia: questo listener scatta su ogni chiamata API. */
function ricordaUtente(userId, url) {
  const origine = new URL(url).origin;
  const chiave = `${userId}@${origine}`;
  if (chiave === ultimoUtente) return;
  ultimoUtente = chiave;
  chrome.storage.local.set({ userId, vintedOrigin: origine });
}

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    let csrf = null;
    let anonId = null;
    let cookie = null;

    for (const header of details.requestHeaders || []) {
      const name = header.name.toLowerCase();
      if (name === "x-csrf-token" && header.value) csrf = header.value;
      if (name === "x-anon-id" && header.value) anonId = header.value;
      if (name === "cookie" && header.value) cookie = header.value;
    }

    // Il tuo id utente sta nel cookie v_uid, che e' HttpOnly: la pagina non lo
    // vede, il service worker si'. Senza, "Apri il tuo armadio" non sa dove andare.
    const userId = idDaCookie(cookie);
    if (userId) ricordaUtente(userId, details.url);

    if (!csrf && !anonId) return;

    chrome.storage.session.get(TOKEN_KEY).then((stored) => {
      const previous = stored[TOKEN_KEY] || {};
      chrome.storage.session.set({
        [TOKEN_KEY]: {
          csrf: csrf || previous.csrf || null,
          anonId: anonId || previous.anonId || null,
          at: Date.now(),
        },
      });
    });
  },
  { urls: apiDi("*") },
  ["requestHeaders", "extraHeaders"]
);

// ------------------------------------------------- apprendimento del formato

/**
 * Chrome ci consegna i nomi dei campi di un multipart in requestBody.formData
 * (il contenuto del file no, solo il nome del campo). Guardando l'upload che fa
 * Vinted stessa impariamo il formato esatto, invece di indovinarlo.
 */
let ourUploadsInFlight = 0;

function analyzePhotoForm(formData) {
  const entries = Object.entries(formData).map(([key, values]) => [
    key,
    Array.isArray(values) ? values[0] : values,
  ]);
  if (!entries.length) return null;

  const fileField =
    entries.find(([key]) => /file/i.test(key))?.[0] ||
    entries.find(([, value]) => value === "" || value == null)?.[0];
  if (!fileField) return null;

  const uuidField = entries.find(([key]) => /uuid/i.test(key))?.[0] || null;

  const constants = {};
  for (const [key, value] of entries) {
    if (key === fileField || key === uuidField) continue;
    constants[key] = value;
  }
  return { fileField, uuidField, constants, at: Date.now() };
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (ourUploadsInFlight > 0) return;          // non imparare da noi stessi

    const format = analyzePhotoForm(details.requestBody?.formData || null);
    if (!format) return;

    chrome.storage.local.set({ photoFormat: format });
    console.log("[Relist] formato upload imparato:", format);
  },
  { urls: apiDi("v2/photos"), types: ["xmlhttprequest"] },
  ["requestBody"]
);

/**
 * Stessa idea per l'annuncio: quando salvi una modifica o pubblichi a mano,
 * leggiamo quali campi contiene davvero il payload. Il GET di lettura ne
 * restituisce molti altri che il POST non accetta.
 */
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (ourUploadsInFlight > 0) return;
    if (details.method !== "POST" && details.method !== "PUT") return;

    const bytes = details.requestBody?.raw?.[0]?.bytes;
    if (!bytes) return;

    try {
      const body = JSON.parse(new TextDecoder().decode(bytes));
      const fields = body?.item ? Object.keys(body.item) : null;
      if (!fields?.length) return;

      chrome.storage.local.set({
        itemFormat: { fields, envelope: Object.keys(body), sample: body.item, at: Date.now() },
      });
      ricordaFormatoCategoria(body.item, fields);
      console.log("[Relist] formato annuncio imparato:", fields);
    } catch {
      // non era JSON: ignora
    }
  },
  { urls: apiDi("v2/item_upload/items*") },
  ["requestBody"]
);

/**
 * Lo stesso formato, separato per categoria. Un libro e una giacca non mandano
 * gli stessi campi: confrontare l'uno con il formato dell'altro dava falsi
 * allarmi (is_unisex sui libri). Si salvano solo i NOMI dei campi e quali
 * erano vuoti (null, false, "", [] o {}), non il contenuto dell'annuncio.
 * Stessa regola di valoreNeutro in src/editor-logica.js.
 */
const MAX_FORMATI_CATEGORIA = 40;
const neutro = (v) =>
  v == null || v === false || v === "" ||
  (Array.isArray(v) ? v.length === 0 : typeof v === "object" && Object.keys(v).length === 0);

async function ricordaFormatoCategoria(item, fields) {
  if (item?.catalog_id == null) return;
  const { itemFormats = {} } = await chrome.storage.local.get("itemFormats");
  itemFormats[String(item.catalog_id)] = {
    campi: fields,
    neutri: fields.filter((campo) => neutro(item[campo])),
    at: Date.now(),
  };
  const voci = Object.entries(itemFormats).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_FORMATI_CATEGORIA);
  await chrome.storage.local.set({ itemFormats: Object.fromEntries(voci) });
}

// ---------------------------------------------------------------- photo fetch

async function downloadAsDataUrl(url) {
  // Solo foto del CDN di Vinted: il service worker non deve diventare un proxy per altri siti.
  if (!/^https:\/\/[a-z0-9.-]*vinted\.(net|com)\//i.test(String(url))) {
    throw new Error("Indirizzo della foto non riconosciuto.");
  }
  const response = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error("Download foto fallito (HTTP " + response.status + ")");

  const buffer = await response.arrayBuffer();
  const mime = response.headers.get("content-type") || "image/jpeg";
  const bytes = new Uint8Array(buffer);

  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }

  return { dataUrl: "data:" + mime + ";base64," + btoa(binary), mime };
}

// ------------------------------------------------------------- download foto

/**
 * Le foto arrivano dalla pagina come data URL e qui diventano file nella
 * cartella "Vinted Relist" dei download. Il messaggio e' trattato come dato non
 * attendibile: solo immagini, solo nomi semplici, mai percorsi.
 */
const DOWNLOAD_ATTESI = new Map();

chrome.downloads?.onChanged.addListener((delta) => {
  const attesa = DOWNLOAD_ATTESI.get(delta.id);
  if (!attesa) return;
  if (delta.state?.current === "complete") attesa({ ok: true });
  else if (delta.state?.current === "interrupted") {
    attesa({ ok: false, error: `interrotto (${delta.error?.current || "motivo sconosciuto"})` });
  }
});

async function scaricaFile(url, nome) {
  if (!/^data:image\/(jpeg|png|webp|gif|avif);base64,/.test(String(url))) {
    return { ok: false, error: "contenuto non valido" };
  }
  if (!/^[A-Za-z0-9_-]{1,80}\.(jpg|png|webp|gif|avif)$/.test(String(nome))) {
    return { ok: false, error: "nome file non valido" };
  }

  const id = await chrome.downloads.download({
    url,
    filename: `Vinted Relist/${nome}`,
    conflictAction: "uniquify",
    saveAs: false,
  });
  if (id == null) return { ok: false, error: "il browser ha rifiutato il download" };

  const esito = await new Promise((risolvi) => {
    const fine = setTimeout(() => risolvi({ ok: true, lento: true }), 120000);
    DOWNLOAD_ATTESI.set(id, (r) => { clearTimeout(fine); risolvi(r); });
  });
  DOWNLOAD_ATTESI.delete(id);

  const [voce] = await chrome.downloads.search({ id });
  const finale = voce?.filename ? voce.filename.split(/[\\/]/).pop() : nome;
  return { ...esito, nome: finale };
}

// ---------------------------------------------------------------- messaggi

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "vr:queueStart") {
    avviaCoda(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "vr:queueRetry") {
    riprovaFalliti(message.queue ?? null)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "vr:queueResolve") {
    risolviDaVerificare(message.itemId, Boolean(message.pubblicato), message.queue ?? null)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "vr:queueProgress") {
    leggiCoda().then((coda) => {
      const corrente = coda?.items?.[coda.index];
      if (!coda?.running || String(corrente?.id) !== String(message.itemId)) return;
      coda.step = String(message.step || "").slice(0, 80);
      return scriviCoda(coda);
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "vr:event") {
    registraEvento(message.evento || {}).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "vr:openPage") {
    // solo pagine nostre, mai indirizzi esterni
    const pagina = String(message.pagina || "");
    if (/^src\/(dashboard|popup)\.html(#[\w-]*)?$/.test(pagina)) apriPagina(pagina);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "vr:eventsRead") {
    segnaEventiLetti().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "vr:download") {
    scaricaFile(message.url, message.nome)
      .then(sendResponse)
      .catch((errore) => sendResponse({ ok: false, error: String(errore?.message || errore) }));
    return true;
  }

  if (message?.type === "vr:queuePause") {
    pausaCoda().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "vr:queueResume") {
    riprendiCoda().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "vr:queueRecover") {
    riprendiDaRecupero().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "vr:queueSkip") {
    saltaCorrente().then(() => sendResponse({ ok: true }));
    return true;
  }

  /**
   * Registro delle ripubblicazioni riuscite, singole e in coda.
   * Serve a mostrarti quante ne hai fatte: ripubblicare troppo spesso rende
   * meno che non farlo, e un numero in chiaro vale piu' di un avvertimento.
   */
  if (message?.type === "vr:relistLogged") {
    const limite = Date.now() - 30 * 24 * 3600 * 1000;
    chrome.storage.local.get("vrHistory").then(({ vrHistory }) => {
      const storia = (vrHistory || []).filter((voce) => voce.at > limite);
      storia.push({ at: Date.now(), id: String(message.itemId) });
      return chrome.storage.local.set({ vrHistory: storia });
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "vr:queueStop") {
    fermaCoda("Interrotta.")
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "vr:relistDone") {
    esitoCoda(message.itemId, message.ok, message.error, message.blocked, message.outcome)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "vr:uploading") {
    ourUploadsInFlight = Math.max(0, ourUploadsInFlight + (message.value ? 1 : -1));
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "vr:getTokens") {
    chrome.storage.session
      .get(TOKEN_KEY)
      .then((stored) => sendResponse({ ok: true, tokens: stored[TOKEN_KEY] || {} }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "vr:fetchImage") {
    downloadAsDataUrl(message.url)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  return false;
});

// ---------------------------------------------------- coda di ripubblicazione

/**
 * La coda vive qui, non nella pagina: un intervallo di 20 minuti dura ore e un
 * timer nel content script morirebbe alla prima navigazione. chrome.alarms
 * sopravvive anche alla terminazione del service worker.
 *
 * Il lavoro vero lo fa comunque la scheda Vinted: qui decidiamo solo "quando" e
 * mandiamo un messaggio. Il content script risponde subito e riferisce l'esito
 * a cose fatte, cosi' nessuno resta appeso a una richiesta lunga.
 */
const QUEUE_KEY = "vrQueue";
const ALARM_NEXT = "vr:queueNext";
const ALARM_WATCHDOG = "vr:queueWatchdog";
const WATCHDOG_MIN = 6;          // oltre questo, l'esito dell'articolo e' incerto
const MAX_ATTESE = 60;           // minuti di attesa complessivi: scheda chiusa o utente assente
const RALLENTA = [5, 15, 45];    // minuti di pausa dopo un 429 o un 403, in scala
const JITTER = 0.3;              // ±30% sull'intervallo, per non avere un ritmo a metronomo
const INATTIVO_SEC = 300;        // oltre, consideriamo che tu non sia al computer

const impostazioni = () =>
  chrome.storage.local.get({
    humanRhythm: true,
    notifyOnFinish: true,
    peakOnly: false,
    peakWindows: "12:30-14:00, 19:30-22:30",
    autoRule: false,
    autoRuleDays: 7,
    autoRuleMax: 5,
    queueIntervalMin: 20,
  });

/** "12:30-14:00, 19:30-22:30" → [[750, 840], [1170, 1350]] in minuti dal giorno. */
function leggiFasce(testo) {
  const fasce = [];
  for (const pezzo of String(testo).split(",")) {
    const m = pezzo.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const da = Number(m[1]) * 60 + Number(m[2]);
    const a = Number(m[3]) * 60 + Number(m[4]);
    if (a > da) fasce.push([da, a]);
  }
  return fasce;
}

/**
 * Sposta un orario dentro la prossima fascia di traffico utile.
 * Pubblicare alle quattro del mattino consuma la spinta nel vuoto.
 */
function dentroFascia(quando, fasce) {
  if (!fasce.length) return quando;

  for (let giorno = 0; giorno < 8; giorno++) {
    const base = new Date(quando);
    base.setDate(base.getDate() + giorno);
    const minuti = giorno === 0 ? base.getHours() * 60 + base.getMinutes() : -1;

    for (const [da, a] of fasce) {
      if (giorno === 0 && minuti >= da && minuti < a) return quando;   // gia' dentro
      if (minuti < da) {
        const slot = new Date(base);
        slot.setHours(Math.floor(da / 60), da % 60, 0, 0);
        // qualche minuto di scarto: l'apertura esatta e' un orario sospetto
        return slot.getTime() + Math.floor(Math.random() * 6 * 60_000);
      }
    }
  }
  return quando;
}

const leggiCoda = async () => (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] || null;
const scriviCoda = (coda) => chrome.storage.local.set({ [QUEUE_KEY]: coda });

async function schedulaProssimo(minuti, esatto = false) {
  const { humanRhythm } = await impostazioni();

  // Venti minuti esatti per tre ore sono una firma: nessuna persona e' cosi'
  // regolare. Lo scarto casuale costa niente e toglie il motivo piu' ovvio.
  const scarto = humanRhythm && !esatto ? 1 + (Math.random() * 2 - 1) * JITTER : 1;
  let quando = Date.now() + Math.max(30_000, minuti * 60_000 * scarto);

  const { peakOnly, peakWindows } = await impostazioni();
  if (peakOnly) quando = dentroFascia(quando, leggiFasce(peakWindows));
  const coda = await leggiCoda();
  if (coda) {
    coda.nextAt = quando;
    coda.state = "waiting";
    await scriviCoda(coda);
  }
  chrome.alarms.create(ALARM_NEXT, { when: quando });
}

async function fermaCoda(motivo) {
  const coda = await leggiCoda();
  if (!coda) return;

  // Quello che non e' partito resta annullato, non "in attesa" per sempre.
  for (const voce of coda.items || []) {
    if (voce.status === "pending") voce.status = "cancelled";
  }
  coda.running = false;
  coda.state = "done";
  coda.nextAt = null;
  coda.step = null;
  coda.finishedAt = Date.now();
  if (motivo) coda.note = motivo;
  await scriviCoda(coda);

  chrome.alarms.clear(ALARM_NEXT);
  chrome.alarms.clear(ALARM_WATCHDOG);
  if (!coda.items?.length) return;
  await archiviaCoda(coda);

  const r = riepilogoCoda(coda);
  const problemi = r.error + r.verify;
  const testo =
    (motivo ? `${motivo} ` : "") +
    `${r.done} ripubblicati` +
    (r.error ? `, ${r.error} falliti` : "") +
    (r.verify ? `, ${r.verify} da verificare` : "") +
    (r.skipped ? `, ${r.skipped} saltati` : "") +
    (r.cancelled ? `, ${r.cancelled} annullati` : "") + ".";

  await registraEvento({
    kind: r.verify ? "uncertain" : r.error ? "error" : "end",
    title: problemi ? "Coda finita, con articoli da guardare" : "Coda finita",
    text: testo,
    queue: coda.startedAt,
  });

  const { notifyOnFinish } = await impostazioni();
  if (!notifyOnFinish) return;

  // L'id porta con se' la coda: il clic apre il riepilogo di questa, non una pagina generica.
  chrome.notifications.create(`vr-coda-${coda.startedAt}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: problemi ? "Coda finita, con articoli da guardare" : "Coda finita",
    message: testo,
    contextMessage: "Clic per il riepilogo",
    requireInteraction: problemi > 0,
  });
}

/** Conteggio per stato: la stessa funzione serve a popup, notifica e dashboard. */
function riepilogoCoda(coda) {
  const r = { pending: 0, working: 0, done: 0, error: 0, verify: 0, skipped: 0, cancelled: 0 };
  (coda?.items || []).forEach((voce, i) => {
    const stato = coda.running && i === coda.index && coda.state === "working" ? "working" : voce.status;
    r[stato] = (r[stato] || 0) + 1;
  });
  return r;
}

/**
 * Pausa: se un articolo e' in lavorazione non lo interrompiamo a meta',
 * registriamo l'intenzione e la applichiamo quando arriva il suo esito.
 */
async function pausaCoda() {
  const coda = await leggiCoda();
  if (!coda?.running || coda.state === "paused") return;

  coda.pauseRequested = true;
  if (coda.state === "working") return scriviCoda(coda);

  coda.pausedRemainingMs = Math.max(0, (coda.nextAt || Date.now()) - Date.now());
  coda.state = "paused";
  coda.nextAt = null;
  coda.pauseRequested = false;
  await scriviCoda(coda);

  chrome.alarms.clear(ALARM_NEXT);
  chrome.alarms.clear(ALARM_WATCHDOG);
}

async function riprendiCoda() {
  const coda = await leggiCoda();
  if (!coda?.running || coda.state !== "paused") return;

  // Riprende da dove si era fermata: il tempo gia' atteso non si butta via.
  const quando = Date.now() + (coda.pausedRemainingMs || 0);
  coda.state = "waiting";
  coda.pauseRequested = false;
  coda.pausedRemainingMs = null;
  coda.nextAt = quando;
  await scriviCoda(coda);

  chrome.alarms.create(ALARM_NEXT, { when: quando });
}

/** Salta l'articolo corrente: non ha pubblicato niente, quindi non si aspetta. */
async function saltaCorrente() {
  const coda = await leggiCoda();
  if (!coda?.running) return;

  const corrente = coda.items[coda.index];
  if (corrente) {
    corrente.status = "skipped";
    corrente.error = "saltato a mano";
  }
  const eraInLavorazione = coda.state === "working";
  coda.index += 1;
  coda.backoff = 0;
  coda.note = null;
  await scriviCoda(coda);

  chrome.alarms.clear(ALARM_WATCHDOG);
  if (coda.index >= coda.items.length) return fermaCoda();

  // Se l'articolo saltato e' ancora in volo, non partiamo subito: due
  // ripubblicazioni sovrapposte nella stessa scheda si ostacolano.
  if (eraInLavorazione) return schedulaProssimo(coda.intervalMin);
  return passoCoda();
}

/**
 * Gli alarm non sopravvivono al ricaricamento dell'estensione: la coda restava
 * "running" senza piu' niente che la svegliasse, e l'unica via d'uscita era
 * Interrompi. Al risveglio del service worker controlliamo se la sveglia c'e'
 * ancora; se manca, la coda passa in RECOVERING e aspetta una tua decisione.
 *
 * Il margine serve a non scambiare per guasto il risveglio normale: quando e'
 * l'alarm stesso a svegliarci, risulta gia' consumato.
 */
const MARGINE_RECUPERO_MS = 3 * 60_000;

async function recuperaCoda() {
  const coda = await leggiCoda();
  if (!coda?.running) return;
  if (coda.state === "paused" || coda.state === "recovering") return;

  if (await chrome.alarms.get(ALARM_NEXT)) return;        // sveglia al suo posto

  const ora = Date.now();
  const rotta =
    coda.state === "working"
      ? ora - (coda.startedItemAt || 0) > (WATCHDOG_MIN + 2) * 60_000
      : coda.nextAt > ora + 5_000 || ora - (coda.nextAt || 0) > MARGINE_RECUPERO_MS;

  if (!rotta) return;

  // L'articolo in lavorazione potrebbe essere gia' stato pubblicato prima
  // dell'interruzione: rifarlo alla cieca creerebbe un doppione. Va controllato.
  const corrente = coda.items[coda.index];
  if (coda.state === "working" && corrente) {
    corrente.status = "verify";
    corrente.error = "Interrotto durante la pubblicazione: controlla nell'armadio se è uscito.";
    coda.index += 1;
  }

  coda.state = "recovering";
  coda.nextAt = null;
  coda.note = null;
  await scriviCoda(coda);
  chrome.alarms.clear(ALARM_WATCHDOG);
}

async function riprendiDaRecupero() {
  const coda = await leggiCoda();
  if (coda?.state !== "recovering") return;
  if (coda.index >= coda.items.length) return fermaCoda();

  coda.state = "waiting";
  await scriviCoda(coda);
  return passoCoda();
}

// ------------------------------------------------- avvio, ripresa, verifica

/** Chiave per riconoscere lo stesso avvio arrivato due volte (doppio clic). */
const firmaAvvio = (items) => items.map((i) => i.id).join(",");

async function avviaCoda(message) {
  const items = (message.items || [])
    .filter((item) => item && item.id != null)
    .map((item) => ({
      id: String(item.id),
      title: String(item.title || `Articolo ${item.id}`).slice(0, 120),
      thumb: /^https:\/\/[a-z0-9.-]*vinted\.(net|com)\//i.test(item.thumb || "") ? item.thumb : null,
      status: "pending",
      error: null,
    }));
  // lo stesso articolo due volte nella stessa coda non ha senso
  const visti = new Set();
  const unici = items.filter((i) => !visti.has(i.id) && visti.add(i.id));
  if (!unici.length) return { ok: false, error: "Nessun articolo da mettere in coda." };

  // Doppio clic: la stessa coda e' gia' partita, non si riparte da capo.
  // Una coda diversa in corso invece non si sovrascrive mai.
  const esistente = await leggiCoda();
  if (esistente?.running) {
    if (firmaAvvio(esistente.items) === firmaAvvio(unici)) {
      return { ok: true, duplicato: true, count: unici.length };
    }
    return { ok: false, error: "C'è già una coda in corso: interrompila o aspetta che finisca." };
  }

  const parteA = Number(message.startAt) || 0;
  const programmata = parteA > Date.now() + 1000;

  await scriviCoda({
    items: unici,
    index: 0,
    intervalMin: Math.max(1, Math.min(240, Number(message.intervalMin) || 20)),
    overrides: message.overrides || null,
    running: true,
    state: programmata ? "scheduled" : "waiting",
    startedAt: Date.now(),
    nextAt: programmata ? parteA : Date.now(),
    backoff: 0,
    note: null,
    step: null,
  });

  chrome.alarms.clear(ALARM_WATCHDOG);
  // L'avvio programmato non viene sporcato dallo scarto casuale: alle 20:00 e' alle 20:00.
  if (programmata) await chrome.alarms.create(ALARM_NEXT, { when: parteA });
  else await passoCoda();
  return { ok: true, count: unici.length };
}

/** Rimette in coda solo i falliti dell'ultima coda: mai quelli da verificare. */
async function riprovaFalliti(codaId = null) {
  const coda = await leggiCoda();
  if (coda?.running) return { ok: false, error: "C'è già una coda in corso." };

  // Dalla dashboard si puo' riprovare anche una coda archiviata.
  let origine = coda;
  if (codaId && coda?.startedAt !== Number(codaId)) {
    const { vrQueueArchive = [] } = await chrome.storage.local.get("vrQueueArchive");
    origine = vrQueueArchive.find((q) => q.startedAt === Number(codaId)) || null;
  }
  const falliti = (origine?.items || []).filter((i) => i.status === "error");
  if (!falliti.length) return { ok: false, error: "Nessun articolo fallito da riprovare." };
  return avviaCoda({
    items: falliti.map(({ id, title, thumb }) => ({ id, title, thumb })),
    intervalMin: origine.intervalMin ?? coda?.intervalMin,
    overrides: origine.overrides ?? null,
  });
}

/**
 * Copia compatta delle ultime code concluse. La coda corrente si cancella con
 * "Nascondi" o si sovrascrive con "Riprova i falliti": senza archivio, il clic
 * su una notifica vecchia aprirebbe un riepilogo vuoto.
 */
const MAX_ARCHIVIO = 10;

async function archiviaCoda(coda) {
  const { vrQueueArchive = [] } = await chrome.storage.local.get("vrQueueArchive");
  const compatta = {
    startedAt: coda.startedAt,
    finishedAt: coda.finishedAt || Date.now(),
    note: coda.note || null,
    auto: Boolean(coda.auto),
    // per "Riprova i falliti": gli articoli falliti non hanno ancora ricevuto queste modifiche
    intervalMin: coda.intervalMin,
    overrides: coda.overrides || null,
    items: (coda.items || []).map(({ id, title, status, error, thumb }) =>
      ({ id: String(id), title: title || null, status, error: error || null, thumb: thumb || null })),
  };
  const altre = vrQueueArchive.filter((q) => q.startedAt !== coda.startedAt);
  await chrome.storage.local.set({ vrQueueArchive: [compatta, ...altre].slice(0, MAX_ARCHIVIO) });
}

/** Dopo aver guardato l'armadio: pubblicato davvero oppure no (allora e' riprovabile). */
async function risolviDaVerificare(itemId, pubblicato, codaId = null) {
  const segna = (voce) => {
    voce.status = pubblicato ? "done" : "error";
    voce.error = pubblicato ? null : "Non pubblicato (verificato a mano).";
    voce.resolvedAt = Date.now();
  };
  const cerca = (c) => (!codaId || c?.startedAt === Number(codaId))
    ? c?.items?.find((i) => String(i.id) === String(itemId) && i.status === "verify")
    : null;

  const coda = await leggiCoda();
  const voce = cerca(coda);
  if (voce) {
    segna(voce);
    await scriviCoda(coda);
  }

  const { vrQueueArchive = [] } = await chrome.storage.local.get("vrQueueArchive");
  let cambiato = false;
  for (const c of vrQueueArchive) {
    const v = cerca(c);
    if (v) { segna(v); cambiato = true; }
  }
  if (cambiato) await chrome.storage.local.set({ vrQueueArchive });
}

// ------------------------------------------------- ripubblicazione automatica

const ALARM_SCANSIONE = "vr:autoScan";

/**
 * Accoda da sola gli articoli fermi da troppo tempo.
 * L'inventario lo costruisce la pagina mentre navighi l'armadio: nessun
 * endpoint indovinato, e un articolo che non hai mai aperto non esiste qui.
 * "Anzianita'" vuol dire giorni dall'ultima ripubblicazione nostra, o dal
 * primo avvistamento per quelli che non abbiamo mai toccato.
 */
async function scansione() {
  const { autoRule, autoRuleDays, autoRuleMax, queueIntervalMin } = await impostazioni();
  if (!autoRule) return;

  const coda = await leggiCoda();
  if (coda?.running) return;                       // una coda alla volta

  const dati = await chrome.storage.local.get({ inventory: {}, vrHistory: [] });
  const soglia = Date.now() - autoRuleDays * 86400000;

  const ultimo = {};
  for (const voce of dati.vrHistory) {
    ultimo[voce.id] = Math.max(ultimo[voce.id] || 0, voce.at);
  }

  // Dopo una ripubblicazione l'articolo ha un id nuovo: la data giusta e'
  // relistedAt sull'inventario, lo storico per id serve solo ai vecchi dati.
  const eta = (id, art) => art.relistedAt || ultimo[id] || art.firstSeen || 0;

  const candidati = Object.entries(dati.inventory)
    .filter(([id, art]) => eta(id, art) < soglia)
    .sort((a, b) => eta(a[0], a[1]) - eta(b[0], b[1]))
    .slice(0, Math.max(1, autoRuleMax))
    .map(([id, art]) => ({ id, title: art.title || `Articolo ${id}`, status: "pending", error: null }));

  if (!candidati.length) return;

  await scriviCoda({
    items: candidati,
    index: 0,
    intervalMin: queueIntervalMin,
    overrides: null,
    running: true,
    state: "waiting",
    startedAt: Date.now(),
    nextAt: Date.now(),
    backoff: 0,
    note: "Coda automatica",
    auto: true,
  });
  console.log("[Relist] coda automatica:", candidati.length, "articoli");
  return passoCoda();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_SCANSIONE) scansione();
});

async function programmaScansione() {
  const { autoRule } = await impostazioni();
  if (autoRule) chrome.alarms.create(ALARM_SCANSIONE, { periodInMinutes: 60, delayInMinutes: 5 });
  else chrome.alarms.clear(ALARM_SCANSIONE);
}

chrome.storage.onChanged.addListener((modifiche, area) => {
  if (area === "local" && modifiche.autoRule) programmaScansione();
});

programmaScansione();

chrome.runtime.onStartup.addListener(recuperaCoda);
chrome.runtime.onInstalled.addListener(recuperaCoda);
recuperaCoda();

async function schedaVinted() {
  const tabs = await chrome.tabs.query({ url: SITI });
  return tabs.find((t) => t.status === "complete") || tabs[0] || null;
}

/** Manda in lavorazione l'articolo corrente. */
async function passoCoda() {
  const coda = await leggiCoda();
  if (!coda?.running) return;

  const corrente = coda.items[coda.index];
  if (!corrente) return fermaCoda();

  // Ripubblicato a mano dopo l'avvio della coda: l'id vecchio non esiste piu'.
  const { vrHistory = [] } = await chrome.storage.local.get("vrHistory");
  if (vrHistory.some((v) => String(v.id) === corrente.id && v.at > (coda.startedAt || 0))) {
    corrente.status = "skipped";
    corrente.error = "già ripubblicato a mano";
    coda.index += 1;
    await scriviCoda(coda);
    return coda.index >= coda.items.length ? fermaCoda() : passoCoda();
  }

  const { humanRhythm } = await impostazioni();
  if (humanRhythm) {
    const stato = await chrome.idle.queryState(INATTIVO_SEC);
    if (stato !== "active") {
      // Ripubblicare mentre non c'e' nessuno davanti allo schermo e' il
      // comportamento piu' facile da riconoscere. Aspettiamo che torni.
      coda.waited = (coda.waited || 0) + 2;
      await scriviCoda(coda);
      if (coda.waited > MAX_ATTESE) return fermaCoda("Interrotta: sei stato via troppo.");
      return schedulaProssimo(2, true);
    }
  }

  const tab = await schedaVinted();
  if (!tab) {
    coda.waited = (coda.waited || 0) + 1;
    await scriviCoda(coda);
    if (coda.waited > MAX_ATTESE) {
      return fermaCoda("Interrotta: nessuna scheda Vinted aperta.");
    }
    return schedulaProssimo(1);
  }

  coda.waited = 0;
  coda.state = "working";
  coda.startedItemAt = Date.now();
  await scriviCoda(coda);

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "vr:relistOne",
      itemId: corrente.id,
      overrides: coda.overrides || {},
    });
    chrome.alarms.create(ALARM_WATCHDOG, { delayInMinutes: WATCHDOG_MIN });
  } catch {
    // content script non pronto: riprovo fra un minuto senza consumare l'articolo
    coda.state = "waiting";
    await scriviCoda(coda);
    schedulaProssimo(1);
  }
}

/** Registra l'esito e programma il successivo. */
async function esitoCoda(itemId, ok, error, blocked = false, outcome = null) {
  const coda = await leggiCoda();
  if (!coda?.running) return;

  const corrente = coda.items[coda.index];
  if (!corrente || String(corrente.id) !== String(itemId)) return;   // esito fuori tempo

  // Un blocco non e' colpa dell'articolo: non lo consumiamo, rallentiamo.
  // Continuare a bussare dopo un 429 e' il modo migliore per peggiorare.
  if (blocked) {
    chrome.alarms.clear(ALARM_WATCHDOG);
    const passo = coda.backoff || 0;

    if (passo >= RALLENTA.length) {
      return fermaCoda(`Interrotta: Vinted continua a bloccare. ${error || ""}`.trim());
    }
    coda.backoff = passo + 1;
    coda.note = `In pausa ${RALLENTA[passo]} min: ${error || "richiesta bloccata"}`;
    await scriviCoda(coda);
    return schedulaProssimo(RALLENTA[passo], true);
  }

  coda.backoff = 0;
  coda.note = null;
  coda.step = null;
  // incerto e parziale non sono fallimenti: potrebbe esserci gia' un annuncio
  // nuovo, e riprovarli alla cieca lo duplicherebbe.
  const stato = ok ? "done"
    : outcome === "uncertain" || outcome === "partial" ? "verify"
    : outcome === "skipped" ? "skipped"
    : "error";
  corrente.status = stato;
  corrente.error = ok ? null : error || "errore sconosciuto";
  coda.index += 1;
  await scriviCoda(coda);

  if (stato === "error" || stato === "verify") {
    await registraEvento({
      kind: stato === "verify" ? "uncertain" : "error",
      title: stato === "verify" ? `Da verificare: ${corrente.title}` : `Non riuscito: ${corrente.title}`,
      text: corrente.error,
      itemId: corrente.id,
      queue: coda.startedAt,
    });
  }

  chrome.alarms.clear(ALARM_WATCHDOG);

  if (coda.index >= coda.items.length) return fermaCoda();

  if (coda.pauseRequested) {
    coda.pauseRequested = false;
    coda.state = "paused";
    coda.pausedRemainingMs = coda.intervalMin * 60_000;
    coda.nextAt = null;
    await scriviCoda(coda);
    return;
  }

  schedulaProssimo(coda.intervalMin);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NEXT) return passoCoda();

  if (alarm.name === ALARM_WATCHDOG) {
    const coda = await leggiCoda();
    if (coda?.running && coda.state === "working") {
      await esitoCoda(
        coda.items[coda.index]?.id,
        false,
        `Nessuna risposta dalla scheda in ${WATCHDOG_MIN} minuti: potrebbe essere stato pubblicato, controlla l'armadio.`,
        false,
        "uncertain"
      );
    }
  }
});

// ---------------------------------------------------------------- centro eventi

/**
 * Un solo registro per tutto quello che merita di restare dopo che un toast e'
 * sparito: fine coda, articoli falliti o incerti, aggiornamenti. Il popup lo
 * mostra in Notifiche; il badge sull'icona conta quelli importanti non letti.
 * Mai token, cookie o id utente qui dentro.
 */
const MAX_EVENTI = 150;
const TIPI_EVENTO = new Set(["ok", "info", "warn", "end", "error", "uncertain"]);

async function registraEvento(e) {
  const { vrEvents = [] } = await chrome.storage.local.get("vrEvents");
  const voce = {
    id: crypto.randomUUID(),
    at: Date.now(),
    kind: TIPI_EVENTO.has(e.kind) ? e.kind : "info",
    title: String(e.title || "").slice(0, 140),
    text: String(e.text || "").slice(0, 400),
    itemId: e.itemId != null ? String(e.itemId).replace(/\D/g, "").slice(0, 20) || null : null,
    queue: Number(e.queue) || null,
    read: false,
  };
  // lo stesso evento due volte in un minuto e' un doppione, non una notizia
  if (vrEvents.some((v) => v.title === voce.title && v.text === voce.text && voce.at - v.at < 60_000)) return;

  vrEvents.unshift(voce);
  await chrome.storage.local.set({ vrEvents: vrEvents.slice(0, MAX_EVENTI) });
  await aggiornaBadge();
}

async function segnaEventiLetti() {
  const { vrEvents = [] } = await chrome.storage.local.get("vrEvents");
  vrEvents.forEach((v) => (v.read = true));
  await chrome.storage.local.set({ vrEvents });
  await aggiornaBadge();
}

async function aggiornaBadge() {
  const { vrEvents = [] } = await chrome.storage.local.get("vrEvents");
  const n = vrEvents.filter((v) => !v.read && (v.kind === "error" || v.kind === "uncertain")).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#d93b3b" });
  await chrome.action.setBadgeText({ text: n ? String(Math.min(n, 99)) : "" });
}

// ------------------------------------------------------------ pagine e notifiche

/** Apre una pagina dell'estensione riusando la scheda se c'e' gia'. */
async function apriPagina(percorso) {
  const url = chrome.runtime.getURL(percorso);
  const base = url.split("#")[0];
  try {
    const contesti = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
    const esistente = contesti.find((c) => String(c.documentUrl || "").split("#")[0] === base);
    if (esistente?.tabId >= 0) {
      const scheda = await chrome.tabs.update(esistente.tabId, { active: true, url });
      if (scheda?.windowId != null) await chrome.windows.update(scheda.windowId, { focused: true });
      return;
    }
  } catch {
    // getContexts non disponibile: si apre una scheda nuova
  }
  await chrome.tabs.create({ url });
}

chrome.notifications.onClicked.addListener(async (id) => {
  if (id.startsWith("vr-coda-")) await apriPagina(`src/dashboard.html#coda-${id.slice(8)}`);
  chrome.notifications.clear(id);
});

// ----------------------------------------------------------------- versioni

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  const attuale = chrome.runtime.getManifest().version;
  if (reason === "update" && previousVersion && previousVersion !== attuale) {
    await registraEvento({
      kind: "ok",
      title: `Aggiornata alla ${attuale}`,
      text: `Prima avevi la ${previousVersion}. Le novità sono nel popup, Salute › Versione.`,
    });
  }
  await aggiornaBadge();
});
