// Recupero coda, fasce di picco, scansione automatica.
const fs = require('fs');
let store = {}, alarms = {}, tabs = [{id:1,status:'complete'}];
let idle = 'active', notifiche = [];
const L = { alarm: [], message: [], changed: [] };
global.chrome = {
  storage: { local: {
      get: async (k) => { if (typeof k === 'string') return {[k]: store[k]};
        if (k && !Array.isArray(k)) { const o={}; for (const [a,b] of Object.entries(k)) o[a]= a in store?store[a]:b; return o; }
        return store; },
      set: async (o) => Object.assign(store, o), remove: async (k)=>{delete store[k];} },
    session: { get: async()=>({}), set: async()=>{} },
    onChanged: { addListener: (f)=>L.changed.push(f) } },
  alarms: { create:(n,o)=>{alarms[n]= o.when ?? Date.now()+(o.delayInMinutes||0)*60000;},
            clear:(n)=>{delete alarms[n];}, get: async(n)=>alarms[n]?{name:n}:undefined,
            onAlarm:{addListener:(f)=>L.alarm.push(f)} },
  idle: { queryState: async()=>idle },
  notifications: { create:(id,o)=>notifiche.push(o||id) },
  tabs: { query: async()=>tabs, sendMessage: async()=>{ if(!tabs.length) throw new Error('x'); return {}; } },
  runtime: { onMessage:{addListener:(f)=>L.message.push(f)}, onStartup:{addListener:()=>{}},
             onInstalled:{addListener:()=>{}}, getURL:(p)=>p },
  webRequest: { onSendHeaders:{addListener:()=>{}}, onBeforeRequest:{addListener:()=>{}} },
};
require(require('path').join(__dirname, 'sw-stubs.js'))(global.chrome);
const sorgente = fs.readFileSync(require('path').join(__dirname, '..', 'background.js'),'utf8');
eval(sorgente);
const invia=(m)=>new Promise(r=>{for(const f of L.message) if(f(m,{},r)) return; r(null);});
const pausa=()=>new Promise(r=>setTimeout(r,20));
const items=(n)=>Array.from({length:n},(_,i)=>({id:String(i+1),title:'A'+(i+1)}));

(async () => {
  const out=[]; const ok=(n,c)=>out.push(`  ${c?'OK  ':'FAIL'} ${n}`);

  // --- recupero ---
  store.vrQueue = { items: items(5).map((x,i)=>({...x,status:i<2?'done':'pending'})), index:2,
    intervalMin:20, running:true, state:'waiting', nextAt: Date.now()+10*60000, backoff:0 };
  alarms = {};                                  // sveglia persa: ricaricamento estensione
  await recuperaCoda(); await pausa();
  ok('coda senza sveglia va in recovering', store.vrQueue.state === 'recovering');
  ok('conserva il lavoro fatto', store.vrQueue.items.filter(i=>i.status==='done').length === 2);

  await invia({type:'vr:queueRecover'}); await pausa();
  ok('riprende da dove era', store.vrQueue.state === 'working' && store.vrQueue.index === 2);

  // un alarm regolare non deve far scattare il recupero
  store.vrQueue = { items: items(3), index:0, intervalMin:20, running:true,
    state:'waiting', nextAt: Date.now()+60000, backoff:0 };
  alarms = { 'vr:queueNext': Date.now()+60000 };
  await recuperaCoda(); await pausa();
  ok('con la sveglia presente non tocca niente', store.vrQueue.state === 'waiting');

  // risveglio normale: alarm appena consumato, nextAt a ridosso di adesso
  store.vrQueue = { items: items(3), index:0, intervalMin:20, running:true,
    state:'waiting', nextAt: Date.now()-2000, backoff:0 };
  alarms = {};
  await recuperaCoda(); await pausa();
  ok('non scambia per guasto un alarm appena scattato', store.vrQueue.state === 'waiting');

  // articolo rimasto appeso in lavorazione
  store.vrQueue = { items: items(3), index:1, intervalMin:20, running:true,
    state:'working', startedItemAt: Date.now()-20*60000, backoff:0 };
  alarms = {};
  await recuperaCoda(); await pausa();
  ok('articolo appeso: da verificare, non rifatto alla cieca', store.vrQueue.items[1].status === 'verify' && store.vrQueue.index === 2);
  ok('stato recovering', store.vrQueue.state === 'recovering');

  // una coda in pausa non e' rotta
  store.vrQueue = { items: items(3), index:0, running:true, state:'paused',
    pausedRemainingMs: 60000, nextAt: null };
  alarms = {};
  await recuperaCoda(); await pausa();
  ok('la pausa non viene scambiata per guasto', store.vrQueue.state === 'paused');

  // --- fasce di picco ---
  const fasce = leggiFasce("12:30-14:00, 19:30-22:30");
  const alle = (h,m)=>{const d=new Date(); d.setHours(h,m,0,0); return d.getTime();};
  ok('dentro fascia resta com\u0027e\u0027', dentroFascia(alle(13,0), fasce) === alle(13,0));
  const spostato = dentroFascia(alle(9,0), fasce);
  const d = new Date(spostato);
  ok(`le 9:00 slittano all\u0027apertura (${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')})`,
     d.getHours() === 12 && d.getMinutes() >= 30 && d.getMinutes() <= 36);
  const notte = new Date(dentroFascia(alle(23,30), fasce));
  ok('dopo l\u0027ultima fascia passa al giorno dopo', notte.getHours() === 12 && notte.getDate() !== new Date().getDate());
  ok('senza fasce valide non sposta', dentroFascia(alle(3,0), []) === alle(3,0));

  // --- scansione automatica ---
  store = { autoRule: true, autoRuleDays: 7, autoRuleMax: 3, queueIntervalMin: 20,
    inventory: {
      '10': { title:'Vecchio A', firstSeen: Date.now()-30*86400000 },
      '11': { title:'Vecchio B', firstSeen: Date.now()-20*86400000 },
      '12': { title:'Recente',   firstSeen: Date.now()-1*86400000 },
      '13': { title:'Ripubblicato ieri', firstSeen: Date.now()-40*86400000 },
      '14': { title:'Vecchio C', firstSeen: Date.now()-25*86400000 },
    },
    vrHistory: [{ id:'13', at: Date.now()-1*86400000 }] };
  alarms = {};
  await scansione(); await pausa();
  const q = store.vrQueue;
  ok('accoda solo i fermi da oltre la soglia', q.items.every(i=>['10','11','14'].includes(i.id)));
  ok('rispetta il tetto per volta', q.items.length === 3);
  ok('il piu\u0027 vecchio per primo', q.items[0].id === '10');
  ok('esclude quelli ripubblicati di recente', !q.items.some(i=>i.id==='13'));
  ok('esclude i nuovi arrivati', !q.items.some(i=>i.id==='12'));
  ok('marcata come automatica', q.auto === true);

  // non parte se una coda gira gia'
  store.vrQueue = { items: items(2), index:0, running:true, state:'waiting' };
  const prima = JSON.stringify(store.vrQueue);
  await scansione(); await pausa();
  ok('non sovrascrive una coda in corso', JSON.stringify(store.vrQueue) === prima);

  // spenta non fa niente
  store = { autoRule: false, inventory: { '10': { firstSeen: 0 } }, vrHistory: [] };
  await scansione(); await pausa();
  ok('spenta non accoda', !store.vrQueue);

  console.log(out.join('\n'));
  process.exit(out.some(x=>x.includes('FAIL'))?1:0);
})();
