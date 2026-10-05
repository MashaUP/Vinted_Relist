/* Wrapper sulle API interne di Vinted (quelle che usa il sito stesso). */
(() => {
  const VR = (window.VR = window.VR || {});

  const ORIGIN = location.origin;            // funziona anche su .fr, .de, ecc.
  const BASE = `${ORIGIN}/api/v2`;

  let cachedCsrf = null;

  // ---------------------------------------------------------------- token

  async function tokensFromBackground() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "vr:getTokens" });
      return response?.ok ? response.tokens || {} : {};
    } catch {
      return {};
    }
  }

  function csrfFromDom() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta?.content) return meta.content;

    const nextData = document.getElementById("__NEXT_DATA__");
    const haystacks = [nextData?.textContent, document.documentElement.innerHTML];
    const patterns = [
      /"csrfToken"\s*:\s*"([^"]{16,})"/i,
      /"CSRF_TOKEN"\s*:\s*"([^"]{16,})"/i,
      /csrf[-_]?token["'\s:=]+([A-Za-z0-9_\-+/=]{16,})/i,
    ];
    for (const text of haystacks) {
      if (!text) continue;
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1];
      }
    }
    return null;
  }

  async function csrfFromUploadPage() {
    const html = await fetch(`${ORIGIN}/items/new`, { credentials: "include" }).then((r) => r.text());
    const match =
      html.match(/name="csrf-token"\s+content="([^"]+)"/i) ||
      html.match(/"csrfToken"\s*:\s*"([^"]{16,})"/i);
    return match ? match[1] : null;
  }

  async function getCsrf(force = false) {
    if (cachedCsrf && !force) return cachedCsrf;

    const sniffed = (await tokensFromBackground()).csrf;
    cachedCsrf = sniffed || csrfFromDom() || (await csrfFromUploadPage());

    if (!cachedCsrf) throw new Error("Token CSRF non trovato: ricarica la pagina di Vinted e riprova.");
    return cachedCsrf;
  }

  async function anonId() {
    return (await tokensFromBackground()).anonId || VR.cookie("anon_id") || null;
  }

  async function baseHeaders() {
    // Copiati da una richiesta reale di Vinted. Nota: il sito NON manda
    // X-Requested-With, e aggiungerlo ci rende distinguibili per l'antibot.
    const headers = {
      Accept: "application/json,text/plain,*/*,image/webp",
      "X-CSRF-Token": await getCsrf(),
      locale: VR.cookie("user-iso-locale") || VR.cookie("anonymous-iso-locale") || "it-IT",
    };
    const anon = await anonId();
    if (anon) headers["X-Anon-Id"] = anon;
    return headers;
  }

  // ---------------------------------------------------------------- request

  /** Marca un errore come "ci stanno sbarrando la strada", non come dato sbagliato. */
  function bloccato(error) {
    error.blocked = true;
    return error;
  }

  async function request(method, path, { body, formData, referrer, retryOn403 = true } = {}) {
    const headers = await baseHeaders();
    const init = { method, credentials: "include", headers };

    // Vinted manda il referer della pagina di pubblicazione: lo replichiamo,
    // altrimenti le nostre chiamate arrivano da /member/... e stonano.
    if (referrer) init.referrer = referrer;

    if (formData) {
      init.body = formData;                       // niente Content-Type: lo mette il browser
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(path.startsWith("http") ? path : BASE + path, init);

    if (response.status === 403) {
      if (retryOn403) {
        cachedCsrf = null;                        // token scaduto: uno e un solo retry
        await getCsrf(true);
        return request(method, path, { body, formData, referrer, retryOn403: false });
      }
      // gia' riprovato con un token nuovo: non e' la sessione, e' l'antibot
      throw bloccato(new Error("Vinted ha rifiutato la richiesta (403): probabile antibot."));
    }

    // 429 = troppe richieste, 403 persistente = antibot. In coda vanno trattati
    // diversamente da un errore di contenuto: non si riprova subito, si rallenta.
    if (response.status === 429) {
      throw bloccato(new Error("Vinted sta limitando le richieste (429)."));
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      // Vinted elenca i campi rifiutati in errors[]: e' li' che sta la risposta vera,
      // "message" da solo dice sempre la stessa frase generica.
      const fieldErrors = Array.isArray(payload?.errors)
        ? payload.errors
            .map((item) => [item.field, item.value ?? item.message].filter(Boolean).join(": "))
            .filter(Boolean)
        : [];

      const detail =
        fieldErrors.join(" · ") ||
        payload?.message ||
        payload?.error ||
        payload?.message_code ||
        `HTTP ${response.status}`;

      VR.warn(`${method} ${path} → ${response.status}`, payload);
      throw new Error(detail);
    }
    return payload;
  }

  // ---------------------------------------------------------------- endpoint

  /**
   * Formati possibili della richiesta di upload foto, dal piu' probabile al meno.
   * Se Vinted ne cambia uno, aggiungi il tuo qui in cima: lo trovi in DevTools →
   * Network caricando una foto a mano dal form "Vendi subito".
   */
  const PHOTO_LAYOUTS = [
    (fd, blob, name, uuid) => {
      fd.append("photo[type]", "item_photo");
      fd.append("photo[temp_uuid]", uuid);
      fd.append("photo[file]", blob, name);
    },
    (fd, blob, name, uuid) => {
      fd.append("photo[type]", "item");
      fd.append("photo[temp_uuid]", uuid);
      fd.append("photo[file]", blob, name);
    },
    (fd, blob, name, uuid) => {
      fd.append("type", "item_photo");
      fd.append("temp_uuid", uuid);
      fd.append("file", blob, name);
    },
  ];

  let workingLayout = null;

  /** Ricostruisce la richiesta usando i nomi dei campi catturati da Vinted stessa. */
  function learnedLayout(format) {
    return (fd, blob, name, uuid) => {
      for (const [key, value] of Object.entries(format.constants || {})) fd.append(key, value);
      if (format.uuidField) fd.append(format.uuidField, uuid);
      fd.append(format.fileField, blob, name);
    };
  }

  const api = {
    /** Dati dell'articolo nel formato che si aspetta il form di pubblicazione. */
    async getUploadDraft(itemId) {
      const payload = await request("GET", `/item_upload/items/${itemId}`);
      if (payload?.item) return payload.item;
      throw new Error("Non riesco a leggere i dati dell'articolo.");
    },

    /** Fallback: scheda pubblica dell'articolo (serve per le foto e poco altro). */
    async getItem(itemId) {
      const payload = await request("GET", `/items/${itemId}`);
      return payload?.item || null;
    },

    /**
     * Carica una foto e restituisce l'id da usare in assigned_photos.
     * Vinted ha cambiato piu' volte la forma di questa richiesta, quindi provo
     * i formati noti in ordine e mi ricordo quale ha funzionato.
     */
    async uploadPhoto(blob, filename, tempUuid) {
      VR.log("upload foto", filename, blob.type, `${Math.round(blob.size / 1024)} KB`);

      // Il formato imparato dagli upload di Vinted, se c'e', va provato per primo.
      const learned = VR.settings.photoFormat;
      const layouts = learned ? [learnedLayout(learned), ...PHOTO_LAYOUTS] : [...PHOTO_LAYOUTS];

      const order = workingLayout == null ? layouts.map((_, i) => i) : [workingLayout];
      let lastError = null;

      await chrome.runtime.sendMessage({ type: "vr:uploading", value: true });
      try {
        for (const index of order) {
          const formData = new FormData();
          layouts[index](formData, blob, filename, tempUuid);

          try {
            const payload = await request("POST", "/photos", {
              formData,
              referrer: `${ORIGIN}/items/new`,
            });
            const id = payload?.id ?? payload?.photo?.id;
            if (!id) throw new Error("Risposta senza id foto.");

            if (learned && index !== 0) {
              // Ha funzionato un formato diverso da quello imparato: quello era
              // sbagliato. Scartandolo l'array si accorcia, quindi l'indice slitta.
              await VR.saveSettings({ photoFormat: null });
              workingLayout = index - 1;
            } else {
              workingLayout = index;
            }
            return id;
          } catch (error) {
            lastError = error;
            VR.warn(`formato upload #${index + 1} rifiutato:`, error.message);
          }
        }
      } finally {
        await chrome.runtime.sendMessage({ type: "vr:uploading", value: false });
      }

      workingLayout = null;
      throw new Error(
        `${lastError?.message || "Upload foto fallito"} — apri la console per i dettagli.`
      );
    },

    /**
     * Crea il nuovo annuncio.
     * L'involucro osservato e' {item, push_up, parcel, upload_session_id}:
     * upload_session_id sta fuori da item, e feedback_id non c'e'.
     */
    async createItem(draft, uploadSessionId) {
      const envelope = VR.settings.itemFormat?.envelope || [
        "item",
        "push_up",
        "parcel",
        "upload_session_id",
      ];

      const body = {};
      for (const key of envelope) {
        if (key === "item") body.item = draft;
        else if (key === "upload_session_id") body.upload_session_id = uploadSessionId;
        else if (key === "push_up") body.push_up = false;
        else body[key] = null;
      }

      await chrome.runtime.sendMessage({ type: "vr:uploading", value: true });
      let payload;
      try {
        payload = await request("POST", "/item_upload/items", {
          body,
          referrer: `${ORIGIN}/items/new`,
        });
      } catch (error) {
        VR.warn("payload rifiutato:", JSON.stringify(body, null, 2));
        throw error;
      } finally {
        await chrome.runtime.sendMessage({ type: "vr:uploading", value: false });
      }

      const item = payload?.item;
      if (!item?.id) throw new Error(payload?.message || "Creazione annuncio fallita.");
      return item;
    },

    /** Elimina un annuncio. Prova i due metodi che Vinted ha usato nel tempo. */
    async deleteItem(itemId) {
      try {
        return await request("POST", `/items/${itemId}/delete`);
      } catch (first) {
        try {
          return await request("DELETE", `/items/${itemId}`);
        } catch {
          throw first;
        }
      }
    },

    /** Scarica una foto. Prima direttamente, poi dal service worker se il CORS blocca. */
    async downloadPhoto(url) {
      try {
        const response = await fetch(url, { credentials: "omit" });
        if (response.ok) {
          const blob = await response.blob();
          if (blob.size > 1024) return blob;
        }
      } catch {
        // CORS o rete: ci pensa il service worker.
      }

      const response = await chrome.runtime.sendMessage({ type: "vr:fetchImage", url });
      if (!response?.ok) throw new Error(response?.error || "Download foto fallito.");

      const [meta, base64] = response.dataUrl.split(",");
      const mime = meta.slice(5).split(";")[0];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    },
  };

  VR.api = api;
})();
