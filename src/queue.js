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
  };
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

  function descriviOpzioni() {
    const v = validate();
    if (!v.ok) return "Opzioni da correggere";
    const parti = [];
    const o = v.overrides || {};
    if (o.price) parti.push(`prezzo a ${euro(o.price)}`);
    if (o.pricePercent) parti.push(`${o.pricePercent > 0 ? "+" : ""}${o.pricePercent}% sul prezzo`);
    if (o.priceDelta) parti.push(`${o.priceDelta > 0 ? "+" : ""}${euro(o.priceDelta)} sul prezzo`);
    if (o.descriptionAppend) parti.push("riga in fondo alla descrizione");
    if (o.replace?.find) parti.push(o.replace.with ? `«${o.replace.find}» → «${o.replace.with}»` : `tolto «${o.replace.find}»`);
    if (o.autoFill) parti.push("colore dai simili se manca");
    if (o.colorIds?.length) parti.push(`colore ${(VR.settings.colorMap || {})[o.colorIds[0]] || o.colorIds[0]} se manca`);
    if (v.startAt) parti.push(`parte ${new Date(v.startAt).toLocaleString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`);
    parti.push(`ogni ${v.intervalMin} min`);
    return parti.join(" · ");
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
    let f = conIntervallo({ ...opzioni });
    const salvate = JSON.stringify(conIntervallo({ ...opzioni }));

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
    const bSalva = h2("button", { class: "vr-btn vr-btn--ghost", type: "button" }, "Salva");
    const bAvvia = h2("button", { class: "vr-btn vr-btn--primary", type: "button" }, "Salva e avvia");

    // prezzo di esempio: il primo articolo selezionato di cui conosciamo il prezzo
    const { inventory = {} } = await chrome.storage.local.get("inventory");
    const esempio = [...selezionati].map((id) => ({ id, ...inventory[id] })).find((a) => typeof a.price === "number");

    function aggiorna() {
      f = { modo: modo.value, valore: valore.value, aggiunta: aggiunta.value, cerca: cerca.value,
            con: con.value, colore: colore.value, quando: quando.value, intervallo: intervallo.value };
      const v = L().validaOpzioniCoda(f);

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
            aggiorna();
          },
        }, "Ripristina predefiniti"),
        h2("span", { class: "vr-actions__group" },
          h2("button", { class: "vr-btn vr-btn--ghost", type: "button", onclick: () => chiudi() }, "Annulla"),
          bSalva, bAvvia))
    );

    bSalva.addEventListener("click", async () => {
      if (!aggiorna().ok) return;
      await salvaOpzioni(f);
      chiudi();
      disegna();
    });
    bAvvia.addEventListener("click", async () => {
      if (!aggiorna().ok) return;
      await salvaOpzioni(f);
      chiudi();
      disegna();
      parti();
    });

    aggiorna();
    const chiudi = VR.openOverlay(card);
    (eAvvia ? bAvvia : modo).focus();
  }

  // ------------------------------------------------------ controllo preventivo

  /**
   * Legge ogni articolo selezionato, senza pubblicare niente, e li divide in
   * pronti, con avvisi e bloccati. La foto si prova a scaricare solo sul primo:
   * per gli altri basta sapere che ce l'hanno.
   * Non garantisce il risultato: Vinted decide al momento della pubblicazione.
   */
  async function controlloPreventivo(items, overrides, avanzamento) {
    const { vrQueue: precedente } = await chrome.storage.local.get("vrQueue");
    const daVerificare = new Set((precedente?.items || []).filter((i) => i.status === "verify").map((i) => i.id));

    const esiti = [];
    for (let i = 0; i < items.length; i++) {
      avanzamento(i + 1, items.length);
      const it = items[i];
      const r = await VR.canary(it.id, overrides || {}, { foto: i === 0 });
      const avvisi = [...(r.avvisi || [])];
      if (daVerificare.has(it.id)) {
        avvisi.unshift("era «da verificare» nella coda precedente: controlla che non sia già stato ripubblicato");
      }
      esiti.push({ ...it, ok: r.ok, problemi: r.problemi || [], avvisi, note: r.note || [], sessione: r.sessione });
      if (r.sessione) break;            // senza sessione e' inutile leggere gli altri
      if (i < items.length - 1) await VR.sleep(400);
    }
    return esiti;
  }

  function mostraRiepilogo(esiti, totale) {
    const h2 = VR.h;
    const pronti = esiti.filter((e) => e.ok && !e.avvisi.length);
    const conAvvisi = esiti.filter((e) => e.ok && e.avvisi.length);
    const bloccati = esiti.filter((e) => !e.ok);
    const conNote = esiti.filter((e) => (e.note || []).length);
    const sessione = esiti.find((e) => e.sessione);

    return new Promise((risolvi) => {
      const elenco = (voci, testo) => h2("ul", { class: "vr-check-list" },
        voci.map((e) => h2("li", {}, h2("strong", {}, e.title), " — ", testo(e).join("; "))));

      const avviaTutti = h2("button", { class: "vr-btn vr-btn--primary", type: "button" },
        bloccati.length ? `Avvia solo i ${pronti.length + conAvvisi.length} utilizzabili` : "Avvia");
      avviaTutti.disabled = !(pronti.length + conAvvisi.length);

      const card = h2("div", { class: "vr-card vr-card--wide", role: "dialog", "aria-modal": "true" },
        h2("h2", { class: "vr-card__title" }, "Controllo prima di avviare"),
        sessione
          ? h2("p", { class: "vr-note vr-note--error" }, `Non riesco a leggere gli articoli: ${sessione.problemi[0]}. Ricarica Vinted e controlla di essere entrato.`)
          : null,
        h2("div", { class: "vr-summary" },
          h2("span", { class: "is-ok" }, h2("b", {}, pronti.length), " pronti"),
          h2("span", { class: "is-warn" }, h2("b", {}, conAvvisi.length), " con avvisi"),
          h2("span", { class: "is-error" }, h2("b", {}, bloccati.length), " bloccati"),
          esiti.length < totale ? h2("span", {}, h2("b", {}, totale - esiti.length), " non controllati") : null),
        bloccati.length ? h2("div", {}, h2("p", { class: "vr-section__title" }, "Bloccati: Vinted li rifiuterebbe"), elenco(bloccati, (e) => e.problemi)) : null,
        conAvvisi.length ? h2("details", {}, h2("summary", {}, `Avvisi (${conAvvisi.length})`), elenco(conAvvisi, (e) => e.avvisi)) : null,
        // Assenze legittime (es. un libro senza colore): visibili, ma non contano come avvisi.
        conNote.length ? h2("details", {}, h2("summary", {}, `Note, non sono problemi (${conNote.length})`), elenco(conNote, (e) => e.note)) : null,
        h2("p", { class: "vr-field__help" }, "Il controllo non garantisce il risultato: la decisione finale è di Vinted, al momento della pubblicazione."),
        h2("div", { class: "vr-actions" },
          h2("button", { class: "vr-btn vr-btn--ghost", type: "button", onclick: () => { risolvi(null); chiudi(); } }, "Annulla"),
          avviaTutti));

      // prima la risposta, poi la chiusura: chiudere risponde "annullato"
      avviaTutti.addEventListener("click", () => { risolvi([...pronti, ...conAvvisi]); chiudi(); });
      const chiudi = VR.openOverlay(card, { onClose: () => risolvi(null) });
    });
  }

  // ------------------------------------------------------------------- avvio

  async function parti() {
    if (controlloInCorso) return;          // doppio clic
    const v = validate();
    if (!v.ok) return apriOpzioni({ eAvvia: true });

    let items = [...selezionati].map(infoCard);
    if (!items.length) return;

    if (VR.settings.canary !== false) {
      controlloInCorso = true;
      disegna();
      try {
        const esiti = await controlloPreventivo(items, v.overrides, (n, tot) => {
          const t = pannello?.querySelector(".vr-queue__title");
          if (t) t.textContent = `Controllo ${n} di ${tot}…`;
        });
        const tutti = esiti.length === items.length && esiti.every((e) => e.ok && !e.avvisi.length);
        const scelti = tutti ? esiti : await mostraRiepilogo(esiti, items.length);
        if (!scelti) return;
        items = scelti.map(({ id, title, thumb }) => ({ id, title, thumb }));
      } finally {
        controlloInCorso = false;
        disegna();
      }
    }

    const esito = await chrome.runtime.sendMessage({
      type: "vr:queueStart",
      items,
      intervalMin: v.intervalMin,
      overrides: v.overrides,
      startAt: v.startAt,
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
  const comando = (tipo, extra = {}) => () => chrome.runtime.sendMessage({ type: tipo, ...extra });

  function conta(c) {
    const r = { done: 0, error: 0, verify: 0, skipped: 0, cancelled: 0, pending: 0 };
    for (const v of c.items || []) r[v.status] = (r[v.status] || 0) + 1;
    return r;
  }

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

    if (inCorso && coda.state === "recovering") {
      const r = conta(coda);
      titolo.textContent = "Coda interrotta";
      sotto.textContent = `${r.done} completati` + (r.verify ? `, ${r.verify} da verificare` : "") +
        (r.skipped ? `, ${r.skipped} saltati` : "") + `, ${coda.items.length - coda.index} rimanenti`;
      controlli.append(
        bottone("Annulla coda", "ghost", comando("vr:queueStop")),
        bottone("Riprendi", "primary", comando("vr:queueRecover")));
      return;
    }

    if (inCorso && coda.state === "paused") {
      titolo.textContent = `Coda in pausa: ${coda.index} di ${coda.items.length}`;
      sotto.textContent = "Riprende da dove si era fermata.";
      controlli.append(
        bottone("Interrompi", "ghost", comando("vr:queueStop")),
        bottone("Riprendi", "primary", comando("vr:queueResume")));
      return;
    }

    if (inCorso && coda.state === "scheduled") {
      titolo.textContent = `Coda programmata: ${coda.items.length} articoli`;
      sotto.textContent = `Parte ${new Date(coda.nextAt).toLocaleString("it-IT", { weekday: "long", hour: "2-digit", minute: "2-digit" })}`;
      controlli.append(bottone("Annulla", "ghost", comando("vr:queueStop")));
      return;
    }

    if (inCorso) {
      titolo.textContent = `Coda: ${coda.index} di ${coda.items.length}`;
      // Il conto alla rovescia sta nel titolo: nel sottotitolo i nomi lunghi lo tagliavano.
      const corrente = coda.items[coda.index];
      if (coda.state === "working") titolo.textContent += " — in corso";
      else if (coda.nextAt) titolo.textContent += ` — ${manca(coda.nextAt - Date.now())}`;
      sotto.textContent = coda.note || (coda.state === "working" && coda.step ? `${corrente?.title || ""} · ${coda.step}` : corrente?.title || "");

      controlli.append(
        bottone("Pausa", "ghost", comando("vr:queuePause")),
        bottone("Interrompi", "ghost", comando("vr:queueStop")));
      if (!tic) tic = setInterval(disegna, 1000);
      return;
    }

    clearInterval(tic);
    tic = null;

    if (conclusa) {
      const r = conta(coda);
      const daGuardare = r.error + r.verify;
      titolo.textContent = daGuardare
        ? `Finita: ${r.done} ripubblicati, ${daGuardare} da guardare`
        : `Finita: ${r.done} ripubblicati`;
      sotto.textContent = coda.note || [
        r.error ? `${r.error} falliti` : "",
        r.verify ? `${r.verify} da verificare` : "",
        r.cancelled ? `${r.cancelled} annullati` : "",
      ].filter(Boolean).join(" · ");

      if (daGuardare) controlli.append(bottone("Dettagli", "ghost", comando("vr:openPage", { pagina: `src/dashboard.html#coda-${coda.startedAt}` })));
      if (r.error) controlli.append(bottone(`Riprova i falliti (${r.error})`, "ghost", comando("vr:queueRetry")));
      controlli.append(bottone("Chiudi", "ghost", async () => {
        await chrome.storage.local.remove("vrQueue");
        coda = null;
        disegna();
      }));
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
   * Il service worker chiede di ripubblicare un articolo: rispondo subito e
   * riferisco l'esito a cose fatte. Passa dallo stesso blocco del bottone:
   * se l'articolo e' gia' in ripubblicazione a mano, la coda lo salta.
   */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "vr:relistOne") return false;
    sendResponse({ accepted: true });

    const id = String(message.itemId);
    const barra = VR.bars.get(id);
    const riferisci = (esito) =>
      chrome.runtime.sendMessage({ type: "vr:relistDone", itemId: id, ...esito }).catch(() => {});

    let ultimoPasso = 0;
    const passo = (testo) => {
      barra?.stato(testo);
      const sotto = pannello?.querySelector(".vr-queue__sub");
      if (sotto) sotto.textContent = testo;
      // al popup basta un aggiornamento ogni tanto, non uno per evento
      if (Date.now() - ultimoPasso > 700 || /Fatto|Pubblico/.test(testo)) {
        ultimoPasso = Date.now();
        chrome.runtime.sendMessage({ type: "vr:queueProgress", itemId: id, step: testo }).catch(() => {});
      }
    };

    barra?.occupato(true);
    VR.esclusivo(id, () => VR.relist(id, message.overrides || {}, passo))
      .then(() => {
        barra?.segnaFatto();
        riferisci({ ok: true });
      })
      .catch((e) => {
        if (e?.duplicato) return riferisci({ ok: false, outcome: "skipped", error: "già in ripubblicazione a mano" });
        const outcome = VR.esitoDaErrore(e);
        barra?.stato(e?.message || String(e), outcome === "error" ? "error" : "warn");
        if (outcome === "partial") barra?.segnaFatto();
        else barra?.occupato(false);
        riferisci({ ok: false, outcome, error: e?.message || String(e), blocked: Boolean(e?.blocked) });
      });

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
