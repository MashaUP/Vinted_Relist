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
      console.log("[Relist] formato annuncio imparato:", fields);
    } catch {
      // non era JSON: ignora
    }
  },
  { urls: apiDi("v2/item_upload/items*") },
  ["requestBody"]
);

// ---------------------------------------------------------------- photo fetch

async function downloadAsDataUrl(url) {
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

// ---------------------------------------------------------------- messaggi

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "vr:queueStart") {
    const items = (message.items || []).map((item) => ({
      id: String(item.id),
      title: item.title || `Articolo ${item.id}`,
      status: "pending",
      error: null,
    }));

    const parteA = Number(message.startAt) || 0;
    let programmata = parteA > Date.now() + 1000;

    const inizio = programmata ? parteA : Date.now();

    scriviCoda({
      items,
      index: 0,
      intervalMin: Math.max(1, Number(message.intervalMin) || 20),
      overrides: message.overrides || null,
      running: items.length > 0,
      state: programmata ? "scheduled" : "waiting",
      startedAt: Date.now(),
      nextAt: programmata ? parteA : Date.now(),
      backoff: 0,
      note: null,
    })
      .then(() => {
        chrome.alarms.clear(ALARM_WATCHDOG);
        // L'avvio programmato e' l'unico momento che non va sporcato dallo
        // scarto casuale: se chiedi le 20:00, parte alle 20:00.
        if (programmata) return chrome.alarms.create(ALARM_NEXT, { when: parteA });
        return passoCoda();
      })
      .then(() => sendResponse({ ok: true, count: items.length }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
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
    esitoCoda(message.itemId, message.ok, message.error, message.blocked)
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
const WATCHDOG_MIN = 6;          // oltre questo, l'articolo e' considerato fallito
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

  coda.running = false;
  coda.state = "done";
  coda.nextAt = null;
  coda.finishedAt = Date.now();
  if (motivo) coda.note = motivo;
  await scriviCoda(coda);

  chrome.alarms.clear(ALARM_NEXT);
  chrome.alarms.clear(ALARM_WATCHDOG);

  const { notifyOnFinish } = await impostazioni();
  if (!notifyOnFinish || !coda.items?.length) return;

  const fatti = coda.items.filter((i) => i.status === "done").length;
  const falliti = coda.items.filter((i) => i.status === "error").length;
  const saltati = coda.items.filter((i) => i.status === "skipped").length;

  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: falliti ? "Coda finita con errori" : "Coda finita",
    message:
      (motivo ? `${motivo} ` : "") +
      `${fatti} ripubblicati${falliti ? `, ${falliti} falliti` : ""}` +
      `${saltati ? `, ${saltati} saltati` : ""}.`,
  });
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

  // L'articolo in lavorazione non e' mai arrivato in fondo: torna da fare.
  const corrente = coda.items[coda.index];
  if (coda.state === "working" && corrente) corrente.status = "pending";

  coda.state = "recovering";
  coda.nextAt = null;
  coda.note = null;
  await scriviCoda(coda);
  chrome.alarms.clear(ALARM_WATCHDOG);
}

async function riprendiDaRecupero() {
  const coda = await leggiCoda();
  if (coda?.state !== "recovering") return;

  coda.state = "waiting";
  await scriviCoda(coda);
  return passoCoda();
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
async function esitoCoda(itemId, ok, error, blocked = false) {
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
  corrente.status = ok ? "done" : "error";
  corrente.error = ok ? null : error || "errore sconosciuto";
  coda.index += 1;
  await scriviCoda(coda);

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
      await esitoCoda(coda.items[coda.index]?.id, false, "nessuna risposta dalla scheda");
    }
  }
});
