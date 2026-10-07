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

  /** Scelte fatte prima di premere Avvia: valgono per tutti i selezionati. */
  let bozza = { overrides: null, startAt: null };

  function descriviBozza() {
    const parti = [];
    const o = bozza.overrides || {};
    if (o.pricePercent) parti.push(`${o.pricePercent > 0 ? "+" : ""}${o.pricePercent}% sul prezzo`);
    if (o.priceDelta) parti.push(`${o.priceDelta > 0 ? "+" : ""}${o.priceDelta.toFixed(2)} € sul prezzo`);
    if (o.price) parti.push(`prezzo a ${o.price} €`);
    if (o.descriptionAppend) parti.push("riga aggiunta alla descrizione");
    if (o.colorIds?.length) {
      parti.push(`colore ${(VR.settings.colorMap || {})[o.colorIds[0]] || o.colorIds[0]} se manca`);
    }
    if (bozza.startAt) {
      parti.push(
        `parte ${new Date(bozza.startAt).toLocaleString("it-IT", {
          weekday: "short", hour: "2-digit", minute: "2-digit",
        })}`
      );
    }
    return parti.join(" · ");
  }

  /**
   * Menu dei colori costruito sui colori visti nei tuoi articoli.
   * Nessun elenco inventato: si riempie man mano che leggi gli annunci.
   */
  VR.selectColore = (selezionato) => {
    const noti = Object.entries(VR.settings.colorMap || {}).sort((a, b) =>
      a[1].localeCompare(b[1], "it")
    );

    const select = VR.h("select", { class: "vr-input" },
      VR.h("option", { value: "" }, noti.length ? "Non modificare" : "Nessun colore conosciuto")
    );
    for (const [id, nome] of noti) {
      select.append(VR.h("option", { value: id }, nome));
    }
    if (selezionato) select.value = String(selezionato);
    select.disabled = !noti.length;
    return select;
  };

  /** Dialog unico: modifiche in blocco e avvio programmato. */
  function apriOpzioni() {
    const h2 = VR.h;
    const o = bozza.overrides || {};

    const modo = h2("select", { class: "vr-input" },
      h2("option", { value: "" }, "Prezzo invariato"),
      h2("option", { value: "percent" }, "Variazione in percentuale"),
      h2("option", { value: "delta" }, "Variazione in euro"),
      h2("option", { value: "fixed" }, "Prezzo fisso")
    );
    const valore = h2("input", { class: "vr-input", type: "number", step: "0.5" });
    const descrizione = h2("textarea", { class: "vr-input vr-input--area", rows: "3" });
    const quando = h2("input", { class: "vr-input", type: "datetime-local" });
    const colore = VR.selectColore(o.colorIds?.[0]);

    if (o.pricePercent) { modo.value = "percent"; valore.value = String(o.pricePercent); }
    else if (o.priceDelta) { modo.value = "delta"; valore.value = String(o.priceDelta); }
    else if (o.price) { modo.value = "fixed"; valore.value = String(o.price); }
    descrizione.value = o.descriptionAppend || "";
    if (bozza.startAt) {
      const d = new Date(bozza.startAt - new Date().getTimezoneOffset() * 60000);
      quando.value = d.toISOString().slice(0, 16);
    }

    const esempi = { percent: "es. -10", delta: "es. -0.50", fixed: "es. 8.50" };
    const aggiorna = () => {
      valore.disabled = !modo.value;
      valore.step = modo.value === "percent" ? "1" : "0.5";
      valore.placeholder = esempi[modo.value] || "";
    };
    modo.addEventListener("change", aggiorna);
    aggiorna();

    const card = h2("div", { class: "vr-card", role: "dialog", "aria-modal": "true" },
      h2("h2", { class: "vr-card__title" }, "Opzioni della coda"),
      h2("div", { class: "vr-row" },
        h2("label", { class: "vr-field" }, h2("span", { class: "vr-field__label" }, "Prezzo"), modo),
        h2("label", { class: "vr-field" }, h2("span", { class: "vr-field__label" }, "Valore"), valore)
      ),
      h2("label", { class: "vr-field" },
        h2("span", { class: "vr-field__label" }, "Aggiungi in fondo alla descrizione"),
        descrizione
      ),
      h2("div", { class: "vr-row" },
        h2("label", { class: "vr-field" },
          h2("span", { class: "vr-field__label" }, "Colore se manca"),
          colore
        ),
        h2("label", { class: "vr-field" },
          h2("span", { class: "vr-field__label" }, "Avvia alle (vuoto = subito)"),
          quando
        )
      ),
      h2("p", { class: "vr-note" },
        "Percentuale e variazione in euro si calcolano sul prezzo di ogni articolo al momento " +
        "della ripubblicazione. Il colore viene messo solo dove manca: gli articoli che ne hanno " +
        "gia' uno restano com'erano."
      ),
      h2("div", { class: "vr-actions" },
        h2("button", { class: "vr-btn vr-btn--ghost", onclick: () => chiudi() }, "Annulla"),
        h2("button", {
          class: "vr-btn vr-btn--primary",
          onclick: () => {
            const nuovo = {};
            const n = Number(valore.value);
            if (modo.value === "percent" && n) nuovo.pricePercent = n;
            if (modo.value === "delta" && n) nuovo.priceDelta = n;
            if (modo.value === "fixed" && n > 0) nuovo.price = n;
            if (descrizione.value.trim()) nuovo.descriptionAppend = descrizione.value.trim();
            if (colore.value) nuovo.colorIds = [Number(colore.value)];

            bozza.overrides = Object.keys(nuovo).length ? nuovo : null;
            bozza.startAt = quando.value ? new Date(quando.value).getTime() : null;
            chiudi();
            disegna();
          },
        }, "Salva")
      )
    );

    const chiudi = VR.openOverlay(card);
  }

  function creaPannello() {
    pannello = h("div", { class: "vr-queue" },
      h("div", { class: "vr-queue__info" },
        h("span", { class: "vr-queue__title" }),
        h("span", { class: "vr-queue__sub" })
      ),
      h("div", { class: "vr-queue__controls" })
    );
    document.body.append(pannello);
  }

  function manca(ms) {
    if (ms <= 0) return "a momenti";
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    return min > 0 ? `tra ${min} min ${String(sec).padStart(2, "0")}s` : `tra ${sec}s`;
  }

  function disegna() {
    const inCorso = Boolean(coda?.running);
    const conclusa = Boolean(coda && !coda.running && coda.finishedAt);
    const quanti = selezionati.size;

    if (!inCorso && !conclusa && !quanti) {
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

    if (inCorso && coda.state === "paused") {
      const fatti = coda.items.filter((i) => i.status !== "pending").length;
      titolo.textContent = `Coda in pausa: ${fatti} di ${coda.items.length}`;
      sotto.textContent = "Riprende da dove si era fermata.";
      controlli.append(
        h("button", {
          class: "vr-btn vr-btn--ghost vr-btn--sm",
          onclick: () => chrome.runtime.sendMessage({ type: "vr:queueStop" }),
        }, "Interrompi"),
        h("button", {
          class: "vr-btn vr-btn--primary vr-btn--sm",
          onclick: () => chrome.runtime.sendMessage({ type: "vr:queueResume" }),
        }, "Riprendi")
      );
      return;
    }

    if (inCorso && coda.state === "scheduled") {
      titolo.textContent = `Coda programmata: ${coda.items.length} articoli`;
      sotto.textContent = `Parte ${new Date(coda.nextAt).toLocaleString("it-IT", {
        weekday: "long", hour: "2-digit", minute: "2-digit",
      })}`;
      controlli.append(
        h("button", {
          class: "vr-btn vr-btn--ghost vr-btn--sm",
          onclick: () => chrome.runtime.sendMessage({ type: "vr:queueStop" }),
        }, "Annulla")
      );
      return;
    }

    if (inCorso) {
      const fatti = coda.items.filter((i) => i.status !== "pending").length;
      titolo.textContent = `Coda: ${fatti} di ${coda.items.length}`;

      // Il conto alla rovescia sta nel titolo: nel sottotitolo veniva tagliato
      // dai nomi lunghi, che su articoli come i giochi da tavolo sono la norma.
      const corrente = coda.items[coda.index];
      if (coda.state === "working") titolo.textContent += " — in corso";
      else if (coda.nextAt) titolo.textContent += ` — tra ${manca(coda.nextAt - Date.now())}`;

      sotto.textContent = coda.note || corrente?.title || "";

      controlli.append(
        h("button", {
          class: "vr-btn vr-btn--ghost vr-btn--sm",
          onclick: () => chrome.runtime.sendMessage({ type: "vr:queuePause" }),
        }, "Pausa"),
        h("button", {
          class: "vr-btn vr-btn--ghost vr-btn--sm",
          onclick: () => chrome.runtime.sendMessage({ type: "vr:queueStop" }),
        }, "Interrompi")
      );

      if (!tic) tic = setInterval(disegna, 1000);
      return;
    }

    clearInterval(tic);
    tic = null;

    if (conclusa) {
      const ok = coda.items.filter((i) => i.status === "done").length;
      const ko = coda.items.filter((i) => i.status === "error").length;
      titolo.textContent = ko ? `Finita: ${ok} fatti, ${ko} falliti` : `Finita: ${ok} ripubblicati`;
      sotto.textContent = coda.note || (ko ? "Dettagli nel popup dell'estensione." : "");

      controlli.append(
        h("button", {
          class: "vr-btn vr-btn--ghost vr-btn--sm",
          onclick: async () => {
            await chrome.storage.local.remove("vrQueue");
            coda = null;
            disegna();
          },
        }, "Chiudi")
      );
      return;
    }

    // selezione in attesa di partire
    titolo.textContent = `${quanti} ${quanti === 1 ? "articolo selezionato" : "articoli selezionati"}`;
    sotto.textContent = descriviBozza() || "Il primo parte subito, gli altri a intervalli.";

    const intervallo = h("input", {
      class: "vr-queue__interval",
      type: "number",
      min: "1",
      max: "240",
      value: String(VR.settings.queueIntervalMin || 20),
      title: "Minuti tra una ripubblicazione e la successiva",
    });

    const avvia = h("button", { class: "vr-btn vr-btn--primary vr-btn--sm" }, "Avvia");

    async function parti(forza = false) {
      const minuti = Math.min(240, Math.max(1, Number(intervallo.value) || 20));
      await VR.saveSettings({ queueIntervalMin: minuti });

      const items = [...selezionati].map((id) => ({ id, title: titoloDi(id) }));

      // Canarino: una prova a vuoto sul primo articolo. Una coda da tre ore che
      // fallisce venti volte di fila e' peggio di una che non parte.
      if (!forza && VR.settings.canary && items.length) {
        avvia.disabled = true;
        titolo.textContent = "Controllo in corso…";
        sotto.textContent = "Prova a vuoto su un articolo, senza pubblicare niente.";

        const esito = await VR.canary(items[0].id, bozza.overrides || {});
        avvia.disabled = false;

        // Gli avvisi raccontano cosa riempiro' da solo: si leggono, non bloccano.
        if (esito.ok && esito.avvisi?.length) VR.toast(esito.avvisi.join(" · "), "info", 7000);

        if (!esito.ok) {
          titolo.textContent = "Qualcosa non torna";
          sotto.textContent = [...esito.problemi, ...(esito.avvisi || [])].join(" · ");
          controlli.textContent = "";
          controlli.append(
            h("button", {
              class: "vr-btn vr-btn--ghost vr-btn--sm",
              onclick: () => disegna(),
            }, "Annulla"),
            h("button", {
              class: "vr-btn vr-btn--primary vr-btn--sm",
              onclick: () => parti(true),
            }, "Avvia comunque")
          );
          return;
        }
      }

      const esito = await chrome.runtime.sendMessage({
        type: "vr:queueStart",
        items,
        intervalMin: minuti,
        overrides: bozza.overrides,
        startAt: bozza.startAt,
      });

      if (esito?.ok) {
        bozza = { overrides: null, startAt: null };
        VR.selection.nessuno();
      } else {
        VR.toast(esito?.error || "Non sono riuscito ad avviare la coda.", "error");
      }
    }

    avvia.addEventListener("click", () => parti());

    controlli.append(
      intervallo,
      h("span", { class: "vr-queue__unit" }, "min"),
      h("button", {
        class: "vr-btn vr-btn--ghost vr-btn--sm",
        onclick: apriOpzioni,
      }, descriviBozza() ? "Opzioni •" : "Opzioni"),
      h("button", {
        class: "vr-btn vr-btn--ghost vr-btn--sm",
        onclick: () => VR.selection.tutti(),
      }, "Tutti"),
      h("button", {
        class: "vr-btn vr-btn--ghost vr-btn--sm",
        onclick: () => VR.selection.nessuno(),
      }, "Nessuno"),
      avvia
    );
  }

  // ---------------------------------------------------------------- esecuzione

  let lavoroInCorso = false;

  /** Il service worker chiede di ripubblicare un articolo: rispondo subito. */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "vr:relistOne") return false;

    // Due ripubblicazioni in parallelo nella stessa scheda si pestano i piedi
    // sulle chiamate a Vinted. Puo' succedere premendo Salta mentre una gira.
    if (lavoroInCorso) {
      sendResponse({ accepted: false });
      chrome.runtime.sendMessage({
        type: "vr:relistDone",
        itemId: message.itemId,
        ok: false,
        error: "un'altra ripubblicazione era gia' in corso",
      });
      return false;
    }

    sendResponse({ accepted: true });

    (async () => {
      // La card dell'articolo, se e' sullo schermo, mostra gli stessi riscontri
      // del bottone singolo: avanzamento, spunta verde alla fine, errore se fallisce.
      const barra = VR.bars.get(String(message.itemId));
      barra?.occupato(true);
      lavoroInCorso = true;

      let ok = true;
      let error = null;
      let bloccato = false;
      try {
        await VR.relist(message.itemId, message.overrides || {}, (passo) => {
          barra?.stato(passo);
          const sotto = pannello?.querySelector(".vr-queue__sub");
          if (sotto) sotto.textContent = passo;
        });
        barra?.segnaFatto();
      } catch (e) {
        ok = false;
        error = e?.message || String(e);
        bloccato = Boolean(e?.blocked);
        barra?.stato(error, "error");
        barra?.occupato(false);
      }
      lavoroInCorso = false;
      chrome.runtime.sendMessage({
        type: "vr:relistDone",
        itemId: message.itemId,
        ok,
        error,
        blocked: bloccato,
      });
    })();

    return false;
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
