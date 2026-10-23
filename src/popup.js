/* Popup: Home (coda e attivita'), Notifiche, Salute, Impostazioni. */
const VR = window.VR;
const V = window.Versione;
const I = window.Impostazioni;
const h = VR.h;
const el = (id) => document.getElementById(id);

const SITI = ["it","fr","es","de","co.uk","com","be","nl","at","pt","pl","cz","sk","lt","lu","ro","hu"]
  .map((d) => `https://www.vinted.${d}/*`);
const VERSIONE = chrome.runtime.getManifest().version;

// L'ultimo dominio Vinted visitato: il popup non puo' dedurlo da solo.
let origine = "https://www.vinted.it";
let userId = null;
let coda = null;
let eventi = [];
let tic = null;

el("version").textContent = `v${VERSIONE}`;
el("installed").textContent = VERSIONE;

/** Aperto come scheda (per l'import) invece che come popup. */
let inScheda = false;
chrome.tabs.getCurrent?.().then((t) => {
  inScheda = Boolean(t);
  document.body.classList.toggle("in-tab", inScheda);
}).catch(() => {});

const apriScheda = (url) => chrome.tabs.create({ url });
const apriPagina = (pagina) => chrome.runtime.sendMessage({ type: "vr:openPage", pagina }).catch(() => {});

// ------------------------------------------------------------------ viste

let vista = "home";

function mostraVista(nome) {
  vista = nome;
  for (const v of document.querySelectorAll(".view")) v.hidden = v.dataset.view !== nome;
  for (const t of document.querySelectorAll(".tab")) {
    const on = t.dataset.tab === nome;
    t.classList.toggle("is-on", on);
    t.setAttribute("aria-selected", String(on));
  }
  el("openSettings").classList.toggle("is-on", nome === "impostazioni");
  el("headTitle").textContent = nome === "impostazioni" ? "Impostazioni" : "Vinted Relist";
  el("views").scrollTop = 0;
  if (nome === "notifiche") disegnaEventi(true);
  if (nome === "salute") disegnaSalute();
}

for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => mostraVista(t.dataset.tab));
el("openSettings").addEventListener("click", () => mostraVista(vista === "impostazioni" ? "home" : "impostazioni"));
el("backFromSettings").addEventListener("click", () => mostraVista("home"));
el("closePopup").addEventListener("click", () => window.close());
el("healthRow").addEventListener("click", () => mostraVista("salute"));
el("openDashboard").addEventListener("click", () => { apriPagina("src/dashboard.html"); window.close(); });

// Frecce sinistra/destra tra le schede, come si aspetta chi usa la tastiera.
document.querySelector(".tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const tabs = [...document.querySelectorAll(".tab")];
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const prossima = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  prossima.focus();
  mostraVista(prossima.dataset.tab);
});

// ---------------------------------------------------------------- utilita'

const euro = (n) => Number(n).toLocaleString("it-IT", { style: "currency", currency: "EUR" });

function fa(at) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "ora";
  if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  if (s < 86400) return `${Math.floor(s / 3600)} h fa`;
  return new Date(at).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

function manca(ms) {
  if (ms <= 0) return "a momenti";
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return min > 0 ? `${min} min ${String(sec).padStart(2, "0")}s` : `${sec}s`;
}

const linkArmadio = () => (userId ? `${origine}/member/${userId}` : origine);
const linkArticolo = (id) => `${origine}/items/${encodeURIComponent(id)}`;
const thumbSicura = (u) => (/^https:\/\/[\w.-]*vinted\.(net|com)\//.test(String(u || "")) ? u : null);

function comando(tipo, extra = {}) {
  return chrome.runtime.sendMessage({ type: tipo, ...extra }).catch(() => ({ ok: false }));
}

function bottone(testo, classe, azione) {
  return h("button", { class: `btn ${classe}`, type: "button", onclick: azione }, testo);
}

// ------------------------------------------------------------------- coda

// Stessa logica di service worker e dashboard: conteggi, corrente, salute.
const CL = window.CodaLogica;
let passo = null;                       // vrQueueStep, da storage.session

function conta(c) {
  const r = CL.conta(c);
  return { ...r, rimanenti: r.pending + r.working };
}

function anello(fatti, totale) {
  const r = 27;
  const giro = 2 * Math.PI * r;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  for (const [classe, offset] of [["ring-bg", 0], ["ring-fg", giro * (1 - (totale ? fatti / totale : 0))]]) {
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "32"); c.setAttribute("cy", "32"); c.setAttribute("r", String(r));
    c.setAttribute("class", classe);
    c.setAttribute("stroke-dasharray", String(giro));
    c.setAttribute("stroke-dashoffset", String(offset));
    svg.append(c);
  }
  return h("div", { class: "ring", role: "img", "aria-label": `${fatti} di ${totale} articoli trattati` },
    svg, h("span", {}, `${fatti}/${totale}`));
}

