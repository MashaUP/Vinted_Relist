/**
 * Service worker.
 * Due compiti:
 *  1. Intercetta gli header che Vinted stesso manda alle sue API e memorizza
 *     x-csrf-token / x-anon-id. E' il modo piu' affidabile per avere token validi.
 *  2. Scarica le foto dal CDN (images*.vinted.net) senza incappare nel CORS:
 *     una fetch dal service worker con host_permissions non e' soggetta a CORS.
 */

// Modello della coda: le stesse funzioni pure usate da popup, dashboard e pagina.
importScripts("src/coda-logica.js");
const C = self.CodaLogica;

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



  // Il passo corrente va in storage.session: e' un dettaglio da mostrare, non
  // stato della coda. Scriverlo nella coda causava la gara con l'esito (2.0.x).
  if (message?.type === "vr:queueProgress") {
    leggiCoda()
      .then((coda) => {
        const c = C.corrente(C.migra(coda));
        if (!coda?.running || c?.id !== String(message.itemId)) return null;
        return scriviPasso({
          itemId: c.id,
          step: String(message.step || "").slice(0, 80),
          fase: message.fase === "invio" ? "invio" : "preparazione",
          at: Date.now(),
        });
      })
      .then(() => sendResponse({ ok: true }));
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
 * Il lavoro vero lo fa la scheda Vinted: qui decidiamo "quando" e "cosa", e
 * mandiamo un messaggio. Il content script risponde subito e riferisce l'esito
 * a cose fatte.
 *
 * UNICA FONTE DI VERITA': vrQueue in storage.local, scritta SOLO da questo file
 * e SOLO dentro conCoda(), una modifica alla volta. Popup, dashboard e pagina
 * leggono lo storage e chiedono modifiche con un messaggio. Le regole stanno in
 * src/coda-logica.js (funzioni pure, testate): qui si applicano e si salvano.
 *
 * Fino alla 2.0.1 ogni messaggio leggeva e riscriveva la coda per conto suo:
 * l'aggiornamento del passo ("Fatto") e l'esito arrivavano quasi insieme e il
 * primo poteva sovrascrivere il secondo, rimettendo "in attesa" un articolo gia'
 * pubblicato. Da qui la serializzazione, e il passo spostato in storage.session.
 */
const QUEUE_KEY = "vrQueue";
const STEP_KEY = "vrQueueStep";          // passo corrente: in storage.session, non tocca la coda
const ALARM_NEXT = "vr:queueNext";
const ALARM_WATCHDOG = "vr:queueWatchdog";
const ALARM_RIPRESA = "vr:queueResume";
const WATCHDOG_MIN = 6;          // oltre questo, l'esito dell'articolo e' incerto
const MAX_ATTESE = 60;           // minuti di attesa complessivi: scheda chiusa o utente assente
const RALLENTA = [5, 15, 45];    // minuti di pausa dopo un 429 o un 403, in scala
const JITTER = 0.3;              // ±30% sull'intervallo, per non avere un ritmo a metronomo
const INATTIVO_SEC = 300;        // oltre, consideriamo che tu non sia al computer
const MAX_ID_PER_MESSAGGIO = 500;

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

async function scriviCoda(coda) {
  coda.rev = (coda.rev || 0) + 1;
  await chrome.storage.local.set({ [QUEUE_KEY]: coda });
}

const scriviPasso = (passo) => chrome.storage.session.set({ [STEP_KEY]: passo }).catch(() => {});

/**
 * Ogni lettura-modifica-scrittura della coda passa di qui, in fila. Il lavoro
 * riceve la coda appena letta (gia' portata al modello per id) e la salva lui.
 * Dentro un lavoro non si chiama mai conCoda: si usano le funzioni interne.
 */
let catenaCoda = Promise.resolve();
function conCoda(lavoro) {
  const giro = catenaCoda.then(async () => lavoro(C.migra(await leggiCoda())));
  catenaCoda = giro.catch((errore) => console.warn("[Relist] coda:", errore));
  return giro;
}

/** Elenco di id da un messaggio: dato non attendibile. */
const idDa = (lista) =>
  (Array.isArray(lista) ? lista : [])
    .map((x) => String(x ?? "").trim())
    .filter((x) => /^\d{1,20}$/.test(x))
    .slice(0, MAX_ID_PER_MESSAGGIO);

// ---------------------------------------------------- funzioni interne (sotto lock)

async function programmaProssimo(coda, minuti, esatto = false) {
  const { humanRhythm, peakOnly, peakWindows } = await impostazioni();

  // Venti minuti esatti per tre ore sono una firma: nessuna persona e' cosi'
  // regolare. Lo scarto casuale costa niente e toglie il motivo piu' ovvio.
  const scarto = humanRhythm && !esatto ? 1 + (Math.random() * 2 - 1) * JITTER : 1;
  let quando = Date.now() + Math.max(30_000, minuti * 60_000 * scarto);
  if (peakOnly) quando = dentroFascia(quando, leggiFasce(peakWindows));

  coda.nextAt = quando;
  coda.state = "waiting";
  await scriviCoda(coda);
  chrome.alarms.create(ALARM_NEXT, { when: quando });
}

async function chiudiCoda(coda, motivo) {
  if (!coda) return;
  const ora = Date.now();

  // Quello che non e' partito resta annullato, non "in attesa" per sempre.
  for (const voce of coda.items || []) {
    if (voce.status === "pending") {
      voce.status = "cancelled";
      voce.finishedAt = ora;
      voce.error = "non partito: sessione conclusa";
    }
  }
  coda.running = false;
  coda.state = "done";
  coda.nextAt = null;
  coda.stopDopoCorrente = false;
  coda.finishedAt = ora;
  if (motivo) coda.note = motivo;
  const r = C.conta(coda);
  C.registra(coda, "conclusa", `${motivo ? `${motivo} ` : ""}${r.done} ripubblicati, ${r.error} falliti, ${r.verify} da verificare.`, {}, ora);
  await scriviCoda(coda);
  await scriviPasso(null);

  chrome.alarms.clear(ALARM_NEXT);
  chrome.alarms.clear(ALARM_WATCHDOG);
  chrome.alarms.clear(ALARM_RIPRESA);
  if (!coda.items?.length) return;
  await archiviaCoda(coda);

  const problemi = r.error + r.verify;
  const testo =
    (motivo ? `${motivo} ` : "") +
    `${r.done} ripubblicati` +
    (r.error ? `, ${r.error} falliti` : "") +
    (r.verify ? `, ${r.verify} da verificare` : "") +
    (r.skipped ? `, ${r.skipped} saltati` : "") +
    (r.cancelled ? `, ${r.cancelled} annullati` : "") +
    (r.removed ? `, ${r.removed} rimossi` : "") + ".";

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

async function schedaVinted() {
  const tabs = await chrome.tabs.query({ url: SITI });
  return tabs.find((t) => t.status === "complete") || tabs[0] || null;
}

/** Manda in lavorazione il prossimo articolo in attesa. Mai due insieme. */
async function passoCoda(coda) {
  if (!coda?.running || !["waiting", "scheduled"].includes(coda.state)) return;
  if (C.corrente(coda)) return;

  // Ripubblicati a mano dopo l'avvio della coda: l'id vecchio non esiste piu'.
  const { vrHistory = [] } = await chrome.storage.local.get("vrHistory");
  let prossimo = C.prossimo(coda);
  while (prossimo && vrHistory.some((v) => String(v.id) === prossimo.id && v.at > (prossimo.addedAt || coda.startedAt || 0))) {
    prossimo.status = "skipped";
    prossimo.motivoSalto = "gia-ripubblicato";
    prossimo.error = "già ripubblicato a mano";
    prossimo.finishedAt = Date.now();
    C.registra(coda, "saltato", `Saltato, già ripubblicato a mano: ${prossimo.title}`, { id: prossimo.id });
    prossimo = C.prossimo(coda);
  }
  if (!prossimo) return chiudiCoda(coda);

  const { humanRhythm } = await impostazioni();
  if (humanRhythm) {
    const stato = await chrome.idle.queryState(INATTIVO_SEC);
    if (stato !== "active") {
      // Ripubblicare mentre non c'e' nessuno davanti allo schermo e' il
      // comportamento piu' facile da riconoscere. Aspettiamo che torni.
      coda.waited = (coda.waited || 0) + 2;
      if (coda.waited > MAX_ATTESE) return chiudiCoda(coda, "Interrotta: sei stato via troppo.");
      return programmaProssimo(coda, 2, true);
    }
  }

  const tab = await schedaVinted();
  if (!tab) {
    coda.waited = (coda.waited || 0) + 1;
    if (coda.waited > MAX_ATTESE) return chiudiCoda(coda, "Interrotta: nessuna scheda Vinted aperta.");
    return programmaProssimo(coda, 1);
  }

  coda.waited = 0;
  C.avviaArticolo(coda, prossimo.id);
  coda.state = "working";
  coda.nextAt = null;
  await scriviCoda(coda);
  await scriviPasso({ itemId: prossimo.id, step: "Avvio…", fase: "preparazione", at: Date.now() });

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "vr:relistOne",
      itemId: prossimo.id,
      overrides: coda.overrides || {},
    });
    chrome.alarms.create(ALARM_WATCHDOG, { delayInMinutes: WATCHDOG_MIN });
  } catch {
    // Content script non pronto: niente e' partito, l'articolo torna in attesa
    // al suo posto e si riprova fra un minuto.
    prossimo.status = "pending";
    prossimo.startedAt = null;
    coda.state = "waiting";
    await scriviPasso(null);
    return programmaProssimo(coda, 1);
  }
}

