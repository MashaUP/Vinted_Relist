/**
 * Versioni, aggiornamenti e diagnostica: funzioni pure, nessun accesso a
 * chrome.* ne' alla rete. Il popup le usa, i test le eseguono direttamente.
 */
(function (root) {
  /**
   * Dove vive il progetto. La distribuzione e' uno zip su GitHub, non il
   * Chrome Web Store: il browser non puo' aggiornare da solo una cartella
   * caricata a mano, quindi l'estensione controlla il version.json del repo.
   * Se il repository ha un altro nome, va cambiato qui e solo qui.
   */
  const REPO = "MashaUP/Vinted_Relist";
  // Ko-fi, Discord e gli altri link non stanno qui: vedi links.json e link.js.

  /**
   * Il nome del repository non e' verificabile da qui: si puo' cambiare nelle
   * impostazioni avanzate (updateRepo), e queste funzioni lo ricevono.
   */
  const urlVersione = (repo = REPO) => `https://api.github.com/repos/${repo}/contents/version.json`;
  const urlRepo = (repo = REPO) => `https://github.com/${repo}`;
  const urlZip = (nome, repo = REPO) => `https://github.com/${repo}/raw/HEAD/${encodeURIComponent(nome)}`;
  const URL_VERSIONE = urlVersione();
  const URL_REPO = urlRepo();

  /** Un controllo al minuto basta: GitHub concede 60 richieste l'ora senza login. */
  const ATTESA_CONTROLLO_MS = 60_000;
  const puoControllare = (ultimo, ora = Date.now()) => !ultimo?.at || ora - ultimo.at >= ATTESA_CONTROLLO_MS;

  /** Risposta HTTP di GitHub → frase comprensibile. */
  function erroreGithub(status) {
    if (status === 404) {
      return "Repository non trovato. Il controllo funziona solo se il repository è pubblico e ha un version.json nella radice: verifica il nome in Impostazioni › Avanzate.";
    }
    if (status === 403 || status === 429) return "GitHub ha limitato le richieste da questa rete: riprova più tardi.";
    if (!status) return "GitHub non è raggiungibile: controlla la connessione.";
    return `GitHub ha risposto con un errore (HTTP ${status}).`;
  }

  const SEMVER = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})$/;

  /** Confronto numerico, non alfabetico: 1.10.0 viene dopo 1.9.0. */
  function confrontaVersioni(a, b) {
    const pa = SEMVER.exec(String(a).trim());
    const pb = SEMVER.exec(String(b).trim());
    if (!pa || !pb) return null;
    for (let i = 1; i <= 3; i++) {
      const d = Number(pa[i]) - Number(pb[i]);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  /**
   * Il version.json remoto e' un dato non attendibile: si accetta solo se ha
   * la forma prevista, e lo zip deve chiamarsi come quelli che pubblichiamo.
   */
  function leggiVersioneRemota(testo) {
    let dati;
    try {
      dati = typeof testo === "string" ? JSON.parse(testo) : testo;
    } catch {
      return { ok: false, errore: "version.json non è un JSON valido" };
    }
    if (!dati || typeof dati !== "object") return { ok: false, errore: "version.json vuoto" };
    // Se GitHub ignora l'Accept "raw" risponde con i metadati e il file in base64.
    if (dati.encoding === "base64" && typeof dati.content === "string") {
      try {
        dati = JSON.parse(decodeURIComponent(escape(atob(dati.content.replace(/\s/g, "")))));
      } catch {
        return { ok: false, errore: "version.json non leggibile" };
      }
      if (!dati || typeof dati !== "object") return { ok: false, errore: "version.json vuoto" };
    }
    if (!SEMVER.test(String(dati.version || ""))) return { ok: false, errore: "numero di versione non valido" };

    const zip = /^Vinted_Relist-\d+\.\d+\.\d+\.zip$/.test(String(dati.zip || "")) ? dati.zip : null;
    const note = Array.isArray(dati.notes)
      ? dati.notes.filter((n) => typeof n === "string").map((n) => n.slice(0, 200)).slice(0, 12)
      : [];
    const data = /^\d{4}-\d{2}-\d{2}$/.test(String(dati.date || "")) ? dati.date : null;

    return { ok: true, versione: dati.version, data, zip, note };
  }

  /** Esito del controllo, pronto da mostrare. */
  function statoAggiornamento(installata, remota) {
    if (!remota?.ok) return { stato: "errore", testo: remota?.errore || "versione remota non verificata" };
    const c = confrontaVersioni(remota.versione, installata);
    if (c === null) return { stato: "errore", testo: "versioni non confrontabili" };
    if (c > 0) return { stato: "disponibile", testo: `Disponibile la ${remota.versione} (hai la ${installata}).` };
    if (c < 0) return { stato: "avanti", testo: `Hai la ${installata}, più recente di quella pubblicata (${remota.versione}).` };
    return { stato: "aggiornata", testo: `Hai l'ultima versione (${installata}).` };
  }

  /** "## 2.0.0 · titolo (17 ottobre 2026)" → sezioni del changelog. */
  function sezioniChangelog(md, quante = 3) {
    const sezioni = [];
    let corrente = null;
    for (const riga of String(md || "").split(/\r?\n/)) {
      const titolo = /^##\s+(\d+\.\d+\.\d+)\s*(.*)$/.exec(riga);
      if (titolo) {
        corrente = { versione: titolo[1], titolo: titolo[2].replace(/^[·\-–—\s]+/, ""), righe: [] };
        sezioni.push(corrente);
        continue;
      }
      if (!corrente) continue;
      const voce = /^\s*[-*]\s+(.*)$/.exec(riga);
      if (voce) corrente.righe.push(voce[1].replace(/\*\*/g, "").replace(/`/g, ""));
    }
    return sezioni.slice(0, quante);
  }

  // ------------------------------------------------------------- diagnostica

  /** Solo impostazioni innocue: niente id utente, niente dati appresi dagli annunci. */
  const IMPOSTAZIONI_DIAGNOSTICA = [
    "deleteOld", "order", "delayMs", "autoReload", "showOnOtherProfiles", "queueIntervalMin",
    "humanRhythm", "notifyOnFinish", "canary", "autoFill", "peakOnly", "peakWindows",
    "autoRule", "autoRuleDays", "autoRuleMax", "toastsEnabled", "toastDuration", "consoleBridge", "updateRepo", "linksRemote",
  ];

  /** Toglie dal testo tutto quello che somiglia a un segreto o a un contatto. */
  function ripulisci(testo) {
    return String(testo ?? "")
      .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, "[token]")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{6,12}\b/gi, "[uuid]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
      .replace(/https?:\/\/\S+/g, "[url]")
      .slice(0, 300);
  }

  /**
   * Testo da incollare quando chiedi aiuto. Si costruisce da dati gia'
   * locali, e si mostra prima di copiarlo.
   */
  function costruisciDiagnostica({ versione, impostazioni = {}, coda = null, eventi = [], controlli = [], ambiente = "" }) {
    const righe = [`Vinted Relist ${versione}`, `Ambiente: ${ripulisci(ambiente) || "sconosciuto"}`, ""];

    righe.push("Impostazioni:");
    for (const k of IMPOSTAZIONI_DIAGNOSTICA) {
      if (k in impostazioni) righe.push(`  ${k}: ${JSON.stringify(impostazioni[k])}`);
    }

    righe.push("", "Coda:");
    if (!coda?.items?.length) righe.push("  nessuna");
    else {
      const conta = {};
      for (const v of coda.items) conta[v.status] = (conta[v.status] || 0) + 1;
      righe.push(`  stato: ${coda.running ? coda.state : "finita"}, ${coda.items.length} articoli`);
      righe.push(`  per stato: ${Object.entries(conta).map(([k, n]) => `${k} ${n}`).join(", ")}`);
      if (coda.note) righe.push(`  nota: ${ripulisci(coda.note)}`);
      for (const v of coda.items.filter((x) => x.error).slice(0, 10)) {
        righe.push(`  - ${v.status}: ${ripulisci(v.error)}`);
      }
    }

    righe.push("", "Controlli:");
    for (const c of controlli) righe.push(`  ${c.ok ? "ok" : "!!"} ${c.nome}: ${ripulisci(c.dettaglio)}`);

    righe.push("", "Eventi recenti:");
    const recenti = eventi.slice(0, 10);
    if (!recenti.length) righe.push("  nessuno");
    for (const e of recenti) {
      const quando = new Date(e.at).toISOString().replace("T", " ").slice(0, 16);
      righe.push(`  ${quando} ${e.kind}: ${ripulisci(e.title)} — ${ripulisci(e.text)}`);
    }

    return righe.join("\n");
  }

  const api = {
    REPO, URL_VERSIONE, URL_REPO, urlVersione, urlRepo, urlZip, puoControllare, erroreGithub, ATTESA_CONTROLLO_MS,
    confrontaVersioni, leggiVersioneRemota, statoAggiornamento, sezioniChangelog,
    costruisciDiagnostica, ripulisci,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Versione = api;
})(typeof window !== "undefined" ? window : globalThis);
