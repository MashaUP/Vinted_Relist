/* Logica di ripubblicazione. */
(() => {
  const VR = (window.VR = window.VR || {});

  /** Dimensioni di una miniatura, lette dai campi o dal nome del tipo (es. thumb624x624). */
  function thumbArea(thumb) {
    if (thumb?.width && thumb?.height) return thumb.width * thumb.height;
    const match = String(thumb?.type || "").match(/(\d+)x(\d+)/);
    return match ? Number(match[1]) * Number(match[2]) : 0;
  }

  /** L'URL alla risoluzione piu' alta disponibile: ricaricare una miniatura rovina l'annuncio. */
  function bestPhotoUrl(photo) {
    if (photo.full_size_url) return photo.full_size_url;
    if (photo.high_resolution?.url) return photo.high_resolution.url;

    const thumbnails = photo.thumbnails || [];
    if (thumbnails.length) {
      const largest = [...thumbnails].sort((a, b) => thumbArea(b) - thumbArea(a))[0];
      if (largest?.url) return largest.url;
    }
    return photo.url || photo.image_url || null;
  }

  /** Foto con l'indicazione se manca la versione a piena risoluzione. */
  function photoInfo(item) {
    const photos = item?.photos || item?.assigned_photos || [];
    return photos
      .map((photo) => ({
        url: bestPhotoUrl(photo),
        ridotta: !(photo.full_size_url || photo.high_resolution?.url),
      }))
      .filter((f) => f.url);
  }

  function photoUrls(item) {
    const photos = item?.photos || item?.assigned_photos || [];
    return photos.map(bestPhotoUrl).filter(Boolean);
  }

  const MAX_SIDE = 1600;          // Vinted non mostra nulla di piu' grande
  const MAX_BYTES = 4.5 * 1024 * 1024;

  /**
   * Geometria di una foto modificata: rotazione a passi di 90°, poi ritaglio
   * espresso in frazioni dell'immagine *gia' ruotata*, poi riduzione al lato
   * massimo. Funzione pura: e' qui che si sbaglia, quindi si testa da sola.
   */
  function geometria(larghezza, altezza, { rotate = 0, crop = null, maxSide = MAX_SIDE } = {}) {
    const r = ((Math.round(rotate / 90) * 90) % 360 + 360) % 360;
    const girata = r === 90 || r === 270;
    const W = girata ? altezza : larghezza;      // dimensioni dopo la rotazione
    const H = girata ? larghezza : altezza;

    const c = crop || { x: 0, y: 0, w: 1, h: 1 };
    const x = Math.min(Math.max(c.x, 0), 1);
    const y = Math.min(Math.max(c.y, 0), 1);
    const w = Math.min(Math.max(c.w, 0.05), 1 - x);
    const h = Math.min(Math.max(c.h, 0.05), 1 - y);

    const tagliataW = W * w;
    const tagliataH = H * h;
    const scala = Math.min(1, maxSide / Math.max(tagliataW, tagliataH));

    return {
      r,
      W,
      H,
      ox: x * W,
      oy: y * H,
      scala,
      larghezza: Math.max(1, Math.round(tagliataW * scala)),
      altezza: Math.max(1, Math.round(tagliataH * scala)),
    };
  }

  /** Disegna la foto con rotazione e ritaglio su un canvas nuovo. */
  async function renderFoto(sorgente, opzioni = {}) {
    const bitmap = sorgente instanceof Blob ? await createImageBitmap(sorgente) : sorgente;
    const g = geometria(bitmap.width, bitmap.height, opzioni);

    const canvas = document.createElement("canvas");
    canvas.width = g.larghezza;
    canvas.height = g.altezza;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";

    // spazio ruotato W×H, spostato sull'angolo del ritaglio, poi scalato
    ctx.scale(g.scala, g.scala);
    ctx.translate(-g.ox, -g.oy);
    ctx.translate(g.W / 2, g.H / 2);
    ctx.rotate((g.r * Math.PI) / 180);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);

    if (sorgente instanceof Blob) bitmap.close?.();
    return canvas;
  }

  /**
   * Vinted rifiuta i file che non riconosce come JPEG valido (il CDN restituisce WebP)
   * e quelli troppo pesanti. Ridisegnare su canvas risolve entrambe le cose, e nello
   * stesso passaggio applica rotazione e ritaglio scelti nell'editor.
   */
  async function toJpeg(blob, opzioni = {}) {
    try {
      const canvas = await renderFoto(blob, opzioni);

      for (const quality of [0.88, 0.75, 0.6]) {
        const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (jpeg && jpeg.size > 1024 && jpeg.size < MAX_BYTES) {
          VR.log(`foto ${canvas.width}×${canvas.height}, ${Math.round(jpeg.size / 1024)} KB (q${quality})`);
          return jpeg;
        }
      }
    } catch (error) {
      VR.warn("riconversione in JPEG non riuscita, uso il file originale", error);
    }
    return blob;
  }

  VR.geometria = geometria;
  VR.renderFoto = renderFoto;
  VR.photoUrls = photoUrls;
  VR.photoInfo = photoInfo;

  // ------------------------------------------------------- download delle foto

  const blobADataUrl = (blob) =>
    new Promise((ok, ko) => {
      const lettore = new FileReader();
      lettore.onload = () => ok(lettore.result);
      lettore.onerror = () => ko(lettore.error || new Error("lettura non riuscita"));
      lettore.readAsDataURL(blob);
    });

  const DA_MIME = {
    "image/jpeg": { ext: "jpg", mime: "image/jpeg" },
    "image/png": { ext: "png", mime: "image/png" },
    "image/webp": { ext: "webp", mime: "image/webp" },
    "image/gif": { ext: "gif", mime: "image/gif" },
    "image/avif": { ext: "avif", mime: "image/avif" },
  };

  /**
   * Scarica le foto scelte, due alla volta. Un errore su una foto non ferma le
   * altre: il risultato dice, foto per foto, com'e' andata.
   * `cache` e' quella dell'editor: le foto gia' scaricate per le miniature non
   * vengono richieste una seconda volta.
   */
  VR.scaricaFoto = async (itemId, voci, cache, avanzamento = () => {}) => {
    const L = VR.editorLogica;
    const usati = new Set();
    const risultati = [];
    let prossimo = 0;
    let fatte = 0;

    async function una(v) {
      try {
        const blob = cache ? await cache.carica(v.url) : await VR.api.downloadPhoto(v.url);
        const testa = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
        const formato = L.formatoImmagine(testa) || DA_MIME[String(blob.type).split(";")[0]];
        if (!formato) throw new Error("formato non riconosciuto");

        const [nome] = L.nomiFoto(itemId, [{ posizione: v.posizione, ext: formato.ext }], usati);
        const dataUrl = await blobADataUrl(new Blob([blob], { type: formato.mime }));
        const r = await chrome.runtime.sendMessage({ type: "vr:download", url: dataUrl, nome });
        if (!r?.ok) throw new Error(r?.error || "download non riuscito");
        return { ok: true, posizione: v.posizione, nome: r.nome || nome };
      } catch (errore) {
        return { ok: false, posizione: v.posizione, errore: errore?.message || "errore sconosciuto" };
      }
    }

    async function lavoratore() {
      while (prossimo < voci.length) {
        const v = voci[prossimo++];
        risultati.push(await una(v));
        avanzamento(++fatte);
      }
    }

    await Promise.all([lavoratore(), lavoratore()]);
    return risultati.sort((a, b) => a.posizione - b.posizione);
  };

  /**
   * Il dizionario dei colori si riempie leggendo gli annunci. Se e' vuoto
   * (estensione appena installata), ne legge alcuni del tuo armadio: solo
   * letture, con una pausa tra l'una e l'altra.
   */
  VR.imparaColori = async (massimo = 8) => {
    const { inventory = {} } = await chrome.storage.local.get("inventory");
    const ids = Object.entries(inventory)
      .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0))
      .slice(0, massimo)
      .map(([id]) => id);

    for (const id of ids) {
      try {
        await VR.api.getUploadDraft(id);
      } catch {
        // articolo sparito o non leggibile: si passa al prossimo
      }
      if (Object.keys(VR.settings.colorMap || {}).length >= 8) break;
      await VR.sleep(600);
    }
    return Object.keys(VR.settings.colorMap || {}).length;
  };

  /** Riprova con pause crescenti: i fallimenti singoli qui sono quasi sempre passeggeri. */
  async function withRetry(label, run, attempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await run();
      } catch (error) {
        lastError = error;
        if (error.blocked) throw error;          // insistere su un 429 lo peggiora
        VR.warn(`${label}: tentativo ${attempt}/${attempts} fallito — ${error.message}`);
        if (attempt < attempts) await VR.sleep(800 * attempt);
      }
    }
    throw lastError;
  }

  /**
   * I campi che il POST di pubblicazione accetta davvero, letti da una richiesta
   * reale di Vinted. La lettura ne restituisce altri (brand_dto, color1_id,
   * domestic_shipment_price, photos, promoted…) che qui non vanno.
   *
   * size_id e status_id non compaiono in questo elenco perche' l'articolo
   * osservato e' da collezione: servono per l'abbigliamento e li teniamo.
   */
  const ALLOWED_FIELDS = [
    "id",
    "currency",
    "temp_uuid",
    "title",
    "description",
    "brand_id",
    "brand",
    "catalog_id",
    "isbn",
    "is_unisex",
    "ai_photo",
    "price",
    "package_size_id",
    "shipment_prices",
    "color_ids",
    "assigned_photos",
    "measurement_length",
    "measurement_width",
    "item_attributes",
    "manufacturer",
    "manufacturer_labelling",
    "size_id",
    "status_id",
  ];

  /**
   * Come si ricava ogni campo della scrittura da quelli della lettura.
   * Sono le sei differenze fra i due formati, scritte una volta sola.
   */
  const DERIVATIONS = {
    // la lettura espone brand_dto: {id, title}, la scrittura vuole nome e id separati
    brand: (src) => src.brand ?? src.brand_dto?.title ?? null,
    brand_id: (src) => src.brand_id ?? src.brand_dto?.id ?? null,

    // color1_id / color2_id → un solo array
    color_ids: (src) => [src.color1_id, src.color2_id].filter((id) => id != null),

    // {amount: "10.0", currency_code: "EUR"} → 10 (numero, non stringa)
    price: (src) => {
      const amount = scalarAmount(src.price);
      return amount == null ? null : Number(amount);
    },
    currency: (src) => src.currency ?? src.price?.currency_code ?? "EUR",

    // la lettura tiene i due prezzi separati e shipment_prices a null,
    // la scrittura vuole sempre l'oggetto con le due chiavi
    shipment_prices: (src) => ({
      domestic: scalarAmount(src.shipment_prices?.domestic ?? src.domestic_shipment_price),
      international: scalarAmount(
        src.shipment_prices?.international ?? src.international_shipment_price
      ),
    }),
  };

  /** Ricalca la forma delle voci foto osservata nella richiesta vera. */
  function buildAssignedPhotos(photoIds) {
    const template = VR.settings.itemFormat?.sample?.assigned_photos?.[0];

    if (template && typeof template === "object") {
      return photoIds.map((id, index) => {
        const entry = {};
        for (const key of Object.keys(template)) {
          if (key === "id") entry.id = id;
          else if (key === "index" || key === "position" || key === "order") entry[key] = index;
          else entry[key] = template[key];
        }
        entry.id = id;
        return entry;
      });
    }
    return photoIds.map((id) => ({ id, orientation: 0 }));
  }

  /**
   * Riempimento automatico dei campi vuoti.
   *
   * Il criterio non e' "riempi tutto": e' quanto costa sbagliare.
   *   - color_ids e is_unisex si riempiono. Senza colore Vinted rifiuta la
   *     pubblicazione, e un valore sbagliato costa al massimo una ricerca persa.
   *   - package_size_id si segnala e basta: sbagliare la dimensione del pacco
   *     si paga in spedizione, quindi la scelta resta tua.
   *   - isbn, misure, manufacturer non si toccano mai: sono dati del singolo
   *     oggetto, copiarli da un altro articolo significa pubblicare il falso.
   *
   * I valori non sono inventati: vengono da cosa hai messo tu sugli altri
   * articoli della stessa categoria.
   */
  VR.CAMPI_OSSERVATI = ["color_ids", "is_unisex", "package_size_id"];

  const DA_RIEMPIRE = ["color_ids", "is_unisex"];
  const DA_SEGNALARE = ["package_size_id"];

  const ETICHETTE = {
    color_ids: "colore",
    is_unisex: "unisex",
    package_size_id: "dimensione del pacco",
  };

  const MIN_OSSERVAZIONI = 2;    // sotto, non e' un'abitudine ma un caso
  const QUORUM = 0.6;            // il valore deve essere nettamente il piu' usato

  /** Il valore di un campo ridotto a stringa, per contarlo. */
  VR.chiaveCampo = (campo, item) => {
    if (campo === "color_ids") {
      const ids = [item.color1_id, item.color2_id].filter((id) => id != null);
      return ids.length ? ids.join(",") : null;
    }
    const valore = item[campo];
    return valore == null || valore === "" ? null : String(valore);
  };

  const daChiave = (campo, chiave) => {
    if (campo === "color_ids") return chiave.split(",").map(Number);
    if (campo === "is_unisex") return chiave === "true";
    return Number(chiave);
  };

  const eVuoto = (campo, valore) =>
    campo === "color_ids" ? !Array.isArray(valore) || !valore.length : valore == null;

  /**
   * L'anteprima deve vedere i campi com'erano *prima* del riempimento,
   * altrimenti non trova mai niente di vuoto da segnalare.
   */
  let senzaRiempimento = false;

  function bozzaGrezza(source, overrides) {
    senzaRiempimento = true;
    try {
      return buildDraft(source, [1], overrides);
    } finally {
      senzaRiempimento = false;
    }
  }

  /** Altri articoli osservati della stessa categoria hanno un colore? */
  VR.categoriaHaColori = (catalogId) =>
    Object.values(VR.settings.itemStats || {}).some(
      (scheda) => String(scheda.c) === String(catalogId) && scheda.v?.color_ids
    );

  /** Il valore piu' usato nella stessa categoria, se c'e' un'abitudine chiara. */
  function valorePrevalente(catalogId, campo) {
    const conteggi = {};
    let totale = 0;

    for (const scheda of Object.values(VR.settings.itemStats || {})) {
      if (String(scheda.c) !== String(catalogId)) continue;
      const chiave = scheda.v?.[campo];
      if (chiave == null) continue;
      conteggi[chiave] = (conteggi[chiave] || 0) + 1;
      totale++;
    }

    if (totale < MIN_OSSERVAZIONI) return null;
    const [chiave, quanti] = Object.entries(conteggi).sort((a, b) => b[1] - a[1])[0];
    if (quanti / totale < QUORUM) return null;

    return { chiave, valore: daChiave(campo, chiave), quanti, totale };
  }

  const nomeColore = (ids) =>
    ids.map((id) => (VR.settings.colorMap || {})[id] || id).join(" e ");

  /** Cosa verrebbe riempito, e cosa resta vuoto senza che io ci metta mano. */
  VR.riempimentiPrevisti = (source, overrides = {}) => {
    const draft = bozzaGrezza(source, overrides);
    const previsti = [];
    const segnalati = [];

    for (const campo of DA_RIEMPIRE) {
      if (!eVuoto(campo, draft[campo])) continue;
      const scelto = valorePrevalente(source.catalog_id, campo);
      if (!scelto) continue;
      previsti.push({
        campo,
        etichetta: ETICHETTE[campo],
        testo: campo === "color_ids" ? nomeColore(scelto.valore) : String(scelto.valore),
        quanti: scelto.quanti,
        totale: scelto.totale,
      });
    }

    for (const campo of DA_SEGNALARE) {
      if (eVuoto(campo, draft[campo])) segnalati.push(ETICHETTE[campo]);
    }

    return { previsti, segnalati };
  };

  /**
   * Punteggio di completezza dell'annuncio, da 0 a 100.
   * Misura cose verificabili sui dati, non il gusto: quante foto, quali campi
   * ci sono, quanto e' lungo il testo. Un criterio che non si applica alla
   * categoria (la taglia di un DVD) non pesa ne' a favore ne' contro.
   */
  VR.punteggio = (item) => {
    const voci = [];
    const consigli = [];
    let preso = 0;
    let possibile = 0;

    const conta = (peso, ottenuto, testo, consiglio) => {
      possibile += peso;
      preso += ottenuto;
      voci.push({ ok: ottenuto >= peso, parziale: ottenuto > 0 && ottenuto < peso, testo });
      if (ottenuto < peso && consiglio) consigli.push(consiglio);
    };

    const foto = (item.photos || []).length;
    conta(20, foto >= 5 ? 20 : foto >= 3 ? 10 : foto ? 4 : 0, `${foto} foto`,
      "Con 5 foto o piu' l'annuncio risponde a domande che altrimenti ti farebbero in chat.");

    conta(10, item.brand_id || item.brand_dto ? 10 : 0, "Marca", "Impostare la marca.");

    if ("size_id" in item) {
      conta(10, item.size_id ? 10 : 0, "Taglia", "Impostare la taglia.");
    }

    conta(10, item.color1_id ? 10 : 0, "Colore", "Impostare un colore: Vinted lo chiede alla pubblicazione.");

    // Nelle categorie non di abbigliamento la condizione sta in item_attributes.
    const condizione = item.status_id != null || (item.item_attributes || []).length > 0;
    conta(10, condizione ? 10 : 0, "Condizione", "Indicare le condizioni dell'oggetto.");

    const descrizione = (item.description || "").trim().length;
    conta(15, descrizione >= 150 ? 15 : descrizione >= 50 ? 8 : 0,
      descrizione >= 150 ? "Descrizione completa" : "Descrizione corta",
      "Una descrizione piu' lunga — condizioni, difetti, misure — risponde prima che te lo chiedano.");

    const titolo = (item.title || "").trim();
    const parole = titolo.split(/\s+/).filter(Boolean).length;
    conta(15, titolo.length >= 25 && parole >= 4 ? 15 : titolo.length >= 12 ? 8 : 0,
      titolo.length >= 25 && parole >= 4 ? "Titolo descrittivo" : "Titolo poco descrittivo",
      "Aggiungere al titolo modello o caratteristica principale lo rende piu' trovabile.");

    conta(10, item.package_size_id ? 10 : 0, "Dimensione pacco", "Impostare la dimensione del pacco.");

    return { score: Math.round((preso / possibile) * 100), voci, consigli };
  };

  /** {amount: "10.0", currency_code: "EUR"} → "10.0" */
  function scalarAmount(value) {
    if (value == null) return null;
    if (typeof value === "object") return value.amount ?? value.value ?? null;
    return value;
  }

  /** Costruisce il payload del nuovo annuncio a partire da quello vecchio. */
  function buildDraft(source, photoIds, overrides = {}, tempUuid = VR.uuid()) {
    // I campi imparati da una richiesta vera si sommano ai nostri: coprono le
    // categorie che non abbiamo ancora visto senza scartare quelle note.
    const learned = VR.settings.itemFormat?.fields || [];
    const allowed = new Set([...ALLOWED_FIELDS, ...learned]);

    const draft = {};
    for (const [key, value] of Object.entries(source)) {
      if (allowed.has(key)) draft[key] = JSON.parse(JSON.stringify(value ?? null));
    }

    for (const [key, derive] of Object.entries(DERIVATIONS)) {
      if (allowed.has(key)) draft[key] = derive(source);
    }

    draft.id = null;
    draft.temp_uuid = tempUuid;
    draft.assigned_photos = buildAssignedPhotos(photoIds);

    if (overrides.title != null) draft.title = String(overrides.title).trim();
    if (overrides.description != null) draft.description = String(overrides.description);
    // Stesso calcolo dell'anteprima nelle opzioni della coda: una sola funzione.
    draft.price = VR.editorLogica.applicaPrezzo(draft.price, overrides);

    // Vinted rifiuta la pubblicazione senza colore. Lo mettiamo solo dove manca:
    // gli articoli che ne hanno gia' uno non vanno toccati.
    if (overrides.colorIds?.length && Array.isArray(draft.color_ids) && !draft.color_ids.length) {
      draft.color_ids = overrides.colorIds.map(Number).filter((id) => !Number.isNaN(id));
    }
    if (overrides.replace?.find && VR.editorLogica) {
      const { find, with: con } = overrides.replace;
      draft.title = VR.editorLogica.sostituisci(draft.title, find, con).replace(/\s{2,}/g, " ").trim();
      draft.description = VR.editorLogica.sostituisci(draft.description, find, con);
    }
    if (overrides.descriptionAppend) {
      draft.description = `${draft.description || ""}\n${overrides.descriptionAppend}`.trim();
    }

    if (allowed.has("ai_photo") && draft.ai_photo == null) draft.ai_photo = false;

    // Per ultimo, cosi' qualunque scelta esplicita qui sopra ha la precedenza.
    if ((VR.settings.autoFill !== false || overrides.autoFill === true) && !senzaRiempimento) {
      for (const campo of DA_RIEMPIRE) {
        if (!allowed.has(campo) || !eVuoto(campo, draft[campo])) continue;

        const scelto = valorePrevalente(source.catalog_id, campo);
        if (!scelto) continue;

        draft[campo] = scelto.valore;
        VR.log(
          `${ETICHETTE[campo]} mancante: metto quello che usi su ${scelto.quanti} ` +
            `articoli su ${scelto.totale} della stessa categoria`
        );
      }
    }

    return draft;
  }

  /** Copia di sicurezza: se la creazione fallisce dopo l'eliminazione, i dati restano qui. */
  async function backup(itemId, draft) {
    const key = `vrBackup:${itemId}`;
    await chrome.storage.local.set({ [key]: { at: Date.now(), draft } });
    return key;
  }

  const MAX_SNAPSHOT = 60;
  const ORE = 3600000;

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
   * Fotografia di ogni ripubblicazione: com'era prima, com'e' dopo.
   * Serve a ripristinare i dati vecchi e a misurare cosa ha reso ogni relist.
   *
   * L'inventario segue l'articolo sul nuovo id. Prima di cancellare il vecchio,
   * chiudiamo la misura della ripubblicazione precedente: dopo, la sua serie
   * di visite non esisterebbe piu'.
   */
  async function registraSnapshot(oldId, source, draft, created) {
    if (!created?.id) return;

    const { vrSnapshots = [], inventory = {} } =
      await chrome.storage.local.get(["vrSnapshots", "inventory"]);

    const vecchio = inventory[oldId];
    const precedente = vrSnapshots.findLast((x) => String(x.new.id) === String(oldId));
    if (precedente && precedente.visite48 == null && vecchio) {
      precedente.visite48 = visite48(vecchio.series, precedente.at);
    }

    const ora = Date.now();
    vrSnapshots.push({
      n: (vrSnapshots[vrSnapshots.length - 1]?.n || 0) + 1,
      at: ora,
      viewsBefore: vecchio?.views ?? null,
      old: {
        id: String(oldId),
        title: source.title,
        description: source.description,
        price: Number(scalarAmount(source.price)),
      },
      new: { id: String(created.id), title: draft.title, description: draft.description, price: draft.price },
    });

    if (vecchio) delete inventory[oldId];
    inventory[created.id] = {
      title: draft.title,
      price: draft.price,
      views: 0,
      favs: 0,
      firstSeen: vecchio?.firstSeen || ora,
      lastSeen: ora,
      relistedAt: ora,
      series: [[ora, 0]],
    };

    await chrome.storage.local.set({ vrSnapshots: vrSnapshots.slice(-MAX_SNAPSHOT), inventory });
  }

  VR.visite48 = visite48;

  /**
   * Ripubblica un articolo.
   * @param {string|number} itemId
   * @param {object} overrides  title / description / price / deleteOld
   * @param {(step:string)=>void} onProgress
   */
  async function relist(itemId, overrides = {}, onProgress = () => {}) {
    const settings = VR.settings;
    const deleteOld = overrides.deleteOld ?? settings.deleteOld;
    const deleteFirst = settings.order === "clean";

    onProgress("Lettura articolo…");
    let source;
    try {
      source = await VR.api.getUploadDraft(itemId);
    } catch (error) {
      VR.warn("item_upload non disponibile, uso la scheda pubblica", error);
      source = await VR.api.getItem(itemId);
      if (!source) throw error;
    }

    // L'editor puo' riordinare, togliere, ruotare e ritagliare: arriva come elenco.
    // Senza editor, tutte le foto nell'ordine originale e senza modifiche.
    const scelte = Array.isArray(overrides.photos) && overrides.photos.length
      ? overrides.photos
      : photoUrls(source).map((url) => ({ url }));
    if (!scelte.length) throw new Error("Nessuna foto trovata sull'articolo.");

    await backup(itemId, source);

    // Le foto vengono caricate prima di toccare il vecchio annuncio:
    // se qualcosa va storto qui, non abbiamo ancora cancellato nulla.
    // Lo stesso temp_uuid deve legare le foto all'annuncio che creeremo dopo.
    const tempUuid = VR.uuid();
    const photoIds = [];
    for (let i = 0; i < scelte.length; i++) {
      const number = i + 1;
      const foto = scelte[i];
      onProgress(`Foto ${number}/${scelte.length}…`);

      try {
        const id = await withRetry(`foto ${number}`, async () => {
          const original = foto.blob || (await VR.api.downloadPhoto(foto.url));
          const jpeg = await toJpeg(original, { rotate: foto.rotate || 0, crop: foto.crop || null });
          return VR.api.uploadPhoto(jpeg, `foto-${number}.jpg`, tempUuid);
        });
        photoIds.push(id);
      } catch (error) {
        throw new Error(`Foto ${number} di ${scelte.length}: ${error.message}`);
      }

      await VR.sleep(Math.max(500, settings.delayMs / 2));
    }

    const draft = buildDraft(source, photoIds, overrides, tempUuid);
    const uploadSessionId = VR.uuid();

    if (deleteOld && deleteFirst) {
      onProgress("Elimino il vecchio annuncio…");
      await VR.api.deleteItem(itemId);
      await VR.sleep(settings.delayMs);
    }

    onProgress("Pubblico…");
    let created;
    try {
      created = await VR.api.createItem(draft, uploadSessionId);
    } catch (error) {
      if (deleteOld && deleteFirst) {
        // Il vecchio annuncio e' gia' stato eliminato: che il nuovo esista o no,
        // i dati sono nella copia di sicurezza. I segnali dell'errore restano.
        error.message +=
          " — il vecchio annuncio era gia' stato eliminato. I dati sono salvati: li recuperi dal popup.";
      }
      if (error.incerto) {
        error.message =
          `Esito incerto: ${error.message} L'annuncio potrebbe essere stato pubblicato: ` +
          "controlla l'armadio prima di riprovare.";
      }
      throw error;
    }

    // Da qui il nuovo annuncio esiste: qualunque cosa vada storta dopo, va registrato.
    let eliminazioneFallita = null;
    if (deleteOld && !deleteFirst) {
      await VR.sleep(settings.delayMs);
      onProgress("Elimino il vecchio annuncio…");
      try {
        await VR.api.deleteItem(itemId);
      } catch (error) {
        VR.warn("Nuovo annuncio creato ma vecchio non eliminato", error);
        eliminazioneFallita = error;
      }
    }

    await chrome.storage.local.remove(`vrBackup:${itemId}`);
    await VR.scartaBozza?.(itemId);
    await registraSnapshot(itemId, source, draft, created);

    // Registro delle ripubblicazioni: passa di qui sia il bottone singolo sia la coda.
    chrome.runtime.sendMessage({ type: "vr:relistLogged", itemId: String(itemId) }).catch(() => {});

    if (eliminazioneFallita) {
      // Pubblicato ma con il vecchio ancora online: riprovare creerebbe un terzo annuncio.
      const errore = new Error(
        "Nuovo annuncio pubblicato, ma il vecchio non è stato eliminato: rimuovilo a mano dall'armadio."
      );
      errore.parziale = true;
      errore.nuovoId = String(created.id);
      throw errore;
    }

    onProgress("Fatto");
    return created;
  }

  VR.relist = relist;

  /**
   * Prova a vuoto su un articolo: legge, costruisce il payload e scarica e
   * converte la prima foto. Non carica, non crea, non cancella niente.
   * Serve a non far partire una coda di tre ore se Vinted ha cambiato qualcosa.
   */
  VR.canary = async (itemId, overrides = {}, { foto: provaFoto = true } = {}) => {
    const problemi = [];
    const avvisi = [];

    let source;
    try {
      source = await VR.api.getUploadDraft(itemId);
    } catch (error) {
      // 401/403/429: non e' l'articolo, e' la sessione o un blocco. Inutile insistere.
      const sessione = error.blocked || error.status === 401 || error.status === 403;
      const testo = error.status === 404 ? "articolo non trovato (forse già ripubblicato o venduto)" : `lettura articolo: ${error.message}`;
      return { ok: false, problemi: [testo], avvisi: [], sessione };
    }

    const urls = photoUrls(source);
    const draft = buildDraft(source, [1], overrides);

    // Stessa regola dell'editor: obbligatori bloccano, facoltativi avvisano.
    const esito = VR.editorLogica.verificaPayload(draft, {
      foto: urls.length,
      categoriaConColori: VR.categoriaHaColori(source.catalog_id),
    });
    problemi.push(...esito.bloccanti);
    avvisi.push(...esito.avvisi);

    // Non sono problemi, ma e' giusto vederli prima di avviare una coda lunga.
    const anteprima = VR.riempimentiPrevisti(source, overrides);
    for (const voce of anteprima.previsti) {
      avvisi.push(`${voce.etichetta} vuoto, metto \u00ab${voce.testo}\u00bb`);
    }
    for (const nome of anteprima.segnalati) {
      avvisi.push(`${nome} non impostata: la lascio a te`);
    }

    const attesi = VR.settings.itemFormat?.fields;
    if (attesi?.length) {
      const mancanti = attesi.filter((campo) => !(campo in draft));
      // Campi che Vinted mandava nella richiesta osservata e che questo articolo
      // non ha: spesso sono semplicemente assenti per la categoria. Avviso, non blocco.
      if (mancanti.length) avvisi.push(`campi assenti rispetto al formato appreso: ${mancanti.join(", ")}`);
    }

    if (urls.length && provaFoto) {
      try {
        const originale = await VR.api.downloadPhoto(urls[0]);
        const jpeg = await toJpeg(originale);
        if (jpeg.size < 2048) problemi.push("la foto convertita e' sospettosamente piccola");
      } catch (error) {
        problemi.push(`foto: ${error.message}`);
      }
    }

    return { ok: problemi.length === 0, problemi, avvisi };
  };

  /** Che tipo ha un valore, distinguendo null e array. */
  function typeOf(value) {
    if (value === null || value === undefined) return "null";
    if (Array.isArray(value)) return `array(${value.length})`;
    return typeof value;
  }

  /** Il payload grezzo che Vinted restituisce per l'articolo: VR.source(123456) */
  VR.source = async (itemId) => {
    const source = await VR.api.getUploadDraft(itemId);
    console.log("originale completo:", source);
    return source;
  };

  /** Il payload vero catturato da una pubblicazione o modifica fatta a mano. */
  VR.captured = async () => {
    const { itemFormat } = await chrome.storage.local.get("itemFormat");
    if (!itemFormat?.sample) {
      console.warn("Niente di catturato. Modifica un annuncio a mano su Vinted e salva.");
      return null;
    }
    console.log("payload reale di Vinted:", itemFormat.sample);
    return itemFormat;
  };

  /**
   * Confronta quello che invieremmo con quello che manda Vinted davvero:
   * VR.compare(123456)
   */
  VR.compare = async (itemId) => {
    const { itemFormat } = await chrome.storage.local.get("itemFormat");
    if (!itemFormat?.sample) {
      console.warn("Niente di catturato. Modifica un annuncio a mano su Vinted e salva.");
      return null;
    }

    const source = await VR.api.getUploadDraft(itemId);
    const draft = buildDraft(source, [111, 222], {});
    const real = itemFormat.sample;

    const mancanti = Object.keys(real).filter((key) => !(key in draft));
    const inPiu = Object.keys(draft).filter((key) => !(key in real));
    const tipiDiversi = Object.keys(real)
      .filter((key) => key in draft && typeOf(real[key]) !== typeOf(draft[key]))
      .map((key) => ({ campo: key, vinted: typeOf(real[key]), noi: typeOf(draft[key]) }));

    console.log("campi che Vinted manda e noi no:", mancanti);
    console.log("campi che mandiamo di troppo:", inPiu);
    console.table(tipiDiversi);
    console.log("nostro payload:", draft);
    console.log("payload di Vinted:", real);

    return { mancanti, inPiu, tipiDiversi, draft, real };
  };

  /**
   * Stampa il payload esatto che verrebbe inviato, senza pubblicare nulla:
   * VR.debugDraft(123456)
   */
  VR.debugDraft = async (itemId) => {
    const source = await VR.api.getUploadDraft(itemId);
    const draft = buildDraft(source, [111, 222], {});
    console.log("campi disponibili nell'originale:", Object.keys(source));
    console.log("campi che invierei:", Object.keys(draft));
    console.log(JSON.stringify(draft, null, 2));
    return draft;
  };

})();