/** Esito di un articolo: lo registra e decide cosa viene dopo. */
async function esitoCoda(coda, msg) {
  if (!coda?.running) return;
  const c = C.corrente(coda);
  if (!c || c.id !== String(msg.itemId)) return;                   // esito fuori tempo
  chrome.alarms.clear(ALARM_WATCHDOG);
  await scriviPasso(null);

  // Un blocco non e' colpa dell'articolo: non lo consumiamo, rallentiamo.
  // Continuare a bussare dopo un 429 e' il modo migliore per peggiorare.
  if (msg.blocked) {
    c.status = "pending";
    c.startedAt = null;
    c.annullaRichiesto = false;
    const gradino = coda.backoff || 0;
    if (gradino >= RALLENTA.length || coda.stopDopoCorrente) {
      return chiudiCoda(coda, coda.stopDopoCorrente ? "Interrotta." : `Interrotta: Vinted continua a bloccare. ${msg.error || ""}`.trim());
    }
    coda.backoff = gradino + 1;
    coda.note = `In pausa ${RALLENTA[gradino]} min: ${msg.error || "richiesta bloccata"}`;
    C.registra(coda, "rallenta", coda.note, { id: c.id, azione: "nessuna: la coda riprova da sola" });
    return programmaProssimo(coda, RALLENTA[gradino], true);
  }

  const r = C.concludiArticolo(coda, c.id, {
    ok: Boolean(msg.ok),
    outcome: msg.outcome,
    error: msg.error,
    categoria: msg.categoria,
    sicuro: msg.sicuro,
    motivoSalto: msg.motivoSalto,
  });
  coda.backoff = 0;
  coda.note = null;

  if (r.stato === "error" || r.stato === "verify") {
    await registraEvento({
      kind: r.stato === "verify" ? "uncertain" : "error",
      title: r.stato === "verify" ? `Da verificare: ${c.title}` : `Non riuscito: ${c.title}`,
      text: c.error,
      itemId: c.id,
      queue: coda.startedAt,
    });
  }

  if (coda.stopDopoCorrente) return chiudiCoda(coda, "Interrotta.");
  if (C.daChiudere(coda)) return chiudiCoda(coda);

  // Modalita' prudente: troppi esiti negativi di fila. Ci si ferma e si chiede.
  if (r.prudenza) {
    coda.state = "paused";
    coda.pausaAuto = true;
    coda.motivoPausa = `${coda.erroriDiFila} esiti negativi di fila: controlla i motivi prima di continuare.`;
    coda.pausedRemainingMs = coda.intervalMin * 60_000;
    coda.nextAt = null;
    C.registra(coda, "prudenza", `Coda fermata da sola: ${coda.motivoPausa}`, { azione: "leggi gli errori, poi Riprendi" });
    await scriviCoda(coda);
    await registraEvento({ kind: "warn", title: "Coda in pausa da sola", text: coda.motivoPausa, queue: coda.startedAt });
    return;
  }

  if (coda.pausaDopoCorrente) {
    coda.pausaDopoCorrente = false;
    return mettiInPausa(coda, { minuti: coda.pausaMinuti || null, restante: coda.intervalMin * 60_000 });
  }

  return programmaProssimo(coda, coda.intervalMin);
}

