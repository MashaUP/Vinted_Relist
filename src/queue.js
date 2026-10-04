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

  VR.selection = {
    registra(id, input) {
      caselle.set(id, input);
      input.checked = selezionati.has(id);
    },
    cambia(id, acceso) {
      if (acceso) selezionati.add(id);
      else selezionati.delete(id);
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
      disegna();
    },
  };

  // ------------------------------------------------------------------ pannello

  let pannello = null;
  let coda = null;
  let tic = null;

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

    if (inCorso) {
      const fatti = coda.items.filter((i) => i.status !== "pending").length;
      titolo.textContent = `Coda: ${fatti} di ${coda.items.length}`;

      const corrente = coda.items[coda.index];
      if (coda.state === "working") {
        sotto.textContent = `In corso: ${corrente?.title || ""}`;
      } else if (coda.nextAt) {
        sotto.textContent = `${corrente?.title || ""} — ${manca(coda.nextAt - Date.now())}`;
      } else {
        sotto.textContent = "";
      }

      controlli.append(
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
    sotto.textContent = "Il primo parte subito, gli altri a intervalli.";

    const intervallo = h("input", {
      class: "vr-queue__interval",
      type: "number",
      min: "1",
      max: "240",
      value: String(VR.settings.queueIntervalMin || 20),
      title: "Minuti tra una ripubblicazione e la successiva",
    });

    controlli.append(
      intervallo,
      h("span", { class: "vr-queue__unit" }, "min"),
      h("button", {
        class: "vr-btn vr-btn--ghost vr-btn--sm",
        onclick: () => VR.selection.tutti(),
      }, "Tutti"),
      h("button", {
        class: "vr-btn vr-btn--ghost vr-btn--sm",
        onclick: () => VR.selection.nessuno(),
      }, "Nessuno"),
      h("button", {
        class: "vr-btn vr-btn--primary vr-btn--sm",
        onclick: async () => {
          const minuti = Math.min(240, Math.max(1, Number(intervallo.value) || 20));
          await VR.saveSettings({ queueIntervalMin: minuti });

          const items = [...selezionati].map((id) => ({ id, title: titoloDi(id) }));
          const esito = await chrome.runtime.sendMessage({
            type: "vr:queueStart",
            items,
            intervalMin: minuti,
          });

          if (esito?.ok) VR.selection.nessuno();
          else VR.toast(esito?.error || "Non sono riuscito ad avviare la coda.", "error");
        },
      }, "Avvia")
    );
  }

  // ---------------------------------------------------------------- esecuzione

  /** Il service worker chiede di ripubblicare un articolo: rispondo subito. */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "vr:relistOne") return false;

    sendResponse({ accepted: true });

    (async () => {
      // La card dell'articolo, se e' sullo schermo, mostra gli stessi riscontri
      // del bottone singolo: avanzamento, spunta verde alla fine, errore se fallisce.
      const barra = VR.bars.get(String(message.itemId));
      barra?.occupato(true);

      let ok = true;
      let error = null;
      try {
        await VR.relist(message.itemId, {}, (passo) => {
          barra?.stato(passo);
          const sotto = pannello?.querySelector(".vr-queue__sub");
          if (sotto) sotto.textContent = passo;
        });
        barra?.segnaFatto();
      } catch (e) {
        ok = false;
        error = e?.message || String(e);
        barra?.stato(error, "error");
        barra?.occupato(false);
      }
      chrome.runtime.sendMessage({ type: "vr:relistDone", itemId: message.itemId, ok, error });
    })();

    return false;
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
