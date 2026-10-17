/**
 * Regole delle impostazioni modificabili dal popup: validazione, backup e
 * ripristino. Funzioni pure, senza chrome.* ne' DOM: i test le eseguono in Node.
 */
(function (root) {
  const ORARIO = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

  /**
   * "12:30-14:00, 19:30-22:30" → { ok, fasce, errore }.
   * Stesse regole del service worker (leggiFasce), che pero' scarta in silenzio
   * quello che non capisce: qui invece lo diciamo prima di salvare.
   */
  function validaFasce(testo) {
    const pezzi = String(testo ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    if (!pezzi.length) return { ok: false, errore: "Scrivi almeno una fascia, es. 19:30-22:30." };
    const fasce = [];
    for (const p of pezzi) {
      const m = ORARIO.exec(p);
      if (!m) return { ok: false, errore: `«${p}» non è nel formato HH:MM-HH:MM.` };
      const [h1, m1, h2, m2] = m.slice(1).map(Number);
      if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return { ok: false, errore: `«${p}»: orario inesistente.` };
      const da = h1 * 60 + m1;
      const a = h2 * 60 + m2;
      if (a <= da) return { ok: false, errore: `«${p}»: la fine deve venire dopo l'inizio (niente fasce a cavallo della mezzanotte).` };
      fasce.push([da, a]);
    }
    return { ok: true, fasce };
  }

  /** "proprietario/nome" come su GitHub. */
  const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

  const intero = (min, max, testo) => (v) => {
    const n = Number(v);
    if (String(v).trim() === "" || !Number.isInteger(n)) return { ok: false, errore: "Serve un numero intero." };
    if (n < min || n > max) return { ok: false, errore: testo || `Tra ${min} e ${max}.` };
    return { ok: true, valore: n };
  };
  const booleano = (v) => (typeof v === "boolean" ? { ok: true, valore: v } : { ok: false, errore: "Valore non valido." });
  const scelta = (...ammessi) => (v) =>
    ammessi.includes(v) ? { ok: true, valore: v } : { ok: false, errore: "Scelta non valida." };

  /**
   * Le sole impostazioni che il popup scrive, con la loro regola. Tutto quello
   * che l'estensione impara da sola (colori, formati, id) non sta qui: non si
   * modifica a mano e non finisce nei backup.
   */
  const REGOLE = {
    deleteOld: booleano,
    autoReload: booleano,
    order: scelta("safe", "clean"),
    humanRhythm: booleano,
    canary: booleano,
    notifyOnFinish: booleano,
    autoFill: booleano,
    peakOnly: booleano,
    peakWindows: (v) => {
      const r = validaFasce(v);
      return r.ok ? { ok: true, valore: String(v).split(",").map((p) => p.trim()).filter(Boolean).join(", ") } : r;
    },
    autoRule: booleano,
    autoRuleDays: intero(1, 60, "Tra 1 e 60 giorni."),
    autoRuleMax: intero(1, 30, "Tra 1 e 30 articoli per volta."),
    queueIntervalMin: intero(1, 240, "Tra 1 e 240 minuti."),
    toastsEnabled: booleano,
    toastDuration: scelta("normal", "long"),
    showOnOtherProfiles: booleano,
    delayMs: intero(300, 10000, "Tra 300 e 10000 millisecondi: sotto i 300 Vinted rischia di limitarti."),
    consoleBridge: booleano,
    updateRepo: (v) => {
      const s = String(v ?? "").trim();
      if (!s) return { ok: true, valore: "" };          // vuoto = quello predefinito
      return REPO.test(s) ? { ok: true, valore: s } : { ok: false, errore: "Scrivi proprietario/nome, es. MashaUP/Vinted_Relist." };
    },
  };

  function validaImpostazione(chiave, valore) {
    const regola = REGOLE[chiave];
    if (!regola) return { ok: false, errore: "Impostazione sconosciuta." };
    return regola(valore);
  }

  /** File di backup: solo le impostazioni, con un'intestazione riconoscibile. */
  function esportaImpostazioni(tutte, versione) {
    const impostazioni = {};
    for (const chiave of Object.keys(REGOLE)) {
      if (chiave in (tutte || {})) impostazioni[chiave] = tutte[chiave];
    }
    return { formato: "vinted-relist-impostazioni", versione: String(versione || ""), creato: new Date().toISOString().slice(0, 10), impostazioni };
  }

  /**
   * Un file scelto dall'utente e' comunque un dato non attendibile: si prende
   * solo cio' che passa la regola, il resto si elenca come scartato.
   */
  function importaImpostazioni(testo) {
    let dati;
    try {
      dati = typeof testo === "string" ? JSON.parse(testo) : testo;
    } catch {
      return { ok: false, errore: "Il file non è un JSON valido." };
    }
    if (dati?.formato !== "vinted-relist-impostazioni" || typeof dati.impostazioni !== "object" || !dati.impostazioni) {
      return { ok: false, errore: "Non è un backup delle impostazioni di Vinted Relist." };
    }
    const valori = {};
    const scartate = [];
    for (const [chiave, valore] of Object.entries(dati.impostazioni)) {
      const r = validaImpostazione(chiave, valore);
      if (r.ok) valori[chiave] = r.valore;
      else scartate.push(chiave);
    }
    if (!Object.keys(valori).length) return { ok: false, errore: "Nessuna impostazione valida nel file." };
    return { ok: true, valori, scartate };
  }

  const api = { validaFasce, validaImpostazione, esportaImpostazioni, importaImpostazioni, CHIAVI: Object.keys(REGOLE) };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Impostazioni = api;
})(typeof window !== "undefined" ? window : globalThis);
