/**
 * Editor dell'annuncio: foto (ordine, rotazione, ritaglio), testi, prezzo,
 * controlli in tempo reale e anteprima di cosa verra' inviato.
 *
 * Due livelli di modifica, tenuti separati di proposito:
 *   - locale:  la bozza vive nel browser, si salva da sola, Vinted non la vede;
 *   - inviata: solo quando premi Pubblica, e solo quello che l'anteprima elenca.
 */
(() => {
  const VR = (window.VR = window.VR || {});
  const h = VR.h;
  const L = VR.editorLogica;

  const CHIAVE_BOZZE = "editorDrafts";
  const LATO_ANTEPRIMA = 420;

  // ------------------------------------------------------------------ bozze

  async function leggiBozza(itemId) {
    const { [CHIAVE_BOZZE]: bozze = {} } = await chrome.storage.local.get(CHIAVE_BOZZE);
    return bozze[itemId] || null;
  }

  async function scriviBozza(itemId, stato) {
    const { [CHIAVE_BOZZE]: bozze = {} } = await chrome.storage.local.get(CHIAVE_BOZZE);
    bozze[itemId] = {
      at: Date.now(),
      title: stato.title,
      description: stato.description,
      price: stato.price,
      colorIds: stato.colorIds,
      // i blob non si salvano: si riscaricano dagli url alla riapertura
      photos: stato.photos.map(({ url, rotate, crop }) => ({ url, rotate, crop })),
    };
    await chrome.storage.local.set({ [CHIAVE_BOZZE]: bozze });
  }

  VR.scartaBozza = async (itemId) => {
    const { [CHIAVE_BOZZE]: bozze = {} } = await chrome.storage.local.get(CHIAVE_BOZZE);
    if (!(itemId in bozze)) return;
    delete bozze[itemId];
    await chrome.storage.local.set({ [CHIAVE_BOZZE]: bozze });
  };

  // ------------------------------------------------------------------- foto

  /** Scarica ogni foto una volta sola: serve all'anteprima e poi all'upload. */
  function cacheFoto() {
    const blob = new Map();
    const url = new Map();
    const inCorso = new Map();

    async function carica(sorgente) {
      if (blob.has(sorgente)) return blob.get(sorgente);
      if (!inCorso.has(sorgente)) {
        inCorso.set(sorgente, VR.api.downloadPhoto(sorgente).then((b) => {
          blob.set(sorgente, b);
          return b;
        }));
      }
      return inCorso.get(sorgente);
    }

    /** Miniatura con rotazione e ritaglio gia' applicati, come apparira' online. */
    async function miniatura(foto, lato = LATO_ANTEPRIMA) {
      const chiave = `${foto.url}|${foto.rotate || 0}|${JSON.stringify(foto.crop || null)}|${lato}`;
      if (url.has(chiave)) return url.get(chiave);
      const canvas = await VR.renderFoto(await carica(foto.url), {
        rotate: foto.rotate || 0,
        crop: foto.crop || null,
        maxSide: lato,
      });
      const b = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
      const indirizzo = URL.createObjectURL(b);
      url.set(chiave, indirizzo);
      return indirizzo;
    }

    function libera() {
      for (const u of url.values()) URL.revokeObjectURL(u);
      url.clear();
    }

    return { carica, miniatura, libera, blob };
  }

  // ----------------------------------------------------------------- editor

  VR.openEditor = (itemId, onConfirm) => {
    const foto = cacheFoto();
    let source = null;
    let originale = null;
    let stato = null;
    let vista = "modifica";
    let salvataggio = null;
    let coloreMancante = false;
    let coloreRiempito = false;

    const corpo = h("div", { class: "vr-editor__body" },
      h("p", { class: "vr-note vr-note--loading" }, "Carico l'articolo e le foto…")
    );
    const card = h("div", { class: "vr-card vr-editor", role: "dialog", "aria-modal": "true" },
      h("div", { class: "vr-editor__head" },
        h("h2", { class: "vr-card__title" }, "Modifica e ripubblica"),
        h("span", { class: "vr-editor__badge", id: "vr-stato-bozza" }, "")
      ),
      corpo
    );

    const chiudi = VR.openOverlay(card, { onClose: () => foto.libera() });

    // ------------------------------------------------------------- salvataggio

    const badge = () => card.querySelector("#vr-stato-bozza");

    function segnaStato() {
      const modificato = L.haModifiche(originale, stato);
      badge().textContent = modificato
        ? "Bozza locale · non ancora inviata"
        : "Nessuna modifica";
      badge().classList.toggle("is-dirty", modificato);
    }

    function salvaPresto() {
      segnaStato();
      clearTimeout(salvataggio);
      salvataggio = setTimeout(async () => {
        if (L.haModifiche(originale, stato)) await scriviBozza(itemId, stato);
        else await VR.scartaBozza(itemId);
      }, 500);
    }

    // ------------------------------------------------------------------- viste

    function mostra(nuova, opzioni) {
      vista = nuova;
      corpo.textContent = "";
      if (vista === "modifica") corpo.append(vistaModifica());
      else if (vista === "ritaglio") corpo.append(vistaRitaglio(opzioni));
      else if (vista === "anteprima") corpo.append(vistaAnteprima());
    }

    // --- modifica ---------------------------------------------------------

    function vistaModifica() {
      const striscia = h("div", { class: "vr-photos" });
      const controlli = h("div", { class: "vr-checks" });

      const titolo = h("input", { class: "vr-input", type: "text", maxlength: String(L.TITOLO_MAX + 20) });
      const contaTitolo = h("span", { class: "vr-counter" });
      const descrizione = h("textarea", { class: "vr-input vr-input--area", rows: "6" });
      const contaDescrizione = h("span", { class: "vr-counter" });
      const prezzo = h("input", { class: "vr-input", type: "number", min: "0.5", step: "0.5" });
      const colore = coloreMancante ? VR.selectColore(stato.colorIds?.[0]) : null;

      titolo.value = stato.title;
      descrizione.value = stato.description;
      prezzo.value = stato.price;

      const avanti = h("button", { class: "vr-btn vr-btn--primary" }, "Anteprima →");

      function aggiornaControlli() {
        contaTitolo.textContent = `${stato.title.trim().length}/${L.TITOLO_MAX}`;
        contaTitolo.classList.toggle("is-over", stato.title.trim().length > L.TITOLO_MAX);
        contaDescrizione.textContent = `${stato.description.trim().length} caratteri`;

        const esito = L.controlla(stato, { coloreMancante, coloreRiempito });
        const qualita = VR.punteggio({
          ...source,
          title: stato.title,
          description: stato.description,
          photos: stato.photos,
          color1_id: stato.colorIds?.[0] ?? source.color1_id,
        });

        controlli.textContent = "";
        controlli.append(
          h("div", { class: "vr-checks__score" },
            h("strong", {}, `Completezza ${qualita.score}/100`),
            h("span", { class: "vr-quality__bar" },
              h("span", { class: "vr-quality__fill", style: `width:${qualita.score}%` })
            )
          ),
          ...esito.errori.map((e) => h("div", { class: "vr-check-row is-error" }, "✕ ", e.testo)),
          ...esito.avvisi.map((a) => h("div", { class: "vr-check-row is-warn" }, "⚠ ", a.testo)),
          !esito.errori.length && !esito.avvisi.length
            ? h("div", { class: "vr-check-row is-ok" }, "✓ Nessun problema trovato.")
            : null
        );

        avanti.disabled = !esito.ok;
        avanti.title = esito.ok ? "" : "Correggi gli errori in rosso prima di continuare.";
      }

      const cambia = () => {
        stato.title = titolo.value;
        stato.description = descrizione.value;
        stato.price = prezzo.value === "" ? "" : Number(prezzo.value);
        if (colore) stato.colorIds = colore.value ? [Number(colore.value)] : [];
        aggiornaControlli();
        salvaPresto();
      };
      for (const campo of [titolo, descrizione, prezzo]) campo.addEventListener("input", cambia);
      colore?.addEventListener("change", cambia);

      disegnaStriscia(striscia, () => { aggiornaControlli(); salvaPresto(); });
      aggiornaControlli();

      avanti.addEventListener("click", () => mostra("anteprima"));

      return h("div", {},
        h("div", { class: "vr-section-title" }, "Foto",
          h("span", { class: "vr-hint" }, "trascina per riordinare · la prima è la copertina")
        ),
        striscia,
        h("label", { class: "vr-field" },
          h("span", { class: "vr-field__label" }, "Titolo ", contaTitolo), titolo),
        h("label", { class: "vr-field" },
          h("span", { class: "vr-field__label" }, "Descrizione ", contaDescrizione), descrizione),
        h("div", { class: "vr-row" },
          h("label", { class: "vr-field" }, h("span", { class: "vr-field__label" }, "Prezzo (EUR)"), prezzo),
          colore
            ? h("label", { class: "vr-field" }, h("span", { class: "vr-field__label" }, "Colore (manca)"), colore)
            : null
        ),
        controlli,
        h("div", { class: "vr-actions" },
          h("button", {
            class: "vr-btn vr-btn--ghost",
            onclick: async () => {
              if (!L.haModifiche(originale, stato)) return chiudi();
              stato = clona(originale);
              await VR.scartaBozza(itemId);
              segnaStato();
              mostra("modifica");
            },
          }, "Annulla modifiche"),
          h("button", { class: "vr-btn vr-btn--ghost", onclick: () => chiudi() }, "Chiudi"),
          avanti
        )
      );
    }

    function disegnaStriscia(striscia, dopo) {
      striscia.textContent = "";
      let trascinata = null;

      stato.photos.forEach((f, indice) => {
        const img = h("img", { class: "vr-photo__img", alt: `Foto ${indice + 1}`, draggable: "false" });
        foto.miniatura(f, 220).then((u) => (img.src = u)).catch(() => img.classList.add("is-broken"));

        const azione = (simbolo, titolo, fn) =>
          h("button", { class: "vr-photo__btn", title: titolo, type: "button", onclick: (e) => { e.stopPropagation(); fn(); } }, simbolo);

        const tessera = h("div", {
          class: "vr-photo",
          draggable: "true",
          dataset: { indice: String(indice) },
        },
          img,
          indice === 0 ? h("span", { class: "vr-photo__cover" }, "Copertina") : null,
          f.crop ? h("span", { class: "vr-photo__tag" }, "ritagliata") : null,
          h("div", { class: "vr-photo__tools" },
            azione("↺", "Ruota a sinistra", () => { f.rotate = ((f.rotate || 0) - 90 + 360) % 360; f.crop = null; ridisegna(); }),
            azione("↻", "Ruota a destra", () => { f.rotate = ((f.rotate || 0) + 90) % 360; f.crop = null; ridisegna(); }),
            azione("✂", "Ritaglia", () => mostra("ritaglio", { indice })),
            stato.photos.length > 1
              ? azione("✕", "Togli dall'annuncio", () => { stato.photos.splice(indice, 1); ridisegna(); })
              : null
          )
        );

        tessera.addEventListener("dragstart", (e) => {
          trascinata = indice;
          tessera.classList.add("is-dragging");
          e.dataTransfer.effectAllowed = "move";
        });
        tessera.addEventListener("dragend", () => tessera.classList.remove("is-dragging"));
        tessera.addEventListener("dragover", (e) => { e.preventDefault(); tessera.classList.add("is-target"); });
        tessera.addEventListener("dragleave", () => tessera.classList.remove("is-target"));
        tessera.addEventListener("drop", (e) => {
          e.preventDefault();
          tessera.classList.remove("is-target");
          if (trascinata == null) return;
          stato.photos = L.sposta(stato.photos, trascinata, indice);
          trascinata = null;
          ridisegna();
        });

        striscia.append(tessera);
      });

      // Le foto rimosse si possono rimettere: sono ancora nell'annuncio online.
      const tolte = originale.photos.filter((o) => !stato.photos.some((f) => f.url === o.url));
      if (tolte.length) {
        striscia.append(h("button", {
          class: "vr-photo vr-photo--add",
          type: "button",
          title: "Rimetti le foto tolte",
          onclick: () => { stato.photos.push(...tolte.map((t) => ({ url: t.url }))); ridisegna(); },
        }, `+ ${tolte.length} ${tolte.length === 1 ? "tolta" : "tolte"}`));
      }

      function ridisegna() {
        disegnaStriscia(striscia, dopo);
        dopo();
      }
    }

    // --- ritaglio ---------------------------------------------------------

    function vistaRitaglio({ indice }) {
      const f = stato.photos[indice];
      let riquadro = f.crop ? { ...f.crop } : null;
      let inizio = null;

      const img = h("img", { class: "vr-crop__img", alt: "", draggable: "false" });
      const area = h("div", { class: "vr-crop__sel", hidden: !riquadro });
      const tela = h("div", { class: "vr-crop" }, img, area);
      const misura = h("span", { class: "vr-hint" });

      // l'immagine e' gia' ruotata ma non ritagliata: il ritaglio si disegna sopra
      foto.miniatura({ url: f.url, rotate: f.rotate || 0 }, 900).then((u) => (img.src = u));

      function disegna() {
        area.hidden = !riquadro;
        if (!riquadro) { misura.textContent = "Trascina sull'immagine per scegliere la parte da tenere."; return; }
        Object.assign(area.style, {
          left: `${riquadro.x * 100}%`,
          top: `${riquadro.y * 100}%`,
          width: `${riquadro.w * 100}%`,
          height: `${riquadro.h * 100}%`,
        });
        misura.textContent = `Tieni il ${Math.round(riquadro.w * riquadro.h * 100)}% dell'immagine.`;
      }

      const punto = (e) => {
        const r = img.getBoundingClientRect();
        return {
          x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
          y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
        };
      };

      tela.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        tela.setPointerCapture(e.pointerId);
        inizio = punto(e);
        riquadro = { x: inizio.x, y: inizio.y, w: 0, h: 0 };
        disegna();
      });
      tela.addEventListener("pointermove", (e) => {
        if (!inizio) return;
        const p = punto(e);
        riquadro = {
          x: Math.min(inizio.x, p.x),
          y: Math.min(inizio.y, p.y),
          w: Math.abs(p.x - inizio.x),
          h: Math.abs(p.y - inizio.y),
        };
        disegna();
      });
      tela.addEventListener("pointerup", () => {
        inizio = null;
        if (riquadro && (riquadro.w < 0.05 || riquadro.h < 0.05)) riquadro = null;   // clic, non trascinamento
        disegna();
      });

      const preimpostato = (rapporto) => () => {
        // rapporto larghezza/altezza in pixel, convertito in frazioni dell'immagine
        const W = img.naturalWidth || 1;
        const H = img.naturalHeight || 1;
        let w = 1;
        let hh = (W / rapporto) / H;
        if (hh > 1) { hh = 1; w = (H * rapporto) / W; }
        riquadro = { x: (1 - w) / 2, y: (1 - hh) / 2, w, h: hh };
        disegna();
      };

      disegna();

      return h("div", {},
        h("div", { class: "vr-section-title" }, `Ritaglia la foto ${indice + 1}`),
        tela,
        h("div", { class: "vr-crop__bar" },
          misura,
          h("span", { class: "vr-crop__presets" },
            h("button", { class: "vr-chip", type: "button", onclick: preimpostato(1) }, "Quadrato"),
            h("button", { class: "vr-chip", type: "button", onclick: preimpostato(4 / 5) }, "4:5"),
            h("button", { class: "vr-chip", type: "button", onclick: () => { riquadro = null; disegna(); } }, "Intera")
          )
        ),
        h("div", { class: "vr-actions" },
          h("button", { class: "vr-btn vr-btn--ghost", onclick: () => mostra("modifica") }, "Annulla"),
          h("button", {
            class: "vr-btn vr-btn--primary",
            onclick: () => {
              f.crop = riquadro && (riquadro.w < 0.99 || riquadro.h < 0.99) ? riquadro : null;
              salvaPresto();
              mostra("modifica");
            },
          }, "Applica")
        )
      );
    }

    // --- anteprima --------------------------------------------------------

    function vistaAnteprima() {
      const copertina = h("img", { class: "vr-preview__img", alt: "" });
      foto.miniatura(stato.photos[0], 600).then((u) => (copertina.src = u));

      const voci = L.differenze(originale, stato);
      const euro = (n) => Number(n).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
      const valore = (v, voce) => (voce.euro ? euro(v) : voce.lungo ? `${String(v).slice(0, 140)}${String(v).length > 140 ? "…" : ""}` : String(v));

      const previsti = VR.riempimentiPrevisti(source, { colorIds: stato.colorIds }).previsti;
      const elimina = h("input", { type: "checkbox", class: "vr-check", checked: VR.settings.deleteOld });

      return h("div", {},
        h("div", { class: "vr-preview" },
          h("div", { class: "vr-preview__card" },
            copertina,
            h("div", { class: "vr-preview__meta" },
              h("strong", { class: "vr-preview__price" }, euro(stato.price)),
              h("span", { class: "vr-preview__title" }, stato.title.trim()),
              h("span", { class: "vr-hint" }, `${stato.photos.length} foto`)
            )
          ),
          h("div", { class: "vr-preview__side" },
            h("div", { class: "vr-section-title" }, "Cosa verrà inviato a Vinted"),
            voci.length
              ? h("div", { class: "vr-diff" },
                  voci.map((v) => h("div", { class: "vr-diff__row" },
                    h("span", { class: "vr-diff__field" }, v.campo),
                    h("span", { class: "vr-diff__before" }, valore(v.prima, v)),
                    h("span", { class: "vr-diff__arrow" }, "→"),
                    h("span", { class: "vr-diff__after" }, valore(v.dopo, v))
                  ))
                )
              : h("p", { class: "vr-note" }, "Nessuna modifica: l'annuncio viene ripubblicato identico."),
            previsti.length
              ? h("p", { class: "vr-note" },
                  "Riempiti in automatico: ",
                  previsti.map((p) => `${p.etichetta} «${p.testo}»`).join(", "), ".")
              : null,
            h("p", { class: "vr-note" },
              "Restano come prima: categoria, marca, taglia, condizione, colori, spedizione."),
            h("div", { class: "vr-callout" },
              h("strong", {}, "Cosa succede premendo Pubblica"),
              h("span", {},
                "Le foto vengono ricaricate come nuove e l'annuncio viene ripubblicato: " +
                "visite e preferiti ripartono da zero. Fino a quel momento le modifiche " +
                "restano solo in questo browser.")
            ),
            h("label", { class: "vr-checkline" }, elimina,
              h("span", {}, "Elimina il vecchio annuncio dopo la pubblicazione"))
          )
        ),
        h("div", { class: "vr-actions" },
          h("button", { class: "vr-btn vr-btn--ghost", onclick: () => mostra("modifica") }, "← Torna a modificare"),
          h("button", {
            class: "vr-btn vr-btn--primary",
            onclick: () => {
              const scelte = stato.photos.map((f) => ({
                url: f.url,
                rotate: f.rotate || 0,
                crop: f.crop || null,
                blob: foto.blob.get(f.url) || null,     // gia' scaricata: niente secondo download
              }));
              chiudi();
              onConfirm({
                title: stato.title.trim(),
                description: stato.description,
                price: stato.price,
                colorIds: stato.colorIds?.length ? stato.colorIds : undefined,
                photos: scelte,
                deleteOld: elimina.checked,
              });
            },
          }, "Pubblica")
        )
      );
    }

    // ---------------------------------------------------------------- avvio

    const clona = (o) => JSON.parse(JSON.stringify(o));

    (async () => {
      try {
        source = await VR.api.getUploadDraft(itemId);
        const prezzo = typeof source.price === "object" ? source.price?.amount : source.price;
        const colori = [source.color1_id, source.color2_id].filter((c) => c != null);

        originale = {
          title: source.title || "",
          description: source.description || "",
          price: prezzo != null ? Number(prezzo) : "",
          colorIds: colori,
          photos: VR.photoUrls(source).map((url) => ({ url })),
        };
        coloreMancante = colori.length === 0;
        coloreRiempito = VR.riempimentiPrevisti(source, {}).previsti.some((p) => p.campo === "color_ids");

        stato = clona(originale);

        // Una bozza locale salvata prima vince sull'originale, ma solo per le foto
        // che esistono ancora: l'annuncio potrebbe essere cambiato nel frattempo.
        const bozza = await leggiBozza(itemId);
        let ripresa = false;
        if (bozza) {
          const valide = (bozza.photos || []).filter((f) => originale.photos.some((o) => o.url === f.url));
          stato = {
            title: bozza.title ?? stato.title,
            description: bozza.description ?? stato.description,
            price: bozza.price ?? stato.price,
            colorIds: bozza.colorIds ?? stato.colorIds,
            photos: valide.length ? valide : stato.photos,
          };
          ripresa = L.haModifiche(originale, stato);
        }

        mostra("modifica");
        segnaStato();
        if (ripresa) {
          VR.toast(
            `Ho ripreso la bozza del ${new Date(bozza.at).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. «Annulla modifiche» torna all'originale.`,
            "info",
            7000
          );
        }

        // le foto si scaricano in parallelo mentre leggi
        for (const f of originale.photos) foto.carica(f.url).catch(() => {});
      } catch (error) {
        corpo.textContent = "";
        corpo.append(h("p", { class: "vr-note vr-note--error" }, `Non riesco a leggere l'articolo: ${error.message}`));
      }
    })();
  };
})();