async function mettiInPausa(coda, { minuti = null, restante = null } = {}) {
  const ora = Date.now();
  coda.pausedRemainingMs = restante ?? Math.max(0, (coda.nextAt || ora) - ora);
  coda.state = "paused";
  coda.nextAt = null;
  coda.pausaAuto = false;
  coda.motivoPausa = null;
  coda.pausaMinuti = null;
  coda.riprendiAlle = minuti ? ora + minuti * 60_000 : null;
  C.registra(coda, "pausa", minuti ? `In pausa per ${minuti} minuti.` : "In pausa.", {}, ora);
  await scriviCoda(coda);
  chrome.alarms.clear(ALARM_NEXT);
  if (coda.riprendiAlle) chrome.alarms.create(ALARM_RIPRESA, { when: coda.riprendiAlle });
}

/**
 * Pausa: se un articolo e' in lavorazione non lo interrompiamo a meta': la
 * pausa scatta appena arriva il suo esito ("pausa dopo l'articolo corrente").
 */
async function pausaCoda(coda, minuti = null) {
  if (!coda?.running || coda.state === "paused" || coda.state === "recovering") return { ok: false, motivo: "La coda non è in esecuzione." };
  const m = Number(minuti) > 0 ? Math.min(24 * 60, Math.round(Number(minuti))) : null;
  if (C.corrente(coda)) {
    coda.pausaDopoCorrente = true;
    coda.pausaMinuti = m;
    C.registra(coda, "pausa", "Pausa richiesta: scatta dopo l'articolo in corso.");
    await scriviCoda(coda);
    return { ok: true, dopoCorrente: true };
  }
  await mettiInPausa(coda, { minuti: m });
  return { ok: true };
}