function contatori(r) {
  return h("div", { class: "counters" },
    h("div", { class: "ok" }, h("b", {}, r.done), h("span", {}, "Completati")),
    h("div", { class: "error" }, h("b", {}, r.error), h("span", {}, "Falliti")),
    h("div", { class: "warn" }, h("b", {}, r.verify), h("span", {}, "Da verificare")),
    h("div", {}, h("b", {}, r.rimanenti), h("span", {}, "Rimanenti")));
}

/** Testa della coda in corso: titolo, chip di stato, sottotitolo. */
function statoCoda(c) {
  const corrente = CL.corrente(c);
  const prossimo = CL.prossimo(c);
  if (c.stopDopoCorrente) return { titolo: "Coda in chiusura", chip: "In chiusura", classe: "warn", sotto: "Aspetto l'esito dell'articolo in corso." };
  switch (c.state) {
    case "working": {
      const mio = passo?.itemId === corrente?.id ? passo.step : null;
      return { titolo: "Coda in esecuzione", chip: c.pausaDopoCorrente ? "Pausa dopo questo" : "In corso", sotto: mio || "Pubblicazione in corso…" };
    }
    case "paused":
      return { titolo: c.pausaAuto ? "Coda fermata da sola" : "Coda in pausa", chip: "In pausa", classe: "warn",
        sotto: c.motivoPausa || (c.riprendiAlle ? `Riprende alle ${new Date(c.riprendiAlle).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}.` : "Riprende da dove si era fermata.") };
    case "scheduled":
      return { titolo: "Coda programmata", chip: "Programmata",
        sotto: `Parte ${new Date(c.nextAt).toLocaleString("it-IT", { weekday: "long", hour: "2-digit", minute: "2-digit" })}` };
    case "recovering":
      return { titolo: "Coda interrotta", chip: "Interrotta", classe: "warn",
        sotto: "Il browser o l'estensione si sono fermati: riprendi o annulla." };
    default:
      return { titolo: "Coda in esecuzione", chip: "In attesa",
        sotto: c.note || (prossimo ? `Prossimo tra ${manca((c.nextAt || 0) - Date.now())}: ${prossimo.title}` : "") };
  }
}

/** Una riga con l'indicatore di salute: cosa sta succedendo e cosa fare. */
function rigaSalute(c) {
  const s = CL.salute(c);
  if (s.livello === "ok" && c.running) return null;
  return h("p", { class: `desc health-${s.livello}`, role: "status" }, h("b", {}, `${s.titolo}. `), `${s.perche} `, s.azione !== "Niente da fare." ? s.azione : "");
}

