/**
 * Service worker.
 * Due compiti:
 *  1. Intercetta gli header che Vinted stesso manda alle sue API e memorizza
 *     x-csrf-token / x-anon-id. E' il modo piu' affidabile per avere token validi.
 *  2. Scarica le foto dal CDN (images*.vinted.net) senza incappare nel CORS:
 *     una fetch dal service worker con host_permissions non e' soggetta a CORS.
 */

// Modello della coda: le stesse funzioni pure usate da popup, dashboard e pagina.
importScripts("src/coda-logica.js", "src/armadio-logica.js", "src/versione.js");
const C = self.CodaLogica;
const A = self.ArmadioLogica;
const V = self.Versione;

/**
 * Versione del codice del service worker. La pagina manda la sua con la
 * richiesta di permesso e la diagnostica le confronta: se il browser tiene in
 * memoria file vecchi dopo un aggiornamento, si vede (e si dice) invece di
 * fallire con un errore generico.
 */
const BUILD = "2.3.1";
const AVVIO_SW = Date.now();

// ------------------------------------------------------------ registro errori

/**
 * Gli errori tecnici dell'estensione (non gli esiti di Vinted): permessi
 * negati e perche', salvataggi falliti, messaggi senza risposta. Servono alla
 * diagnostica per dimostrare cosa succede su un'installazione e non su
 * un'altra. Solo codici e messaggi ripuliti: niente titoli, id, token.
 */
const MAX_ERRORI = 50;
async function registraErrore(dove, codice, messaggio) {
  try {
    const { vrErrori = [] } = await chrome.storage.local.get("vrErrori");
    vrErrori.unshift({ at: Date.now(), dove: String(dove).slice(0, 40), codice: String(codice || "").slice(0, 40), messaggio: V.ripulisci(messaggio).replace(/\b\d{6,20}\b/g, "[id]"), build: BUILD });
    await chrome.storage.local.set({ vrErrori: vrErrori.slice(0, MAX_ERRORI) });
  } catch {
    // se non si riesce a salvare nemmeno questo, lo dice la console
    console.warn("[Relist] errore non registrato:", dove, codice, messaggio);
  }
}

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
  const controllo = new AbortController();
  const scadenza = setTimeout(() => controllo.abort(), 60_000);
  let buffer;
  let response;
  try {
    response = await fetch(url, { credentials: "omit", cache: "no-store", signal: controllo.signal });
    if (!response.ok) throw new Error("Download foto fallito (HTTP " + response.status + ")");
    buffer = await response.arrayBuffer();
  } catch (errore) {
    if (errore?.name === "AbortError") throw new Error("Download foto: nessuna risposta in 60 secondi.");
    throw errore;
  } finally {
    clearTimeout(scadenza);
  }

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

// ---------------------------------------------------- inventario dell'armadio

/**
 * L'inventario (base del valore dell'armadio) lo scrive solo il service worker,
 * una modifica alla volta: la pagina manda le letture delle card e le
 * ripubblicazioni riuscite. Le regole stanno in src/armadio-logica.js.
 */
let catenaInventario = Promise.resolve();
function conInventario(lavoro) {
  const giro = catenaInventario.then(async () =>
    lavoro(await chrome.storage.local.get({ inventory: {}, vrSnapshots: [], vrInventoryReplaced: {} })));
  catenaInventario = giro.catch((errore) => console.warn("[Relist] inventario:", errore));
  return giro;
}

const MAX_VOCI_ANNOTATE = 300;

function annotaInventario(voci) {
  const pulite = Object.fromEntries(Object.entries(voci && typeof voci === "object" ? voci : {})
    .filter(([id]) => /^\d{1,20}$/.test(id)).slice(0, MAX_VOCI_ANNOTATE));
  return conInventario(async (stato) => {
    const r = A.annota(stato, pulite);
    if (r.cambiati) await chrome.storage.local.set({ inventory: r.inventory });
    return { ok: true, ignorati: r.ignorati.length };
  });
}

