/* Dashboard dell'armadio: legge solo quello che l'estensione ha gia' raccolto. */
const A = window.Analisi;
const el = (id) => document.getElementById(id);
const SITI = ["it","fr","es","de","co.uk","com","be","nl","at","pt","pl","cz","sk","lt","lu","ro","hu"]
  .map((d) => `https://www.vinted.${d}/*`);

const GRUPPI = [
  { chiave: "recenti", nome: "Recenti", colore: "var(--green)", spiega: "ripubblicati negli ultimi 7 giorni" },
  { chiave: "ottimizzare", nome: "Da ottimizzare", colore: "var(--amber)", spiega: "completezza sotto 70" },
  { chiave: "stagnanti", nome: "Stagnanti", colore: "var(--red)", spiega: "fermi da 21 giorni o più" },
  { chiave: "mai", nome: "Mai ripubblicati", colore: "var(--muted)", spiega: "mai toccati dall'estensione" },
  { chiave: "regola", nome: "In regola", colore: "var(--teal)", spiega: "nessuna azione necessaria" },
];

let dati = null;
let filtro = null;
let cerca = "";
let ordine = "relist";
let codaScelta = null;          // startedAt della coda mostrata
let filtroCoda = "tutti";
let codaRichiesta = false;      // arrivati da #coda: il pannello si mostra anche senza problemi

const STATI = {
  done: { nome: "Completato", classe: "ok" },
  error: { nome: "Fallito", classe: "error" },
  verify: { nome: "Da verificare", classe: "warn" },
  skipped: { nome: "Saltato", classe: "" },
  cancelled: { nome: "Annullato", classe: "" },
  pending: { nome: "In attesa", classe: "" },
};

/** Ricerca che ignora maiuscole e accenti: "perche" trova "perché". */
const piano = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const miniatura = (u) => (/^https:\/\/[a-z0-9.-]*vinted\.(net|com)\//i.test(String(u || "")) ? u : null);

const euro = (n) =>
  typeof n === "number" ? n.toLocaleString("it-IT", { style: "currency", currency: "EUR" }) : "—";

const quandoFa = (t) => {
  if (!t) return "mai";
  const giorni = Math.floor((Date.now() - t) / 86400000);
  if (giorni <= 0) return "oggi";
  if (giorni === 1) return "ieri";
  return `${giorni} giorni fa`;
};

function crea(tag, attr = {}, ...figli) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attr)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const f of figli.flat()) if (f != null && f !== false) n.append(f.nodeType ? f : String(f));
  return n;
}

// -------------------------------------------------------------------- disegno