function disegnaCoda() {
  const card = el("queueCard");
  card.textContent = "";

  if (!coda?.items?.length) {
    clearInterval(tic);
    tic = null;
    card.append(
      h("div", { class: "queue-empty" },
        h("span", { class: "dot" }),
        h("div", {},
          h("b", {}, "Nessuna coda attiva"),
          h("span", { class: "desc" }, userId
            ? "Seleziona gli articoli da ripubblicare per iniziare."
            : "Apri Vinted da loggato: l'estensione rileva il tuo profilo da sola."))),
      h("a", { class: "btn btn-primary block", href: linkArmadio(), target: "_blank", rel: "noopener" },
        userId ? "Apri armadio e seleziona articoli" : "Apri Vinted"));
    return;
  }

  const r = conta(coda);
  const gestisci = () => bottone("Gestisci coda", "", () => { apriPagina("src/dashboard.html#coda"); window.close(); });

  if (coda.running) {
    const s = statoCoda(coda);
    const corrente = CL.corrente(coda);
    card.append(h("div", { class: "queue-top" },
      anello(r.trattati, r.totale),
      h("div", { class: "queue-info" },
        h("b", {}, s.titolo),
        h("div", { class: "queue-sub", title: s.sotto }, s.sotto),
        h("span", { class: `state-chip ${s.classe || ""}` }, s.chip))));

    const shownItem = corrente || (coda.state !== "recovering" ? CL.prossimo(coda) : null);
    if (shownItem) {
      const thumb = thumbSicura(shownItem.thumb);
      card.append(h("a", { class: "current", href: linkArticolo(shownItem.id), target: "_blank", rel: "noopener", style: "text-decoration:none;color:inherit" },
        thumb ? h("img", { src: thumb, alt: "", loading: "lazy" }) : h("span", { class: "ph" }),
        h("span", { class: "current-text" },
          h("b", {}, shownItem.title || `Articolo ${shownItem.id}`),
          `${corrente ? "In elaborazione" : "Prossimo"} · ID ${shownItem.id}`)));
    }

    const azioni = h("div", { class: "queue-actions" });
    if (coda.stopDopoCorrente) {
      azioni.append(gestisci());
    } else if (coda.state === "recovering") {
      azioni.append(bottone("Riprendi", "btn-primary", () => comando("vr:queueRecover")),
        bottone("Annulla coda", "danger", () => comando("vr:queueStop")));
    } else if (coda.state === "paused") {
      azioni.append(bottone("Riprendi", "btn-primary", () => comando("vr:queueResume")),
        bottone("Interrompi", "danger", () => comando("vr:queueStop")));
    } else if (coda.state === "scheduled") {
      azioni.append(bottone("Annulla", "danger", () => comando("vr:queueStop")));
    } else if (corrente) {
      // In lavorazione non si "salta": si chiede di annullare, e vale solo se non ha ancora inviato niente.
      const tardi = passo?.itemId === corrente.id && passo.fase === "invio";
      azioni.append(
        coda.pausaDopoCorrente
          ? bottone("Annulla la pausa", "", () => comando("vr:queueResume"))
          : bottone("Pausa", "", () => comando("vr:queuePause")),
        h("button", { class: "btn", type: "button", disabled: tardi ? "" : null,
          title: tardi ? "La richiesta a Vinted è già partita: si aspetta l'esito." : "Ferma l'articolo se non ha ancora inviato niente a Vinted.",
          onclick: () => comando("vr:queueCancelCurrent") }, "Annulla operazione"),
        bottone("Interrompi", "danger", () => comando("vr:queueStop")));
    } else {
      azioni.append(
        bottone("Pausa", "", () => comando("vr:queuePause")),
        bottone("Salta il prossimo", "", () => comando("vr:queueSkip")),
        bottone("Interrompi", "danger", () => comando("vr:queueStop")));
    }
    card.append(azioni, contatori(r), rigaSalute(coda) || "", h("div", { class: "queue-actions" }, coda.stopDopoCorrente ? "" : gestisci()));

    // il conto alla rovescia deve scorrere anche col popup fermo
    const serveTic = !["working", "paused", "recovering"].includes(coda.state);
    if (serveTic && !tic) tic = setInterval(disegnaCoda, 1000);
    if (!serveTic && tic) { clearInterval(tic); tic = null; }
    return;
  }

  // ------------------------------------------------ coda conclusa
  clearInterval(tic);
  tic = null;
  const daGuardare = r.error + r.verify;
  card.append(h("div", { class: "queue-top" },
    anello(r.trattati, r.totale),
    h("div", { class: "queue-info" },
      h("b", {}, daGuardare ? `Coda finita: ${daGuardare} da guardare` : "Coda finita"),
      h("div", { class: "queue-sub" }, coda.note || `${r.done} ripubblicati`),
      h("span", { class: `state-chip ${daGuardare ? "warn" : ""}` }, daGuardare ? "Da controllare" : "Completata"))),
    contatori(r));

  const problemi = coda.items.filter((v) => v.status === "error" || v.status === "verify");
  if (problemi.length) {
    const lista = h("ul", { class: "problems" });
    for (const v of problemi.slice(0, 8)) {
      const li = h("li", {},
        h("span", { class: `tag ${v.status}` }, v.status === "error" ? "fallito" : "da verificare"),
        h("a", { href: linkArticolo(v.id), target: "_blank", rel: "noopener" }, v.title || `Articolo ${v.id}`),
        h("span", { class: "why" }, v.error || ""));
      if (v.status === "verify") {
        li.append(h("div", { class: "btn-row" },
          bottone("È stato pubblicato", "", () => comando("vr:queueResolve", { itemId: v.id, pubblicato: true, queue: coda.startedAt })),
          bottone("Non è uscito", "", () => comando("vr:queueResolve", { itemId: v.id, pubblicato: false, queue: coda.startedAt }))));
      }
      lista.append(li);
    }
    if (problemi.length > 8) lista.append(h("li", {}, `…e altri ${problemi.length - 8}: li trovi nella dashboard.`));
    card.append(lista);
  }

  const azioni = h("div", { class: "queue-actions" });
  const riprovabili = coda.items.filter((v) => v.status === "error" && v.sicuro !== "no").length;
  if (riprovabili) azioni.append(bottone(`Riprova i falliti (${riprovabili})`, "btn-primary", async () => {
    const esito = await comando("vr:queueRetry", { queue: coda.startedAt });
    if (esito && esito.ok === false) card.append(h("p", { class: "desc error" }, esito.error || "Non sono riuscito a riavviare la coda."));
  }));
  if (daGuardare) azioni.append(bottone("Dettagli", "", () => { apriPagina(`src/dashboard.html#coda-${coda.startedAt}`); window.close(); }));
  azioni.append(bottone("Nascondi", "quiet", () => comando("vr:queueClear")));
  card.append(azioni);
}