function sostituisciInInventario(dati) {
  return conInventario(async (stato) => {
    const r = A.sostituisci(stato, dati);
    if (r.cambiato) {
      await chrome.storage.local.set({ inventory: r.inventory, vrSnapshots: r.vrSnapshots, vrInventoryReplaced: r.vrInventoryReplaced });
    }
    return { ok: true, cambiato: r.cambiato };
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "vr:inventarioAnnota") {
    annotaInventario(message.voci).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (message?.type === "vr:inventarioSostituisci") {
    sostituisciInInventario({ oldId: message.oldId, newId: message.newId, vecchio: message.vecchio, nuovo: message.nuovo })
      .then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
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
/**
 * WATCHDOG_MIN non e' piu' un verdetto (fino alla 2.1: "6 minuti senza risposta
 * = da verificare"). E' l'intervallo dei CONTROLLI: si chiede alla scheda se sta
 * ancora lavorando; se si', si aspetta. Una foto lenta o una scheda in secondo
 * piano (timer rallentati dal browser) superano facilmente i 6 minuti.
 * MAX_LAVORO_MIN e' il limite oltre il quale si smette di aspettare.
 */
const WATCHDOG_MIN = 6;
const MAX_LAVORO_MIN = 30;
const ALARM_VERIFICA = "vr:queueVerify";
const VERIFICA_MIN = 3;          // tra una verifica automatica e l'altra
const MAX_VERIFICHE_AUTO = 5;
const STACCO_MIN_MS = 60_000;    // «Ripubblica ora»: almeno un minuto dalla pubblicazione precedente
const GIORNALE = "vrOp:";        // + id: cosa ha fatto la pagina su un tentativo (prove, non stato)
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
  // Gli articoli da verificare restano verificabili anche a sessione chiusa.
  coda.running = false;
  coda.state = "done";
  coda.nextAt = null;
  coda.stopDopoCorrente = false;
  coda.finishedAt = ora;
  if (motivo) coda.note = motivo;
  const r = C.conta(coda);
  C.registra(coda, "conclusa", `${motivo ? `${motivo} ` : ""}${r.done} ripubblicati, ${r.error} falliti, ${r.verify} da verificare${r.interrupted ? `, ${r.interrupted} interrotti` : ""}.`, {}, ora);
  await scriviCoda(coda);
  await scriviPasso(null);

  chrome.alarms.clear(ALARM_NEXT);
  chrome.alarms.clear(ALARM_WATCHDOG);
  chrome.alarms.clear(ALARM_RIPRESA);
  if (!coda.items?.length) return;
  await archiviaCoda(coda);

  const problemi = r.error + r.verify + r.interrupted;
  const testo =
    (motivo ? `${motivo} ` : "") +
    `${r.done} ripubblicati` +
    (r.error ? `, ${r.error} falliti` : "") +
    (r.verify ? `, ${r.verify} da verificare` : "") +
    (r.interrupted ? `, ${r.interrupted} interrotti prima dell'invio` : "") +
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
  // La scheda che lavora l'articolo: e' a lei che si chiede come va e si chiede
  // di annullare (prima si chiedeva alla prima scheda Vinted, forse un'altra).
  C.assegnaScheda(coda, prossimo.id, tab.id);
  coda.state = "working";
  coda.nextAt = null;
  await scriviCoda(coda);
  await scriviPasso({ itemId: prossimo.id, step: "Avvio…", fase: "preparazione", at: Date.now() });
  chrome.alarms.create(ALARM_WATCHDOG, { delayInMinutes: WATCHDOG_MIN });

  try {
    // Con un limite: una scheda che non risponde non deve tenere ferma la coda (e il suo lock).
    await conTimeout(chrome.tabs.sendMessage(tab.id, {
      type: "vr:relistOne",
      itemId: prossimo.id,
      avviatoAt: prossimo.startedAt,
      sessione: coda.startedAt,
      // le regole della SUA batch, non quelle della coda o dell'ultima aggiunta
      overrides: C.overridesDi(coda, prossimo.id),
    }), 15_000);
  } catch (errore) {
    registraErrore("avvio-articolo", /timeout/.test(String(errore?.message)) ? "scheda-muta" : "scheda-irraggiungibile", errore?.message || errore);
    // Content script non pronto: niente e' partito, l'articolo torna in attesa
    // al suo posto e si riprova fra un minuto.
    chrome.alarms.clear(ALARM_WATCHDOG);
    Object.assign(prossimo, { status: "pending", startedAt: null, fase: null, scheda: null, regole: null });
    coda.state = "waiting";
    await scriviPasso(null);
    return programmaProssimo(coda, 1);
  }
}

/** Esito di un articolo: lo registra e decide cosa viene dopo. */
/** Campi di un esito arrivato con un messaggio: dato non attendibile. */
function esitoDa(msg) {
  return {
    ok: Boolean(msg.ok),
    outcome: ["error", "uncertain", "partial", "skipped", "cancelled", "interrupted"].includes(msg.outcome) ? msg.outcome : undefined,
    error: msg.error != null ? String(msg.error).slice(0, 400) : undefined,
    categoria: msg.categoria != null ? String(msg.categoria).slice(0, 30) : undefined,
    sicuro: ["si", "no", "dopo-correzione"].includes(msg.sicuro) ? msg.sicuro : undefined,
    motivoSalto: msg.motivoSalto != null ? String(msg.motivoSalto).slice(0, 30) : undefined,
    nuovoId: /^\d{1,20}$/.test(String(msg.nuovoId ?? "")) ? String(msg.nuovoId) : undefined,
    verificato: msg.verificato ? String(msg.verificato).slice(0, 40) : undefined,
    avviatoAt: msg.avviatoAt != null ? Number(msg.avviatoAt) : undefined,
  };
}

const oraBreve = (t) => (t ? new Date(t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "?");

/** Evento per il centro notifiche, uguale per ogni esito che chiede attenzione. */
async function eventoEsito(coda, c, stato) {
  if (stato === "verify") {
    await registraEvento({
      kind: "uncertain",
      title: `Da verificare: ${c.title}`,
      text: `Avviato alle ${oraBreve(c.startedAt)}. ${c.error} Cosa fare: apri la coda e premi «Verifica pubblicazione», oppure guarda l'armadio.`,
      itemId: c.id,
      queue: coda.startedAt,
    });
  } else if (stato === "error") {
    await registraEvento({ kind: "error", title: `Non riuscito: ${c.title}`, text: c.error, itemId: c.id, queue: coda.startedAt });
  } else if (stato === "interrupted") {
    await registraEvento({ kind: "warn", title: `Interrotto: ${c.title}`, text: `${c.error} Riprovare è sicuro.`, itemId: c.id, queue: coda.startedAt });
  } else if (stato === "done" && c.verificato) {
    await registraEvento({ kind: "ok", title: `Verificato: ${c.title}`, text: "Pubblicato: il risultato è stato confermato su Vinted.", itemId: c.id, queue: coda.startedAt });
  }
}

/**
 * Un esito che non riguarda l'articolo in lavorazione: quasi sempre l'esito
 * vero di un articolo che un controllo aveva gia' messo «da verificare». Vale
 * per la coda salvata (anche conclusa) e per la sua copia in archivio.
 */
async function esitoFuoriTempo(coda, msg) {
  const id = String(msg.itemId);
  const e = esitoDa(msg);
  let articolo = null;
  if (coda && C.trova(coda, id)) {
    const r = C.esitoTardivo(coda, id, e);
    if (r.ok) { await scriviCoda(coda); articolo = r.articolo; }
  }
  const { vrQueueArchive = [] } = await chrome.storage.local.get("vrQueueArchive");
  let cambiato = false;
  for (const s of vrQueueArchive) {
    if (C.trova(s, id) && C.esitoTardivo(s, id, e).ok) { cambiato = true; articolo = articolo || C.trova(s, id); }
  }
  if (cambiato) await chrome.storage.local.set({ vrQueueArchive });
  if (articolo) {
    await togliGiornale(id);
    await eventoEsito(coda || {}, articolo, articolo.status);
  }
}

async function esitoCoda(coda, msg) {
  if (!coda) return;
  const c = C.corrente(coda);
  const stesso = c && c.id === String(msg.itemId) && (msg.avviatoAt == null || Number(msg.avviatoAt) === c.startedAt);
  if (!coda.running || !stesso) return esitoFuoriTempo(coda, msg);
  chrome.alarms.clear(ALARM_WATCHDOG);
  await scriviPasso(null);

  // Un blocco non e' colpa dell'articolo: non lo consumiamo, rallentiamo.
  // Continuare a bussare dopo un 429 e' il modo migliore per peggiorare.
  if (msg.blocked) {
    Object.assign(c, { status: "pending", startedAt: null, annullaRichiesto: false, fase: null, scheda: null, invioAt: null });
    const gradino = coda.backoff || 0;
    if (gradino >= RALLENTA.length || coda.stopDopoCorrente) {
      return chiudiCoda(coda, coda.stopDopoCorrente ? "Interrotta." : `Interrotta: Vinted continua a bloccare. ${msg.error || ""}`.trim());
    }
    coda.backoff = gradino + 1;
    coda.note = `In pausa ${RALLENTA[gradino]} min: ${msg.error || "richiesta bloccata"}`;
    C.registra(coda, "rallenta", coda.note, { id: c.id, azione: "nessuna: la coda riprova da sola" });
    return programmaProssimo(coda, RALLENTA[gradino], true);
  }

  const e = esitoDa(msg);
  if (e.nuovoId) C.annotaTraccia(coda, c.id, { nuovoId: e.nuovoId });
  const r = C.concludiArticolo(coda, c.id, e);
  coda.backoff = 0;
  coda.note = null;
  await togliGiornale(c.id);

  await eventoEsito(coda, c, r.stato);
  // Pubblicazione partita senza conferma: si prova a verificarla su Vinted da soli.
  if (r.stato === "verify") pianificaVerifica(1);
  // Interrotto prima dell'invio (prova certa: il permesso non era stato dato):
  // torna in cima una volta, da solo. Una seconda interruzione aspetta te.
  if (r.stato === "interrupted") C.rimettiDopoInterruzione(coda, c.id);
  // Il permesso di inviare non e' arrivato per un problema dell'estensione, non
  // dell'articolo: continuare darebbe lo stesso esito a tutta la coda. Ci si
  // ferma subito, con il motivo vero.
  const tecnico = r.stato === "interrupted" && e.categoria === "comunicazione";
  if (tecnico) {
    registraErrore("permesso", "coda-in-pausa", c.ultimoErrore || c.error || "");
  }

  if (coda.stopDopoCorrente) return chiudiCoda(coda, "Interrotta.");
  if (C.daChiudere(coda)) return chiudiCoda(coda);

  // Modalita' prudente: troppi esiti negativi di fila, o un problema tecnico. Ci si ferma e si chiede.
  if (r.prudenza || tecnico) {
    coda.state = "paused";
    coda.pausaAuto = true;
    coda.motivoPausa = tecnico
      ? `Problema dell'estensione, non dell'articolo: ${String(c.ultimoErrore || c.error || "").replace(/^Fermato prima dell'invio a Vinted: /, "").replace(/\. Nessun annuncio creato o eliminato\.$/, "")}. Niente è stato inviato a Vinted: risolvi, poi Riprendi (in Salute c'è il report diagnostico).`
      : `${coda.erroriDiFila} esiti negativi di fila: controlla i motivi prima di continuare.`;
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

  // Dopo un'interruzione non e' stato pubblicato niente: non serve l'intervallo intero.
  return programmaProssimo(coda, r.stato === "interrupted" ? 1 : coda.intervalMin);
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
  await chiediAnnullamento(c.id, c.scheda);
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

async function chiediAnnullamento(itemId, tabId = null) {
  try {
    const id = Number.isInteger(tabId) ? tabId : (await schedaVinted())?.id;
    if (id == null) return { ok: false };
    return (await conTimeout(chrome.tabs.sendMessage(id, { type: "vr:relistCancel", itemId }), 10_000)) || { ok: false };
  } catch {
    return { ok: false };
  }
}

const conTimeout = (promessa, ms) => Promise.race([
  promessa,
  new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms)),
]);

async function annullaOperazione(coda) {
  if (!coda?.running) return { ok: false, motivo: "Nessuna coda attiva." };
  const c = C.corrente(coda);
  if (c?.fase === "invio") {
    return { ok: true, troppoTardi: true, motivo: "La richiesta a Vinted era già partita: non si può annullare, si aspetta l'esito." };
  }
  const r = C.annullaCorrente(coda);
  if (!r.ok) return r;
  await scriviCoda(coda);
  // Anche se il messaggio non arriva, il permesso di inviare ora viene negato.
  const risposta = await chiediAnnullamento(r.id, c?.scheda);
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
  // Con un articolo in lavorazione conta solo il controllo: se la sua sveglia
  // c'e', ci pensa lei (anche dopo 30 minuti di lavoro legittimo).
  const rotta = c
    ? !(await chrome.alarms.get(ALARM_WATCHDOG))
    : coda.nextAt > ora + 5_000 || ora - (coda.nextAt || 0) > MARGINE_RECUPERO_MS;
  if (!rotta) return;

  let testo = "Sessione interrotta: si aspetta una tua decisione.";
  if (c) {
    const giornale = await leggiGiornale(c.id, c.startedAt);
    if (giornale?.esito) {
      // La pagina aveva finito: l'esito c'e', era solo il messaggio a mancare.
      C.concludiArticolo(coda, c.id, { ...esitoDa(giornale.esito), avviatoAt: c.startedAt }, ora);
      testo = `Sessione interrotta dopo: ${c.title} (esito recuperato).`;
    } else if (c.fase !== "preparazione") {
      // Potrebbe essere gia' stato pubblicato prima dell'interruzione: rifarlo
      // alla cieca creerebbe un doppione. Si verifica, e intanto e' da verificare.
      // Vale anche per un articolo partito con una versione precedente, che
      // non registrava la fase: senza prova, mai "interrotto".
      if (giornale?.nuovoId) C.annotaTraccia(coda, c.id, { nuovoId: giornale.nuovoId });
      C.concludiArticolo(coda, c.id, { ok: false, outcome: "uncertain", categoria: "incerto", sicuro: "no",
        error: c.fase === "invio"
          ? `Il browser o l'estensione si sono fermati dopo l'invio della richiesta a Vinted (alle ${oraBreve(c.invioAt)}): potrebbe essere già pubblicato. Non riprovare prima della verifica.`
          : "Il browser o l'estensione si sono fermati durante la pubblicazione: potrebbe essere già pubblicato. Controlla nell'armadio prima di riprovare." }, ora);
      testo = `Sessione interrotta durante: ${c.title} (da verificare).`;
      pianificaVerifica(1);
    } else {
      // Il permesso di inviare non era stato dato: niente e' arrivato a Vinted.
      C.concludiArticolo(coda, c.id, { ok: false, outcome: "interrupted", categoria: "interrotto", sicuro: "si",
        error: "Il browser o l'estensione si sono fermati prima dell'invio: nessun annuncio creato o eliminato." }, ora);
      C.rimettiDopoInterruzione(coda, c.id, ora);
      testo = `Sessione interrotta durante la preparazione di: ${c.title} (rimesso in cima, niente era stato inviato).`;
    }
    await togliGiornale(c.id);
  }
  coda.state = "recovering";
  coda.nextAt = null;
  coda.note = null;
  C.registra(coda, "recupero", testo, c ? { id: c.id } : {});
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

// ------------------------------------------- controllo dell'articolo in corso

/**
 * Giornale di un tentativo: lo scrive la pagina che lavora l'articolo (fase,
 * id del nuovo annuncio appena Vinted lo restituisce, esito prima di mandarlo).
 * Sono prove, non stato della coda: se il messaggio con l'esito si perde, o la
 * pagina muore dopo aver creato l'annuncio, il service worker le trova qui.
 */
async function leggiGiornale(itemId, avviatoAt = null) {
  const chiave = GIORNALE + String(itemId);
  const g = (await chrome.storage.local.get(chiave))[chiave] || null;
  if (!g) return null;
  if (avviatoAt != null && g.avviatoAt != null && Number(g.avviatoAt) !== Number(avviatoAt)) return null;
  return g;
}
const togliGiornale = (itemId) => chrome.storage.local.remove(GIORNALE + String(itemId)).catch(() => {});

/** Giornali piu' vecchi di 14 giorni: l'articolo e' stato risolto o non lo sara' piu'. */
async function potaGiornali() {
  const tutto = await chrome.storage.local.get(null);
  const limite = Date.now() - 14 * 86400000;
  const vecchi = Object.keys(tutto).filter((k) => k.startsWith(GIORNALE) && !((tutto[k]?.at || 0) > limite));
  if (vecchi.length) await chrome.storage.local.remove(vecchi);
}

/**
 * Chiede alla scheda che lavora l'articolo se ci sta ancora lavorando.
 *   in-corso: si', con il passo attuale → si aspetta
 *   morto: scheda chiusa, scaricata, ricaricata o cambiata → il lavoro si e' fermato
 *   ignoto: la scheda c'e' ma non risponde (congelata, occupata) → si aspetta
 */
async function sondaScheda(tabId, itemId, avviatoAt) {
  if (!Number.isInteger(tabId)) return { stato: "ignoto", motivo: "non so quale scheda lo stesse lavorando" };
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { stato: "morto", motivo: "la scheda di Vinted è stata chiusa" };
  }
  if (tab?.discarded) return { stato: "morto", motivo: "il browser ha scaricato la scheda per liberare memoria" };
  try {
    const r = await conTimeout(chrome.tabs.sendMessage(tabId, { type: "vr:relistStatus", itemId: String(itemId), avviatoAt }), 10_000);
    if (r?.inCorso) return { stato: "in-corso", passo: String(r.passo || "").slice(0, 80), fase: r.fase, passoAt: Number(r.passoAt) || null };
    return { stato: "morto", motivo: "la pagina di Vinted è stata ricaricata o cambiata: il lavoro si è fermato" };
  } catch (e) {
    if (/Receiving end does not exist|Could not establish connection/i.test(String(e?.message))) {
      return { stato: "morto", motivo: "la pagina di Vinted è stata ricaricata o chiusa: il lavoro si è fermato" };
    }
    return { stato: "ignoto", motivo: "la scheda di Vinted non risponde" };
  }
}

/** Cosa fare quando il controllo scatta: mai un verdetto senza guardare. */
async function controllaLavoro() {
  const coda = C.migra(await leggiCoda());
  const c = C.corrente(coda);
  if (!coda?.running || !c) return;
  const avviatoAt = c.startedAt;

  // 1. La pagina aveva gia' scritto l'esito: si era perso solo il messaggio.
  const giornale = await leggiGiornale(c.id, avviatoAt);
  if (giornale?.esito) {
    return conCoda((q) => esitoCoda(q, { ...giornale.esito, itemId: c.id, avviatoAt }));
  }

  // 2. La scheda ci sta ancora lavorando? Allora si aspetta, fino al limite.
  const sonda = await sondaScheda(c.scheda, c.id, avviatoAt);
  const durata = Date.now() - (avviatoAt || Date.now());
  if (sonda.stato !== "morto" && durata < MAX_LAVORO_MIN * 60_000) {
    chrome.alarms.create(ALARM_WATCHDOG, { delayInMinutes: sonda.stato === "in-corso" ? WATCHDOG_MIN : 2 });
    return conCoda(async (q) => {
      const x = C.corrente(q);
      if (!x || x.id !== c.id || x.startedAt !== avviatoAt) return;
      x.controlli = (x.controlli || 0) + 1;
      if (x.controlli === 1 || sonda.stato === "ignoto") {
        C.registra(q, "controllo", sonda.stato === "in-corso"
          ? `Nessun esito dopo ${Math.round(durata / 60000)} min, ma la scheda sta ancora lavorando (${sonda.passo || "in corso"}): si aspetta.`
          : `Nessun esito dopo ${Math.round(durata / 60000)} min e ${sonda.motivo}: si riprova a chiedere tra poco.`, { id: x.id });
      }
      await scriviCoda(q);
    });
  }
  // Oltre il limite, ancora in preparazione: si chiede di fermarsi. Anche se
  // la richiesta non arrivasse, da qui il permesso di inviare verra' negato.
  if (sonda.stato !== "morto" && c.fase === "preparazione") await chiediAnnullamento(c.id, c.scheda);

  // 3. Il lavoro si e' fermato (o e' fuori tempo massimo): si decide con le prove.
  const motivo = sonda.stato === "morto" ? sonda.motivo : `nessun esito dopo ${MAX_LAVORO_MIN} minuti (${sonda.motivo || "la scheda lavora ancora"})`;
  return conCoda(async (q) => {
    const x = C.corrente(q);
    if (!x || x.id !== c.id || x.startedAt !== avviatoAt) return;      // nel frattempo e' arrivato l'esito
    const g = await leggiGiornale(x.id, avviatoAt);
    if (g?.esito) return esitoCoda(q, { ...g.esito, itemId: x.id, avviatoAt });
    if (g?.nuovoId) C.annotaTraccia(q, x.id, { nuovoId: g.nuovoId, fase: "creato" });
    if (x.fase === "preparazione") {
      return esitoCoda(q, { itemId: x.id, avviatoAt, ok: false, outcome: "interrupted", categoria: "interrotto", sicuro: "si",
        error: `${motivo[0].toUpperCase()}${motivo.slice(1)} prima dell'invio: nessun annuncio creato o eliminato.` });
    }
    return esitoCoda(q, { itemId: x.id, avviatoAt, ok: false, outcome: "uncertain", categoria: "incerto", sicuro: "no",
      error: (x.invioAt ? `Richiesta di pubblicazione inviata a Vinted alle ${oraBreve(x.invioAt)}, poi ${motivo}: nessuna conferma ricevuta. ` : `Avviato alle ${oraBreve(avviatoAt)}, poi ${motivo}: nessuna conferma ricevuta. `) +
        (g?.nuovoId || x.traccia?.nuovoId ? `Vinted aveva già restituito il nuovo annuncio (${g?.nuovoId || x.traccia.nuovoId}). ` : "Potrebbe essere già pubblicato. ") +
        "Non riprovare prima della verifica." });
  });
}

/** Verifica automatica degli incerti, qualche tentativo distanziato. */
function pianificaVerifica(minuti = VERIFICA_MIN) {
  chrome.alarms.create(ALARM_VERIFICA, { delayInMinutes: Math.max(0.5, minuti) });
}

/**
 * Verifica un articolo «da verificare» guardando Vinted (dalla pagina, che ha
 * la sessione): il vecchio annuncio esiste ancora? quello nuovo, se se ne
 * conosce l'id, esiste? c'e' nel tuo armadio un annuncio con le stesse foto
 * caricate in quel tentativo? Cambia lo stato solo con una prova
 * (C.valutaVerifica); altrimenti dice cosa manca.
 */
async function verificaArticolo(codaId, itemId, { automatica = false } = {}) {
  const id = String(itemId);
  const { vrQueue, vrQueueArchive = [] } = await chrome.storage.local.get({ vrQueue: null, vrQueueArchive: [] });
  const corrente = C.migra(vrQueue);
  const sessione = codaId == null || corrente?.startedAt === Number(codaId)
    ? corrente
    : vrQueueArchive.find((q) => q.startedAt === Number(codaId)) || null;
  const a = C.trova(sessione, id);
  if (!a) return { ok: false, motivo: "Articolo non trovato nella sessione." };
  if (a.status !== "verify") return { ok: false, motivo: `È «${C.ETICHETTE[a.status]}»: non c'è niente da verificare.` };

  const giornale = await leggiGiornale(id, a.startedAt);
  const traccia = { ...(a.traccia || {}), ...(giornale || {}), nuovoId: giornale?.nuovoId || a.traccia?.nuovoId || a.nuovoId || null };
  let v;
  if (giornale?.esito) {
    v = C.valutaVerifica({ giornale });
  } else {
    const tab = await schedaVinted();
    if (!tab) {
      v = { verdetto: "sconosciuto", mancano: ["nessuna scheda di Vinted aperta da cui controllare"], riprova: true };
    } else {
      try {
        const oss = await conTimeout(chrome.tabs.sendMessage(tab.id, {
          type: "vr:verifyRelist", itemId: id, nuovoId: traccia.nuovoId, fotoIds: traccia.fotoIds || [],
        }), 45_000);
        v = C.valutaVerifica({
          giornale: traccia, faseCoda: a.fase, vecchio: oss?.vecchio, nuovo: oss?.nuovo, trovato: oss?.trovato || null,
          eliminaVecchio: traccia.eliminaVecchio !== false,
        });
        if (oss?.limiti?.length) v.mancano = [...(v.mancano || []), ...oss.limiti];
        if (v.verdetto === "sconosciuto") v.riprova = true;
      } catch {
        v = { verdetto: "sconosciuto", mancano: ["la scheda di Vinted non ha risposto alla verifica (ricaricala)"], riprova: true };
      }
    }
  }

  // Si applica sotto il lock, alla coda e alla sua copia in archivio.
  const esito = await conCoda(async (q) => {
    let r = null;
    if (q && q.startedAt === sessione.startedAt && C.trova(q, id)) {
      r = C.applicaVerifica(q, id, v);
      const x = C.trova(q, id);
      if (automatica && x) x.verificheAuto = (x.verificheAuto || 0) + 1;
      await scriviCoda(q);
    }
    const { vrQueueArchive: arch = [] } = await chrome.storage.local.get("vrQueueArchive");
    let cambiato = false;
    for (const s of arch) {
      if (s.startedAt !== sessione.startedAt || !C.trova(s, id)) continue;
      const ra = C.applicaVerifica(s, id, v);
      r = r || ra;
      cambiato = true;
    }
    if (cambiato) await chrome.storage.local.set({ vrQueueArchive: arch });
    return r;
  });

  const risolto = Boolean(esito?.ok && !esito.invariato);
  if (risolto) {
    await togliGiornale(id);
    // Il valore dell'armadio segue solo le pubblicazioni verificate.
    if (v.verdetto === "pubblicato" && v.nuovoId) {
      await sostituisciInInventario({ oldId: id, newId: v.nuovoId, nuovo: { title: a.title, price: traccia.prezzo ?? null } });
    } else if ((v.verdetto === "parziale" || v.verdetto === "parziale-incerto") && v.nuovoId) {
      await annotaInventario({ [v.nuovoId]: { title: a.title, price: traccia.prezzo ?? null } });
    }
    await eventoEsito(sessione, { ...a, ...esito.articolo }, esito.stato);
  } else if (automatica && v.riprova && (a.verificheAuto || 0) + 1 < MAX_VERIFICHE_AUTO) {
    pianificaVerifica();
  }
  return {
    ok: risolto,
    stato: esito?.stato || a.status,
    verdetto: v.verdetto,
    motivo: risolto ? (v.prova || "") : (v.mancano || []).join("; ") || esito?.motivo || "nessuna prova sufficiente",
  };
}

/** Sveglia delle verifiche automatiche: gli incerti della coda salvata, pochi alla volta. */
async function verificheAutomatiche() {
  const coda = C.migra(await leggiCoda());
  const da = (coda?.items || []).filter((a) => a.status === "verify" && a.attendeEsito && (a.verificheAuto || 0) < MAX_VERIFICHE_AUTO).slice(0, 3);
  for (const a of da) await verificaArticolo(coda.startedAt, a.id, { automatica: true });
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
    campi: message.campi || null,
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

/**
 * Aggiunta a una coda in corso, senza fermarla e senza toccare le batch che ci
 * sono: gli articoli formano una batch nuova con le regole scelte nel Centro
 * di modifica (message.batch), oppure si uniscono a una batch esistente
 * (message.batchId).
 */
async function aggiungiAllaCoda(coda, message) {
  if (!coda?.running) return { ok: false, error: "Nessuna coda attiva: avviane una nuova." };
  if (coda.stopDopoCorrente) return { ok: false, error: "La coda si sta chiudendo: avviane una nuova quando ha finito." };
  const batch = message.batch && typeof message.batch === "object"
    ? { overrides: message.batch.overrides || null, campi: message.batch.campi || null, modello: message.batch.modello || null }
    : null;
  const r = C.aggiungi(coda, (message.items || []).slice(0, MAX_ID_PER_MESSAGGIO), {
    dove: message.dove === "cima" ? "cima" : "fondo",
    batch,
    batchId: message.batchId != null ? String(message.batchId) : null,
  });
  if (r.aggiunti.length || r.riattivati.length) await scriviCoda(coda);
  return { ok: r.ok, aggiunti: r.aggiunti, riattivati: r.riattivati, rifiutati: r.rifiutati, batch: r.batch, error: r.ok ? undefined : r.motivo };
}

/** Nuove regole per gli articoli in attesa di una batch. */
async function modificaBatchCoda(coda, message) {
  if (!coda?.running) return { ok: false, motivo: "Nessuna coda attiva." };
  if (coda.stopDopoCorrente) return { ok: false, motivo: "La sessione si sta chiudendo." };
  const r = C.modificaBatch(coda, String(message.batchId || ""), { overrides: message.overrides || null, campi: message.campi || null, modello: message.modello || null });
  if (r.ok) await scriviCoda(coda);
  return r;
}

/**
 * «Ripubblica ora»: l'articolo diventa il prossimo. Quello in elaborazione non
 * si tocca; in pausa o programmata resta tutto com'e' (sara' il primo alla
 * ripresa). In attesa tra un articolo e l'altro, parte appena possibile: almeno
 * un minuto dopo la pubblicazione precedente, per non farne due di fila.
 */
async function ripubblicaOraCoda(coda, message) {
  if (!coda?.running) return { ok: false, motivo: "Nessuna coda attiva." };
  if (coda.stopDopoCorrente) return { ok: false, motivo: "La sessione si sta chiudendo." };
  const [id] = idDa([message.id]);
  if (!id) return { ok: false, motivo: "Articolo non valido." };
  const r = C.ripubblicaOra(coda, id);
  if (!r.ok) return r;
  let partenza = null;
  if (coda.state === "waiting" && !C.corrente(coda)) {
    const ultimo = Math.max(0, ...coda.items.map((a) => (["done", "error", "verify"].includes(a.status) ? a.finishedAt || 0 : 0)));
    const quando = Math.max(Date.now() + 5_000, ultimo + STACCO_MIN_MS);
    if (!coda.nextAt || quando < coda.nextAt) {
      coda.nextAt = quando;
      chrome.alarms.create(ALARM_NEXT, { when: quando });
    }
    partenza = coda.nextAt;
  }
  await scriviCoda(coda);
  return { ...r, partenza, stato: coda.state };
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
    const scelti = ids || coda.items.filter((i) => i.status === "error" || i.status === "interrupted").map((i) => i.id);
    const r = C.riprova(coda, scelti);
    if (r.ok) await scriviCoda(coda);
    return { ok: r.ok, rimessi: r.rimessi, rifiutati: r.rifiutati, error: r.ok ? null : "Nessun articolo da riprovare." };
  }

  let origine = coda;
  if (codaId != null && coda?.startedAt !== codaId) {
    const { vrQueueArchive = [] } = await chrome.storage.local.get("vrQueueArchive");
    origine = vrQueueArchive.find((q) => q.startedAt === codaId) || null;
  }
  const falliti = (origine?.items || []).filter((i) => (i.status === "interrupted" || (i.status === "error" && i.sicuro !== "no")) && (!ids || ids.includes(String(i.id))));
  if (!falliti.length) return { ok: false, error: "Nessun articolo fallito da riprovare." };
  return rimettiPerBatch(coda, origine, falliti, { aggiuntaAllaCodaInCorso: Boolean(coda?.running) });
}

/**
 * Articoli di una sessione passata rimessi in coda CON LE REGOLE DELLA LORO
 * BATCH: un gruppo per batch d'origine. Fino alla 2.1 prendevano quelle della
 * coda in corso.
 */
async function rimettiPerBatch(coda, origine, articoli, extra = {}) {
  const gruppi = new Map();
  for (const a of articoli) {
    const b = C.batchDi(origine, a);
    const k = b?.id || "_";
    if (!gruppi.has(k)) gruppi.set(k, { b, voci: [] });
    gruppi.get(k).voci.push({ id: a.id, title: a.title, thumb: a.thumb, price: a.price });
  }
  const regole = (b) => ({ overrides: b?.overrides ?? origine.overrides ?? null, campi: b?.campi || null, modello: b?.modello ?? origine.modello ?? null });
  let risultato = null;
  for (const { b, voci } of gruppi.values()) {
    const attiva = coda?.running ? coda : null;
    const r = attiva
      ? await aggiungiAllaCoda(attiva, { items: voci, dove: "fondo", batch: regole(b) })
      : await avviaCoda(coda, { items: voci, intervalMin: origine.intervalMin, ...regole(b) });
    if (!attiva && r.ok) coda = C.migra(await leggiCoda());
    risultato = risultato
      ? { ...risultato, ok: risultato.ok || r.ok, aggiunti: [...(risultato.aggiunti || []), ...(r.aggiunti || [])], rifiutati: [...(risultato.rifiutati || []), ...(r.rifiutati || [])] }
      : r;
  }
  return { ...risultato, ...extra };
}

/** Riprende una sessione passata: solo cio' che non e' stato fatto, mai i completati. */
async function riprendiSessione(coda, message) {
  const codaId = Number(message.queue);
  const { vrQueueArchive = [] } = await chrome.storage.local.get("vrQueueArchive");
  const sessione = vrQueueArchive.find((q) => q.startedAt === codaId);
  if (!sessione) return { ok: false, error: "Sessione non più in archivio." };
  const { riprendibili, esclusi } = C.daRiprendere(sessione);
  if (!riprendibili.length) return { ok: false, error: "In questa sessione non c'è niente da riprendere.", esclusi };
  const r = await rimettiPerBatch(coda, sessione, riprendibili);
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

/**
 * All'avvio del service worker: se la coda salvata ha una struttura che il
 * codice attuale non si aspetta (dati di versioni vecchie, scritture a meta'),
 * si ripara in modo mirato prima di riprendere, lasciando traccia nel registro
 * errori (la diagnostica lo mostra) e una copia di com'era.
 */
async function recuperaConRiparazione() {
  const { vrQueue: grezza } = await chrome.storage.local.get("vrQueue");
  const problemi = C.controllaStruttura(grezza).filter((p) => !["schema", "batch", "registro"].includes(p.codice));
  if (problemi.length) {
    await registraErrore("avvio", "struttura", problemi.map((p) => p.codice).join(","));
    const { coda: riparata, correzioni } = C.riparaStruttura(grezza);
    if (riparata && correzioni.length) {
      await chrome.storage.local.set({ vrQueuePrimaRiparazione: { at: Date.now(), coda: grezza } });
      await scriviCoda(riparata);
    }
  }
  return recupera(C.migra(await leggiCoda()));
}

function recuperaCoda() { return conCoda(() => recuperaConRiparazione()); }
chrome.runtime.onStartup.addListener(recuperaCoda);
chrome.runtime.onInstalled.addListener(recuperaCoda);
chrome.runtime.onStartup.addListener(() => potaGiornali().catch(() => {}));
recuperaCoda();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NEXT) return conCoda(passoCoda);
  if (alarm.name === ALARM_SCANSIONE) return scansione();
  if (alarm.name === ALARM_RIPRESA) {
    return conCoda((coda) => (coda?.state === "paused" && coda.riprendiAlle ? riprendiCoda(coda) : null));
  }
  // Il controllo dell'articolo in corso: chiede, guarda le prove, poi decide.
  // La parte che aspetta la scheda sta fuori dal lock: popup e dashboard non
  // devono restare fermi per i secondi della sonda.
  if (alarm.name === ALARM_WATCHDOG) return controllaLavoro().catch((e) => console.warn("[Relist] controllo:", e));
  if (alarm.name === ALARM_VERIFICA) return verificheAutomatiche().catch((e) => console.warn("[Relist] verifica:", e));
  if (alarm.name === ALARM_AGGIORNAMENTI) return controllaAggiornamenti().catch((e) => registraErrore("aggiornamenti", "controllo", e?.message || e));
  return null;
});

/** Messaggi della coda: tutti passano dal lock, tutti rispondono con un esito. */
const MESSAGGI_CODA = {
  "vr:queueStart": (coda, m) => avviaCoda(coda, m),
  "vr:queueAdd": (coda, m) => aggiungiAllaCoda(coda, m),
  "vr:queueNow": (coda, m) => ripubblicaOraCoda(coda, m),
  "vr:queueBatchEdit": (coda, m) => modificaBatchCoda(coda, m),
  // La pagina chiede il permesso SUBITO PRIMA della prima richiesta che cambia
  // qualcosa su Vinted. Un no ferma il tentativo senza danni (vedi C.confermaInvio).
  //
  // 2.3: ogni no ha un codice e un motivo. Fino alla 2.2 un errore interno
  // (per esempio un salvataggio fallito) arrivava alla pagina senza motivo e
  // diventava «permesso negato», uguale per cause diverse.
  "vr:relistConfirm": async (coda, m) => {
    if (m.build && m.build !== BUILD) {
      const r = { ok: false, codice: "versione", tecnico: true,
        motivo: `la pagina di Vinted usa il codice ${String(m.build).slice(0, 20)} e il service worker il ${BUILD}: ricarica la scheda di Vinted (se non basta, ricarica l'estensione)` };
      await registraErrore("permesso", r.codice, r.motivo);
      return r;
    }
    const r = C.confermaInvio(coda, String(m.itemId), m.avviatoAt);
    if (!r.ok) {
      await registraErrore("permesso", r.codice, r.motivo);
      return r;
    }
    if (r.gia) return r;
    C.annotaTraccia(coda, String(m.itemId), { ...(m.traccia || {}), fase: "invio" });
    try {
      await scriviCodaConRiserva(coda);
    } catch (errore) {
      // Senza salvare «invio» non si puo' dare il permesso: dopo un riavvio
      // non si saprebbe che la richiesta era partita. Meglio fermarsi.
      const uso = await usoArchivio().catch(() => null);
      const motivo = `il service worker non riesce a salvare la coda (${V.ripulisci(errore?.message || errore)})` +
        (uso ? `; spazio usato ${uso.testo}` : "");
      await registraErrore("permesso", "salvataggio", motivo);
      return { ok: false, codice: "salvataggio", tecnico: true, ritentabile: true, motivo };
    }
    await scriviPasso({ itemId: String(m.itemId), step: "Pubblico…", fase: "invio", at: Date.now() });
    return r;
  },
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

// La verifica aspetta la pagina e Vinted: fuori dal lock, che prende solo per scrivere.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "vr:queueVerify") return false;
  verificaArticolo(message.queue ?? null, message.itemId)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, motivo: String(error?.message || error) }));
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const gestore = MESSAGGI_CODA[message?.type];
  if (!gestore) return false;
  conCoda((coda) => gestore(coda, message))
    .then((r) => sendResponse(r ?? { ok: true }))
    .catch((error) => {
      const testo = String(error?.message || error);
      registraErrore(message.type, "interno", testo);
      sendResponse({ ok: false, codice: "interno", tecnico: true, ritentabile: true, error: testo, motivo: `errore interno del service worker (${V.ripulisci(testo)})` });
    });
  return true;
});

