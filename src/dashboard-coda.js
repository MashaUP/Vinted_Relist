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
  const selezione = new Set();
  const righe = new Map();     // id → { li, firma }
  let trascinato = null;

  /** Element.append scrive "null" per i figli null: qui si saltano, come fa crea(). */
  const metti = (padre, ...figli) => padre.append(...figli.flat().filter((f) => f != null && f !== false));

  const FILTRI = {
    tutti: { nome: "Tutti", vale: () => true },
    attesa: { nome: "In attesa", vale: (a) => a.status === "pending" },
    corso: { nome: "In elaborazione", vale: (a) => a.status === "working" },
    problemi: { nome: "Problemi", vale: (a) => a.status === "error" || a.status === "verify" },
    completati: { nome: "Completati", vale: (a) => a.status === "done" },
    altri: { nome: "Saltati, annullati, rimossi", vale: (a) => ["skipped", "cancelled", "removed"].includes(a.status) },
  };
  const CLASSE_STATO = { pending: "", working: "ok", done: "ok", error: "error", verify: "warn", skipped: "", cancelled: "", removed: "" };
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
        `${dataOra(x.startedAt)} · ${r.totale} articoli · ${x.running ? "in corso" : `${r.done} ok, ${r.error + r.verify} da guardare`}${x.auto ? " · automatica" : ""}`));
    }
    pick.hidden = tutte.length < 2;
    if (s) pick.value = String(s.startedAt);

    const vuota = !s;
    for (const id of ["queueSummary", "queueToolbar", "queueList", "queueTimelineBox"]) el(id).hidden = vuota;
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
      r.skipped + r.cancelled ? voce(r.skipped + r.cancelled, "saltati o annullati") : null,
      r.removed ? voce(r.removed, "rimossi dalla coda") : null,
      voce(durata(st.trascorsoMs), "trascorso"),
      s.running ? voce(st.rimanenteMs == null ? "—" : `~ ${durata(st.rimanenteMs)}`, st.fineAlle && st.rimanenteMs ? `rimanente · fine verso le ${orario(st.fineAlle)}` : "rimanente") : null,
    );
    el("queueEta").textContent = s.running ? st.testo : "";
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
          const tardi = passo?.itemId === c.id && passo.fase === "invio";
          box.append(bottone("Annulla operazione", "", annulla, tardi
            ? { disabled: "", title: "La richiesta a Vinted è già partita: non si può annullare, si aspetta l'esito." }
            : { title: "Ferma l'articolo in corso, solo se non ha ancora inviato niente a Vinted." }));
        }
        box.append(bottoneInterrompi(r));
      }
    } else if (!s.running) {
      const { riprendibili } = C.daRiprendere(s);
      const riprovabili = s.items.filter((a) => a.status === "error" && a.sicuro !== "no").length;
      if (riprovabili) box.append(bottone(`Riprova i falliti (${riprovabili})`, "btn-primary", azione("vr:queueRetry", null, { queue: s.startedAt })));
      if (riprendibili.length) {
        box.append(bottone(`Riprendi gli articoli non elaborati (${riprendibili.length})`, "", async () => {
          const ris = await chiedi("vr:queueRestore", { queue: s.startedAt });
          const esclusi = (ris.esclusi || []).length ? ` Esclusi ${ris.esclusi.length}: ${[...new Set(ris.esclusi.map((e) => e.motivo))].join(", ")}.` : "";
          messaggio(ris.ok ? `Ripresi nella coda.${esclusi}` : `${ris.error || ris.rifiutati?.[0]?.motivo || "Non ripresa."}${esclusi}`, ris.ok ? "ok" : "error");
          if (ris.ok) { scelta = null; }
        }, { title: "Solo falliti riprovabili e annullati: mai i completati né quelli da verificare." }));
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
    let elenco = s.items.filter((a) => FILTRI[filtro].vale(a) && (!testo || piano(a.title).includes(testo) || a.id === testo));
    if (vista === "titolo") elenco = [...elenco].sort((a, b) => String(a.title).localeCompare(String(b.title), "it"));
    else if (vista === "prezzo") elenco = [...elenco].sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    else {
      // posizione: prima il corrente, poi gli in attesa in ordine, poi il resto
      const peso = (a) => (a.status === "working" ? 0 : a.status === "pending" ? 1 : 2);
      elenco = [...elenco].sort((a, b) => peso(a) - peso(b) || (peso(a) === 2 ? (b.finishedAt || 0) - (a.finishedAt || 0) : 0));
    }
    return elenco;
  }

  /** Riordino possibile solo guardando l'ordine vero, senza ricerca. */
  const riordinoAttivo = (s) => modificabile(s) && vista === "posizione" && !cerca.trim() && (filtro === "tutti" || filtro === "attesa");

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
      ? "Ordinamento solo visivo: la coda non cambia. Per spostare gli articoli torna a «Posizione»."
      : "Per spostare gli articoli togli la ricerca e mostra «Tutti» o «In attesa».";
  }

  /** Solo gli articoli su cui un'azione multipla puo' fare qualcosa. */
  const selezionabile = (s, a) => (modificabile(s) && a.status === "pending") || (a.status === "error" && a.sicuro !== "no" && (modificabile(s) || !s.running));

  function disegnaSelezione(s) {
    for (const id of [...selezione]) {
      const a = s.items.find((x) => x.id === id);
      if (!a || !selezionabile(s, a)) selezione.delete(id);
    }
    const scelti = s.items.filter((a) => selezione.has(a.id));
    const inAttesa = scelti.filter((a) => a.status === "pending").length;
    const falliti = scelti.filter((a) => a.status === "error").length;
    const bar = el("queueSelBar");
    bar.textContent = "";
    const attese = s.items.filter((a) => a.status === "pending").length;
    metti(bar,
      crea("span", { class: "sel-count", "aria-live": "polite" }, scelti.length ? `${scelti.length} selezionati` : "Nessuno selezionato"),
      modificabile(s) && attese ? bottone("Seleziona tutti in attesa", "quiet", () => { s.items.filter((a) => a.status === "pending").forEach((a) => selezione.add(a.id)); disegna(); }) : null,
      bottone("Sposta in cima", "", () => multipla("vr:queueMove", { dove: "cima" }, "spostati in cima", "pending"), { disabled: inAttesa && riordinoAttivo(s) ? null : "" }),
      bottone("Sposta in fondo", "", () => multipla("vr:queueMove", { dove: "fondo" }, "spostati in fondo", "pending"), { disabled: inAttesa && riordinoAttivo(s) ? null : "" }),
      bottone("Rimuovi dalla coda", "danger", () => rimuoviSelezionati(), { disabled: inAttesa ? null : "", title: "Toglie dalla pianificazione: niente viene cancellato su Vinted." }),
      bottone("Riprova", "", () => multipla("vr:queueRetry", { queue: s.startedAt }, "rimessi in coda", "error"), { disabled: falliti ? null : "" }),
      scelti.length ? bottone("Deseleziona tutti", "quiet", () => { selezione.clear(); disegna(); }) : null);
  }

  async function multipla(tipo, extra, verbo, stato) {
    const s = selezionata();
    const ids = s.items.filter((a) => selezione.has(a.id) && a.status === stato).map((a) => a.id);
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
    for (const a of elenco) {
      const pos = a.status === "pending" ? attive.indexOf(a.id) + 1 : null;
      const mio = passo?.itemId === a.id ? passo : null;
      const firma = JSON.stringify([a, pos, mod, riordino, selezione.has(a.id), mio?.fase, corrente(s), origine()]);
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
    const meta = [
      `ID ${a.id}`,
      typeof a.price === "number" ? euro(a.price) : null,
      a.aggiuntoDopo ? "aggiunto durante la sessione" : null,
      a.tentativi ? `${a.tentativi}° tentativo` : null,
    ].filter(Boolean).join(" · ");

    const link = a.status === "done"
      ? crea("span", { class: "q-title" }, a.title)
      : crea("a", { class: "q-title", href: `${origine()}/items/${encodeURIComponent(a.id)}`, target: "_blank", rel: "noopener" }, a.title);

    const corpo = crea("div", { class: "q-body" },
      crea("div", { class: "q-line" }, pos ? crea("span", { class: "q-pos", title: "Posizione nella coda" }, `#${pos}`) : null, link, stato),
      crea("p", { class: "q-meta" }, meta),
      a.status === "working" && mio ? crea("p", { class: "q-why" }, `${mio.step}${mio.fase === "invio" ? " · richiesta già inviata a Vinted" : ""}`) : null,
      a.error ? crea("p", { class: "q-why" }, a.error,
        a.categoria ? crea("span", { class: "q-cat" }, ` · ${C.ETICHETTE_CATEGORIA[a.categoria] || a.categoria}`) : null,
        a.status === "error" ? crea("span", { class: "q-cat" }, ` · riprovare: ${{ si: "sì", "dopo-correzione": "dopo aver corretto", no: "non serve" }[a.sicuro] || "probabilmente sì"}`) : null) : null);

    // azioni compatibili con lo stato: niente bottoni inerti
    const azioni = crea("div", { class: "q-actions" });
    const az = (testo, nome, fn, attr = {}) => azioni.append(crea("button", { class: "btn btn-sm", type: "button", "data-azione": nome, onclick: fn, ...attr }, testo));
    if (a.status === "pending" && mod) {
      const spento = riordino ? {} : { disabled: "", title: "Riordino disattivato con ricerca, filtri o ordinamento visivo" };
      az("↑", "su", () => sposta(a.id, "su"), { "aria-label": "Sposta su", disabled: pos === 1 || !riordino ? "" : null, title: spento.title || "Sposta su" });
      az("↓", "giu", () => sposta(a.id, "giu"), { "aria-label": "Sposta giù", disabled: ultimo || !riordino ? "" : null, title: spento.title || "Sposta giù" });
      az("⤒", "cima", () => sposta(a.id, "cima"), { "aria-label": "Sposta in cima", disabled: pos === 1 || !riordino ? "" : null, title: spento.title || "Sposta in cima" });
      az("⤓", "fondo", () => sposta(a.id, "fondo"), { "aria-label": "Sposta in fondo", disabled: ultimo || !riordino ? "" : null, title: spento.title || "Sposta in fondo" });
      az("Rimuovi", "rimuovi", async () => esitoAzione(await chiedi("vr:queueRemove", { ids: [a.id] }), "rimosso dalla coda"), { title: "Toglie dalla pianificazione: niente viene cancellato su Vinted." });
    }
    if (a.status === "working" && mod) {
      const tardi = mio?.fase === "invio";
      az("Annulla operazione", "annulla", annulla, tardi ? { disabled: "", title: "La richiesta a Vinted è già partita: si aspetta l'esito." } : {});
    }
    if (a.status === "error" && a.sicuro !== "no" && (mod || !s.running)) {
      az("Riprova", "riprova", async () => esitoAzione(await chiedi("vr:queueRetry", { queue: s.startedAt, ids: [a.id] }), "rimesso in coda"));
    }
    if (a.status === "verify") {
      az("È stato pubblicato", "pubblicato", async () => esitoAzione(await chiedi("vr:queueResolve", { itemId: a.id, pubblicato: true, queue: s.startedAt }), "verificato"));
      az("Non è uscito", "nonuscito", async () => esitoAzione(await chiedi("vr:queueResolve", { itemId: a.id, pubblicato: false, queue: s.startedAt }), "verificato"));
    }
    const dettagli = crea("div", { class: "q-details", hidden: "" },
      crea("dl", {},
        ...[["Aggiunto", a.addedAt], ["Iniziato", a.startedAt], ["Finito", a.finishedAt]]
          .filter(([, t]) => t).flatMap(([n, t]) => [crea("dt", {}, n), crea("dd", {}, dataOra(t))]),
        a.startedAt && a.finishedAt ? [crea("dt", {}, "Durata"), crea("dd", {}, `${Math.round((a.finishedAt - a.startedAt) / 1000)} s`)] : null,
        a.ultimoErrore ? [crea("dt", {}, "Errore precedente"), crea("dd", {}, a.ultimoErrore)] : null,
        a.categoria ? [crea("dt", {}, "Cosa fare"), crea("dd", {}, consiglio(a))] : null));
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
      incerto: "Controlla nell'armadio se il nuovo annuncio c'è, poi conferma l'esito.", verificato: "Confermato a mano.",
    };
    return mappa[a.categoria] || "—";
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
    if (!attiva) {
      const { queueDraft = {}, queueIntervalMin = 20 } = await chrome.storage.local.get(["queueDraft", "queueIntervalMin"]);
      const v = L()?.validaOpzioniCoda({ ...queueDraft, quando: "", intervallo: queueDraft.intervallo || String(queueIntervalMin) });
      if (!v?.ok) {
        box.append(crea("p", { class: "hint error" }, "Le opzioni della coda salvate non sono valide: aprile dalla pagina di Vinted e correggile."),
          bottone("Chiudi", "", () => { box.hidden = true; }));
        return;
      }
      avvio = v;
      config = descrivi(v.overrides, v.intervalMin, queueDraft.modello);
    }

    let dove = "fondo";
    const radio = attiva ? crea("fieldset", { class: "dove" }, crea("legend", {}, "Dove"),
      ...[["fondo", "In fondo"], ["cima", "In cima, dopo quello in corso"]].map(([v, t]) => {
        const r = crea("input", { type: "radio", name: "dove", value: v, checked: v === "fondo" ? "" : null });
        r.addEventListener("change", () => { if (r.checked) dove = v; });
        return crea("label", {}, r, ` ${t}`);
      })) : null;

    const ok = bottone(attiva ? `Aggiungi ${entrano.length} alla coda` : `Avvia una coda con ${entrano.length}`, "btn-primary", async () => {
      const voci = entrano.map((v) => items.find((i) => i.id === v.id));
      const r = attiva
        ? await chiedi("vr:queueAdd", { items: voci, dove })
        : await chiedi("vr:queueStart", { items: voci, intervalMin: avvio.intervalMin, overrides: avvio.overrides, modello: null });
      box.hidden = true;
      if (r.ok) {
        messaggio(attiva ? `${(r.aggiunti?.length || 0) + (r.riattivati?.length || 0)} aggiunti alla coda.` : "Coda avviata. Tieni aperta una scheda su Vinted.", "ok");
        window.dispatchEvent(new CustomEvent("vr-inventario-svuota"));
        el("coda").scrollIntoView({ behavior: "smooth", block: "start" });
      } else messaggio(r.error || r.rifiutati?.[0]?.motivo || "Non riuscito.", "error");
    }, { disabled: entrano.length ? null : "" });

    metti(box,
      crea("strong", {}, attiva ? "Aggiungi alla coda in corso" : "Nuova coda"),
      crea("p", { class: "hint" }, attiva
        ? `Useranno le opzioni della coda in corso: ${descrivi(codaCorrente.overrides, codaCorrente.intervalMin, codaCorrente.modello)}.`
        : `Opzioni salvate: ${config}. Ogni articolo viene comunque letto e controllato quando arriva il suo turno.`),
      entrano.length ? crea("p", {}, `Entrano: ${entrano.map((v) => titolo(v.id)).join(", ")}`) : null,
      fuori.length ? crea("ul", { class: "fuori" }, fuori.map((v) => crea("li", {}, crea("b", {}, titolo(v.id)), ` — ${v.motivo}`))) : null,
      radio,
      crea("div", { class: "actions" }, ok, bottone("Annulla", "", () => { box.hidden = true; })));
    ok.focus();
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
