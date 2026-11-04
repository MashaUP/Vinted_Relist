/* Punto di ingresso: trova gli articoli nella pagina e ci attacca i bottoni. */
(async () => {
  const VR = (window.VR = window.VR || {});

  await VR.loadSettings();

  const CARD_SELECTORS = [
    '[class*="new-item-box__container"]',
    ".feed-grid__item",
    '[data-testid$="--wrapper"]',
  ];

  // ---------------------------------------------------------------- contesto

  /**
   * Chi sei: l'id dell'account con cui Vinted ti riconosce su questo dominio.
   * Lo legge il service worker dal cookie v_uid (HttpOnly) delle richieste di
   * Vinted stessa. Niente deduzioni dalla pagina: fino alla 2.2 un link
   * nell'intestazione o un "user_id" nei dati della pagina potevano essere
   * quelli del profilo che stavi guardando, e i bottoni comparivano negli
   * armadi altrui. Se non si sa, i bottoni non compaiono.
   */
  function currentUserId() {
    const cookie = VR.cookie("v_uid");
    if (cookie && /^\d+$/.test(cookie)) return cookie;
    const id = VR.settings.userId != null ? String(VR.settings.userId) : null;
    const stessoSito = !VR.settings.vintedOrigin || VR.settings.vintedOrigin === location.origin;
    return id && /^\d+$/.test(id) && stessoSito ? id : null;
  }

  // Solo la pagina dell'armadio: /member/123-nome. Le sottopagine del profilo
  // (preferiti, recensioni…) mostrano articoli di altri: niente bottoni.
  const ARMADIO = /^\/member\/(\d+)(?:-[^/]*)?\/?$/;
  const ARTICOLO = /^\/items\/(\d+)(?:-[^/]*)?\/?$/;

  /**
   * Dove sei: armadio-mio, armadio-altrui, armadio-incerto (non so chi sei),
   * articolo-mio (pagina di un tuo annuncio: Vinted mostra il link di
   * modifica), articolo, profilo-sezione, altro. Proprietario dall'indirizzo,
   * tu dall'account autenticato: servono tutti e due.
   */
  VR.contesto = () => {
    const me = currentUserId();
    const path = location.pathname;
    let m;
    if ((m = path.match(ARMADIO))) {
      if (!me) return { tipo: "armadio-incerto", proprietario: m[1], me: null };
      return { tipo: m[1] === me ? "armadio-mio" : "armadio-altrui", proprietario: m[1], me };
    }
    if ((m = path.match(ARTICOLO))) {
      const modificabile = Boolean(document.querySelector(`a[href*="/items/${m[1]}/edit"]`));
      return { tipo: me && modificabile ? "articolo-mio" : "articolo", articolo: m[1], me };
    }
    if (/^\/member\/\d+/.test(path)) return { tipo: "profilo-sezione", me };
    return { tipo: "altro", me };
  };
  VR.nelMioArmadio = () => VR.contesto().tipo === "armadio-mio";

  /** Le azioni sensibili si ricontrollano al momento del clic, non solo quando si disegna il bottone. */
  VR.puoAgireSu = (itemId) => {
    const c = VR.contesto();
    return c.tipo === "armadio-mio" || (c.tipo === "articolo-mio" && c.articolo === String(itemId));
  };

  function itemIdFromHref(href) {
    return href?.match(/\/items\/(\d+)/)?.[1] || null;
  }

  // ---------------------------------------------------------------- injection

  function cardFor(anchor) {
    for (const selector of CARD_SELECTORS) {
      const found = anchor.closest(selector);
      if (found) return found;
    }
    let node = anchor;
    let best = anchor;
    for (let i = 0; i < 6 && node.parentElement; i++) {
      node = node.parentElement;
      if (node.querySelectorAll('a[href*="/items/"]').length === 1) best = node;
      else break;
    }
    return best;
  }

  function attach(host, itemId, extraClass) {
    const bar = VR.buildActionBar(itemId);
    if (extraClass) bar.classList.add(extraClass);

    // Le card di Vinted sono dentro un <a>: blocco la navigazione sui click ai bottoni.
    // Fase di bubbling: l'evento deve prima arrivare al bottone, poi lo fermo qui.
    bar.addEventListener("click", (event) => {
      if (event.target.closest("button")) event.preventDefault();
      event.stopPropagation();
    });

    host.insertAdjacentElement("afterend", bar);
    return bar;
  }

  function injectWardrobe() {
    if (!VR.nelMioArmadio()) return;

    for (const anchor of document.querySelectorAll('a[href*="/items/"]')) {
      const itemId = itemIdFromHref(anchor.getAttribute("href"));
      if (!itemId) continue;

      const card = cardFor(anchor);
      if (card.dataset.vrItem === itemId) continue;
      if (card.nextElementSibling?.classList?.contains("vr-bar")) continue;

      card.dataset.vrItem = itemId;
      const host = card.closest("a") || card;
      attach(host, itemId);
      annota(itemId, anchor, card);
    }
  }

  function injectItemPage() {
    // Pagina di un tuo annuncio: il link di modifica di Vinted e il tuo account riconosciuto.
    const c = VR.contesto();
    if (c.tipo !== "articolo-mio") return;
    const itemId = c.articolo;
    if (document.querySelector(".vr-bar--floating")) return;

    const anchor = VR.h("div", { class: "vr-anchor" });
    document.body.append(anchor);
    attach(anchor, itemId, "vr-bar--floating");
  }

  /**
   * Inventario degli articoli visti nel tuo armadio. E' la base di tutto quello
   * che guarda l'armadio nel suo insieme: automazione, dashboard, duplicati,
   * misura dei risultati. Si costruisce leggendo le card che hai davanti:
   * nessuna chiamata in piu' a Vinted.
   */
  const VISITE = /(\d+)\s*(?:visualizzazion|vues?\b|visualizacion|aufrufe|views?\b|weergaven|wy\u015bwietle)/i;
  const PREFERITI = /(\d+)\s*(?:preferit|favori|favorito|favorit|favourite|favorite|ulubion)/i;
  const PREZZO =
    /(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:\u20ac|\u00a3|z\u0142|K\u010d|lei|Ft)|(?:\u20ac|\u00a3)\s*(\d{1,5}(?:[.,]\d{1,2})?)/;

  /** Visite, preferiti e prezzo dal testo della card. Quello che non si legge resta nullo. */
  function leggiCard(card) {
    const testo = card?.innerText || card?.textContent || "";
    const numero = (re) => {
      const m = testo.match(re);
      return m ? Number(m[1]) : null;
    };
    const p = testo.match(PREZZO);
    const prezzo = p ? Number((p[1] || p[2]).replace(",", ".")) : null;
    // La miniatura che hai gia' davanti: serve a dashboard e popup, nessun download in piu'.
    const img = card?.querySelector?.("img");
    const src = img?.currentSrc || img?.src || "";
    const thumb = /^https:\/\/[a-z0-9.-]*vinted\.(net|com)\//i.test(src) ? src : null;
    return { views: numero(VISITE), favs: numero(PREFERITI), price: prezzo, thumb };
  }

  const daAnnotare = new Map();
  let scrittura = null;

  /**
   * Le letture vanno al service worker, che e' l'unico a scrivere l'inventario
   * (src/armadio-logica.js): una card vecchia rimasta a schermo dopo una
   * ripubblicazione non rimette piu' dentro l'annuncio che non esiste.
   */
  function annota(itemId, anchor, card) {
    const titolo = (anchor.getAttribute("title") || anchor.textContent || "").trim();
    daAnnotare.set(itemId, { title: titolo.slice(0, 80), ...leggiCard(card) });

    clearTimeout(scrittura);
    scrittura = setTimeout(async () => {
      const voci = Object.fromEntries(daAnnotare);
      daAnnotare.clear();
      try {
        const r = await chrome.runtime.sendMessage({ type: "vr:inventarioAnnota", voci });
        if (r?.ok) return;
      } catch {
        // service worker non raggiungibile: ripiego qui sotto
      }
      const A = window.ArmadioLogica;
      if (!A) return;
      const stato = await chrome.storage.local.get(["inventory", "vrInventoryReplaced"]);
      const r = A.annota(stato, voci);
      if (r.cambiati) await chrome.storage.local.set({ inventory: r.inventory });
    }, 1500);
  }

  /**
   * Quando cambia dove sei (navigazione senza ricaricare, indietro/avanti,
   * account riconosciuto dopo), tutto quello che l'estensione ha messo nella
   * pagina se ne va se non e' piu' il tuo armadio: barre, caselle, selezione,
   * pannello della coda. I bottoni di Vinted non si toccano.
   */
  let contestoPrecedente = null;
  let benvenutoProvato = false;
  function aggiornaContesto() {
    const c = VR.contesto();
    const chiave = `${c.tipo}:${c.proprietario || c.articolo || ""}:${c.me || ""}`;
    if (chiave === contestoPrecedente) return c;
    contestoPrecedente = chiave;
    if (c.tipo !== "armadio-mio") {
      document.querySelectorAll(".vr-bar:not(.vr-bar--floating)").forEach((node) => node.remove());
      document.querySelectorAll("[data-vr-item]").forEach((node) => delete node.dataset.vrItem);
      VR.selection?.nessuno?.();
    }
    if (c.tipo !== "articolo-mio") document.querySelectorAll(".vr-bar--floating, .vr-anchor").forEach((node) => node.remove());
    VR.aggiornaPannello?.();
    if (c.tipo === "armadio-mio" && !benvenutoProvato) {
      benvenutoProvato = true;
      VR.showOnboarding();
    }
    return c;
  }

  function refresh() {
    try {
      aggiornaContesto();
      injectWardrobe();
      injectItemPage();
    } catch (error) {
      VR.warn(error);
    }
  }

  // ---------------------------------------------------------------- ponte console

  const safeClone = (value) => {
    try {
      return JSON.parse(JSON.stringify(value ?? null));
    } catch {
      return String(value);
    }
  };

  /**
   * Solo letture. Il ponte riceve messaggi dalla pagina, e sulla pagina girano
   * anche script di terzi (pubblicita', statistiche): niente che pubblichi o
   * cancelli deve essere raggiungibile da qui. E resta spento finche' non lo
   * accendi tu dalle impostazioni avanzate.
   */
  const BRIDGE = {
    debugDraft: (itemId) => VR.debugDraft(itemId),
    canary: (itemId) => VR.canary(itemId),
    // Riassunto senza id utente ne' contenuti degli annunci: i formati appresi
    // diventano elenchi di campi, con la categoria da cui vengono.
    settings: async () => {
      const { itemStats, colorMap, userId, vintedOrigin, itemFormat, itemFormats, photoFormat, ...resto } = VR.settings;
      return {
        ...resto,
        colori: Object.keys(colorMap || {}).length,
        articoliOsservati: Object.keys(itemStats || {}).length,
        formatoFoto: photoFormat ? { campoFile: photoFormat.fileField, campi: Object.keys(photoFormat.constants || {}) } : null,
        formatoAnnuncio: itemFormat ? { categoria: itemFormat.sample?.catalog_id ?? null, campi: itemFormat.fields } : null,
        formatiPerCategoria: Object.fromEntries(Object.entries(itemFormats || {}).map(([c, f]) => [c, f.campi])),
      };
    },
    diagnosi: (itemId) => VR.diagnosi(itemId),
    source: (itemId) => VR.source(itemId),
    captured: () => VR.captured(),
    compare: (itemId) => VR.compare(itemId),
  };

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (data?.source !== "vr-page" || !BRIDGE[data.method]) return;

    const reply = (payload) =>
      window.postMessage(
        { source: "vr-content", id: data.id, method: data.method, ...payload },
        location.origin
      );

    if (!VR.settings.consoleBridge) {
      reply({ ok: false, error: "Diagnostica da console spenta: accendila nel popup, Impostazioni › Avanzate." });
      return;
    }

    try {
      const result = await BRIDGE[data.method](...(data.args || []));
      reply({ ok: true, result: safeClone(result) });
    } catch (error) {
      reply({ ok: false, error: String(error?.message || error) });
    }
  });

  // ---------------------------------------------------------------- osservatori

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 250);
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      document.querySelectorAll(".vr-bar--floating, .vr-anchor").forEach((node) => node.remove());
      document.querySelectorAll("[data-vr-item]").forEach((node) => delete node.dataset.vrItem);
      schedule();
    }
  }, 600);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const patch = {};
    for (const [key, value] of Object.entries(changes)) patch[key] = value.newValue;
    Object.assign(VR.settings, patch);
    if (changes.seenOnboarding?.newValue === false && VR.nelMioArmadio()) VR.showOnboarding({ force: true });
    // L'account riconosciuto e' cambiato (o arrivato solo adesso): si rifa' il conto di dove sei.
    if (changes.userId || changes.vintedOrigin) schedule();
  });

  // Il service worker chiede come sta la pagina (diagnostica): niente URL, niente id.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "vr:ping") return false;
    const c = VR.contesto();
    sendResponse({ build: VR.BUILD, manifest: chrome.runtime.getManifest().version, pagina: c.tipo, utenteNoto: Boolean(c.me), lavorazioni: VR.lavorazioniAttive?.() ?? null });
    return false;
  });

  /**
   * Estensione aggiornata o ricaricata con questa pagina aperta: il codice qui
   * resta scollegato e ogni operazione fallirebbe. Si tolgono barre e pannello
   * e si dice una volta sola di ricaricare la pagina.
   */
  const controlloCollegamento = setInterval(() => {
    if (chrome.runtime?.id) return;
    clearInterval(controlloCollegamento);
    document.querySelectorAll(".vr-bar, .vr-anchor, .vr-queue").forEach((n) => n.remove());
    try {
      VR.toast?.("Vinted Relist è stato aggiornato: ricarica questa pagina (F5) per continuare.", "warn", { durata: 0, chiave: "scollegata" });
    } catch { /* niente */ }
  }, 2000);

  // 2.3: l'id utente e il dominio li scrive solo il service worker, dal cookie.
  // Prima li scriveva anche la pagina, con le sue deduzioni (vedi currentUserId).
  refresh();
  VR.log("attivo su", location.hostname);
})();
