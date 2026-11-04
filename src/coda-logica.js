/**
 * Modello della coda di ripubblicazione: stati, transizioni, stime, salute,
 * classificazione degli errori, esportazione. Funzioni pure: nessun chrome.*,
 * nessun DOM, nessuna rete. Le usa il service worker (che e' l'UNICO a scrivere
 * la coda, una modifica alla volta), le leggono popup, dashboard e pagina.
 *
 * Forma della coda (v: 3):
 *   { v, startedAt, finishedAt, running, state, nextAt, intervalMin, overrides,
 *     modello, backoff, erroriDiFila, motivoPausa, pausaAuto, riprendiAlle,
 *     pausaDopoCorrente, note, auto, batches: [Batch], batchSeq, items: [Articolo], log: [Evento] }
 *   Articolo: { id, title, thumb, price, status, error, categoria, sicuro,
 *     motivoSalto, tentativi, addedAt, startedAt, finishedAt, annullaRichiesto,
 *     batch, regole: {batch, rev}, scheda, fase, invioAt, traccia, attendeEsito, nuovoId }
 *   Batch (2.2.0): { id: "b1", n, nome, overrides, campi, modello, creataAt, rev, storico }
 *     Le regole (overrides) stanno sulla batch, non sulla coda: ogni articolo
 *     usa quelle della SUA batch. coda.overrides resta, per compatibilita', uguale
 *     a quelle della prima batch.
 *
 * Invarianti:
 *   - ogni id Vinted compare UNA volta per sessione: e' l'identificatore stabile
 *     dell'elemento (dopo una ripubblicazione l'id vecchio non esiste piu', quindi
 *     un "doppione voluto" non ha senso);
 *   - al massimo un articolo e' "working";
 *   - l'ordine dell'array e' l'ordine di esecuzione degli articoli "pending";
 *     nessuna operazione usa indici: tutto passa per id.
 */
