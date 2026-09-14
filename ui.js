/* Interfaccia: onboarding una tantum, bottoni sulle card, dialog di modifica. */
(() => {
  const VR = (window.VR = window.VR || {});
  const h = VR.h;

  // Condizioni Vinted. Se un id non corrisponde, correggilo qui (vedi README).
  const CONDITIONS = [
    { id: "", label: "Non modificare" },
    { id: 6, label: "Nuovo con cartellino" },
    { id: 1, label: "Nuovo senza cartellino" },
    { id: 2, label: "Ottime condizioni" },
    { id: 3, label: "Buone condizioni" },
    { id: 4, label: "Discrete condizioni" },
  ];

  // ---------------------------------------------------------------- overlay

  function openOverlay(card, { onClose } = {}) {
    const overlay = h("div", { class: "vr-overlay" }, card);

    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      onClose?.();
    };
    const onKey = (event) => event.key === "Escape" && close();

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);

    return close;
  }

  // ---------------------------------------------------------------- onboarding

  const STEPS = [
    {
      title: "Accedi a Vinted",
      text: "I bottoni funzionano solo con la sessione del tuo account aperta.",
    },
    {
      title: "Apri il tuo armadio",
      text: "Su ogni articolo compaiono due bottoni sotto la card.",
    },
    {
      title: "Ripubblica",
      text: "Un clic clona l'annuncio e cancella il vecchio. Con «Modifica» cambi prima prezzo, titolo e descrizione.",
    },
  ];

  VR.showOnboarding = ({ force = false } = {}) => {
    if (VR.settings.seenOnboarding && !force) return;
    if (document.querySelector(".vr-onboarding")) return;

    const steps = STEPS.map((step, index) =>
      h(
        "li",
        { class: "vr-step" },
        h("span", { class: "vr-step__num" }, String(index + 1)),
        h(
          "div",
          { class: "vr-step__body" },
          h("strong", { class: "vr-step__title" }, step.title),
          h("span", { class: "vr-step__text" }, step.text)
        )
      )
    );

    const card = h(
      "div",
      { class: "vr-card vr-onboarding", role: "dialog", "aria-modal": "true" },
      h("h2", { class: "vr-card__title" }, "Benvenuto su Vinted Relist"),
      h("ol", { class: "vr-steps" }, steps),
      h(
        "p",
        { class: "vr-note" },
        "Prova prima su un articolo poco importante: se Vinted blocca la pubblicazione, l'annuncio originale potrebbe restare online in copia."
      ),
      h(
        "button",
        {
          class: "vr-btn vr-btn--primary vr-btn--block",
          onclick: async () => {
            await VR.saveSettings({ seenOnboarding: true });
            close();
          },
        },
        "Ho capito"
      )
    );

    const close = openOverlay(card);
  };

  // ---------------------------------------------------------------- dialog modifica

  function openEditDialog(itemId, onConfirm) {
    const title = h("input", { class: "vr-input", type: "text", maxlength: "100" });
    const description = h("textarea", { class: "vr-input vr-input--area", rows: "5" });
    const price = h("input", { class: "vr-input", type: "number", min: "0.5", step: "0.5" });
    const condition = h(
      "select",
      { class: "vr-input" },
      CONDITIONS.map((option) => h("option", { value: String(option.id) }, option.label))
    );
    const deleteOld = h("input", { type: "checkbox", class: "vr-check", checked: VR.settings.deleteOld });

    const status = h("p", { class: "vr-note vr-note--loading" }, "Carico i dati dell'articolo…");
    const confirmButton = h("button", { class: "vr-btn vr-btn--primary", disabled: true }, "Pubblica");

    const card = h(
      "div",
      { class: "vr-card vr-card--wide", role: "dialog", "aria-modal": "true" },
      h("h2", { class: "vr-card__title" }, "Modifica e ripubblica"),
      status,
      h("label", { class: "vr-field" }, h("span", { class: "vr-field__label" }, "Titolo"), title),
      h("label", { class: "vr-field" }, h("span", { class: "vr-field__label" }, "Descrizione"), description),
      h(
        "div",
        { class: "vr-row" },
        h("label", { class: "vr-field" }, h("span", { class: "vr-field__label" }, "Prezzo (EUR)"), price),
        h("label", { class: "vr-field" }, h("span", { class: "vr-field__label" }, "Condizione"), condition)
      ),
      h(
        "label",
        { class: "vr-checkline" },
        deleteOld,
        h("span", {}, "Elimina il vecchio annuncio dopo la pubblicazione")
      ),
      h(
        "p",
        { class: "vr-note" },
        "Categoria, marca, taglia, colori e spedizione restano identici all'originale."
      ),
      h(
        "div",
        { class: "vr-actions" },
        h("button", { class: "vr-btn vr-btn--ghost", onclick: () => close() }, "Annulla"),
        confirmButton
      )
    );

    const close = openOverlay(card);

    VR.api
      .getUploadDraft(itemId)
      .then((item) => {
        title.value = item.title || "";
        description.value = item.description || "";
        const amount = typeof item.price === "object" ? item.price?.amount : item.price;
        price.value = amount != null ? Number(amount) : "";
        status.remove();
        confirmButton.disabled = false;
        title.focus();
      })
      .catch((error) => {
        status.className = "vr-note vr-note--error";
        status.textContent = `Non riesco a leggere l'articolo: ${error.message}`;
      });

    confirmButton.addEventListener("click", () => {
      close();
      onConfirm({
        title: title.value,
        description: description.value,
        price: price.value,
        status_id: condition.value,
        deleteOld: deleteOld.checked,
      });
    });
  }

  VR.openEditDialog = openEditDialog;

  // ---------------------------------------------------------------- barra bottoni

  /**
   * Costruisce la barra con i due bottoni per un articolo.
   * @param {string} itemId
   */
  VR.buildActionBar = (itemId) => {
    const label = h("span", { class: "vr-bar__status" });
    const relistButton = h("button", { class: "vr-btn vr-btn--primary vr-btn--sm" }, "Ripubblica");
    const editButton = h("button", { class: "vr-btn vr-btn--ghost vr-btn--sm" }, "Modifica");
    const bar = h("div", { class: "vr-bar" }, h("div", { class: "vr-bar__row" }, relistButton, editButton), label);

    const setBusy = (busy) => {
      relistButton.disabled = busy;
      editButton.disabled = busy;
      bar.classList.toggle("vr-bar--busy", busy);
    };

    const run = (overrides) =>
      VR.queue(async () => {
        setBusy(true);
        label.className = "vr-bar__status";
        try {
          const created = await VR.relist(itemId, overrides, (step) => (label.textContent = step));
          bar.classList.add("vr-bar--done");
          label.className = "vr-bar__status vr-bar__status--ok";
          label.textContent = "Ripubblicato";
          VR.toast("Articolo ripubblicato.", "ok");
          if (VR.settings.autoReload) setTimeout(() => location.reload(), 1500);
          return created;
        } catch (error) {
          label.className = "vr-bar__status vr-bar__status--error";
          label.textContent = error.message;
          VR.toast(error.message, "error", 9000);
          setBusy(false);
        }
      });

    relistButton.addEventListener("click", () => run({}));
    editButton.addEventListener("click", () => openEditDialog(itemId, (overrides) => run(overrides)));

    return bar;
  };
})();
