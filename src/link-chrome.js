/**
 * Adattatore dei link per le pagine dell'estensione (popup, dashboard):
 * legge links.json dal pacchetto, tiene in chrome.storage.local l'ultima
 * configurazione remota valida, la rinnova ogni tanto e collega gli elementi
 * della pagina. La logica di validazione e precedenza e' in link.js.
 *
 * Non serve nessun permesso in piu': la richiesta parte da una pagina
 * dell'estensione verso api.github.com, che consente CORS; niente cookie
 * (credentials: "omit"), niente dati dell'utente nella richiesta.
 *
 * Il service worker e le code non usano i link: se GitHub non risponde, se sei
 * offline o se il file remoto e' rotto, cambiano al massimo i link mostrati.
 *
 * Nell'HTML gli elementi non hanno href: solo data-link="<id>" e hidden.
 * Diventano visibili e cliccabili solo se il link esiste, e' acceso e valido.
 */
(function (root) {
  const L = root.LinkProgetto;
  const CHIAVE = "vrLinks";           // { cache, tentativoAt, okAt, errore }
  const FILE = "links.json";
  const TIMEOUT_MS = 8000;

  /**
   * Icone a tratto, 24×24, nello stile delle altre del popup. Glifi neutri,
   * non i marchi: chi vuole cambiarli li trova solo qui.
   */
  const ICONE = {
    github: ["M8 8l-4 4 4 4", "M16 8l4 4-4 4", "M13.5 5.5l-3 13"],
    discord: ["M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M8.5 11h.01M12 11h.01M15.5 11h.01"],
    kofi: ["M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z", "M17 10h1.5a2.5 2.5 0 0 1 0 5H17", "M8 3v3M12 3v3"],
    documentation: ["M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z", "M5 19.5A1.5 1.5 0 0 0 6.5 21H19", "M9 7h6"],
    "bug-report": ["M8 10a4 4 0 0 1 8 0v4a4 4 0 0 1-8 0z", "M12 10v8", "M4 13h4M16 13h4M5 8l3 1.5M19 8l-3 1.5M5 19l3-2M19 19l-3-2", "M10 5l-1-2M14 5l1-2"],
    "feature-request": ["M9 18h6M10 21h4", "M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"],
    changelog: ["M9 6h11M9 12h11M9 18h11", "M4.5 6h.01M4.5 12h.01M4.5 18h.01"],
    _link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
  };

  function icona(id) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", "link-svg");
    for (const d of ICONE[id] || ICONE._link) {
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
    return svg;
  }

  let predefinitaInMemoria = null;
  async function predefinita() {
    if (predefinitaInMemoria) return predefinitaInMemoria;
    try {
      const r = await fetch(chrome.runtime.getURL(FILE));
      predefinitaInMemoria = L.valida(await r.text());
    } catch {
      predefinitaInMemoria = { ok: false, errore: `${FILE} del pacchetto non leggibile` };
    }
    return predefinitaInMemoria;
  }

  /** Stesso repository del controllo aggiornamenti (Impostazioni › Avanzate). */
  async function repo() {
    const { updateRepo } = await chrome.storage.local.get({ updateRepo: "" });
    return updateRepo || root.Versione?.REPO || "MashaUP/Vinted_Relist";
  }

  async function stato() {
    const r = await chrome.storage.local.get(CHIAVE);
    const s = r[CHIAVE];
    return s && typeof s === "object" ? s : {};
  }

  /** Impostazioni › Avanzate › «Aggiorna i link del progetto» (acceso se mai toccato). */
  async function remotoAttivo() {
    const { linksRemote } = await chrome.storage.local.get({ linksRemote: true });
    return linksRemote !== false;
  }

  /** Link da usare adesso, senza toccare la rete. Con il remoto spento valgono solo quelli installati. */
  async function risolti() {
    const [p, s, r, attivo] = await Promise.all([predefinita(), stato(), repo(), remotoAttivo()]);
    const risolto = L.risolvi({ predefinita: p, cache: attivo ? s.cache || null : null, repo: r });
    return { ...risolto, remotoSpento: !attivo };
  }

  /** GitHub a volte ignora l'Accept "raw" e manda il file in base64. */
  function testoDaGithub(testo) {
    try {
      const d = JSON.parse(testo);
      if (d && d.encoding === "base64" && typeof d.content === "string") {
        return decodeURIComponent(escape(atob(d.content.replace(/\s/g, ""))));
      }
    } catch { /* lo dira' la validazione */ }
    return testo;
  }

  const motivoHttp = (status) =>
    status === 404 ? "file non ancora pubblicato sul repository"
      : status === 403 || status === 429 ? "GitHub ha limitato le richieste"
        : `HTTP ${status}`;

  /**
   * Rinnova la configurazione remota se e' il momento (o se forza, al massimo
   * una volta al minuto). Un errore non cancella mai l'ultima cache valida.
   * → { aggiornato: bool, errore?: string }
   */
  async function aggiorna({ forza = false, ora = Date.now() } = {}) {
    if (!(await remotoAttivo())) return { aggiornato: false };
    const s = await stato();
    if (!L.daAggiornare(s, ora, { forza })) return { aggiornato: false };
    const r = await repo();
    // Il tentativo si segna subito: due pagine aperte insieme non chiedono due volte.
    await chrome.storage.local.set({ [CHIAVE]: { ...s, tentativoAt: ora } });

    let errore = null;
    let nuova = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const risposta = await fetch(`https://api.github.com/repos/${r}/contents/${FILE}`, {
        headers: { Accept: "application/vnd.github.raw+json" },
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (!risposta.ok) errore = motivoHttp(risposta.status);
      else {
        const v = L.valida(testoDaGithub(await risposta.text()));
        const p = await predefinita();
        if (!v.ok) errore = v.errore;
        else if (p.ok && v.revision < p.revision) errore = "il file remoto è più vecchio di quello installato";
        else nuova = { ok: true, revision: v.revision, links: v.links, scartati: v.scartati, at: ora, repo: r };
      }
    } catch (e) {
      errore = e?.name === "AbortError" ? "nessuna risposta in tempo" : "rete non raggiungibile";
    } finally {
      clearTimeout(timer);
    }

    const dopo = await stato();
    if (nuova) await chrome.storage.local.set({ [CHIAVE]: { ...dopo, cache: nuova, okAt: ora, errore: null } });
    else await chrome.storage.local.set({ [CHIAVE]: { ...dopo, errore } });
    return nuova ? { aggiornato: true } : { aggiornato: false, errore };
  }

  /**
   * Collega gli elementi [data-link] e riempie i contenitori [data-link-elenco].
   * Un elemento senza testo proprio riceve l'etichetta come aria-label e title.
   */
  function collega(radice, r) {
    for (const a of radice.querySelectorAll("[data-link]")) {
      const l = L.link(r, a.dataset.link);
      if (!l) {
        a.hidden = true;
        a.removeAttribute("href");
        continue;
      }
      a.href = l.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      if (a.hasAttribute("data-link-etichetta")) {
        const t = a.querySelector(".link-label");
        if (t) t.textContent = l.label;
        a.title = l.description || l.label;
      } else if (!a.textContent.trim()) {
        a.setAttribute("aria-label", l.label);
        a.title = l.label;
      }
      a.hidden = false;
    }

    for (const box of radice.querySelectorAll("[data-link-elenco]")) {
      const escludi = new Set((box.dataset.linkEscludi || "").split(/\s+/).filter(Boolean));
      const voci = L.elenco(r).filter((v) => !escludi.has(v.id));
      box.textContent = "";
      for (const v of voci) {
        const a = document.createElement("a");
        a.className = "link-item";
        a.href = v.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.dataset.linkId = v.id;
        const testo = document.createElement("span");
        testo.className = "link-text";
        const b = document.createElement("b");
        b.textContent = v.label;
        testo.append(b);
        if (v.description) {
          const small = document.createElement("small");
          small.textContent = v.description;
          testo.append(small);
        }
        a.append(icona(v.id), testo);
        box.append(a);
      }
      box.hidden = !voci.length;
    }

    for (const n of radice.querySelectorAll("[data-link-icona]")) {
      if (!n.firstElementChild) n.append(icona(n.dataset.linkIcona));
    }
  }

  /**
   * Uso tipico in una pagina: mostra subito quello che c'e', poi rinnova se
   * e' il momento e ricollega. Non lancia mai: i link non sono essenziali.
   */
  async function avvia(radice = document, { forza = false, dopo = null } = {}) {
    try {
      collega(radice, await risolti());
      dopo?.(await risolti(), await stato());
      const esito = await aggiorna({ forza });
      if (esito.aggiornato || esito.errore) {
        const r = await risolti();
        collega(radice, r);
        dopo?.(r, await stato());
      }
      return esito;
    } catch {
      return { aggiornato: false, errore: "interno" };
    }
  }

  root.LinkChrome = { CHIAVE, ICONE, icona, predefinita, risolti, stato, aggiorna, collega, avvia, testoDaGithub, remotoAttivo };
})(typeof window !== "undefined" ? window : globalThis);
