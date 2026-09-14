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
    const headers = {
      Accept: "application/json, text/plain, */*",
      "X-CSRF-Token": await getCsrf(),
      "X-Requested-With": "XMLHttpRequest",
    };
    const anon = await anonId();
    if (anon) headers["X-Anon-Id"] = anon;
    return headers;
  }

  // ---------------------------------------------------------------- request

  async function request(method, path, { body, formData, retryOn403 = true } = {}) {
    const headers = await baseHeaders();
    const init = { method, credentials: "include", headers };

    if (formData) {
      init.body = formData;                       // niente Content-Type: lo mette il browser
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(path.startsWith("http") ? path : BASE + path, init);

    if (response.status === 403 && retryOn403) {
      cachedCsrf = null;                          // token scaduto: uno e un solo retry
      await getCsrf(true);
      return request(method, path, { body, formData, retryOn403: false });
    }

    if (response.status === 429) {
      throw new Error("Vinted sta limitando le richieste (429). Aspetta qualche minuto.");
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      const detail = payload?.message || payload?.error || payload?.message_code || `HTTP ${response.status}`;
      throw new Error(detail);
    }
    return payload;
  }

  // ---------------------------------------------------------------- endpoint

  const api = {
    getCsrf,

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

    /** Carica una foto e restituisce l'id da usare in assigned_photos. */
    async uploadPhoto(blob, filename, tempUuid) {
      const formData = new FormData();
      formData.append("photo[type]", "item_photo");
      formData.append("photo[temp_uuid]", tempUuid);
      formData.append("photo[file]", blob, filename);

      const payload = await request("POST", "/photos", { formData });
      const id = payload?.id ?? payload?.photo?.id;
      if (!id) throw new Error("Upload foto: risposta inattesa da Vinted.");
      return id;
    },

    /** Crea il nuovo annuncio. Restituisce l'item creato. */
    async createItem(draft) {
      const payload = await request("POST", "/item_upload/items", {
        body: {
          item: draft,
          feedback_id: null,
          push_up: false,
          parcel: null,
          upload_session_id: draft.upload_session_id,
        },
      });
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

    /** Scarica una foto passando dal service worker (niente problemi di CORS). */
    async downloadPhoto(url) {
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