function disegna() {
  const { inventory, qualityScores, vrSnapshots, vintedOrigin } = dati;
  const ids = Object.keys(inventory);
  const gruppi = A.classifica(inventory, qualityScores);
  const valore = A.valoreTotale(inventory);
  const doppi = A.duplicati(inventory);
  const sospetti = new Set(doppi.flatMap((c) => [c.a, c.b]));
  const gruppoDi = {};
  for (const [g, lista] of Object.entries(gruppi)) for (const id of lista) gruppoDi[id] = g;

  el("summary").textContent = ids.length
    ? `${ids.length} articoli conosciuti`
    : "Nessun articolo ancora: apri il tuo armadio su Vinted e torna qui.";
  el("value").textContent = euro(valore.totale);
  el("value").title = `Somma di ${valore.conPrezzo} prezzi letti dalle card`;

  // gruppi
  const box = el("groups");
  box.textContent = "";
  for (const g of GRUPPI) {
    box.append(
      crea("button", {
        class: `group${filtro === g.chiave ? " is-active" : ""}`,
        title: g.spiega,
        onclick: () => { filtro = filtro === g.chiave ? null : g.chiave; disegna(); },
      },
        crea("b", {}, gruppi[g.chiave].length),
        crea("span", {}, crea("i", { class: "dot", style: `background:${g.colore}` }), g.nome)
      )
    );
  }
  el("clearFilter").hidden = !filtro;

  // duplicati
  el("duplicatesPanel").hidden = !doppi.length;
  const dup = el("duplicates");
  dup.textContent = "";
  for (const c of doppi) {
    const link = (id) => crea("a", { href: `${vintedOrigin}/items/${id}`, target: "_blank" }, inventory[id].title);
    dup.append(crea("div", { class: "dup" },
      crea("span", { class: "pct" }, `${Math.round(c.somiglianza * 100)}%`),
      crea("span", {}, link(c.a), " · ", link(c.b))
    ));
  }

  disegnaAndamento();

  // articoli
  const testo = piano(cerca.trim());
  const righe = ordina(ids
    .filter((id) => !filtro || gruppoDi[id] === filtro)
    .filter((id) => !testo || piano(inventory[id].title).includes(testo) || id === testo), inventory, qualityScores);

  const corpo = el("items");
  corpo.textContent = "";
  for (const id of righe) {
    const art = inventory[id];
    const q = qualityScores[id]?.score;
    const foto = miniatura(art.thumb);
    const img = foto ? crea("img", { src: foto, alt: "", loading: "lazy", decoding: "async", width: "40", height: "40" }) : null;
    // se il CDN non ha piu' la foto (annuncio ripubblicato), resta il riquadro vuoto
    img?.addEventListener("error", () => img.replaceWith(crea("span", { class: "ph" })));
    corpo.append(crea("tr", {},
      crea("td", { class: "thumb-col" }, img || crea("span", { class: "ph" })),
      crea("td", {},
        crea("a", { href: `${vintedOrigin}/items/${id}`, target: "_blank" }, art.title || `Articolo ${id}`),
        sospetti.has(id) ? crea("span", { class: "tag dup-tag" }, "possibile duplicato") : null
      ),
      crea("td", { class: "num" }, euro(art.price)),
      crea("td", { class: "num" }, art.views ?? "—"),
      crea("td", { class: "num" }, art.favs ?? "—"),
      crea("td", {}, quandoFa(art.relistedAt)),
      crea("td", { class: `num score${q != null && q < 70 ? " low" : ""}` }, q != null ? q : "—")
    ));
  }
  el("itemsHint").textContent = righe.length
    ? `${righe.length} di ${ids.length} articoli. La qualità compare dopo che l'estensione ha letto l'articolo (ripubblicandolo o aprendo Modifica).`
    : testo ? `Nessun articolo contiene «${cerca.trim()}».` : filtro ? "Nessun articolo in questo gruppo." : "";

  disegnaStorico(vrSnapshots);
  disegnaCoda();
}

/** Ordinamento della tabella; a parità, l'id tiene l'ordine stabile. */
function ordina(ids, inventory, qualita) {
  const n = (v, vuoto) => (typeof v === "number" ? v : vuoto);
  const chiavi = {
    relist: (id) => inventory[id].relistedAt || 0,
    "relist-desc": (id) => -(inventory[id].relistedAt || 0),
    price: (id) => n(inventory[id].price, Infinity),
    "price-desc": (id) => -n(inventory[id].price, -Infinity),
    "views-desc": (id) => -n(inventory[id].views, -1),
    "favs-desc": (id) => -n(inventory[id].favs, -1),
    quality: (id) => n(qualita[id]?.score, Infinity),
  };
  if (ordine === "title") {
    return [...ids].sort((a, b) => String(inventory[a].title || "").localeCompare(String(inventory[b].title || ""), "it"));
  }
  const k = chiavi[ordine] || chiavi.relist;
  return [...ids].sort((a, b) => k(a) - k(b) || a.localeCompare(b));
}

