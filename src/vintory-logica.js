/**
 * «Ripubblica da Vintory» (2.5.0): lettura e controllo delle esportazioni
 * «Per Vinted_Relist» di Vintory (formato «vintory-relist», schema 2; contratto
 * in docs/RELIST_BRIDGE.md del repository MashaUP/Vintory).
 *
 * Funzioni pure: niente chrome.*, niente DOM, niente rete. Le usano la
 * dashboard (anteprima), il service worker (registro, pulizia delle foto) e i test.
 *
 * Il file di Vintory e' un dato non attendibile: ogni campo si controlla, i
 * campi sconosciuti si ignorano, nel dubbio l'annuncio resta fuori con il motivo.
 */
(function (root) {
  "use strict";

  const FORMATO = "vintory-relist";
  const SCHEMA = 2;
  const ID = /^\d{1,20}$/;
  const SHA = /^[0-9a-f]{64}$/;
  const CHIAVE = /^vintory:\d{1,20}:[0-9a-f]{16}$/;
  const TIPI_FOTO = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_ANNUNCI = 500;
  const MAX_FOTO = 20;
  /** Foto di un'importazione non piu' in coda: dopo quanto si cancellano comunque. */
  const CONSERVA_GIORNI = 30;
  /** Un'importazione appena salvata, non ancora arrivata in coda, non si tocca. */
  const MARGINE_MS = 15 * 60_000;

  /** Campi che in Vintory cambiano il nome ma non l'id che riceve Vinted. */
  const CAMPI_CON_ID = { brand: "Marca", size: "Taglia", colors: "Colori", condition: "Condizioni", category: "Categoria" };

  const testo = (v, max = 5000) => (typeof v === "string" ? v.slice(0, max) : v == null ? null : String(v).slice(0, max));
  const clona = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const importo = (p) => {
    const n = Number(typeof p === "object" && p ? p.amount ?? p.value : p);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };

  /** Il JSON in cima allo ZIP: formato e schema prima di tutto. */
  function leggiPacchetto(json) {
    if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, errore: "vintory-relist.json non è leggibile." };
    if (json.format !== FORMATO) {
      return { ok: false, errore: json.format === "vintory-backup"
        ? "Questo è un backup completo di Vintory, non un'esportazione per Vinted_Relist: in Vintory usa «Per Vinted_Relist»."
        : "Non è un'esportazione «Per Vinted_Relist» di Vintory." };
    }
    const schema = Number(json.schema);
    if (!Number.isInteger(schema) || schema < SCHEMA) {
      return { ok: false, errore: "Esportazione di una versione vecchia di Vintory (1.0.x): aggiorna Vintory ed esporta di nuovo." };
    }
    if (schema > SCHEMA) {
      return { ok: false, errore: `Esportazione di una versione di Vintory più nuova (schema ${schema}): aggiorna Vinted_Relist.` };
    }
    if (!Array.isArray(json.listings)) return { ok: false, errore: "Nell'esportazione non c'è l'elenco degli annunci." };
    if (json.listings.length > MAX_ANNUNCI) return { ok: false, errore: `Troppi annunci in un file (${json.listings.length}, massimo ${MAX_ANNUNCI}): esportane meno alla volta.` };
    return { ok: true, app: testo(json.app, 60), exportedAt: testo(json.exportedAt, 40), annunci: json.listings };
  }

  /** Testo da cui si ricava l'impronta (id + sha256 delle foto in ordine): la calcola chi chiama. */
  const testoImpronta = (l) => `${l?.vintedId}|${(Array.isArray(l?.photos) ? l.photos : []).map((f) => f?.sha256 || "").join(",")}`;
  const chiave = (id, impronta) => `vintory:${id}:${String(impronta).slice(0, 16)}`;

  /**
   * Controlli che non chiedono niente a Vinted. contesto:
   *   nomi: Set dei file nello ZIP; userId: account collegato (dal cookie, scritto dal service worker);
   *   registro: vintoryOrigine; coda: vrQueue; archivio: vrQueueArchive.
   * Le foto si verificano dopo (sha256), lo stato su Vinted dopo ancora.
   */
  function valuta(l, { nomi = new Set(), userId = null, registro = {}, coda = null, archivio = [] } = {}) {
    const id = String(l?.vintedId ?? "").trim();
    const draft = l?.uploadDraft && typeof l.uploadDraft === "object" && !Array.isArray(l.uploadDraft) ? l.uploadDraft : null;
    const v = {
      id,
      titolo: testo(l?.title, 200) || testo(draft?.title, 200) || `Annuncio ${id}`,
      prezzo: importo(l?.price) ?? importo(draft?.price),
      valuta: testo(l?.currency, 5) || testo(draft?.currency, 5) || "EUR",
      categoria: testo(l?.category, 120), condizione: testo(l?.condition, 60), marca: testo(l?.brand, 80), taglia: testo(l?.size, 40),
      online: ["online", "sold", "offline", "unknown"].includes(l?.online) ? l.online : null,
      origine: testo(l?.origin, 60),
      foto: [], fotoMancanti: Math.max(0, Number(l?.photosMissing) || 0),
      campiCambiati: [], blocchi: [], avvisi: [],
      gia: null, inCoda: null,
    };
    if (!ID.test(id)) { v.blocchi.push("Identificatore dell'annuncio non valido."); return v; }

    // Proprietario: nel dubbio, niente.
    const seller = l?.sellerId != null ? String(l.sellerId) : null;
    if (!userId) v.blocchi.push("Account Vinted non riconosciuto: apri Vinted da loggato e riapri il file.");
    else if (!seller) v.blocchi.push("Vintory non sa di chi è questo annuncio: per sicurezza non si ripubblica.");
    else if (seller !== String(userId)) v.blocchi.push("È di un altro account Vinted: si ripubblicano solo i tuoi annunci.");

    if (!draft) v.blocchi.push("Mancano i dati del modulo di vendita (Vintory non li ha mai letti): in Vintory apri l'annuncio, «Aggiorna da Vinted», ed esporta di nuovo.");
    else if (draft.id != null && String(draft.id) !== id) v.blocchi.push("Dati incoerenti nel file (l'annuncio e il modulo di vendita hanno id diversi).");
    if (v.prezzo == null) v.blocchi.push("Prezzo mancante o non valido.");
    if (v.online === "sold") v.blocchi.push("Venduto (secondo Vintory).");
    if (v.origine && !/^https:\/\/www\.vinted\.[a-z.]{2,6}$/.test(v.origine)) v.blocchi.push("Dominio di Vinted non riconosciuto.");

    // Foto: tutte quelle elencate devono esserci, nell'ordine, nel posto giusto.
    const foto = Array.isArray(l?.photos) ? l.photos : [];
    if (!foto.length) v.blocchi.push("Nessuna foto nell'esportazione: Vinted non accetta un annuncio senza foto.");
    if (foto.length > MAX_FOTO) v.blocchi.push(`Troppe foto (${foto.length}, massimo ${MAX_FOTO}).`);
    foto.slice(0, MAX_FOTO).forEach((f, i) => {
      const file = String(f?.file || "");
      const tipo = String(f?.type || "image/jpeg").toLowerCase();
      if (!file.startsWith(`photos/${id}/`) || file.includes("..")) v.blocchi.push(`Foto ${i + 1}: percorso non valido.`);
      else if (!nomi.has(file)) v.blocchi.push(`Foto ${i + 1} mancante nello ZIP (${file}).`);
      if (!TIPI_FOTO.has(tipo)) v.blocchi.push(`Foto ${i + 1}: formato non supportato (${tipo}).`);
      if (!SHA.test(String(f?.sha256 || "").toLowerCase())) v.blocchi.push(`Foto ${i + 1}: manca l'impronta sha256, non si può verificare.`);
      v.foto.push({ file, tipo, sha256: String(f?.sha256 || "").toLowerCase(), larghezza: Number(f?.width) || null, altezza: Number(f?.height) || null });
    });
    if (v.fotoMancanti) v.avvisi.push(`${v.fotoMancanti} ${v.fotoMancanti === 1 ? "foto non era" : "foto non erano"} nell'archivio di Vintory: si pubblica con ${foto.length}.`);

    // Nomi cambiati a mano in Vintory: Vinted riceve l'id vecchio. Non si indovina.
    const cambiati = (Array.isArray(l?.editedFields) ? l.editedFields : []).filter((c) => c in CAMPI_CON_ID);
    for (const c of cambiati) {
      v.campiCambiati.push(c);
      const valore = c === "colors" ? (Array.isArray(l?.colors) ? l.colors.join(", ") : "") : testo(l?.[c], 80);
      v.avvisi.push(`${CAMPI_CON_ID[c]} cambiata a mano in Vintory${valore ? ` («${valore}»)` : ""}: Vinted riceve quella dell'annuncio originale. Correggila poi su Vinted, o lascia fuori l'annuncio.`);
    }
    const cur = testo(draft?.currency, 5) || testo(draft?.price?.currency_code, 5);
    if (cur && l?.currency && cur !== l.currency) v.avvisi.push(`Valuta diversa fra Vintory (${l.currency}) e Vinted (${cur}): si usa ${l.currency}.`);

    // Gia' ripubblicato da un file di Vintory: non si riseleziona da solo.
    const r = registro?.[id];
    if (r?.nuovoId) v.gia = { nuovoId: String(r.nuovoId), at: Number(r.at) || null };

    // Gia' in coda (questa o una passata da verificare): niente doppioni.
    const nella = (coda?.items || []).find((a) => String(a.id) === id);
    if (nella && coda?.running && ["pending", "working"].includes(nella.status)) v.inCoda = nella.status === "working" ? "è in pubblicazione adesso" : "è già in coda";
    else if (nella && nella.status === "verify") v.inCoda = "esito da verificare nella coda: conferma prima se è stato pubblicato";
    else if ((Array.isArray(archivio) ? archivio : []).some((s) => (s?.items || []).some((a) => String(a.id) === id && a.status === "verify"))) {
      v.inCoda = "esito da verificare in una sessione passata: conferma prima se è stato pubblicato";
    }
    return v;
  }

  /**
   * Lo stato su Vinted riletto adesso (sola lettura, dalla scheda di Vinted):
   *   { esito: "assente" | "online" | "venduto" | "ignoto", motivo }
   * Senza lettura (nessuna scheda aperta): "non-controllato".
   */
  function statoVinted(lettura) {
    const e = lettura?.esito;
    if (["assente", "online", "venduto", "ignoto"].includes(e)) return { esito: e, motivo: testo(lettura.motivo, 200) || null };
    return { esito: "non-controllato", motivo: "Stato su Vinted non controllato: apri una scheda di Vinted da loggato e premi «Ricontrolla»." };
  }

  const ETICHETTE_STATO = {
    assente: "Non più su Vinted",
    online: "Ancora online",
    venduto: "Venduto",
    ignoto: "Stato non chiaro",
    "non-controllato": "Non controllato",
  };

  /**
   * Cosa si puo' fare con una voce, dati controlli, foto e stato su Vinted.
   *   opzioni.copia: «ripubblica con la copia di Vintory» per uno ancora online (elimina il vecchio).
   *   opzioni.ancora: «ripubblica di nuovo» per uno gia' ripubblicato da un file di Vintory.
   * Ritorna { selezionabile, preselezionato, elimina, motivo }.
   */
  function decidi(v, stato, { copia = false, ancora = false } = {}) {
    const no = (motivo) => ({ selezionabile: false, preselezionato: false, elimina: false, motivo });
    if (v.blocchi.length) return no(v.blocchi[0]);
    if (v.inCoda) return no(`Già in coda: ${v.inCoda}.`);
    const s = stato?.esito || "non-controllato";
    if (s === "venduto") return no("Venduto su Vinted: non si ripubblica.");
    if (s === "ignoto") return no(stato.motivo || "Non riesco a capire lo stato su Vinted: per sicurezza resta fuori. Riprova più tardi.");
    if (s === "non-controllato") return no(stato?.motivo || statoVinted(null).motivo);
    if (s === "online" && !copia) return no("Ancora online su Vinted: usa «Ripubblica» normale dall'armadio, oppure scegli «ripubblica con la copia di Vintory».");
    if (v.gia && !ancora) {
      return { selezionabile: true, preselezionato: false, elimina: s === "online", motivo: `Già ripubblicato${v.gia.at ? ` il ${new Date(v.gia.at).toLocaleDateString("it-IT")}` : ""} (nuovo annuncio ${v.gia.nuovoId}): spunta «ripubblica di nuovo» solo se quello è stato eliminato.`, serveAncora: true };
    }
    return {
      selezionabile: true,
      // Nomi cambiati: lo scegli tu, non parte da solo.
      preselezionato: s === "assente" && !v.campiCambiati.length && !v.gia,
      elimina: s === "online",
      motivo: s === "online" ? "Ancora online: con la copia di Vintory il vecchio viene eliminato, come in «Ripubblica»." : null,
    };
  }

  /**
   * L'annuncio come lo legge relist(): il modulo di vendita di Vinted letto da
   * Vintory, con titolo, descrizione e prezzo della copia di Vintory (vincono).
   * user_id e' il proprietario dichiarato: relist() lo confronta con l'account.
   * Niente foto vecchie (si caricano quelle dello ZIP), niente stato dell'annuncio vecchio.
   */
  function sorgente(l) {
    const s = clona(l.uploadDraft) || {};
    for (const k of ["photos", "is_draft", "can_push_up", "promoted", "item_alert", "is_sold", "is_closed", "is_hidden", "is_reserved", "item_closing_action", "status", "user", "stats"]) delete s[k];
    const valuta = testo(l.currency, 5) || testo(s.currency, 5) || testo(s.price?.currency_code, 5) || "EUR";
    if (typeof l.title === "string" && l.title.trim()) s.title = l.title.trim().slice(0, 200);
    if (typeof l.description === "string") s.description = l.description.slice(0, 5000);
    const p = importo(l.price) ?? importo(s.price);
    s.price = { amount: p == null ? null : String(p), currency_code: valuta };
    s.currency = valuta;
    s.id = String(l.vintedId);
    s.user_id = l.sellerId != null ? String(l.sellerId) : null;
    return s;
  }

  /** Articolo per la coda (id = annuncio originale). */
  function voceCoda(v, k, { elimina = false, ancora = false } = {}) {
    return {
      id: v.id, title: v.titolo, price: v.prezzo, thumb: null,
      vintory: { chiave: k, elimina: Boolean(elimina), ancora: Boolean(ancora), foto: v.foto.length },
    };
  }

  /** Il campo vintory di un articolo che arriva da fuori: dato non attendibile. */
  function pulisciRiferimento(x) {
    if (!x || typeof x !== "object" || !CHIAVE.test(String(x.chiave || ""))) return null;
    const foto = Number(x.foto);
    return { chiave: String(x.chiave), elimina: x.elimina === true, ancora: x.ancora === true, foto: Number.isInteger(foto) && foto > 0 && foto <= MAX_FOTO ? foto : null };
  }

  /** Registro id originale → nuovo annuncio, dopo una pubblicazione da Vintory. */
  function registra(registro, { oldId, nuovoId, at = Date.now(), chiave: k = null }) {
    if (!ID.test(String(oldId)) || !ID.test(String(nuovoId))) return registro || {};
    const r = { ...(registro || {}) };
    const prima = r[oldId];
    if (prima?.nuovoId === String(nuovoId)) return r;
    r[oldId] = { nuovoId: String(nuovoId), at, impronta: k ? k.split(":")[2] : null, volte: (prima?.volte || 0) + 1 };
    return r;
  }

  /**
   * Quali importazioni (chiavi) servono ancora:
   *  - nella coda: tutto cio' che non e' concluso (in attesa, in corso, da verificare,
   *    fallito ma riprovabile, interrotto, annullato: si puo' riprovare o riprendere);
   *  - nelle sessioni passate degli ultimi CONSERVA_GIORNI: quelle riprendibili.
   * Pubblicati (e verificati), saltati, rimossi, falliti senza rimedio: le foto si cancellano.
   */
  function daConservare(coda, archivio = [], ora = Date.now()) {
    const tieni = new Set();
    const serve = (a) => a.status !== "done" && a.status !== "skipped" && a.status !== "removed" && !(a.status === "error" && a.sicuro === "no");
    for (const a of coda?.items || []) {
      const k = pulisciRiferimento(a.vintory)?.chiave;
      if (k && serve(a)) tieni.add(k);
    }
    for (const s of Array.isArray(archivio) ? archivio : []) {
      if ((s?.finishedAt || 0) < ora - CONSERVA_GIORNI * 86400e3) continue;
      for (const a of s?.items || []) {
        const k = pulisciRiferimento(a.vintory)?.chiave;
        if (k && serve(a)) tieni.add(k);
      }
    }
    return tieni;
  }

  /** Tutte le chiavi nominate da un articolo (coda e archivio), in qualunque stato. */
  function nominate(coda, archivio = []) {
    const n = new Set();
    for (const q of [coda, ...(Array.isArray(archivio) ? archivio : [])]) for (const a of q?.items || []) { const k = pulisciRiferimento(a.vintory)?.chiave; if (k) n.add(k); }
    return n;
  }

  /**
   * Le importazioni da cancellare: quelle che non servono piu'. Una che nessun
   * articolo nomina (salvata adesso, in arrivo in coda) si aspetta MARGINE_MS:
   * fra il salvataggio e l'arrivo in coda passa qualche istante.
   */
  function daCancellare(elenco, tieni, ora = Date.now(), noti = new Set()) {
    return (elenco || []).filter((r) => !tieni.has(r.chiave) && (noti.has(r.chiave) || (Number(r.at) || 0) < ora - MARGINE_MS)).map((r) => r.chiave);
  }

  /**
   * Annunci nuovi da annotare nel registro: pubblicati, e anche quelli da
   * verificare per cui Vinted ha gia' restituito l'id (esiste un annuncio nuovo).
   */
  function pubblicati(coda) {
    return (coda?.items || [])
      .filter((a) => (a.status === "done" || a.status === "verify") && a.nuovoId && pulisciRiferimento(a.vintory))
      .map((a) => ({ oldId: String(a.id), nuovoId: String(a.nuovoId), at: a.finishedAt || Date.now(), chiave: a.vintory.chiave }));
  }

  const api = {
    FORMATO, SCHEMA, CHIAVE, MAX_FOTO, CONSERVA_GIORNI, MARGINE_MS, CAMPI_CON_ID, ETICHETTE_STATO,
    leggiPacchetto, testoImpronta, chiave, valuta, statoVinted, decidi, sorgente, voceCoda,
    pulisciRiferimento, registra, daConservare, daCancellare, nominate, pubblicati,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VintoryLogica = api;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