async function riprendiCoda(coda) {
  if (!coda?.running) return { ok: false, motivo: "La coda non è attiva." };
  if (coda.pausaDopoCorrente) {
    coda.pausaDopoCorrente = false;
    coda.pausaMinuti = null;
    await scriviCoda(coda);
    return { ok: true };
  }
  if (coda.state !== "paused") return { ok: false, motivo: "La coda non è in pausa." };
  chrome.alarms.clear(ALARM_RIPRESA);
  if (C.daChiudere(coda)) { await chiudiCoda(coda); return { ok: true, chiusa: true }; }

  // Riprende da dove si era fermata: il tempo gia' atteso non si butta via.
  const quando = Date.now() + (coda.pausedRemainingMs || 0);
  coda.state = "waiting";
  coda.pausedRemainingMs = null;
  coda.pausaAuto = false;
  coda.motivoPausa = null;
  coda.riprendiAlle = null;
  coda.erroriDiFila = 0;              // hai guardato: si riparte da capo con la prudenza
  coda.nextAt = quando;
  C.registra(coda, "ripresa", "Ripresa.");
  await scriviCoda(coda);
  chrome.alarms.create(ALARM_NEXT, { when: quando });
  return { ok: true };
}

/**
 * Interrompi: niente parte piu'. Se un articolo e' in lavorazione non si finge
 * di sapere com'e' andata: si chiede di annullarlo e si chiude quando arriva
 * l'esito (o quando scatta il watchdog, e allora e' "da verificare").
 */
async function interrompiCoda(coda) {
  if (!coda?.running) return { ok: false, motivo: "Nessuna coda attiva." };
  const c = C.corrente(coda);
  if (!c) { await chiudiCoda(coda, "Interrotta."); return { ok: true }; }

  for (const v of coda.items) {
    if (v.status === "pending") { v.status = "cancelled"; v.finishedAt = Date.now(); v.error = "non partito: sessione interrotta"; }
  }
  coda.stopDopoCorrente = true;
  C.annullaCorrente(coda);
  C.registra(coda, "annullamento", "Sessione in chiusura: si aspetta l'esito dell'articolo in corso.");
  await scriviCoda(coda);
  await chiediAnnullamento(c.id);
  return { ok: true, inChiusura: true };
}

