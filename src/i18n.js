/**
 * Lingue dell'interfaccia (2.6.0): italiano (originale), inglese, francese,
 * spagnolo, tedesco. Scelta nel pannello «Lingua» (popup e dashboard), salvata
 * in chrome.storage.local.lingua: "auto" (lingua del browser) o un codice.
 *
 * Come funziona: i testi restano scritti in italiano nel codice; i dizionari
 * (src/lang/<codice>.json) hanno come chiave il testo italiano, con {0}, {1}…
 * al posto delle parti variabili. Un osservatore traduce i nodi di testo e gli
 * attributi (title, placeholder, aria-label, alt) appena compaiono, e ricorda
 * l'originale: cambiando lingua si ritraduce da quello, senza ricaricare.
 *   - pagine dell'estensione: tutta la pagina;
 *   - pagine di Vinted: SOLO gli elementi dell'estensione (classi «vr-…»), mai il sito.
 * Un testo senza traduzione resta in italiano: niente si rompe.
 * Per i testi che non finiscono nel DOM (notifiche) c'e' I18N.t().
 */
(function (root) {
  "use strict";

  const LINGUE = { it: "Italiano", en: "English", fr: "Français", es: "Español", de: "Deutsch" };
  const BANDIERE = { it: "🇮🇹", en: "🇬🇧", fr: "🇫🇷", es: "🇪🇸", de: "🇩🇪" };
  const ATTRIBUTI = ["title", "placeholder", "aria-label", "alt"];
  const LETTERA = /[A-Za-zÀ-ÖØ-öø-ÿ]{2}/;

  let lingua = "it";
  let esatti = new Map();
  let modelli = [];
  const cache = new Map();         // testo italiano → traduzione (o null) per la lingua attuale

  /** Lingua da usare: la scelta, o quella del browser se e' fra le nostre, altrimenti inglese. */
  function scegli(preferenza, browser = "") {
    if (preferenza && preferenza !== "auto" && LINGUE[preferenza]) return preferenza;
    const b = String(browser || "").toLowerCase().slice(0, 2);
    return LINGUE[b] ? b : "en";
  }

  const spazi = (s) => s.replace(/\s+/g, " ").trim();
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** Prepara un dizionario { italiano: traduzione }: chiavi esatte e modelli con {n}. */
  function imposta(codice, dizionario) {
    lingua = LINGUE[codice] ? codice : "it";
    esatti = new Map();
    modelli = [];
    cache.clear();
    if (lingua === "it" || !dizionario) return;
    for (const [k, v] of Object.entries(dizionario)) {
      if (typeof v !== "string" || !v) continue;
      const chiave = spazi(k);
      if (!/\{\d+\}/.test(chiave)) { esatti.set(chiave, v); continue; }
      const ordine = [];
      // Quante lettere fisse: «{0} su {1}» o «{0} {1}» sono troppo generici e
      // catturerebbero frasi intere di altri testi.
      const fisso = (chiave.replace(/\{(\d+)\}/g, "").match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
      if (fisso < 4) continue;
      const re = new RegExp(`^${chiave.split(/(\{\d+\})/).map((p) => {
        const m = p.match(/^\{(\d+)\}$/);
        if (m) { ordine.push(Number(m[1])); return "([\\s\\S]+?)"; }
        return escape(p);
      }).join("")}$`);
      modelli.push({ re, ordine, v, fisso });
    }
    // prima i modelli con piu' testo fisso: «Aggiungi {0} come Batch {1}» batte «Aggiungi {0}»
    modelli.sort((a, b) => b.fisso - a.fisso);
  }

  function conModello(testo, prof) {
    for (const m of modelli) {
      const r = m.re.exec(testo);
      if (!r) continue;
      // una parte variabile non contiene un'altra frase intera
      if (r.slice(1).some((x) => / — |\n/.test(x))) continue;
      const valori = {};
      m.ordine.forEach((n, i) => { valori[n] = prof < 2 ? traduciNucleo(r[i + 1], prof + 1) ?? r[i + 1] : r[i + 1]; });
      return m.v.replace(/\{(\d+)\}/g, (x, n) => (n in valori ? valori[n] : x));
    }
    return null;
  }

  // Testi composti a pezzi: separatori dal piu' forte al piu' debole. Si spezza al
  // primo livello che divide il testo e ogni pezzo si traduce intero (anche lui a pezzi).
  const LIVELLI = [/( — | – )/, /( · | \| |\n)/, /(: |; )/, /(\. (?=[A-ZÀ-Ü«"(\d]))/];

  function perPezzi(testo, prof, livello = 0, fino = LIVELLI.length) {
    for (let l = livello; l < fino; l++) {
      const parti = testo.split(LIVELLI[l]);
      if (parti.length < 2) continue;
      let cambiato = false;
      const fuori = parti.map((p, i) => {
        if (i % 2 === 1 || !LETTERA.test(p)) return p;
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(p);
        const s = spazi(m[2]);
        const t = esatto(s) ?? (prof < 3 ? conModello(s, prof + 1) : null) ?? conNumero(s) ?? perPezzi(s, prof, l + 1);
        if (t != null) { cambiato = true; return m[1] + t + m[3]; }
        return p;
      });
      if (cambiato) return fuori.join("");
    }
    return null;
  }

  /** «3 articoli», «12 foto»: numero davanti a un testo che conosciamo. */
  function conNumero(s) {
    const m = /^([+-]?\d+(?:[.,]\d+)?)\s+(.+)$/.exec(s);
    if (!m) return null;
    const t = esatto(m[2]);
    return t == null ? null : `${m[1]} ${t}`;
  }

  function esatto(p) {
    const s = spazi(p);
    return esatti.get(s) ?? (s.endsWith(".") ? esattiSenzaPunto(s) : esatti.get(`${s}.`)?.replace(/\.$/, "")) ?? null;
  }
  const esattiSenzaPunto = (s) => { const t = esatti.get(s.slice(0, -1)); return t == null ? null : `${t}.`; };

  function traduciNucleo(testo, prof = 0) {
    const s = spazi(testo);
    if (!LETTERA.test(s)) return null;
    if (prof === 0 && cache.has(s)) return cache.get(s);
    // prima i separatori forti («errore — consiglio»), poi i modelli, poi i pezzi piu' piccoli
    const t = esatto(s) ?? perPezzi(s, prof, 0, 1) ?? conModello(s, prof) ?? conNumero(s) ?? perPezzi(s, prof, 1);
    if (prof === 0) cache.set(s, t);
    return t;
  }

  /** Traduce un testo (anche con spazi intorno). Senza traduzione: com'e'. */
  function traduci(testo) {
    if (lingua === "it" || testo == null) return testo;
    const str = String(testo);
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(str);
    if (!m[2]) return str;
    const t = traduciNucleo(m[2]);
    return t == null ? str : m[1] + t + m[3];
  }

  /** Per il codice: t("Aggiungi {0} come Batch {1}", 3, 2). */
  function t(chiave, ...valori) {
    const base = lingua === "it" ? chiave : esatti.get(spazi(chiave)) ?? traduci(chiave);
    return String(base).replace(/\{(\d+)\}/g, (x, n) => (valori[n] != null ? String(valori[n]) : x));
  }

  // ------------------------------------------------------------ DOM

  // Testi dell'utente (titoli e descrizioni degli annunci): mai tradotti.
  const CONTENUTO_UTENTE = '[data-vr-noi18n], a[href*="/items/"], .q-title, .vr-plan__title';
  const testi = new WeakMap();     // nodo di testo → { originale, scritto }
  const attr = new WeakMap();      // elemento → { [attributo]: { originale, scritto } }
  let osservatore = null;
  let dentro = () => true;
  let documento = null;

  function traduciTesto(n) {
    const p = n.parentNode;
    if (!p || p.nodeName === "SCRIPT" || p.nodeName === "STYLE" || p.nodeName === "TEXTAREA" || p.closest?.(CONTENUTO_UTENTE)) return;
    const v = n.nodeValue;
    let r = testi.get(n);
    if (!r || v !== r.scritto) { r = { originale: v, scritto: null }; testi.set(n, r); }
    const nuovo = traduci(r.originale);
    r.scritto = nuovo;
    if (nuovo !== v) n.nodeValue = nuovo;
  }

  function traduciAttributi(el) {
    if (el.closest?.("[data-vr-noi18n]")) return;
    let r = attr.get(el);
    for (const a of ATTRIBUTI) {
      if (!el.hasAttribute?.(a)) continue;
      const v = el.getAttribute(a);
      r ||= {};
      let x = r[a];
      if (!x || v !== x.scritto) { x = { originale: v, scritto: null }; r[a] = x; }
      const nuovo = traduci(x.originale);
      x.scritto = nuovo;
      if (nuovo !== v) el.setAttribute(a, nuovo);
    }
    if (r) attr.set(el, r);
  }

  function percorri(nodo) {
    if (!nodo) return;
    if (nodo.nodeType === 3) { if (dentro(nodo.parentNode)) traduciTesto(nodo); return; }
    if (nodo.nodeType !== 1 && nodo.nodeType !== 9 && nodo.nodeType !== 11) return;
    const radice = nodo.nodeType === 1 ? nodo : nodo.documentElement || nodo;
    const doc = nodo.ownerDocument || nodo;
    const camminatore = doc.createTreeWalker(radice, 5 /* elementi e testi */);
    let n = radice;
    while (n) {
      if (n.nodeType === 3) { if (LETTERA.test(n.nodeValue) && dentro(n.parentNode)) traduciTesto(n); }
      else if (n.nodeType === 1 && dentro(n)) traduciAttributi(n);
      n = camminatore.nextNode();
    }
  }

  function ritraduciTutto() {
    if (!documento) return;
    percorri(documento.body || documento.documentElement);
    if (documento.documentElement && dentro(documento.body)) {
      documento.documentElement.lang = lingua;
      const tt = documento.querySelector("title");
      if (tt) percorri(tt);
    }
  }

  /**
   * Collega la traduzione a un documento.
   *   opzioni.dentro(nodo): quali nodi tradurre (sulle pagine di Vinted: solo l'estensione).
   */
  function collega(doc, opzioni = {}) {
    documento = doc;
    dentro = opzioni.dentro || (() => true);
    osservatore?.disconnect();
    const View = doc.defaultView;
    if (!View?.MutationObserver) return;
    osservatore = new View.MutationObserver((mutazioni) => {
      if (lingua === "it") return;
      for (const m of mutazioni) {
        if (m.type === "characterData") { if (dentro(m.target.parentNode)) traduciTesto(m.target); }
        else if (m.type === "attributes") { if (dentro(m.target)) traduciAttributi(m.target); }
        else for (const n of m.addedNodes) percorri(n);
      }
    });
    osservatore.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTI });
    ritraduciTutto();
  }

  /**
   * Carica e applica una lingua. fonte(codice) → dizionario (le pagine lo leggono
   * da src/lang, la scheda di Vinted lo chiede al service worker).
   */
  async function applica(codice, fonte) {
    const l = LINGUE[codice] ? codice : "it";
    let diz = null;
    if (l !== "it") {
      try { diz = await fonte(l); } catch { diz = null; }
    }
    // Tornare all'italiano: rimette gli originali (traduci() con lingua "it" li lascia com'erano).
    imposta(diz ? l : "it", diz);
    ritraduciTutto();
    return lingua;
  }

  const api = {
    LINGUE, BANDIERE, scegli, imposta, traduci, t, collega, applica, ritraduciTutto,
    get lingua() { return lingua; },
    /** Quanti testi ha il dizionario attuale (per la diagnostica e i test). */
    get voci() { return esatti.size + modelli.length; },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.I18N = api;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