function disegnaAndamento() {
  const { inventory, vrSnapshots } = dati;
  const box = el("insight");
  box.textContent = "";

  const misure = A.misure(vrSnapshots, inventory);
  const andamento = A.andamento(misure, 3);

  // Senza abbastanza dati diciamo cosa manca, non numeri inventati.
  if (andamento.totale < 3) {
    box.append(
      crea("p", { class: "progress" },
        crea("b", {}, `${andamento.totale} misure`), " raccolte finora, ne servono almeno 3 per fascia."),
      crea("p", { class: "hint" },
        "Una misura sono le visite del nuovo annuncio a circa 48 ore. Si registra quando " +
        "riapri il tuo armadio tra 1 e 3 giorni dopo una ripubblicazione: l'estensione " +
        "legge le visite dalle card, senza chiamate in più a Vinted.")
    );
    return;
  }

  const giorno = andamento.giorni[0];
  const fascia = andamento.fasce[0];
  box.append(crea("p", { class: "progress" },
    crea("b", {}, `${andamento.totale} misure`), " sulle tue ripubblicazioni."));

  const grid = crea("div", { class: "insight-grid" });
  grid.append(
    crea("div", { class: "fact" },
      crea("small", {}, "Giorno migliore"),
      crea("strong", {}, giorno ? giorno.nome : "—"),
      crea("em", {}, giorno ? ` ${giorno.media} visite medie a 48h su ${giorno.n} relist` : " servono più misure per giorno")
    ),
    crea("div", { class: "fact" },
      crea("small", {}, "Fascia migliore"),
      crea("strong", {}, fascia ? fascia.nome : "—"),
      crea("em", {}, fascia ? ` ${fascia.media} visite medie a 48h su ${fascia.n} relist` : " servono più misure per fascia")
    )
  );
  box.append(grid);

  // consigli per singolo articolo, solo dove le misure bastano
  let mostrati = 0;
  for (const catena of A.catene(vrSnapshots)) {
    const c = A.consiglioArticolo(catena, inventory, 3);
    if (!c.sufficiente || mostrati >= 5) continue;
    mostrati++;

    const titolo = catena[catena.length - 1].new.title;
    let testo = `Rende di più ripubblicato di ${c.giorno}, in fascia ${c.fascia}`;
    if (c.sulPrezzo === "invariato") testo += ", senza toccare il prezzo";
    else if (c.sulPrezzo === "variato") testo += ", cambiando il prezzo";
    testo += ".";
    if (c.prezzoMin != null) {
      testo += ` Le visite migliori sono arrivate tra ${euro(c.prezzoMin)} e ${euro(c.prezzoMax)}.`;
    }

    box.append(crea("div", { class: "advice" }, crea("b", {}, titolo), testo));
  }
}

function disegnaStorico(snapshots) {
  const box = el("history");
  box.textContent = "";

  if (!snapshots.length) {
    box.append(crea("p", { class: "empty" }, "Nessuna ripubblicazione registrata."));
    return;
  }

  // Un relist e' superato se il suo annuncio nuovo e' stato ripubblicato a sua volta:
  // quell'id non esiste piu', e ripristinarlo non avrebbe senso.
  const superati = new Set(snapshots.map((s) => s.old.id));

  for (const s of [...snapshots].reverse()) {
    const superato = superati.has(s.new.id);
    const cambioPrezzo = s.old.price !== s.new.price
      ? `${euro(s.old.price)} → ${euro(s.new.price)}`
      : euro(s.new.price);
    const misura = s.visite48 ?? A.visite48(dati.inventory[s.new.id]?.series, s.at);

    const bottone = crea("button", {
      class: "btn",
      disabled: superato || s.restoredAt ? "" : null,
      title: superato ? "Ripubblicato di nuovo dopo: non c'è più niente da ripristinare" : "",
      onclick: () => ripristina(s, bottone),
    }, s.restoredAt ? "Ripristinato" : superato ? "Superato" : "Ripristina");

    box.append(crea("div", { class: "snap" },
      crea("span", { class: "n" }, `#${s.n}`),
      crea("div", { class: "what" },
        crea("b", {}, s.new.title || s.old.title),
        crea("span", {},
          `${new Date(s.at).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` +
          ` · ${cambioPrezzo}` +
          (misura != null ? ` · ${misura} visite a 48h` : " · misura in corso")),
        confronto(s)
      ),
      bottone
    ));
  }
}