/** Salta il PROSSIMO articolo (non quello in lavorazione: per quello c'e' Annulla). */
async function saltaProssimo(coda) {
  if (!coda?.running) return { ok: false, motivo: "Nessuna coda attiva." };
  if (C.corrente(coda)) return { ok: false, motivo: "Un articolo è in elaborazione: per quello usa «Annulla operazione»." };
  const p = C.prossimo(coda);
  if (!p) return { ok: false, motivo: "Nessun articolo in attesa." };
  p.status = "skipped";
  p.motivoSalto = "manuale";
  p.error = "saltato a mano";
  p.finishedAt = Date.now();
  C.registra(coda, "saltato", `Saltato a mano: ${p.title}`, { id: p.id });
  if (C.daChiudere(coda)) { await chiudiCoda(coda); return { ok: true }; }
  await scriviCoda(coda);
  return { ok: true };
}

async function chiediAnnullamento(itemId) {
  try {
    const tab = await schedaVinted();
    if (!tab) return { ok: false };
    return (await chrome.tabs.sendMessage(tab.id, { type: "vr:relistCancel", itemId })) || { ok: false };
  } catch {
    return { ok: false };
  }
}

async function annullaOperazione(coda) {
  if (!coda?.running) return { ok: false, motivo: "Nessuna coda attiva." };
  const r = C.annullaCorrente(coda);
  if (!r.ok) return r;
  await scriviCoda(coda);
  const risposta = await chiediAnnullamento(r.id);
  if (risposta?.troppoTardi) {
    const c = C.corrente(coda);
    if (c) {
      C.registra(coda, "annullamento", `Annullamento non possibile: la richiesta a Vinted era già partita (${c.title}). Si aspetta l'esito.`, { id: c.id });
      await scriviCoda(coda);
    }
    return { ok: true, troppoTardi: true, motivo: "La richiesta a Vinted era già partita: non si può annullare, si aspetta l'esito." };
  }
  return { ok: true, richiesto: true };
}

/**
 * Gli alarm non sopravvivono al ricaricamento dell'estensione: la coda restava
 * "running" senza piu' niente che la svegliasse. Al risveglio controlliamo se
 * la sveglia c'e' ancora; se manca, la coda passa in RECOVERING e aspetta te.
 * Il margine serve a non scambiare per guasto il risveglio normale.
 */
const MARGINE_RECUPERO_MS = 3 * 60_000;

async function recupera(coda) {
  if (!coda?.running || coda.state === "recovering") return;

  if (coda.state === "paused") {
    // Una ripresa programmata persa con il riavvio non riparte da sola.
    if (coda.riprendiAlle && !(await chrome.alarms.get(ALARM_RIPRESA))) {
      coda.riprendiAlle = null;
      C.registra(coda, "recupero", "Ripresa programmata persa con il riavvio: riprendi a mano.");
      await scriviCoda(coda);
    }
    return;
  }
  if (await chrome.alarms.get(ALARM_NEXT)) return;        // sveglia al suo posto

  const ora = Date.now();
  const c = C.corrente(coda);
  const rotta = c
    ? ora - (c.startedAt || 0) > (WATCHDOG_MIN + 2) * 60_000 || !(await chrome.alarms.get(ALARM_WATCHDOG))
    : coda.nextAt > ora + 5_000 || ora - (coda.nextAt || 0) > MARGINE_RECUPERO_MS;
  if (!rotta) return;

  // L'articolo in lavorazione potrebbe essere gia' stato pubblicato prima
  // dell'interruzione: rifarlo alla cieca creerebbe un doppione. Va controllato.
  if (c) {
    c.status = "verify";
    c.finishedAt = ora;
    c.error = "Interrotto durante la pubblicazione: controlla nell'armadio se è uscito.";
    c.categoria = "incerto";
    c.sicuro = "no";
  }
  coda.state = "recovering";
  coda.nextAt = null;
  coda.note = null;
  C.registra(coda, "recupero", c ? `Sessione interrotta durante: ${c.title} (da verificare).` : "Sessione interrotta: si aspetta una tua decisione.", c ? { id: c.id } : {});
  await scriviCoda(coda);
  await scriviPasso(null);
  chrome.alarms.clear(ALARM_WATCHDOG);
}

