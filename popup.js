const DEFAULTS = {
  deleteOld: true,
  autoReload: false,
  showOnOtherProfiles: false,
  order: "safe",
  delayMs: 1200,
};

document.getElementById("version").textContent = chrome.runtime.getManifest().version;

// --------------------------------------------------------------- impostazioni

const fields = {
  deleteOld: document.getElementById("deleteOld"),
  autoReload: document.getElementById("autoReload"),
  showOnOtherProfiles: document.getElementById("showOnOtherProfiles"),
  order: document.getElementById("order"),
  delayMs: document.getElementById("delayMs"),
};

const valueOf = (input) => {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "number") return Number(input.value);
  return input.value;
};

chrome.storage.local.get(DEFAULTS).then((settings) => {
  for (const [key, input] of Object.entries(fields)) {
    if (input.type === "checkbox") input.checked = settings[key];
    else input.value = settings[key];

    input.addEventListener("change", () => {
      chrome.storage.local.set({ [key]: valueOf(input) });
    });
  }
});

document.getElementById("tutorial").addEventListener("click", async () => {
  await chrome.storage.local.set({ seenOnboarding: false });
  window.close();
});

// ---------------------------------------------------------------------- stato

/**
 * "Appreso" = l'estensione ha visto una richiesta vera di Vinted e usa quella.
 * "Predefinito" non e' un errore: sono i formati scritti nel codice, che
 * funzionano finche' Vinted non cambia qualcosa.
 */
function showStatus(name, learned, detail) {
  document.getElementById(`${name}Dot`).classList.toggle("on", Boolean(learned));

  const state = document.getElementById(`${name}State`);
  state.textContent = learned ? "appreso" : "predefinito";
  state.title = detail || "";
}

chrome.storage.local.get(["photoFormat", "itemFormat"]).then(({ photoFormat, itemFormat }) => {
  const photoFields = photoFormat
    ? [...Object.keys(photoFormat.constants || {}), photoFormat.uuidField, photoFormat.fileField]
        .filter(Boolean)
        .join(", ")
    : "";

  showStatus("photo", photoFormat, photoFields);
  showStatus("item", itemFormat?.fields?.length, (itemFormat?.fields || []).join(", "));

  document.getElementById("statusHint").textContent = photoFormat && itemFormat?.fields?.length
    ? "Entrambi rilevati dalle richieste di Vinted."
    : "Si aggiornano da soli quando pubblichi o modifichi un annuncio su Vinted.";
});

// ---------------------------------------------------------------------- bozze

chrome.storage.local.get(null).then((everything) => {
  const entries = Object.entries(everything).filter(([key]) => key.startsWith("vrBackup:"));
  if (!entries.length) return;                       // sezione nascosta se non serve

  document.getElementById("draftsBlock").hidden = false;

  const container = document.getElementById("drafts");
  for (const [key, value] of entries) {
    const row = document.createElement("div");
    const when = new Date(value.at).toLocaleDateString("it-IT");
    row.textContent = `${value.draft?.title || key.split(":")[1]} — ${when}`;
    container.append(row);
  }

  const button = document.getElementById("copy");
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(JSON.stringify(Object.fromEntries(entries), null, 2));
    button.textContent = "Copiato";
    setTimeout(() => (button.textContent = "Copia negli appunti"), 1500);
  });
});
