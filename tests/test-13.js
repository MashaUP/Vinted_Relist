// Simulatore del service worker, esteso alle feature nuove.
const fs = require('fs');
let store = {}, alarms = {}, tabs = [{ id: 1, status: 'complete' }];
let idle = 'active', notifiche = [];
const L = { alarm: [], message: [] };

global.chrome = {
  storage: {
    local: {
      get: async (k) => {
        if (typeof k === 'string') return { [k]: store[k] };
        if (k && !Array.isArray(k)) { const o = {}; for (const [a,b] of Object.entries(k)) o[a] = a in store ? store[a] : b; return o; }
        return store;
      },
      set: async (o) => Object.assign(store, o),
      remove: async (k) => { delete store[k]; },
    },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener: () => {} },
  },
  alarms: {
    create: (n, o) => { alarms[n] = o.when ?? Date.now() + o.delayInMinutes * 60000; },
    clear: (n) => { delete alarms[n]; },
    onAlarm: { addListener: (f) => L.alarm.push(f) },
  },
  idle: { queryState: async () => idle },
  notifications: { create: (id, o) => notifiche.push(o || id) },
  tabs: { query: async () => tabs, sendMessage: async () => { if (!tabs.length) throw new Error('x'); return {}; } },
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p) => p, onStartup:{addListener:()=>{}}, onInstalled:{addListener:()=>{}} },
  webRequest: { onSendHeaders: { addListener: () => {} }, onBeforeRequest: { addListener: () => {} } },
};
require(require('path').join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(require('path').join(__dirname, '..', 'background.js'),'utf8'));

const invia = (m) => new Promise((r) => { for (const f of L.message) if (f(m, {}, r)) return; r(null); });
const sveglia = async (n) => { delete alarms[n]; for (const f of L.alarm) await f({ name: n }); };
const pausa = () => new Promise((r) => setTimeout(r, 15));
const items = (n) => Array.from({length:n},(_,i)=>({id:String(i+1),title:'A'+(i+1)}));

(async () => {
  const out = []; const ok = (n,c) => out.push(`  ${c?'OK  ':'FAIL'} ${n}`);

  // --- avvio programmato ---
  const fra2h = Date.now() + 7200000;
  await invia({ type:'vr:queueStart', items: items(2), intervalMin: 20, startAt: fra2h });
  await pausa();
  ok('stato programmata', store.vrQueue.state === 'scheduled');
  ok('non parte subito', store.vrQueue.items[0].status === 'pending');
  ok('alarm all\u0027ora esatta, senza scarto', alarms['vr:queueNext'] === fra2h);
  await invia({ type:'vr:queueStop' }); await pausa();

  // --- ritmo irregolare ---
  store = {}; alarms = {};
  await invia({ type:'vr:queueStart', items: items(3), intervalMin: 20 });
  await pausa();
  await invia({ type:'vr:relistDone', itemId:'1', ok:true }); await pausa();
  const d1 = (alarms['vr:queueNext'] - Date.now())/60000;
  ok(`scarto entro ±30% (${d1.toFixed(1)} min)`, d1 >= 14 && d1 <= 26);

  const ritardi = new Set();
  for (let i=0;i<6;i++) { store.vrQueue.items[1].status='working'; store.vrQueue.items[1].startedAt=Date.now(); store.vrQueue.state='working';
    await invia({ type:'vr:relistDone', itemId:'2', ok:true }); await pausa();
    ritardi.add(Math.round((alarms['vr:queueNext']-Date.now())/1000)); }
  ok('gli intervalli non sono tutti uguali', ritardi.size > 1);

  // --- sentinella antibot ---
  store = {}; alarms = {};
  await invia({ type:'vr:queueStart', items: items(3), intervalMin: 20 }); await pausa();
  await invia({ type:'vr:relistDone', itemId:'1', ok:false, error:'429', blocked:true }); await pausa();
  let q = store.vrQueue;
  ok('il blocco non consuma l\u0027articolo', q.items[0].status === 'pending' && q.items[0].id === '1');
  ok('primo rallentamento 5 min', Math.round((alarms['vr:queueNext']-Date.now())/60000) === 5);
  ok('nota mostrata', /pausa 5 min/i.test(q.note));
  await sveglia('vr:queueNext'); await pausa();
  await invia({ type:'vr:relistDone', itemId:'1', ok:false, error:'429', blocked:true }); await pausa();
  ok('secondo rallentamento 15 min', Math.round((alarms['vr:queueNext']-Date.now())/60000) === 15);
  await sveglia('vr:queueNext'); await pausa();
  await invia({ type:'vr:relistDone', itemId:'1', ok:false, error:'429', blocked:true }); await pausa();
  ok('terzo rallentamento 45 min', Math.round((alarms['vr:queueNext']-Date.now())/60000) === 45);
  await sveglia('vr:queueNext'); await pausa();
  await invia({ type:'vr:relistDone', itemId:'1', ok:false, error:'429', blocked:true }); await pausa();
  ok('dopo tre tentativi si ferma', !store.vrQueue.running);
  ok('motivo registrato', /continua a bloccare/i.test(store.vrQueue.note));
  await invia({ type:'vr:relistDone', itemId:'1', ok:true }); await pausa();

  // --- ripresa normale dopo un blocco ---
  store = {}; alarms = {};
  await invia({ type:'vr:queueStart', items: items(2), intervalMin: 20 }); await pausa();
  await invia({ type:'vr:relistDone', itemId:'1', ok:false, error:'429', blocked:true }); await pausa();
  await sveglia('vr:queueNext'); await pausa();
  await invia({ type:'vr:relistDone', itemId:'1', ok:true }); await pausa();
  ok('il contatore di blocchi si azzera', store.vrQueue.backoff === 0 && !store.vrQueue.note);

  // --- attesa se non sei al computer ---
  store = {}; alarms = {}; idle = 'idle';
  await invia({ type:'vr:queueStart', items: items(2), intervalMin: 20 }); await pausa();
  ok('inattivo: non ripubblica', store.vrQueue.items[0].status === 'pending' && store.vrQueue.state !== 'working');
  ok('riprova a breve', Math.round((alarms['vr:queueNext']-Date.now())/60000) === 2);
  idle = 'active';
  await sveglia('vr:queueNext'); await pausa();
  ok('tornato attivo: riparte', store.vrQueue.state === 'working');

  // --- notifica finale ---
  notifiche = [];
  await invia({ type:'vr:relistDone', itemId:'1', ok:true }); await pausa();
  await sveglia('vr:queueNext'); await pausa();
  await invia({ type:'vr:relistDone', itemId:'2', ok:false, error:'boh' }); await pausa();
  ok('notifica inviata a fine coda', notifiche.length === 1);
  ok('conteggi nella notifica', /1 ripubblicati, 1 falliti/.test(notifiche[0]?.message || ''));

  // --- overrides in blocco ---
  store = {}; alarms = {};
  await invia({ type:'vr:queueStart', items: items(1), intervalMin: 5, overrides: { pricePercent: -10 } });
  await pausa();
  ok('overrides conservati nella coda', store.vrQueue.overrides.pricePercent === -10);

  console.log(out.join('\n'));
  process.exit(out.some(x=>x.includes('FAIL'))?1:0);
})();
