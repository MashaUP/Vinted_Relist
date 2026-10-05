/**
 * Gira nel mondo della pagina, non in quello isolato dell'estensione.
 * Serve solo a poter scrivere VR.debugDraft(...) nella console normale:
 * inoltra la chiamata al content script e ne riporta il risultato.
 */
(() => {
  const pending = new Map();
  let counter = 0;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (data?.source !== "vr-content") return;

    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);

    if (data.ok) {
      console.log("%c[Relist]", "color:#007782;font-weight:600", data.method, data.result);
      entry.resolve(data.result);
    } else {
      entry.reject(new Error(data.error));
    }
  });

  function call(method, args) {
    return new Promise((resolve, reject) => {
      const id = ++counter;
      pending.set(id, { resolve, reject });
      window.postMessage({ source: "vr-page", id, method, args }, location.origin);

      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error("Nessuna risposta dall'estensione: ricarica la pagina."));
      }, 120000);
    });
  }

  window.VR = {
    /** Payload che verrebbe inviato, senza pubblicare niente. */
    debugDraft: (itemId) => call("debugDraft", [itemId]),
    /** Prova a vuoto: legge e prepara tutto senza pubblicare niente. */
    canary: (itemId) => call("canary", [itemId]),
    /** Impostazioni correnti, formati imparati compresi. */
    settings: () => call("settings", []),
    /** Il payload grezzo che Vinted restituisce per l'articolo. */
    source: (itemId) => call("source", [itemId]),
    /** Il payload vero catturato da una modifica fatta a mano. */
    captured: () => call("captured", []),
    /** Confronto fra il nostro payload e quello vero. */
    compare: (itemId) => call("compare", [itemId]),
    /** Ripubblica davvero, come il bottone. */
    relist: (itemId, overrides) => call("relist", [itemId, overrides || {}]),
  };

  console.log(
    "%c[Relist]",
    "color:#007782;font-weight:600",
    "console pronta — VR.canary(id), VR.compare(id), VR.debugDraft(id), VR.settings()"
  );
})();
