const DEFAULTS = {
  deleteOld: true,
  autoReload: false,
  showOnOtherProfiles: false,
  order: "safe",
  delayMs: 1200,
  humanRhythm: true,
  notifyOnFinish: true,
  canary: true,
  autoFill: true,
};

const el = (id) => document.getElementById(id);
el("version").textContent = chrome.runtime.getManifest().version;

// --------------------------------------------------------------- impostazioni

const campi = {};
for (const chiave of Object.keys(DEFAULTS)) campi[chiave] = el(chiave);

const valoreDi = (input) => {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "number") return Number(input.value);
  return input.value;
};

chrome.storage.local.get(DEFAULTS).then((impostazioni) => {
  for (const [chiave, input] of Object.entries(campi)) {
    if (input.type === "checkbox") input.checked = impostazioni[chiave];
    else input.value = impostazioni[chiave];

    input.addEventListener("change", () =>
      chrome.storage.local.set({ [chiave]: valoreDi(input) })
    );
  }
});

el("tutorial").addEventListener("click", async () => {
  await chrome.storage.local.set({ seenOnboarding: false });
  window.close();
});

// ----------------------------------------------------------------------- coda

let coda = null;
let tic = null;

const comando = (tipo) => chrome.runtime.sendMessage({ type: tipo });

function manca(ms) {
  if (ms <= 0) return "a momenti";
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return min > 0 ? `${min}:${String(sec).padStart(2, "0")}` : `${sec}s`;
}

function bottone(testo, tipo, classe = "btn") {
  const b = document.createElement("button");
  b.className = classe;
  b.textContent = testo;
  b.addEventListener("click", () => comando(tipo));
  return b;
}

function disegnaCoda() {
  const vuoto = el("queueEmpty");
  const azioni = el("queueActions");
  const errori = el("queueErrors");

  // Senza coda, lo spazio serve a dirti da dove si parte.
  if (!coda?.items?.length) {
    el("queueBar").hidden = true;
    el("queueItem").hidden = true;
    el("queueState").textContent = "";
    el("queueCount").textContent = "";
    azioni.textContent = "";
    errori.textContent = "";
    vuoto.hidden = false;
    clearInterval(tic);
    tic = null;
    return;
  }

  vuoto.hidden = true;
  el("queueBar").hidden = false;

  const fatti = coda.items.filter((i) => i.status !== "pending").length;
  const falliti = coda.items.filter((i) => i.status === "error");
  const corrente = coda.items[coda.index];

  el("queueCount").textContent = `${fatti} / ${coda.items.length}`;
  el("queueFill").style.width = `${(fatti / coda.items.length) * 100}%`;

  const stato = el("queueState");
  if (!coda.running) stato.textContent = coda.note || "Finita";
  else if (coda.state === "paused") stato.textContent = "In pausa";
  else if (coda.state === "scheduled") {
    stato.textContent = `Programmata ${new Date(coda.nextAt).toLocaleString("it-IT", {
      weekday: "short", hour: "2-digit", minute: "2-digit",
    })}`;
  } else if (coda.note) stato.textContent = coda.note;
  else if (coda.state === "working") stato.textContent = "In corso";
  else stato.textContent = `Prossimo tra ${manca((coda.nextAt || 0) - Date.now())}`;

  const riga = el("queueItem");
  riga.hidden = !corrente || !coda.running;
  if (corrente && coda.running) riga.textContent = corrente.title;

  // Gli articoli falliti esistono ancora: cliccandoli li apri.
  errori.textContent = "";
  for (const item of falliti) {
    const a = document.createElement("a");
    a.href = `https://www.vinted.it/items/${item.id}`;
    a.target = "_blank";
    a.textContent = `${item.title} — ${item.error}`;
    a.title = item.error;
    errori.append(a);
  }

  azioni.textContent = "";
  if (!coda.running) {
    const chiudi = document.createElement("button");
    chiudi.className = "btn quiet";
    chiudi.textContent = "Nascondi";
    chiudi.addEventListener("click", async () => {
      await chrome.storage.local.remove("vrQueue");
      coda = null;
      disegnaCoda();
    });
    azioni.append(chiudi);
  } else if (coda.state === "paused") {
    azioni.append(bottone("Riprendi", "vr:queueResume"), bottone("Interrompi", "vr:queueStop", "btn danger"));
  } else if (coda.state === "scheduled") {
    azioni.append(bottone("Annulla", "vr:queueStop", "btn danger"));
  } else {
    azioni.append(
      bottone("Pausa", "vr:queuePause", "btn quiet"),
      bottone("Salta", "vr:queueSkip", "btn quiet"),
      bottone("Interrompi", "vr:queueStop", "btn danger")
    );
  }

  // Il conto alla rovescia deve scorrere anche col popup aperto fermo.
  const serveTic = coda.running && coda.state !== "working" && coda.state !== "paused";
  if (serveTic && !tic) tic = setInterval(disegnaCoda, 1000);
  if (!serveTic && tic) { clearInterval(tic); tic = null; }
}

