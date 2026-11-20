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
   *
   * 2.7.0: tutto da raw.githubusercontent.com, ramo main (standard comuni, sez. 3).
   * L'API di GitHub concede 60 richieste l'ora senza login; raw no, e risponde con
   * Access-Control-Allow-Origin: *, quindi basta una fetch dalla pagina
   * dell'estensione, senza permessi su GitHub. Lo zip si legge dallo stesso
   * indirizzo per verificarne l'impronta (github.com/…/raw/HEAD rimanda a raw con
   * un redirect senza CORS: da qui non si leggerebbe).
   */
  const RAMO = "main";
  const urlRaw = (file, repo = REPO) => `https://raw.githubusercontent.com/${repo}/${RAMO}/${encodeURIComponent(file)}`;
  const urlVersione = (repo = REPO) => urlRaw("version.json", repo);
  const urlLinks = (repo = REPO) => urlRaw("links.json", repo);
  const urlRepo = (repo = REPO) => `https://github.com/${repo}`;
  const urlRelease = (repo = REPO) => `https://github.com/${repo}/releases/latest`;
  const urlZip = (nome, repo = REPO) => urlRaw(nome, repo);
  const URL_VERSIONE = urlVersione();
  const URL_REPO = urlRepo();

  /** Un controllo al minuto basta: GitHub concede 60 richieste l'ora senza login. */
  const ATTESA_CONTROLLO_MS = 60_000;
  const puoControllare = (ultimo, ora = Date.now()) => !ultimo?.at || ora - ultimo.at >= ATTESA_CONTROLLO_MS;

  /** Risposta HTTP di GitHub → frase comprensibile. */
  function erroreGithub(status) {
    if (status === 404) {
      return "version.json non trovato. Il controllo funziona solo se il repository è pubblico e ha un version.json nella radice del ramo main: verifica il nome in Impostazioni › Avanzate.";
    }
    if (status === 403 || status === 429) return "GitHub ha limitato le richieste da questa rete: riprova più tardi.";
    if (!status) return "GitHub non è raggiungibile: controlla la connessione.";
    return `GitHub ha risposto con un errore (HTTP ${status}).`;
  }

  /** Download dello zip: risposta HTTP → frase comprensibile. */
  function erroreDownload(status) {
    if (status === 404) return "Lo zip indicato da version.json non è sul repository: scaricalo dalla pagina delle release su GitHub.";
    if (status === 403 || status === 429) return "GitHub ha limitato le richieste da questa rete: riprova più tardi.";
    if (!status) return "GitHub non è raggiungibile: controlla la connessione.";
    return `Download non riuscito (HTTP ${status}).`;
  }

  /** Impronta SHA-256 in esadecimale minuscolo (crypto.subtle: pagine dell'estensione e Node). */
  async function sha256(bytes) {
    const h = await root.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const MAX_ZIP = 50 * 1024 * 1024;

  /**
   * Lo zip scaricato in memoria si salva solo se e' quello dichiarato: un file
   * zip vero, non troppo grande, con lo SHA-256 di version.json. Senza impronta
   * dichiarata (version.json di prima della 2.7.0) si salva, ma «non verificato».
   * → { ok, verificato, hash, errore? }
   */
  async function verificaZip(bytes, atteso = null) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!b.length) return { ok: false, errore: "GitHub ha mandato un file vuoto: riprova." };
    if (b.length > MAX_ZIP) return { ok: false, errore: "Il file è troppo grande per essere lo zip dell'estensione: non viene salvato." };
    if (!(b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04)) return { ok: false, errore: "Il file scaricato non è uno zip: non viene salvato. Riprova o scaricalo da GitHub." };
    const hash = await sha256(b);
    if (atteso && hash !== atteso) return { ok: false, hash, errore: "Lo zip scaricato non corrisponde all'impronta SHA-256 di version.json: non viene salvato. Riprova tra qualche minuto o scaricalo da GitHub." };
    return { ok: true, verificato: Boolean(atteso), hash };
  }

  const SEMVER = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})(?:-([0-9A-Za-z-]{1,20}(?:\.[0-9A-Za-z-]{1,20}){0,4}))?$/;

  /**
   * Confronto secondo semver: numerico, non alfabetico (1.10.0 viene dopo
   * 1.9.0), e una prerelease viene prima della sua versione (2.3.0-beta.2 <
   * 2.3.0). Fra prerelease: identificatori numerici per numero, gli altri in
   * ordine alfabetico, i numerici prima degli altri.
   */
  function confrontaVersioni(a, b) {
    const pa = SEMVER.exec(String(a).trim());
    const pb = SEMVER.exec(String(b).trim());
    if (!pa || !pb) return null;
    for (let i = 1; i <= 3; i++) {
      const d = Number(pa[i]) - Number(pb[i]);
      if (d) return d > 0 ? 1 : -1;
    }
    if (!pa[4] && !pb[4]) return 0;
    if (!pa[4]) return 1;
    if (!pb[4]) return -1;
    const xa = pa[4].split(".");
    const xb = pb[4].split(".");
    for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
      if (xa[i] == null) return -1;
      if (xb[i] == null) return 1;
      const na = /^\d+$/.test(xa[i]);
      const nb = /^\d+$/.test(xb[i]);
      if (na && nb) { const d = Number(xa[i]) - Number(xb[i]); if (d) return d > 0 ? 1 : -1; continue; }
      if (na !== nb) return na ? -1 : 1;
      if (xa[i] !== xb[i]) return xa[i] > xb[i] ? 1 : -1;
    }
    return 0;
  }

  const ePrerelease = (v) => Boolean(SEMVER.exec(String(v).trim())?.[4]);

  /**
   * Controllo periodico: va notificata questa versione? Una volta sola per
   * versione: si ricorda l'ultima notificata, e si avvisa solo per una piu'
   * recente di quella. Le prerelease solo a chi ne ha gia' una installata.
   */
  function daNotificare(installata, remota, giaNotificata = null) {
    if (!remota?.ok) return { notifica: false, motivo: "versione remota non verificata" };
    const v = remota.versione;
    if (confrontaVersioni(v, installata) !== 1) return { notifica: false, motivo: "nessuna versione più recente" };
    if (ePrerelease(v) && !ePrerelease(installata)) return { notifica: false, motivo: "è una prerelease" };
    if (giaNotificata && confrontaVersioni(v, giaNotificata) !== 1) return { notifica: false, motivo: `la ${v} è già stata notificata` };
    return { notifica: true, versione: v };
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
    if (!SEMVER.test(String(dati.version || ""))) return { ok: false, errore: "numero di versione non valido" };

    const zip = /^Vinted_Relist-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,40})?\.zip$/.test(String(dati.zip || "")) ? dati.zip : null;
    const note = Array.isArray(dati.notes)
      ? dati.notes.filter((n) => typeof n === "string").map((n) => n.slice(0, 300)).slice(0, 12)
      : [];
    const data = /^\d{4}-\d{2}-\d{2}$/.test(String(dati.date || "")) ? dati.date : null;
    // 2.7.0: impronta dello zip, scritta dallo script di pacchetto.
    const sha256 = /^[a-f0-9]{64}$/i.test(String(dati.sha256 || "")) ? String(dati.sha256).toLowerCase() : null;

    return { ok: true, versione: dati.version, data, zip, sha256, note };
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
    "deleteOld", "order", "delayMs", "autoReload", "autoUpdateCheck", "queueIntervalMin",
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
    // 2.7.0: «--» per le righe solo informative (prima uscivano come «ok»)
    const SEGNO = { ok: "ok", info: "--", warn: "!!" };
    for (const c of controlli) righe.push(`  ${SEGNO[c.livello] || (c.ok ? "ok" : "!!")} ${c.nome}: ${ripulisci(c.dettaglio)}`);

    righe.push("", "Eventi recenti:");
    const recenti = eventi.slice(0, 10);
    if (!recenti.length) righe.push("  nessuno");
    for (const e of recenti) {
      const quando = new Date(e.at).toISOString().replace("T", " ").slice(0, 16);
      righe.push(`  ${quando} ${e.kind}: ${ripulisci(e.title)} — ${ripulisci(e.text)}`);
    }

    return righe.join("\n");
  }

  // ------------------------------------------------- report di confronto

  /**
   * Due report diagnostici (di due installazioni) → elenco delle differenze,
   * percorso per percorso. Le voci che cambiano sempre (ore, durate, numeri
   * di serie della coda) non contano: si confronta la configurazione, non
   * l'istante.
   */
  const VARIABILI = /(^|\.)(generato|at|tra|attivoDaS|avviatoAlle|rev|ultimoControllo|millisecondi|ms)$/;
  function appiattisci(x, base = "", out = {}) {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      for (const k of Object.keys(x).sort()) appiattisci(x[k], base ? `${base}.${k}` : k, out);
    } else if (Array.isArray(x) && x.every((v) => v == null || typeof v !== "object")) {
      out[base] = JSON.stringify(x);
    } else if (Array.isArray(x)) {
      x.forEach((v, i) => appiattisci(v, `${base}[${i}]`, out));
      if (!x.length) out[base] = "[]";
    } else out[base] = x === undefined ? "undefined" : JSON.stringify(x);
    return out;
  }
  function differenzeRapporti(a, b) {
    const pa = appiattisci(a);
    const pb = appiattisci(b);
    const chiavi = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort();
    return chiavi
      .filter((k) => !VARIABILI.test(k) && pa[k] !== pb[k])
      .map((k) => ({ percorso: k, questa: pa[k] ?? "(assente)", altra: pb[k] ?? "(assente)" }));
  }

  const api = {
    REPO, RAMO, daNotificare, ePrerelease, differenzeRapporti, URL_VERSIONE, URL_REPO, urlRaw, urlVersione, urlLinks, urlRepo, urlRelease, urlZip,
    puoControllare, erroreGithub, erroreDownload, sha256, verificaZip, MAX_ZIP, ATTESA_CONTROLLO_MS,
    confrontaVersioni, leggiVersioneRemota, statoAggiornamento, sezioniChangelog,
    costruisciDiagnostica, ripulisci,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Versione = api;
})(typeof window !== "undefined" ? window : globalThis);
