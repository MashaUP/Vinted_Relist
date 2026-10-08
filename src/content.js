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

  function currentUserId() {
    const cookie = VR.cookie("v_uid");
    if (cookie && /^\d+$/.test(cookie)) return cookie;

    const link = document.querySelector(
      'header a[href^="/member/"], nav a[href^="/member/"], [data-testid*="user-menu"] a[href^="/member/"]'
    );
    const fromLink = link?.getAttribute("href")?.match(/\/member\/(\d+)/);
    if (fromLink) return fromLink[1];

    const nextData = document.getElementById("__NEXT_DATA__")?.textContent;
    const fromData = nextData?.match(/"(?:current_user_id|user_id)"\s*:\s*"?(\d+)"?/);
    return fromData ? fromData[1] : null;
  }

  function wardrobeOwnerId() {
    return location.pathname.match(/\/member\/(\d+)/)?.[1] || null;
  }

  function isOwnWardrobe() {
    const owner = wardrobeOwnerId();
    if (!owner) return false;
    if (VR.settings.showOnOtherProfiles) return true;
    const me = currentUserId();
    return !me || me === owner; // se non riesco a capirlo, mostro comunque
  }

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
    if (!isOwnWardrobe()) return;

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
    const itemId = itemIdFromHref(location.pathname);
    if (!itemId) return;
    if (document.querySelector(".vr-bar--floating")) return;

    // L'articolo e' mio solo se la pagina espone il link di modifica.
    const isMine = !!document.querySelector(`a[href*="/items/${itemId}/edit"]`);
    if (!isMine && !VR.settings.showOnOtherProfiles) return;

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
    return { views: numero(VISITE), favs: numero(PREFERITI), price: prezzo };
  }

  const MAX_PUNTI_SERIE = 40;
  const daAnnotare = new Map();
  let scrittura = null;

  function annota(itemId, anchor, card) {
    const titolo = (anchor.getAttribute("title") || anchor.textContent || "").trim();
    daAnnotare.set(itemId, { title: titolo.slice(0, 80), ...leggiCard(card) });

    clearTimeout(scrittura);
    scrittura = setTimeout(async () => {
      const { inventory = {} } = await chrome.storage.local.get("inventory");
      const ora = Date.now();

      for (const [id, letto] of daAnnotare) {
        const prima = inventory[id] || {};
        const serie = [...(prima.series || [])];

        // Un punto nella serie quando le visite cambiano, o almeno ogni 12 ore:
        // e' quello che serve per misurare cosa succede dopo una ripubblicazione.
        if (letto.views != null) {
          const ultimo = serie[serie.length - 1];
          if (!ultimo || ultimo[1] !== letto.views || ora - ultimo[0] > 12 * 3600000) {
            serie.push([ora, letto.views]);
          }
        }

        inventory[id] = {
          title: letto.title || prima.title || "",
          price: letto.price ?? prima.price ?? null,
          views: letto.views ?? prima.views ?? null,
          favs: letto.favs ?? prima.favs ?? null,
          firstSeen: prima.firstSeen || ora,
          lastSeen: ora,
          series: serie.slice(-MAX_PUNTI_SERIE),
        };
      }
      daAnnotare.clear();
      await chrome.storage.local.set({ inventory });
    }, 1500);
  }

  function refresh() {
    try {
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

  const BRIDGE = {
    debugDraft: (itemId) => VR.debugDraft(itemId),
    canary: (itemId) => VR.canary(itemId),
    settings: async () => ({ ...VR.settings }),
    source: (itemId) => VR.source(itemId),
    captured: () => VR.captured(),
    compare: (itemId) => VR.compare(itemId),
    relist: (itemId, overrides) => VR.relist(itemId, overrides || {}, (step) => VR.log(step)),
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
    if (changes.seenOnboarding?.newValue === false) VR.showOnboarding({ force: true });
  });

  // Il popup non puo' leggere i cookie di Vinted: gli lasciamo qui l'id,
  // cosi' puo' offrire il collegamento al tuo armadio.
  const mioId = currentUserId();
  chrome.storage.local.set({ vintedOrigin: location.origin, ...(mioId ? { userId: mioId } : {}) });

  VR.showOnboarding();
  refresh();
  VR.log("attivo su", location.hostname);
})();
