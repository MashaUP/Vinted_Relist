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
  function controlla(stato, { coloreMancante = false, coloreRiempito = false } = {}) {
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

    if (coloreMancante && !(stato.colorIds || []).length && !coloreRiempito) {
      errori.push({ campo: "color", testo: "Manca il colore: Vinted lo chiede alla pubblicazione." });
    }

    return { errori, avvisi, ok: errori.length === 0 };
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

  const api = { controlla, differenze, haModifiche, sposta, sostituisci, fotoModificata, TITOLO_MAX };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.VR = root.VR || {}).editorLogica = api;
})(typeof window !== "undefined" ? window : globalThis);
