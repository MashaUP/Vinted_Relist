/**
 * Foto in attesa delle importazioni da Vintory (2.5.0): IndexedDB dell'estensione,
 * MAI chrome.storage (lo spazio pieno ha gia' fermato la coda nella 2.3.0).
 *
 * Database «vintoryImport», archivio «annunci», una voce per annuncio importato:
 *   { chiave: "vintory:<id>:<impronta>", id, at, titolo, sorgente, foto: [{ blob, tipo, sha256 }] }
 * La scrive la dashboard quando metti gli annunci in coda; la legge il service
 * worker, che passa le foto alla scheda di Vinted una alla volta e cancella le
 * voci che non servono piu' (pubblicate, tolte dalla coda, vecchie).
 * Stessa origine (chrome-extension://) per dashboard e service worker.
 */
(function (root) {
  "use strict";

  const NOME = "vintoryImport";
  const ARCHIVIO = "annunci";
  let aperto = null;

  const promessa = (req) => new Promise((ok, ko) => { req.onsuccess = () => ok(req.result); req.onerror = () => ko(req.error); });

  function apri() {
    if (aperto) return aperto;
    aperto = new Promise((ok, ko) => {
      const req = indexedDB.open(NOME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ARCHIVIO)) db.createObjectStore(ARCHIVIO, { keyPath: "chiave" });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); aperto = null; };
        ok(db);
      };
      req.onerror = () => { aperto = null; ko(req.error); };
      req.onblocked = () => { aperto = null; ko(new Error("Archivio delle foto bloccato da un'altra pagina dell'estensione: chiudila e riprova.")); };
    });
    return aperto;
  }

  async function transazione(modo, lavoro) {
    const db = await apri();
    const tx = db.transaction(ARCHIVIO, modo);
    const store = tx.objectStore(ARCHIVIO);
    const risultato = await lavoro(store);
    await new Promise((ok, ko) => { tx.oncomplete = ok; tx.onerror = () => ko(tx.error); tx.onabort = () => ko(tx.error || new Error("transazione annullata")); });
    return risultato;
  }

  const api = {
    /** Salva (o sostituisce) un'importazione. */
    salva: (voce) => transazione("readwrite", (s) => promessa(s.put(voce))),
    /** La voce senza le foto (sorgente, numero di foto). */
    async leggi(chiave) {
      const v = await transazione("readonly", (s) => promessa(s.get(chiave)));
      if (!v) return null;
      return { chiave: v.chiave, id: v.id, at: v.at, titolo: v.titolo, sorgente: v.sorgente, foto: (v.foto || []).map((f) => ({ tipo: f.tipo, sha256: f.sha256, size: f.blob?.size || 0 })) };
    },
    /** La foto i-esima (Blob), o null. */
    async foto(chiave, i) {
      const v = await transazione("readonly", (s) => promessa(s.get(chiave)));
      return v?.foto?.[i]?.blob || null;
    },
    esiste: async (chiave) => Boolean(await transazione("readonly", (s) => promessa(s.getKey(chiave)))),
    elimina: (chiave) => transazione("readwrite", (s) => promessa(s.delete(chiave))),
    /** Elenco leggero: chiave, id, data, numero di foto e byte. */
    async elenco() {
      const tutte = await transazione("readonly", (s) => promessa(s.getAll()));
      return tutte.map((v) => ({ chiave: v.chiave, id: v.id, at: v.at, foto: (v.foto || []).length, byte: (v.foto || []).reduce((t, f) => t + (f.blob?.size || 0), 0) }));
    },
  };

  root.VintoryDB = api;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