// ------------------------------------------------------ spazio di archiviazione

/** Byte usati da chrome.storage.local, totale e per gruppo di chiavi (solo misure, mai contenuti). */
async function usoArchivio() {
  const quota = chrome.storage.local.QUOTA_BYTES || 10485760;
  const tutto = await chrome.storage.local.get(null);
  const totale = await chrome.storage.local.getBytesInUse(null);
  const gruppi = {};
  for (const k of Object.keys(tutto)) {
    const g = k.startsWith("vrBackup:") ? "vrBackup:*" : k.startsWith("vrOp:") ? "vrOp:*" : k;
    gruppi[g] = gruppi[g] || { chiavi: 0, byte: 0 };
    gruppi[g].chiavi++;
    gruppi[g].byte += new TextEncoder().encode(JSON.stringify(tutto[k]) || "").length + k.length;
  }
  const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
  return { totale, quota, percento: Math.round((totale / quota) * 1000) / 10, gruppi, testo: `${mb(totale)} su ${mb(quota)}` };
}

/**
 * Compattazione mirata, solo se lo spazio manca. Toglie quello che non serve
 * piu' a niente: giornali di tentativi gia' chiusi, registri lunghi delle
 * sessioni in archivio. Non tocca coda, esiti, inventario, statistiche,
 * impostazioni ne' le copie di sicurezza degli annunci (vrBackup:*).
 */
