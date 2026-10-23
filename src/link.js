/**
 * Link ufficiali del progetto: validazione e precedenza. Funzioni pure,
 * nessun accesso a chrome.* ne' alla rete (quello sta in link-chrome.js).
 *
 * La fonte e' un solo file, links.json nella radice del repository:
 *  - lo stesso file viaggia nel pacchetto ed e' la configurazione predefinita;
 *  - la copia sul ramo principale di GitHub e' la configurazione remota.
 * Cambiare un link sul repository basta: le estensioni gia' installate lo
 * leggono al successivo aggiornamento dei link, senza una nuova versione.
 *
 * La configurazione remota e' un DATO NON ATTENDIBILE. Contiene solo
 * indirizzi, etichette e interruttori: niente codice, niente HTML, niente
 * permessi. Ogni voce si valida da sola: una voce sbagliata viene scartata e
 * resta quella predefinita, non cade tutto il file.
 *
 * Riutilizzabile: nulla qui dipende da Vinted Relist. Il progetto e gli host
 * consentiti si passano come opzioni { progetto, hostConsentiti, hostPerId }
 * (vedi docs/LINK.md).
 */
(function (root) {
  /** Versione del formato che questo codice sa leggere. */
  const SCHEMA = 1;
  const PROGETTO = "vinted-relist";

  /**
   * Dove possono puntare i link. Aggiungere un servizio nuovo richiede una
   * versione nuova dell'estensione: e' voluto, cosi' un file remoto alterato
   * non puo' far aprire un sito qualsiasi.
   */
  const HOST_CONSENTITI = ["github.com", "discord.gg", "discord.com", "ko-fi.com", "mashaup.github.io"];

  /** Per i link noti l'host atteso e' piu' stretto. */
  const HOST_PER_ID = {
    github: ["github.com"],
    discord: ["discord.gg", "discord.com"],
    kofi: ["ko-fi.com"],
  };

  /** Ordine di presentazione dei link noti; quelli nuovi vanno in fondo. */
  const ORDINE = ["github", "discord", "kofi", "documentation", "bug-report", "feature-request", "changelog"];

  const MAX_LINK = 20;
  const MAX_URL = 500;
  const MAX_ETICHETTA = 40;
  const MAX_DESCRIZIONE = 120;
  const ID = /^[a-z][a-z0-9-]{1,31}$/;

  /** Ogni quanto rileggere la configurazione remota, e dopo un errore. */
  const TTL_MS = 12 * 60 * 60 * 1000;
  const ATTESA_DOPO_ERRORE_MS = 60 * 60 * 1000;
  const ATTESA_FORZATA_MS = 60 * 1000;

  const hostConsentito = (host, ammessi) => ammessi.some((h) => host === h);

  /** Indirizzo apribile, oppure il motivo per cui non lo e'. */
  function urlSicuro(valore, id, { hostConsentiti = HOST_CONSENTITI, hostPerId = HOST_PER_ID } = {}) {
    if (typeof valore !== "string" || !valore.trim()) return { ok: false, motivo: "indirizzo mancante" };
    const testo = valore.trim();
    if (testo.length > MAX_URL) return { ok: false, motivo: "indirizzo troppo lungo" };
    if (/[\u0000-\u001f\u007f\s]/.test(testo)) return { ok: false, motivo: "indirizzo con caratteri non validi" };
    let u;
    try {
      u = new URL(testo);
    } catch {
      return { ok: false, motivo: "indirizzo non valido" };
    }
    if (u.protocol !== "https:") return { ok: false, motivo: `protocollo non consentito (${u.protocol})` };
    if (u.username || u.password) return { ok: false, motivo: "credenziali nell'indirizzo" };
    if (u.port) return { ok: false, motivo: "porta non consentita" };
    const h = u.hostname.toLowerCase();
    if (!hostConsentito(h, hostConsentiti)) return { ok: false, motivo: `sito non consentito (${h})` };
    // hasOwn: un id come "constructor" non deve pescare dal prototipo.
    const attesi = Object.prototype.hasOwnProperty.call(hostPerId, id) ? hostPerId[id] : null;
    if (attesi && !hostConsentito(h, attesi)) return { ok: false, motivo: `sito non previsto per «${id}» (${h})` };
    return { ok: true, url: u.href };
  }

  /** Testo breve senza caratteri di controllo: va solo in textContent. */
  function testoBreve(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }

  /**
   * Legge un links.json (testo o oggetto gia' letto).
   * → { ok, errore?, revision, links: {id: {url, enabled, label, description}}, scartati: [{id, motivo}] }
   * ok:false solo quando il file intero e' inutilizzabile (JSON rotto, schema
   * di un'altra versione, progetto sbagliato). Le voci sbagliate finiscono in
   * `scartati` e non tolgono validita' alle altre.
   */
  function valida(ingresso, opzioni = {}) {
    const progetto = opzioni.progetto || PROGETTO;
    let dati = ingresso;
    if (typeof ingresso === "string") {
      try {
        dati = JSON.parse(ingresso);
      } catch {
        return { ok: false, errore: "non è un JSON valido" };
      }
    }
    if (!dati || typeof dati !== "object" || Array.isArray(dati)) return { ok: false, errore: "formato non riconosciuto" };
    if (!Number.isInteger(dati.schemaVersion)) return { ok: false, errore: "schemaVersion mancante" };
    if (dati.schemaVersion > SCHEMA) return { ok: false, errore: `formato ${dati.schemaVersion} più recente di questa versione dell'estensione`, incompatibile: true };
    if (dati.schemaVersion < 1) return { ok: false, errore: "schemaVersion non valido" };
    if (dati.project !== progetto) return { ok: false, errore: `il file è di un altro progetto (${testoBreve(String(dati.project ?? "nessuno"), 40)})` };
    const revision = Number.isInteger(dati.revision) && dati.revision >= 0 ? dati.revision : 0;
    if (!dati.links || typeof dati.links !== "object" || Array.isArray(dati.links)) return { ok: false, errore: "manca l'elenco dei link" };

    const links = {};
    const scartati = [];
    for (const [id, voce] of Object.entries(dati.links)) {
      if (Object.keys(links).length >= MAX_LINK) { scartati.push({ id, motivo: "troppi link" }); continue; }
      if (!ID.test(id) || id === "__proto__") { scartati.push({ id: testoBreve(id, 32), motivo: "identificativo non valido" }); continue; }
      if (!voce || typeof voce !== "object" || Array.isArray(voce)) { scartati.push({ id, motivo: "voce non valida" }); continue; }
      if ("enabled" in voce && typeof voce.enabled !== "boolean") { scartati.push({ id, motivo: "enabled deve essere true o false" }); continue; }
      const enabled = voce.enabled !== false;
      const label = testoBreve(voce.label, MAX_ETICHETTA);
      const description = testoBreve(voce.description, MAX_DESCRIZIONE);
      if (!enabled) {
        // Spegnere un link non richiede un indirizzo valido.
        links[id] = { url: "", enabled: false, label, description };
        continue;
      }
      let u;
      try {
        u = urlSicuro(voce.url, id, opzioni);
      } catch {
        u = { ok: false, motivo: "voce non leggibile" };
      }
      if (!u.ok) { scartati.push({ id, motivo: u.motivo }); continue; }
      links[id] = { url: u.url, enabled: true, label, description };
    }
    return { ok: true, revision, links, scartati };
  }

  /**
   * Precedenza, dalla piu' debole alla piu' forte:
   *   1. links.json del pacchetto (sempre presente, base affidabile);
   *   2. l'ultima configurazione remota valida in cache, voce per voce,
   *      solo se non e' piu' vecchia del pacchetto (revision >= predefinita)
   *      e viene dallo stesso repository.
   * Una voce remota sostituisce quella predefinita con lo stesso id; puo'
   * spegnerla (enabled:false) o aggiungerne una nuova, mai cancellarla.
   * → { links, fonte: "predefinita" | "remota", revision, aggiornatoAt }
   */
  function risolvi({ predefinita, cache = null, repo = null } = {}) {
    const base = predefinita?.ok ? predefinita : { revision: 0, links: {} };
    const usabile = cache?.ok && cache.revision >= base.revision && (!repo || !cache.repo || cache.repo === repo);
    const links = { ...base.links };
    if (usabile) {
      for (const [id, v] of Object.entries(cache.links)) {
        // Un'etichetta vuota nella voce remota non cancella quella predefinita.
        const prima = Object.prototype.hasOwnProperty.call(base.links, id) ? base.links[id] : null;
        links[id] = { ...v, label: v.label || prima?.label || "", description: v.description || prima?.description || "" };
      }
    }
    return {
      links,
      fonte: usabile ? "remota" : "predefinita",
      revision: usabile ? cache.revision : base.revision,
      aggiornatoAt: usabile ? cache.at || null : null,
    };
  }

  /** Link attivi in ordine di presentazione. */
  function elenco(risolti) {
    const voci = Object.entries(risolti?.links || {}).filter(([, v]) => v.enabled && v.url);
    const pos = (id) => { const i = ORDINE.indexOf(id); return i < 0 ? ORDINE.length : i; };
    return voci.sort(([a], [b]) => pos(a) - pos(b) || a.localeCompare(b)).map(([id, v]) => ({ id, ...v, label: v.label || id }));
  }

  /** Il link per id, o null se manca o e' spento: chi lo usa nasconde l'elemento. */
  function link(risolti, id) {
    const tutti = risolti?.links;
    const v = tutti && Object.prototype.hasOwnProperty.call(tutti, id) ? tutti[id] : null;
    return v && v.enabled && v.url ? { id, ...v, label: v.label || id } : null;
  }

  /**
   * Serve chiedere di nuovo il file remoto?
   * stato = { tentativoAt, okAt, errore } salvato dall'adattatore.
   */
  function daAggiornare(stato, ora = Date.now(), { forza = false } = {}) {
    const ultimoTentativo = stato?.tentativoAt || 0;
    if (forza) return ora - ultimoTentativo >= ATTESA_FORZATA_MS;
    if (stato?.errore && ora - ultimoTentativo < ATTESA_DOPO_ERRORE_MS) return false;
    return ora - (stato?.okAt || 0) >= TTL_MS;
  }

  /** Frase per la sezione "Link del progetto". */
  function descriviStato(risolti, stato, ora = Date.now()) {
    if (risolti?.remotoSpento) return "Link della versione installata: l'aggiornamento da GitHub è spento (Impostazioni › Avanzate).";
    const quando = (t) => {
      const m = Math.round((ora - t) / 60000);
      if (m < 2) return "adesso";
      if (m < 60) return `${m} min fa`;
      const h = Math.round(m / 60);
      if (h < 36) return `${h} h fa`;
      return `${Math.round(h / 24)} giorni fa`;
    };
    const base = risolti?.fonte === "remota"
      ? `Link aggiornati dal progetto${risolti.aggiornatoAt ? ` ${quando(risolti.aggiornatoAt)}` : ""}.`
      : "Link della versione installata.";
    if (stato?.errore && stato.tentativoAt && (!stato.okAt || stato.tentativoAt > stato.okAt)) {
      return `${base} Ultimo controllo non riuscito (${stato.errore}): restano validi questi.`;
    }
    return base;
  }

  const api = {
    SCHEMA, PROGETTO, HOST_CONSENTITI, HOST_PER_ID, ORDINE, TTL_MS, ATTESA_DOPO_ERRORE_MS, ATTESA_FORZATA_MS,
    urlSicuro, valida, risolvi, elenco, link, daAggiornare, descriviStato,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LinkProgetto = api;
})(typeof window !== "undefined" ? window : globalThis);
