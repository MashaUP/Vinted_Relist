// Completa un chrome finto con le API usate dal service worker 2.x, senza
// toccare quello che il singolo test ha gia' definito a modo suo.
const fs = require('fs');
const path = require('path');

// Radice dell'estensione: nel repository i test stanno in tests/, qui accanto.
const RADICE = fs.existsSync(path.join(__dirname, '..', 'src', 'coda-logica.js'))
  ? path.join(__dirname, '..')
  : require('path').join(__dirname, '..');

function archivioMemoria() {
  const m = new Map();
  return {
    __dati: m,
    salva: async (v) => { m.set(v.chiave, v); },
    leggi: async (k) => { const v = m.get(k); return v ? { chiave: v.chiave, id: v.id, at: v.at, titolo: v.titolo, sorgente: v.sorgente, foto: (v.foto || []).map((f) => ({ tipo: f.tipo, sha256: f.sha256, size: f.blob?.size || 0 })) } : null; },
    foto: async (k, i) => m.get(k)?.foto?.[i]?.blob || null,
    esiste: async (k) => m.has(k),
    elimina: async (k) => { m.delete(k); },
    elenco: async () => [...m.values()].map((v) => ({ chiave: v.chiave, id: v.id, at: v.at, foto: (v.foto || []).length, byte: 0 })),
  };
}

module.exports = function completa(chrome) {
  const vuoto = () => ({ addListener() {} });
  // Il service worker carica il modello della coda con importScripts.
  global.self = global;
  global.importScripts = (...file) => {
    for (const f of file) {
      if (/coda-logica\.js$/.test(f)) global.CodaLogica = require(path.join(RADICE, f));
      if (/armadio-logica\.js$/.test(f)) global.ArmadioLogica = require(path.join(RADICE, f));
      if (/versione\.js$/.test(f)) global.Versione = require(path.join(RADICE, f));
      if (/vintory-logica\.js$/.test(f)) global.VintoryLogica = require(path.join(RADICE, f));
      if (/i18n\.js$/.test(f)) global.I18N = require(path.join(RADICE, f));
      // IndexedDB non c'e' in Node: archivio in memoria con la stessa interfaccia (un test puo' metterne uno suo)
      if (/vintory-db\.js$/.test(f) && !global.VintoryDB) global.VintoryDB = archivioMemoria();
    }
  };
  chrome.storage.session = chrome.storage.session || {};
  const sessione = {};
  chrome.storage.session.get = chrome.storage.session.get || (async (k) => (typeof k === 'string' ? { [k]: sessione[k] } : { ...sessione }));
  chrome.storage.session.set = chrome.storage.session.set || (async (o) => Object.assign(sessione, o));
  chrome.storage.session.__dati = sessione;
  chrome.notifications = chrome.notifications || {};
  chrome.notifications.create = chrome.notifications.create || (() => {});
  chrome.notifications.clear = chrome.notifications.clear || (() => {});
  chrome.notifications.onClicked = chrome.notifications.onClicked || vuoto();
  chrome.action = chrome.action || { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} };
  chrome.downloads = chrome.downloads || { onChanged: vuoto(), download: async () => 1, search: async () => [] };
  chrome.runtime.onStartup = chrome.runtime.onStartup || vuoto();
  chrome.runtime.onInstalled = chrome.runtime.onInstalled || vuoto();
  chrome.runtime.getManifest = chrome.runtime.getManifest || (() => ({ version: '2.0.0' }));
  chrome.runtime.getContexts = chrome.runtime.getContexts || (async () => []);
  chrome.runtime.getURL = chrome.runtime.getURL || ((p) => p);
  chrome.storage.onChanged = chrome.storage.onChanged || vuoto();
  chrome.alarms.get = chrome.alarms.get || (async () => undefined);
  chrome.tabs.create = chrome.tabs.create || (async () => ({}));
  chrome.tabs.update = chrome.tabs.update || (async () => ({}));
  chrome.windows = chrome.windows || { update: async () => {} };
  return chrome;
};
