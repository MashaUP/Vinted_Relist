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
    itemFormat: null,         // campi del payload annuncio imparati da una modifica
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

  let toastHost = null;

  VR.toast = (message, kind = "info", ms = 4000) => {
    if (!toastHost) {
      toastHost = VR.h("div", { class: "vr-toasts" });
      document.body.append(toastHost);
    }
    const toast = VR.h("div", { class: `vr-toast vr-toast--${kind}` }, message);
    toastHost.append(toast);

    const remove = () => {
      toast.classList.add("vr-toast--out");
      setTimeout(() => toast.remove(), 200);
    };
    if (ms) setTimeout(remove, ms);
    toast.addEventListener("click", remove);
    return { remove, update: (text) => (toast.textContent = text) };
  };

  /** Coda seriale: un relist per volta, con pausa configurabile. */
  VR.queue = (() => {
    let chain = Promise.resolve();
    return (task) => {
      chain = chain
        .then(async () => {
          const result = await task();
          await VR.sleep(VR.settings.delayMs);
          return result;
        })
        .catch((error) => {
          VR.warn(error);
        });
      return chain;
    };
  })();
})();
