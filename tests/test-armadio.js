// 2.2.0 — Valore dell'armadio: aggiornamento progressivo, niente doppioni,
// niente prezzi su esiti incerti. Regole (armadio-logica, analisi) e service
// worker vero, con letture delle card e ripubblicazioni che arrivano insieme.
const fs = require('fs');
const path = require('path');
const AL = require(path.join(__dirname, '..', 'src/armadio-logica.js'));
const AN = require(path.join(__dirname, '..', 'src/analisi.js'));
const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);
const ORA = 1_700_000_000_000;

// ------------------------------------------------------------- regole
let stato = { inventory: {
  '1': { title: 'A', price: 10, firstSeen: ORA - 9e8, views: 5, series: [[ORA - 1000, 5]] },
  '2': { title: 'B', price: 20, firstSeen: ORA - 9e8 },
  '3': { title: 'C', price: 5, firstSeen: ORA - 9e8 },
}, vrSnapshots: [], vrInventoryReplaced: {} };
const valore = () => AN.valoreTotale(stato.inventory).totale;
ok('valore iniziale: somma dei prezzi (definizione invariata)', valore() === 35);

// 1. pubblicazione confermata, 5. con prezzo cambiato
let r = AL.sostituisci(stato, { oldId: '1', newId: '101', vecchio: { title: 'A', price: 10 }, nuovo: { title: 'A', price: 9 } }, ORA);
stato = { ...stato, ...r };
ok('1. ripubblicazione confermata: il valore si aggiorna subito', valore() === 34 && !stato.inventory['1'] && stato.inventory['101'].price === 9);
ok('   anzianità, miniatura e visite precedenti conservate nella fotografia', stato.inventory['101'].firstSeen === ORA - 9e8 && stato.vrSnapshots[0].viewsBefore === 5);
// 4. progressivo
r = AL.sostituisci(stato, { oldId: '2', newId: '102', nuovo: { title: 'B', price: 18 } }, ORA + 1); stato = { ...stato, ...r };
ok('4. articolo per articolo: dopo la seconda il totale è già giusto', valore() === 32);
// 7. stessa sostituzione due volte (messaggio ripetuto, verifica dopo un esito già registrato)
r = AL.sostituisci(stato, { oldId: '2', newId: '102', nuovo: { title: 'B', price: 18 } }, ORA + 2); stato = { ...stato, ...r };
ok('7. la stessa ripubblicazione registrata due volte non conta doppio', valore() === 32 && stato.vrSnapshots.length === 2);
// 6. annuncio già presente / card vecchia rimasta a schermo
r = AL.annota(stato, { '2': { title: 'B', price: 20 }, '3': { title: 'C', price: 6 } }, ORA + 3); stato = { ...stato, inventory: r.inventory };
ok('6. card del vecchio annuncio ancora a schermo: ignorata, niente doppione', !stato.inventory['2'] && r.ignorati.join() === '2' && valore() === 33);
ok('   card di un articolo già presente: aggiorna il prezzo, non aggiunge', Object.keys(stato.inventory).length === 3 && stato.inventory['3'].price === 6);
ok('   letture non valide scartate', AL.annota(stato, { abc: { price: 1 } }).cambiati === 0);
// 2-3. pubblicazione non riuscita / incerta: niente sostituzione → valore invariato; stato provvisorio
const coda = { items: [{ id: '3', status: 'verify' }, { id: '9', status: 'working' }, { id: '7', status: 'error' }] };
const sv = AN.statoValore(stato.inventory, coda);
ok('2-3. fallito o incerto: il totale non cambia, e il dato si dice provvisorio', sv.totale === 33 && sv.provvisorio && sv.daVerificare === 1 && sv.inCorso === 1 && /da verificare/.test(sv.nota));
ok('   senza niente in sospeso il totale non è provvisorio', !AN.statoValore(stato.inventory, { items: [{ status: 'done' }] }).provvisorio);
ok('   annuncio sparito da Vinted (letto in verifica) tolto dal totale', AN.valoreTotale(AL.rimuovi(stato, '3').inventory).totale === 27);

// ------------------------------------------- service worker: 8. un solo scrittore
let store = {}, alarms = {};
const L = { alarm: [], message: [] };
const tardi = (v) => new Promise((res) => setTimeout(() => res(v), Math.random() * 6));
const cp = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
global.chrome = {
  storage: {
    local: {
      get: async (k) => {
        if (k === null) return tardi(cp(store));
        if (typeof k === 'string') return tardi({ [k]: cp(store[k]) });
        if (Array.isArray(k)) { const o = {}; for (const x of k) o[x] = cp(store[x]); return tardi(o); }
        const o = {}; for (const [a, b] of Object.entries(k || {})) o[a] = a in store ? cp(store[a]) : b; return tardi(o);
      },
      set: async (o) => tardi(Object.assign(store, cp(o))),
      remove: async (k) => tardi([].concat(k).forEach((x) => delete store[x])),
    },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {} },
  },
  alarms: { create: (n, o) => { alarms[n] = o.when; }, clear: (n) => { delete alarms[n]; }, get: async () => undefined, onAlarm: { addListener: (f) => L.alarm.push(f) } },
  idle: { queryState: async () => 'active' },
  tabs: { query: async () => [], get: async () => { throw new Error('x'); }, sendMessage: async () => ({}) },
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p) => p, getManifest: () => ({ version: '2.2.0' }),
    onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  webRequest: { onSendHeaders: { addListener() {} }, onBeforeRequest: { addListener() {} } },
};
require(path.join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'));
const invia = (msg) => new Promise((res) => { for (const f of L.message) if (f(msg, {}, res)) return; res(null); });

(async () => {
  // 40 giri: letture delle card e ripubblicazioni nello stesso momento (come una
  // scheda che guarda l'armadio mentre la coda pubblica). Fino alla 2.1 ognuna
  // leggeva e riscriveva l'inventario per conto suo e una poteva cancellare l'altra.
  let persi = 0, doppi = 0;
  for (let giro = 0; giro < 40; giro++) {
    store = { inventory: { '1': { title: 'A', price: 10 }, '2': { title: 'B', price: 20 }, '3': { title: 'C', price: 5 } } };
    await Promise.all([
      invia({ type: 'vr:inventarioAnnota', voci: { '2': { title: 'B', price: 21 }, '3': { title: 'C', price: 5 } } }),
      invia({ type: 'vr:inventarioSostituisci', oldId: '1', newId: '11', vecchio: { price: 10 }, nuovo: { title: 'A', price: 9 } }),
      invia({ type: 'vr:inventarioAnnota', voci: { '1': { title: 'A', price: 10 } } }),        // card vecchia ancora a schermo
    ]);
    const inv = store.inventory;
    if (!inv['11'] || inv['2'].price !== 21) persi++;
    if (inv['1'] && inv['11']) doppi++;
  }
  ok(`8. letture e ripubblicazioni simultanee: nessun aggiornamento perso (${persi}/40)`, persi === 0);
  ok(`   e nessun annuncio contato due volte (${doppi}/40)`, doppi === 0);
  ok('   sincronizzazione tra schermate: tutte leggono lo stesso inventario scritto da uno solo', AN.valoreTotale(store.inventory).totale === 9 + 21 + 5);

  console.log(out.join('\n'));
  process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
})();
