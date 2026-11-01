/**
 * Gestione della coda nella dashboard: elenco, azioni per articolo e multiple,
 * riordino (trascinamento e tastiera), filtri, controlli della sessione, stima,
 * salute, cronologia, esportazione, sessioni precedenti, aggiunta dall'inventario.
 *
 * Non scrive MAI la coda: ogni modifica e' un messaggio al service worker, che
 * la applica in fila con le regole di coda-logica.js e risponde con l'esito.
 * Questa pagina mostra solo cio' che c'e' in storage, e si aggiorna da sola.
 *
 * Usa dalla dashboard (script caricato prima): crea, el, euro, quandoFa, miniatura, dati.
 */
(() => {
  const C = window.CodaLogica;
  const L = () => window.VR?.editorLogica;

  let codaCorrente = null;     // vrQueue
  let archivio = [];           // vrQueueArchive
  let passo = null;            // vrQueueStep (storage.session)
  let scelta = null;           // startedAt della sessione mostrata (null = la piu' recente)
  let richiesta = false;       // arrivati da #coda: il pannello si apre anche senza problemi
  let filtro = "tutti";
  let cerca = "";
  let vista = "posizione";     // ordinamento SOLO visivo: posizione | titolo | prezzo
  let filtroLog = "tutti";
  let filtroBatch = null;      // id della batch mostrata da sola (null = tutte)
  let daEvidenziare = null;    // id da far lampeggiare al prossimo disegno («Ripubblica ora»)
  const inVerifica = new Set(); // verifiche in corso, per non lanciarne due
  const selezione = new Set();
  const righe = new Map();     // id → { li, firma }
  let trascinato = null;

  /** Element.append scrive "null" per i figli null: qui si saltano, come fa crea(). */
  const metti = (padre, ...figli) => padre.append(...figli.flat().filter((f) => f != null && f !== false));

  const FILTRI = {
    tutti: { nome: "Tutti", vale: () => true },
    attesa: { nome: "In attesa", vale: (a) => a.status === "pending" },
    corso: { nome: "In elaborazione", vale: (a) => a.status === "working" },
    problemi: { nome: "Problemi", vale: (a) => a.status === "error" || a.status === "verify" || a.status === "interrupted" },
    completati: { nome: "Completati", vale: (a) => a.status === "done" },
    altri: { nome: "Saltati, annullati, rimossi", vale: (a) => ["skipped", "cancelled", "removed"].includes(a.status) },
  };
  const CLASSE_STATO = { pending: "", working: "ok", done: "ok", error: "error", verify: "warn", skipped: "", cancelled: "", removed: "", interrupted: "warn" };
  const riprovabile = (a) => a.status === "interrupted" || (a.status === "error" && a.sicuro !== "no");
  const LIVELLI = { ok: "✓", attenzione: "!", bloccata: "■", pausa: "Ⅱ", verificare: "?", vuota: "–" };
  const ICONE_LOG = { locale: "✎", vinted: "◆", sistema: "⚙" };

  const ora = () => Date.now();
  const durata = (ms) => {
    if (ms == null) return "—";
    const m = Math.round(ms / 60000);
    if (m < 1) return "meno di un minuto";
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
  };
  const orario = (t) => new Date(t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const dataOra = (t) => new Date(t).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const origine = () => (typeof dati !== "undefined" && dati?.vintedOrigin) || "https://www.vinted.it";

  /** Messaggio al service worker; l'esito si legge nella riga di stato. */
  async function chiedi(tipo, extra = {}) {
    try {
      return (await chrome.runtime.sendMessage({ type: tipo, ...extra })) || { ok: false, error: "Nessuna risposta." };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function messaggio(testo, tipo = "") {
    const p = el("queueMsg");
    p.textContent = testo || "";
    p.className = `hint ${tipo}`;
  }

  /** Esito di un'azione multipla: cosa e' stato fatto e cosa no, e perche'. */
  function esitoAzione(r, verbo) {
    const fatti = r.rimossi || r.spostati || r.rimessi || [...(r.aggiunti || []), ...(r.riattivati || [])];
    const no = r.rifiutati || [];
    if (!r.ok && !fatti?.length) return messaggio(r.motivo || r.error || no[0]?.motivo || "Azione non applicata.", "error");
    let t = `${fatti.length} ${verbo}`;
    if (no.length) t += `; ${no.length} no (${[...new Set(no.map((x) => x.motivo))].slice(0, 2).join("; ")})`;
    messaggio(`${t}.`, no.length ? "warn" : "ok");
  }

  // ------------------------------------------------------------ sessioni

  function sessioni() {
    const elenco = [];
    if (codaCorrente?.items?.length) elenco.push(codaCorrente);
    for (const q of archivio) if (!elenco.some((x) => x.startedAt === q.startedAt)) elenco.push(q);
    return elenco.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }
  const corrente = (s) => Boolean(s && codaCorrente && s.startedAt === codaCorrente.startedAt);
  const modificabile = (s) => corrente(s) && codaCorrente.running && !codaCorrente.stopDopoCorrente;
  function selezionata() {
    const tutte = sessioni();
    if (scelta == null) return tutte[0] || null;
    return tutte.find((x) => x.startedAt === scelta) || null;
  }

  // -------------------------------------------------------------- disegno

  function disegna() {
    const s = selezionata();
    const tutte = sessioni();
    const pannello = el("coda");
    pannello.dataset.stato = s ? (s.running ? s.state : "conclusa") : "vuota";

    // selettore delle sessioni
    const pick = el("queuePick");
    pick.textContent = "";
    for (const x of tutte) {
      const r = C.conta(x);
      pick.append(crea("option", { value: String(x.startedAt) },
        `${dataOra(x.startedAt)} · ${r.totale} articoli · ${x.running ? "in corso" : `${r.done} ok, ${r.error + r.verify + r.interrupted} da guardare`}${x.auto ? " · automatica" : ""}`));
    }
    pick.hidden = tutte.length < 2;
    if (s) pick.value = String(s.startedAt);

    const vuota = !s;
    for (const id of ["queueSummary", "queueBatches", "queueToolbar", "queueList", "queueTimelineBox"]) el(id).hidden = vuota;
    el("queueEmpty").hidden = !vuota;

    if (scelta != null && !s) {
      el("queueTitle").textContent = "Sessione non trovata";
      el("queueHealth").textContent = "";
      el("queueHealthText").textContent = "Questa sessione non è più in archivio: si tengono le ultime 10. Scegline un'altra dal menu.";
      el("queueControls").textContent = "";
      el("queueCurrent").hidden = true;
      el("queueEmpty").hidden = true;
      return;
    }
    if (vuota) {
      el("queueTitle").textContent = "Coda";
      el("queueHealth").textContent = "";
      el("queueHealthText").textContent = "";
      el("queueControls").textContent = "";
      el("queueCurrent").hidden = true;
      el("queueEmpty").hidden = false;
      el("queueEmpty").textContent = "Nessuna coda. Seleziona gli articoli dal tuo armadio su Vinted, oppure spuntali nell'elenco Articoli qui sotto e premi «Aggiungi alla coda».";
      return;
    }

    el("queueTitle").textContent = s.running ? (s.state === "scheduled" ? "Coda programmata" : "Coda in corso") : `Sessione del ${dataOra(s.startedAt)}`;

    // salute: livello, perche', cosa fare
    const sal = C.salute(s);
    const chip = el("queueHealth");
    chip.className = `health health--${sal.livello}`;
    chip.textContent = `${LIVELLI[sal.livello] || ""} ${sal.titolo}`;
    el("queueHealthText").textContent = `${sal.perche} ${sal.azione !== "Niente da fare." ? `Cosa fare: ${sal.azione}` : ""}`.trim();

    disegnaRiepilogo(s);
    disegnaBatch(s);
    disegnaCorrente(s);
    disegnaControlli(s);
    disegnaFiltri(s);
    disegnaSelezione(s);
    disegnaElenco(s);
    disegnaCronologia(s);
  }

  function disegnaRiepilogo(s) {
    const r = C.conta(s);
    const st = C.stima(s, ora());
    const box = el("queueSummary");
    box.textContent = "";
    const voce = (n, nome, classe = "") => crea("div", { class: classe }, crea("b", {}, n), crea("span", {}, nome));
    metti(box,
      voce(r.totale, "nella sessione"),
      voce(r.pending, "in attesa"),
      voce(r.working, "in elaborazione", r.working ? "ok" : ""),
      voce(r.done, "completati", "ok"),
      voce(r.error, "falliti", r.error ? "error" : ""),
      voce(r.verify, "da verificare", r.verify ? "warn" : ""),
      r.interrupted ? voce(r.interrupted, "interrotti prima dell'invio", "warn") : null,
      r.skipped + r.cancelled ? voce(r.skipped + r.cancelled, "saltati o annullati") : null,
      r.removed ? voce(r.removed, "rimossi dalla coda") : null,
      voce(durata(st.trascorsoMs), "trascorso"),
      s.running ? voce(st.rimanenteMs == null ? "—" : `~ ${durata(st.rimanenteMs)}`, st.fineAlle && st.rimanenteMs ? `rimanente · fine verso le ${orario(st.fineAlle)}` : "rimanente") : null,
    );
    el("queueEta").textContent = s.running ? st.testo : "";
  }

  // --------------------------------------------------------------- batch

  const batchDi = (s, a) => C.batchDi(s, a);
  const piuBatch = (s) => (s?.batches || []).length > 1;

  /**
   * Una riga per batch: quanti articoli, a che punto, con quali regole. Le
   * regole complete e le azioni stanno dentro, aprendo la batch.
   */
  function disegnaBatch(s) {
    const box = el("queueBatches");
    const aperte = new Set([...box.querySelectorAll("details[open]")].map((d) => d.dataset.batch));
    box.textContent = "";
    const elenco = C.riepilogoBatch(s);
    if (!elenco.length) return;
    if (filtroBatch && !elenco.some((b) => b.id === filtroBatch)) filtroBatch = null;

    for (const b of elenco) {
      const r = b.conteggi;
      const classe = b.problemi ? "warn" : b.stato.startsWith("conclusa") ? "ok" : "";
      const conti = [
        `${b.totale} ${b.totale === 1 ? "articolo" : "articoli"}`,
        r.done ? `${r.done} completati` : null,
        r.pending ? `${r.pending} in attesa` : null,
        r.working ? "1 in elaborazione" : null,
        r.error ? `${r.error} falliti` : null,
        r.verify ? `${r.verify} da verificare` : null,
        r.interrupted ? `${r.interrupted} interrotti` : null,
      ].filter(Boolean).join(" · ");
      const regole = descrivi(b.overrides || {}, null, b.modello);
      const d = crea("details", { class: `batch${filtroBatch === b.id ? " is-filter" : ""}`, "data-batch": b.id, open: aperte.has(b.id) ? "" : null },
        crea("summary", {},
          crea("span", { class: "b-name" }, b.nome),
          crea("span", { class: `b-state ${classe}` }, b.stato),
          crea("span", { class: "b-counts" }, conti),
          crea("span", { class: "b-counts" }, `Regole: ${regole}`)));
      const azioni = crea("div", { class: "b-actions" },
        bottone(filtroBatch === b.id ? "Mostra tutte le batch" : "Mostra solo questa", "btn-sm", () => {
          filtroBatch = filtroBatch === b.id ? null : b.id;
          disegna();
        }),
        modificabile(s) && r.pending ? bottone("Modifica regole…", "btn-sm", () => apriModificaBatch(s, b)) : null);
      const corpo = crea("div", { class: "b-body" },
        crea("p", { class: "b-rules hint" },
          `Regole: ${regole}. Revisione ${b.rev || 1}, creata ${dataOra(b.creataAt)}.`,
          r.pending ? "" : " Nessun articolo in attesa: le regole non si possono più cambiare."),
        azioni);
      d.append(corpo);
      box.append(d);
    }
  }

  /**
   * Centro di modifica nella dashboard: gli stessi campi e la stessa validazione
   * delle opzioni della coda sulla pagina di Vinted (editor-logica). Ritorna il
   * nodo e una funzione che legge { ok, overrides, campi, errori }.
   */
  function moduloRegole(iniziali = {}, { copiaDa = [] } = {}) {
    const f = { modo: "", valore: "", aggiunta: "", cerca: "", con: "", colore: "", ...(iniziali || {}) };
    const err = (k) => crea("p", { class: "err", id: `rf-err-${k}` });
    const modo = crea("select", { "aria-label": "Prezzo" },
      ...[["", "Prezzo invariato"], ["percent", "Variazione in percentuale"], ["delta", "Variazione in euro"], ["fixed", "Prezzo fisso per tutti"]]
        .map(([v, t]) => crea("option", { value: v }, t)));
    const valore = crea("input", { type: "text", inputmode: "decimal", "aria-describedby": "rf-err-valore" });
    const aggiunta = crea("textarea", { rows: "2", placeholder: "Es. Spedizione rapida entro 24 ore." });
    const cerca = crea("input", { type: "text", placeholder: "es. #starwars" });
    const con = crea("input", { type: "text", placeholder: "vuoto = togli" });
    const colore = crea("select", {},
      crea("option", { value: "" }, "Lascia come è"),
      crea("option", { value: "auto" }, "Deduci dai tuoi articoli simili"),
      ...Object.entries(mappaColori).sort((a, b) => a[1].localeCompare(b[1], "it")).map(([id, nome]) => crea("option", { value: id }, nome)));
    const errori = { valore: err("valore"), aggiunta: err("aggiunta"), cerca: err("cerca") };
    const riempi = (o) => {
      modo.value = o.modo || ""; valore.value = o.valore || ""; aggiunta.value = o.aggiunta || "";
      cerca.value = o.cerca || ""; con.value = o.con || ""; colore.value = o.colore || "";
    };
    riempi(f);
    const nodo = crea("div", { class: "rules-form" },
      copiaDa.length ? crea("div", { class: "copy" }, "Parti da:",
        ...copiaDa.map((b) => bottone(`Copia da ${b.nome}`, "btn-sm", () => { riempi(b.campi); leggi(); }))) : null,
      crea("div", { class: "row" },
        crea("label", {}, "Prezzo", modo),
        crea("label", {}, "Valore", valore, errori.valore)),
      crea("label", {}, "Aggiungi in fondo alla descrizione", aggiunta, errori.aggiunta),
      crea("div", { class: "row" },
        crea("label", {}, "Cerca nel titolo e nella descrizione", cerca, errori.cerca),
        crea("label", {}, "Sostituisci con", con)),
      crea("label", {}, "Colore, dove manca", colore));
    function leggi() {
      const campi = { modo: modo.value, valore: valore.value, aggiunta: aggiunta.value, cerca: cerca.value, con: con.value, colore: colore.value };
      const v = L()?.validaOpzioniCoda({ ...campi, intervallo: "20", quando: "" }) || { ok: false, errori: {} };
      for (const [k, n] of Object.entries(errori)) n.textContent = v.errori?.[k] || "";
      valore.closest("label").hidden = !campi.modo;
      return { ok: v.ok, overrides: v.overrides || null, campi };
    }
    for (const x of [modo, valore, aggiunta, cerca, con, colore]) { x.addEventListener("input", leggi); x.addEventListener("change", leggi); }
    leggi();
    return { nodo, leggi, primo: modo };
  }

  let mappaColori = {};
  chrome.storage.local.get({ colorMap: {} }).then((d) => { mappaColori = d.colorMap || {}; }).catch(() => {});

  /**
   * Nuove regole per una batch: valgono solo per i suoi articoli in attesa.
   * Prima di applicarle si vede chi cambia e chi no, e perche'.
   */
  function apriModificaBatch(s, b) {
    const box = el("queueConfirm");
    box.textContent = "";
    box.hidden = false;
    const form = moduloRegole(b.campi || {});
    const r = b.conteggi;
    const esclusi = [
      r.working ? "1 in elaborazione continua con le regole attuali (le ha già ricevute)" : null,
      r.done ? `${r.done} completati restano registrati con la revisione ${b.rev || 1}` : null,
      r.error + r.verify + r.interrupted ? `${r.error + r.verify + r.interrupted} con problemi non cambiano finché non li rimetti in coda` : null,
    ].filter(Boolean);
    const ok = bottone(`Applica a ${r.pending} in attesa`, "btn-primary", async () => {
      const v = form.leggi();
      if (!v.ok) return;
      const ris = await chiedi("vr:queueBatchEdit", { batchId: b.id, overrides: v.overrides, campi: v.campi, modello: null });
      box.hidden = true;
      messaggio(ris.ok ? `${b.nome}: regole aggiornate per ${ris.applicati?.length || 0} articoli in attesa (revisione ${ris.rev}).` : ris.motivo || ris.error || "Non applicate.", ris.ok ? "ok" : "error");
    });
    metti(box,
      crea("strong", {}, `Modifica regole · ${b.nome}`),
      crea("p", { class: "hint" }, b.campi ? "" : "Questa batch è stata creata con una versione precedente: parti dalle regole vuote o ricopiale."),
      form.nodo,
      crea("p", { class: "hint" }, `Cambiano solo i ${r.pending} articoli in attesa di questa batch.${esclusi.length ? ` Non cambiano: ${esclusi.join("; ")}.` : ""} Le altre batch non vengono toccate.`),
      crea("div", { class: "actions" }, ok, bottone("Annulla", "", () => { box.hidden = true; })));
    form.primo.focus();
  }

  function disegnaCorrente(s) {
    const box = el("queueCurrent");
    const c = s.running ? C.corrente(s) : null;
    box.hidden = !c;
    box.textContent = "";
    if (!c) return;
    const mio = passo?.itemId === c.id ? passo : null;
    const foto = miniatura(c.thumb);
    box.append(
      foto ? crea("img", { src: foto, alt: "", width: "48", height: "48", loading: "lazy" }) : crea("span", { class: "ph" }),
      crea("div", {},
        crea("small", {}, "In elaborazione"),
        crea("a", { href: `${origine()}/items/${encodeURIComponent(c.id)}`, target: "_blank", rel: "noopener" }, c.title),
        crea("span", { class: "hint" }, mio ? `${mio.step} · ${mio.fase === "invio" ? "richiesta a Vinted partita: non si può più annullare" : "preparazione: si può ancora annullare"}` : `da ${durata(ora() - (c.startedAt || ora()))}`)));
  }

  function bottone(testo, classe, azione, attr = {}) {
    return crea("button", { class: `btn ${classe}`, type: "button", onclick: azione, ...attr }, testo);
  }

  function disegnaControlli(s) {
    const box = el("queueControls");
    box.textContent = "";
    const r = C.conta(s);

    if (corrente(s) && s.running) {
      const c = C.corrente(s);
      if (s.stopDopoCorrente) {
        box.append(crea("span", { class: "hint" }, "Sessione in chiusura: si aspetta l'esito dell'articolo in corso."));
      } else if (s.state === "recovering") {
        box.append(bottone("Riprendi", "btn-primary", azione("vr:queueRecover", "Ripresa.")), bottoneInterrompi(r));
      } else if (s.state === "paused") {
        box.append(bottone("Riprendi", "btn-primary", azione("vr:queueResume", "Ripresa.")), bottoneInterrompi(r));
      } else {
        if (s.pausaDopoCorrente) {
          box.append(bottone("Pausa richiesta", "", null, { disabled: "" }), bottone("Annulla la pausa", "", azione("vr:queueResume", "Pausa annullata.")));
        } else {
          box.append(bottone(c ? "Pausa dopo questo articolo" : "Pausa", "", azione("vr:queuePause", "In pausa.")));
          const minuti = crea("select", { "aria-label": "Durata della pausa" },
            ...[15, 30, 60, 120].map((m) => crea("option", { value: String(m) }, m < 60 ? `${m} min` : `${m / 60} h`)));
          box.append(crea("span", { class: "btn-group" }, minuti,
            bottone("Pausa a tempo", "", async () => {
              const ris = await chiedi("vr:queuePause", { minuti: Number(minuti.value) });
              messaggio(ris.ok ? (ris.dopoCorrente ? `Pausa di ${minuti.value} min dopo l'articolo in corso.` : `In pausa per ${minuti.value} min: riprende da sola.`) : ris.motivo || ris.error, ris.ok ? "ok" : "error");
            })));
        }
        if (c) {
          const tardi = c.fase === "invio" || (passo?.itemId === c.id && passo.fase === "invio");
          box.append(bottone("Annulla operazione", "", annulla, tardi
            ? { disabled: "", title: "La richiesta a Vinted è già partita: non si può annullare, si aspetta l'esito." }
            : { title: "Ferma l'articolo in corso, solo se non ha ancora inviato niente a Vinted." }));
        }
        box.append(bottoneInterrompi(r));
      }
    } else if (!s.running) {
      const { riprendibili } = C.daRiprendere(s);
      const riprovabili = s.items.filter(riprovabile).length;
      if (riprovabili) box.append(bottone(`Riprova i falliti (${riprovabili})`, "btn-primary", azione("vr:queueRetry", null, { queue: s.startedAt })));
      if (riprendibili.length) {
        box.append(bottone(`Riprendi gli articoli non elaborati (${riprendibili.length})`, "", async () => {
          const ris = await chiedi("vr:queueRestore", { queue: s.startedAt });
          const esclusi = (ris.esclusi || []).length ? ` Esclusi ${ris.esclusi.length}: ${[...new Set(ris.esclusi.map((e) => e.motivo))].join(", ")}.` : "";
          messaggio(ris.ok ? `Ripresi nella coda.${esclusi}` : `${ris.error || ris.rifiutati?.[0]?.motivo || "Non ripresa."}${esclusi}`, ris.ok ? "ok" : "error");
          if (ris.ok) { scelta = null; }
        }, { title: "Solo falliti riprovabili, interrotti e annullati: mai i completati né quelli da verificare. Ognuno con le regole della sua batch." }));
      }
      if (corrente(s)) box.append(bottone("Nascondi", "quiet", azione("vr:queueClear", "Sessione nascosta (resta nell'archivio).")));
    }

    box.append(crea("span", { class: "spacer" }),
      bottone("Esporta CSV", "quiet", () => esporta(s, "csv")),
      bottone("Esporta JSON", "quiet", () => esporta(s, "json")),
      bottone("Copia resoconto", "quiet", () => copiaResoconto(s)));
  }

  function bottoneInterrompi(r) {
    return bottone("Interrompi la sessione", "danger", () => {
      // Conferma solo se c'e' qualcosa da perdere: articoli in attesa che verrebbero annullati.
      if (!r.pending) return azione("vr:queueStop", "Sessione interrotta.")();
      conferma(`Interrompere la sessione? ${r.pending} ${r.pending === 1 ? "articolo in attesa verrà annullato" : "articoli in attesa verranno annullati"} (potrai riprenderli dalla sessione). L'articolo in corso finisce con il suo esito.`,
        "Interrompi", azione("vr:queueStop", "Sessione interrotta."));
    });
  }

  /** Domanda in linea, sotto i controlli: niente confirm() che blocca la pagina. */
  function conferma(testo, etichetta, fn) {
    const box = el("queueConfirm");
    box.textContent = "";
    box.hidden = false;
    const si = bottone(etichetta, "btn-primary", async () => { box.hidden = true; await fn(); });
    box.append(crea("span", {}, testo), si, bottone("Annulla", "", () => { box.hidden = true; }));
    si.focus();
  }

  const azione = (tipo, ok, extra = {}) => async () => {
    const r = await chiedi(tipo, extra || {});
    if (r.ok) messaggio(ok || "Fatto.", "ok");
    else messaggio(r.motivo || r.error || "Non riuscito.", "error");
    return r;
  };

  async function annulla() {
    const r = await chiedi("vr:queueCancelCurrent");
    if (r.troppoTardi) messaggio(r.motivo, "warn");
    else if (r.ok) messaggio("Annullamento chiesto: se la richiesta a Vinted non è ancora partita, l'articolo si ferma.", "ok");
    else messaggio(r.motivo || r.error || "Non riuscito.", "error");
  }

  // ----------------------------------------------------- filtri e selezione

  function visibili(s) {
    const testo = piano(cerca.trim());
    let elenco = s.items.filter((a) => FILTRI[filtro].vale(a) && (!testo || piano(a.title).includes(testo) || a.id === testo)
      && (!filtroBatch || batchDi(s, a)?.id === filtroBatch));
    const peso = (a) => (a.status === "working" ? 0 : a.status === "pending" ? 1 : 2);
    if (vista === "batch") {
      const ordineB = new Map((s.batches || []).map((b, i) => [b.id, i]));
      const attese = C.inAttesa(s).map((a) => a.id);
      elenco = [...elenco].sort((a, b) => (ordineB.get(batchDi(s, a)?.id) ?? 0) - (ordineB.get(batchDi(s, b)?.id) ?? 0)
        || peso(a) - peso(b) || attese.indexOf(a.id) - attese.indexOf(b.id) || (b.finishedAt || 0) - (a.finishedAt || 0));
    } else if (vista === "titolo") elenco = [...elenco].sort((a, b) => String(a.title).localeCompare(String(b.title), "it"));
    else if (vista === "prezzo") elenco = [...elenco].sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    else {
      // posizione: prima il corrente, poi gli in attesa in ordine, poi il resto
      elenco = [...elenco].sort((a, b) => peso(a) - peso(b) || (peso(a) === 2 ? (b.finishedAt || 0) - (a.finishedAt || 0) : 0));
    }
    return elenco;
  }

  /** Riordino possibile solo guardando l'ordine vero, senza ricerca. */
  const riordinoAttivo = (s) => modificabile(s) && vista === "posizione" && !cerca.trim() && !filtroBatch && (filtro === "tutti" || filtro === "attesa");

  function disegnaFiltri(s) {
    const box = el("queueFilters");
    box.textContent = "";
    for (const [k, f] of Object.entries(FILTRI)) {
      const n = s.items.filter(f.vale).length;
      if (k !== "tutti" && !n && filtro !== k) continue;
      box.append(crea("button", {
        class: `chip${filtro === k ? " is-active" : ""}`, type: "button", "aria-pressed": String(filtro === k),
        onclick: () => { filtro = k; disegna(); },
      }, `${f.nome} (${n})`));
    }
    const nota = el("queueSortNote");
    nota.hidden = riordinoAttivo(s) || !modificabile(s);
    nota.textContent = vista !== "posizione"
      ? "Ordinamento solo visivo: la coda non cambia. Per spostare gli articoli torna a «Posizione». «Ripubblica ora» funziona sempre."
      : filtroBatch
        ? "Stai guardando una sola batch: per spostare gli articoli mostra tutte le batch. «Ripubblica ora» funziona sempre."
        : "Per spostare gli articoli togli la ricerca e mostra «Tutti» o «In attesa».";
  }

  /** Solo gli articoli su cui un'azione multipla puo' fare qualcosa. */
  const selezionabile = (s, a) => (modificabile(s) && a.status === "pending") || (riprovabile(a) && (modificabile(s) || !s.running));

  function disegnaSelezione(s) {
    for (const id of [...selezione]) {
      const a = s.items.find((x) => x.id === id);
      if (!a || !selezionabile(s, a)) selezione.delete(id);
    }
    const scelti = s.items.filter((a) => selezione.has(a.id));
    const inAttesa = scelti.filter((a) => a.status === "pending").length;
    const falliti = scelti.filter(riprovabile).length;
    const bar = el("queueSelBar");
    bar.textContent = "";
    const attese = s.items.filter((a) => a.status === "pending").length;
    metti(bar,
      crea("span", { class: "sel-count", "aria-live": "polite" }, scelti.length ? `${scelti.length} selezionati` : "Nessuno selezionato"),
      modificabile(s) && attese ? bottone("Seleziona tutti in attesa", "quiet", () => { s.items.filter((a) => a.status === "pending").forEach((a) => selezione.add(a.id)); disegna(); }) : null,
      bottone("Sposta in cima", "", () => multipla("vr:queueMove", { dove: "cima" }, "spostati in cima", "pending"), { disabled: inAttesa && riordinoAttivo(s) ? null : "" }),
      bottone("Sposta in fondo", "", () => multipla("vr:queueMove", { dove: "fondo" }, "spostati in fondo", "pending"), { disabled: inAttesa && riordinoAttivo(s) ? null : "" }),
      bottone("Rimuovi dalla coda", "danger", () => rimuoviSelezionati(), { disabled: inAttesa ? null : "", title: "Toglie dalla pianificazione: niente viene cancellato su Vinted." }),
      bottone("Riprova", "", () => multipla("vr:queueRetry", { queue: s.startedAt }, "rimessi in coda", ["error", "interrupted"]), { disabled: falliti ? null : "" }),
      scelti.length ? bottone("Deseleziona tutti", "quiet", () => { selezione.clear(); disegna(); }) : null);
  }

  async function multipla(tipo, extra, verbo, stato) {
    const s = selezionata();
    const stati = Array.isArray(stato) ? stato : [stato];
    const ids = s.items.filter((a) => selezione.has(a.id) && stati.includes(a.status)).map((a) => a.id);
    if (!ids.length) return;
    const r = await chiedi(tipo, { ...extra, ids });
    esitoAzione(r, verbo);
    // Dopo uno spostamento la selezione resta (si puo' spostare ancora);
    // dopo rimozione o riprova gli articoli cambiano stato e si deselezionano.
    if (r.ok && tipo !== "vr:queueMove") ids.forEach((id) => selezione.delete(id));
    disegna();
  }

  function rimuoviSelezionati() {
    const s = selezionata();
    const ids = s.items.filter((a) => selezione.has(a.id) && a.status === "pending").map((a) => a.id);
    if (!ids.length) return;
    const fai = () => multipla("vr:queueRemove", {}, "rimossi dalla coda", "pending");
    if (ids.length === 1) return fai();
    conferma(`Togliere ${ids.length} articoli dalla coda? Restano su Vinted com'erano.`, "Rimuovi", fai);
  }

  // ----------------------------------------------------------------- elenco

  function disegnaElenco(s) {
    const lista = el("queueList");
    const elenco = visibili(s);
    const attive = C.inAttesa(s).map((a) => a.id);
    const mod = modificabile(s);
    const riordino = riordinoAttivo(s);

    // ricordo il fuoco per ridarlo dopo il ridisegno
    const fuoco = document.activeElement?.closest?.("#queueList li");
    const fuocoId = fuoco?.dataset.id;
    const fuocoAzione = document.activeElement?.dataset?.azione;

    const visti = new Set();
    lista.querySelectorAll(".q-group").forEach((n) => n.remove());
    let gruppo = null;
    for (const a of elenco) {
      if (vista === "batch") {
        const b = batchDi(s, a);
        if (b && b.id !== gruppo) {
          gruppo = b.id;
          lista.append(crea("li", { class: "q-group", role: "presentation" }, `${b.nome} — ${descrivi(b.overrides || {}, null, b.modello)}`));
        }
      }
      const pos = a.status === "pending" ? attive.indexOf(a.id) + 1 : null;
      const mio = passo?.itemId === a.id ? passo : null;
      const firma = JSON.stringify([a, pos, mod, riordino, selezione.has(a.id), mio?.fase, corrente(s), origine(), batchDi(s, a)?.nome, piuBatch(s), inVerifica.has(a.id), s.running && s.state]);
      let r = righe.get(a.id);
      if (!r || r.firma !== firma) {
        const li = riga(s, a, { pos, mod, riordino, ultimo: pos === attive.length, mio });
        if (r?.li?.isConnected) r.li.replaceWith(li);
        r = { li, firma };
        righe.set(a.id, r);
      }
      visti.add(a.id);
      lista.append(r.li);                              // append sposta: niente ricostruzione
    }
    for (const [id, r] of righe) if (!visti.has(id)) { r.li.remove(); righe.delete(id); }

    el("queueEmptyList").hidden = elenco.length > 0;
    el("queueEmptyList").textContent = s.items.length ? "Nessun articolo con questi filtri." : "La sessione non ha articoli.";

    if (fuocoId && righe.get(fuocoId)) {
      const li = righe.get(fuocoId).li;
      (fuocoAzione && li.querySelector(`[data-azione="${fuocoAzione}"]:not(:disabled)`) || li).focus({ preventScroll: true });
    }
    // «Ripubblica ora»: l'articolo lampeggia nella sua nuova posizione.
    if (daEvidenziare && righe.get(daEvidenziare)) {
      const li = righe.get(daEvidenziare).li;
      daEvidenziare = null;
      li.scrollIntoView({ behavior: "smooth", block: "nearest" });
      li.classList.add("flash");
      setTimeout(() => li.classList.remove("flash"), 1800);
    }
  }

  function riga(s, a, { pos, mod, riordino, ultimo, mio }) {
    const foto = miniatura(a.thumb);
    const img = foto ? crea("img", { src: foto, alt: "", width: "40", height: "40", loading: "lazy", decoding: "async" }) : null;
    img?.addEventListener("error", () => img.replaceWith(crea("span", { class: "ph" })));
    const etichetta = a.status === "working" ? "In elaborazione" : C.ETICHETTE[a.status];

    const li = crea("li", { class: `q-row q-${a.status}`, "data-id": a.id, tabindex: "0", "aria-label": `${a.title}, ${etichetta}${pos ? `, posizione ${pos}` : ""}` });

    // selezione
    const puo = selezionabile(s, a);
    const casella = crea("input", { type: "checkbox", "aria-label": `Seleziona ${a.title}`, disabled: puo ? null : "" });
    casella.checked = selezione.has(a.id);
    casella.addEventListener("change", () => { if (casella.checked) selezione.add(a.id); else selezione.delete(a.id); disegna(); });

    const maniglia = crea("span", { class: "q-handle", "aria-hidden": "true", title: riordino && a.status === "pending" ? "Trascina per spostare" : "" }, riordino && a.status === "pending" ? "⋮⋮" : "");

    const stato = crea("span", { class: `tag ${CLASSE_STATO[a.status]}` }, `${C.ICONE[a.status]} ${etichetta}`);
    const b = batchDi(s, a);
    const meta = [
      `ID ${a.id}`,
      typeof a.price === "number" ? euro(a.price) : null,
      a.aggiuntoDopo ? "aggiunto durante la sessione" : null,
      a.tentativi ? `${a.tentativi}° tentativo` : null,
      a.nuovoId ? `nuovo annuncio ${a.nuovoId}` : null,
      a.prioritaAt && a.status === "pending" ? "ripubblica ora" : null,
    ].filter(Boolean).join(" · ");

    const link = a.status === "done"
      ? crea("span", { class: "q-title" }, a.title)
      : crea("a", { class: "q-title", href: `${origine()}/items/${encodeURIComponent(a.id)}`, target: "_blank", rel: "noopener" }, a.title);

    const corpo = crea("div", { class: "q-body" },
      crea("div", { class: "q-line" }, pos ? crea("span", { class: "q-pos", title: "Posizione nella coda" }, `#${pos}`) : null, link, stato,
        b && piuBatch(s) ? crea("span", { class: "b-chip", title: `Regole: ${descrivi(b.overrides || {}, null, b.modello)}` }, b.nome) : null),
      crea("p", { class: "q-meta" }, meta),
      a.status === "working" && mio ? crea("p", { class: "q-why" }, `${mio.step}${mio.fase === "invio" ? " · richiesta già inviata a Vinted" : ""}`) : null,
      a.error ? crea("p", { class: "q-why" }, a.error,
        a.categoria ? crea("span", { class: "q-cat" }, ` · ${C.ETICHETTE_CATEGORIA[a.categoria] || a.categoria}`) : null,
        a.status === "error" ? crea("span", { class: "q-cat" }, ` · riprovare: ${{ si: "sì", "dopo-correzione": "dopo aver corretto", no: "non serve" }[a.sicuro] || "probabilmente sì"}`) : null) : null,
      a.status === "verify" && a.ultimaVerifica ? crea("p", { class: "q-why" }, `Ultima verifica ${orario(a.ultimaVerifica.at)}: manca ${(a.ultimaVerifica.mancano || []).join("; ") || "una prova"}.`) : null);

    // azioni compatibili con lo stato: niente bottoni inerti
    const azioni = crea("div", { class: "q-actions" });
    const az = (testo, nome, fn, attr = {}) => azioni.append(crea("button", { class: "btn btn-sm", type: "button", "data-azione": nome, onclick: fn, ...attr }, testo));
    const puoOra = mod && (a.status === "pending" || riprovabile(a));
    if (puoOra) {
      az("Ripubblica ora", "ora", () => ripubblicaOra(s, a), {
        title: `Diventa il prossimo, con le regole di ${b?.nome || "questa batch"}. Quello in elaborazione non viene interrotto.`,
        disabled: a.status === "pending" && pos === 1 && !s.nextAt ? "" : null,
      });
    }
    if (a.status === "pending" && mod) {
      const spento = riordino ? {} : { disabled: "", title: "Riordino disattivato con ricerca, filtri o ordinamento visivo" };
      az("↑", "su", () => sposta(a.id, "su"), { "aria-label": "Sposta su", disabled: pos === 1 || !riordino ? "" : null, title: spento.title || "Sposta su" });
      az("↓", "giu", () => sposta(a.id, "giu"), { "aria-label": "Sposta giù", disabled: ultimo || !riordino ? "" : null, title: spento.title || "Sposta giù" });
      az("⤒", "cima", () => sposta(a.id, "cima"), { "aria-label": "Sposta in cima", disabled: pos === 1 || !riordino ? "" : null, title: spento.title || "Sposta in cima" });
      az("⤓", "fondo", () => sposta(a.id, "fondo"), { "aria-label": "Sposta in fondo", disabled: ultimo || !riordino ? "" : null, title: spento.title || "Sposta in fondo" });
      az("Rimuovi", "rimuovi", async () => esitoAzione(await chiedi("vr:queueRemove", { ids: [a.id] }), "rimosso dalla coda"), { title: "Toglie dalla pianificazione: niente viene cancellato su Vinted." });
    }
    if (a.status === "working" && mod) {
      const tardi = a.fase === "invio" || mio?.fase === "invio";
      az("Annulla operazione", "annulla", annulla, tardi ? { disabled: "", title: "La richiesta a Vinted è già partita: si aspetta l'esito." } : {});
    }
    if (riprovabile(a) && (mod || !s.running)) {
      az("Riprova", "riprova", async () => esitoAzione(await chiedi("vr:queueRetry", { queue: s.startedAt, ids: [a.id] }), "rimesso in coda"));
    }
    if (a.status === "verify") {
      az(inVerifica.has(a.id) ? "Verifica in corso…" : "Verifica pubblicazione", "verifica", () => verifica(s, a), {
        class: "btn btn-sm btn-primary", disabled: inVerifica.has(a.id) ? "" : null,
        title: "Controlla su Vinted, senza pubblicare niente, se il nuovo annuncio esiste. Serve una scheda di Vinted aperta.",
      });
      az("È stato pubblicato", "pubblicato", async () => esitoAzione(await chiedi("vr:queueResolve", { itemId: a.id, pubblicato: true, queue: s.startedAt }), "verificato"),
        { title: "L'hai visto nel tuo armadio" });
      az("Non è uscito", "nonuscito", async () => esitoAzione(await chiedi("vr:queueResolve", { itemId: a.id, pubblicato: false, queue: s.startedAt }), "verificato"),
        { title: "Non c'è nel tuo armadio: diventa riprovabile" });
    }
    const dettagli = crea("div", { class: "q-details", hidden: "" },
      crea("dl", {},
        ...[["Aggiunto", a.addedAt], ["Iniziato", a.startedAt], ["Finito", a.finishedAt]]
          .filter(([, t]) => t).flatMap(([n, t]) => [crea("dt", {}, n), crea("dd", {}, dataOra(t))]),
        a.startedAt && a.finishedAt ? [crea("dt", {}, "Durata"), crea("dd", {}, `${Math.round((a.finishedAt - a.startedAt) / 1000)} s`)] : null,
        a.ultimoErrore ? [crea("dt", {}, "Errore precedente"), crea("dd", {}, a.ultimoErrore)] : null,
        a.categoria ? [crea("dt", {}, "Cosa fare"), crea("dd", {}, consiglio(a))] : null,
        b ? [crea("dt", {}, "Regole"), crea("dd", {}, `${b.nome}${a.regole?.rev ? `, revisione ${a.regole.rev}` : ""}: ${descrivi(regoleUsate(b, a), null, b.modello)}`)] : null,
        a.invioAt ? [crea("dt", {}, "Richiesta a Vinted"), crea("dd", {}, dataOra(a.invioAt))] : null));
    az("Dettagli", "dettagli", (e) => {
      dettagli.hidden = !dettagli.hidden;
      e.currentTarget.setAttribute("aria-expanded", String(!dettagli.hidden));
    }, { "aria-expanded": "false" });

    li.append(casella, maniglia, img || crea("span", { class: "ph" }), corpo, azioni, dettagli);

    // trascinamento, solo tra articoli in attesa e solo nell'ordine vero
    if (riordino && a.status === "pending") {
      li.draggable = true;
      li.addEventListener("dragstart", (e) => { trascinato = a.id; li.classList.add("is-dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", a.id); });
      li.addEventListener("dragend", () => { trascinato = null; li.classList.remove("is-dragging"); document.querySelectorAll(".q-drop-before,.q-drop-after").forEach((x) => x.classList.remove("q-drop-before", "q-drop-after")); });
      li.addEventListener("dragover", (e) => {
        if (!trascinato || trascinato === a.id) return;
        e.preventDefault();
        const sopra = e.clientY < li.getBoundingClientRect().top + li.offsetHeight / 2;
        li.classList.toggle("q-drop-before", sopra);
        li.classList.toggle("q-drop-after", !sopra);
      });
      li.addEventListener("dragleave", () => li.classList.remove("q-drop-before", "q-drop-after"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        const prima = li.classList.contains("q-drop-before");
        li.classList.remove("q-drop-before", "q-drop-after");
        if (trascinato) rilascia(trascinato, a.id, prima);
      });
    }
    // alternativa da tastiera al trascinamento
    li.addEventListener("keydown", (e) => {
      if (e.target !== li) return;
      if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "r" || e.key === "R") && puoOra) { e.preventDefault(); e.stopPropagation(); ripubblicaOra(s, a); return; }
      if (!(riordino && a.status === "pending") || !e.altKey) return;
      const dove = { ArrowUp: "su", ArrowDown: "giu", Home: "cima", End: "fondo" }[e.key];
      if (!dove) return;
      e.preventDefault();
      sposta(a.id, dove);
    });
    return li;
  }

  function consiglio(a) {
    const mappa = {
      temporaneo: "Problema temporaneo: riprova più tardi.", dati: "Correggi i campi con Modifica sulla pagina di Vinted, poi riprova.",
      sessione: "Ricarica Vinted ed entra di nuovo.", "non-consentito": "Leggi il messaggio di Vinted: riprovare uguale non serve.",
      rete: "Controlla la connessione e riprova.", interno: "Copia il resoconto e segnalalo.",
      incerto: "Non riprovare: premi «Verifica pubblicazione» (serve una scheda di Vinted aperta) o controlla nell'armadio e conferma l'esito.",
      verificato: "Confermato a mano.",
      interrotto: "Niente è stato inviato a Vinted: riprovare è sicuro.",
    };
    return mappa[a.categoria] || "—";
  }

  /** Le regole con cui l'articolo e' partito (revisione registrata), o quelle attuali della batch. */
  function regoleUsate(b, a) {
    const rev = a.regole?.batch === b.id ? a.regole.rev : null;
    if (rev && rev !== (b.rev || 1)) return (b.storico || []).find((x) => x.rev === rev)?.overrides || {};
    return b.overrides || {};
  }

  /** «Ripubblica ora»: diventa il prossimo, senza fermare quello in corso. */
  async function ripubblicaOra(s, a) {
    const fai = async () => {
      const r = await chiedi("vr:queueNow", { id: a.id });
      if (!r.ok) return messaggio(r.motivo || r.error || "Non riuscito.", "error");
      const b = C.trovaBatch(s, r.batch);
      const regole = b && piuBatch(s) ? ` Regole: ${b.nome}.` : "";
      const quando = r.stato === "paused" ? "La coda è in pausa: sarà il primo alla ripresa."
        : r.stato === "scheduled" ? "Sarà il primo quando parte la coda programmata."
        : r.dopoCorrente ? "Parte dopo l'articolo in elaborazione, che non viene interrotto."
        : r.partenza ? `Parte verso le ${orario(r.partenza)}.` : "";
      daEvidenziare = a.id;
      filtro = "tutti";
      messaggio(`«${a.title}» è il prossimo.${r.riattivato ? " Rimesso in coda." : ""} ${quando}${regole}`, "ok");
      disegna();
    };
    // Un fallito si ritenta: e' un tentativo nuovo su Vinted, meglio dirlo prima.
    if (a.status === "error") {
      return conferma(`Ritentare subito «${a.title}»? L'ultimo tentativo è fallito: ${a.error || "errore"}.`, "Ripubblica ora", fai);
    }
    return fai();
  }

  /** «Verifica pubblicazione»: guarda Vinted dalla scheda aperta, cambia lo stato solo con una prova. */
  async function verifica(s, a) {
    if (inVerifica.has(a.id)) return;
    inVerifica.add(a.id);
    disegna();
    messaggio(`Verifico «${a.title}» su Vinted…`);
    try {
      const r = await chiedi("vr:queueVerify", { itemId: a.id, queue: s.startedAt });
      if (r.ok) messaggio(r.stato === "done" ? `Verificato: «${a.title}» è pubblicato (${r.motivo}).` : r.stato === "interrupted" ? `Verificato: niente era stato inviato a Vinted. Puoi riprovarlo.` : `Pubblicato, ma il vecchio annuncio va controllato: ${r.motivo}.`, r.stato === "done" || r.stato === "interrupted" ? "ok" : "warn");
      else messaggio(`Non ancora verificabile: ${r.motivo || r.error}. Resta «da verificare»: non riprovarlo.`, "warn");
    } finally {
      inVerifica.delete(a.id);
      disegna();
    }
  }

  async function sposta(id, dove) {
    const r = await chiedi("vr:queueMove", { ids: [id], dove });
    if (!r.ok) messaggio(r.motivo || r.error || r.rifiutati?.[0]?.motivo || "Non spostato.", "error");
    else messaggio("");
    requestAnimationFrame(() => righe.get(id)?.li.focus({ preventScroll: false }));
  }

  /** Trascinamento: nuovo ordine completo, che il service worker accetta solo se nel frattempo non e' cambiato niente. */
  async function rilascia(id, suId, prima) {
    const s = selezionata();
    const ordine = C.inAttesa(s).map((a) => a.id).filter((x) => x !== id);
    const i = ordine.indexOf(suId);
    if (i < 0) return;
    ordine.splice(prima ? i : i + 1, 0, id);
    const r = await chiedi("vr:queueReorder", { ordine });
    messaggio(r.ok ? "" : r.motivo || r.error || "Ordine non applicato.", r.ok ? "" : "error");
  }

  // -------------------------------------------------------------- cronologia

  const NATURE = { tutti: "Tutto", locale: "Modifiche alla coda", vinted: "Esiti di Vinted", sistema: "Sistema" };

  function disegnaCronologia(s) {
    const filtri = el("logFilters");
    filtri.textContent = "";
    for (const [k, nome] of Object.entries(NATURE)) {
      filtri.append(crea("button", { class: `chip${filtroLog === k ? " is-active" : ""}`, type: "button", "aria-pressed": String(filtroLog === k),
        onclick: () => { filtroLog = k; disegnaCronologia(s); } }, nome));
    }
    const lista = el("queueLog");
    lista.textContent = "";
    const eventi = [...(s.log || [])].reverse().filter((e) => filtroLog === "tutti" || e.natura === filtroLog).slice(0, 200);
    el("queueLogCount").textContent = `(${(s.log || []).length})`;
    if (!eventi.length) lista.append(crea("li", { class: "empty" }, "Nessun evento."));
    for (const e of eventi) {
      lista.append(crea("li", { class: `log-${e.natura}` },
        crea("span", { class: "log-icon", title: NATURE[e.natura] }, ICONE_LOG[e.natura] || "•"),
        crea("time", { datetime: new Date(e.at).toISOString() }, new Date(e.at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })),
        crea("span", { class: "log-text" }, e.testo, e.azione ? crea("em", {}, ` — ${e.azione}`) : null),
        e.id && s.items.some((a) => a.id === e.id)
          ? crea("button", { class: "link", type: "button", onclick: () => vaiA(e.id) }, "vai all'articolo")
          : null));
    }
  }

  function vaiA(id) {
    filtro = "tutti";
    cerca = "";
    el("queueSearch").value = "";
    disegna();
    const li = righe.get(id)?.li;
    if (!li) return;
    li.scrollIntoView({ behavior: "smooth", block: "center" });
    li.focus({ preventScroll: true });
    li.classList.add("flash");
    setTimeout(() => li.classList.remove("flash"), 1600);
  }

  // ------------------------------------------------------- esportazione

  const timbro = (t) => {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  };

  async function esporta(s, formato) {
    const versione = chrome.runtime.getManifest().version;
    const testo = formato === "csv" ? `﻿${C.esportaCSV(s)}` : JSON.stringify(C.esportaJSON(s, versione), null, 2);
    const tipo = formato === "csv" ? "text/csv" : "application/json";
    try {
      await chrome.downloads.download({
        url: `data:${tipo};charset=utf-8,${encodeURIComponent(testo)}`,
        filename: `Vinted Relist/vinted-relist-sessione-${timbro(s.startedAt)}.${formato}`,
        saveAs: false,
      });
      messaggio(`Resoconto ${formato.toUpperCase()} salvato in Download › Vinted Relist.`, "ok");
    } catch (e) {
      messaggio(`Esportazione non riuscita: ${e.message}`, "error");
    }
  }

  async function copiaResoconto(s) {
    const testo = C.resoconto(s, ora());
    try {
      await navigator.clipboard.writeText(testo);
      messaggio("Resoconto copiato: niente titoli, solo id, stati ed errori.", "ok");
    } catch {
      messaggio("Non riesco a copiare negli appunti.", "error");
    }
  }

  // --------------------------------------------- aggiunta dall'inventario

  /**
   * Articoli scelti nell'elenco della dashboard: con una coda in corso si
   * aggiungono a quella (stesse opzioni), altrimenti ne parte una nuova con le
   * opzioni salvate. Prima di inviare si vede cosa entra, cosa no e perche'.
   * Il controllo completo (lettura di ogni articolo) avviene quando ciascuno
   * viene elaborato: da qui non c'e' una scheda Vinted da usare per leggerli.
   */
  async function proponiAggiunta(items) {
    const box = el("addConfirm");
    box.textContent = "";
    box.hidden = false;
    const attiva = codaCorrente?.running && !codaCorrente.stopDopoCorrente;
    const valutati = attiva ? C.valutaAggiunta(codaCorrente, items) : items.map((i) => ({ id: i.id, esito: "aggiungi" }));
    const entrano = valutati.filter((v) => v.esito !== "rifiuta");
    const fuori = valutati.filter((v) => v.esito === "rifiuta");
    const titolo = (id) => items.find((i) => i.id === id)?.title || id;

    let config = "";
    let avvio = null;
    let form = null;
    if (attiva) {
      // La coda in corso non si ferma: questi articoli diventano una batch nuova,
      // con le regole scelte qui (partendo dalle ultime usate).
      const { queueDraft = {} } = await chrome.storage.local.get("queueDraft");
      const c = C.migra(codaCorrente);
      form = moduloRegole(queueDraft, { copiaDa: (c.batches || []).filter((b) => b.campi) });
    } else {
      const { queueDraft = {}, queueIntervalMin = 20 } = await chrome.storage.local.get(["queueDraft", "queueIntervalMin"]);
      const v = L()?.validaOpzioniCoda({ ...queueDraft, quando: "", intervallo: queueDraft.intervallo || String(queueIntervalMin) });
      if (!v?.ok) {
        box.append(crea("p", { class: "hint error" }, "Le opzioni della coda salvate non sono valide: aprile dalla pagina di Vinted e correggile."),
          bottone("Chiudi", "", () => { box.hidden = true; }));
        return;
      }
      avvio = { ...v, campi: Object.fromEntries(["modo", "valore", "aggiunta", "cerca", "con", "colore"].map((k) => [k, String(queueDraft[k] || "")])) };
      config = descrivi(v.overrides, v.intervalMin, queueDraft.modello);
    }

    let dove = "fondo";
    const radio = attiva ? crea("fieldset", { class: "dove" }, crea("legend", {}, "Dove"),
      ...[["fondo", "In fondo"], ["cima", "In cima, dopo quello in corso"]].map(([v, t]) => {
        const r = crea("input", { type: "radio", name: "dove", value: v, checked: v === "fondo" ? "" : null });
        r.addEventListener("change", () => { if (r.checked) dove = v; });
        return crea("label", {}, r, ` ${t}`);
      })) : null;

    const prossima = attiva ? `Batch ${Math.max(C.migra(codaCorrente).batchSeq || 0, C.migra(codaCorrente).batches?.length || 0) + 1}` : null;
    const ok = bottone(attiva ? `Aggiungi ${entrano.length} come ${prossima}` : `Avvia una coda con ${entrano.length}`, "btn-primary", async () => {
      const voci = entrano.map((v) => items.find((i) => i.id === v.id));
      let regole = null;
      if (attiva) {
        const v = form.leggi();
        if (!v.ok) return;
        regole = { overrides: v.overrides, campi: v.campi, modello: null };
      }
      const r = attiva
        ? await chiedi("vr:queueAdd", { items: voci, dove, batch: regole })
        : await chiedi("vr:queueStart", { items: voci, intervalMin: avvio.intervalMin, overrides: avvio.overrides, campi: avvio.campi, modello: null });
      box.hidden = true;
      if (r.ok) {
        messaggio(attiva ? `${(r.aggiunti?.length || 0) + (r.riattivati?.length || 0)} aggiunti alla coda come ${prossima}.` : "Coda avviata. Tieni aperta una scheda su Vinted.", "ok");
        window.dispatchEvent(new CustomEvent("vr-inventario-svuota"));
        el("coda").scrollIntoView({ behavior: "smooth", block: "start" });
      } else messaggio(r.error || r.rifiutati?.[0]?.motivo || "Non riuscito.", "error");
    }, { disabled: entrano.length ? null : "" });

    metti(box,
      crea("strong", {}, attiva ? `Aggiungi alla coda in corso · Centro di modifica per ${prossima}` : "Nuova coda"),
      crea("p", { class: "hint" }, attiva
        ? "Scegli le regole per questi articoli. La coda non si ferma e le batch già in coda tengono le loro. Ogni articolo viene letto e controllato quando arriva il suo turno."
        : `Opzioni salvate: ${config}. Ogni articolo viene comunque letto e controllato quando arriva il suo turno.`),
      form ? form.nodo : null,
      entrano.length ? crea("p", {}, `Entrano: ${entrano.map((v) => titolo(v.id)).join(", ")}`) : null,
      fuori.length ? crea("ul", { class: "fuori" }, fuori.map((v) => crea("li", {}, crea("b", {}, titolo(v.id)), ` — ${v.motivo}`))) : null,
      radio,
      crea("div", { class: "actions" }, ok, bottone("Annulla", "", () => { box.hidden = true; })));
    (form ? form.primo : ok).focus();
  }

  function descrivi(o = {}, intervalMin, modello) {
    o = o || {};
    const p = [];
    if (modello) p.push(`modello «${modello}»`);
    if (o.price) p.push(`prezzo a ${euro(o.price)}`);
    if (o.pricePercent) p.push(`${o.pricePercent > 0 ? "+" : ""}${o.pricePercent}% sul prezzo`);
    if (o.priceDelta) p.push(`${o.priceDelta > 0 ? "+" : ""}${euro(o.priceDelta)} sul prezzo`);
    if (o.descriptionAppend) p.push("riga in fondo alla descrizione");
    if (o.replace?.find) p.push(`sostituzione di «${o.replace.find}»`);
    if (o.autoFill) p.push("colore dai simili se manca");
    if (o.colorIds?.length) p.push("colore scelto se manca");
    if (intervalMin) p.push(`ogni ${intervalMin} min`);
    return p.length ? p.join(" · ") : "nessuna modifica";
  }

  // -------------------------------------------------------------- tastiera

  const SCORCIATOIE = {
    p: () => {
      const s = codaCorrente;
      if (!s?.running) return;
      chiedi(s.state === "paused" ? "vr:queueResume" : "vr:queuePause").then((r) => messaggio(r.ok ? (s.state === "paused" ? "Ripresa." : "Pausa.") : r.motivo || r.error, r.ok ? "ok" : "error"));
    },
    a: () => {
      const c = C.corrente(codaCorrente);
      if (c) window.open(`${origine()}/items/${encodeURIComponent(c.id)}`, "_blank", "noopener");
    },
    f: () => { filtro = filtro === "problemi" ? "tutti" : "problemi"; disegna(); },
    s: () => {
      const s = selezionata();
      if (!modificabile(s)) return;
      s.items.filter((a) => a.status === "pending").forEach((a) => selezione.add(a.id));
      disegna();
    },
    Delete: () => rimuoviSelezionati(),
    h: () => { const d = el("queueTimeline"); d.open = !d.open; if (d.open) d.scrollIntoView({ behavior: "smooth", block: "nearest" }); },
    c: () => { const s = selezionata(); if (s) copiaResoconto(s); },
    "?": () => { const d = el("queueKeys"); d.open = !d.open; },
  };

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    const fn = SCORCIATOIE[e.key] || SCORCIATOIE[e.key.toLowerCase?.()];
    if (!fn || !selezionata() && e.key !== "?") return;
    e.preventDefault();
    fn();
  });

  // ---------------------------------------------------------------- dati

  async function carica() {
    const d = await chrome.storage.local.get({ vrQueue: null, vrQueueArchive: [] });
    codaCorrente = C.migra(d.vrQueue);
    archivio = d.vrQueueArchive || [];
    try { passo = (await chrome.storage.session.get("vrQueueStep")).vrQueueStep || null; } catch { passo = null; }
    disegna();
  }

  chrome.storage.onChanged.addListener((m, area) => {
    if (area === "local" && ("vrQueue" in m || "vrQueueArchive" in m)) {
      if ("vrQueue" in m) codaCorrente = C.migra(m.vrQueue.newValue || null);
      if ("vrQueueArchive" in m) archivio = m.vrQueueArchive.newValue || [];
      disegna();
    }
    if (area === "session" && "vrQueueStep" in m) {
      passo = m.vrQueueStep.newValue || null;
      const s = selezionata();
      if (s) { disegnaCorrente(s); disegnaControlli(s); disegnaElenco(s); }
    }
  });

  // il conto del tempo trascorso scorre anche senza modifiche
  setInterval(() => { const s = selezionata(); if (s?.running) { disegnaRiepilogo(s); disegnaCorrente(s); } }, 15000);

  el("queuePick").addEventListener("change", (e) => {
    scelta = Number(e.target.value);
    selezione.clear();
    filtro = "tutti";
    history.replaceState(null, "", `#coda-${scelta}`);
    disegna();
  });
  let attesaRicerca = null;
  el("queueSearch").addEventListener("input", (e) => {
    clearTimeout(attesaRicerca);
    attesaRicerca = setTimeout(() => { cerca = e.target.value; disegna(); }, 120);
  });
  el("queueSort").addEventListener("change", (e) => { vista = e.target.value; disegna(); });

  /** #coda o #coda-<id>: apre il pannello su quella sessione e ci porta la vista. */
  function daHash() {
    const m = /^#coda(?:-(\d+))?$/.exec(location.hash);
    if (!m) return;
    richiesta = true;
    scelta = m[1] ? Number(m[1]) : null;
    filtro = "tutti";
    disegna();
    const pannello = el("coda");
    pannello.scrollIntoView({ behavior: "smooth", block: "start" });
    pannello.focus({ preventScroll: true });
    pannello.classList.add("flash");
    setTimeout(() => pannello.classList.remove("flash"), 1600);
  }
  window.addEventListener("hashchange", daHash);

  window.CodaUI = { carica, daHash, proponiAggiunta, disegna, get richiesta() { return richiesta; } };
  carica().then(daHash);
})();