async function compattaArchivio() {
  const tutto = await chrome.storage.local.get(null);
  const coda = C.migra(tutto.vrQueue || null);
  const vivi = new Set((coda?.items || []).filter((a) => a.status === "working" || a.status === "verify").map((a) => a.id));
  const orfani = Object.keys(tutto).filter((k) => k.startsWith(GIORNALE) && !vivi.has(k.slice(GIORNALE.length)));
  if (orfani.length) await chrome.storage.local.remove(orfani);
  const archivio = (tutto.vrQueueArchive || []).map((q) => ({ ...q, log: (q.log || []).slice(-50) }));
  await chrome.storage.local.set({ vrQueueArchive: archivio, vrErrori: (tutto.vrErrori || []).slice(0, 20) });
  return { giornaliTolti: orfani.length };
}

const quotaPiena = (e) => /quota/i.test(String(e?.message || e));

/** Scrittura della coda che, se lo spazio e' finito, compatta e riprova una volta. */
async function scriviCodaConRiserva(coda) {
  try {
    await scriviCoda(coda);
  } catch (errore) {
    if (!quotaPiena(errore)) throw errore;
    await registraErrore("salvataggio", "quota", errore?.message || errore);
    await compattaArchivio();
    coda.rev = Math.max(0, (coda.rev || 1) - 1);
    await scriviCoda(coda);
  }
}