async function riprendiDaRecupero(coda) {
  if (coda?.state !== "recovering") return { ok: false, motivo: "La coda non è interrotta." };
  if (coda.stopDopoCorrente || C.daChiudere(coda)) { await chiudiCoda(coda, coda.stopDopoCorrente ? "Interrotta." : null); return { ok: true }; }
  coda.state = "waiting";
  coda.nextAt = Date.now();
  C.registra(coda, "ripresa", "Ripresa dopo l'interruzione.");
  await passoCoda(coda);
  return { ok: true };
}

// ------------------------------------------------- avvio, modifiche, verifica

/** Chiave per riconoscere lo stesso avvio arrivato due volte (doppio clic). */
const firmaAvvio = (ids) => [...ids].map(String).sort().join(",");

async function avviaCoda(coda, message) {
  // Doppio clic: la stessa coda e' gia' partita, non si riparte da capo.
  // Una coda diversa in corso invece non si sovrascrive mai: si aggiunge.
  if (coda?.running) {
    const attivi = coda.items.filter((i) => i.status === "pending" || i.status === "working").map((i) => i.id);
    const richiesti = [...new Set((message.items || []).map((i) => String(i?.id)))];
    if (firmaAvvio(attivi) === firmaAvvio(richiesti)) return { ok: true, duplicato: true, count: richiesti.length };
    return { ok: false, error: "C'è già una coda in corso: usa «Aggiungi alla coda» per metterci questi articoli." };
  }

  const { coda: nuova, saltati } = C.nuova({
    items: message.items || [],
    intervalMin: message.intervalMin,
    overrides: message.overrides || null,
    startAt: message.startAt,
    modello: message.modello || null,
    auto: Boolean(message.auto),
    note: message.note || null,
  });
  if (!nuova.items.length) return { ok: false, error: "Nessun articolo da mettere in coda.", saltati };

  C.registra(nuova, "avviata", nuova.state === "scheduled"
    ? `Avvio programmato per ${new Date(nuova.nextAt).toLocaleString("it-IT")}.`
    : "Sessione avviata.");
  chrome.alarms.clear(ALARM_WATCHDOG);
  chrome.alarms.clear(ALARM_RIPRESA);
  await scriviPasso(null);

  // L'avvio programmato non viene sporcato dallo scarto casuale: alle 20:00 e' alle 20:00.
  if (nuova.state === "scheduled") {
    await scriviCoda(nuova);
    await chrome.alarms.create(ALARM_NEXT, { when: nuova.nextAt });
  } else {
    await scriviCoda(nuova);
    await passoCoda(nuova);
  }
  return { ok: true, count: nuova.items.length, saltati };
}

async function aggiungiAllaCoda(coda, message) {
  if (!coda?.running) return { ok: false, error: "Nessuna coda attiva: avviane una nuova." };
  if (coda.stopDopoCorrente) return { ok: false, error: "La coda si sta chiudendo: avviane una nuova quando ha finito." };
  const r = C.aggiungi(coda, (message.items || []).slice(0, MAX_ID_PER_MESSAGGIO), { dove: message.dove === "cima" ? "cima" : "fondo" });
  if (r.aggiunti.length || r.riattivati.length) await scriviCoda(coda);
  return { ok: r.ok, aggiunti: r.aggiunti, riattivati: r.riattivati, rifiutati: r.rifiutati };
}

async function rimuoviDallaCoda(coda, message) {
  if (!coda?.running) return { ok: false, error: "Nessuna coda attiva." };
  const r = C.rimuovi(coda, idDa(message.ids));
  if (!r.rimossi.length) return { ok: false, rimossi: [], rifiutati: r.rifiutati };
  // Tolto l'ultimo in attesa con niente in lavorazione: la sessione e' finita.
  if (C.daChiudere(coda)) await chiudiCoda(coda, "Coda svuotata.");
  else await scriviCoda(coda);
  return { ok: true, rimossi: r.rimossi, rifiutati: r.rifiutati };
}

async function spostaNellaCoda(coda, message) {
  if (!coda?.running) return { ok: false, error: "Nessuna coda attiva." };
  const r = C.sposta(coda, idDa(message.ids), String(message.dove));
  if (r.cambiato) await scriviCoda(coda);
  return r;
}

