/* Selezione multipla e pannello della coda. */
(() => {
  const VR = (window.VR = window.VR || {});
  const h = VR.h;

  // ---------------------------------------------------------------- selezione

  const selezionati = new Set();
  const caselle = new Map();           // id → input, per "tutti" e "deseleziona"

  function titoloDi(id) {
    const link = document.querySelector(`a[href*="/items/${id}"]`);
    const testo = (link?.getAttribute("title") || link?.textContent || "").trim();
    return testo ? testo.slice(0, 60) : `Articolo ${id}`;
  }

  let ultimoIndice = -1;

  /** Le caselle in ordine di pagina: l'intervallo dello shift-click e' questo. */
  const inOrdine = () => [...document.querySelectorAll(".vr-bar__pick")];

  VR.selection = {
    registra(id, input) {
      // Vinted ridisegna le card navigando: le caselle staccate vanno via.
      for (const [chiave, vecchia] of caselle) {
        if (!vecchia.isConnected) caselle.delete(chiave);
      }
      caselle.set(id, input);
      input.checked = selezionati.has(id);
    },
    cambia(id, acceso) {
      if (acceso) selezionati.add(id);
      else selezionati.delete(id);
      disegna();
    },
    /** Clic su una casella: con Shift estende dall'ultima toccata a questa. */
    clic(id, evento) {
      const input = evento.target;
      const elenco = inOrdine();
      const indice = elenco.indexOf(input);

      if (evento.shiftKey && ultimoIndice >= 0 && indice >= 0) {
        const da = Math.min(ultimoIndice, indice);
        const a = Math.max(ultimoIndice, indice);
        for (let k = da; k <= a; k++) {
          const casella = elenco[k];
          casella.checked = input.checked;
          const suo = casella.dataset.vrId;
          if (input.checked) selezionati.add(suo);
          else selezionati.delete(suo);
        }
      } else if (input.checked) {
        selezionati.add(id);
      } else {
        selezionati.delete(id);
      }

      ultimoIndice = indice;
      disegna();
    },
    tutti() {
      for (const [id, input] of caselle) {
        if (!input.isConnected) continue;
        input.checked = true;
        selezionati.add(id);
      }
      disegna();
    },
    nessuno() {
      for (const input of caselle.values()) {
        if (input.isConnected) input.checked = false;
      }
      selezionati.clear();
      ultimoIndice = -1;
      disegna();
    },
  };

  // ------------------------------------------------------------------ pannello

  let pannello = null;
  let coda = null;
  let tic = null;
  let controlloInCorso = false;

  /**
   * Opzioni della coda come le hai scritte nella finestra. Restano salvate tra
   * una sessione e l'altra; l'orario di avvio no, perche' scade.
   */
  const OPZIONI_VUOTE = {
    modo: "", valore: "", aggiunta: "", cerca: "", con: "", colore: "", quando: "", intervallo: "",
    modello: "",          // nome del modello applicato, se le opzioni sono ancora quelle
  };
  const CAMPI_OPZIONI = ["modo", "valore", "aggiunta", "cerca", "con", "colore", "intervallo"];

  /**
   * Modelli di opzioni riutilizzabili. Solo impostazioni: niente articoli,
   * niente orario di avvio (scade). Massimo 20.
   */
  const MAX_MODELLI = 20;
  const leggiModelli = async () => (await chrome.storage.local.get("queueTemplates")).queueTemplates || [];
  const soloCampi = (o) => Object.fromEntries(CAMPI_OPZIONI.map((k) => [k, String(o?.[k] ?? "")]));
  let opzioni = { ...OPZIONI_VUOTE };

  const L = () => VR.editorLogica;
  const intervalloPredefinito = () => String(VR.settings.queueIntervalMin || 20);
  const conIntervallo = (o) => ({ ...o, intervallo: o.intervallo || intervalloPredefinito() });
  const validate = () => L().validaOpzioniCoda(conIntervallo(opzioni));

  chrome.storage.local.get("queueDraft").then(({ queueDraft }) => {
    if (queueDraft && typeof queueDraft === "object") {
      opzioni = { ...OPZIONI_VUOTE, ...queueDraft, quando: "" };
      disegna();
    }
  });

  const salvaOpzioni = async (nuove) => {
    opzioni = { ...OPZIONI_VUOTE, ...nuove };
    const { quando, ...daSalvare } = opzioni;
    await chrome.storage.local.set({ queueDraft: daSalvare });
    const v = validate();
    if (v.ok) await VR.saveSettings({ queueIntervalMin: v.intervalMin });
  };

  const euro = (n) => Number(n).toLocaleString("it-IT", { style: "currency", currency: "EUR" });

  /** Le opzioni della coda in parole: per il pannello, il riepilogo e la coda in corso. */
  function descriviOverrides(o = {}, { intervalMin = null, startAt = null, modello = null } = {}) {
    o = o || {};
    const parti = [];
    if (modello) parti.push(`modello «${modello}»`);
    if (o.price) parti.push(`prezzo a ${euro(o.price)}`);
    if (o.pricePercent) parti.push(`${o.pricePercent > 0 ? "+" : ""}${o.pricePercent}% sul prezzo`);
    if (o.priceDelta) parti.push(`${o.priceDelta > 0 ? "+" : ""}${euro(o.priceDelta)} sul prezzo`);
    if (o.descriptionAppend) parti.push("riga in fondo alla descrizione");
    if (o.replace?.find) parti.push(o.replace.with ? `«${o.replace.find}» → «${o.replace.with}»` : `tolto «${o.replace.find}»`);
    if (o.autoFill) parti.push("colore dai simili se manca");
    if (o.colorIds?.length) parti.push(`colore ${(VR.settings.colorMap || {})[o.colorIds[0]] || o.colorIds[0]} se manca`);
    if (startAt) parti.push(`parte ${new Date(startAt).toLocaleString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`);
    if (intervalMin) parti.push(`ogni ${intervalMin} min`);
    return parti.length ? parti.join(" · ") : "nessuna modifica";
  }

  function descriviOpzioni() {
    const v = validate();
    if (!v.ok) return "Opzioni da correggere";
    return descriviOverrides(v.overrides || {}, { intervalMin: v.intervalMin, startAt: v.startAt, modello: opzioni.modello });
  }

  /**
   * Menu dei colori costruito sui colori visti nei tuoi articoli.
   * Nessun elenco inventato: si riempie man mano che leggi gli annunci.
   */
  VR.selectColore = (selezionato, { primaVoce = "Nessun colore", conDeduzione = false } = {}) => {
    const noti = Object.entries(VR.settings.colorMap || {}).sort((a, b) => a[1].localeCompare(b[1], "it"));

    const select = VR.h("select", { class: "vr-input" },
      VR.h("option", { value: "" }, noti.length || conDeduzione ? primaVoce : "Nessun colore conosciuto"),
      conDeduzione ? VR.h("option", { value: "auto" }, "Deduci dai tuoi articoli simili") : null
    );
    for (const [id, nome] of noti) select.append(VR.h("option", { value: id }, nome));
    if (selezionato) select.value = String(selezionato);
    select.disabled = !noti.length && !conDeduzione;
    return select;
  };

  /** Titolo e miniatura di un articolo, dalla card che hai davanti. */
  function infoCard(id) {
    const link = document.querySelector(`a[href*="/items/${id}"]`);
    const testo = (link?.getAttribute("title") || link?.textContent || "").trim();
    const card = link?.closest('[class*="new-item-box__container"], .feed-grid__item') || link?.parentElement;
    const img = card?.querySelector("img");
    return { id, title: testo ? testo.slice(0, 80) : `Articolo ${id}`, thumb: img?.currentSrc || img?.src || null };
  }

  // ------------------------------------------------------- finestra opzioni

  async function apriOpzioni({ eAvvia = false } = {}) {
    // Il toast in basso copriva i controlli: si chiude, l'evento resta nel registro.
    VR.toast.chiudiTutti();
    const h2 = VR.h;
    const formaDi = (o) => ({ ...soloCampi(conIntervallo(o)), quando: String(o.quando || "") });
    let f = formaDi(opzioni);
    const salvate = JSON.stringify(formaDi(opzioni));
    let modelli = await leggiModelli();
    let modelloApplicato = opzioni.modello || "";

    const campo = (etichetta, input, nome, nota) => {
      const errore = h2("p", { class: "vr-field__error", id: `vr-err-${nome}`, hidden: true });
      input.setAttribute("aria-describedby", `vr-err-${nome}`);
      return { nodo: h2("label", { class: "vr-field" },
        h2("span", { class: "vr-field__label" }, etichetta), input,
        nota ? h2("span", { class: "vr-field__help" }, nota) : null, errore), errore };
    };

    const modo = h2("select", { class: "vr-input" },
      h2("option", { value: "" }, "Prezzo invariato"),
      h2("option", { value: "percent" }, "Variazione in percentuale"),
      h2("option", { value: "delta" }, "Variazione in euro"),
      h2("option", { value: "fixed" }, "Prezzo fisso per tutti"));
    const valore = h2("input", { class: "vr-input", type: "text", inputmode: "decimal" });
    const unita = h2("span", { class: "vr-unit" });
    const anteprima = h2("p", { class: "vr-preview-price", "aria-live": "polite" });
    const aggiunta = h2("textarea", { class: "vr-input vr-input--area", rows: "3", placeholder: "Es. Spedizione rapida entro 24 ore." });
    const cerca = h2("input", { class: "vr-input", type: "text", placeholder: "es. #starwars" });
    const con = h2("input", { class: "vr-input", type: "text", placeholder: "vuoto = togli" });
    const colore = VR.selectColore(f.colore, { primaVoce: "Lascia come è", conDeduzione: true });
    const quando = h2("input", { class: "vr-input", type: "datetime-local" });
    const intervallo = h2("input", { class: "vr-input", type: "number", min: "1", max: "240", step: "1" });

    modo.value = f.modo; valore.value = f.valore; aggiunta.value = f.aggiunta; cerca.value = f.cerca;
    con.value = f.con; colore.value = f.colore || ""; quando.value = f.quando; intervallo.value = f.intervallo;

    const cValore = campo("Valore", h2("span", { class: "vr-input-unit" }, valore, unita), "valore");
    const cAggiunta = campo("Aggiungi in fondo alla descrizione", aggiunta, "aggiunta");
    const cCerca = campo("Cerca nel titolo e nella descrizione", cerca, "cerca");
    const cCon = campo("Sostituisci con", con, "con");
    const cColore = campo("Colore, dove manca", colore, "colore",
      VR.settings.autoFill !== false ? "Il riempimento dai simili è già attivo nelle impostazioni." : null);
    const cQuando = campo("Avvia alle", quando, "quando", "Vuoto = subito.");
    const cIntervallo = campo("Intervallo tra gli articoli (minuti)", intervallo, "intervallo",
      VR.settings.peakOnly ? "Le fasce di picco sono attive: fuori fascia la coda aspetta." : null);
    const errori = { valore: cValore.errore, aggiunta: cAggiunta.errore, cerca: cCerca.errore, quando: cQuando.errore, intervallo: cIntervallo.errore };

    const statoBozza = h2("span", { class: "vr-editor__badge" });

    // ----- modelli
    const etichettaModello = h2("span", { class: "vr-field__help" });
    const sceltaModello = h2("select", { class: "vr-input vr-input--sm", "aria-label": "Modello di opzioni" });
    const zonaModelli = h2("div", { class: "vr-templates__ask", hidden: true, role: "group" });
    const bApplica = h2("button", { class: "vr-btn vr-btn--ghost vr-btn--sm", type: "button" }, "Applica");
    const bElimina = h2("button", { class: "vr-btn vr-btn--quiet vr-btn--sm", type: "button" }, "Elimina");
    const bSalvaModello = h2("button", { class: "vr-btn vr-btn--ghost vr-btn--sm", type: "button" }, "Salva come modello…");

    function riempiModelli(selezionato = "") {
      sceltaModello.textContent = "";
      sceltaModello.append(h2("option", { value: "" }, modelli.length ? "Scegli un modello…" : "Nessun modello salvato"));
      for (const m of modelli) sceltaModello.append(h2("option", { value: m.nome }, m.nome));
      sceltaModello.value = selezionato;
      sceltaModello.disabled = !modelli.length;
      bApplica.disabled = !sceltaModello.value;
      bElimina.disabled = !sceltaModello.value;
    }
    sceltaModello.addEventListener("change", () => { bApplica.disabled = bElimina.disabled = !sceltaModello.value; chiediChiudi(); });

    /** Domanda in linea al posto di un confirm(): testo, pulsanti, e si richiude. */
    function chiedi(testo, azioni) {
      zonaModelli.textContent = "";
      zonaModelli.hidden = false;
      zonaModelli.append(h2("span", {}, testo), ...azioni.map(([etichetta, fn, classe]) =>
        h2("button", { class: `vr-btn vr-btn--${classe || "ghost"} vr-btn--sm`, type: "button", onclick: fn }, etichetta)));
      zonaModelli.querySelector("input, button")?.focus();
    }
    function chiediChiudi() { zonaModelli.hidden = true; zonaModelli.textContent = ""; }

    function applicaModello(m) {
      const o = soloCampi(m.opzioni);
      modo.value = o.modo; valore.value = o.valore; aggiunta.value = o.aggiunta; cerca.value = o.cerca;
      con.value = o.con; colore.value = o.colore || ""; intervallo.value = o.intervallo || intervalloPredefinito();
      modelloApplicato = m.nome;
      chiediChiudi();
      aggiorna();
    }

    bApplica.addEventListener("click", () => {
      const m = modelli.find((x) => x.nome === sceltaModello.value);
      if (!m) return;
      const sporco = JSON.stringify(f) !== salvate;
      if (!sporco) return applicaModello(m);
      chiedi(`Hai modifiche non salvate: sostituirle con «${m.nome}»?`, [
        ["Sostituisci", () => applicaModello(m), "primary"], ["Annulla", chiediChiudi]]);
    });

    bElimina.addEventListener("click", () => {
      const nome = sceltaModello.value;
      if (!nome) return;
      chiedi(`Eliminare il modello «${nome}»? Le code già avviate non cambiano.`, [
        ["Elimina", async () => {
          modelli = modelli.filter((x) => x.nome !== nome);
          await chrome.storage.local.set({ queueTemplates: modelli });
          if (modelloApplicato === nome) modelloApplicato = "";
          riempiModelli();
          chiediChiudi();
          aggiorna();
        }, "primary"], ["Annulla", chiediChiudi]]);
    });

    bSalvaModello.addEventListener("click", () => {
      if (!aggiorna().ok) {
        chiedi("Correggi prima i campi segnati: un modello si salva solo se valido.", [["Ok", chiediChiudi]]);
        return;
      }
      const nome = h2("input", { class: "vr-input vr-input--sm", type: "text", maxlength: "40", placeholder: "Nome del modello", "aria-label": "Nome del modello" });
      nome.value = modelloApplicato || "";
      const salva = async (sostituisci = false) => {
        const n = nome.value.trim().replace(/\s+/g, " ").slice(0, 40);
        if (!n) { nome.focus(); return; }
        if (!sostituisci && modelli.some((x) => x.nome === n)) {
          chiedi(`Esiste già un modello «${n}»: sostituirlo?`, [["Sostituisci", () => { nome.value = n; salvaVero(n); }, "primary"], ["Annulla", chiediChiudi]]);
          return;
        }
        salvaVero(n);
      };
      const salvaVero = async (n) => {
        if (!modelli.some((x) => x.nome === n) && modelli.length >= MAX_MODELLI) {
          chiedi(`Al massimo ${MAX_MODELLI} modelli: eliminane uno prima.`, [["Ok", chiediChiudi]]);
          return;
        }
        const voce = { nome: n, opzioni: soloCampi(f), creato: Date.now() };
        modelli = [voce, ...modelli.filter((x) => x.nome !== n)];
        await chrome.storage.local.set({ queueTemplates: modelli });
        modelloApplicato = n;
        riempiModelli(n);
        chiediChiudi();
        aggiorna();
      };
      nome.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); salva(); } });
      chiedi("Salva le opzioni attuali come:", [["Salva", () => salva(), "primary"], ["Annulla", chiediChiudi]]);
      zonaModelli.insertBefore(nome, zonaModelli.children[1]);
      nome.focus();
    });
    riempiModelli();
    const bSalva = h2("button", { class: "vr-btn vr-btn--ghost", type: "button" }, "Salva");
    const bAvvia = h2("button", { class: "vr-btn vr-btn--primary", type: "button" }, "Salva e avvia");

    // prezzo di esempio: il primo articolo selezionato di cui conosciamo il prezzo
    const { inventory = {} } = await chrome.storage.local.get("inventory");
    const esempio = [...selezionati].map((id) => ({ id, ...inventory[id] })).find((a) => typeof a.price === "number");

    function aggiorna() {
      f = { modo: modo.value, valore: valore.value, aggiunta: aggiunta.value, cerca: cerca.value,
            con: con.value, colore: colore.value, intervallo: intervallo.value, quando: quando.value };
      const v = L().validaOpzioniCoda(f);

      // Il nome del modello resta solo finche' le opzioni sono le sue.
      const m = modelli.find((x) => x.nome === modelloApplicato);
      if (modelloApplicato && (!m || JSON.stringify(soloCampi(m.opzioni)) !== JSON.stringify(soloCampi(f)))) modelloApplicato = "";
      etichettaModello.textContent = modelloApplicato ? `Modello «${modelloApplicato}»` : "";

      cValore.nodo.hidden = !f.modo;
      unita.textContent = f.modo === "percent" ? "%" : f.modo ? "€" : "";
      valore.placeholder = { percent: "es. -10", delta: "es. -0,50", fixed: "es. 8,50" }[f.modo] || "";
      cCon.nodo.hidden = !f.cerca;

      for (const [nome, nodo] of Object.entries(errori)) {
        nodo.hidden = !v.errori[nome];
        nodo.textContent = v.errori[nome] || "";
        nodo.previousElementSibling?.classList?.toggle("is-invalid", Boolean(v.errori[nome]));
      }

      if (!f.modo) anteprima.textContent = "";
      else if (v.errori.valore) anteprima.textContent = "";
      else if (!esempio) anteprima.textContent = "Anteprima non disponibile: il prezzo degli articoli selezionati non è ancora stato letto.";
      else {
        // solo i campi del prezzo: un errore altrove (es. l'intervallo) non deve falsare l'anteprima
        const soloPrezzo = L().validaOpzioniCoda({ modo: f.modo, valore: f.valore, intervallo: "20" });
        const dopo = L().applicaPrezzo(esempio.price, soloPrezzo.overrides || {});
        anteprima.textContent = `Su «${(esempio.title || "").slice(0, 40)}»: ${euro(esempio.price)} → ${euro(dopo)}`;
      }

      const modificato = JSON.stringify(f) !== salvate;
      statoBozza.textContent = modificato ? "Modifiche non salvate" : "Salvate";
      statoBozza.classList.toggle("is-dirty", modificato);
      bSalva.disabled = !v.ok;
      bAvvia.disabled = !v.ok;
      return v;
    }

    for (const el of [modo, valore, aggiunta, cerca, con, colore, quando, intervallo]) {
      el.addEventListener("input", aggiorna);
      el.addEventListener("change", aggiorna);
    }

    const sezione = (titolo, ...figli) =>
      h2("fieldset", { class: "vr-section" }, h2("legend", { class: "vr-section__title" }, titolo), ...figli);

    const card = h2("div", { class: "vr-card vr-card--wide vr-options", role: "dialog", "aria-modal": "true", "aria-labelledby": "vr-opt-title" },
      h2("div", { class: "vr-editor__head" },
        h2("h2", { class: "vr-card__title", id: "vr-opt-title" }, "Opzioni della coda"),
        statoBozza,
        h2("button", { class: "vr-close", type: "button", "aria-label": "Chiudi senza salvare", title: "Chiudi senza salvare", onclick: () => chiudi() }, "×")),
      h2("p", { class: "vr-note" }, `Valgono per ${selezionati.size} ${selezionati.size === 1 ? "articolo selezionato" : "articoli selezionati"}. Foto, titolo intero e taglia si cambiano dal singolo articolo con Modifica.`),
      coda?.running
        ? h2("p", { class: "vr-note vr-note--warn" }, "C'è una coda in corso: queste opzioni valgono per la prossima coda. Gli articoli che aggiungi a quella in corso usano le opzioni con cui è partita.")
        : null,
      h2("div", { class: "vr-templates" },
        h2("label", { class: "vr-templates__pick" }, h2("span", { class: "vr-field__label" }, "Modello"), sceltaModello),
        bApplica, bElimina, h2("span", { class: "vr-templates__spacer" }), bSalvaModello),
      zonaModelli,
      etichettaModello,
      sezione("Prezzo",
        h2("div", { class: "vr-row" }, campo("Modalità", modo, "modo").nodo, cValore.nodo),
        anteprima),
      sezione("Testo e descrizione",
        cAggiunta.nodo,
        h2("div", { class: "vr-row" }, cCerca.nodo, cCon.nodo),
        h2("p", { class: "vr-field__help" }, "La ricerca è letterale e ignora le maiuscole: niente caratteri speciali da conoscere.")),
      sezione("Dati mancanti",
        cColore.nodo,
        h2("p", { class: "vr-field__help" },
          "Gli articoli che hanno già un colore restano com'erano. " +
          (VR.settings.canary !== false
            ? "Prima di avviare, ogni articolo viene letto (senza pubblicare) e ti dico cosa manca."
            : "Il controllo prima di avviare è spento nelle impostazioni."))),
      sezione("Pianificazione",
        h2("div", { class: "vr-row" }, cQuando.nodo, cIntervallo.nodo)),
      h2("div", { class: "vr-actions vr-actions--split" },
        h2("button", {
          class: "vr-btn vr-btn--quiet", type: "button",
          onclick: () => {
            modo.value = ""; valore.value = ""; aggiunta.value = ""; cerca.value = ""; con.value = "";
            colore.value = ""; quando.value = ""; intervallo.value = "20";
            modelloApplicato = "";
            aggiorna();
          },
        }, "Ripristina predefiniti"),
        h2("span", { class: "vr-actions__group" },
          h2("button", { class: "vr-btn vr-btn--ghost", type: "button", onclick: () => chiudi() }, "Annulla"),
          bSalva, bAvvia))
    );

    bSalva.addEventListener("click", async () => {
      if (!aggiorna().ok) return;
      await salvaOpzioni({ ...f, modello: modelloApplicato });
      chiudi();
      disegna();
    });
    bAvvia.addEventListener("click", async () => {
      if (!aggiorna().ok) return;
      await salvaOpzioni({ ...f, modello: modelloApplicato });
      chiudi();
      disegna();
      parti();
    });

    aggiorna();
    const chiudi = VR.openOverlay(card);
    (eAvvia ? bAvvia : modo).focus();
  }

  // ------------------------------------------------------ controllo preventivo

  const CL = () => window.CodaLogica;

  /**
   * Legge ogni articolo selezionato, senza pubblicare niente, e li divide in
   * pronti, con avvisi e bloccati. La foto si prova a scaricare solo sul primo:
   * per gli altri basta sapere che ce l'hanno.
   * Non garantisce il risultato: Vinted decide al momento della pubblicazione.
   */
  async function controlloPreventivo(items, overrides, avanzamento) {
    const { vrQueue: precedente, vrQueueArchive = [] } = await chrome.storage.local.get(["vrQueue", "vrQueueArchive"]);
    // Incerti delle ultime sessioni: potrebbero essere gia' stati ripubblicati.
    const daVerificare = new Set();
    for (const s of [precedente, ...vrQueueArchive.slice(0, 3)]) {
      for (const i of s?.items || []) if (i.status === "verify") daVerificare.add(String(i.id));
    }

    const esiti = [];
    for (let i = 0; i < items.length; i++) {
      avanzamento(i + 1, items.length);
      const it = items[i];
      const r = await VR.canary(it.id, overrides || {}, { foto: i === 0 });
      const avvisi = [...(r.avvisi || [])];
      if (daVerificare.has(String(it.id))) {
        avvisi.unshift("era «da verificare» in una sessione recente: controlla che non sia già stato ripubblicato");
      }
      esiti.push({ ...it, ok: r.ok, problemi: r.problemi || [], avvisi, note: r.note || [], sessione: r.sessione });
      if (r.sessione) break;            // senza sessione e' inutile leggere gli altri
      if (i < items.length - 1) await VR.sleep(400);
    }
    return esiti;
  }

  /**
   * Riepilogo prima di avviare (o di aggiungere a una coda in corso): cosa
   * parte, in che ordine, con quali opzioni, quali prezzi cambiano e cosa resta
   * fuori e perche'. Risolve con { items, dove } oppure null.
   */
  function mostraRiepilogo({ voci, controllati, rifiutati = [], attiva, overrides = {}, descrizione, totale }) {
    const h2 = VR.h;
    const bloccati = voci.filter((e) => e.ok === false);
    const utilizzabili = voci.filter((e) => e.ok !== false);
    const conAvvisi = utilizzabili.filter((e) => (e.avvisi || []).length);
    const pronti = utilizzabili.filter((e) => !(e.avvisi || []).length);
    const conNote = voci.filter((e) => (e.note || []).length);
    const sessione = voci.find((e) => e.sessione);
    const nonControllati = controllati ? Math.max(0, totale - voci.length) : 0;

    return new Promise((risolvi) => {
      const elenco = (lista, testo) => h2("ul", { class: "vr-check-list" },
        lista.map((e) => h2("li", {}, h2("strong", {}, e.title), " — ", testo(e))));

      const prezzo = (e) => {
        if (typeof e.price !== "number") return null;
        const dopo = L().applicaPrezzo(e.price, overrides || {});
        return dopo !== e.price
          ? h2("span", { class: "vr-plan__price" }, `${euro(e.price)} → `, h2("b", {}, euro(dopo)))
          : h2("span", { class: "vr-plan__price" }, euro(e.price));
      };

      const piano = h2("ol", { class: "vr-plan", "aria-label": attiva ? "Articoli da aggiungere" : "Ordine di pubblicazione" },
        utilizzabili.map((e) => h2("li", {},
          h2("span", { class: "vr-plan__title" }, e.title),
          prezzo(e),
          (e.avvisi || []).length ? h2("span", { class: "vr-tag vr-tag--warn" }, `⚠ ${e.avvisi.length}`) : null)));

      let dove = "fondo";
      const scegliDove = attiva
        ? h2("fieldset", { class: "vr-section vr-dove" },
          h2("legend", { class: "vr-section__title" }, "Dove inserirli"),
          ...[["fondo", "In fondo alla coda"], ["cima", "In cima, subito dopo quello in corso"]].map(([valore, testo]) => {
            const radio = h2("input", { type: "radio", name: "vr-dove", value: valore, checked: valore === "fondo" ? "" : null });
            radio.addEventListener("change", () => { if (radio.checked) dove = valore; });
            return h2("label", { class: "vr-radio" }, radio, " ", testo);
          }))
        : null;

      const n = utilizzabili.length;
      const conferma = h2("button", { class: "vr-btn vr-btn--primary", type: "button" },
        attiva ? `Aggiungi ${n}` : bloccati.length ? `Avvia solo i ${n} utilizzabili` : `Avvia ${n}`);
      conferma.disabled = !n;

      const card = h2("div", { class: "vr-card vr-card--wide", role: "dialog", "aria-modal": "true", "aria-labelledby": "vr-riep-title" },
        h2("h2", { class: "vr-card__title", id: "vr-riep-title" }, attiva ? "Aggiungi alla coda in corso" : "Prima di avviare"),
        h2("p", { class: "vr-note" }, attiva ? `Useranno le opzioni della coda in corso: ${descrizione}.` : `Opzioni: ${descrizione}.`),
        sessione
          ? h2("p", { class: "vr-note vr-note--error" }, `Non riesco a leggere gli articoli: ${sessione.problemi[0]}. Ricarica Vinted e controlla di essere entrato.`)
          : null,
        h2("div", { class: "vr-summary" },
          h2("span", { class: "is-ok" }, h2("b", {}, pronti.length), " pronti"),
          h2("span", { class: "is-warn" }, h2("b", {}, conAvvisi.length), " con avvisi"),
          h2("span", { class: "is-error" }, h2("b", {}, bloccati.length), " bloccati"),
          rifiutati.length ? h2("span", {}, h2("b", {}, rifiutati.length), attiva ? " non aggiungibili" : " esclusi") : null,
          nonControllati ? h2("span", {}, h2("b", {}, nonControllati), " non controllati") : null),
        controllati ? null : h2("p", { class: "vr-field__help" }, "Controllo prima di avviare spento nelle impostazioni: gli articoli non sono stati letti."),
        n ? h2("details", { open: n <= 12 ? "" : null }, h2("summary", {}, attiva ? `Da aggiungere (${n})` : `Ordine di pubblicazione (${n})`), piano) : null,
        scegliDove,
        bloccati.length ? h2("div", {}, h2("p", { class: "vr-section__title" }, "Bloccati: Vinted li rifiuterebbe"), elenco(bloccati, (e) => e.problemi.join("; "))) : null,
        rifiutati.length ? h2("details", { open: "" }, h2("summary", {}, `${attiva ? "Non aggiungibili" : "Esclusi"} (${rifiutati.length})`), elenco(rifiutati, (e) => e.motivo)) : null,
        conAvvisi.length ? h2("details", {}, h2("summary", {}, `Avvisi (${conAvvisi.length})`), elenco(conAvvisi, (e) => e.avvisi.join("; "))) : null,
        // Assenze legittime (es. un libro senza colore): visibili, ma non contano come avvisi.
        conNote.length ? h2("details", {}, h2("summary", {}, `Note, non sono problemi (${conNote.length})`), elenco(conNote, (e) => e.note.join("; "))) : null,
        h2("p", { class: "vr-field__help" }, "Il controllo non garantisce il risultato: la decisione finale è di Vinted, al momento della pubblicazione."),
        h2("div", { class: "vr-actions" },
          h2("button", { class: "vr-btn vr-btn--ghost", type: "button", onclick: () => { risolvi(null); chiudi(); } }, "Annulla"),
          conferma));

      // prima la risposta, poi la chiusura: chiudere risponde "annullato"
      conferma.addEventListener("click", () => { risolvi({ items: utilizzabili, dove }); chiudi(); });
      const chiudi = VR.openOverlay(card, { onClose: () => risolvi(null) });
      conferma.focus();
    });
  }

  // ------------------------------------------------------------------- avvio

  /**
   * Avvia una coda nuova, oppure — se una coda e' gia' in corso — aggiunge gli
   * articoli selezionati a quella, senza fermarla. In entrambi i casi passa dal
   * riepilogo: niente parte senza che tu l'abbia visto.
   */
  async function parti() {
    if (controlloInCorso) return;          // doppio clic
    const attiva = Boolean(coda?.running);
    if (attiva && coda.stopDopoCorrente) {
      VR.toast("La coda si sta chiudendo: aspetta che finisca, poi avviane una nuova.", "warn", { chiave: "avvio-coda" });
      return;
    }
    const v = validate();
    if (!attiva && !v.ok) return apriOpzioni({ eAvvia: true });

    const { inventory = {} } = await chrome.storage.local.get("inventory");
    const tutti = [...selezionati].map((id) => ({
      ...infoCard(id),
      price: typeof inventory[id]?.price === "number" ? inventory[id].price : null,
    }));
    if (!tutti.length) return;
    const overrides = attiva ? coda.overrides || {} : v.overrides || {};

    // Con una coda in corso: chi non puo' entrare (gia' in coda, completato,
    // da verificare) lo dice la stessa regola che usa il service worker.
    const rifiutati = attiva
      ? CL().valutaAggiunta(coda, tutti).filter((x) => x.esito === "rifiuta")
        .map((x) => ({ ...tutti.find((t) => t.id === x.id), motivo: x.motivo }))
      : [];
    const daControllare = tutti.filter((t) => !rifiutati.some((r) => r.id === t.id));

    let voci = daControllare;
    let controllati = false;
    if (daControllare.length && VR.settings.canary !== false) {
      controlloInCorso = true;
      disegna();
      try {
        voci = await controlloPreventivo(daControllare, overrides, (n, tot) => {
          const t = pannello?.querySelector(".vr-queue__title");
          if (t) t.textContent = `Controllo ${n} di ${tot}…`;
        });
        controllati = true;
      } finally {
        controlloInCorso = false;
        disegna();
      }
    }

    const scelta = await mostraRiepilogo({
      voci, controllati, rifiutati, attiva, overrides, totale: daControllare.length,
      descrizione: attiva ? descriviOverrides(coda.overrides, { intervalMin: coda.intervalMin }) : descriviOpzioni(),
    });
    if (!scelta) return;
    const items = scelta.items.map(({ id, title, thumb, price }) => ({ id, title, thumb, price }));

    if (attiva) {
      const r = await chrome.runtime.sendMessage({ type: "vr:queueAdd", items, dove: scelta.dove });
      if (r?.ok) {
        const n = (r.aggiunti?.length || 0) + (r.riattivati?.length || 0);
        const fuori = r.rifiutati?.length || 0;
        VR.toast(`${n} ${n === 1 ? "articolo aggiunto" : "articoli aggiunti"} alla coda${fuori ? `; ${fuori} non aggiunti (${r.rifiutati[0].motivo})` : ""}.`,
          fuori ? "warn" : "ok", { chiave: "aggiunta-coda" });
        VR.selection.nessuno();
      } else {
        VR.toast(r?.error || r?.rifiutati?.[0]?.motivo || "Non sono riuscito ad aggiungere gli articoli.", "error", { chiave: "aggiunta-coda" });
      }
      return;
    }

    const esito = await chrome.runtime.sendMessage({
      type: "vr:queueStart",
      items,
      intervalMin: v.intervalMin,
      overrides: v.overrides,
      startAt: v.startAt,
      modello: opzioni.modello || null,
    });

    if (esito?.ok) {
      // l'orario di avvio vale una volta sola
      if (opzioni.quando) await salvaOpzioni({ ...opzioni, quando: "" });
      VR.selection.nessuno();
    } else {
      VR.toast(esito?.error || "Non sono riuscito ad avviare la coda.", "error", { chiave: "avvio-coda" });
    }
  }

  // ------------------------------------------------------------------ disegno

  function creaPannello() {
    pannello = h("div", { class: "vr-queue", role: "region", "aria-label": "Coda di ripubblicazione" },
      h("div", { class: "vr-queue__info" },
        h("span", { class: "vr-queue__title" }),
        h("span", { class: "vr-queue__sub" })),
      h("div", { class: "vr-queue__controls" }));
    document.body.append(pannello);
  }

  function manca(ms) {
    if (ms <= 0) return "a momenti";
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    return min > 0 ? `tra ${min} min ${String(sec).padStart(2, "0")}s` : `tra ${sec}s`;
  }

  const bottone = (testo, classe, azione, attributi = {}) =>
    h("button", { class: `vr-btn vr-btn--${classe} vr-btn--sm`, type: "button", onclick: azione, ...attributi }, testo);

  /** Comando al service worker: se rifiuta, il motivo si vede. */
  const comando = (tipo, extra = {}) => async () => {
    const r = await chrome.runtime.sendMessage({ type: tipo, ...extra }).catch((e) => ({ ok: false, error: e.message }));
    if (r && r.ok === false && (r.motivo || r.error)) VR.toast(r.motivo || r.error, "warn", { chiave: `cmd:${tipo}` });
    return r;
  };

  /** Il passo dell'articolo che QUESTA scheda sta lavorando (le altre non lo vedono). */
  let passoLocale = null;

  function disegna() {
    const inCorso = Boolean(coda?.running);
    const conclusa = Boolean(coda && !coda.running && coda.finishedAt);
    const quanti = selezionati.size;

    if (!inCorso && !conclusa && !quanti && !controlloInCorso) {
      pannello?.remove();
      pannello = null;
      clearInterval(tic);
      tic = null;
      return;
    }

    if (!pannello) creaPannello();
    else if (!pannello.isConnected) document.body.append(pannello);

    const titolo = pannello.querySelector(".vr-queue__title");
    const sotto = pannello.querySelector(".vr-queue__sub");
    const controlli = pannello.querySelector(".vr-queue__controls");
    controlli.textContent = "";
    pannello.dataset.stato = inCorso ? coda.state : conclusa ? "done" : "select";

    if (controlloInCorso) {
      titolo.textContent = "Controllo prima di avviare…";
      sotto.textContent = "Leggo gli articoli selezionati: niente viene pubblicato.";
      return;
    }

    const gestisci = () => bottone("Gestisci", "ghost", comando("vr:openPage", { pagina: "src/dashboard.html#coda" }), { title: "Apri la gestione della coda" });
    // Con una coda in corso, la selezione si aggiunge a quella: non serve fermarla.
    const aggiunta = () => (quanti && !coda.stopDopoCorrente
      ? [bottone(`Aggiungi alla coda (${quanti})`, "primary", (e) => { e.currentTarget.disabled = true; parti().finally(disegna); }),
        bottone("Nessuno", "ghost", () => VR.selection.nessuno())]
      : []);

    if (inCorso) {
      const C = CL();
      const r = C.conta(coda);
      const cor = C.corrente(coda);
      const pros = C.prossimo(coda);

      if (coda.state === "recovering") {
        titolo.textContent = "Coda interrotta";
        sotto.textContent = `${r.done} completati` + (r.verify ? `, ${r.verify} da verificare` : "") +
          (r.skipped ? `, ${r.skipped} saltati` : "") + `, ${r.pending} in attesa`;
        controlli.append(gestisci(), bottone("Interrompi", "ghost", comando("vr:queueStop")), bottone("Riprendi", "primary", comando("vr:queueRecover")));
      } else if (coda.stopDopoCorrente) {
        titolo.textContent = "Coda in chiusura";
        sotto.textContent = cor ? `Aspetto l'esito di: ${cor.title}` : "";
        controlli.append(gestisci());
      } else if (coda.state === "paused") {
        titolo.textContent = `Coda in pausa: ${r.trattati} di ${r.totale}${coda.pausaAuto ? " — fermata da sola" : ""}`;
        sotto.textContent = coda.motivoPausa ||
          (coda.riprendiAlle ? `Riprende alle ${new Date(coda.riprendiAlle).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : "Riprende da dove si era fermata.");
        controlli.append(...aggiunta(), gestisci(), bottone("Interrompi", "ghost", comando("vr:queueStop")), bottone("Riprendi", "primary", comando("vr:queueResume")));
      } else if (coda.state === "scheduled") {
        titolo.textContent = `Coda programmata: ${r.totale} articoli`;
        sotto.textContent = `Parte ${new Date(coda.nextAt).toLocaleString("it-IT", { weekday: "long", hour: "2-digit", minute: "2-digit" })}`;
        controlli.append(...aggiunta(), gestisci(), bottone("Annulla", "ghost", comando("vr:queueStop")));
      } else {
        titolo.textContent = `Coda: ${r.trattati} di ${r.totale}`;
        // Il conto alla rovescia sta nel titolo: nel sottotitolo i nomi lunghi lo tagliavano.
        if (cor) titolo.textContent += " — in corso";
        else if (coda.nextAt) titolo.textContent += ` — ${manca(coda.nextAt - Date.now())}`;
        const passo = cor && passoLocale?.id === cor.id ? ` · ${passoLocale.testo}` : "";
        sotto.textContent = coda.note || (cor ? `${cor.title}${passo}` : pros ? `Prossimo: ${pros.title}` : "");
        controlli.append(...aggiunta(), gestisci(),
          bottone(coda.pausaDopoCorrente ? "Pausa richiesta" : "Pausa", "ghost", comando("vr:queuePause"), { disabled: coda.pausaDopoCorrente ? "" : null }),
          bottone("Interrompi", "ghost", comando("vr:queueStop")));
        if (!tic) tic = setInterval(disegna, 1000);
        return;
      }
      clearInterval(tic);
      tic = null;
      return;
    }

    clearInterval(tic);
    tic = null;

    if (conclusa && !quanti) {
      const r = CL().conta(coda);
      const daGuardare = r.error + r.verify;
      titolo.textContent = daGuardare
        ? `Finita: ${r.done} ripubblicati, ${daGuardare} da guardare`
        : `Finita: ${r.done} ripubblicati`;
      sotto.textContent = coda.note || [
        r.error ? `${r.error} falliti` : "",
        r.verify ? `${r.verify} da verificare` : "",
        r.cancelled ? `${r.cancelled} annullati` : "",
        r.removed ? `${r.removed} rimossi` : "",
      ].filter(Boolean).join(" · ");

      controlli.append(bottone("Dettagli", "ghost", comando("vr:openPage", { pagina: `src/dashboard.html#coda-${coda.startedAt}` })));
      if (r.error) controlli.append(bottone(`Riprova i falliti (${r.error})`, "ghost", comando("vr:queueRetry", { queue: coda.startedAt })));
      controlli.append(bottone("Chiudi", "ghost", comando("vr:queueClear")));
      return;
    }

    // selezione in attesa di partire
    titolo.textContent = `${quanti} ${quanti === 1 ? "articolo selezionato" : "articoli selezionati"}`;
    sotto.textContent = descriviOpzioni();

    const v = validate();
    controlli.append(
      bottone(v.ok ? "Opzioni" : "Opzioni ⚠", "ghost", () => apriOpzioni(), { "aria-haspopup": "dialog" }),
      bottone("Tutti", "ghost", () => VR.selection.tutti()),
      bottone("Nessuno", "ghost", () => VR.selection.nessuno()),
      // Il bottone si spegne per il doppio clic e si ridisegna comunque alla fine:
      // se l'avvio si ferma (opzioni annullate, errore) non deve restare spento.
      bottone("Avvia", "primary", (e) => { e.currentTarget.disabled = true; parti().finally(disegna); }));
  }

  // ---------------------------------------------------------------- esecuzione

  /**
   * Annullamenti in sospeso per gli articoli che QUESTA scheda sta lavorando.
   * oltre = la richiesta che cambia qualcosa su Vinted e' gia' partita.
   */
  const lavorazioni = new Map();

  /**
   * Il service worker chiede di ripubblicare un articolo: rispondo subito e
   * riferisco l'esito a cose fatte. Passa dallo stesso blocco del bottone:
   * se l'articolo e' gia' in ripubblicazione a mano, la coda lo salta.
   */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "vr:relistOne") return false;
    sendResponse({ accepted: true });

    const id = String(message.itemId);
    const barra = VR.bars.get(id);
    const stato = { richiesto: false, oltre: false };
    lavorazioni.set(id, stato);
    const riferisci = (esito) =>
      chrome.runtime.sendMessage({ type: "vr:relistDone", itemId: id, ...esito }).catch(() => {});

    let ultimoPasso = 0;
    const passo = (testo) => {
      passoLocale = { id, testo };
      barra?.stato(testo);
      const sotto = pannello?.querySelector(".vr-queue__sub");
      if (sotto) sotto.textContent = testo;
      // al popup basta un aggiornamento ogni tanto, non uno per evento
      if (Date.now() - ultimoPasso > 700 || /Fatto|Pubblico/.test(testo)) {
        ultimoPasso = Date.now();
        chrome.runtime.sendMessage({ type: "vr:queueProgress", itemId: id, step: testo, fase: stato.oltre ? "invio" : "preparazione" }).catch(() => {});
      }
    };

    barra?.occupato(true);
    VR.esclusivo(id, () => VR.relist(id, message.overrides || {}, passo, {
      annullato: () => stato.richiesto,
      oltre: () => { stato.oltre = true; },
    }))
      .then(() => {
        barra?.segnaFatto();
        riferisci({ ok: true });
      })
      .catch((e) => {
        if (e?.duplicato) return riferisci({ ok: false, outcome: "skipped", motivoSalto: "in-uso", error: "già in ripubblicazione a mano" });
        const k = CL().classificaErrore(e);
        const outcome = e?.annullato ? "cancelled" : VR.esitoDaErrore(e);
        barra?.stato(e?.message || String(e), outcome === "error" ? "error" : "warn");
        if (outcome === "partial") barra?.segnaFatto();
        else barra?.occupato(false);
        riferisci({
          ok: false, outcome, error: e?.message || String(e), blocked: Boolean(e?.blocked),
          categoria: k.categoria, sicuro: k.sicuroRiprovare,
        });
      })
      .finally(() => {
        lavorazioni.delete(id);
        if (passoLocale?.id === id) passoLocale = null;
      });

    return false;
  });

  /** «Annulla operazione»: rispettato solo se la richiesta a Vinted non e' ancora partita. */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "vr:relistCancel") return false;
    const stato = lavorazioni.get(String(message.itemId));
    if (!stato) sendResponse({ ok: false, motivo: "l'articolo non è in lavorazione in questa scheda" });
    else if (stato.oltre) sendResponse({ ok: false, troppoTardi: true });
    else {
      stato.richiesto = true;
      sendResponse({ ok: true });
    }
    return false;
  });

  /**
   * Ripristino dalla dashboard: ripubblica l'annuncio attuale con i dati di
   * prima. Non e' un annullamento letterale — l'annuncio originale e' stato
   * cancellato con le sue visite — ma rimette titolo, descrizione e prezzo.
   */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "vr:restore") return false;

    VR.esclusivo(message.newId, () =>
      VR.relist(message.newId, message.overrides || {}, (passo) => VR.log("ripristino:", passo))
    )
      .then((creato) => sendResponse({ ok: true, id: creato?.id }))
      .catch((errore) => sendResponse({ ok: false, error: errore.message, outcome: VR.esitoDaErrore(errore) }));
    return true;
  });

  /** Il popup chiede una verifica: la facciamo sul primo articolo visibile. */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "vr:canaryAny") return false;

    const primo = document.querySelector(".vr-bar__pick");
    if (!primo) {
      sendResponse({ ok: false, problemi: ["Apri il tuo armadio su Vinted e riprova."] });
      return false;
    }

    VR.canary(primo.dataset.vrId)
      .then((esito) => sendResponse(esito))
      .catch((errore) => sendResponse({ ok: false, problemi: [errore.message] }));
    return true;
  });

  // --------------------------------------------------------------------- stato

  chrome.storage.local.get("vrQueue").then(({ vrQueue }) => {
    coda = vrQueue || null;
    disegna();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.vrQueue) return;
    coda = changes.vrQueue.newValue || null;
    disegna();
  });
})();
