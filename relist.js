/* Logica di ripubblicazione. */
(() => {
  const VR = (window.VR = window.VR || {});

  /** Campi che appartengono al vecchio annuncio e non vanno copiati. */
  const DROP_FIELDS = [
    "id",
    "item_id",
    "user_id",
    "photos",
    "url",
    "path",
    "created_at",
    "created_at_ts",
    "updated_at",
    "view_count",
    "favourite_count",
    "is_hidden",
    "is_reserved",
    "is_closed",
    "is_draft",
    "promoted",
    "moderation_status",
    "item_closing_action",
    "stats",
    "user",
    "can_be_sold",
    "can_push_up",
    "active_bid_count",
  ];

  function photoUrls(item) {
    const photos = item?.photos || item?.assigned_photos || [];
    return photos
      .map((photo) => photo.full_size_url || photo.high_resolution?.url || photo.url || photo.image_url)
      .filter(Boolean);
  }

  /** Costruisce il payload del nuovo annuncio a partire da quello vecchio. */
  function buildDraft(source, photoIds, overrides = {}) {
    const draft = JSON.parse(JSON.stringify(source));
    for (const field of DROP_FIELDS) delete draft[field];

    draft.temp_uuid = VR.uuid();
    draft.upload_session_id = VR.uuid();
    draft.assigned_photos = photoIds.map((id, index) => ({ id, orientation: 0, index }));

    if (overrides.title != null) draft.title = String(overrides.title).trim();
    if (overrides.description != null) draft.description = String(overrides.description);
    if (overrides.status_id != null && overrides.status_id !== "") {
      draft.status_id = Number(overrides.status_id);
    }
    if (overrides.price != null && overrides.price !== "") {
      const amount = String(Number(overrides.price).toFixed(2));
      if (draft.price && typeof draft.price === "object") draft.price.amount = amount;
      else draft.price = amount;
      if (draft.price_numeric != null) draft.price_numeric = amount;
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
   * @param {object} overrides  title / description / price / status_id / deleteOld
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
    const tempUuid = VR.uuid();
    const photoIds = [];
    for (let i = 0; i < urls.length; i++) {
      onProgress(`Foto ${i + 1}/${urls.length}…`);
      const blob = await VR.api.downloadPhoto(urls[i]);
      photoIds.push(await VR.api.uploadPhoto(blob, `foto-${i + 1}.jpg`, tempUuid));
      await VR.sleep(300);
    }

    const draft = buildDraft(source, photoIds, overrides);

    if (deleteOld && deleteFirst) {
      onProgress("Elimino il vecchio annuncio…");
      await VR.api.deleteItem(itemId);
      await VR.sleep(settings.delayMs);
    }

    onProgress("Pubblico…");
    let created;
    try {
      created = await VR.api.createItem(draft);
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
    onProgress("Fatto");
    return created;
  }

  VR.relist = relist;
  VR.buildDraft = buildDraft;
  VR.photoUrls = photoUrls;
})();
