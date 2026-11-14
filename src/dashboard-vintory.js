/**
 * «Ripubblica da Vintory» (2.5.0), nella dashboard.
 *
 * 1. Scegli (o trascini) lo ZIP «Per Vinted_Relist» esportato da Vintory.
 * 2. Controlli senza Vinted: formato e schema, proprietario = account collegato,
 *    modulo di vendita presente, ogni foto nello ZIP con il suo sha256.
 * 3. Stato reale su Vinted, in sola lettura, dalla scheda di Vinted aperta:
 *    non esiste piu' (il caso per cui c'e' Vintory), ancora online, venduto.
 * 4. Anteprima: spunti gli annunci, poi «Aggiungi alla coda»: diventano una
 *    batch nuova con il Centro di modifica di sempre. Le foto vanno in
 *    IndexedDB (VintoryDB), mai in chrome.storage.
 *
 * Il file e' un dato non attendibile: lo legge vintory-logica.js, che
 * decide cosa e' selezionabile; qui c'e' solo l'interfaccia.
 */
(() => {
  "use strict";
  const VL = window.VintoryLogica;
  const Z = window.VintoryZip;
  const DB = window.VintoryDB;
  const C = window.CodaLogica;
  const $ = (id) => document.getElementById(id);
  const LOTTO = 8;                       // annunci per richiesta di stato alla scheda di Vinted

  /** { nome, zip, pacchetto, righe: [{ l, v, bloccoFoto, stato, chiave, scelto, copia, ancora, thumb }] } */
  let corrente = null;
  let inCorso = false;

  /** Si puo' spuntare: selezionabile, e per un gia' ripubblicato solo con «ripubblica di nuovo». */
  const spuntabile = (r) => { const d = VL.decidi(r.v, r.stato, r); return d.selezionabile && !d.serveAncora; };
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const sha256 = async (bytes) => hex(await crypto.subtle.digest("SHA-256", bytes));
  const euro = (n, v = "EUR") => (n == null ? "—" : `${Number(n).toFixed(2).replace(".", ",")} ${v === "EUR" ? "€" : v}`);
  const giorno = (t) => (t ? new Date(t).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" }) : "");

  function stato(testo, tipo = "") {
    const p = $("vintoryStato");
    p.textContent = testo || "";
    p.className = `hint ${tipo}`;
  }

  async function contesto() {
    const s = await chrome.storage.local.get({ userId: null, vintoryOrigine: {}, vrQueue: null, vrQueueArchive: [] });
    return { userId: s.userId != null ? String(s.userId) : null, registro: s.vintoryOrigine || {}, coda: s.vrQueue ? C.migra(s.vrQueue) : null, archivio: s.vrQueueArchive || [] };
  }

  /** Rifa' i controlli senza Vinted (dopo un'aggiunta alla coda, o al cambio del registro). */
  async function rivaluta() {
    if (!corrente) return;
    const ctx = await contesto();
    const nomi = new Set(corrente.zip.keys());
    for (const r of corrente.righe) {
      r.v = VL.valuta(r.l, { nomi, ...ctx });
      if (r.ripetuto) r.v.blocchi.unshift("Ripetuto nel file: si considera solo la prima volta.");
      if (r.bloccoFoto) r.v.blocchi.push(r.bloccoFoto);
      if (!spuntabile(r)) r.scelto = false;
    }
  }

  async function apri(file) {
    if (inCorso) return;
    inCorso = true;
    corrente = null;
    $("vintoryAnteprima").textContent = "";
    $("vintoryConferma").hidden = true;
    try {
      if (!/\.zip$/i.test(file?.name || "")) throw new Error("Scegli lo ZIP esportato da Vintory con «Per Vinted_Relist».");
      stato("Leggo lo ZIP…");
      const zip = await Z.leggi(file);
      const indice = zip.get("vintory-relist.json");
      if (!indice) throw new Error(zip.has("relist.json") ? "Esportazione di una versione vecchia di Vintory (1.0.x): aggiorna Vintory ed esporta di nuovo." : "Nello ZIP non c'è vintory-relist.json: non è un'esportazione «Per Vinted_Relist» di Vintory.");
      let json;
      try { json = JSON.parse(await indice.text()); } catch { throw new Error("vintory-relist.json è rovinato: esporta di nuovo da Vintory."); }
      const p = VL.leggiPacchetto(json);
      if (!p.ok) throw new Error(p.errore);

      const ctx = await contesto();
      const nomi = new Set(zip.keys());
      const visti = new Set();
      const righe = p.annunci.map((l) => {
        const v = VL.valuta(l, { nomi, ...ctx });
        const ripetuto = visti.has(v.id);
        if (ripetuto) v.blocchi.unshift("Ripetuto nel file: si considera solo la prima volta.");
        visti.add(v.id);
        return { l, v, ripetuto, bloccoFoto: null, stato: VL.statoVinted(null), chiave: null, scelto: false, copia: false, ancora: false, thumb: null };
      });
      corrente = { nome: file.name, zip, pacchetto: p, righe };

      // Foto: ognuna con il suo sha256. Una rovinata esclude l'annuncio.
      const totale = righe.reduce((t, r) => t + (r.v.blocchi.length ? 0 : r.v.foto.length), 0);
      let fatte = 0;
      for (const r of righe) {
        if (r.v.blocchi.length) continue;
        const impronte = [];
        for (const [i, f] of r.v.foto.entries()) {
          stato(`Controllo le foto: ${++fatte} di ${totale}…`);
          const byte = await zip.get(f.file).bytes();
          const h = await sha256(byte);
          impronte.push(h);
          if (h !== f.sha256) { r.bloccoFoto = `Foto ${i + 1} rovinata (l'impronta non corrisponde): annuncio escluso.`; r.v.blocchi.push(r.bloccoFoto); break; }
          if (i === 0) r.thumb = URL.createObjectURL(new Blob([byte], { type: f.tipo }));
        }
        if (!r.bloccoFoto) r.chiave = VL.chiave(r.v.id, await sha256(new TextEncoder().encode(VL.testoImpronta(r.l))));
      }
      disegna();
      await controllaVinted();
    } catch (e) {
      corrente = null;
      $("vintoryAnteprima").textContent = "";
      stato(e?.message || String(e), "error");
    } finally {
      inCorso = false;
    }
  }

  /** Stato reale su Vinted, a lotti, dalla scheda aperta (sola lettura). */
  async function controllaVinted() {
    if (!corrente) return;
    const daLeggere = corrente.righe.filter((r) => !r.v.blocchi.length && !r.v.inCoda).map((r) => r.v.id);
    if (!daLeggere.length) { stato(riepilogo()); return; }
    let errore = null;
    for (let i = 0; i < daLeggere.length; i += LOTTO) {
      stato(`Controllo su Vinted: ${Math.min(i + LOTTO, daLeggere.length)} di ${daLeggere.length}… (sola lettura)`);
      let r;
      try { r = await chrome.runtime.sendMessage({ type: "vr:vintoryStato", ids: daLeggere.slice(i, i + LOTTO) }); } catch (e) { r = { ok: false, error: e.message }; }
      if (!r?.ok) { errore = r?.error || "Controllo su Vinted non riuscito."; break; }
      for (const [id, lettura] of Object.entries(r.letture || {})) {
        const riga = corrente.righe.find((x) => x.v.id === id && !x.ripetuto);
        if (!riga) continue;
        riga.stato = VL.statoVinted(lettura);
        const d = VL.decidi(riga.v, riga.stato, riga);
        riga.scelto = d.preselezionato;
      }
      disegna();
    }
    stato(errore ? `${errore}` : riepilogo(), errore ? "error" : "");
    disegna();
  }

  function riepilogo() {
    const r = corrente?.righe || [];
    const conta = (f) => r.filter(f).length;
    const pronti = conta(spuntabile);
    return `${corrente.pacchetto.app || "Vintory"} · ${r.length} annunci: ${conta((x) => x.stato.esito === "assente")} non più su Vinted, ${conta((x) => x.stato.esito === "online")} ancora online, ${conta((x) => x.stato.esito === "venduto")} venduti, ${conta((x) => x.v.blocchi.length)} esclusi. Selezionabili: ${pronti}.`;
  }

  const ETICHETTA = { assente: "ok", online: "warn", venduto: "error", ignoto: "error", "non-controllato": "" };

  function disegna() {
    const box = $("vintoryAnteprima");
    box.textContent = "";
    if (!corrente) return;
    const righe = corrente.righe;
    const scelti = righe.filter((r) => r.scelto);
    const lista = crea("ul", { class: "vintory-list" }, righe.map((r) => {
      const d = VL.decidi(r.v, r.stato, r);
      const casella = crea("input", { type: "checkbox", "data-vintory-id": r.v.id, "aria-label": `Scegli ${r.v.titolo}`, checked: r.scelto ? "" : null, disabled: spuntabile(r) ? null : "" });
      casella.addEventListener("change", () => { r.scelto = casella.checked; disegna(); });
      const opzioni = [];
      if (!r.v.blocchi.length && !r.v.inCoda && r.stato.esito === "online") {
        const c = crea("input", { type: "checkbox", "data-vintory-copia": r.v.id, checked: r.copia ? "" : null });
        c.addEventListener("change", () => { r.copia = c.checked; r.scelto = c.checked && spuntabile(r); disegna(); });
        opzioni.push(crea("label", { class: "inline" }, c, " Ripubblica con la copia di Vintory (elimina quello online, come «Ripubblica»)"));
      }
      if (r.v.gia && !r.v.blocchi.length && !r.v.inCoda) {
        const c = crea("input", { type: "checkbox", "data-vintory-ancora": r.v.id, checked: r.ancora ? "" : null });
        c.addEventListener("change", () => { r.ancora = c.checked; r.scelto = c.checked && spuntabile(r); disegna(); });
        opzioni.push(crea("label", { class: "inline" }, c, " Ripubblica di nuovo (crea un altro annuncio uguale)"));
      }
      const note = [...new Set([...(r.v.blocchi.length ? r.v.blocchi : []), ...(d.motivo && !r.v.blocchi.includes(d.motivo) ? [d.motivo] : []), ...r.v.avvisi])];
      return crea("li", { class: `vintory-row${d.selezionabile ? "" : " is-off"}`, "data-vintory-row": r.v.id },
        casella,
        r.thumb ? crea("img", { src: r.thumb, alt: "", width: "56", height: "56", loading: "lazy" }) : crea("span", { class: "vintory-nofoto" }, "—"),
        crea("div", { class: "vintory-info" },
          crea("strong", {}, r.v.titolo),
          crea("span", { class: "hint" }, [euro(r.v.prezzo, r.v.valuta), r.v.categoria, r.v.condizione, `${r.v.foto.length} foto`].filter(Boolean).join(" · ")),
          crea("span", { class: `tag ${ETICHETTA[r.stato.esito] || ""}`, "data-vintory-stato": r.stato.esito }, VL.ETICHETTE_STATO[r.stato.esito] || r.stato.esito,
            r.v.gia ? ` · già ripubblicato il ${giorno(r.v.gia.at)}` : ""),
          note.length ? crea("ul", { class: "vintory-note" }, note.map((n) => crea("li", {}, n))) : null,
          ...opzioni));
    }));
    const pronti = righe.filter((r) => spuntabile(r) && VL.decidi(r.v, r.stato, r).preselezionato);
    metti(box,
      crea("div", { class: "btn-row vintory-bar" },
        crea("button", { class: "chip", type: "button", onclick: () => { for (const r of pronti) r.scelto = true; disegna(); } }, `Seleziona i ${pronti.length} pronti`),
        crea("button", { class: "chip", type: "button", onclick: () => { for (const r of righe) r.scelto = false; disegna(); } }, "Nessuno"),
        crea("button", { class: "chip", type: "button", onclick: () => controllaVinted() }, "Ricontrolla su Vinted"),
        crea("button", { class: "btn btn-primary", type: "button", id: "vintoryAggiungi", disabled: scelti.length ? null : "", onclick: aggiungi }, `Aggiungi alla coda (${scelti.length})`)),
      lista);
  }

  function metti(box, ...figli) {
    for (const f of figli.flat()) if (f) box.append(f);
  }

  /** Le foto in IndexedDB, poi il Centro di modifica e la coda. */
  async function aggiungi() {
    if (!corrente) return;
    const scelti = corrente.righe.filter((r) => r.scelto && r.chiave && spuntabile(r));
    if (!scelti.length) return;
    const perId = new Map(scelti.map((r) => [r.v.id, r]));
    const voce = (r) => {
      const thumb = r.l.uploadDraft?.photos?.[0]?.url;
      return { ...VL.voceCoda(r.v, r.chiave, { elimina: r.stato.esito === "online" && r.copia, ancora: Boolean(r.v.gia && r.ancora) }), thumb: /^https:\/\/[a-z0-9.-]*vinted\.(net|com)\//i.test(String(thumb || "")) ? thumb : null };
    };
    const salvate = [];
    await window.CodaUI.proponiAggiunta(scelti.map(voce), {
      box: $("vintoryConferma"),
      sempreModulo: true,
      intestazione: "Da Vintory",
      primaDiInviare: async (voci) => {
        stato("Salvo le foto per la coda…");
        for (const it of voci) {
          const r = perId.get(it.id);
          const foto = [];
          for (const f of r.v.foto) foto.push({ blob: await corrente.zip.get(f.file).blob(f.tipo), tipo: f.tipo, sha256: f.sha256 });
          await DB.salva({ chiave: r.chiave, id: r.v.id, at: Date.now(), titolo: r.v.titolo, sorgente: VL.sorgente(r.l), foto });
          salvate.push(r.chiave);
        }
        return { ok: true };
      },
      dopoInvio: async (risposta, voci) => {
        const entrati = new Set([...(risposta?.aggiunti || []), ...(risposta?.riattivati || [])].map(String));
        const avviata = risposta?.ok && risposta.count != null;
        const rifiutati = risposta?.rifiutati || [];
        // Quello che non e' entrato non tiene foto nell'IndexedDB
        for (const it of voci) {
          const r = perId.get(it.id);
          const dentro = risposta?.ok && (avviata ? !rifiutati.some((x) => String(x.id) === it.id) : entrati.has(it.id));
          if (!dentro && salvate.includes(r.chiave)) await DB.elimina(r.chiave).catch(() => {});
          if (dentro) r.scelto = false;
        }
        await rivaluta();
        disegna();
        const n = avviata ? risposta.count : entrati.size;
        stato(risposta?.ok
          ? `${n} ${n === 1 ? "annuncio messo" : "annunci messi"} in coda da Vintory.${rifiutati.length ? ` Non entrati: ${rifiutati.map((x) => `${x.id} (${x.motivo})`).join("; ")}.` : ""} Tieni aperta una scheda di Vinted.`
          : risposta?.error || rifiutati[0]?.motivo || "Non riuscito.", risposta?.ok ? "ok" : "error");
      },
    });
  }

  function collega() {
    const file = $("vintoryFile");
    const zona = $("vintoryPanel");
    $("vintoryApri").addEventListener("click", () => file.click());
    file.addEventListener("change", () => { if (file.files?.[0]) apri(file.files[0]); file.value = ""; });
    zona.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); zona.classList.add("is-drop"); } });
    zona.addEventListener("dragleave", (e) => { if (!zona.contains(e.relatedTarget)) zona.classList.remove("is-drop"); });
    zona.addEventListener("drop", (e) => {
      e.preventDefault();
      zona.classList.remove("is-drop");
      const f = e.dataTransfer?.files?.[0];
      if (f) apri(f);
    });
    // La coda cambia (aggiunte, esiti, registro): l'anteprima resta vera.
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === "local" && corrente && (c.vrQueue || c.vintoryOrigine) && !inCorso) rivaluta().then(disegna);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", collega);
  else collega();
  window.VintoryUI = { apri, get corrente() { return corrente; } };
})();