// --------------------------------------------------------------- attivita'

function disegnaAttivita(storia) {
  const ora = Date.now();
  const entro = (giorni) => storia.filter((v) => v.at > ora - giorni * 86400000).length;
  el("statToday").textContent = storia.filter((v) => new Date(v.at).toDateString() === new Date().toDateString()).length;
  el("statWeek").textContent = entro(7);
  el("statMonth").textContent = entro(30);

  // Ripubblicare lo stesso articolo ogni giorno rende meno che non farlo affatto.
  const ripetuti = new Set();
  const visti = new Set();
  for (const v of storia.filter((x) => x.at > ora - 7 * 86400000)) {
    if (visti.has(v.id)) ripetuti.add(v.id);
    visti.add(v.id);
  }
  el("statHint").textContent = ripetuti.size
    ? `${ripetuti.size} articoli ripubblicati più di una volta negli ultimi 7 giorni.`
    : "Lo stesso articolo rende di più se ripubblicato ogni 5–7 giorni.";
}

// --------------------------------------------------------------- notifiche

let filtro = "tutte";
const PROBLEMI = new Set(["error", "uncertain", "warn"]);

function aggiornaBadgeNotifiche() {
  const nuove = eventi.filter((e) => !e.read);
  const badge = el("unreadBadge");
  badge.hidden = !nuove.length;
  badge.textContent = nuove.length > 99 ? "99+" : String(nuove.length);
  badge.classList.toggle("problem", nuove.some((e) => e.kind === "error" || e.kind === "uncertain"));
}

function disegnaEventi(segnaLette = false) {
  const lista = el("events");
  lista.textContent = "";
  const visibili = eventi.filter((e) => filtro === "tutte" || PROBLEMI.has(e.kind));
  el("eventsEmpty").hidden = visibili.length > 0;
  el("eventsEmpty").textContent = filtro === "tutte"
    ? "Nessuna notifica. Esiti della coda, errori e aggiornamenti compaiono qui."
    : "Nessun problema registrato.";

  for (const e of visibili.slice(0, 80)) {
    const destinazione = e.queue
      ? () => { apriPagina(`src/dashboard.html#coda-${e.queue}`); window.close(); }
      : e.itemId ? () => apriScheda(linkArticolo(e.itemId)) : null;
    const li = h("li", {
      class: `event${e.read ? "" : " is-new"}${destinazione ? " clickable" : ""}`,
      tabindex: destinazione ? "0" : null,
      role: destinazione ? "link" : null,
    },
      h("span", { class: `event-mark ${e.kind}` }),
      h("div", { class: "event-body" }, h("b", {}, e.title), e.text ? h("p", {}, e.text) : null),
      h("span", { class: "event-time", title: new Date(e.at).toLocaleString("it-IT") }, fa(e.at)));
    if (destinazione) {
      li.addEventListener("click", destinazione);
      li.addEventListener("keydown", (k) => { if (k.key === "Enter") destinazione(); });
    }
    lista.append(li);
  }

  // Aperta la scheda, le notifiche sono lette: il badge sull'icona si spegne.
  if (segnaLette && eventi.some((e) => !e.read)) comando("vr:eventsRead");
}

for (const chip of document.querySelectorAll("[data-filtro]")) {
  chip.addEventListener("click", () => {
    filtro = chip.dataset.filtro;
    for (const c of document.querySelectorAll("[data-filtro]")) c.classList.toggle("is-on", c === chip);
    disegnaEventi();
  });
}

el("clearEvents").addEventListener("click", async () => {
  await chrome.storage.local.set({ vrEvents: [] });
  comando("vr:eventsRead");             // ricalcola il badge sull'icona
});

// ------------------------------------------------------------------ salute

/**
 * Controlli locali, senza chiamate a Vinted. "info" non e' un problema:
 * per esempio non avere una scheda Vinted aperta va bene finche' non c'e' una coda.
 */
