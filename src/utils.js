/* Helper condivisi. Tutti i file del content script scrivono su window.VR. */
(() => {
  const VR = (window.VR = window.VR || {});

  VR.DEFAULTS = {
    seenOnboarding: false,
    deleteOld: true,          // eliminare il vecchio annuncio dopo aver creato il nuovo
    order: "safe",            // "safe" = crea poi elimina | "clean" = elimina poi crea
    delayMs: 1200,            // pausa tra le chiamate, per non farsi limitare
    showOnOtherProfiles: false,
    autoReload: false,
    queueIntervalMin: 20,     // minuti tra una ripubblicazione in coda e la successiva
    humanRhythm: true,        // intervalli irregolari e passi solo quando sei al computer
    notifyOnFinish: true,     // notifica di sistema a coda conclusa
    canary: true,             // prova a vuoto su un articolo prima di avviare la coda
    userId: null,             // il tuo id Vinted, letto dal service worker
    autoFill: true,           // riempie i campi vuoti con quello che usi nella stessa categoria
    colorMap: {},             // id → nome dei colori incontrati negli articoli letti
    itemStats: {},            // id articolo → categoria e campi, per dedurre cosa manca
    peakOnly: false,          // esegue la coda solo nelle fasce di traffico alto
    peakWindows: "12:30-14:00, 19:30-22:30",
    autoRule: false,          // accoda da sola gli articoli fermi da troppo tempo
    autoRuleDays: 7,
    autoRuleMax: 5,
    photoFormat: null,        // formato multipart imparato dagli upload di Vinted
    itemFormat: null,         // campi del payload annuncio imparati da una modifica (l'ultima)
    itemFormats: {},          // catalog_id → { campi, neutri }: lo stesso, separato per categoria
    toastsEnabled: true,      // i toast di errore e di esito incerto compaiono comunque
    toastDuration: "normal",  // "normal" | "long" (durate raddoppiate)
    consoleBridge: false,     // espone VR nella console della pagina, solo lettura
    updateRepo: "",           // repository GitHub per gli aggiornamenti; vuoto = MashaUP/Vinted_Relist
  };

  VR.settings = { ...VR.DEFAULTS };

  /** itemId → comandi della sua barra, cosi' la coda puo' aggiornare le card. */
  VR.bars = new Map();

  VR.loadSettings = async () => {
    const stored = await chrome.storage.local.get(VR.DEFAULTS);
    VR.settings = { ...VR.DEFAULTS, ...stored };
    return VR.settings;
  };

  VR.saveSettings = async (patch) => {
    Object.assign(VR.settings, patch);
    await chrome.storage.local.set(patch);
  };

  VR.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  VR.uuid = () => {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  VR.cookie = (name) => {
    const hit = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
    return hit ? decodeURIComponent(hit.split("=").slice(1).join("=")) : null;
  };

  VR.log = (...args) => console.log("%c[Relist]", "color:#007782;font-weight:600", ...args);
  VR.warn = (...args) => console.warn("[Relist]", ...args);

  /** Piccolo costruttore di elementi: VR.h("button", {class:"x", onclick:fn}, "Testo") */
  VR.h = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "html") node.innerHTML = value;
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === "dataset") Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  // ---------------------------------------------------------------- toast

  /**
   * Durate per tipo. Errori ed esiti incerti restano finche' non li chiudi:
   * sono le cose che non devono sparire prima che tu le abbia lette.
   */
  VR.DURATE_TOAST = { ok: 3000, info: 4000, warn: 7000, end: 6000, error: 0, uncertain: 0 };
  const CRITICI = new Set(["error", "uncertain", "warn"]);

  let toastHost = null;
  const attivi = new Map();          // chiave → toast, per non mostrare doppioni

  function host() {
    if (toastHost?.isConnected) return toastHost;
    toastHost = VR.h("div", { class: "vr-toasts", "aria-live": "polite" });
    document.body.append(toastHost);
    return toastHost;
  }

  /**
   * VR.toast(testo, tipo, { chiave, durata })
   * Stessa chiave = stesso toast aggiornato, con il timer ripartito da capo.
   */
  VR.toast = (message, kind = "info", opzioni = {}) => {
    const opts = typeof opzioni === "object" && opzioni ? opzioni : {};
    if (VR.settings.toastsEnabled === false && !CRITICI.has(kind)) {
      return { remove() {}, update() {} };
    }

    const lunghi = VR.settings.toastDuration === "long" ? 2 : 1;
    const durata = (opts.durata ?? VR.DURATE_TOAST[kind] ?? 4000) * lunghi;
    const chiave = opts.chiave || `${kind}:${message}`;

    let t = attivi.get(chiave);
    if (!t) {
      const testo = VR.h("span", { class: "vr-toast__text" });
      const chiudi = VR.h("button", { class: "vr-toast__close", type: "button", "aria-label": "Chiudi" }, "×");
      const nodo = VR.h("div", { class: "vr-toast" }, testo, chiudi);
      t = { nodo, testo, timer: null, resta: 0, partito: 0 };

      t.remove = () => {
        clearTimeout(t.timer);
        attivi.delete(chiave);
        nodo.classList.add("vr-toast--out");
        setTimeout(() => nodo.remove(), 180);
      };
      // Pausa al passaggio del mouse: il tempo residuo riparte quando esci.
      const avvia = (ms) => {
        clearTimeout(t.timer);
        if (!ms) return;
        t.resta = ms;
        t.partito = Date.now();
        t.timer = setTimeout(t.remove, ms);
      };
      t.avvia = avvia;
      nodo.addEventListener("mouseenter", () => {
        if (!t.timer) return;
        clearTimeout(t.timer);
        t.timer = null;
        t.resta = Math.max(800, t.resta - (Date.now() - t.partito));
      });
      nodo.addEventListener("mouseleave", () => {
        if (!t.timer && t.resta && t.durata) avvia(t.resta);
      });
      chiudi.addEventListener("click", t.remove);

      attivi.set(chiave, t);
      host().append(nodo);
    }

    t.nodo.className = `vr-toast vr-toast--${kind}`;
    t.nodo.setAttribute("role", CRITICI.has(kind) ? "alert" : "status");
    t.testo.textContent = message;
    t.durata = durata;
    t.avvia(durata);                 // un aggiornamento riparte da capo: niente timer vecchi

    return {
      remove: t.remove,
      update: (testo) => { t.testo.textContent = testo; },
    };
  };

  /** Toglie i toast dallo schermo. Gli eventi restano nel centro notifiche. */
  VR.toast.chiudiTutti = () => {
    for (const t of [...attivi.values()]) t.remove();
  };

  /** Evento per il centro notifiche del popup: lo scrive il service worker. */
  VR.registraEvento = (evento) =>
    chrome.runtime.sendMessage({ type: "vr:event", evento }).catch(() => {});

  // ------------------------------------------------------- esclusione reciproca

  /**
   * Una ripubblicazione alla volta in questa scheda, qualunque sia la strada:
   * bottone, coda, ripristino. Prima bottone e coda avevano due blocchi
   * separati che non si vedevano, e potevano lavorare insieme sullo stesso
   * articolo: due pubblicazioni dello stesso oggetto.
   */
  let catena = Promise.resolve();
  const inCorso = new Set();

  VR.esclusivo = (itemId, lavoro) => {
    const id = String(itemId);
    if (inCorso.has(id)) {
      const errore = new Error("Questo articolo è già in ripubblicazione.");
      errore.duplicato = true;
      return Promise.reject(errore);
    }
    inCorso.add(id);

    const esecuzione = catena.then(lavoro);
    catena = esecuzione.catch(() => {}).then(() => VR.sleep(VR.settings.delayMs));
    return esecuzione.finally(() => inCorso.delete(id));
  };

  VR.inRipubblicazione = (itemId) => inCorso.has(String(itemId));

  /**
   * Esito di una ripubblicazione come lo leggono card, coda e popup:
   * error (rifiutata), uncertain (forse pubblicata), partial (pubblicata,
   * vecchio annuncio ancora online). Gli ultimi due non vanno ritentati alla cieca.
   */
  VR.esitoDaErrore = (errore) =>
    errore?.incerto ? "uncertain" : errore?.parziale ? "partial" : "error";
})();
