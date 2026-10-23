// Completa un chrome finto con le API usate dal service worker 2.x, senza
// toccare quello che il singolo test ha gia' definito a modo suo.
const fs = require('fs');
const path = require('path');

// Radice dell'estensione: nel repository i test stanno in tests/, qui accanto.
const RADICE = fs.existsSync(path.join(__dirname, '..', 'src', 'coda-logica.js'))
  ? path.join(__dirname, '..')
  : require('path').join(__dirname, '..');

module.exports = function completa(chrome) {
  const vuoto = () => ({ addListener() {} });
  // Il service worker carica il modello della coda con importScripts.
  global.self = global;
  global.importScripts = (...file) => {
    for (const f of file) {
      if (/coda-logica\.js$/.test(f)) global.CodaLogica = require(path.join(RADICE, f));
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