async function controlli() {
  const d = await chrome.storage.local.get(["photoFormat", "itemFormat", "colorMap", "inventory"]);
  let csrf = false;
  try {
    const { vrTokens } = await chrome.storage.session.get("vrTokens");
    csrf = Boolean(vrTokens?.csrf);      // solo se c'e', mai il valore
  } catch { /* storage.session non disponibile */ }
  let schede = 0;
  try { schede = (await chrome.tabs.query({ url: SITI })).length; } catch { /* ignora */ }

  const codaViva = Boolean(coda?.running);
  const r = coda?.items ? conta(coda) : null;
  const colori = Object.keys(d.colorMap || {}).length;
  const articoli = Object.keys(d.inventory || {}).length;

  return [
    { nome: "Profilo Vinted", livello: userId ? "ok" : "warn",
      dettaglio: userId ? "rilevato" : "non ancora rilevato: apri Vinted da loggato" },
    { nome: "Scheda Vinted aperta", livello: schede ? "ok" : codaViva ? "warn" : "info",
      dettaglio: schede ? `${schede} aperte` : codaViva ? "la coda ne ha bisogno per pubblicare" : "nessuna (serve solo durante la coda)" },
    { nome: "Sessione", livello: csrf ? "ok" : codaViva ? "warn" : "info",
      dettaglio: csrf ? "attiva (il token non viene mostrato)" : "si attiva navigando su Vinted" },
    { nome: "Formato foto", livello: d.photoFormat ? "ok" : "info",
      dettaglio: d.photoFormat ? "imparato da Vinted" : "predefinito: si aggiorna quando carichi una foto su Vinted" },
    { nome: "Formato annuncio", livello: d.itemFormat?.fields?.length ? "ok" : "info",
      dettaglio: d.itemFormat?.fields?.length ? `${d.itemFormat.fields.length} campi imparati` : "predefinito: si aggiorna quando modifichi un annuncio" },
    { nome: "Articoli conosciuti", livello: articoli ? "ok" : "info",
      dettaglio: articoli ? `${articoli}, raccolti aprendo il tuo armadio` : "apri il tuo armadio almeno una volta" },
    { nome: "Colori conosciuti", livello: colori ? "ok" : "info",
      dettaglio: colori ? `${colori}` : "nessuno: si imparano dagli annunci letti" },
    (() => {
      // Lo stesso indicatore della dashboard: livello, perche', cosa fare.
      const sal = CL.salute(coda);
      const livello = { ok: "ok", vuota: "ok", pausa: "info" }[sal.livello] || "warn";
      return { nome: "Coda", livello, dettaglio: !r ? "nessuna" : `${sal.titolo.toLowerCase()} — ${sal.perche}` };
    })(),
  ];
}

async function disegnaStatoGenerale() {
  const c = await controlli();
  const problemi = c.filter((x) => x.livello === "warn");
  el("healthDot").className = `dot ${problemi.length ? "warn" : "ok"}`;
  el("healthText").textContent = problemi.length
    ? `Da controllare: ${problemi.map((p) => p.nome.toLowerCase()).join(", ")}`
    : "Pronto";
  el("healthBadge").hidden = !problemi.length;
  return c;
}

async function disegnaSalute() {
  const c = await disegnaStatoGenerale();
  const lista = el("checks");
  lista.textContent = "";
  for (const x of c) {
    lista.append(h("li", {}, h("span", { class: `dot ${x.livello === "info" ? "" : x.livello}` }),
      h("span", {}, x.nome, h("small", {}, x.dettaglio))));
  }
  mostraAggiornamento();
  caricaChangelog();
}

el("verify").addEventListener("click", async () => {
  const b = el("verify");
  const esito = el("verifyResult");
  b.disabled = true;
  b.textContent = "Controllo…";
  esito.hidden = false;
  esito.className = "desc";
  esito.textContent = "Leggo un articolo e preparo il payload, senza pubblicare niente.";
  try {
    const [scheda] = await chrome.tabs.query({ url: SITI });
    if (!scheda) throw new Error("apri una scheda sul tuo armadio Vinted.");
    const r = await chrome.tabs.sendMessage(scheda.id, { type: "vr:canaryAny" });
    if (r?.ok) {
      esito.className = r.avvisi?.length ? "desc warn" : "desc ok";
      esito.textContent = r.avvisi?.length
        ? `Pubblicabile, con avvisi: ${r.avvisi.join(" · ")}`
        : "Tutto in regola: la coda può partire.";
    } else {
      esito.className = "desc error";
      esito.textContent = `Problemi: ${(r?.problemi || ["nessuna risposta dalla pagina: ricaricala"]).join(" · ")}`;
    }
  } catch (errore) {
    esito.className = "desc error";
    esito.textContent = `Non riesco a verificare: ${errore.message}`;
  }
  b.disabled = false;
  b.textContent = "Verifica formato su un articolo";
});

// ------------------------------------------------------------- diagnostica

