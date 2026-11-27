/* Wrapper sulle API interne di Vinted (quelle che usa il sito stesso). */
(() => {
  const VR = (window.VR = window.VR || {});

  const ORIGIN = location.origin;            // funziona anche su .fr, .de, ecc.
  const BASE = `${ORIGIN}/api/v2`;

  let cachedCsrf = null;

  // ---------------------------------------------------------------- token

  /**
   * Dopo un aggiornamento o un ricaricamento dell'estensione, la pagina gia'
   * aperta resta con il codice vecchio, scollegato: non puo' piu' chiedere il
   * token al service worker. Fino alla 2.3.0 questo usciva come «Token CSRF non
   * trovato»; e' invece «ricarica la pagina».
   */
  const scollegata = (e) => !chrome.runtime?.id || /context invalidated/i.test(String(e?.message || e));
  function erroreScollegata() {
    const e = new Error("Vinted Relist è stato aggiornato o ricaricato: ricarica questa pagina di Vinted (F5) e riprova. Niente è stato inviato.");
    e.scollegata = true;
    e.tecnico = true;
    return e;
  }
  VR.paginaScollegata = () => !chrome.runtime?.id;

  /**
   * Token di sessione (CSRF) — 2.7.1.
   *
   * Tre fonti, in ordine:
   *  1. «richieste»: l'intestazione x-csrf-token delle chiamate che Vinted fa da
   *     se', letta dal service worker e tenuta per sito (vinted.fr ≠ vinted.it);
   *  2. «pagina»: la pagina aperta (meta csrf-token, __NEXT_DATA__, dati negli script);
   *  3. «pagina-pubblicazione»: GET /items/new, solo se le prime due non bastano.
   *
   * Fino alla 2.7.0 la 2 e la 3 cercavano solo "CSRF_TOKEN":"…". Nei dati che
   * Next.js mette negli <script> le virgolette sono precedute da «\»
   * (\"CSRF_TOKEN\":\"…\"): forma dedotta da progetti pubblici che leggono Vinted,
   * da confermare sul sito vero. Se il sito non fa chiamate con x-csrf-token
   * (pagine gia' pronte dal server), nessuna fonte trovava il token: «Token CSRF
   * non trovato» con il profilo rilevato.
   *
   * Il valore del token non esce mai da qui se non nell'intestazione verso
   * Vinted: al service worker si riferiscono solo fonte ed esito.
   */
  async function tokensFromBackground() {
    if (VR.paginaScollegata()) throw erroreScollegata();
    try {
      const response = await chrome.runtime.sendMessage({ type: "vr:getTokens", origine: ORIGIN });
      return { tokens: response?.ok ? response.tokens || {} : {}, comunicazione: response?.ok ? "ok" : "errore" };
    } catch (e) {
      if (scollegata(e)) throw erroreScollegata();
      return { tokens: {}, comunicazione: "errore" };
    }
  }

  /** Riferisce al service worker l'esito della lettura (mai il token). */
  function segnalaSessione(stato) {
    try {
      chrome.runtime.sendMessage({ type: "vr:statoSessione", origine: ORIGIN, ...stato })?.catch?.(() => {});
    } catch { /* pagina scollegata: lo dira' la prossima richiesta */ }
  }

  const TOKEN_VALIDO = /^[A-Za-z0-9_\-+/=.:]{16,200}$/;
  /**
   * Il token in un testo HTML o in uno script. Accetta le virgolette semplici
   * ("CSRF_TOKEN":"…") e quelle precedute da una o piu' «\» (dati di Next.js).
   * Volutamente stretto: un valore preso per sbaglio produce un 403 che sembra
   * antibot, peggio di nessun valore.
   */
  const FORME_CSRF = [
    /<meta[^>]*\bname=["']csrf-token["'][^>]*\bcontent=["']([^"']+)["']/i,
    /<meta[^>]*\bcontent=["']([^"']+)["'][^>]*\bname=["']csrf-token["']/i,
    /\bCSRF_TOKEN\\*"\s*:\s*\\*"([^"\\]+)\\*"/,
    /\bcsrf_?token\\*"\s*:\s*\\*"([^"\\]+)\\*"/i,
  ];
  function csrfDaTesto(testo) {
    if (!testo) return null;
    for (const forma of FORME_CSRF) {
      const m = testo.match(forma);
      if (m && TOKEN_VALIDO.test(m[1])) return m[1];
    }
    return null;
  }

  function csrfFromDom() {
    const meta = document.querySelector('meta[name="csrf-token"]')?.content;
    if (meta && TOKEN_VALIDO.test(meta)) return meta;
    // Prima gli script (dati di Next.js, __NEXT_DATA__), poi l'HTML intero.
    for (const script of document.scripts) {
      const t = csrfDaTesto(script.textContent);
      if (t) return t;
    }
    return csrfDaTesto(document.documentElement.innerHTML);
  }

  /** La pagina di pubblicazione, con la tua sessione. → { token } | { errore: categoria, motivo } */
  async function csrfFromUploadPage() {
    const controllo = new AbortController();
    const scadenza = setTimeout(() => controllo.abort(), 15000);
    let risposta;
    try {
      risposta = await fetch(`${ORIGIN}/items/new`, { credentials: "include", headers: { Accept: "text/html" }, signal: controllo.signal });
    } catch (e) {
      return { errore: "pagina-non-letta", motivo: e?.name === "AbortError" ? "nessuna risposta in 15 secondi" : "rete non raggiungibile" };
    } finally {
      clearTimeout(scadenza);
    }
    // Rimandata altrove (accesso, registrazione): non sei connesso in questa scheda.
    // Percorso esatto della pagina d'accesso: dedotto, non misurato.
    let finale = "/items/new";
    try { finale = new URL(risposta.url || `${ORIGIN}/items/new`).pathname; } catch { /* resta /items/new */ }
    if (risposta.status === 401 || (finale !== "/items/new" && /login|signup|signin|sign_in|auth|session/i.test(finale))) {
      return { errore: "sessione-scaduta" };
    }
    if (!risposta.ok) return { errore: "pagina-non-letta", motivo: `HTTP ${risposta.status}` };
    const token = csrfDaTesto(await risposta.text());
    return token ? { token } : { errore: "token-assente" };
  }

  const MESSAGGI_SESSIONE = {
    "sessione-scaduta": "La sessione di Vinted è scaduta o non è attiva in questa scheda: accedi di nuovo a Vinted e riprova. Niente è stato pubblicato.",
    "pagina-non-letta": "Non riesco a leggere la pagina di pubblicazione di Vinted per prendere il token di sessione ({0}). Riprova tra poco. Niente è stato pubblicato.",
    "token-assente": "Account rilevato, ma il token di sessione non è nella pagina di Vinted nelle forme conosciute: forse Vinted l'ha cambiato. Niente è stato pubblicato: prepara la diagnostica (Salute) e mandala su Discord.",
    comunicazione: "Il service worker dell'estensione non ha risposto e il token di sessione non è nella pagina di Vinted: ricarica l'estensione da chrome://extensions, poi questa pagina. Niente è stato pubblicato.",
  };
  function erroreSessione(categoria, motivo = "") {
    const e = new Error(MESSAGGI_SESSIONE[categoria].replace("{0}", motivo));
    e.categoria = categoria;
    e.sessione = true;   // prima di ogni invio: niente è arrivato a Vinted
    return e;
  }

  let fonteCsrf = null;
  /**
   * escludi: un token appena rifiutato da Vinted (403), da non riusare.
   * rete: false per la prova della Salute (niente richieste a Vinted).
   */
  async function trovaCsrf({ escludi = null, rete = true } = {}) {
    const { tokens, comunicazione } = await tokensFromBackground();
    const buono = (t) => t && t !== escludi && TOKEN_VALIDO.test(t);
    if (buono(tokens.csrf)) return { token: tokens.csrf, fonte: "richieste" };
    const dallaPagina = csrfFromDom();
    if (buono(dallaPagina)) return { token: dallaPagina, fonte: "pagina" };
    if (!rete) return { errore: "non-nella-pagina", comunicazione };
    const nuova = await csrfFromUploadPage();
    if (buono(nuova.token)) return { token: nuova.token, fonte: "pagina-pubblicazione" };
    if (nuova.token) return { errore: "token-assente", comunicazione };   // solo quello rifiutato
    return { errore: nuova.errore === "token-assente" && comunicazione !== "ok" ? "comunicazione" : nuova.errore, motivo: nuova.motivo, comunicazione };
  }

  async function getCsrf({ force = false, escludi = null } = {}) {
    if (cachedCsrf && !force && cachedCsrf !== escludi) return cachedCsrf;
    const r = await trovaCsrf({ escludi });
    if (!r.token) {
      cachedCsrf = null;
      segnalaSessione({ esito: "errore", categoria: r.errore, comunicazione: r.comunicazione });
      throw erroreSessione(r.errore, r.motivo);
    }
    cachedCsrf = r.token;
    fonteCsrf = r.fonte;
    segnalaSessione({ esito: "ok", fonte: r.fonte });
    return cachedCsrf;
  }

  /** Salute: la sessione di questa scheda e' pronta? Senza rete, senza valori. */
  VR.provaSessione = async () => {
    try {
      if (cachedCsrf) return { ok: true, fonte: fonteCsrf || "pagina", origine: ORIGIN };
      const r = await trovaCsrf({ rete: false });
      return r.token ? { ok: true, fonte: r.fonte, origine: ORIGIN } : { ok: false, categoria: r.errore, comunicazione: r.comunicazione, origine: ORIGIN };
    } catch (e) {
      return { ok: false, categoria: e?.scollegata ? "scollegata" : "errore", origine: ORIGIN };
    }
  };

  async function anonId() {
    return (await tokensFromBackground()).tokens.anonId || VR.cookie("anon_id") || null;
  }

  async function baseHeaders() {
    // Copiati da una richiesta reale di Vinted. Nota: il sito NON manda
    // X-Requested-With, e aggiungerlo ci rende distinguibili per l'antibot.
    const headers = {
      Accept: "application/json,text/plain,*/*,image/webp",
      "X-CSRF-Token": await getCsrf(),
      // La lingua del sito aperto (vinted.fr → fr-FR) se i cookie non la dicono.
      locale: VR.cookie("user-iso-locale") || VR.cookie("anonymous-iso-locale") || document.documentElement.lang || "it-IT",
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

  async function request(method, path, { body, formData, referrer, retryOn403 = true, timeoutMs = 60000 } = {}) {
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

    // Senza risposta non sappiamo se Vinted ha eseguito la richiesta: l'errore lo
    // dice (rete = true), cosi' chi chiama puo' distinguere "rifiutato" da "incerto".
    const controllo = new AbortController();
    const scadenza = setTimeout(() => controllo.abort(), timeoutMs);
    init.signal = controllo.signal;

    let response;
    try {
      response = await fetch(path.startsWith("http") ? path : BASE + path, init);
    } catch (errore) {
      const e = new Error(
        errore?.name === "AbortError"
          ? `Vinted non ha risposto entro ${Math.round(timeoutMs / 1000)} secondi.`
          : "Connessione a Vinted non riuscita."
      );
      e.rete = true;
      throw e;
    } finally {
      clearTimeout(scadenza);
    }

    if (response.status === 403) {
      // Token scaduto o cambiato: uno e un solo nuovo tentativo, con un token
      // DIVERSO da quello rifiutato (fino alla 2.7.0 si riprendeva lo stesso dal
      // service worker). Se non ce n'e' un altro, non e' la sessione: antibot.
      const rifiutato = headers["X-CSRF-Token"];
      cachedCsrf = null;
      try { chrome.runtime.sendMessage({ type: "vr:tokenRifiutato", origine: ORIGIN, csrf: rifiutato })?.catch?.(() => {}); } catch { /* scollegata */ }
      if (retryOn403) {
        let nuovo = null;
        try { nuovo = await getCsrf({ force: true, escludi: rifiutato }); } catch (e) { if (e?.scollegata) throw e; }
        if (nuovo) return request(method, path, { body, formData, referrer, retryOn403: false, timeoutMs });
      }
      throw bloccato(new Error("Vinted ha rifiutato la richiesta (403): probabile antibot."));
    }

    // 401: Vinted non riconosce piu' la sessione. Non e' un dato sbagliato.
    if (response.status === 401) {
      cachedCsrf = null;
      segnalaSessione({ esito: "errore", categoria: "sessione-scaduta" });
      const e = new Error("Vinted dice che la sessione non è più valida (401): accedi di nuovo a Vinted in questa scheda e riprova.");
      e.status = 401;
      e.categoria = "sessione-scaduta";
      throw e;
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
      const errore = new Error(detail);
      errore.status = response.status;
      errore.campi = fieldErrors;
      throw errore;
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

  /**
   * La lettura espone sia l'id sia il nome dei colori (color1: "Grigio",
   * color1_id: 3). Accumulandoli otteniamo l'elenco senza inventarci endpoint:
   * serve per assegnare un colore agli articoli che non ce l'hanno.
   */
  function imparaColori(item) {
    const visti = {};
    for (const n of [1, 2]) {
      const id = item[`color${n}_id`];
      const nome = item[`color${n}`];
      if (id != null && nome) visti[String(id)] = nome;
    }

    const noti = VR.settings.colorMap || {};
    const nuovi = Object.keys(visti).filter((id) => !noti[id]);
    if (nuovi.length) VR.saveSettings({ colorMap: { ...noti, ...visti } });
  }

  const MAX_ARTICOLI_OSSERVATI = 500;

  /**
   * Scheda di ogni articolo letto: categoria e valori dei campi che sappiamo
   * riempire. Indicizzata per id, cosi' rileggere lo stesso articolo non
   * gonfia le statistiche. Serve a dedurre cosa manca da quello che hai gia'
   * messo tu sugli altri articoli della stessa categoria.
   */
  function osservaCampi(item) {
    if (item.catalog_id == null || item.id == null) return;

    const valori = {};
    for (const campo of VR.CAMPI_OSSERVATI) {
      const chiave = VR.chiaveCampo(campo, item);
      if (chiave != null) valori[campo] = chiave;
    }

    const storico = { ...(VR.settings.itemStats || {}) };
    const precedente = storico[item.id];
    if (precedente && JSON.stringify(precedente.v) === JSON.stringify(valori)) return;

    storico[item.id] = { c: String(item.catalog_id), v: valori, at: Date.now() };

    const voci = Object.entries(storico);
    if (voci.length > MAX_ARTICOLI_OSSERVATI) {
      voci.sort((a, b) => b[1].at - a[1].at);
      VR.saveSettings({ itemStats: Object.fromEntries(voci.slice(0, MAX_ARTICOLI_OSSERVATI)) });
      return;
    }
    VR.saveSettings({ itemStats: storico });
  }

  /** Il punteggio di ogni articolo letto, perche' la dashboard possa mostrarlo. */
  async function annotaQualita(item) {
    if (item.id == null || !VR.punteggio) return;
    const { score } = VR.punteggio(item);
    const { qualityScores = {} } = await chrome.storage.local.get("qualityScores");
    if (qualityScores[item.id]?.score === score) return;
    qualityScores[item.id] = { score, at: Date.now() };
    await chrome.storage.local.set({ qualityScores });
  }

  const api = {
    /** Dati dell'articolo nel formato che si aspetta il form di pubblicazione. */
    async getUploadDraft(itemId) {
      const payload = await request("GET", `/item_upload/items/${itemId}`);
      if (!payload?.item) throw new Error("Non riesco a leggere i dati dell'articolo.");
      imparaColori(payload.item);
      osservaCampi(payload.item);
      annotaQualita(payload.item);
      return payload.item;
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
        // Rete caduta, timeout o errore del server: la richiesta potrebbe essere
        // arrivata e l'annuncio potrebbe esistere. Non e' un fallimento: e' incerto.
        if (error.rete || error.status >= 500) error.incerto = true;
        else VR.warn("payload rifiutato:", JSON.stringify(body, null, 2));
        throw error;
      } finally {
        await chrome.runtime.sendMessage({ type: "vr:uploading", value: false });
      }

      const item = payload?.item;
      if (!item?.id) {
        const errore = new Error("Vinted ha risposto senza l'id del nuovo annuncio.");
        errore.incerto = true;
        throw errore;
      }
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

    /**
     * Esiste ancora questo annuncio tuo? "presente" | "assente" | "ignoto".
     * Solo lettura. Un errore che non sia un 404 non dice niente: "ignoto".
     */
    async stato(itemId) {
      try {
        const payload = await request("GET", `/item_upload/items/${itemId}`, { timeoutMs: 20000 });
        return payload?.item ? "presente" : "ignoto";
      } catch (errore) {
        return errore.status === 404 ? "assente" : "ignoto";
      }
    },

    /**
     * 2.5.0, «Ripubblica da Vintory»: com'e' adesso su Vinted l'annuncio originale.
     * Solo letture. { esito: "online" | "venduto" | "assente" | "ignoto", motivo }
     *   modulo di vendita leggibile → tuo e ancora su Vinted (online, o venduto se chiuso);
     *   modulo 404 → scheda pubblica: 404 anche lei = non esiste piu'; venduta = venduto;
     *   visibile ma non modificabile, o qualunque altro errore → ignoto (nel dubbio, niente).
     */
    async statoVintory(itemId) {
      const venduto = (it) => it?.is_sold === true || it?.is_closed === true || /sold|vendut/i.test(String(it?.item_closing_action ?? "")) || String(it?.status ?? "").toLowerCase() === "sold";
      try {
        const payload = await request("GET", `/item_upload/items/${itemId}`, { timeoutMs: 20000 });
        if (!payload?.item) return { esito: "ignoto", motivo: "Risposta di Vinted non riconosciuta." };
        return venduto(payload.item) ? { esito: "venduto" } : { esito: "online" };
      } catch (errore) {
        if (errore.status !== 404) return { esito: "ignoto", motivo: `Vinted non risponde come previsto: ${errore.message}` };
      }
      try {
        const payload = await request("GET", `/items/${itemId}`, { timeoutMs: 20000 });
        if (venduto(payload?.item)) return { esito: "venduto" };
        return { esito: "ignoto", motivo: "Vinted mostra ancora l'annuncio, ma non come uno che puoi modificare: per sicurezza resta fuori." };
      } catch (errore) {
        return errore.status === 404 ? { esito: "assente" } : { esito: "ignoto", motivo: `Vinted non risponde come previsto: ${errore.message}` };
      }
    },

    /**
     * Gli annunci piu' recenti del tuo armadio, per riconoscere quello creato da
     * un tentativo senza conferma (stesse foto caricate). Endpoint di lettura
     * dell'armadio usato dal sito; se Vinted lo cambia, la verifica lo dice e
     * resta "da verificare" invece di indovinare.
     */
    async armadioRecenti(userId, quanti = 20) {
      const payload = await request("GET", `/wardrobe/${userId}/items?page=1&per_page=${quanti}&order=newest_first`, { timeoutMs: 20000 });
      const items = payload?.items;
      if (!Array.isArray(items)) throw new Error("risposta dell'armadio non riconosciuta");
      return items;
    },

    /** Scarica una foto. Prima direttamente, poi dal service worker se il CORS blocca. */
    async downloadPhoto(url) {
      // Senza limite di tempo una foto bloccata fermava la pubblicazione per sempre.
      const controllo = new AbortController();
      const scadenza = setTimeout(() => controllo.abort(), 60000);
      try {
        const response = await fetch(url, { credentials: "omit", signal: controllo.signal });
        if (response.ok) {
          const blob = await response.blob();
          if (blob.size > 1024) return blob;
        }
      } catch {
        // CORS o rete: ci pensa il service worker.
      } finally {
        clearTimeout(scadenza);
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

  /** Dimentica il token in memoria (cambio di account, prove): il prossimo si rilegge. */
  api.dimenticaToken = () => { cachedCsrf = null; fonteCsrf = null; };
  api.csrfDaTesto = csrfDaTesto;

  VR.api = api;
})();