// ------------------------------------------------------ riparazione della coda

/**
 * «Ripara i dati della coda» (Salute): porta la coda salvata alla struttura
 * attuale (C.riparaStruttura), toglie i giornali orfani e ricrea le sveglie.
 * Prima tiene una copia della coda com'era (vrQueuePrimaRiparazione).
 * Non tocca archivio, inventario, statistiche, impostazioni.
 */
async function riparaCoda(coda) {
  const { vrQueue: grezza } = await chrome.storage.local.get("vrQueue");
  const problemi = C.controllaStruttura(grezza);
  const { coda: riparata, correzioni } = C.riparaStruttura(grezza);
  const giornali = await compattaArchivio().catch(() => ({ giornaliTolti: 0 }));
  if (grezza && correzioni.length) {
    await chrome.storage.local.set({ vrQueuePrimaRiparazione: { at: Date.now(), coda: grezza } });
    await scriviCoda(riparata);
  }
  if (riparata?.running) await recupera(C.migra((await chrome.storage.local.get("vrQueue")).vrQueue));
  return { ok: true, problemi, correzioni, giornaliTolti: giornali.giornaliTolti, copia: Boolean(grezza && correzioni.length) };
}

// ------------------------------------------------------------- diagnostica

const SITI_SCHEDE = SITI;