el("makeDiag").addEventListener("click", async () => {
  const [impostazioni, { vrEvents = [] }, c] = await Promise.all([
    chrome.storage.local.get(VR.DEFAULTS),
    chrome.storage.local.get("vrEvents"),
    controlli(),
  ]);
  const testo = V.costruisciDiagnostica({
    versione: VERSIONE,
    impostazioni,
    coda,
    eventi: vrEvents,
    controlli: c.map((x) => ({ ok: x.livello !== "warn", nome: x.nome, dettaglio: x.dettaglio })),
    ambiente: navigator.userAgent,
  });
  el("diagText").value = testo;
  el("diagBox").hidden = false;
});

el("copyDiag").addEventListener("click", async () => {
  const b = el("copyDiag");
  try {
    await navigator.clipboard.writeText(el("diagText").value);
  } catch {
    el("diagText").select();
    document.execCommand("copy");
  }
  b.textContent = "Copiata";
  setTimeout(() => (b.textContent = "Copia diagnostica"), 1500);
});

// ----------------------------------------------------------- aggiornamenti

const repoAttuale = async () => (await chrome.storage.local.get({ updateRepo: "" })).updateRepo || V.REPO;

async function mostraAggiornamento() {
  const { updateCheck } = await chrome.storage.local.get("updateCheck");
  const testo = el("updateResult");
  const box = el("updateAvailable");
  box.hidden = true;
  if (!updateCheck) {
    testo.className = "desc";
    testo.textContent = "Il controllo legge il file version.json del progetto su GitHub. Nessun dato tuo viene inviato.";
    return;
  }
  const stato = V.statoAggiornamento(VERSIONE, updateCheck.remota);
  testo.className = `desc ${stato.stato === "errore" ? "error" : stato.stato === "disponibile" ? "warn" : "ok"}`;
  testo.textContent = `${stato.testo} Ultimo controllo: ${fa(updateCheck.at)}.`;

  if (stato.stato === "disponibile") {
    box.hidden = false;
    const note = el("updateNotes");
    note.textContent = "";
    for (const n of updateCheck.remota.note || []) note.append(h("li", {}, n));
    const zip = updateCheck.remota.zip;
    el("downloadZip").disabled = !zip;
    el("downloadZip").title = zip || "Il version.json non indica lo zip";
    el("downloadZip").onclick = () => zip && apriScheda(V.urlZip(zip, updateCheck.repo));
    avvisoRicarica();
  }
}

/** Ricaricare a meta' pubblicazione lascerebbe l'articolo "da verificare". */
function avvisoRicarica() {
  const b = el("reloadExt");
  const avviso = el("reloadWarn");
  const lavora = coda?.running && coda.state === "working";
  b.disabled = Boolean(lavora);
  avviso.hidden = !coda?.running;
  avviso.textContent = lavora
    ? "Un articolo è in pubblicazione proprio ora: aspetta che finisca o metti in pausa la coda."
    : coda?.running
      ? "C'è una coda attiva: dopo l'aggiornamento risulterà «interrotta» e andrà ripresa con Riprendi."
      : "";
}

el("checkUpdate").addEventListener("click", async () => {
  const b = el("checkUpdate");
  const repo = await repoAttuale();
  const { updateCheck } = await chrome.storage.local.get("updateCheck");
  if (updateCheck?.repo === repo && !V.puoControllare(updateCheck)) {
    await mostraAggiornamento();
    el("updateResult").textContent += " Riprova tra un minuto per un controllo nuovo.";
    return;
  }

  b.disabled = true;
  b.textContent = "Controllo…";
  let remota;
  try {
    const risposta = await fetch(V.urlVersione(repo), {
      headers: { Accept: "application/vnd.github.raw+json" },
      cache: "no-store",
      credentials: "omit",
    });
    remota = risposta.ok
      ? V.leggiVersioneRemota(await risposta.text())
      : { ok: false, errore: V.erroreGithub(risposta.status) };
  } catch {
    remota = { ok: false, errore: V.erroreGithub(0) };
  }
  await chrome.storage.local.set({ updateCheck: { at: Date.now(), repo, remota } });
  b.disabled = false;
  b.textContent = "Cerca aggiornamento";
  await mostraAggiornamento();
});

// ------------------------------------------------------------------- link

/**
 * GitHub, Discord, Ko-fi e gli altri link vengono da links.json (vedi
 * link-chrome.js): qui si collegano e basta. Se la rete manca restano
 * quelli gia' noti; nessun avviso ripetuto, solo una riga in Salute.
 */
const LC = window.LinkChrome;
const statoLink = (r, s) => { el("linksState").textContent = window.LinkProgetto.descriviStato(r, s); };
LC?.avvia(document, { dopo: statoLink });