(function (root) {
  /** Versione del codice di questo file: la diagnostica la confronta con pagina e service worker. */
  const VERSIONE = "2.3.1";

  const ETICHETTE = {
    pending: "In attesa",
    working: "In elaborazione",
    done: "Completato",
    error: "Fallito",
    verify: "Da verificare",
    skipped: "Saltato",
    cancelled: "Annullato",
    removed: "Rimosso",
    interrupted: "Interrotto",
  };
  const ICONE = { pending: "◷", working: "▶", done: "✓", error: "✕", verify: "?", skipped: "↷", cancelled: "⊘", removed: "–", interrupted: "⏸" };
  const TERMINALI = new Set(["done", "error", "verify", "skipped", "cancelled", "removed", "interrupted"]);

  const MAX_ARTICOLI = 500;
  const MAX_REGISTRO = 300;
  const MAX_REGISTRO_ARCHIVIO = 200;
  const SOGLIA_PRUDENZA = 3;        // esiti negativi di fila prima di fermarsi da soli

  const ID = /^\d{1,20}$/;
  const CDN = /^https:\/\/[a-z0-9.-]*vinted\.(net|com)\//i;

  const clona = (x) => JSON.parse(JSON.stringify(x));

  /** Tracce dell'ultimo tentativo: un articolo rimesso in attesa riparte pulito. */
  const AZZERA_LAVORO = { annullaRichiesto: false, scheda: null, fase: null, invioAt: null, attendeEsito: false, controlli: 0 };

  /** Un articolo che arriva da fuori (pagina, dashboard) e' un dato non attendibile. */
  function pulisciArticolo(item, ora) {
    const id = String(item?.id ?? "").trim();
    if (!ID.test(id)) return null;
    const prezzo = Number(item.price);
    return {
      id,
      title: String(item.title || `Articolo ${id}`).slice(0, 120),
      thumb: CDN.test(String(item.thumb || "")) ? item.thumb : null,
      price: Number.isFinite(prezzo) && prezzo > 0 ? Math.round(prezzo * 100) / 100 : null,
      status: "pending",
      error: null,
      categoria: null,
      sicuro: null,
      motivoSalto: null,
      tentativi: 0,
      addedAt: ora,
      startedAt: null,
      finishedAt: null,
    };
  }

  // -------------------------------------------------------------------- batch

  /**
   * Regole di una batch: le stesse che produce validaOpzioniCoda (editor-logica),
   * niente di nuovo. Arrivano da un messaggio, quindi si tengono solo le chiavi
   * note con il tipo giusto: un campo estraneo non deve arrivare al payload.
   */
  function pulisciOverrides(o) {
    if (!o || typeof o !== "object") return null;
    const r = {};
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    if (num(o.price) != null && o.price > 0) r.price = o.price;
    if (num(o.pricePercent) != null && o.pricePercent !== 0) r.pricePercent = o.pricePercent;
    if (num(o.priceDelta) != null && o.priceDelta !== 0) r.priceDelta = o.priceDelta;
    if (typeof o.descriptionAppend === "string" && o.descriptionAppend.trim()) r.descriptionAppend = o.descriptionAppend.slice(0, 500);
    if (o.replace && typeof o.replace.find === "string" && o.replace.find) {
      r.replace = { find: o.replace.find.slice(0, 100), with: String(o.replace.with ?? "").slice(0, 100) };
    }
    if (o.autoFill === true) r.autoFill = true;
    if (Array.isArray(o.colorIds)) {
      const ids = o.colorIds.map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 2);
      if (ids.length) r.colorIds = ids;
    }
    return Object.keys(r).length ? r : null;
  }

  /** I campi del modulo come li hai scritti: servono a riaprire il Centro di modifica uguale. */
  const CAMPI_REGOLE = ["modo", "valore", "aggiunta", "cerca", "con", "colore"];
  function pulisciCampi(f) {
    if (!f || typeof f !== "object") return null;
    return Object.fromEntries(CAMPI_REGOLE.map((k) => [k, String(f[k] ?? "").slice(0, 500)]));
  }

  const MAX_BATCH = 50;
  const MAX_STORICO_BATCH = 10;

  function creaBatch(coda, { overrides = null, campi = null, modello = null, nome = null } = {}, ora = Date.now()) {
    coda.batches = coda.batches || [];
    const n = Math.max(coda.batchSeq || 0, coda.batches.length) + 1;
    coda.batchSeq = n;
    const b = {
      id: `b${n}`,
      n,
      nome: nome ? String(nome).slice(0, 40) : `Batch ${n}`,
      overrides: pulisciOverrides(overrides),
      campi: pulisciCampi(campi),
      modello: modello ? String(modello).slice(0, 60) : null,
      creataAt: ora,
      rev: 1,
      storico: [],
    };
    coda.batches.push(b);
    return b;
  }

  const trovaBatch = (coda, id) => (coda?.batches || []).find((b) => b.id === String(id)) || null;
  const batchDi = (coda, a) => trovaBatch(coda, a?.batch) || coda?.batches?.[0] || null;

  /**
   * Le regole con cui va pubblicato QUESTO articolo: quelle della sua batch.
   * Mai quelle della batch in corso o dell'ultima aggiunta.
   */
  function overridesDi(coda, id) {
    const a = trova(coda, id);
    const b = batchDi(coda, a);
    const o = b ? b.overrides : coda?.overrides;
    return o ? clona(o) : {};
  }

  /** Stato di ogni batch, per l'elenco raggruppato e il riepilogo. */
  function riepilogoBatch(coda) {
    return (coda?.batches || []).map((b) => {
      const r = { pending: 0, working: 0, done: 0, error: 0, verify: 0, skipped: 0, cancelled: 0, removed: 0, interrupted: 0 };
      for (const a of coda.items || []) if (batchDi(coda, a)?.id === b.id) r[a.status] = (r[a.status] || 0) + 1;
      const totale = Object.values(r).reduce((x, y) => x + y, 0) - r.removed;
      const problemi = r.error + r.verify + r.interrupted;
      const stato = r.working ? "in corso"
        : r.pending ? (problemi ? "in attesa, con problemi" : "in attesa")
        : !totale ? "vuota"
        : problemi ? "conclusa, con problemi" : "conclusa";
      return { id: b.id, n: b.n, nome: b.nome, overrides: b.overrides, campi: b.campi, modello: b.modello, rev: b.rev, creataAt: b.creataAt, conteggi: r, totale, problemi, stato };
    });
  }

  /**
   * Nuove regole per una batch esistente. Valgono SOLO per i suoi articoli in
   * attesa: quello in elaborazione ha gia' ricevuto le sue, i conclusi restano
   * registrati con la revisione che hanno usato (a.regole).
   */
  function modificaBatch(coda, batchId, { overrides = null, campi = null, modello = null } = {}, ora = Date.now()) {
    const b = trovaBatch(coda, batchId);
    if (!b) return { ok: false, motivo: "Batch non trovata in questa coda." };
    const suoi = (coda.items || []).filter((a) => batchDi(coda, a)?.id === b.id);
    const inAttesaB = suoi.filter((a) => a.status === "pending");
    if (!inAttesaB.length) return { ok: false, motivo: "Questa batch non ha articoli in attesa: le regole nuove non avrebbero niente a cui applicarsi." };
    b.storico = [...(b.storico || []), { rev: b.rev, overrides: b.overrides, campi: b.campi, modello: b.modello, finoA: ora }].slice(-MAX_STORICO_BATCH);
    b.overrides = pulisciOverrides(overrides);
    b.campi = pulisciCampi(campi);
    b.modello = modello ? String(modello).slice(0, 60) : null;
    b.rev = (b.rev || 1) + 1;
    if (coda.batches[0] === b) coda.overrides = b.overrides;
    const esclusi = suoi.filter((a) => a.status !== "pending" && a.status !== "removed");
    registra(coda, "configurazione", `${b.nome}: regole aggiornate (revisione ${b.rev}) per ${inAttesaB.length} ${inAttesaB.length === 1 ? "articolo in attesa" : "articoli in attesa"}.`, { batch: b.id }, ora);
    return { ok: true, batch: b.id, rev: b.rev, applicati: inAttesaB.map((a) => a.id), esclusi: esclusi.map((a) => ({ id: a.id, stato: a.status })) };
  }

  // ------------------------------------------------------------------ registro

  /**
   * natura: "locale" = modifica della coda fatta da te o dall'estensione, nulla
   * e' stato inviato a Vinted; "vinted" = esito di una richiesta a Vinted;
   * "sistema" = pause, recuperi, interruzioni.
   */
  const NATURA = {
    creata: "locale", aggiunto: "locale", rimosso: "locale", spostato: "locale", riordinato: "locale",
    riprova: "locale", verificato: "locale", annullamento: "locale", configurazione: "locale",
    avviata: "sistema", pausa: "sistema", ripresa: "sistema", prudenza: "sistema", rallenta: "sistema",
    recupero: "sistema", conclusa: "sistema", inizio: "sistema",
    completato: "vinted", fallito: "vinted", incerto: "vinted", saltato: "sistema", annullato: "sistema",
    priorita: "locale", interrotto: "sistema", controllo: "sistema", verifica: "vinted", tardivo: "vinted",
  };

  function registra(coda, tipo, testo, extra = {}, ora = Date.now()) {
    coda.log = coda.log || [];
    coda.log.push({ at: ora, tipo, natura: NATURA[tipo] || "sistema", testo: String(testo).slice(0, 300), ...extra });
    if (coda.log.length > MAX_REGISTRO) coda.log.splice(0, coda.log.length - MAX_REGISTRO);
  }

  // -------------------------------------------------------------------- lettura

  const trova = (coda, id) => (coda?.items || []).find((i) => i.id === String(id)) || null;
  const corrente = (coda) => (coda?.items || []).find((i) => i.status === "working") || null;
  const prossimo = (coda) => (coda?.items || []).find((i) => i.status === "pending") || null;
  const inAttesa = (coda) => (coda?.items || []).filter((i) => i.status === "pending");

  /** Posizione nella coda: 1 = il prossimo a partire. Solo per gli articoli in attesa. */
  function posizione(coda, id) {
    const i = inAttesa(coda).findIndex((x) => x.id === String(id));
    return i < 0 ? null : i + 1;
  }

  function conta(coda) {
    const r = { pending: 0, working: 0, done: 0, error: 0, verify: 0, skipped: 0, cancelled: 0, removed: 0, interrupted: 0 };
    for (const v of coda?.items || []) r[v.status] = (r[v.status] || 0) + 1;
    r.totale = (coda?.items || []).length - r.removed;           // i rimossi non sono "della sessione"
    r.rimanenti = r.pending + r.working;
    r.trattati = r.done + r.error + r.verify + r.skipped + r.cancelled + r.interrupted;
    return r;
  }

  /** Coda attiva senza piu' niente da fare: va chiusa. */
  const daChiudere = (coda) => Boolean(coda?.running && !corrente(coda) && !prossimo(coda));

  // ---------------------------------------------------------------- creazione

  function nuova({ items = [], intervalMin = 20, overrides = null, campi = null, startAt = 0, ora = Date.now(), auto = false, note = null, modello = null } = {}) {
    const visti = new Set();
    const articoli = [];
    const saltati = [];
    for (const grezzo of items) {
      const a = pulisciArticolo(grezzo, ora);
      if (!a) { saltati.push({ id: String(grezzo?.id ?? ""), motivo: "identificatore non valido" }); continue; }
      if (visti.has(a.id)) { saltati.push({ id: a.id, motivo: "ripetuto nella selezione" }); continue; }
      if (articoli.length >= MAX_ARTICOLI) { saltati.push({ id: a.id, motivo: `oltre il limite di ${MAX_ARTICOLI} articoli` }); continue; }
      visti.add(a.id);
      articoli.push(a);
    }
    const programmata = Number(startAt) > ora + 1000;
    const coda = {
      v: 3,
      startedAt: ora,
      finishedAt: null,
      running: true,
      state: programmata ? "scheduled" : "waiting",
      nextAt: programmata ? Number(startAt) : ora,
      intervalMin: Math.max(1, Math.min(240, Math.round(Number(intervalMin) || 20))),
      overrides: pulisciOverrides(overrides),
      modello: modello ? String(modello).slice(0, 60) : null,
      backoff: 0,
      erroriDiFila: 0,
      motivoPausa: null,
      pausaAuto: false,
      riprendiAlle: null,
      pausaDopoCorrente: false,
      note,
      auto: Boolean(auto),
      batches: [],
      batchSeq: 0,
      items: articoli,
      log: [],
    };
    const b = creaBatch(coda, { overrides, campi, modello }, ora);
    for (const a of articoli) a.batch = b.id;
    registra(coda, "creata", `Coda creata con ${articoli.length} articoli${modello ? ` (modello «${coda.modello}»)` : ""}.`, { batch: b.id }, ora);
    return { coda, saltati };
  }

  /**
   * Una coda della 2.1 non ha batch: tutti i suoi articoli diventano la Batch 1,
   * con le regole con cui era partita. Nessun articolo cambia stato.
   */
  function conBatch(c) {
    if (Array.isArray(c.batches) && c.batches.length) return c;
    c.batches = [];
    c.batchSeq = 0;
    const b = creaBatch(c, { overrides: c.overrides || null, modello: c.modello || null }, c.startedAt || Date.now());
    for (const a of c.items || []) if (!a.batch) a.batch = b.id;
    return c;
  }

  /** Coda salvata da una versione precedente (con l'indice o senza batch): la porto al modello attuale. */
  function migra(coda) {
    if (!coda) return coda;
    if (coda.v === 3) return Array.isArray(coda.batches) && coda.batches.length ? coda : conBatch(clona(coda));
    const c = clona(coda);
    const indice = Number.isInteger(c.index) ? c.index : 0;
    c.items = (c.items || []).map((v, i) => {
      let status = v.status || "pending";
      if (i >= indice && status === "pending" && c.running && c.state === "working" && i === indice) status = "working";
      if (i < indice && status === "pending") status = c.running ? "cancelled" : status;
      return {
        id: String(v.id), title: v.title || `Articolo ${v.id}`, thumb: v.thumb || null, price: v.price ?? null,
        status, error: v.error || null, categoria: null, sicuro: null, motivoSalto: null, tentativi: 0,
        addedAt: c.startedAt || null, startedAt: status === "working" ? c.startedItemAt || null : null, finishedAt: null,
      };
    });
    delete c.index;
    delete c.step;
    c.v = 3;
    c.erroriDiFila = c.erroriDiFila || 0;
    c.motivoPausa = c.motivoPausa || null;
    c.pausaDopoCorrente = Boolean(c.pauseRequested);
    delete c.pauseRequested;
    c.log = c.log || [];
    return conBatch(c);
  }

  // ------------------------------------------------------ aggiunta e rimozione

  /**
   * Cosa succederebbe aggiungendo questi articoli, senza toccare la coda:
   * la stessa funzione serve all'anteprima e all'aggiunta vera.
   *   aggiungi   → nuovo elemento
   *   riattiva   → era fallito, annullato, rimosso o saltato a mano: torna in attesa
   *   rifiuta    → gia' in attesa, in corso, completato, da verificare, non valido
   */
  function valutaAggiunta(coda, items) {
    const visti = new Set();
    return (items || []).map((grezzo) => {
      const id = String(grezzo?.id ?? "").trim();
      if (!ID.test(id)) return { id, esito: "rifiuta", motivo: "identificatore non valido" };
      if (visti.has(id)) return { id, esito: "rifiuta", motivo: "ripetuto nella selezione" };
      visti.add(id);
      const esistente = trova(coda, id);
      if (!esistente) return { id, esito: "aggiungi" };
      const pos = posizione(coda, id);
      switch (esistente.status) {
        case "pending": return { id, esito: "rifiuta", motivo: `è già in coda (posizione ${pos})` };
        case "working": return { id, esito: "rifiuta", motivo: "è l'articolo in elaborazione adesso" };
        case "done": return { id, esito: "rifiuta", motivo: "già ripubblicato in questa sessione: quell'annuncio non esiste più" };
        case "verify": return { id, esito: "rifiuta", motivo: "esito da verificare: conferma prima se è stato pubblicato" };
        case "skipped":
          return esistente.motivoSalto === "gia-ripubblicato"
            ? { id, esito: "rifiuta", motivo: "già ripubblicato a mano dopo l'avvio" }
            : { id, esito: "riattiva", motivo: "era stato saltato" };
        case "error":
          return esistente.sicuro === "no"
            ? { id, esito: "rifiuta", motivo: `riprovare non serve: ${esistente.error || "errore definitivo"}` }
            : { id, esito: "riattiva", motivo: "era fallito: viene riprovato" };
        case "interrupted": return { id, esito: "riattiva", motivo: "era stato interrotto prima dell'invio: viene riprovato" };
        default: return { id, esito: "riattiva", motivo: esistente.status === "removed" ? "era stato rimosso" : "era stato annullato" };
      }
    });
  }

  /** Inserisce gli articoli in attesa in cima (subito dopo il corrente) o in fondo. */
  function collocaInAttesa(coda, articoli, dove) {
    const ids = new Set(articoli.map((a) => a.id));
    const resto = coda.items.filter((i) => !ids.has(i.id));
    if (dove === "cima") {
      const primo = resto.findIndex((i) => i.status === "pending");
      const at = primo < 0 ? resto.length : primo;
      coda.items = [...resto.slice(0, at), ...articoli, ...resto.slice(at)];
    } else {
      coda.items = [...resto, ...articoli];
    }
  }

  /**
   * batch: { overrides, campi, modello, nome } → gli articoli formano una batch
   *   NUOVA con queste regole (il caso normale: le hai appena scelte nel Centro
   *   di modifica). batchId: si uniscono a una batch esistente, con le sue regole.
   *   Nessuno dei due (messaggi della 2.1): nuova batch con le regole della prima,
   *   cioe' le "opzioni con cui e' partita la coda" come prima.
   * Le batch gia' presenti non vengono mai toccate.
   */
  function aggiungi(coda, items, { dove = "fondo", batch = null, batchId = null } = {}, ora = Date.now()) {
    if (!coda?.running) return { ok: false, motivo: "Nessuna coda attiva: avviane una nuova.", aggiunti: [], riattivati: [], rifiutati: [] };
    conBatch(coda);
    if (batchId != null && !trovaBatch(coda, batchId)) return { ok: false, motivo: "Batch non trovata in questa coda.", aggiunti: [], riattivati: [], rifiutati: [] };
    const valutati = valutaAggiunta(coda, items);
    const perId = new Map((items || []).map((x) => [String(x?.id ?? "").trim(), x]));
    const nuovi = [];
    const riattivati = [];
    const rifiutati = [];

    for (const v of valutati) {
      if (v.esito === "rifiuta") { rifiutati.push({ id: v.id, motivo: v.motivo }); continue; }
      if (v.esito === "aggiungi") {
        if (coda.items.length + nuovi.length >= MAX_ARTICOLI) { rifiutati.push({ id: v.id, motivo: `oltre il limite di ${MAX_ARTICOLI} articoli` }); continue; }
        const a = pulisciArticolo(perId.get(v.id), ora);
        a.aggiuntoDopo = true;
        nuovi.push(a);
      } else {
        const a = trova(coda, v.id);
        const precedente = a.status;
        if (precedente === "error" || precedente === "interrupted") a.tentativi = (a.tentativi || 0) + 1;
        Object.assign(a, { status: "pending", error: null, categoria: null, sicuro: null, motivoSalto: null, startedAt: null, finishedAt: null, ...AZZERA_LAVORO });
        riattivati.push({ articolo: a, precedente });
      }
    }

    const daCollocare = [...nuovi, ...riattivati.map((r) => r.articolo)];
    let destinazione = null;
    if (daCollocare.length) {
      if (batchId != null) destinazione = trovaBatch(coda, batchId);
      else if (coda.batches.length >= MAX_BATCH) destinazione = coda.batches[coda.batches.length - 1];
      else {
        const prima = coda.batches[0];
        destinazione = creaBatch(coda, batch || { overrides: prima?.overrides, campi: prima?.campi, modello: prima?.modello }, ora);
      }
      for (const a of nuovi) a.batch = destinazione.id;
      // Un articolo rimesso in coda con regole scelte adesso usa quelle: e' un tentativo nuovo.
      for (const r of riattivati) {
        if (r.articolo.batch !== destinazione.id) r.articolo.batchPrecedente = r.articolo.batch || null;
        r.articolo.batch = destinazione.id;
      }
      collocaInAttesa(coda, daCollocare, dove);
    }
    const etichetta = destinazione ? ` (${destinazione.nome})` : "";
    for (const a of nuovi) registra(coda, "aggiunto", `Aggiunto ${dove === "cima" ? "in cima" : "in fondo"}${etichetta}: ${a.title}`, { id: a.id, batch: a.batch }, ora);
    for (const r of riattivati) registra(coda, "aggiunto", `Rimesso in coda (era «${ETICHETTE[r.precedente]}»)${etichetta}: ${r.articolo.title}`, { id: r.articolo.id, batch: r.articolo.batch }, ora);

    return { ok: true, aggiunti: nuovi.map((a) => a.id), riattivati: riattivati.map((r) => r.articolo.id), rifiutati, batch: destinazione?.id || null };
  }

  /**
   * Rimuove dalla PIANIFICAZIONE: niente viene cancellato su Vinted.
   * Solo gli articoli in attesa; quello in elaborazione si gestisce con
   * annullaCorrente, perche' potrebbe aver gia' parlato con Vinted.
   */
  function rimuovi(coda, ids, ora = Date.now()) {
    const rimossi = [];
    const rifiutati = [];
    for (const id of new Set((ids || []).map(String))) {
      const a = trova(coda, id);
      if (!a) { rifiutati.push({ id, motivo: "non è in questa coda" }); continue; }
      if (a.status === "working") { rifiutati.push({ id, motivo: "è in elaborazione: usa «Annulla operazione»" }); continue; }
      if (a.status !== "pending") { rifiutati.push({ id, motivo: `è già «${ETICHETTE[a.status]}»` }); continue; }
      a.status = "removed";
      a.finishedAt = ora;
      rimossi.push(id);
      registra(coda, "rimosso", `Rimosso dalla coda: ${a.title}`, { id }, ora);
    }
    return { ok: rimossi.length > 0, rimossi, rifiutati };
  }

  /**
   * Annullare l'articolo in elaborazione e' una RICHIESTA: la pagina la rispetta
   * solo se non ha ancora fatto il passo che non si puo' disfare (creazione del
   * nuovo annuncio, o eliminazione del vecchio con l'ordine "elimina, poi pubblica").
   */
  function annullaCorrente(coda, ora = Date.now()) {
    const a = corrente(coda);
    if (!a) return { ok: false, motivo: "Nessun articolo in elaborazione." };
    if (a.annullaRichiesto) return { ok: true, gia: true, id: a.id };
    a.annullaRichiesto = true;
    registra(coda, "annullamento", `Chiesto l'annullamento di: ${a.title}`, { id: a.id }, ora);
    return { ok: true, id: a.id };
  }

  // ---------------------------------------------------------------- ordine

  /** Riscrive gli articoli in attesa, nel nuovo ordine, nelle loro posizioni. */
  function scriviOrdine(coda, ordinati) {
    let k = 0;
    coda.items = coda.items.map((i) => (i.status === "pending" ? ordinati[k++] : i));
  }

  function sposta(coda, ids, dove, ora = Date.now()) {
    const scelti = new Set((ids || []).map(String));
    const attesa = inAttesa(coda);
    const rifiutati = [...scelti]
      .filter((id) => !attesa.some((a) => a.id === id))
      .map((id) => ({ id, motivo: trova(coda, id) ? `è «${ETICHETTE[trova(coda, id).status]}»: si spostano solo gli articoli in attesa` : "non è in questa coda" }));
    const mossi = attesa.filter((a) => scelti.has(a.id));
    if (!mossi.length) return { ok: false, spostati: [], rifiutati, motivo: "Nessun articolo in attesa selezionato." };

    let nuovo = [...attesa];
    if (dove === "cima") nuovo = [...mossi, ...attesa.filter((a) => !scelti.has(a.id))];
    else if (dove === "fondo") nuovo = [...attesa.filter((a) => !scelti.has(a.id)), ...mossi];
    else if (dove === "su") {
      for (let i = 1; i < nuovo.length; i++) {
        if (scelti.has(nuovo[i].id) && !scelti.has(nuovo[i - 1].id)) [nuovo[i - 1], nuovo[i]] = [nuovo[i], nuovo[i - 1]];
      }
    } else if (dove === "giu") {
      for (let i = nuovo.length - 2; i >= 0; i--) {
        if (scelti.has(nuovo[i].id) && !scelti.has(nuovo[i + 1].id)) [nuovo[i], nuovo[i + 1]] = [nuovo[i + 1], nuovo[i]];
      }
    } else return { ok: false, spostati: [], rifiutati, motivo: "Direzione sconosciuta." };

    const cambiato = nuovo.some((a, i) => a.id !== attesa[i].id);
    if (cambiato) {
      scriviOrdine(coda, nuovo);
      const nomi = { cima: "in cima", fondo: "in fondo", su: "su di un posto", giu: "giù di un posto" };
      registra(coda, "spostato", `${mossi.length === 1 ? mossi[0].title : `${mossi.length} articoli`} ${nomi[dove]}`, mossi.length === 1 ? { id: mossi[0].id } : {}, ora);
    }
    return { ok: true, spostati: mossi.map((a) => a.id), rifiutati, cambiato };
  }

  /**
   * Ordine completo degli articoli in attesa (trascinamento). Se nel frattempo la
   * coda e' cambiata (un articolo e' partito, ne e' arrivato uno) si rifiuta:
   * meglio chiedere di riprovare che applicare un ordine vecchio.
   */
  function riordina(coda, ordine, ora = Date.now()) {
    const attesa = inAttesa(coda);
    const ids = (ordine || []).map(String);
    const stessi = ids.length === attesa.length && new Set(ids).size === ids.length && attesa.every((a) => ids.includes(a.id));
    if (!stessi) return { ok: false, motivo: "La coda è cambiata nel frattempo: l'ordine non è stato applicato, riprova." };
    const perId = new Map(attesa.map((a) => [a.id, a]));
    const nuovo = ids.map((id) => perId.get(id));
    if (nuovo.every((a, i) => a.id === attesa[i].id)) return { ok: true, cambiato: false };
    scriviOrdine(coda, nuovo);
    registra(coda, "riordinato", "Ordine della coda modificato.", {}, ora);
    return { ok: true, cambiato: true };
  }

  /**
   * «Ripubblica ora»: l'articolo diventa il PROSSIMO, senza toccare quello in
   * elaborazione. Vale per gli articoli in attesa e per quelli che si possono
   * riprovare in sicurezza (falliti riprovabili, interrotti prima dell'invio).
   * Mai per i «da verificare»: potrebbero essere gia' online.
   * La batch non cambia: si pubblica con le SUE regole.
   */
  function ripubblicaOra(coda, id, ora = Date.now()) {
    const a = trova(coda, id);
    if (!a) return { ok: false, motivo: "Non è in questa coda." };
    const no = {
      working: "È già in elaborazione: non viene interrotto.",
      done: "Già ripubblicato in questa sessione: quell'annuncio non esiste più.",
      verify: "Esito da verificare: potrebbe essere già online. Usa prima «Verifica pubblicazione».",
      removed: "Rimosso dalla coda: aggiungilo di nuovo se vuoi pubblicarlo.",
      cancelled: "Annullato: aggiungilo di nuovo se vuoi pubblicarlo.",
      skipped: "Saltato: aggiungilo di nuovo se vuoi pubblicarlo.",
    }[a.status];
    if (no) return { ok: false, motivo: no };
    if (a.status === "error" && a.sicuro === "no") return { ok: false, motivo: `Riprovare non serve: ${a.error || "errore definitivo"}` };

    let riattivato = null;
    if (a.status === "error" || a.status === "interrupted") {
      riattivato = a.status;
      a.tentativi = (a.tentativi || 0) + 1;
      a.ultimoErrore = a.error;
      Object.assign(a, { status: "pending", error: null, categoria: null, sicuro: null, startedAt: null, finishedAt: null, ...AZZERA_LAVORO });
    }
    const primo = prossimo(coda);
    if (primo?.id !== a.id) scriviOrdine(coda, [a, ...inAttesa(coda).filter((x) => x.id !== a.id)]);
    a.prioritaAt = ora;
    const b = batchDi(coda, a);
    registra(coda, "priorita", `Ripubblica ora: ${a.title} è il prossimo${b ? ` (regole di ${b.nome})` : ""}${riattivato ? `, rimesso in coda (era «${ETICHETTE[riattivato]}»)` : ""}.`, { id: a.id, batch: b?.id || null }, ora);
    return { ok: true, id: a.id, riattivato, dopoCorrente: Boolean(corrente(coda)), batch: b?.id || null };
  }

  /**
   * Interrotto prima dell'invio (scheda chiusa o ricaricata, browser fermato):
   * niente e' arrivato a Vinted, quindi torna in cima da solo. Una volta sola:
   * se si interrompe di nuovo, resta «Interrotto» e decidi tu.
   */
  function rimettiDopoInterruzione(coda, id, ora = Date.now()) {
    const a = trova(coda, id);
    if (!a || a.status !== "interrupted" || a.ripresoDaSolo) return { ok: false };
    a.ultimoErrore = a.error;
    Object.assign(a, { status: "pending", error: null, categoria: null, sicuro: null, startedAt: null, finishedAt: null, ...AZZERA_LAVORO });
    a.ripresoDaSolo = true;
    scriviOrdine(coda, [a, ...inAttesa(coda).filter((x) => x.id !== a.id)]);
    registra(coda, "riprova", `Rimesso in cima da solo: ${a.title} (niente era stato inviato a Vinted).`, { id: a.id }, ora);
    return { ok: true };
  }

  // ------------------------------------------------------- esiti e verifiche

  /** Solo i falliti con un errore per cui riprovare ha senso. Mai i "da verificare". */
  function riprova(coda, ids, ora = Date.now()) {
    const rimessi = [];
    const rifiutati = [];
    for (const id of new Set((ids || []).map(String))) {
      const a = trova(coda, id);
      if (!a) { rifiutati.push({ id, motivo: "non è in questa coda" }); continue; }
      if (a.status === "verify") { rifiutati.push({ id, motivo: "esito incerto: conferma prima se è stato pubblicato" }); continue; }
      if (a.status !== "error" && a.status !== "interrupted") { rifiutati.push({ id, motivo: `è «${ETICHETTE[a.status]}»` }); continue; }
      if (a.sicuro === "no") { rifiutati.push({ id, motivo: `riprovare non serve: ${a.error || "errore definitivo"}` }); continue; }
      rimessi.push(a);
    }
    if (!rimessi.length) return { ok: false, rimessi: [], rifiutati };
    for (const a of rimessi) {
      a.tentativi = (a.tentativi || 0) + 1;
      a.ultimoErrore = a.error;
      Object.assign(a, { status: "pending", error: null, categoria: null, sicuro: null, startedAt: null, finishedAt: null, ...AZZERA_LAVORO });
      registra(coda, "riprova", `Rimesso in coda per un nuovo tentativo (${a.tentativi}°): ${a.title}`, { id: a.id }, ora);
    }
    collocaInAttesa(coda, rimessi, "fondo");
    return { ok: true, rimessi: rimessi.map((a) => a.id), rifiutati };
  }

  function risolvi(coda, id, pubblicato, ora = Date.now()) {
    const a = trova(coda, id);
    if (!a || a.status !== "verify") return { ok: false, motivo: "Non è da verificare." };
    a.status = pubblicato ? "done" : "error";
    a.error = pubblicato ? null : "Non pubblicato (verificato a mano).";
    a.categoria = pubblicato ? null : "verificato";
    a.sicuro = pubblicato ? null : "si";
    a.resolvedAt = ora;
    a.attendeEsito = false;
    registra(coda, "verificato", `${pubblicato ? "Confermato pubblicato" : "Confermato non uscito"}: ${a.title}`, { id: a.id, esito: pubblicato ? "done" : "error" }, ora);
    return { ok: true };
  }

  function avviaArticolo(coda, id, ora = Date.now()) {
    const a = trova(coda, id);
    if (!a || a.status !== "pending" || corrente(coda)) return { ok: false };
    a.status = "working";
    a.startedAt = ora;
    Object.assign(a, AZZERA_LAVORO, { fase: "preparazione" });
    // Con quali regole e' partito: se poi la batch cambia, questo resta vero.
    const b = batchDi(coda, a);
    a.regole = b ? { batch: b.id, rev: b.rev || 1 } : null;
    registra(coda, "inizio", `In elaborazione: ${a.title}${b && (coda.batches || []).length > 1 ? ` (${b.nome})` : ""}`, { id: a.id }, ora);
    return { ok: true, articolo: a };
  }

  /**
   * Il permesso di passare il punto di non ritorno. La pagina lo chiede SUBITO
   * PRIMA della prima richiesta che cambia qualcosa su Vinted, e va avanti solo
   * con un si'. Un no arriva se l'articolo non e' piu' quello in lavorazione
   * (un controllo l'ha gia' dato per interrotto, la sessione e' finita), se
   * l'avvio non coincide (e' un tentativo vecchio) o se hai chiesto di annullare.
   * Cosi' "interrotto prima dell'invio" e' una certezza, non una stima: dopo
   * averlo scritto, quel tentativo non puo' piu' pubblicare niente.
   */
  function confermaInvio(coda, id, avviatoAt, ora = Date.now()) {
    const a = corrente(coda);
    if (!coda?.running) return { ok: false, codice: "coda-chiusa", motivo: "la coda non è più attiva" };
    if (!a || a.id !== String(id)) return { ok: false, codice: "non-in-lavorazione", motivo: "l'articolo non è più quello in lavorazione (un controllo l'aveva già chiuso)" };
    if (avviatoAt != null && Number(avviatoAt) !== a.startedAt) return { ok: false, codice: "tentativo-scaduto", motivo: "è un tentativo vecchio: l'articolo era già ripartito" };
    if (a.annullaRichiesto) return { ok: false, codice: "annullato", motivo: "hai chiesto di annullarlo", annullato: true };
    if (a.fase === "invio") return { ok: true, gia: true };
    a.fase = "invio";
    a.invioAt = ora;
    registra(coda, "controllo", `Richiesta di pubblicazione autorizzata: ${a.title}`, { id: a.id }, ora);
    return { ok: true };
  }

  /** Il tentativo e' stato preso in carico da questa scheda. */
  function assegnaScheda(coda, id, tabId) {
    const a = trova(coda, id);
    if (a && Number.isInteger(tabId)) a.scheda = tabId;
  }

  /**
   * Prove raccolte su un tentativo (dal giornale della pagina o dalla verifica):
   * solo identificatori e fatti, mai testi dell'annuncio oltre al prezzo.
   */
  function annotaTraccia(coda, id, traccia = {}) {
    const a = trova(coda, id);
    if (!a) return;
    const t = { ...(a.traccia || {}) };
    if (traccia.nuovoId && ID.test(String(traccia.nuovoId))) t.nuovoId = String(traccia.nuovoId);
    if (Array.isArray(traccia.fotoIds)) t.fotoIds = traccia.fotoIds.map(String).filter((x) => ID.test(x)).slice(0, 30);
    if (typeof traccia.prezzo === "number" && Number.isFinite(traccia.prezzo)) t.prezzo = traccia.prezzo;
    if (traccia.ordine === "safe" || traccia.ordine === "clean") t.ordine = traccia.ordine;
    if (typeof traccia.eliminaVecchio === "boolean") t.eliminaVecchio = traccia.eliminaVecchio;
    if (["preparazione", "invio", "creato", "concluso"].includes(traccia.fase)) t.fase = traccia.fase;
    a.traccia = t;
  }

  /**
   * Esito di un articolo. Vale solo per l'articolo in elaborazione: un esito
   * arrivato tardi (dopo un watchdog o un recupero) non deve riscrivere niente.
   * esito: { ok, outcome: error|uncertain|partial|skipped|cancelled, error, categoria, sicuro, motivoSalto }
   */
  function concludiArticolo(coda, id, esito = {}, ora = Date.now()) {
    const a = trova(coda, id);
    if (!a || a.status !== "working") return { ok: false, ignorato: true };

    const stato = scriviEsito(a, esito, ora);

    // Modalita' prudente: falliti e incerti di fila. Un successo azzera.
    // Un'interruzione (scheda chiusa o ricaricata) non dice niente sull'articolo.
    if (stato === "done") coda.erroriDiFila = 0;
    else if (stato === "error" || stato === "verify") coda.erroriDiFila = (coda.erroriDiFila || 0) + 1;

    registraEsito(coda, a, stato, ora, esito.tardivo ? "tardivo" : null);
    const prudenza = (stato === "error" || stato === "verify") && coda.erroriDiFila >= SOGLIA_PRUDENZA;
    return { ok: true, stato, articolo: a, prudenza };
  }

  function statoDaEsito(esito) {
    return esito.ok ? "done"
      : esito.outcome === "uncertain" || esito.outcome === "partial" ? "verify"
      : esito.outcome === "skipped" ? "skipped"
      : esito.outcome === "cancelled" ? "cancelled"
      : esito.outcome === "interrupted" ? "interrupted"
      : "error";
  }

  function scriviEsito(a, esito, ora) {
    const stato = statoDaEsito(esito);
    a.status = stato;
    a.finishedAt = ora;
    a.error = esito.ok ? null : String(esito.error || (stato === "cancelled" ? "annullato prima dell'invio a Vinted" : "errore sconosciuto")).slice(0, 400);
    a.categoria = esito.ok ? null : esito.categoria || (stato === "verify" ? "incerto" : stato === "interrupted" ? "interrotto" : null);
    a.sicuro = esito.ok ? null : esito.sicuro || (stato === "verify" ? "no" : stato === "interrupted" ? "si" : null);
    a.motivoSalto = stato === "skipped" ? esito.motivoSalto || "manuale" : null;
    a.annullaRichiesto = false;
    a.attendeEsito = stato === "verify";      // un esito vero arrivato dopo vale ancora
    if (esito.nuovoId && ID.test(String(esito.nuovoId))) a.nuovoId = String(esito.nuovoId);
    if (esito.verificato) a.verificato = esito.verificato;
    return stato;
  }

  function registraEsito(coda, a, stato, ora, tipoForzato = null) {
    const tipo = tipoForzato || { done: "completato", error: "fallito", verify: "incerto", skipped: "saltato", cancelled: "annullato", interrupted: "interrotto" }[stato];
    const testi = {
      done: `Ripubblicato: ${a.title}${a.verificato ? ` (${a.verificato})` : ""}`,
      error: `Non riuscito: ${a.title} — ${a.error}`,
      verify: `Esito incerto: ${a.title} — ${a.error}`,
      skipped: `Saltato: ${a.title}${a.error ? ` — ${a.error}` : ""}`,
      cancelled: `Annullato prima dell'invio: ${a.title}`,
      interrupted: `Interrotto prima dell'invio: ${a.title} — ${a.error}`,
    };
    const azioni = {
      error: a.sicuro === "no" ? "riprovare non serve" : a.sicuro === "dopo-correzione" ? "correggi con Modifica, poi riprova" : "puoi riprovarlo",
      verify: "non riprovare: usa «Verifica pubblicazione» o controlla l'armadio",
      interrupted: "riprovare è sicuro: niente è stato inviato a Vinted",
    };
    const prefisso = tipoForzato === "tardivo" ? "Esito arrivato in ritardo — " : "";
    registra(coda, tipo, `${prefisso}${testi[stato]}`, { id: a.id, esito: stato, ...(azioni[stato] ? { azione: azioni[stato] } : {}) }, ora);
  }

  /**
   * Esito vero arrivato DOPO che un controllo aveva gia' messo l'articolo «da
   * verificare» (pagina lenta, messaggio ritrasmesso). Fino alla 2.1 veniva
   * scartato come "fuori tempo": un annuncio pubblicato restava da verificare.
   * Vale solo per lo stesso tentativo (avviatoAt) e solo da «da verificare»:
   * un esito non cambia mai un articolo gia' concluso con certezza.
   */
  function esitoTardivo(coda, id, esito = {}, ora = Date.now()) {
    const a = trova(coda, id);
    if (!a || a.status !== "verify" || !a.attendeEsito) return { ok: false, ignorato: true };
    if (esito.avviatoAt != null && a.startedAt != null && Number(esito.avviatoAt) !== a.startedAt) return { ok: false, ignorato: true };
    if (!esito.ok && esito.outcome === "uncertain") return { ok: false, ignorato: true };   // nessuna notizia nuova
    const stato = scriviEsito(a, { ...esito, tardivo: true }, ora);
    registraEsito(coda, a, stato, ora, "tardivo");
    return { ok: true, stato, articolo: a };
  }

  /**
   * Da quello che si sa di un tentativo senza esito, che cosa si puo' dire.
   *   giornale: quello che la pagina ha scritto (fase, nuovoId, fotoIds, esito)
   *   faseCoda: la fase registrata dal service worker ("invio" = permesso dato)
   *   vecchio / nuovo: "presente" | "assente" | "ignoto" (letti da Vinted)
   *   trovato: id di un annuncio del tuo armadio con le STESSE foto caricate
   * Verdetti: esito (c'e' l'esito vero), interrotto (niente inviato: certo),
   *   pubblicato, parziale (pubblicato, vecchio ancora online), sconosciuto.
   * Mai "non pubblicato" da un'assenza: un elenco puo' essere in ritardo.
   * Mai titolo o prezzo come prova.
   */
  function valutaVerifica({ giornale = null, faseCoda = null, vecchio = "ignoto", nuovo = "ignoto", trovato = null, eliminaVecchio = true } = {}) {
    if (giornale?.esito) return { verdetto: "esito", esito: giornale.esito, prova: "esito scritto dalla scheda prima di perdere il contatto" };
    const inviato = faseCoda === "invio" || ["invio", "creato", "concluso"].includes(giornale?.fase);
    if (!inviato) {
      // Solo con la fase registrata (2.2+) l'assenza del permesso e' una prova.
      if (faseCoda === "preparazione" || giornale?.fase === "preparazione") {
        return { verdetto: "interrotto", prova: "il permesso di inviare a Vinted non era stato dato: niente creato, niente eliminato" };
      }
      return { verdetto: "sconosciuto", mancano: ["non so a che punto era il tentativo (iniziato con una versione precedente)"] };
    }
    const nuovoId = giornale?.nuovoId || trovato || null;
    if (!nuovoId) {
      const mancano = ["Vinted non ha confermato la creazione"];
      if (vecchio === "ignoto") mancano.push("non riesco a leggere il vecchio annuncio");
      mancano.push("nel tuo armadio non trovo un annuncio con le foto caricate per questo tentativo");
      return { verdetto: "sconosciuto", mancano };
    }
    const prova = giornale?.nuovoId ? `Vinted ha restituito l'id del nuovo annuncio (${nuovoId})` : `annuncio ${nuovoId} con le stesse foto caricate in questo tentativo`;
    if (nuovo === "assente") return { verdetto: "sconosciuto", nuovoId, mancano: [`l'annuncio ${nuovoId} risultava creato ma ora non si trova`] };
    if (!eliminaVecchio) return { verdetto: "pubblicato", nuovoId, prova };
    if (vecchio === "presente") return { verdetto: "parziale", nuovoId, prova };
    if (vecchio === "ignoto") return { verdetto: "parziale-incerto", nuovoId, prova };
    return { verdetto: "pubblicato", nuovoId, prova };
  }

  /** Testi del verdetto, uguali ovunque: cosa e' successo e cosa fare. */
  function esitoDaVerdetto(v) {
    switch (v.verdetto) {
      case "pubblicato":
        return { ok: true, nuovoId: v.nuovoId, verificato: "verificato" };
      case "parziale":
        return { ok: false, outcome: "partial", nuovoId: v.nuovoId, categoria: "incerto", sicuro: "no",
          error: `Pubblicato (verificato: ${v.prova}), ma il vecchio annuncio è ancora online: eliminalo a mano dall'armadio.` };
      case "parziale-incerto":
        return { ok: false, outcome: "partial", nuovoId: v.nuovoId, categoria: "incerto", sicuro: "no",
          error: `Pubblicato (verificato: ${v.prova}). Non riesco a controllare se il vecchio annuncio è stato eliminato: guarda l'armadio.` };
      case "interrotto":
        return { ok: false, outcome: "interrupted", categoria: "interrotto", sicuro: "si",
          error: "La scheda di Vinted ha smesso di rispondere prima dell'invio: nessun annuncio creato o eliminato." };
      default:
        return { ok: false, outcome: "uncertain", categoria: "incerto", sicuro: "no", nuovoId: v.nuovoId || null,
          error: `Nessuna conferma da Vinted: potrebbe essere già pubblicato. Non riprovare prima di aver controllato. Manca: ${(v.mancano || []).join("; ")}.` };
    }
  }

  /**
   * Applica una verifica a un articolo «da verificare» (della coda in corso o di
   * una sessione in archivio). Solo i verdetti con una prova cambiano lo stato.
   */
  function applicaVerifica(coda, id, v, ora = Date.now()) {
    const a = trova(coda, id);
    if (!a || a.status !== "verify") return { ok: false, motivo: "Non è da verificare." };
    if (v.verdetto === "esito") return esitoTardivo(coda, id, { ...v.esito, avviatoAt: null }, ora);
    if (v.verdetto === "pubblicato" || v.verdetto === "parziale" || v.verdetto === "parziale-incerto") {
      const e = esitoDaVerdetto(v);
      if (v.verdetto !== "pubblicato" && a.error === e.error) return { ok: true, stato: "verify", invariato: true };
      scriviEsito(a, e, ora);
      a.resolvedAt = ora;
      registra(coda, "verifica", `${v.verdetto === "pubblicato" ? "Verificato: pubblicato" : "Verificato: pubblicato, vecchio da controllare"} — ${a.title} (${v.prova})`, { id: a.id, esito: a.status }, ora);
      return { ok: true, stato: a.status, articolo: a };
    }
    if (v.verdetto === "interrotto") {
      scriviEsito(a, esitoDaVerdetto(v), ora);
      a.resolvedAt = ora;
      registra(coda, "verifica", `Verificato: niente inviato a Vinted — ${a.title}. Riprovare è sicuro.`, { id: a.id, esito: a.status }, ora);
      return { ok: true, stato: a.status, articolo: a };
    }
    a.ultimaVerifica = { at: ora, mancano: v.mancano || [] };
    return { ok: false, stato: "verify", motivo: (v.mancano || []).join("; ") || "nessuna prova sufficiente" };
  }

  // ------------------------------------------------------------ classificazione

  /**
   * Errore → categoria comprensibile, cosa fare, se riprovare ha senso.
   * sicuroRiprovare: "si" | "dopo-correzione" | "no".
   */
  function classificaErrore(e = {}) {
    const status = Number(e.status) || 0;
    if (e.annullato) return { categoria: "annullato", etichetta: "Annullato", cosaFare: "Niente: non è stato inviato niente a Vinted.", sicuroRiprovare: "si" };
    // 2.3: il permesso di inviare non e' arrivato per un problema dell'estensione
    // (service worker, salvataggio, versioni). Niente inviato: riprovare e' sicuro.
    if (e.tecnico) {
      return { categoria: "comunicazione", etichetta: "Problema dell'estensione", cosaFare: e.cosaFare || "Niente è stato inviato a Vinted. Leggi il motivo, poi riprendi la coda; se si ripete, genera il report diagnostico (Salute).", sicuroRiprovare: "si" };
    }
    if (e.nonTuo) return { categoria: "non-consentito", etichetta: "Non è un tuo annuncio", cosaFare: "Niente: l'estensione lavora solo sugli annunci del tuo armadio.", sicuroRiprovare: "no" };
    if (e.duplicato) return { categoria: "in-uso", etichetta: "Già in lavorazione", cosaFare: "Era già in ripubblicazione dal bottone sulla card.", sicuroRiprovare: "no" };
    if (e.parziale) {
      return { categoria: "incerto", etichetta: "Pubblicato, vecchio non eliminato", cosaFare: "Il nuovo annuncio c'è: elimina a mano quello vecchio dall'armadio.", sicuroRiprovare: "no" };
    }
    if (e.incerto) {
      return { categoria: "incerto", etichetta: "Esito incerto", cosaFare: "Vinted potrebbe averlo pubblicato: controlla l'armadio e conferma l'esito.", sicuroRiprovare: "no" };
    }
    if (e.blocked || status === 429) {
      return { categoria: "temporaneo", etichetta: "Vinted sta limitando le richieste", cosaFare: "La coda rallenta da sola; se si ferma, riprova più tardi.", sicuroRiprovare: "si" };
    }
    if (status === 401 || status === 403) {
      return { categoria: "sessione", etichetta: "Problema di sessione", cosaFare: "Ricarica Vinted e controlla di essere entrato, poi riprova.", sicuroRiprovare: "si" };
    }
    if (status === 404) {
      return { categoria: "non-consentito", etichetta: "Articolo non trovato", cosaFare: "Forse è stato venduto o ripubblicato: controlla l'armadio.", sicuroRiprovare: "no" };
    }
    if (e.campi || status === 400 || status === 422) {
      return { categoria: "dati", etichetta: "Dati non accettati da Vinted", cosaFare: "Apri l'articolo con Modifica e correggi i campi indicati.", sicuroRiprovare: "dopo-correzione" };
    }
    if (e.rete) return { categoria: "rete", etichetta: "Errore di rete", cosaFare: "Controlla la connessione; riprovare è sicuro (la lettura non pubblica niente).", sicuroRiprovare: "si" };
    if (status >= 500) return { categoria: "temporaneo", etichetta: "Vinted non disponibile", cosaFare: "Riprova più tardi.", sicuroRiprovare: "si" };
    if (status >= 400) return { categoria: "non-consentito", etichetta: "Operazione rifiutata", cosaFare: "Leggi il messaggio di Vinted.", sicuroRiprovare: "dopo-correzione" };
    return { categoria: "interno", etichetta: "Errore interno", cosaFare: "Copia la diagnostica dal popup (Salute) e segnalalo.", sicuroRiprovare: "si" };
  }

  const ETICHETTE_CATEGORIA = {
    temporaneo: "Temporaneo", dati: "Dati mancanti o rifiutati", sessione: "Sessione", "non-consentito": "Non consentito",
    rete: "Rete", interno: "Interno", incerto: "Esito incerto", annullato: "Annullato", "in-uso": "Già in lavorazione", verificato: "Verificato a mano",
    interrotto: "Interrotto prima dell'invio",
    comunicazione: "Problema dell'estensione",
  };

  // -------------------------------------------------------- stima e salute

  /**
   * Tempo rimanente stimato dalle durate osservate in questa sessione e
   * dall'intervallo. Non tiene conto di fasce orarie, pause per inattivita' e
   * rallentamenti: per questo e' una stima, e lo dice.
   */
  function stima(coda, ora = Date.now()) {
    const r = conta(coda);
    const trascorsoMs = coda?.startedAt ? Math.max(0, (coda.finishedAt || ora) - coda.startedAt) : 0;
    const durate = (coda?.items || [])
      .filter((i) => ["done", "error", "verify"].includes(i.status) && i.startedAt && i.finishedAt)
      .map((i) => i.finishedAt - i.startedAt);
    const media = durate.length ? durate.reduce((a, b) => a + b, 0) / durate.length : null;
    const intervallo = (coda?.intervalMin || 20) * 60_000;
    const base = { trascorsoMs, campioni: durate.length, durataMediaMs: media, intervalMin: coda?.intervalMin || null };

    if (!coda?.running) return { ...base, rimanenteMs: 0, fineAlle: coda?.finishedAt || null, affidabile: true, testo: "Sessione conclusa." };
    if (!r.rimanenti) return { ...base, rimanenteMs: 0, fineAlle: ora, affidabile: true, testo: "Nessun articolo in attesa." };
    if (["paused", "recovering"].includes(coda.state)) {
      return { ...base, rimanenteMs: null, fineAlle: null, affidabile: false, testo: "In pausa: la stima riparte alla ripresa." };
    }

    const op = media ?? 0;
    let ms = 0;
    const c = corrente(coda);
    if (c) ms += Math.max(0, op - (ora - (c.startedAt || ora)));
    let restanti = r.pending;
    if (!c && restanti) {
      ms += Math.max(0, (coda.nextAt || ora) - ora) + op;       // il prossimo parte a nextAt
      restanti -= 1;
    }
    ms += restanti * (intervallo + op);

    const affidabile = durate.length >= 2;
    const nota = affidabile
      ? "Stima indicativa: fasce orarie, pause e rallentamenti possono allungarla."
      : "Stima approssimata: non ci sono ancora abbastanza articoli conclusi per misurare la durata.";
    return { ...base, rimanenteMs: Math.round(ms), fineAlle: ora + Math.round(ms), affidabile, testo: nota };
  }

  /**
   * Indicatore sintetico. Ogni stato dice perche' e cosa fare. Le cause che
   * vengono da indizi (es. "Vinted sta limitando") lo dicono.
   */
  function salute(coda) {
    if (!coda?.items?.length) return { livello: "vuota", titolo: "Nessuna coda", perche: "Non c'è nessuna sessione.", azione: "Seleziona gli articoli dal tuo armadio." };
    const r = conta(coda);
    if (coda.running && coda.state === "recovering") {
      return { livello: "attenzione", titolo: "Attenzione richiesta", perche: "La sessione si è interrotta (browser o estensione fermati).",
        azione: r.verify ? "Verifica prima gli articoli «da verificare», poi Riprendi." : "Premi Riprendi per continuare o Interrompi." };
    }
    if (coda.running && coda.state === "paused" && coda.pausaAuto) {
      return { livello: "bloccata", titolo: "Operazione bloccata", perche: coda.motivoPausa || "La coda si è fermata da sola.", azione: "Leggi i motivi degli ultimi articoli, poi Riprendi." };
    }
    if (coda.running && coda.backoff > 0) {
      return { livello: "attenzione", titolo: "Vinted sta rallentando le richieste", perche: coda.note || "Risposte 429 o 403: probabile limite di frequenza.",
        azione: "Non serve fare niente: la coda aspetta e riprova da sola." };
    }
    if (coda.running && coda.state === "paused") {
      return { livello: "pausa", titolo: "In pausa", perche: coda.riprendiAlle ? "Pausa a tempo." : "Messa in pausa da te.", azione: "Riprendi quando vuoi; puoi modificare la coda intanto." };
    }
    if (r.interrupted && !r.verify && !r.error) {
      return { livello: "attenzione", titolo: "Attenzione richiesta", perche: `${r.interrupted} ${r.interrupted === 1 ? "articolo interrotto" : "articoli interrotti"} prima dell'invio (scheda chiusa o ricaricata).`, azione: "Niente è stato pubblicato: puoi riprovarli." };
    }
    if (r.verify) return { livello: "verificare", titolo: "Risultati da verificare", perche: `${r.verify} ${r.verify === 1 ? "esito incerto" : "esiti incerti"}.`, azione: "Apri gli articoli, guarda l'armadio e conferma l'esito." };
    if (r.error) return { livello: "attenzione", titolo: "Attenzione richiesta", perche: `${r.error} ${r.error === 1 ? "articolo fallito" : "articoli falliti"}.`, azione: "Leggi il motivo; riprova quelli per cui è sicuro." };
    if (coda.running) return { livello: "ok", titolo: "Tutto regolare", perche: "Nessun errore finora.", azione: "Niente da fare." };
    return { livello: "ok", titolo: "Sessione conclusa senza problemi", perche: `${r.done} ripubblicati.`, azione: "Niente da fare." };
  }

  // ------------------------------------------------------ struttura dei dati

  const STATI = new Set(Object.keys(ETICHETTE));
  const STATI_CODA = new Set(["waiting", "working", "paused", "scheduled", "recovering", "done"]);

  /**
   * Cosa non torna in una coda salvata, rispetto a quello che si aspetta il
   * codice attuale. Non cambia niente: e' quello che mostra la diagnostica.
   */
  function controllaStruttura(coda) {
    const p = [];
    if (!coda) return p;
    if (typeof coda !== "object") return [{ codice: "non-oggetto", testo: "la coda salvata non è un oggetto" }];
    if (coda.v !== 3) p.push({ codice: "schema", testo: `schema ${coda.v ?? "assente"} (atteso 3): da migrare` });
    if (!Array.isArray(coda.items)) { p.push({ codice: "articoli", testo: "elenco degli articoli assente" }); return p; }
    if (!Array.isArray(coda.batches) || !coda.batches.length) p.push({ codice: "batch", testo: "batch assenti (coda di una versione precedente)" });
    if (!Array.isArray(coda.log)) p.push({ codice: "registro", testo: "registro assente" });
    if (coda.running && !STATI_CODA.has(coda.state)) p.push({ codice: "stato-coda", testo: `stato della sessione sconosciuto: ${String(coda.state)}` });
    const visti = new Set();
    let lavorano = 0;
    const idBatch = new Set((coda.batches || []).map((b) => b.id));
    for (const a of coda.items) {
      if (!a || !ID.test(String(a.id ?? ""))) { p.push({ codice: "id", testo: "articolo senza id valido" }); continue; }
      if (visti.has(String(a.id))) p.push({ codice: "doppione", testo: "lo stesso articolo compare due volte" });
      visti.add(String(a.id));
      if (!STATI.has(a.status)) p.push({ codice: "stato-articolo", testo: `stato dell'articolo sconosciuto: ${String(a.status)}` });
      if (a.status === "working") lavorano++;
      if (a.status === "working" && !coda.running) p.push({ codice: "lavoro-orfano", testo: "articolo «in elaborazione» in una sessione chiusa" });
      if (a.status === "pending" && (a.fase || a.annullaRichiesto || a.scheda != null)) p.push({ codice: "residui", testo: "articolo in attesa con tracce di un tentativo precedente" });
      if (idBatch.size && a.batch && !idBatch.has(a.batch)) p.push({ codice: "batch-mancante", testo: "articolo assegnato a una batch che non esiste" });
    }
    if (lavorano > 1) p.push({ codice: "piu-correnti", testo: `${lavorano} articoli «in elaborazione» insieme` });
    if (coda.running && !Number.isFinite(Number(coda.intervalMin))) p.push({ codice: "intervallo", testo: "intervallo non valido" });
    return p;
  }

  /**
   * Riparazione mirata: porta la coda alla struttura attuale senza perdere
   * articoli, esiti, batch o registro. Nel dubbio si sceglie lo stato prudente:
   * un «in elaborazione» che non puo' esserlo diventa «da verificare», mai
   * «in attesa» (potrebbe essere gia' stato pubblicato).
   */
  function riparaStruttura(coda, ora = Date.now()) {
    if (!coda || typeof coda !== "object") return { coda: null, correzioni: coda ? ["coda illeggibile: scartata"] : [] };
    const c = migra(clona(coda));
    const correzioni = [];
    if (!Array.isArray(c.items)) { c.items = []; correzioni.push("elenco degli articoli ricreato vuoto"); }
    if (!Array.isArray(c.log)) { c.log = []; correzioni.push("registro ricreato"); }
    conBatch(c);
    const idBatch = new Set(c.batches.map((b) => b.id));
    const visti = new Set();
    let giaInCorso = null;
    c.items = c.items.filter((a) => {
      const id = String(a?.id ?? "");
      if (!ID.test(id)) { correzioni.push("tolto un articolo senza id valido"); return false; }
      if (visti.has(id)) { correzioni.push(`tolto un doppione dell'articolo ${id}`); return false; }
      visti.add(id);
      a.id = id;
      return true;
    });
    for (const a of c.items) {
      if (!STATI.has(a.status)) {
        const nuovo = a.startedAt ? "verify" : "cancelled";
        correzioni.push(`stato «${String(a.status)}» sconosciuto → «${ETICHETTE[nuovo]}»`);
        Object.assign(a, { status: nuovo, finishedAt: a.finishedAt || ora, error: a.error || "stato non riconosciuto, sistemato dalla riparazione", attendeEsito: false });
      }
      if (a.status === "working") {
        if (!c.running || giaInCorso) {
          correzioni.push(`«in elaborazione» non possibile → «da verificare» (${a.title || a.id})`);
          Object.assign(a, { status: "verify", finishedAt: ora, categoria: "incerto", sicuro: "no", attendeEsito: true,
            error: "Trovato «in elaborazione» in uno stato che non lo permette: potrebbe essere stato pubblicato, verificalo prima di riprovare." });
        } else giaInCorso = a;
      }
      if (a.status === "pending" && (a.fase || a.annullaRichiesto || a.scheda != null)) {
        Object.assign(a, AZZERA_LAVORO);
        correzioni.push(`tolte le tracce di un tentativo precedente da un articolo in attesa (${a.title || a.id})`);
      }
      if (!a.batch || !idBatch.has(a.batch)) {
        if (a.batch) correzioni.push(`articolo riassegnato alla ${c.batches[0].nome}: la sua batch non esiste`);
        a.batch = c.batches[0].id;
      }
    }
    if (c.running && !STATI_CODA.has(c.state)) { correzioni.push(`stato della sessione «${String(c.state)}» → «in attesa di te»`); c.state = "recovering"; c.nextAt = null; }
    if (!Number.isFinite(Number(c.intervalMin))) { c.intervalMin = 20; correzioni.push("intervallo riportato a 20 minuti"); }
    if (correzioni.length) registra(c, "recupero", `Riparazione dei dati della coda: ${correzioni.length} ${correzioni.length === 1 ? "correzione" : "correzioni"}.`, {}, ora);
    return { coda: c, correzioni };
  }

  // ---------------------------------------------------- archivio ed esportazione

  /** Copia compatta per l'archivio delle sessioni. */
  function perArchivio(coda, ora = Date.now()) {
    const r = conta(coda);
    return {
      v: 3,
      startedAt: coda.startedAt,
      finishedAt: coda.finishedAt || ora,
      note: coda.note || null,
      auto: Boolean(coda.auto),
      modello: coda.modello || null,
      intervalMin: coda.intervalMin,
      overrides: coda.overrides || null,
      batches: (coda.batches || []).map(({ id, n, nome, overrides, campi, modello, creataAt, rev, storico }) => ({ id, n, nome, overrides, campi, modello, creataAt, rev, storico: storico || [] })),
      conteggi: r,
      items: (coda.items || []).map(({ id, title, status, error, thumb, price, categoria, sicuro, motivoSalto, tentativi, addedAt, startedAt, finishedAt, batch, regole, fase, invioAt, traccia, attendeEsito, nuovoId, verificato }) =>
        ({ id: String(id), title: title || null, status, error: error || null, thumb: thumb || null, price: price ?? null,
          categoria: categoria || null, sicuro: sicuro || null, motivoSalto: motivoSalto || null, tentativi: tentativi || 0,
          addedAt: addedAt || null, startedAt: startedAt || null, finishedAt: finishedAt || null,
          batch: batch || null, regole: regole || null, fase: fase || null, invioAt: invioAt || null, traccia: traccia || null,
          attendeEsito: Boolean(attendeEsito), nuovoId: nuovoId || null, verificato: verificato || null })),
      log: (coda.log || []).slice(-MAX_REGISTRO_ARCHIVIO),
    };
  }

  /** Da una sessione passata: cosa si puo' rimettere in una coda nuova, e cosa no. */
  function daRiprendere(sessione) {
    const riprendibili = [];
    const esclusi = [];
    for (const a of sessione?.items || []) {
      if (a.status === "cancelled" || a.status === "interrupted" || (a.status === "error" && a.sicuro !== "no")) riprendibili.push(a);
      else if (a.status === "pending" || a.status === "working") riprendibili.push(a);
      else esclusi.push({ id: a.id, title: a.title, motivo: {
        done: "già ripubblicato", verify: "esito da verificare", removed: "rimosso da te", skipped: "saltato", error: "riprovare non serve",
      }[a.status] || a.status });
    }
    return { riprendibili, esclusi };
  }

  const durata = (a) => (a.startedAt && a.finishedAt ? Math.round((a.finishedAt - a.startedAt) / 1000) : null);
  const iso = (t) => (t ? new Date(t).toISOString() : "");

  /** CSV con protezione dalle formule: una cella che inizia con = + - @ viene neutralizzata. */
  function cella(v) {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function esportaCSV(sessione) {
    const intestazione = ["sessione", "ordine", "id", "titolo", "batch", "stato", "categoria_errore", "errore", "riprovare", "tentativi", "aggiunto", "iniziato", "finito", "durata_s"];
    const righe = (sessione?.items || []).map((a, i) => [
      iso(sessione.startedAt), i + 1, a.id, a.title, batchDi(sessione, a)?.nome || "", ETICHETTE[a.status] || a.status, ETICHETTE_CATEGORIA[a.categoria] || a.categoria || "",
      a.error || "", a.sicuro || "", a.tentativi || 0, iso(a.addedAt), iso(a.startedAt), iso(a.finishedAt), durata(a) ?? "",
    ]);
    return [intestazione, ...righe].map((r) => r.map(cella).join(",")).join("\r\n");
  }

  function esportaJSON(sessione, versione = "") {
    return {
      formato: "vinted-relist-sessione",
      versione: String(versione),
      sessione: {
        inizio: iso(sessione?.startedAt), fine: iso(sessione?.finishedAt), stato: sessione?.running ? sessione.state : "conclusa",
        intervalloMin: sessione?.intervalMin ?? null, modello: sessione?.modello || null, automatica: Boolean(sessione?.auto), note: sessione?.note || null,
        conteggi: conta(sessione),
        batch: (sessione?.batches || []).map((b) => ({ id: b.id, nome: b.nome, regole: b.overrides || null, revisione: b.rev || 1, modello: b.modello || null })),
      },
      articoli: (sessione?.items || []).map((a, i) => ({
        ordine: i + 1, id: a.id, titolo: a.title, batch: a.batch || null, stato: a.status, nuovoId: a.nuovoId || null, errore: a.error || null, categoria: a.categoria || null,
        riprovare: a.sicuro || null, tentativi: a.tentativi || 0, aggiunto: iso(a.addedAt) || null, iniziato: iso(a.startedAt) || null,
        finito: iso(a.finishedAt) || null, durataSecondi: durata(a),
      })),
      eventi: (sessione?.log || []).map((e) => ({ quando: iso(e.at), tipo: e.tipo, natura: e.natura, id: e.id || null, testo: e.testo, esito: e.esito || null, azione: e.azione || null })),
    };
  }

  /** Resoconto da incollare quando chiedi aiuto: senza titoli, solo id e stati. */
  function resoconto(sessione, ora = Date.now()) {
    const r = conta(sessione);
    const s = stima(sessione, ora);
    const sal = salute(sessione);
    const minuti = (ms) => (ms == null ? "?" : `${Math.round(ms / 60000)} min`);
    const righe = [
      `Sessione del ${iso(sessione?.startedAt)} — ${sessione?.running ? `in corso (${sessione.state})` : "conclusa"}`,
      `Stato: ${sal.titolo}. ${sal.perche}`,
      `Articoli: ${r.totale} · completati ${r.done} · falliti ${r.error} · da verificare ${r.verify} · interrotti ${r.interrupted} · in attesa ${r.pending} · in corso ${r.working} · saltati ${r.skipped} · annullati ${r.cancelled} · rimossi ${r.removed}`,
      `Batch: ${(sessione?.batches || []).length || 1}`,
      `Tempo trascorso: ${minuti(s.trascorsoMs)}${sessione?.running ? ` · rimanente stimato: ${minuti(s.rimanenteMs)}` : ""}`,
      "",
      "Problemi:",
    ];
    const problemi = (sessione?.items || []).filter((a) => ["error", "verify", "interrupted"].includes(a.status));
    if (!problemi.length) righe.push("  nessuno");
    for (const a of problemi) righe.push(`  ${a.id} — ${ETICHETTE[a.status]} · ${ETICHETTE_CATEGORIA[a.categoria] || a.categoria || "?"} · riprovare: ${a.sicuro || "?"} · ${String(a.error || "").replace(/https?:\/\/\S+/g, "[url]").slice(0, 160)}`);
    return righe.join("\n");
  }

  const api = {
    VERSIONE, ETICHETTE, ICONE, TERMINALI, ETICHETTE_CATEGORIA, MAX_ARTICOLI, SOGLIA_PRUDENZA, MAX_BATCH,
    controllaStruttura, riparaStruttura,
    nuova, migra, registra, trova, corrente, prossimo, inAttesa, posizione, conta, daChiudere,
    valutaAggiunta, aggiungi, rimuovi, annullaCorrente, sposta, riordina, riprova, risolvi,
    avviaArticolo, concludiArticolo, classificaErrore, stima, salute,
    pulisciOverrides, pulisciCampi, trovaBatch, batchDi, overridesDi, riepilogoBatch, modificaBatch,
    ripubblicaOra, rimettiDopoInterruzione, confermaInvio, assegnaScheda, annotaTraccia, esitoTardivo, valutaVerifica, esitoDaVerdetto, applicaVerifica,
    perArchivio, daRiprendere, esportaCSV, esportaJSON, resoconto,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CodaLogica = api;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
