/**
 * Modello della coda di ripubblicazione: stati, transizioni, stime, salute,
 * classificazione degli errori, esportazione. Funzioni pure: nessun chrome.*,
 * nessun DOM, nessuna rete. Le usa il service worker (che e' l'UNICO a scrivere
 * la coda, una modifica alla volta), le leggono popup, dashboard e pagina.
 *
 * Forma della coda (v: 3):
 *   { v, startedAt, finishedAt, running, state, nextAt, intervalMin, overrides,
 *     modello, backoff, erroriDiFila, motivoPausa, pausaAuto, riprendiAlle,
 *     pausaDopoCorrente, note, auto, items: [Articolo], log: [Evento] }
 *   Articolo: { id, title, thumb, price, status, error, categoria, sicuro,
 *     motivoSalto, tentativi, addedAt, startedAt, finishedAt, annullaRichiesto }
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
  const ETICHETTE = {
    pending: "In attesa",
    working: "In elaborazione",
    done: "Completato",
    error: "Fallito",
    verify: "Da verificare",
    skipped: "Saltato",
    cancelled: "Annullato",
    removed: "Rimosso",
  };
  const ICONE = { pending: "◷", working: "▶", done: "✓", error: "✕", verify: "?", skipped: "↷", cancelled: "⊘", removed: "–" };
  const TERMINALI = new Set(["done", "error", "verify", "skipped", "cancelled", "removed"]);

  const MAX_ARTICOLI = 500;
  const MAX_REGISTRO = 300;
  const MAX_REGISTRO_ARCHIVIO = 200;
  const SOGLIA_PRUDENZA = 3;        // esiti negativi di fila prima di fermarsi da soli

  const ID = /^\d{1,20}$/;
  const CDN = /^https:\/\/[a-z0-9.-]*vinted\.(net|com)\//i;

  const clona = (x) => JSON.parse(JSON.stringify(x));

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
    const r = { pending: 0, working: 0, done: 0, error: 0, verify: 0, skipped: 0, cancelled: 0, removed: 0 };
    for (const v of coda?.items || []) r[v.status] = (r[v.status] || 0) + 1;
    r.totale = (coda?.items || []).length - r.removed;           // i rimossi non sono "della sessione"
    r.rimanenti = r.pending + r.working;
    r.trattati = r.done + r.error + r.verify + r.skipped + r.cancelled;
    return r;
  }

  /** Coda attiva senza piu' niente da fare: va chiusa. */
  const daChiudere = (coda) => Boolean(coda?.running && !corrente(coda) && !prossimo(coda));

  // ---------------------------------------------------------------- creazione

  function nuova({ items = [], intervalMin = 20, overrides = null, startAt = 0, ora = Date.now(), auto = false, note = null, modello = null } = {}) {
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
      overrides: overrides || null,
      modello: modello ? String(modello).slice(0, 60) : null,
      backoff: 0,
      erroriDiFila: 0,
      motivoPausa: null,
      pausaAuto: false,
      riprendiAlle: null,
      pausaDopoCorrente: false,
      note,
      auto: Boolean(auto),
      items: articoli,
      log: [],
    };
    registra(coda, "creata", `Coda creata con ${articoli.length} articoli${modello ? ` (modello «${coda.modello}»)` : ""}.`, {}, ora);
    return { coda, saltati };
  }

  /** Coda salvata da una versione precedente (con l'indice): la porto al modello per id. */
  function migra(coda) {
    if (!coda || coda.v === 3) return coda;
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
    return c;
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

  function aggiungi(coda, items, { dove = "fondo" } = {}, ora = Date.now()) {
    if (!coda?.running) return { ok: false, motivo: "Nessuna coda attiva: avviane una nuova.", aggiunti: [], riattivati: [], rifiutati: [] };
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
        if (precedente === "error") a.tentativi = (a.tentativi || 0) + 1;
        Object.assign(a, { status: "pending", error: null, categoria: null, sicuro: null, motivoSalto: null, startedAt: null, finishedAt: null, annullaRichiesto: false });
        riattivati.push({ articolo: a, precedente });
      }
    }

    const daCollocare = [...nuovi, ...riattivati.map((r) => r.articolo)];
    if (daCollocare.length) collocaInAttesa(coda, daCollocare, dove);
    for (const a of nuovi) registra(coda, "aggiunto", `Aggiunto ${dove === "cima" ? "in cima" : "in fondo"}: ${a.title}`, { id: a.id }, ora);
    for (const r of riattivati) registra(coda, "aggiunto", `Rimesso in coda (era «${ETICHETTE[r.precedente]}»): ${r.articolo.title}`, { id: r.articolo.id }, ora);

    return { ok: true, aggiunti: nuovi.map((a) => a.id), riattivati: riattivati.map((r) => r.articolo.id), rifiutati };
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

  // ------------------------------------------------------- esiti e verifiche

  /** Solo i falliti con un errore per cui riprovare ha senso. Mai i "da verificare". */
  function riprova(coda, ids, ora = Date.now()) {
    const rimessi = [];
    const rifiutati = [];
    for (const id of new Set((ids || []).map(String))) {
      const a = trova(coda, id);
      if (!a) { rifiutati.push({ id, motivo: "non è in questa coda" }); continue; }
      if (a.status === "verify") { rifiutati.push({ id, motivo: "esito incerto: conferma prima se è stato pubblicato" }); continue; }
      if (a.status !== "error") { rifiutati.push({ id, motivo: `è «${ETICHETTE[a.status]}»` }); continue; }
      if (a.sicuro === "no") { rifiutati.push({ id, motivo: `riprovare non serve: ${a.error || "errore definitivo"}` }); continue; }
      rimessi.push(a);
    }
    if (!rimessi.length) return { ok: false, rimessi: [], rifiutati };
    for (const a of rimessi) {
      a.tentativi = (a.tentativi || 0) + 1;
      a.ultimoErrore = a.error;
      Object.assign(a, { status: "pending", error: null, categoria: null, sicuro: null, startedAt: null, finishedAt: null, annullaRichiesto: false });
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
    registra(coda, "verificato", `${pubblicato ? "Confermato pubblicato" : "Confermato non uscito"}: ${a.title}`, { id: a.id, esito: pubblicato ? "done" : "error" }, ora);
    return { ok: true };
  }

  function avviaArticolo(coda, id, ora = Date.now()) {
    const a = trova(coda, id);
    if (!a || a.status !== "pending" || corrente(coda)) return { ok: false };
    a.status = "working";
    a.startedAt = ora;
    a.annullaRichiesto = false;
    registra(coda, "inizio", `In elaborazione: ${a.title}`, { id: a.id }, ora);
    return { ok: true, articolo: a };
  }

  /**
   * Esito di un articolo. Vale solo per l'articolo in elaborazione: un esito
   * arrivato tardi (dopo un watchdog o un recupero) non deve riscrivere niente.
   * esito: { ok, outcome: error|uncertain|partial|skipped|cancelled, error, categoria, sicuro, motivoSalto }
   */
  function concludiArticolo(coda, id, esito = {}, ora = Date.now()) {
    const a = trova(coda, id);
    if (!a || a.status !== "working") return { ok: false, ignorato: true };

    const stato = esito.ok ? "done"
      : esito.outcome === "uncertain" || esito.outcome === "partial" ? "verify"
      : esito.outcome === "skipped" ? "skipped"
      : esito.outcome === "cancelled" ? "cancelled"
      : "error";

    a.status = stato;
    a.finishedAt = ora;
    a.error = esito.ok ? null : String(esito.error || (stato === "cancelled" ? "annullato prima dell'invio a Vinted" : "errore sconosciuto")).slice(0, 300);
    a.categoria = esito.ok ? null : esito.categoria || (stato === "verify" ? "incerto" : null);
    a.sicuro = esito.ok ? null : esito.sicuro || (stato === "verify" ? "no" : null);
    a.motivoSalto = stato === "skipped" ? esito.motivoSalto || "manuale" : null;
    a.annullaRichiesto = false;

    // Modalita' prudente: falliti e incerti di fila. Un successo azzera.
    if (stato === "done") coda.erroriDiFila = 0;
    else if (stato === "error" || stato === "verify") coda.erroriDiFila = (coda.erroriDiFila || 0) + 1;

    const tipo = { done: "completato", error: "fallito", verify: "incerto", skipped: "saltato", cancelled: "annullato" }[stato];
    const testi = {
      done: `Ripubblicato: ${a.title}`,
      error: `Non riuscito: ${a.title} — ${a.error}`,
      verify: `Esito incerto: ${a.title} — ${a.error}`,
      skipped: `Saltato: ${a.title}${a.error ? ` — ${a.error}` : ""}`,
      cancelled: `Annullato prima dell'invio: ${a.title}`,
    };
    const azioni = {
      error: a.sicuro === "no" ? "riprovare non serve" : a.sicuro === "dopo-correzione" ? "correggi con Modifica, poi riprova" : "puoi riprovarlo",
      verify: "controlla nell'armadio, poi conferma l'esito",
    };
    registra(coda, tipo, testi[stato], { id: a.id, esito: stato, ...(azioni[stato] ? { azione: azioni[stato] } : {}) }, ora);

    const prudenza = (stato === "error" || stato === "verify") && coda.erroriDiFila >= SOGLIA_PRUDENZA;
    return { ok: true, stato, articolo: a, prudenza };
  }

  // ------------------------------------------------------------ classificazione

  /**
   * Errore → categoria comprensibile, cosa fare, se riprovare ha senso.
   * sicuroRiprovare: "si" | "dopo-correzione" | "no".
   */
  function classificaErrore(e = {}) {
    const status = Number(e.status) || 0;
    if (e.annullato) return { categoria: "annullato", etichetta: "Annullato", cosaFare: "Niente: non è stato inviato niente a Vinted.", sicuroRiprovare: "si" };
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
    if (r.verify) return { livello: "verificare", titolo: "Risultati da verificare", perche: `${r.verify} ${r.verify === 1 ? "esito incerto" : "esiti incerti"}.`, azione: "Apri gli articoli, guarda l'armadio e conferma l'esito." };
    if (r.error) return { livello: "attenzione", titolo: "Attenzione richiesta", perche: `${r.error} ${r.error === 1 ? "articolo fallito" : "articoli falliti"}.`, azione: "Leggi il motivo; riprova quelli per cui è sicuro." };
    if (coda.running) return { livello: "ok", titolo: "Tutto regolare", perche: "Nessun errore finora.", azione: "Niente da fare." };
    return { livello: "ok", titolo: "Sessione conclusa senza problemi", perche: `${r.done} ripubblicati.`, azione: "Niente da fare." };
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
      conteggi: r,
      items: (coda.items || []).map(({ id, title, status, error, thumb, price, categoria, sicuro, motivoSalto, tentativi, addedAt, startedAt, finishedAt }) =>
        ({ id: String(id), title: title || null, status, error: error || null, thumb: thumb || null, price: price ?? null,
          categoria: categoria || null, sicuro: sicuro || null, motivoSalto: motivoSalto || null, tentativi: tentativi || 0,
          addedAt: addedAt || null, startedAt: startedAt || null, finishedAt: finishedAt || null })),
      log: (coda.log || []).slice(-MAX_REGISTRO_ARCHIVIO),
    };
  }

  /** Da una sessione passata: cosa si puo' rimettere in una coda nuova, e cosa no. */
  function daRiprendere(sessione) {
    const riprendibili = [];
    const esclusi = [];
    for (const a of sessione?.items || []) {
      if (a.status === "cancelled" || (a.status === "error" && a.sicuro !== "no")) riprendibili.push(a);
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
    const intestazione = ["sessione", "ordine", "id", "titolo", "stato", "categoria_errore", "errore", "riprovare", "tentativi", "aggiunto", "iniziato", "finito", "durata_s"];
    const righe = (sessione?.items || []).map((a, i) => [
      iso(sessione.startedAt), i + 1, a.id, a.title, ETICHETTE[a.status] || a.status, ETICHETTE_CATEGORIA[a.categoria] || a.categoria || "",
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
      },
      articoli: (sessione?.items || []).map((a, i) => ({
        ordine: i + 1, id: a.id, titolo: a.title, stato: a.status, errore: a.error || null, categoria: a.categoria || null,
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
      `Articoli: ${r.totale} · completati ${r.done} · falliti ${r.error} · da verificare ${r.verify} · in attesa ${r.pending} · in corso ${r.working} · saltati ${r.skipped} · annullati ${r.cancelled} · rimossi ${r.removed}`,
      `Tempo trascorso: ${minuti(s.trascorsoMs)}${sessione?.running ? ` · rimanente stimato: ${minuti(s.rimanenteMs)}` : ""}`,
      "",
      "Problemi:",
    ];
    const problemi = (sessione?.items || []).filter((a) => ["error", "verify"].includes(a.status));
    if (!problemi.length) righe.push("  nessuno");
    for (const a of problemi) righe.push(`  ${a.id} — ${ETICHETTE[a.status]} · ${ETICHETTE_CATEGORIA[a.categoria] || a.categoria || "?"} · riprovare: ${a.sicuro || "?"} · ${String(a.error || "").replace(/https?:\/\/\S+/g, "[url]").slice(0, 160)}`);
    return righe.join("\n");
  }

  const api = {
    ETICHETTE, ICONE, TERMINALI, ETICHETTE_CATEGORIA, MAX_ARTICOLI, SOGLIA_PRUDENZA,
    nuova, migra, registra, trova, corrente, prossimo, inAttesa, posizione, conta, daChiudere,
    valutaAggiunta, aggiungi, rimuovi, annullaCorrente, sposta, riordina, riprova, risolvi,
    avviaArticolo, concludiArticolo, classificaErrore, stima, salute,
    perArchivio, daRiprendere, esportaCSV, esportaJSON, resoconto,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CodaLogica = api;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
