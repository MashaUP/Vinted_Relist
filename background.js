/**
 * Service worker.
 * Due compiti:
 *  1. Intercetta gli header che Vinted stesso manda alle sue API e memorizza
 *     x-csrf-token / x-anon-id. E' il modo piu' affidabile per avere token validi.
 *  2. Scarica le foto dal CDN (images*.vinted.net) senza incappare nel CORS:
 *     una fetch dal service worker con host_permissions non e' soggetta a CORS.
 */

const TOKEN_KEY = "vrTokens";

// ---------------------------------------------------------------- token sniff

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    let csrf = null;
    let anonId = null;

    for (const header of details.requestHeaders || []) {
      const name = header.name.toLowerCase();
      if (name === "x-csrf-token" && header.value) csrf = header.value;
      if (name === "x-anon-id" && header.value) anonId = header.value;
    }

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
  { urls: ["https://www.vinted.it/api/*"] },
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
  { urls: ["https://www.vinted.it/api/v2/photos"], types: ["xmlhttprequest"] },
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
  { urls: ["https://www.vinted.it/api/v2/item_upload/items*"] },
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
    const programmata = parteA > Date.now() + 1000;

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
  chrome.storage.local.get({ humanRhythm: true, notifyOnFinish: true });

const leggiCoda = async () => (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] || null;
const scriviCoda = (coda) => chrome.storage.local.set({ [QUEUE_KEY]: coda });

async function schedulaProssimo(minuti, esatto = false) {
  const { humanRhythm } = await impostazioni();

  // Venti minuti esatti per tre ore sono una firma: nessuna persona e' cosi'
  // regolare. Lo scarto casuale costa niente e toglie il motivo piu' ovvio.
  const scarto = humanRhythm && !esatto ? 1 + (Math.random() * 2 - 1) * JITTER : 1;
  const quando = Date.now() + Math.max(30_000, minuti * 60_000 * scarto);
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

async function schedaVinted() {
  const tabs = await chrome.tabs.query({ url: "https://www.vinted.it/*" });
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
