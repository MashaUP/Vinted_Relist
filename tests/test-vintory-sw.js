// 2.5.0 «Ripubblica da Vintory» nel service worker vero: filtro all'ingresso,
// messaggio alla pagina, registro dei ripubblicati, pulizia delle foto in IndexedDB,
// foto mai in chrome.storage, duplicati, riavvio, convivenza con una batch normale.
const fs = require('fs');
const path = require('path');
const out = []; const ok = (n, c, extra = '') => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}${!c && extra ? ` — ${extra}` : ''}`);
const art = (...ids) => ids.map((id) => ({ id: String(id), title: `Art ${id}`, price: 10 }));
const MIN = 60_000;

let store = {}, alarms = {};
let inviati = [];
const L = { alarm: [], message: [] };
const tardi = (v) => new Promise((r) => setTimeout(() => r(v), Math.random() * 4));
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
  alarms: {
    create: (n, o) => { alarms[n] = o.when ?? Date.now() + (o.delayInMinutes || 0) * 60000; },
    clear: (n) => { delete alarms[n]; }, get: async (n) => (alarms[n] ? { name: n } : undefined),
    onAlarm: { addListener: (f) => L.alarm.push(f) },
  },
  idle: { queryState: async () => 'active' },
  tabs: {
    query: async () => [{ id: 1, status: 'complete' }],
    get: async (id) => ({ id }),
    sendMessage: async (_id, msg) => { inviati.push(cp(msg)); return msg.type === 'vr:relistStatus' ? { inCorso: true } : { accepted: true }; },
  },
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p) => p, getManifest: () => ({ version: '2.6.1' }),
    onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  webRequest: { onSendHeaders: { addListener() {} }, onBeforeRequest: { addListener() {} } },
};
require(path.join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'));
const invia = (msg) => new Promise((res) => { for (const f of L.message) if (f(msg, {}, res)) return; res(null); });
const sveglia = async (n) => { delete alarms[n]; for (const f of L.alarm) await f({ name: n }); };
const calma = () => new Promise((res) => setTimeout(res, 40));
const q = () => store.vrQueue;
const a = (id) => q().items.find((i) => i.id === String(id));
const fine = async (id, esito = { ok: true }) => { await invia({ type: 'vr:relistDone', itemId: String(id), avviatoAt: a(id).startedAt, ...esito }); await calma(); };
const attesaMin = () => Math.round(((alarms['vr:queueNext'] || 0) - Date.now()) / MIN);
const corrente = () => q().items.find((i) => i.status === 'working')?.id;
const azzera = () => { store = { humanRhythm: false }; alarms = {}; inviati = []; };


const DB = global.VintoryDB;
const K = (id) => `vintory:${id}:${String(id).padStart(16, '0').slice(-16)}`;
const importa = async (id, { at = Date.now() - 3600e3, foto = 2 } = {}) => DB.salva({ chiave: K(id), id: String(id), at, titolo: `V ${id}`,
  sorgente: { id: String(id), title: `V ${id}`, user_id: '77', price: { amount: '5' } },
  foto: Array.from({ length: foto }, (_, i) => ({ blob: new Blob([Buffer.from(`foto-${id}-${i}-`.repeat(200))], { type: 'image/jpeg' }), tipo: 'image/jpeg', sha256: 'a'.repeat(64) })) });
const vin = (id, o = {}) => ({ id: String(id), title: `V ${id}`, price: 5, vintory: { chiave: K(id), elimina: false, foto: 2, ...o } });
const sincro = async () => { await calma(); if (q()) await sincronizzaVintory(q()); };

(async () => {
  await calma();
  azzera(); DB.__dati.clear();
  // 1. senza foto salvate: rifiutato
  let r = await invia({ type: 'vr:queueStart', items: [vin(101)], intervalMin: 20 }); await calma();
  ok('W1. da Vintory senza foto salvate in IndexedDB: rifiutato con il motivo', r.ok === false && /non salvate/.test(r.error || ''), JSON.stringify(r));
  // 2. con le foto: entra, con il riferimento; una batch normale e una da Vintory, ognuna col suo intervallo
  await importa(101); await importa(102); await importa(103);
  r = await invia({ type: 'vr:queueStart', items: art(11), intervalMin: 20 }); await calma();
  r = await invia({ type: 'vr:queueAdd', items: [vin(101), vin(102), vin(103)], batch: { overrides: { priceDelta: 0 }, intervalMin: 3 } }); await calma();
  ok('W2. batch da Vintory aggiunta alla coda in corso, con il suo intervallo', r.ok && r.aggiunti.length === 3 && q().batches[1].intervalMin === 3 && q().batches[0].intervalMin === 20 && a(101).vintory?.chiave === K(101));
  ok('W3. la coda in corso non si ferma: lavora ancora il primo della batch normale', corrente() === '11');
  // 3. stesso annuncio due volte: niente doppione
  r = await invia({ type: 'vr:queueAdd', items: [vin(101)], batch: { overrides: null } }); await calma();
  ok('W4. stesso annuncio da Vintory ancora: rifiutato (già in coda)', (r.rifiutati || []).some((x) => x.id === '101') && q().items.filter((i) => i.id === '101').length === 1);
  // 4. la pagina riceve il riferimento
  await fine(11);
  ok('    dopo la batch normale: attesa della batch Vintory (3 minuti)', attesaMin() === 3);
  inviati = [];
  await sveglia('vr:queueNext'); await calma();
  const msg = inviati.find((m) => m.type === 'vr:relistOne');
  ok('W5. alla pagina arriva il riferimento a Vintory (chiave, elimina = no)', msg?.itemId === '101' && msg.vintory?.chiave === K(101) && msg.vintory.elimina === false);
  // 5. dati e foto alla pagina, in base64; le foto mai in chrome.storage
  const d = await invia({ type: 'vr:vintoryDati', chiave: K(101) });
  const f = await invia({ type: 'vr:vintoryFoto', chiave: K(101), i: 1 });
  ok('W6. dati e foto dalla IndexedDB alla pagina (base64 uguale al file)', d.ok && d.foto === 2 && f.ok && Buffer.from(f.base64, 'base64').toString().startsWith('foto-101-1-'));
  ok('W7. nessuna foto in chrome.storage (spazio occupato piccolo)', JSON.stringify(store).length < 20000 && !JSON.stringify(store).includes('foto-101'), String(JSON.stringify(store).length));
  // 6. pubblicato: registro e foto cancellate
  await fine(101, { ok: true, nuovoId: '90101' }); await sincro();
  ok('W8. pubblicato: nel registro (id originale → nuovo), foto cancellate', store.vintoryOrigine?.['101']?.nuovoId === '90101' && !(await DB.esiste(K(101))));
  // 7. riaperto lo stesso ZIP: rifiutato salvo «di nuovo»
  await importa(101);
  r = await invia({ type: 'vr:queueAdd', items: [vin(101)], batch: { overrides: null } }); await calma();
  ok('W9. già ripubblicato da Vintory: rifiutato', (r.rifiutati || []).some((x) => x.id === '101' && /già ripubblicato da Vintory/.test(x.motivo)));
  // 8. tolto dalla coda: foto cancellate
  await invia({ type: 'vr:queueRemove', ids: ['103'] }); await calma(); await sincro();
  ok('W10. tolto dalla coda: le sue foto spariscono dalla IndexedDB', !(await DB.esiste(K(103))) && await DB.esiste(K(102)));
  // 9. esito incerto: blocca il secondo tentativo, foto tenute
  await sveglia('vr:queueNext'); await calma();
  await fine(102, { ok: false, outcome: 'uncertain', error: 'Vinted non ha risposto', categoria: 'incerto', sicuro: 'no' }); await sincro();
  ok('W11. esito incerto: da verificare, foto tenute', a(102).status === 'verify' && await DB.esiste(K(102)));
  // la coda e' finita: si prova a ripartire con lo stesso annuncio
  r = await invia({ type: 'vr:queueStart', items: [vin(102)], intervalMin: 20 }); await calma();
  ok('W12. da verificare: non si rimette in coda', r.ok === false && (r.rifiutati || []).some((x) => x.id === '102' && /verificare/.test(x.motivo)), JSON.stringify(r));
  // 10. riavvio del browser a metà coda: la coda e le foto ci sono ancora
  azzera(); DB.__dati.clear();
  await importa(201); await importa(202);
  await invia({ type: 'vr:queueStart', items: [vin(201), vin(202)], intervalMin: 7 }); await calma();
  ok('    coda da Vintory partita', corrente() === '201');
  await fine(201, { ok: true, nuovoId: '90201' }); await sincro();
  const salvata = JSON.parse(JSON.stringify(q()));
  await recuperaCoda(); await calma();
  ok('W13. riavvio: coda intatta, il prossimo ha ancora il riferimento e le sue foto', q().items[1].vintory?.chiave === K(202) && await DB.esiste(K(202)) && q().state === salvata.state);
  // 11. fallito per un problema recuperabile: foto tenute per riprovare
  await sveglia('vr:queueNext'); await calma();
  await fine(202, { ok: false, outcome: 'error', error: 'Vinted ha rifiutato', categoria: 'dati', sicuro: 'si' }); await sincro();
  ok('W14. fallito ma riprovabile: foto tenute (si può riprovare o riprendere la sessione)', await DB.esiste(K(202)));
  // 12. un'importazione appena salvata non viene cancellata dalla pulizia
  await importa(301, { at: Date.now() });
  await invia({ type: 'vr:vintoryPulisci' });
  ok('W15. foto appena salvate (in arrivo in coda) non cancellate dalla pulizia', await DB.esiste(K(301)));
  // 13. «ancora online»: saltato senza fermare la coda
  azzera(); DB.__dati.clear(); await importa(401); await importa(402);
  await invia({ type: 'vr:queueStart', items: [vin(401), vin(402)], intervalMin: 5 }); await calma();
  await fine(401, { ok: false, outcome: 'skipped', motivoSalto: 'online', error: 'Ancora online su Vinted', categoria: 'online', sicuro: 'no' }); await sincro();
  ok('W16. ancora online senza la scelta: saltato, la coda continua, foto cancellate', a(401).status === 'skipped' && q().running && q().state === 'waiting' && !(await DB.esiste(K(401))));
  // 14. riferimento di un altro annuncio: rifiutato
  r = await invia({ type: 'vr:queueAdd', items: [{ id: '403', title: 'x', vintory: { chiave: K(402) } }], batch: { overrides: null } }); await calma();
  ok('W17. riferimento che non corrisponde all\'id: rifiutato', (r.rifiutati || []).some((x) => x.id === '403'));

  console.log(out.join('\n'));
  const ko = out.filter((x) => x.includes('FAIL')).length;
  console.log(`${out.length - ko} OK, ${ko} FAIL`);
  process.exit(ko ? 1 : 0);
})();