/** Prima e dopo, campo per campo. La descrizione "dopo" c'e' solo dalla 2.0.0. */
function confronto(s) {
  const righe = [
    ["Titolo", s.old.title, s.new.title],
    ["Prezzo", euro(s.old.price), euro(s.new.price)],
    ["Descrizione", s.old.description, s.new.description],
  ];
  const cambiati = righe.filter(([, a, b]) => b != null && a !== b).length;
  const tabella = crea("table", { class: "compare" },
    crea("thead", {}, crea("tr", {}, crea("th", {}, ""), crea("th", {}, "Prima"), crea("th", {}, "Dopo"))),
    crea("tbody", {}, righe.map(([nome, a, b]) => {
      const uguale = b == null ? null : a === b;
      return crea("tr", { class: uguale === false ? "changed" : "" },
        crea("th", {}, nome),
        crea("td", {}, a || "—"),
        crea("td", {}, b == null ? crea("em", {}, "non registrato") : uguale ? crea("em", {}, "invariato") : b));
    })));
  return crea("details", { class: "compare-box" },
    crea("summary", {}, cambiati ? `Confronto prima/dopo (${cambiati} ${cambiati === 1 ? "modifica" : "modifiche"})` : "Confronto prima/dopo"),
    tabella);
}

// ----------------------------------------------------------------------- coda