async function riordinaCoda(coda, message) {
  if (!coda?.running) return { ok: false, motivo: "Nessuna coda attiva." };
  const r = C.riordina(coda, idDa(message.ordine));
  if (r.cambiato) await scriviCoda(coda);
  return r;
}

/**
 * Riprova: i falliti tornano in attesa. Nella sessione in corso si rimettono in
 * fondo; da una sessione conclusa (anche archiviata) si aggiungono alla coda in
 * corso, oppure ne parte una nuova con le stesse opzioni. Mai i "da verificare".
 */
async function riprovaArticoli(coda, message) {
  const codaId = message.queue != null ? Number(message.queue) : null;
  const ids = message.ids ? idDa(message.ids) : null;

  if (coda?.running && (codaId == null || coda.startedAt === codaId)) {
    const scelti = ids || coda.items.filter((i) => i.status === "error").map((i) => i.id);
    const r = C.riprova(coda, scelti);
    if (r.ok) await scriviCoda(coda);
    return { ok: r.ok, rimessi: r.rimessi, rifiutati: r.rifiutati, error: r.ok ? null : "Nessun articolo da riprovare." };
  }

  let origine = coda;
  if (codaId != null && coda?.startedAt !== codaId) {
    const { vrQueueArchive = [] } = await chrome.storage.local.get("vrQueueArchive");
    origine = vrQueueArchive.find((q) => q.startedAt === codaId) || null;
  }
  const falliti = (origine?.items || []).filter((i) => i.status === "error" && i.sicuro !== "no" && (!ids || ids.includes(String(i.id))));
  if (!falliti.length) return { ok: false, error: "Nessun articolo fallito da riprovare." };
  const voci = falliti.map(({ id, title, thumb, price }) => ({ id, title, thumb, price }));

  if (coda?.running) {
    const r = await aggiungiAllaCoda(coda, { items: voci, dove: "fondo" });
    return { ...r, aggiuntaAllaCodaInCorso: true };
  }
  return avviaCoda(coda, { items: voci, intervalMin: origine.intervalMin, overrides: origine.overrides ?? null, modello: origine.modello });
}

/** Riprende una sessione passata: solo cio' che non e' stato fatto, mai i completati. */
async function riprendiSessione(coda, message) {
  const codaId = Number(message.queue);
  const { vrQueueArchive = [] } = await chrome.storage.local.get("vrQueueArchive");
  const sessione = vrQueueArchive.find((q) => q.startedAt === codaId);
  if (!sessione) return { ok: false, error: "Sessione non più in archivio." };
  const { riprendibili, esclusi } = C.daRiprendere(sessione);
  if (!riprendibili.length) return { ok: false, error: "In questa sessione non c'è niente da riprendere.", esclusi };
  const voci = riprendibili.map(({ id, title, thumb, price }) => ({ id, title, thumb, price }));
  const r = coda?.running
    ? await aggiungiAllaCoda(coda, { items: voci, dove: "fondo" })
    : await avviaCoda(coda, { items: voci, intervalMin: sessione.intervalMin, overrides: sessione.overrides ?? null, modello: sessione.modello });
  return { ...r, esclusi };
}

/** Copia compatta delle ultime sessioni concluse, con il loro registro. */
const MAX_ARCHIVIO = 10;

async function archiviaCoda(coda) {
  const { vrQueueArchive = [] } = await chrome.storage.local.get("vrQueueArchive");
  const compatta = C.perArchivio(coda);
  const altre = vrQueueArchive.filter((q) => q.startedAt !== coda.startedAt);
  await chrome.storage.local.set({ vrQueueArchive: [compatta, ...altre].slice(0, MAX_ARCHIVIO) });
}