el("checkUpdate").addEventListener("click", () => {
  // Chi cerca un aggiornamento vuole anche i link freschi (al massimo una richiesta al minuto).
  LC?.avvia(document, { forza: true, dopo: statoLink });
});

el("reloadExt").addEventListener("click", () => {
  // Il codice nuovo e' quello che hai estratto nella cartella: niente arriva da Internet.
  chrome.runtime.reload();
});

let changelogCaricato = false;
async function caricaChangelog() {
  if (changelogCaricato) return;
  changelogCaricato = true;
  const box = el("changelog");
  try {
    const md = await (await fetch(chrome.runtime.getURL("CHANGELOG.md"))).text();
    for (const s of V.sezioniChangelog(md, 3)) {
      box.append(h("h3", {}, `${s.versione}${s.titolo ? ` · ${s.titolo}` : ""}`),
        h("ul", {}, s.righe.slice(0, 8).map((r) => h("li", {}, r))));
    }
    if (!box.childElementCount) box.append(h("p", { class: "desc" }, "Changelog vuoto."));
  } catch {
    box.append(h("p", { class: "desc" }, "Changelog non disponibile."));
  }
}

// ------------------------------------------------------------ impostazioni

const campi = [...document.querySelectorAll("[data-key]")];
let salvatoTimer = null;

function segnaSalvato(testo = "Salvato", errore = false) {
  const f = el("savedFlag");
  f.textContent = testo;
  f.classList.toggle("error", errore);
  clearTimeout(salvatoTimer);
  salvatoTimer = setTimeout(() => (f.textContent = ""), 1600);
}

const valoreDi = (input) => (input.type === "checkbox" ? input.checked : input.value);

function erroreCampo(input, messaggio) {
  let nodo = input.parentElement.querySelector(".field-error");
  if (!nodo && messaggio) {
    nodo = h("span", { class: "field-error", id: `err-${input.dataset.key}`, role: "alert" });
    input.after(nodo);
    input.setAttribute("aria-describedby", nodo.id);
  }
  if (nodo) { nodo.textContent = messaggio || ""; nodo.hidden = !messaggio; }
  input.classList.toggle("is-invalid", Boolean(messaggio));
  input.setAttribute("aria-invalid", String(Boolean(messaggio)));
}

function riempiCampi(valori) {
  for (const input of campi) {
    const v = valori[input.dataset.key];
    if (input.type === "checkbox") input.checked = Boolean(v);
    else input.value = v ?? "";
    erroreCampo(input, null);
  }
}

for (const input of campi) {
  const chiave = input.dataset.key;
  // la validazione si vede mentre scrivi, il salvataggio avviene a campo confermato
  if (input.type !== "checkbox" && input.tagName !== "SELECT") {
    input.addEventListener("input", () => {
      const r = I.validaImpostazione(chiave, valoreDi(input));
      erroreCampo(input, r.ok ? null : r.errore);
    });
  }
  input.addEventListener("change", async () => {
    const r = I.validaImpostazione(chiave, valoreDi(input));
    if (!r.ok) {
      erroreCampo(input, r.errore);
      segnaSalvato("Non salvato: correggi il campo", true);
      return;
    }
    erroreCampo(input, null);
    if (input.type !== "checkbox" && input.tagName !== "SELECT") input.value = r.valore;
    await chrome.storage.local.set({ [chiave]: r.valore });
    segnaSalvato();
    if (chiave === "updateRepo") await chrome.storage.local.remove("updateCheck");
  });
}

chrome.storage.local.get(VR.DEFAULTS).then(riempiCampi);

el("tutorial").addEventListener("click", async () => {
  await chrome.storage.local.set({ seenOnboarding: false });
  segnaSalvato("Il tutorial ricompare alla prossima pagina Vinted");
});