chrome.storage.local.get("vrQueue").then(({ vrQueue }) => {
  coda = vrQueue || null;
  disegnaCoda();
});

// ------------------------------------------------------------------ attivita'

function disegnaAttivita(storia) {
  const ora = Date.now();
  const entro = (giorni) => storia.filter((v) => v.at > ora - giorni * 86400000).length;

  const oggi = storia.filter((v) => new Date(v.at).toDateString() === new Date().toDateString()).length;
  const settimana = entro(7);

  el("statToday").textContent = oggi;
  el("statWeek").textContent = settimana;
  el("statMonth").textContent = entro(30);

  // Il dato che conta: ripubblicare lo stesso articolo ogni giorno rende meno
  // che non farlo affatto. Un numero in chiaro avvisa meglio di un paragrafo.
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

chrome.storage.local.get("vrHistory").then(({ vrHistory }) => disegnaAttivita(vrHistory || []));

// ------------------------------------------------------------------- formati

function mostraFormato(nome, appreso, dettaglio) {
  el(`${nome}Dot`).classList.toggle("on", Boolean(appreso));
  const stato = el(`${nome}State`);
  stato.textContent = appreso ? "appreso" : "predefinito";
  stato.title = dettaglio || "";
}

chrome.storage.local.get(["photoFormat", "itemFormat", "userId"]).then(
  ({ photoFormat, itemFormat, userId }) => {
    const campiFoto = photoFormat
      ? [...Object.keys(photoFormat.constants || {}), photoFormat.uuidField, photoFormat.fileField]
          .filter(Boolean).join(", ")
      : "";

    mostraFormato("photo", photoFormat, campiFoto);
    mostraFormato("item", itemFormat?.fields?.length, (itemFormat?.fields || []).join(", "));

    el("statusHint").textContent =
      photoFormat && itemFormat?.fields?.length
        ? "Entrambi rilevati dalle richieste di Vinted."
        : "Si aggiornano da soli quando pubblichi o modifichi un annuncio su Vinted.";

    el("wardrobeLink").href = userId
      ? `https://www.vinted.it/member/${userId}`
      : "https://www.vinted.it/";
  }
);

el("verify").addEventListener("click", async () => {
  const bottone = el("verify");
  const esito = el("verifyResult");

  bottone.disabled = true;
  bottone.textContent = "Controllo…";
  esito.hidden = false;
  esito.textContent = "Leggo un articolo e preparo il payload, senza pubblicare niente.";

  try {
    const [scheda] = await chrome.tabs.query({ url: "https://www.vinted.it/*" });
    if (!scheda) throw new Error("Apri una scheda su vinted.it.");

    const risposta = await chrome.tabs.sendMessage(scheda.id, { type: "vr:canaryAny" });
    esito.textContent = risposta?.ok
      ? "Tutto in regola: la coda può partire."
      : `Problemi: ${(risposta?.problemi || ["nessuna risposta"]).join(" · ")}`;
  } catch (errore) {
    esito.textContent = `Non riesco a verificare: ${errore.message}`;
  }

  bottone.disabled = false;
  bottone.textContent = "Verifica formato";
});

// ---------------------------------------------------------------------- bozze

chrome.storage.local.get(null).then((tutto) => {
  const voci = Object.entries(tutto).filter(([chiave]) => chiave.startsWith("vrBackup:"));
  if (!voci.length) return;

  el("draftsBlock").hidden = false;
  const contenitore = el("drafts");

  for (const [chiave, valore] of voci) {
    const riga = document.createElement("div");
    riga.textContent = `${valore.draft?.title || chiave.split(":")[1]} — ${new Date(valore.at).toLocaleDateString("it-IT")}`;
    contenitore.append(riga);
  }

  const bottone = el("copy");
  bottone.addEventListener("click", async () => {
    await navigator.clipboard.writeText(JSON.stringify(Object.fromEntries(voci), null, 2));
    bottone.textContent = "Copiato";
    setTimeout(() => (bottone.textContent = "Copia negli appunti"), 1500);
  });
});

// ------------------------------------------------------------- aggiornamenti

chrome.storage.onChanged.addListener((modifiche, area) => {
  if (area !== "local") return;
  if (modifiche.vrQueue) {
    coda = modifiche.vrQueue.newValue || null;
    disegnaCoda();
  }
  if (modifiche.vrHistory) disegnaAttivita(modifiche.vrHistory.newValue || []);
});
