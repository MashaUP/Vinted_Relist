/**
 * Analisi dell'armadio: funzioni pure, nessun accesso al DOM ne' a chrome.*.
 * Le usa la dashboard; i test le eseguono direttamente.
 */
(function (root) {
  const GIORNO = 86400000;

  // ------------------------------------------------------------- categorie

  /**
   * Divide l'armadio in gruppi che non si sovrappongono, in quest'ordine:
   *   recenti      ripubblicati negli ultimi 7 giorni
   *   stagnanti    fermi da 21 giorni o piu'
   *   ottimizzare  punteggio di completezza sotto 70
   *   mai          mai ripubblicati dall'estensione
   *   regola       tutto il resto
   *
   * L'eta' di un articolo mai toccato si conta dal primo avvistamento: non
   * conosciamo la data vera di pubblicazione, e non la inventiamo.
   */
  function classifica(inventory, qualita = {}, ora = Date.now()) {
    const gruppi = { recenti: [], stagnanti: [], ottimizzare: [], mai: [], regola: [] };

    for (const [id, art] of Object.entries(inventory)) {
      const riferimento = art.relistedAt || art.firstSeen || ora;
      const giorni = (ora - riferimento) / GIORNO;
      const punteggio = qualita[id]?.score;

      let gruppo;
      if (art.relistedAt && giorni < 7) gruppo = "recenti";
      else if (giorni >= 21) gruppo = "stagnanti";
      else if (punteggio != null && punteggio < 70) gruppo = "ottimizzare";
      else if (!art.relistedAt) gruppo = "mai";
      else gruppo = "regola";

      gruppi[gruppo].push(id);
    }
    return gruppi;
  }

  function valoreTotale(inventory) {
    let totale = 0;
    let conPrezzo = 0;
    for (const art of Object.values(inventory)) {
      if (typeof art.price === "number" && art.price > 0) {
        totale += art.price;
        conPrezzo++;
      }
    }
    return { totale: Math.round(totale * 100) / 100, conPrezzo };
  }

  // ------------------------------------------------------------- duplicati

  function normalizza(titolo) {
    return String(titolo || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  /**
   * Coppie di articoli con titolo quasi uguale (Jaccard sulle parole) e
   * stesso prezzo, o prezzo sconosciuto. Due DVD uguali a prezzi diversi sono
   * quasi sempre due copie vere, non un relist rimasto a meta'.
   */
  function duplicati(inventory, soglia = 0.8) {
    const voci = Object.entries(inventory)
      .map(([id, art]) => ({
        id,
        art,
        parole: new Set(normalizza(art.title).split(" ").filter((p) => p.length > 1)),
      }))
      .filter((v) => v.parole.size >= 2);

    const coppie = [];
    for (let i = 0; i < voci.length; i++) {
      for (let j = i + 1; j < voci.length; j++) {
        const a = voci[i];
        const b = voci[j];

        let comuni = 0;
        for (const parola of a.parole) if (b.parole.has(parola)) comuni++;
        const somiglianza = comuni / (a.parole.size + b.parole.size - comuni);
        if (somiglianza < soglia) continue;

        const pa = a.art.price;
        const pb = b.art.price;
        if (pa != null && pb != null && Math.abs(pa - pb) > 0.01) continue;

        coppie.push({ a: a.id, b: b.id, somiglianza: Math.round(somiglianza * 100) / 100 });
      }
    }
    return coppie.sort((x, y) => y.somiglianza - x.somiglianza);
  }

  // ------------------------------------------------------------- misure

  const FASCE = [
    ["notte", 0, 6],
    ["mattina", 6, 12],
    ["pranzo", 12, 15],
    ["pomeriggio", 15, 19],
    ["sera", 19, 24],
  ];
  const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

  const fasciaDi = (quando) => {
    const ora = new Date(quando).getHours();
    return FASCE.find(([, da, a]) => ora >= da && ora < a)[0];
  };

  function visite48(serie, inizio) {
    let migliore = null;
    for (const [quando, visite] of serie || []) {
      const dopo = quando - inizio;
      if (dopo < GIORNO || dopo > 3 * GIORNO) continue;
      const distanza = Math.abs(dopo - 2 * GIORNO);
      if (!migliore || distanza < migliore.distanza) migliore = { visite, distanza };
    }
    return migliore ? migliore.visite : null;
  }

  /**
   * Per ogni ripubblicazione, le visite raccolte dal nuovo annuncio a circa
   * 48 ore. Un annuncio ripubblicato parte da zero: il valore e' il risultato
   * di quel relist e di nient'altro, quindi relist diversi si confrontano.
   */
  function misure(snapshots, inventory) {
    const risultati = [];
    for (const s of snapshots) {
      const visite = s.visite48 ?? visite48(inventory[s.new.id]?.series, s.at);
      if (visite == null) continue;
      risultati.push({
        n: s.n,
        at: s.at,
        giorno: new Date(s.at).getDay(),
        fascia: fasciaDi(s.at),
        visite,
        prezzo: s.new.price,
        prezzoPrima: s.old.price,
        oldId: s.old.id,
        newId: s.new.id,
        title: s.new.title,
      });
    }
    return risultati;
  }

  /** Media per gruppo, solo dove ci sono abbastanza misure per dire qualcosa. */
  function perGruppo(elenco, chiave, minimo) {
    const gruppi = {};
    for (const m of elenco) (gruppi[m[chiave]] ||= []).push(m.visite);
    return Object.entries(gruppi)
      .map(([k, valori]) => ({
        chiave: k,
        n: valori.length,
        media: Math.round((valori.reduce((a, b) => a + b, 0) / valori.length) * 10) / 10,
      }))
      .filter((g) => g.n >= minimo)
      .sort((a, b) => b.media - a.media);
  }

  function andamento(elenco, minimo = 3) {
    return {
      totale: elenco.length,
      giorni: perGruppo(elenco, "giorno", minimo).map((g) => ({ ...g, nome: GIORNI[g.chiave] })),
      fasce: perGruppo(elenco, "fascia", minimo).map((g) => ({ ...g, nome: g.chiave })),
    };
  }

  /** Le ripubblicazioni successive dello stesso oggetto, collegate per id. */
  function catene(snapshots) {
    const perNuovo = {};
    const successivo = {};
    for (const s of snapshots) {
      perNuovo[s.new.id] = s;
      successivo[s.old.id] = s;
    }

    const risultato = [];
    for (const s of snapshots) {
      if (perNuovo[s.old.id]) continue;            // non e' l'inizio di una catena
      const catena = [];
      const visti = new Set();
      let corrente = s;
      while (corrente && !visti.has(corrente.n)) {
        visti.add(corrente.n);
        catena.push(corrente);
        corrente = successivo[corrente.new.id];
      }
      risultato.push(catena);
    }
    return risultato;
  }

  /**
   * Cosa ha funzionato per un singolo articolo. Sotto le tre misure non
   * consigliamo niente: con due punti qualunque differenza e' rumore.
   */
  function consiglioArticolo(catena, inventory, minimo = 3) {
    const elenco = misure(catena, inventory);
    if (elenco.length < minimo) {
      return { sufficiente: false, misure: elenco, mancano: minimo - elenco.length };
    }

    const ordinati = [...elenco].sort((a, b) => b.visite - a.visite);
    const meta = ordinati.slice(0, Math.ceil(ordinati.length / 2));
    const prezzi = meta.map((m) => m.prezzo).filter((p) => typeof p === "number");

    const migliore = ordinati[0];
    const prezzoInvariato = elenco.filter((m) => m.prezzo === m.prezzoPrima);
    const prezzoCambiato = elenco.filter((m) => m.prezzo !== m.prezzoPrima);
    const media = (xs) => xs.reduce((a, m) => a + m.visite, 0) / xs.length;

    let sulPrezzo = null;
    if (prezzoInvariato.length >= 2 && prezzoCambiato.length >= 2) {
      sulPrezzo = media(prezzoInvariato) >= media(prezzoCambiato) ? "invariato" : "variato";
    }

    return {
      sufficiente: true,
      misure: elenco,
      giorno: GIORNI[migliore.giorno],
      fascia: migliore.fascia,
      prezzoMin: prezzi.length ? Math.min(...prezzi) : null,
      prezzoMax: prezzi.length ? Math.max(...prezzi) : null,
      sulPrezzo,
    };
  }

  const api = {
    classifica,
    valoreTotale,
    duplicati,
    normalizza,
    misure,
    andamento,
    catene,
    consiglioArticolo,
    visite48,
    GIORNI,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Analisi = api;
})(typeof window !== "undefined" ? window : globalThis);
