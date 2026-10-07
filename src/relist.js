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

  function photoUrls(item) {
    const photos = item?.photos || item?.assigned_photos || [];
    return photos.map(bestPhotoUrl).filter(Boolean);
  }

  const MAX_SIDE = 1600;          // Vinted non mostra nulla di piu' grande
  const MAX_BYTES = 4.5 * 1024 * 1024;

  /**
   * Vinted rifiuta i file che non riconosce come JPEG valido (il CDN restituisce WebP)
   * e quelli troppo pesanti. Ridisegnare su canvas risolve entrambe le cose.
   */
  async function toJpeg(blob) {
    try {
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();

      for (const quality of [0.88, 0.75, 0.6]) {
        const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (jpeg && jpeg.size > 1024 && jpeg.size < MAX_BYTES) {
          VR.log(`foto ${width}×${height}, ${Math.round(jpeg.size / 1024)} KB (q${quality})`);
          return jpeg;
        }
      }
    } catch (error) {
      VR.warn("riconversione in JPEG non riuscita, uso il file originale", error);
    }
    return blob;
  }

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
    if (overrides.price != null && overrides.price !== "") {
      draft.price = Number(overrides.price);
    }
    // Percentuale e variazione in euro si applicano al prezzo dell'articolo,
    // quindi vanno calcolate qui e non quando lo metti in coda.
    if (overrides.pricePercent) {
      const base = Number(draft.price) || 0;
      const nuovo = base * (1 + Number(overrides.pricePercent) / 100);
      draft.price = Math.max(0.5, Math.round(nuovo * 100) / 100);
    }
    if (overrides.priceDelta) {
      const base = Number(draft.price) || 0;
      draft.price = Math.max(0.5, Math.round((base + Number(overrides.priceDelta)) * 100) / 100);
    }

    // Vinted rifiuta la pubblicazione senza colore. Lo mettiamo solo dove manca:
    // gli articoli che ne hanno gia' uno non vanno toccati.
    if (overrides.colorIds?.length && Array.isArray(draft.color_ids) && !draft.color_ids.length) {
      draft.color_ids = overrides.colorIds.map(Number).filter((id) => !Number.isNaN(id));
    }
    if (overrides.descriptionAppend) {
      draft.description = `${draft.description || ""}\n${overrides.descriptionAppend}`.trim();
    }

    if (allowed.has("ai_photo") && draft.ai_photo == null) draft.ai_photo = false;

    // Per ultimo, cosi' qualunque scelta esplicita qui sopra ha la precedenza.
    if (VR.settings.autoFill !== false && !senzaRiempimento) {
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

    const urls = photoUrls(source);
    if (!urls.length) throw new Error("Nessuna foto trovata sull'articolo.");

    await backup(itemId, source);

    // Le foto vengono caricate prima di toccare il vecchio annuncio:
    // se qualcosa va storto qui, non abbiamo ancora cancellato nulla.
    // Lo stesso temp_uuid deve legare le foto all'annuncio che creeremo dopo.
    const tempUuid = VR.uuid();
    const photoIds = [];
    for (let i = 0; i < urls.length; i++) {
      const number = i + 1;
      onProgress(`Foto ${number}/${urls.length}…`);

      try {
        const id = await withRetry(`foto ${number}`, async () => {
          const original = await VR.api.downloadPhoto(urls[i]);
          const jpeg = await toJpeg(original);
          return VR.api.uploadPhoto(jpeg, `foto-${number}.jpg`, tempUuid);
        });
        photoIds.push(id);
      } catch (error) {
        throw new Error(`Foto ${number} di ${urls.length}: ${error.message}`);
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
        // Caso peggiore: vecchio annuncio gia' eliminato e nuovo non creato.
        throw new Error(
          `${error.message} — il vecchio annuncio e' stato eliminato. I dati sono salvati: recuperali dal popup dell'estensione.`
        );
      }
      throw error;
    }

    if (deleteOld && !deleteFirst) {
      await VR.sleep(settings.delayMs);
      onProgress("Elimino il vecchio annuncio…");
      try {
        await VR.api.deleteItem(itemId);
      } catch (error) {
        VR.warn("Nuovo annuncio creato ma vecchio non eliminato", error);
        throw new Error(
          "Nuovo annuncio pubblicato, ma il vecchio non e' stato eliminato: rimuovilo a mano."
        );
      }
    }

    await chrome.storage.local.remove(`vrBackup:${itemId}`);

    // Registro delle ripubblicazioni: passa di qui sia il bottone singolo sia la coda.
    chrome.runtime.sendMessage({ type: "vr:relistLogged", itemId: String(itemId) }).catch(() => {});

    onProgress("Fatto");
    return created;
  }

  VR.relist = relist;

  /**
   * Prova a vuoto su un articolo: legge, costruisce il payload e scarica e
   * converte la prima foto. Non carica, non crea, non cancella niente.
   * Serve a non far partire una coda di tre ore se Vinted ha cambiato qualcosa.
   */
  VR.canary = async (itemId, overrides = {}) => {
    const problemi = [];
    const avvisi = [];

    let source;
    try {
      source = await VR.api.getUploadDraft(itemId);
    } catch (error) {
      return { ok: false, problemi: [`lettura articolo: ${error.message}`] };
    }

    const urls = photoUrls(source);
    if (!urls.length) problemi.push("nessuna foto trovata");

    const draft = buildDraft(source, [1], overrides);
    for (const campo of ["title", "catalog_id", "price"]) {
      if (draft[campo] == null || draft[campo] === "") problemi.push(`campo ${campo} vuoto`);
    }
    if (Array.isArray(draft.color_ids) && !draft.color_ids.length) {
      problemi.push("nessun colore: Vinted lo chiede alla pubblicazione, assegnane uno dalle Opzioni");
    }

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
      if (mancanti.length) problemi.push(`campi mancanti: ${mancanti.join(", ")}`);
    }

    if (urls.length) {
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
