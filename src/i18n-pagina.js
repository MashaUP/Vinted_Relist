/**
 * Lingua (2.6.0) in un contesto con DOM: popup, dashboard, e le pagine di Vinted
 * (lì traduce solo gli elementi dell'estensione). Legge la scelta, carica il
 * dizionario, collega l'osservatore e tiene tutto aggiornato se la scelta
 * cambia da un'altra pagina. Dove c'e' un [data-vr-lingua] monta il pannello
 * di scelta della lingua.
 */
(() => {
  "use strict";
  const I = window.I18N;
  if (!I || window.__vrI18n) return;
  window.__vrI18n = true;

  const inEstensione = location.protocol === "chrome-extension:";
  // Sulle pagine di Vinted: solo i nodi dentro un elemento dell'estensione (classi vr-…).
  const DELL_ESTENSIONE = '[class^="vr-"], [class*=" vr-"], [data-vr-ui]';
  const dentro = inEstensione ? () => true : (n) => Boolean(n?.closest?.(DELL_ESTENSIONE));

  const fonte = async (codice) => {
    if (inEstensione) {
      const r = await fetch(chrome.runtime.getURL(`src/lang/${codice}.json`));
      if (!r.ok) throw new Error(`lingua ${codice}: ${r.status}`);
      return r.json();
    }
    // Il content script non legge i file dell'estensione senza esporli al sito: li chiede al service worker.
    const r = await chrome.runtime.sendMessage({ type: "vr:lingua", codice });
    if (!r?.ok) throw new Error(r?.error || "lingua non disponibile");
    return r.dizionario;
  };

  let preferenza = "auto";
  const selettori = new Set();

  async function aggiorna() {
    const codice = I.scegli(preferenza, navigator.language);
    await I.applica(codice, fonte);
    for (const s of selettori) s.disegna();
    document.documentElement.classList.remove("vr-i18n-attesa");
  }

  // Mentre il dizionario arriva, le pagine dell'estensione non mostrano l'italiano per un attimo.
  if (inEstensione) {
    document.documentElement.classList.add("vr-i18n-attesa");
    setTimeout(() => document.documentElement.classList.remove("vr-i18n-attesa"), 600);
  }

  /**
   * Pannello «Lingua»: pulsante con la lingua attuale, elenco con Automatica
   * (lingua del browser) e le cinque lingue. I nomi delle lingue non si traducono.
   */
  function montaSelettore(box) {
    box.textContent = "";
    box.classList.add("vr-lingua");
    const bottone = document.createElement("button");
    bottone.type = "button";
    bottone.className = "vr-lingua__btn";
    bottone.setAttribute("aria-haspopup", "listbox");
    bottone.setAttribute("aria-expanded", "false");
    const pannello = document.createElement("div");
    pannello.className = "vr-lingua__panel";
    pannello.hidden = true;
    pannello.setAttribute("role", "listbox");
    pannello.setAttribute("aria-label", "Lingua");
    const titolo = document.createElement("strong");
    titolo.className = "vr-lingua__title";
    titolo.textContent = "Lingua";
    box.append(bottone, pannello);

    const chiudi = () => { pannello.hidden = true; bottone.setAttribute("aria-expanded", "false"); };
    bottone.addEventListener("click", (e) => {
      e.stopPropagation();
      pannello.hidden = !pannello.hidden;
      bottone.setAttribute("aria-expanded", String(!pannello.hidden));
      if (!pannello.hidden) pannello.querySelector('[aria-selected="true"]')?.focus();
    });
    document.addEventListener("click", (e) => { if (!box.contains(e.target)) chiudi(); });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { chiudi(); bottone.focus(); }
      if (!pannello.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const voci = [...pannello.querySelectorAll("[role=option]")];
        const i = voci.indexOf(document.activeElement);
        voci[(i + (e.key === "ArrowDown" ? 1 : voci.length - 1)) % voci.length]?.focus();
        e.preventDefault();
      }
    });

    const voce = (codice, testo, nota) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "vr-lingua__opt";
      b.setAttribute("role", "option");
      b.dataset.lingua = codice;
      const nome = document.createElement("span");
      nome.textContent = testo;
      b.append(nome);
      if (nota) {
        const n = document.createElement("small");
        n.textContent = nota;
        b.append(n);
      }
      b.addEventListener("click", async () => {
        chiudi();
        await chrome.storage.local.set({ lingua: codice });
      });
      return b;
    };

    const s = {
      disegna() {
        const attuale = I.lingua;
        bottone.innerHTML = "";
        const ico = document.createElement("span");
        ico.setAttribute("aria-hidden", "true");
        ico.textContent = "🌐";
        const sigla = document.createElement("span");
        sigla.dataset.vrNoi18n = "";
        sigla.textContent = attuale.toUpperCase();
        bottone.append(ico, sigla);
        bottone.title = I.t("Lingua");
        bottone.setAttribute("aria-label", `${I.t("Lingua")}: ${I.LINGUE[attuale]}`);
        pannello.textContent = "";
        titolo.textContent = "Lingua";
        pannello.append(titolo);
        const browser = I.scegli("auto", navigator.language);
        const lista = document.createElement("div");
        lista.dataset.vrNoi18n = "";
        lista.className = "vr-lingua__list";
        const auto = voce("auto", `${I.BANDIERE[browser]} Automatica`, I.LINGUE[browser]);
        auto.querySelector("span").textContent = `${I.BANDIERE[browser]} ${I.t("Automatica")}`;
        lista.append(auto);
        for (const [codice, nome] of Object.entries(I.LINGUE)) lista.append(voce(codice, `${I.BANDIERE[codice]} ${nome}`));
        for (const b of lista.querySelectorAll("[role=option]")) {
          const scelto = b.dataset.lingua === preferenza;
          b.setAttribute("aria-selected", String(scelto));
          b.tabIndex = scelto ? 0 : -1;
        }
        pannello.append(lista);
      },
    };
    selettori.add(s);
    s.disegna();
  }

  async function avvia() {
    I.collega(document, { dentro });
    try { ({ lingua: preferenza = "auto" } = await chrome.storage.local.get({ lingua: "auto" })); } catch { preferenza = "auto"; }
    for (const box of document.querySelectorAll("[data-vr-lingua]")) montaSelettore(box);
    await aggiorna();
  }

  chrome.storage?.onChanged?.addListener((c, area) => {
    if (area !== "local" || !c.lingua) return;
    preferenza = c.lingua.newValue || "auto";
    aggiorna();
  });

  window.VRLingua = { montaSelettore, aggiorna, get preferenza() { return preferenza; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
  else avvia();
})();