/**
 * Report di confronto fra due installazioni (Salute › Report diagnostico).
 * Solo stato tecnico: versioni, permessi, API, spazio, struttura dei dati,
 * sveglie, schede raggiungibili, errori recenti. Mai cookie, token, id
 * utente, titoli o testi degli annunci.
 */
async function rapportoDiagnostico() {
  const manifest = chrome.runtime.getManifest();
  const ora = Date.now();
  const sicuro = async (fn, ripiego = null) => { try { return await fn(); } catch (e) { return ripiego ?? { errore: V.ripulisci(e?.message || e) }; } };

  const permessi = await sicuro(async () => {
    const concessi = await chrome.permissions.getAll();
    const host = [];
    for (const o of manifest.host_permissions || []) host.push({ origine: o, concesso: await chrome.permissions.contains({ origins: [o] }) });
    return {
      richiesti: [...(manifest.permissions || [])].sort(),
      concessi: [...(concessi.permissions || [])].sort(),
      mancanti: (manifest.permissions || []).filter((p) => !(concessi.permissions || []).includes(p)).sort(),
      hostNegati: host.filter((h) => !h.concesso).map((h) => h.origine),
      hostConcessi: host.filter((h) => h.concesso).length,
      hostRichiesti: host.length,
    };
  });

  const dati = await chrome.storage.local.get(null);
  const coda = dati.vrQueue || null;
  const conta = {};
  for (const a of coda?.items || []) conta[a.status] = (conta[a.status] || 0) + 1;
  const campi = [...new Set((coda?.items || []).flatMap((a) => Object.keys(a || {})))].sort();
  const sveglie = await sicuro(async () => (await chrome.alarms.getAll()).map((a) => ({ nome: a.name, tra: Math.round((a.scheduledTime - ora) / 1000), periodoMin: a.periodInMinutes ?? null }))
    .sort((x, y) => x.nome.localeCompare(y.nome)), []);
  const sessione = await sicuro(async () => {
    const s = await chrome.storage.session.get(null);
    return { chiavi: Object.keys(s).sort(), tokenCsrf: Boolean(s.vrTokens?.csrf), passoInCorso: Boolean(s.vrQueueStep) };
  });

  // Le schede Vinted: il content script risponde? con quale codice? su che tipo di pagina?
  const schede = await sicuro(async () => {
    const tabs = await chrome.tabs.query({ url: SITI_SCHEDE });
    const out = [];
    for (const t of tabs.slice(0, 6)) {
      const r = await sicuro(() => conTimeout(chrome.tabs.sendMessage(t.id, { type: "vr:ping" }), 3000), null);
      out.push(r && !r.errore
        ? { risponde: true, build: r.build, manifest: r.manifest, pagina: r.pagina, utenteNoto: r.utenteNoto, lavorazioni: r.lavorazioni, scaricata: Boolean(t.discarded) }
        : { risponde: false, motivo: r?.errore || "nessuna risposta", scaricata: Boolean(t.discarded), stato: t.status });
    }
    return { aperte: tabs.length, dettaglio: out };
  }, { aperte: 0, dettaglio: [] });

  const impostazioni = {};
  for (const k of ["deleteOld", "order", "delayMs", "humanRhythm", "peakOnly", "canary", "autoFill", "autoRule", "queueIntervalMin", "autoUpdateCheck", "linksRemote", "consoleBridge"]) {
    impostazioni[k] = k in dati ? dati[k] : "(predefinita)";
  }

  return {
    formato: "vinted-relist-diagnosi",
    versioneFormato: 1,
    generato: new Date(ora).toISOString(),
    versioni: { manifest: manifest.version, serviceWorker: BUILD, codaLogica: C.VERSIONE || "(assente: file vecchio in memoria)" },
    browser: { userAgent: V.ripulisci(self.navigator?.userAgent || ""), marchi: (self.navigator?.userAgentData?.brands || []).map((b) => `${b.brand} ${b.version}`).sort() },
    serviceWorker: { avviatoAlle: new Date(AVVIO_SW).toISOString(), attivoDaS: Math.round((ora - AVVIO_SW) / 1000) },
    api: {
      storageSession: Boolean(chrome.storage?.session), alarms: Boolean(chrome.alarms), idle: Boolean(chrome.idle),
      notifications: Boolean(chrome.notifications), downloads: Boolean(chrome.downloads), getContexts: typeof chrome.runtime.getContexts === "function",
      getBytesInUse: typeof chrome.storage.local.getBytesInUse === "function",
    },
    permessi,
    archivio: await sicuro(async () => { const u = await usoArchivio(); return { totale: u.totale, quota: u.quota, percento: u.percento, gruppi: u.gruppi }; }),
    sessione,
    coda: coda ? {
      schema: coda.v ?? null, batch: Array.isArray(coda.batches) ? coda.batches.length : 0, attiva: Boolean(coda.running), stato: coda.state ?? null,
      articoli: (coda.items || []).length, perStato: conta, campiArticolo: campi, problemiStruttura: C.controllaStruttura(coda).map((p) => p.codice),
      incorso: (coda.items || []).filter((a) => a.status === "working").map((a) => ({ fase: a.fase ?? null, scheda: Number.isInteger(a.scheda), daS: a.startedAt ? Math.round((ora - a.startedAt) / 1000) : null })),
    } : null,
    archivioSessioni: { sessioni: (dati.vrQueueArchive || []).length, conBatch: (dati.vrQueueArchive || []).filter((q) => Array.isArray(q.batches)).length },
    giornali: Object.keys(dati).filter((k) => k.startsWith(GIORNALE)).length,
    copieSicurezza: Object.keys(dati).filter((k) => k.startsWith("vrBackup:")).length,
    inventario: { articoli: Object.keys(dati.inventory || {}).length, sostituiti: Object.keys(dati.vrInventoryReplaced || {}).length },
    aggiornamenti: { ultimoControllo: dati.updateCheck?.at ? new Date(dati.updateCheck.at).toISOString() : null, esito: dati.updateCheck?.remota?.ok ? dati.updateCheck.remota.versione : dati.updateCheck?.remota?.errore || null, notificata: dati.updateNotified?.versione || null },
    sveglie,
    schede,
    impostazioni,
    datiVecchi: Object.keys(dati).filter((k) => ["showOnOtherProfiles", "queueOverrides"].includes(k)).sort(),
    erroriRecenti: (dati.vrErrori || []).slice(0, 20).map((e) => ({ quando: new Date(e.at).toISOString(), dove: e.dove, codice: e.codice, messaggio: e.messaggio, build: e.build })),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "vr:diagnosi") {
    rapportoDiagnostico().then(sendResponse, (e) => sendResponse({ errore: String(e?.message || e) }));
    return true;
  }
  if (message?.type === "vr:riparaCoda") {
    conCoda((coda) => riparaCoda(coda)).then(sendResponse, (e) => sendResponse({ ok: false, motivo: String(e?.message || e) }));
    return true;
  }
  if (message?.type === "vr:updateCheckNow") {
    controllaAggiornamenti({ manuale: true }).then(sendResponse, (e) => sendResponse({ ok: false, errore: String(e?.message || e) }));
    return true;
  }
  return false;
});