// backup delle impostazioni
el("exportSettings").addEventListener("click", async () => {
  const tutte = await chrome.storage.local.get(VR.DEFAULTS);
  const dati = I.esportaImpostazioni(tutte, VERSIONE);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(dati, null, 2))}`;
  try {
    await chrome.downloads.download({ url, filename: `Vinted Relist/vinted-relist-impostazioni-${dati.creato}.json`, saveAs: false });
    el("backupResult").className = "desc ok";
    el("backupResult").textContent = "Salvato nella cartella Download › Vinted Relist.";
  } catch (e) {
    el("backupResult").className = "desc error";
    el("backupResult").textContent = `Esportazione non riuscita: ${e.message}`;
  }
});

el("importSettings").addEventListener("click", () => {
  // Il selettore di file chiude il popup prima di restituire il file: si apre in una scheda.
  if (!inScheda) {
    apriPagina("src/popup.html#impostazioni");
    window.close();
    return;
  }
  el("importFile").click();
});

el("importFile").addEventListener("change", async () => {
  const file = el("importFile").files?.[0];
  el("importFile").value = "";
  const esito = el("backupResult");
  if (!file) return;
  if (file.size > 100_000) {
    esito.className = "desc error";
    esito.textContent = "File troppo grande per essere un backup delle impostazioni.";
    return;
  }
  const r = I.importaImpostazioni(await file.text());
  if (!r.ok) {
    esito.className = "desc error";
    esito.textContent = r.errore;
    return;
  }
  await chrome.storage.local.set(r.valori);
  riempiCampi(await chrome.storage.local.get(VR.DEFAULTS));
  esito.className = "desc ok";
  esito.textContent = `Importate ${Object.keys(r.valori).length} impostazioni` +
    (r.scartate.length ? `; scartate perché non valide: ${r.scartate.join(", ")}.` : ".");
});

// copie di sicurezza degli annunci (vrBackup:*)
chrome.storage.local.get(null).then((tutto) => {
  const voci = Object.entries(tutto).filter(([chiave]) => chiave.startsWith("vrBackup:"));
  if (!voci.length) return;
  el("draftsBlock").hidden = false;
  for (const [chiave, valore] of voci) {
    el("drafts").append(h("div", {},
      `${valore.draft?.title || chiave.split(":")[1]} — ${new Date(valore.at).toLocaleDateString("it-IT")}`,
      valore.draft?.price ? ` · ${euro(valore.draft.price?.amount ?? valore.draft.price)}` : ""));
  }
  el("copyDrafts").addEventListener("click", async () => {
    await navigator.clipboard.writeText(JSON.stringify(Object.fromEntries(voci), null, 2));
    el("copyDrafts").textContent = "Copiato";
    setTimeout(() => (el("copyDrafts").textContent = "Copia negli appunti"), 1500);
  });
});

// ------------------------------------------------------------------- avvio

chrome.storage.local.get(["userId", "vintedOrigin", "vrQueue", "vrHistory", "vrEvents", "inventory"]).then((d) => {
  if (d.vintedOrigin && /^https:\/\/www\.vinted\.[a-z.]+$/.test(d.vintedOrigin)) origine = d.vintedOrigin;
  userId = d.userId || null;
  coda = CL.migra(d.vrQueue || null);
  eventi = d.vrEvents || [];
  disegnaCoda();
  disegnaAttivita(d.vrHistory || []);
  aggiornaBadgeNotifiche();
  disegnaStatoGenerale();
  const quanti = Object.keys(d.inventory || {}).length;
  el("autoRuleHint").textContent = quanti
    ? `${quanti} articoli conosciuti, raccolti aprendo il tuo armadio.`
    : "Apri il tuo armadio almeno una volta: è da lì che l'estensione impara quali articoli hai.";

  vistaDaHash();
});

/** popup.html#notifiche (o #salute, #impostazioni) apre direttamente quella vista. */
function vistaDaHash() {
  const richiesta = location.hash.slice(1);
  if (["home", "notifiche", "salute", "impostazioni"].includes(richiesta)) mostraVista(richiesta);
}
window.addEventListener("hashchange", vistaDaHash);

chrome.storage.session?.get("vrQueueStep").then((r) => { passo = r?.vrQueueStep || null; disegnaCoda(); }).catch(() => {});

chrome.storage.onChanged.addListener((modifiche, area) => {
  if (area === "session" && modifiche.vrQueueStep) {
    passo = modifiche.vrQueueStep.newValue || null;
    disegnaCoda();
    return;
  }
  if (area !== "local") return;
  if ((modifiche.vrLinks || modifiche.linksRemote || modifiche.updateRepo) && LC) {
    // Aggiornati da un'altra pagina (dashboard o un altro popup).
    Promise.all([LC.risolti(), LC.stato()]).then(([r, st]) => { LC.collega(document, r); statoLink(r, st); }).catch(() => {});
  }
  if (modifiche.userId) {
    userId = modifiche.userId.newValue || null;
    disegnaCoda();
    disegnaStatoGenerale();
  }
  if (modifiche.vintedOrigin?.newValue) origine = modifiche.vintedOrigin.newValue;
  if (modifiche.vrQueue) {
    coda = CL.migra(modifiche.vrQueue.newValue || null);
    disegnaCoda();
    disegnaStatoGenerale();
    if (vista === "salute") avvisoRicarica();
  }
  if (modifiche.vrHistory) disegnaAttivita(modifiche.vrHistory.newValue || []);
  if (modifiche.vrEvents) {
    eventi = modifiche.vrEvents.newValue || [];
    aggiornaBadgeNotifiche();
    if (vista === "notifiche") disegnaEventi();
  }
});