/** Dopo aver guardato l'armadio: pubblicato davvero oppure no (allora e' riprovabile). */
async function risolviDaVerificare(coda, itemId, pubblicato, codaId = null) {
  const vale = (c) => c && (codaId == null || c.startedAt === Number(codaId));
  let fatto = false;
  if (vale(coda) && C.risolvi(coda, itemId, pubblicato).ok) {
    await scriviCoda(coda);
    fatto = true;
  }
  const { vrQueueArchive = [] } = await chrome.storage.local.get("vrQueueArchive");
  let cambiato = false;
  for (const c of vrQueueArchive) {
    if (vale(c) && C.risolvi(c, itemId, pubblicato).ok) cambiato = true;
  }
  if (cambiato) await chrome.storage.local.set({ vrQueueArchive });
  return { ok: fatto || cambiato };
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
function scansione() { return conCoda(scansioneCoda); }

async function scansioneCoda(coda) {
  const { autoRule, autoRuleDays, autoRuleMax, queueIntervalMin } = await impostazioni();
  if (!autoRule) return;
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
    .map(([id, art]) => ({ id, title: art.title || `Articolo ${id}`, thumb: art.thumb || null, price: art.price ?? null }));

  if (!candidati.length) return;
  console.log("[Relist] coda automatica:", candidati.length, "articoli");
  return avviaCoda(coda, { items: candidati, intervalMin: queueIntervalMin, overrides: null, auto: true, note: "Coda automatica" });
}

async function programmaScansione() {
  const { autoRule } = await impostazioni();
  if (autoRule) chrome.alarms.create(ALARM_SCANSIONE, { periodInMinutes: 60, delayInMinutes: 5 });
  else chrome.alarms.clear(ALARM_SCANSIONE);
}

chrome.storage.onChanged.addListener((modifiche, area) => {
  if (area === "local" && modifiche.autoRule) programmaScansione();
});

programmaScansione();

function recuperaCoda() { return conCoda(recupera); }
chrome.runtime.onStartup.addListener(recuperaCoda);
chrome.runtime.onInstalled.addListener(recuperaCoda);
recuperaCoda();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NEXT) return conCoda(passoCoda);
  if (alarm.name === ALARM_SCANSIONE) return scansione();
  if (alarm.name === ALARM_RIPRESA) {
    return conCoda((coda) => (coda?.state === "paused" && coda.riprendiAlle ? riprendiCoda(coda) : null));
  }
  if (alarm.name === ALARM_WATCHDOG) {
    return conCoda((coda) => {
      const c = C.corrente(coda);
      if (!coda?.running || !c) return null;
      return esitoCoda(coda, {
        itemId: c.id,
        ok: false,
        outcome: "uncertain",
        categoria: "incerto",
        sicuro: "no",
        error: `Nessuna risposta dalla scheda in ${WATCHDOG_MIN} minuti: potrebbe essere stato pubblicato, controlla l'armadio.`,
      });
    });
  }
  return null;
});

/** Messaggi della coda: tutti passano dal lock, tutti rispondono con un esito. */
const MESSAGGI_CODA = {
  "vr:queueStart": (coda, m) => avviaCoda(coda, m),
  "vr:queueAdd": (coda, m) => aggiungiAllaCoda(coda, m),
  "vr:queueRemove": (coda, m) => rimuoviDallaCoda(coda, m),
  "vr:queueMove": (coda, m) => spostaNellaCoda(coda, m),
  "vr:queueReorder": (coda, m) => riordinaCoda(coda, m),
  "vr:queueRetry": (coda, m) => riprovaArticoli(coda, m),
  "vr:queueRestore": (coda, m) => riprendiSessione(coda, m),
  "vr:queueResolve": (coda, m) => risolviDaVerificare(coda, m.itemId, Boolean(m.pubblicato), m.queue ?? null),
  "vr:queuePause": (coda, m) => pausaCoda(coda, m.minuti),
  "vr:queueResume": (coda) => riprendiCoda(coda),
  "vr:queueRecover": (coda) => riprendiDaRecupero(coda),
  "vr:queueSkip": (coda) => saltaProssimo(coda),
  "vr:queueStop": (coda) => interrompiCoda(coda),
  "vr:queueCancelCurrent": (coda) => annullaOperazione(coda),
  "vr:queueClear": async (coda) => {
    if (coda?.running) return { ok: false, error: "La coda è ancora attiva." };
    await chrome.storage.local.remove(QUEUE_KEY);
    return { ok: true };
  },
  "vr:relistDone": (coda, m) => esitoCoda(coda, m).then(() => ({ ok: true })),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const gestore = MESSAGGI_CODA[message?.type];
  if (!gestore) return false;
  conCoda((coda) => gestore(coda, message))
    .then((r) => sendResponse(r ?? { ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
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