// ---------------------------------------------------- aggiornamenti periodici

/**
 * Ogni 12 ore (chrome.alarms: sopravvive alla sospensione del service worker
 * e al riavvio del browser) si legge il version.json del repository, la
 * stessa fonte di «Cerca aggiornamento». Una notifica per versione: si
 * ricorda l'ultima notificata (updateNotified) e si avvisa solo per una piu'
 * recente. Niente richieste all'apertura del popup.
 */
const ALARM_AGGIORNAMENTI = "vr:updateCheck";
const AGGIORNAMENTI_ORE = 12;

async function programmaControlloAggiornamenti() {
  const { autoUpdateCheck = true } = await chrome.storage.local.get("autoUpdateCheck");
  if (!autoUpdateCheck) return chrome.alarms.clear(ALARM_AGGIORNAMENTI);
  const esiste = await chrome.alarms.get(ALARM_AGGIORNAMENTI);
  if (!esiste || esiste.periodInMinutes !== AGGIORNAMENTI_ORE * 60) {
    chrome.alarms.create(ALARM_AGGIORNAMENTI, { delayInMinutes: 2, periodInMinutes: AGGIORNAMENTI_ORE * 60 });
  }
}

async function controllaAggiornamenti({ manuale = false } = {}) {
  const d = await chrome.storage.local.get({ updateRepo: "", updateCheck: null, updateNotified: null, autoUpdateCheck: true });
  if (!manuale && !d.autoUpdateCheck) return { ok: false, spento: true };
  const repo = d.updateRepo || V.REPO;
  const installata = chrome.runtime.getManifest().version;

  // Un controllo recente (anche manuale, dal popup) basta: niente richieste doppie.
  const recente = d.updateCheck?.repo === repo && d.updateCheck.at && Date.now() - d.updateCheck.at < (manuale ? V.ATTESA_CONTROLLO_MS : (AGGIORNAMENTI_ORE * 60 - 30) * 60_000);
  let remota = recente ? d.updateCheck.remota : null;
  if (!recente) {
    try {
      const risposta = await fetch(V.urlVersione(repo), { headers: { Accept: "application/vnd.github.raw+json" }, cache: "no-store", credentials: "omit" });
      remota = risposta.ok ? V.leggiVersioneRemota(await risposta.text()) : { ok: false, errore: V.erroreGithub(risposta.status) };
    } catch {
      remota = { ok: false, errore: V.erroreGithub(0) };
    }
    await chrome.storage.local.set({ updateCheck: { at: Date.now(), repo, remota, automatico: !manuale } });
  }

  const decisione = V.daNotificare(installata, remota, d.updateNotified?.versione || null);
  // Cercata a mano: la vedi gia' nel popup, conta come avvisata (niente notifica dopo).
  if (decisione.notifica && manuale) {
    await chrome.storage.local.set({ updateNotified: { versione: decisione.versione, at: Date.now(), vista: true } });
  } else if (decisione.notifica) {
    await chrome.storage.local.set({ updateNotified: { versione: decisione.versione, at: Date.now() } });
    const testo = (remota.note || [])[0] || "Le novità sono nel popup, Salute › Versione.";
    await registraEvento({ kind: "info", title: `Disponibile la versione ${decisione.versione}`, text: `Hai la ${installata}. ${testo}` });
    chrome.notifications.create(`vr-agg-${decisione.versione}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: `Vinted Relist ${decisione.versione} disponibile`,
      message: `Hai la ${installata}. ${testo}`.slice(0, 200),
      contextMessage: "Clic per scaricarla da Salute",
    });
  }
  return { ok: Boolean(remota?.ok), remota, notificata: decisione.notifica ? decisione.versione : null, motivo: decisione.motivo || null };
}

chrome.storage.onChanged.addListener((modifiche, area) => {
  if (area === "local" && modifiche.autoUpdateCheck) programmaControlloAggiornamenti();
});
chrome.runtime.onStartup.addListener(() => programmaControlloAggiornamenti());
programmaControlloAggiornamenti();

// 2.3: i bottoni compaiono solo nel tuo armadio; l'opzione «Mostra ovunque» non c'e' piu'.
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.remove("showOnOtherProfiles").catch(() => {}));

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
  if (id.startsWith("vr-agg-")) await apriPagina("src/popup.html#salute");
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
