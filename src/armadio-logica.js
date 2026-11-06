/**
 * Inventario dell'armadio: come cambia quando leggi le card e quando un
 * articolo viene ripubblicato. Funzioni pure: nessun chrome.*, nessun DOM.
 *
 * Le usa il service worker, che dalla 2.2.0 e' l'UNICO a scrivere l'inventario
 * (una modifica alla volta, come la coda). Prima lo scrivevano la pagina che
 * leggeva le card e la ripubblicazione, ognuna con il suo leggi-modifica-scrivi:
 * una poteva cancellare l'altra, e una card rimasta a schermo dopo la
 * ripubblicazione rimetteva nell'inventario l'annuncio vecchio, contato due
 * volte nel valore dell'armadio.
 *
 * Le stesse funzioni restano disponibili alla pagina come ripiego, se il
 * service worker non risponde.
 */
(function (root) {
  const ORE = 3600000;
  const MAX_SNAPSHOT = 60;
  const MAX_PUNTI_SERIE = 40;
  const MAX_SOSTITUITI = 500;
  const ID = /^\d{1,20}$/;
  const CDN = /^https:\/\/[a-z0-9.-]*vinted\.(net|com)\//i;

  const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };

  /** Visite osservate piu' vicine alle 48 ore dopo la pubblicazione (tra 24 e 72). */
  function visite48(serie, inizio) {
    let migliore = null;
    for (const [quando, visite] of serie || []) {
      const dopo = quando - inizio;
      if (dopo < 24 * ORE || dopo > 72 * ORE) continue;
      const distanza = Math.abs(dopo - 48 * ORE);
      if (!migliore || distanza < migliore.distanza) migliore = { visite, distanza };
    }
    return migliore ? migliore.visite : null;
  }

  /**
   * Ripubblicazione confermata: l'inventario segue l'articolo sul nuovo id, il
   * vecchio id diventa "sostituito" (una card vecchia non lo rimette dentro) e
   * si aggiunge la fotografia prima/dopo.
   *   stato: { inventory, vrSnapshots, vrInventoryReplaced }
   *   r: { oldId, newId, vecchio: {title, description, price}, nuovo: {title, description, price} }
   * Ripetere la stessa sostituzione non cambia niente (niente doppioni).
   */
  function sostituisci(stato, r, ora = Date.now()) {
    const inventory = { ...(stato.inventory || {}) };
    const vrSnapshots = [...(stato.vrSnapshots || [])];
    const sostituiti = { ...(stato.vrInventoryReplaced || {}) };
    const oldId = String(r?.oldId ?? "");
    const newId = String(r?.newId ?? "");
    if (!ID.test(oldId) || !ID.test(newId) || oldId === newId) return { inventory, vrSnapshots, vrInventoryReplaced: sostituiti, cambiato: false };

    const gia = vrSnapshots.some((x) => String(x.new?.id) === newId && String(x.old?.id) === oldId);
    const vecchio = inventory[oldId];

    if (!gia) {
      const precedente = [...vrSnapshots].reverse().find((x) => String(x.new?.id) === oldId);
      if (precedente && precedente.visite48 == null && vecchio) precedente.visite48 = visite48(vecchio.series, precedente.at);
      vrSnapshots.push({
        n: (vrSnapshots[vrSnapshots.length - 1]?.n || 0) + 1,
        at: ora,
        viewsBefore: vecchio?.views ?? null,
        old: { id: oldId, title: r.vecchio?.title ?? vecchio?.title ?? null, description: r.vecchio?.description ?? null, price: numero(r.vecchio?.price) ?? vecchio?.price ?? null },
        new: { id: newId, title: r.nuovo?.title ?? null, description: r.nuovo?.description ?? null, price: numero(r.nuovo?.price) },
      });
    }

    if (vecchio || !inventory[newId]) {
      inventory[newId] = {
        ...(inventory[newId] || {}),
        title: r.nuovo?.title || vecchio?.title || inventory[newId]?.title || "",
        price: numero(r.nuovo?.price) ?? inventory[newId]?.price ?? vecchio?.price ?? null,
        views: inventory[newId]?.views ?? 0,
        favs: inventory[newId]?.favs ?? 0,
        thumb: inventory[newId]?.thumb || vecchio?.thumb || null,
        firstSeen: vecchio?.firstSeen || inventory[newId]?.firstSeen || ora,
        lastSeen: ora,
        relistedAt: inventory[newId]?.relistedAt || ora,
        series: inventory[newId]?.series || [[ora, 0]],
      };
    }
    delete inventory[oldId];
    sostituiti[oldId] = ora;

    return {
      inventory,
      vrSnapshots: vrSnapshots.slice(-MAX_SNAPSHOT),
      vrInventoryReplaced: potaSostituiti(sostituiti),
      cambiato: true,
    };
  }

  /** Solo i piu' recenti: oltre, una card cosi' vecchia non e' piu' a schermo. */
  function potaSostituiti(s) {
    return Object.fromEntries(Object.entries(s).sort((a, b) => b[1] - a[1]).slice(0, MAX_SOSTITUITI));
  }

  /**
   * Letture delle card del tuo armadio (titolo, prezzo, visite, preferiti,
   * miniatura). Un id gia' sostituito da una ripubblicazione viene ignorato:
   * e' la card vecchia ancora a schermo, quell'annuncio non esiste piu'.
   *   voci: { id: { title, price, views, favs, thumb } }
   */
  function annota(stato, voci, ora = Date.now()) {
    const inventory = { ...(stato.inventory || {}) };
    const sostituiti = stato.vrInventoryReplaced || {};
    const ignorati = [];
    let cambiati = 0;

    for (const [id, letto] of Object.entries(voci || {})) {
      if (!ID.test(id)) continue;
      if (sostituiti[id]) { ignorati.push(id); continue; }
      const prima = inventory[id] || {};
      const serie = [...(prima.series || [])];
      const visite = Number.isFinite(Number(letto?.views)) && letto?.views != null ? Number(letto.views) : null;

      // Un punto nella serie quando le visite cambiano, o almeno ogni 12 ore:
      // e' quello che serve per misurare cosa succede dopo una ripubblicazione.
      if (visite != null) {
        const ultimo = serie[serie.length - 1];
        if (!ultimo || ultimo[1] !== visite || ora - ultimo[0] > 12 * ORE) serie.push([ora, visite]);
      }

      inventory[id] = {
        ...prima,
        title: String(letto?.title || prima.title || "").slice(0, 80),
        price: numero(letto?.price) ?? prima.price ?? null,
        views: visite ?? prima.views ?? null,
        favs: letto?.favs != null && Number.isFinite(Number(letto.favs)) ? Number(letto.favs) : prima.favs ?? null,
        thumb: CDN.test(String(letto?.thumb || "")) ? letto.thumb : prima.thumb || null,
        firstSeen: prima.firstSeen || ora,
        lastSeen: ora,
        series: serie.slice(-MAX_PUNTI_SERIE),
        // 2.4.0: la card mostra il bollino «Venduto» di Vinted
        ...(letto?.venduto === true ? { venduto: true, vendutoAt: prima.vendutoAt || ora } : letto?.venduto === false ? { venduto: false } : {}),
      };
      cambiati++;
    }
    return { inventory, ignorati, cambiati };
  }

  /** Un annuncio che Vinted dice non esistere piu' (letto durante una verifica). */
  function rimuovi(stato, id, ora = Date.now()) {
    const inventory = { ...(stato.inventory || {}) };
    const sostituiti = { ...(stato.vrInventoryReplaced || {}) };
    if (!inventory[String(id)]) return { inventory, vrInventoryReplaced: sostituiti, cambiato: false };
    delete inventory[String(id)];
    sostituiti[String(id)] = ora;
    return { inventory, vrInventoryReplaced: potaSostituiti(sostituiti), cambiato: true };
  }

  const api = { visite48, sostituisci, annota, rimuovi, MAX_SOSTITUITI };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ArmadioLogica = api;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
