// 2.7.1 — Token di sessione nel service worker: per sito, dati solo alla scheda di quel
// sito, dimenticati quando Vinted li rifiuta; esito delle letture senza valori; report.
// In piu': classificazione dell'errore in coda e domini uguali in tutti i file.
const fs = require('fs');
const path = require('path');
const out = []; const ok = (n, c, extra = '') => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}${!c && extra ? ` — ${extra}` : ''}`);
const RADICE = path.join(__dirname, '..');

let store = {};
let sessione = {};
const ascoltatori = [];
const L = { message: [] };
const cp = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const area = (dati) => ({
  get: async (k) => {
    if (k === null || k === undefined) return cp(dati());
    if (typeof k === 'string') return { [k]: cp(dati()[k]) };
    if (Array.isArray(k)) { const o = {}; for (const x of k) o[x] = cp(dati()[x]); return o; }
    const o = {}; for (const [a, b] of Object.entries(k || {})) o[a] = a in dati() ? cp(dati()[a]) : b; return o;
  },
  set: async (o) => { Object.assign(dati(), cp(o)); },
  remove: async (k) => { [].concat(k).forEach((x) => delete dati()[x]); },
});
global.chrome = {
  storage: { local: area(() => store), session: area(() => sessione), onChanged: { addListener() {} } },
  alarms: { create() {}, clear() {}, get: async () => undefined, getAll: async () => [], onAlarm: { addListener() {} } },
  idle: { queryState: async () => 'active' },
  tabs: { query: async () => [], get: async (id) => ({ id }), sendMessage: async () => ({}) },
  permissions: { getAll: async () => ({ permissions: [] }), contains: async () => true },
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p) => p, getManifest: () => ({ version: '2.7.1', permissions: [], host_permissions: [] }),
    onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  webRequest: { onSendHeaders: { addListener: (f, filtro, extra) => ascoltatori.push({ f, filtro, extra }) }, onBeforeRequest: { addListener() {} } },
};
require(path.join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(path.join(RADICE, 'background.js'), 'utf8'));
const invia = (msg, sender = {}) => new Promise((res) => { for (const f of L.message) if (f(msg, sender, res)) return; res(null); });
const calma = () => new Promise((res) => setTimeout(res, 20));
const api = ascoltatori.find((a) => a.filtro.urls.some((u) => u.includes('/api/')) && !a.filtro.types);
const chiamata = (url, csrf, anon) => api.f({ url, requestHeaders: [...(csrf ? [{ name: 'X-CSRF-Token', value: csrf }] : []), ...(anon ? [{ name: 'X-Anon-Id', value: anon }] : [])] });
const daScheda = (o) => ({ origin: o, tab: { id: 1, url: `${o}/member/1` } });

(async () => {
  // ------------------------------------------------ per sito
  chiamata('https://www.vinted.it/api/v2/notifications', 'TOKEN-IT-0123456789abcdef', 'anon-it');
  await calma();
  chiamata('https://www.vinted.fr/api/v2/notifications', 'TOKEN-FR-0123456789abcdef', 'anon-fr');
  await calma();
  ok('1. token salvati per sito, in storage.session', sessione.vrTokens?.['https://www.vinted.it']?.csrf === 'TOKEN-IT-0123456789abcdef' && sessione.vrTokens?.['https://www.vinted.fr']?.csrf === 'TOKEN-FR-0123456789abcdef' && !JSON.stringify(store).includes('TOKEN-'));
  let r = await invia({ type: 'vr:getTokens', origine: 'https://www.vinted.fr' }, daScheda('https://www.vinted.fr'));
  ok('2. la scheda di vinted.fr riceve solo il token di vinted.fr', r?.tokens?.csrf === 'TOKEN-FR-0123456789abcdef' && r.tokens.anonId === 'anon-fr', JSON.stringify(r));
  r = await invia({ type: 'vr:getTokens', origine: 'https://www.vinted.it' }, daScheda('https://www.vinted.fr'));
  ok('3. il sito lo decide il mittente, non il messaggio', r?.tokens?.csrf === 'TOKEN-FR-0123456789abcdef');
  r = await invia({ type: 'vr:getTokens', origine: 'https://www.vinted.de' }, daScheda('https://www.vinted.de'));
  ok('4. sito supportato ma senza token visti: niente (non quello di un altro sito)', r?.ok && !r.tokens.csrf);
  r = await invia({ type: 'vr:getTokens', origine: 'https://evil.example' }, { origin: 'https://evil.example' });
  ok('5. sito non supportato: niente', r?.ok && !r.tokens.csrf && r.origine === null);
  sessione.vrTokens = { csrf: 'FORMA-VECCHIA-2-7-0-abcdef', anonId: 'x' };
  r = await invia({ type: 'vr:getTokens' }, daScheda('https://www.vinted.fr'));
  ok('6. forma vecchia (2.7.0, un token per tutti i siti): scartata', r?.ok && !r.tokens.csrf);
  chiamata('https://www.vinted.fr/api/v2/x', 'TOKEN-FR-NUOVO-0123456789', null);
  await calma();
  r = await invia({ type: 'vr:getTokens' }, daScheda('https://www.vinted.fr'));
  ok('7. token cambiato durante la navigazione: vince il nuovo', r?.tokens?.csrf === 'TOKEN-FR-NUOVO-0123456789');

  // ------------------------------------------------ rifiutato
  await invia({ type: 'vr:tokenRifiutato', csrf: 'ALTRO-TOKEN-0000000000000' }, daScheda('https://www.vinted.fr'));
  ok('8. «rifiutato» con un valore diverso: non tocca niente', sessione.vrTokens['https://www.vinted.fr'].csrf === 'TOKEN-FR-NUOVO-0123456789');
  await invia({ type: 'vr:tokenRifiutato', csrf: 'TOKEN-FR-NUOVO-0123456789' }, daScheda('https://www.vinted.fr'));
  r = await invia({ type: 'vr:getTokens' }, daScheda('https://www.vinted.fr'));
  ok('9. token rifiutato da Vinted: non si ridà più', !r?.tokens?.csrf);

  // ------------------------------------------------ esito delle letture
  await invia({ type: 'vr:statoSessione', esito: 'ok', fonte: 'pagina', csrf: 'NON-DEVE-ENTRARE-123456' }, daScheda('https://www.vinted.fr'));
  ok('10. esito salvato per sito, solo campi ammessi (niente valori)', sessione.vrSessione?.['https://www.vinted.fr']?.esito === 'ok' && sessione.vrSessione['https://www.vinted.fr'].fonte === 'pagina' && !JSON.stringify(sessione.vrSessione).includes('NON-DEVE'));
  await invia({ type: 'vr:statoSessione', esito: 'errore', categoria: '<script>', fonte: 'x' }, daScheda('https://www.vinted.it'));
  ok('11. categoria o fonte sconosciute: null', sessione.vrSessione['https://www.vinted.it'].categoria === null && sessione.vrSessione['https://www.vinted.it'].fonte === null);
  r = await invia({ type: 'vr:statoSessione', esito: 'boh' }, daScheda('https://www.vinted.it'));
  ok('12. esito sconosciuto: rifiutato', r?.ok === false);

  // ------------------------------------------------ report
  const rep = await invia({ type: 'vr:diagnosi' });
  const s = rep?.sessione || {};
  ok('13. report: siti con token sì/no ed età, ultima lettura con fonte o categoria', Array.isArray(s.siti) && s.siti.some((x) => x.dominio === 'vinted.fr' && x.csrf === false && Number.isInteger(x.daS)) && s.ultimaLettura?.some((x) => x.dominio === 'vinted.fr' && x.fonte === 'pagina'), JSON.stringify(s));
  ok('14. nel report nessun valore di token', !JSON.stringify(rep).includes('TOKEN-IT') && !JSON.stringify(rep).includes('anon-it'));

  // ------------------------------------------------ coda: categoria dell'errore
  const C = require(path.join(RADICE, 'src', 'coda-logica.js'));
  const k = C.classificaErrore(Object.assign(new Error('Account rilevato, ma il token…'), { sessione: true, categoria: 'token-assente' }));
  ok('15. in coda: «Sessione di Vinted non letta», riprovare è sicuro (prima era «Errore interno»)', k.categoria === 'sessione' && k.sicuroRiprovare === 'si' && /Account rilevato/.test(k.cosaFare), JSON.stringify(k));

  // ------------------------------------------------ domini uguali dappertutto
  const m = JSON.parse(fs.readFileSync(path.join(RADICE, 'manifest.json'), 'utf8'));
  const dominiDi = (arr) => [...new Set(arr.map((u) => (u.match(/www\.vinted\.([a-z.]+)\//) || [])[1]).filter(Boolean))].sort().join();
  const elenco = (f) => { const t = fs.readFileSync(path.join(RADICE, f), 'utf8').match(/\[\s*"it","fr"[^\]]*\]/); return t ? JSON.parse(t[0]).sort().join() : null; };
  const atteso = dominiDi(m.host_permissions);
  ok('16. stessi 17 siti in manifest (permessi e content script), service worker, popup, dashboard',
    atteso.split(',').length === 17 && dominiDi(m.content_scripts.flatMap((c) => c.matches)) === atteso && ['background.js', 'src/popup.js', 'src/dashboard.js'].every((f) => elenco(f) === atteso), atteso);
  ok('    vinted.fr compreso', atteso.split(',').includes('fr'));

  const ko = out.filter((x) => x.includes('FAIL')).length;
  console.log(out.join('\n'));
  console.log(`${out.length - ko} OK, ${ko} FAIL`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