function codeDisponibili() {
  const elenco = [];
  const corrente = dati.vrQueue;
  if (corrente?.items?.length) elenco.push({ ...corrente, corrente: true });
  for (const q of dati.vrQueueArchive) {
    if (!elenco.some((x) => x.startedAt === q.startedAt)) elenco.push(q);
  }
  return elenco.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

const daGuardare = (q) => (q?.items || []).some((i) => i.status === "error" || i.status === "verify");
const quandoCoda = (q) => new Date(q.startedAt).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function disegnaCoda() {
  const pannello = el("coda");
  const code = codeDisponibili();
  const q = code.find((x) => x.startedAt === codaScelta) || (codaScelta == null ? code[0] : null);

  // Senza una richiesta esplicita il pannello compare solo se c'e' qualcosa da guardare.
  pannello.hidden = !(codaRichiesta || daGuardare(code[0]));
  if (pannello.hidden) return;

  const scelta = el("queuePick");
  scelta.textContent = "";
  for (const x of code) {
    scelta.append(crea("option", { value: String(x.startedAt) },
      `${quandoCoda(x)} · ${x.items.length} articoli${x.corrente && x.running ? " (in corso)" : ""}${x.auto ? " · automatica" : ""}`));
  }
  scelta.hidden = code.length < 2;
  const lista = el("queueList");
  const azioni = el("queueActions");
  const contatori = el("queueCounters");
  const filtri = el("queueFilters");
  lista.textContent = ""; azioni.textContent = ""; contatori.textContent = ""; filtri.textContent = "";

  if (!q) {
    el("queueTitle").textContent = "Coda non trovata";
    el("queueNote").textContent = code.length
      ? "Questa coda non è più in archivio: si tengono le ultime 10. Sotto puoi scegliere tra quelle rimaste."
      : "Nessuna coda registrata.";
    if (code.length) { codaScelta = code[0].startedAt; scelta.value = String(codaScelta); }
    return;
  }
  scelta.value = String(q.startedAt);

  el("queueTitle").textContent = q.corrente && q.running ? "Coda in corso" : `Coda del ${quandoCoda(q)}`;
  el("queueNote").textContent = [q.note, q.finishedAt ? `finita ${quandoFa(q.finishedAt)}` : null].filter(Boolean).join(" · ");

  const conta = {};
  for (const v of q.items) conta[v.status] = (conta[v.status] || 0) + 1;
  for (const k of ["done", "error", "verify", "skipped", "cancelled", "pending"]) {
    if (!conta[k]) continue;
    contatori.append(crea("div", { class: STATI[k].classe }, crea("b", {}, conta[k]), crea("span", {}, STATI[k].nome)));
  }

  const usati = ["tutti", ...Object.keys(STATI).filter((k) => conta[k])];
  if (!usati.includes(filtroCoda)) filtroCoda = "tutti";
  for (const k of usati) {
    filtri.append(crea("button", {
      class: `chip${filtroCoda === k ? " is-active" : ""}`, type: "button", "aria-pressed": String(filtroCoda === k),
      onclick: () => { filtroCoda = k; disegnaCoda(); },
    }, k === "tutti" ? `Tutti (${q.items.length})` : `${STATI[k].nome} (${conta[k]})`));
  }

  const ordineStati = { verify: 0, error: 1, pending: 2, done: 3, skipped: 4, cancelled: 5 };
  const voci = q.items
    .filter((v) => filtroCoda === "tutti" || v.status === filtroCoda)
    .sort((a, b) => (ordineStati[a.status] ?? 9) - (ordineStati[b.status] ?? 9));

  for (const v of voci) {
    const corrente = q.corrente && q.running && q.items[q.index] === v;
    const stato = corrente ? { nome: "In corso", classe: "ok" } : STATI[v.status] || { nome: v.status, classe: "" };
    const foto = miniatura(v.thumb);
    const img = foto ? crea("img", { src: foto, alt: "", loading: "lazy", width: "40", height: "40" }) : null;
    img?.addEventListener("error", () => img.replaceWith(crea("span", { class: "ph" })));
    const li = crea("li", { class: `q-${v.status}` },
      img || crea("span", { class: "ph" }),
      crea("div", { class: "q-body" },
        crea("a", { href: `${dati.vintedOrigin}/items/${encodeURIComponent(v.id)}`, target: "_blank", rel: "noopener" }, v.title || `Articolo ${v.id}`),
        crea("span", { class: `tag ${stato.classe}` }, stato.nome),
        v.error ? crea("p", { class: "q-why" }, v.error) : null));
    if (v.status === "verify") {
      li.append(crea("div", { class: "q-resolve" },
        crea("button", { class: "btn", type: "button", onclick: () => risolvi(v.id, true, q.startedAt) }, "È stato pubblicato"),
        crea("button", { class: "btn", type: "button", onclick: () => risolvi(v.id, false, q.startedAt) }, "Non è uscito")));
    }
    lista.append(li);
  }

  if (conta.verify) {
    azioni.append(crea("p", { class: "hint" },
      "«Da verificare» vuol dire che Vinted non ha dato una risposta chiara: apri l'articolo o il tuo armadio, " +
      "guarda se il nuovo annuncio c'è e dillo qui. Così non viene ripubblicato due volte."));
  }
  if (conta.error && !(q.corrente && q.running)) {
    const b = crea("button", { class: "btn btn-primary", type: "button" }, `Riprova i falliti (${conta.error})`);
    b.addEventListener("click", async () => {
      b.disabled = true;
      const r = await chrome.runtime.sendMessage({ type: "vr:queueRetry", queue: q.startedAt }).catch((e) => ({ ok: false, error: e.message }));
      const nota = crea("p", { class: `hint ${r?.ok ? "ok" : "error"}` }, r?.ok
        ? "Coda avviata con i soli articoli falliti. Tieni aperta una scheda su Vinted."
        : r?.error || "Non sono riuscito ad avviare la coda.");
      azioni.append(nota);
      if (!r?.ok) b.disabled = false;
    });
    azioni.prepend(b);
  }
}

async function risolvi(itemId, pubblicato, queue) {
  await chrome.runtime.sendMessage({ type: "vr:queueResolve", itemId, pubblicato, queue }).catch(() => {});
}

/** #coda o #coda-<id>: apre il pannello su quella coda e ci porta la vista. */
function leggiHash() {
  const m = /^#coda(?:-(\d+))?$/.exec(location.hash);
  if (!m) return;
  codaRichiesta = true;
  codaScelta = m[1] ? Number(m[1]) : null;
  filtroCoda = "tutti";
  if (!dati) return;
  disegnaCoda();
  const pannello = el("coda");
  pannello.scrollIntoView({ behavior: "smooth", block: "start" });
  pannello.focus({ preventScroll: true });
  pannello.classList.add("flash");
  setTimeout(() => pannello.classList.remove("flash"), 1600);
}

window.addEventListener("hashchange", leggiHash);
el("queuePick").addEventListener("change", (e) => {
  codaScelta = Number(e.target.value);
  filtroCoda = "tutti";
  history.replaceState(null, "", `#coda-${codaScelta}`);
  disegnaCoda();
});

// ----------------------------------------------------------------- ripristino

async function ripristina(s, bottone) {
  const ok = window.confirm(
    `Ripubblico "${s.new.title}" con titolo, descrizione e prezzo di prima (${euro(s.old.price)}).\n\n` +
    "L'annuncio attuale verrà sostituito. Continuo?"
  );
  if (!ok) return;

  bottone.disabled = true;
  bottone.textContent = "In corso…";

  try {
    const [scheda] = await chrome.tabs.query({ url: SITI });
    if (!scheda) throw new Error("apri una scheda su Vinted e riprova");

    const esito = await chrome.tabs.sendMessage(scheda.id, {
      type: "vr:restore",
      newId: s.new.id,
      overrides: { title: s.old.title, description: s.old.description, price: s.old.price },
    });
    if (!esito?.ok) throw new Error(esito?.error || "nessuna risposta dalla scheda");

    const { vrSnapshots = [] } = await chrome.storage.local.get("vrSnapshots");
    const voce = vrSnapshots.find((x) => x.n === s.n);
    if (voce) voce.restoredAt = Date.now();
    await chrome.storage.local.set({ vrSnapshots });
  } catch (errore) {
    bottone.disabled = false;
    bottone.textContent = "Ripristina";
    window.alert(`Ripristino non riuscito: ${errore.message}`);
  }
}

// ------------------------------------------------------------------- avvio

async function carica() {
  dati = await chrome.storage.local.get({
    inventory: {},
    qualityScores: {},
    vrSnapshots: [],
    vrQueue: null,
    vrQueueArchive: [],
    vintedOrigin: "https://www.vinted.it",
  });
  if (!/^https:\/\/www\.vinted\.[a-z.]+$/.test(dati.vintedOrigin)) dati.vintedOrigin = "https://www.vinted.it";
  disegna();
}

el("clearFilter").addEventListener("click", () => { filtro = null; disegna(); });

let attesaRicerca = null;
el("search").addEventListener("input", (e) => {
  clearTimeout(attesaRicerca);
  attesaRicerca = setTimeout(() => { cerca = e.target.value; disegna(); }, 120);
});
el("sort").addEventListener("change", (e) => {
  ordine = e.target.value;
  try { localStorage.setItem("vr-ordine", ordine); } catch { /* preferenza non essenziale */ }
  disegna();
});
try {
  const salvato = localStorage.getItem("vr-ordine");
  if (salvato && el("sort").querySelector(`option[value="${CSS.escape(salvato)}"]`)) { ordine = salvato; el("sort").value = salvato; }
} catch { /* niente */ }

el("version").textContent = chrome.runtime.getManifest().version;
el("checkUpdate").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/popup.html#salute") }));

chrome.storage.onChanged.addListener((modifiche, area) => {
  if (area !== "local" || !dati) return;
  if (["inventory", "qualityScores", "vrSnapshots"].some((k) => k in modifiche)) return carica();
  // durante una coda vrQueue cambia spesso: si ridisegna solo il suo pannello
  if ("vrQueue" in modifiche) dati.vrQueue = modifiche.vrQueue.newValue || null;
  if ("vrQueueArchive" in modifiche) dati.vrQueueArchive = modifiche.vrQueueArchive.newValue || [];
  if ("vrQueue" in modifiche || "vrQueueArchive" in modifiche) disegnaCoda();
});

carica().then(leggiHash);
