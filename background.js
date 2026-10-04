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

    scriviCoda({
      items,
      index: 0,
      intervalMin: Math.max(1, Number(message.intervalMin) || 20),
      running: items.length > 0,
      state: "waiting",
      startedAt: Date.now(),
      nextAt: Date.now(),
      note: null,
    })
      .then(() => {
        chrome.alarms.clear(ALARM_WATCHDOG);
        return passoCoda();                       // il primo parte subito
      })
      .then(() => sendResponse({ ok: true, count: items.length }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "vr:queueStop") {
    fermaCoda("Interrotta.")
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "vr:relistDone") {
    esitoCoda(message.itemId, message.ok, message.error)
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
const MAX_ATTESE = 60;           // minuti di attesa di una scheda Vinted aperta

const leggiCoda = async () => (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] || null;
const scriviCoda = (coda) => chrome.storage.local.set({ [QUEUE_KEY]: coda });

async function schedulaProssimo(minuti) {
  const quando = Date.now() + minuti * 60_000;
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
    await chrome.tabs.sendMessage(tab.id, { type: "vr:relistOne", itemId: corrente.id });
    chrome.alarms.create(ALARM_WATCHDOG, { delayInMinutes: WATCHDOG_MIN });
  } catch {
    // content script non pronto: riprovo fra un minuto senza consumare l'articolo
    coda.state = "waiting";
    await scriviCoda(coda);
    schedulaProssimo(1);
  }
}

/** Registra l'esito e programma il successivo. */
async function esitoCoda(itemId, ok, error) {
  const coda = await leggiCoda();
  if (!coda?.running) return;

  const corrente = coda.items[coda.index];
  if (!corrente || String(corrente.id) !== String(itemId)) return;   // esito fuori tempo

  corrente.status = ok ? "done" : "error";
  corrente.error = ok ? null : error || "errore sconosciuto";
  coda.index += 1;
  await scriviCoda(coda);

  chrome.alarms.clear(ALARM_WATCHDOG);

  if (coda.index >= coda.items.length) return fermaCoda();
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
