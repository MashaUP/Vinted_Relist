/**
 * Logica dell'editor: controlli e differenze. Funzioni pure, nessun DOM:
 * le usa editor.js nella pagina, i test le eseguono direttamente.
 *
 * Lo "stato" dell'editor e' sempre questa forma:
 *   { title, description, price, colorIds, photos: [{ url, rotate, crop }] }
 */
(function (root) {
  const TITOLO_MAX = 100;

  // Vinted vieta di spostare la trattativa fuori dalla piattaforma: un numero o
  // un'email in descrizione e' il modo piu' rapido per farsi oscurare l'annuncio.
  const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const TELEFONO = /(?:\+?\d[\s.-]?){9,13}\d/;
  const CONTATTI = /\b(whatsapp|telegram|instagram|scrivimi su|contattami su|paypal)\b/i;

  const fotoModificata = (f) => (f.rotate || 0) % 360 !== 0 || Boolean(f.crop);

  /**
   * Errori e avvisi sullo stato dell'editor.
   * Un errore blocca la pubblicazione: Vinted la rifiuterebbe comunque.
   * Un avviso no: e' una cosa che probabilmente vuoi sapere.
   */
  function controlla(stato, { coloreMancante = false, coloreRiempito = false, categoriaConColori = false } = {}) {
    const errori = [];
    const avvisi = [];
    const titolo = String(stato.title || "").trim();
    const descrizione = String(stato.description || "").trim();
    const prezzo = Number(stato.price);
    const foto = stato.photos || [];

    if (!titolo) errori.push({ campo: "title", testo: "Il titolo è vuoto." });
    else if (titolo.length > TITOLO_MAX) {
      errori.push({ campo: "title", testo: `Il titolo supera i ${TITOLO_MAX} caratteri (${titolo.length}).` });
    } else if (titolo.length < 12) {
      avvisi.push({ campo: "title", testo: "Titolo molto corto: aggiungere modello o caratteristica lo rende più trovabile." });
    }
    if (titolo.length >= 8 && titolo === titolo.toUpperCase() && /[A-Z]/.test(titolo)) {
      avvisi.push({ campo: "title", testo: "Titolo tutto maiuscolo: nel feed si legge peggio." });
    }

    if (!descrizione) avvisi.push({ campo: "description", testo: "La descrizione è vuota." });
    else if (descrizione.length < 50) {
      avvisi.push({ campo: "description", testo: "Descrizione corta: condizioni e difetti evitano domande in chat." });
    }
    if (EMAIL.test(descrizione) || TELEFONO.test(descrizione) || CONTATTI.test(descrizione)) {
      avvisi.push({
        campo: "description",
        testo: "La descrizione sembra contenere contatti esterni: Vinted può oscurare l'annuncio.",
      });
    }

    if (!Number.isFinite(prezzo) || prezzo <= 0) {
      errori.push({ campo: "price", testo: "Il prezzo deve essere maggiore di zero." });
    }

    if (!foto.length) errori.push({ campo: "photos", testo: "Serve almeno una foto." });
    else if (foto.length < 3) {
      avvisi.push({ campo: "photos", testo: "Con meno di 3 foto l'annuncio risponde a poche domande." });
    }

    // Il colore NON blocca: se l'annuncio e' online senza colore, Vinted l'ha
    // accettato cosi'. Se ora per quella categoria lo chiede, la pubblicazione
    // si ferma con il messaggio di Vinted, e niente e' stato ancora cancellato.
    if (coloreMancante && !(stato.colorIds || []).length && !coloreRiempito) {
      avvisi.push({
        campo: "color",
        testo: categoriaConColori
          ? "Nessun colore. Gli altri tuoi articoli di questa categoria ne hanno uno: Vinted potrebbe chiederlo."
          : "Nessun colore: l'annuncio è online così, lo ripubblico senza. Se Vinted lo chiede, te lo dirà.",
      });
    }

    return { errori, avvisi, ok: errori.length === 0 };
  }

  /**
   * Controllo del payload pronto da inviare, usato dal controllo preventivo.
   * Obbligatori: senza, Vinted rifiuta di sicuro. Facoltativi: si avvisa.
   */
  function verificaPayload(draft, { foto = 0, categoriaConColori = false } = {}) {
    const bloccanti = [];
    const avvisi = [];
    const titolo = String(draft.title ?? "").trim();
    const prezzo = Number(draft.price);

    if (!titolo) bloccanti.push("titolo vuoto");
    else if (titolo.length > TITOLO_MAX) bloccanti.push(`titolo di ${titolo.length} caratteri, Vinted ne accetta ${TITOLO_MAX}`);
    if (!Number.isFinite(prezzo) || prezzo <= 0) bloccanti.push("prezzo mancante o pari a zero");
    if (draft.catalog_id == null || draft.catalog_id === "") bloccanti.push("categoria mancante");
    if (!foto) bloccanti.push("nessuna foto");

    if (Array.isArray(draft.color_ids) && !draft.color_ids.length) {
      avvisi.push(categoriaConColori
        ? "nessun colore (gli altri articoli della categoria ne hanno uno: Vinted potrebbe chiederlo)"
        : "nessun colore (l'originale è online così)");
    }
    if (draft.brand_id == null && !draft.brand) avvisi.push("nessuna marca");
    if (draft.package_size_id == null) avvisi.push("dimensione del pacco non impostata");

    return { ok: bloccanti.length === 0, bloccanti, avvisi };
  }

  /**
   * Cosa cambia rispetto all'annuncio online. Ogni voce dice se verra' inviata
   * a Vinted: e' la distinzione che l'editor deve rendere evidente.
   */
  function differenze(originale, stato) {
    const voci = [];

    const testo = (v) => String(v ?? "").trim();
    if (testo(originale.title) !== testo(stato.title)) {
      voci.push({ campo: "Titolo", prima: testo(originale.title), dopo: testo(stato.title) });
    }
    if (testo(originale.description) !== testo(stato.description)) {
      voci.push({ campo: "Descrizione", prima: testo(originale.description), dopo: testo(stato.description), lungo: true });
    }
    if (Number(originale.price) !== Number(stato.price)) {
      voci.push({ campo: "Prezzo", prima: originale.price, dopo: Number(stato.price), euro: true });
    }
    if ((stato.colorIds || []).length && !(originale.colorIds || []).length) {
      voci.push({ campo: "Colore", prima: "nessuno", dopo: stato.colorIds.join(", ") });
    }

    // foto: ordine, rimosse, ruotate o ritagliate
    const prima = (originale.photos || []).map((f) => f.url);
    const dopo = (stato.photos || []).map((f) => f.url);
    const rimosse = prima.filter((u) => !dopo.includes(u)).length;
    const stessiElementi = dopo.filter((u) => prima.includes(u));
    const riordinate = stessiElementi.join("|") !== prima.filter((u) => dopo.includes(u)).join("|");
    const modificate = (stato.photos || []).filter(fotoModificata).length;
    const copertinaCambiata = prima[0] !== dopo[0];

    const dettagli = [];
    if (copertinaCambiata) dettagli.push("nuova copertina");
    else if (riordinate) dettagli.push("ordine cambiato");
    if (rimosse) dettagli.push(`${rimosse} ${rimosse === 1 ? "tolta" : "tolte"}`);
    if (modificate) dettagli.push(`${modificate} ${modificate === 1 ? "ruotata o ritagliata" : "ruotate o ritagliate"}`);
    if (dettagli.length) {
      voci.push({ campo: "Foto", prima: `${prima.length} foto`, dopo: `${dopo.length} foto: ${dettagli.join(", ")}` });
    }

    return voci;
  }

  /** Una bozza locale serve solo se differisce davvero dall'originale. */
  function haModifiche(originale, stato) {
    return differenze(originale, stato).length > 0;
  }

  /** Sposta un elemento in una lista, per il riordino delle foto. */
  function sposta(lista, da, a) {
    const copia = [...lista];
    if (da < 0 || da >= copia.length || a < 0 || a >= copia.length || da === a) return copia;
    const [elemento] = copia.splice(da, 1);
    copia.splice(a, 0, elemento);
    return copia;
  }

  /**
   * Sostituzione in blocco su titolo e descrizione: testo letterale, senza
   * distinguere maiuscole. Niente espressioni regolari dall'utente: un carattere
   * speciale scritto per sbaglio non deve riscrivere mezzo armadio.
   */
  function sostituisci(testo, cerca, con) {
    if (!cerca) return testo;
    const sicuro = String(cerca).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return String(testo ?? "").replace(new RegExp(sicuro, "gi"), String(con ?? ""));
  }

  /**
   * Il formato reale di un'immagine dai primi byte: il CDN di Vinted serve WebP
   * anche dietro URL che finiscono in .jpeg, e l'estensione del file deve dire
   * il vero sul contenuto.
   */
  function formatoImmagine(byte) {
    const b = byte || [];
    const ascii = (da, n) => String.fromCharCode(...Array.from(b.slice(da, da + n)));
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
    if (b[0] === 0x89 && ascii(1, 3) === "PNG") return { ext: "png", mime: "image/png" };
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { ext: "webp", mime: "image/webp" };
    if (ascii(0, 3) === "GIF") return { ext: "gif", mime: "image/gif" };
    if (ascii(4, 4) === "ftyp" && /avif|avis/.test(ascii(8, 4))) return { ext: "avif", mime: "image/avif" };
    return null;
  }

  /**
   * Nomi dei file scaricati: id dell'annuncio e posizione della foto, niente
   * titolo (puo' contenere dati personali) e niente caratteri problematici.
   * Lo stesso nome non esce mai due volte nella stessa sessione di download.
   */
  function nomiFoto(itemId, voci, usati = new Set()) {
    const base = `vinted-${String(itemId).replace(/[^0-9A-Za-z_-]/g, "") || "annuncio"}`;
    return voci.map(({ posizione, ext }) => {
      const estensione = /^[a-z0-9]{2,5}$/.test(String(ext)) ? ext : "jpg";
      let nome = `${base}-foto-${String(posizione).padStart(2, "0")}.${estensione}`;
      for (let n = 2; usati.has(nome); n++) {
        nome = `${base}-foto-${String(posizione).padStart(2, "0")}-${n}.${estensione}`;
      }
      usati.add(nome);
      return nome;
    });
  }

  const PREZZO_MINIMO = 0.5;
  const arrotonda = (n) => Math.round(n * 100) / 100;

  /**
   * Prezzo finale: prima l'eventuale prezzo fisso, poi percentuale ed euro sul
   * risultato. Mai sotto il minimo. Usata da pubblicazione e anteprima.
   */
  function applicaPrezzo(base, o = {}) {
    let prezzo = Number(base);
    if (o.price != null && o.price !== "") prezzo = Number(o.price);
    if (!Number.isFinite(prezzo)) return base;
    if (o.pricePercent) prezzo = Math.max(PREZZO_MINIMO, arrotonda(prezzo * (1 + Number(o.pricePercent) / 100)));
    if (o.priceDelta) prezzo = Math.max(PREZZO_MINIMO, arrotonda(prezzo + Number(o.priceDelta)));
    return prezzo;
  }

  /**
   * Validazione delle opzioni della coda, campo per campo, e traduzione nella
   * forma che usa la pubblicazione. Un campo sbagliato non salva niente.
   */
  function validaOpzioniCoda(f, ora = Date.now()) {
    const errori = {};
    const overrides = {};
    const numero = (v) => (v === "" || v == null ? NaN : Number(String(v).replace(",", ".")));

    const valore = numero(f.valore);
    if (f.modo === "percent") {
      if (!Number.isFinite(valore) || valore === 0) errori.valore = "Scrivi una percentuale diversa da zero, per esempio -10.";
      else if (valore <= -90 || valore > 200) errori.valore = "Tra -90% e +200%.";
      else overrides.pricePercent = valore;
    } else if (f.modo === "delta") {
      if (!Number.isFinite(valore) || valore === 0) errori.valore = "Scrivi un importo diverso da zero, per esempio -0,50.";
      else if (Math.abs(valore) > 500) errori.valore = "Al massimo 500 € in più o in meno.";
      else overrides.priceDelta = arrotonda(valore);
    } else if (f.modo === "fixed") {
      if (!Number.isFinite(valore) || valore < PREZZO_MINIMO) errori.valore = `Almeno ${PREZZO_MINIMO.toFixed(2).replace(".", ",")} €.`;
      else if (valore > 100000) errori.valore = "Prezzo troppo alto.";
      else overrides.price = arrotonda(valore);
    }

    const aggiunta = String(f.aggiunta || "").trim();
    if (aggiunta.length > 500) errori.aggiunta = "Al massimo 500 caratteri.";
    else if (aggiunta) overrides.descriptionAppend = aggiunta;

    if (f.cerca) {
      if (String(f.cerca).length > 100) errori.cerca = "Al massimo 100 caratteri.";
      else overrides.replace = { find: String(f.cerca), with: String(f.con || "") };
    }

    if (f.colore === "auto") overrides.autoFill = true;
    else if (f.colore) overrides.colorIds = [Number(f.colore)];

    let startAt = null;
    if (f.quando) {
      const t = new Date(f.quando).getTime();
      if (!Number.isFinite(t)) errori.quando = "Data non valida.";
      else if (t < ora - 60_000) errori.quando = "È nel passato: lascia vuoto per partire subito.";
      else if (t > ora + 30 * 86400000) errori.quando = "Al massimo tra 30 giorni.";
      else startAt = t;
    }

    const intervallo = numero(f.intervallo);
    if (!Number.isInteger(intervallo) || intervallo < 1 || intervallo > 240) {
      errori.intervallo = "Un numero intero di minuti, tra 1 e 240.";
    }

    const ok = Object.keys(errori).length === 0;
    return {
      ok,
      errori,
      overrides: ok && Object.keys(overrides).length ? overrides : null,
      startAt: ok ? startAt : null,
      intervalMin: ok ? intervallo : null,
    };
  }

  const api = {
    applicaPrezzo, validaOpzioniCoda,
    controlla, verificaPayload, differenze, haModifiche, sposta, sostituisci,
    fotoModificata, formatoImmagine, nomiFoto, TITOLO_MAX,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.VR = root.VR || {}).editorLogica = api;
})(typeof window !== "undefined" ? window : globalThis);
