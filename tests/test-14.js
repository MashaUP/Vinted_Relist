// Pausa, ripresa, salto e registro, sullo scheduler vero.
const fs = require('fs');
let store = {}, alarms = {}, tabs = [{ id: 1, status: 'complete' }];
let idle = 'active', notifiche = [];
const L = { alarm: [], message: [] };
global.chrome = {
  storage: {
    local: {
      get: async (k) => { if (typeof k === 'string') return { [k]: store[k] };
        if (k && !Array.isArray(k)) { const o={}; for (const [a,b] of Object.entries(k)) o[a]= a in store?store[a]:b; return o; }
        return store; },
      set: async (o) => Object.assign(store, o),
      remove: async (k) => { delete store[k]; },
    },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener: () => {} },
  },
  alarms: { create: (n,o)=>{alarms[n]=o.when??Date.now()+o.delayInMinutes*60000;}, clear:(n)=>{delete alarms[n];}, get: async(n)=>alarms[n]?{name:n}:undefined, onAlarm:{addListener:(f)=>L.alarm.push(f)} },
  idle: { queryState: async () => idle },
  notifications: { create: (id, o) => notifiche.push(o || id) },
  tabs: { query: async () => tabs, sendMessage: async () => { if(!tabs.length) throw new Error('x'); return {}; } },
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p)=>p, onStartup:{addListener:()=>{}}, onInstalled:{addListener:()=>{}} },
  webRequest: { onSendHeaders:{addListener:()=>{}}, onBeforeRequest:{addListener:()=>{}} },
};
require(require('path').join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(require('path').join(__dirname, '..', 'background.js'),'utf8'));

const invia = (m) => new Promise((r) => { for (const f of L.message) if (f(m,{},r)) return; r(null); });
const sveglia = async (n) => { delete alarms[n]; for (const f of L.alarm) await f({name:n}); };
const pausa = () => new Promise((r)=>setTimeout(r,15));
const scriviProva = async (q) => { store.vrQueue = q; };
const items = (n) => Array.from({length:n},(_,i)=>({id:String(i+1),title:'A'+(i+1)}));

(async () => {
  const out=[]; const ok=(n,c)=>out.push(`  ${c?'OK  ':'FAIL'} ${n}`);

  // pausa mentre un articolo e' in lavorazione
  await invia({type:'vr:queueStart', items: items(4), intervalMin:20}); await pausa();
  ok('articolo in lavorazione', store.vrQueue.state === 'working');
  await invia({type:'vr:queuePause'}); await pausa();
  ok('la pausa non interrompe l\u0027articolo in corso', store.vrQueue.state === 'working' && store.vrQueue.pausaDopoCorrente);
  await invia({type:'vr:relistDone', itemId:'1', ok:true}); await pausa();
  let q = store.vrQueue;
  ok('articolo concluso, poi pausa', q.items[0].status === 'done' && q.state === 'paused');
  ok('nessun alarm mentre e\u0027 in pausa', !('vr:queueNext' in alarms));

  // ripresa
  await invia({type:'vr:queueResume'}); await pausa();
  q = store.vrQueue;
  ok('ripresa: stato in attesa', q.state === 'waiting');
  const fra = Math.round((alarms['vr:queueNext']-Date.now())/60000);
  ok(`riparte dal tempo residuo (${fra} min)`, fra === 20);

  // pausa da ferma
  await invia({type:'vr:queuePause'}); await pausa();
  ok('pausa immediata se non lavora', store.vrQueue.state === 'paused');
  ok('tempo residuo conservato', store.vrQueue.pausedRemainingMs > 60000);
  await invia({type:'vr:queueResume'}); await pausa();

  // salto mentre l'articolo e' in lavorazione: rifiutato, non si finge di fermarlo
  await sveglia('vr:queueNext'); await pausa();
  const inVolo = store.vrQueue.items.find((i) => i.status === 'working');
  ok('articolo in volo prima del salto', store.vrQueue.state === 'working' && inVolo?.id === '2');
  let r = await invia({type:'vr:queueSkip'}); await pausa();
  q = store.vrQueue;
  ok('il salto durante la lavorazione è rifiutato, con il motivo', !r.ok && /Annulla operazione/.test(r.motivo) && q.items[1].status === 'working');

  // a riposo il salto marca il prossimo e lascia il timer com'e'
  await invia({type:'vr:relistDone', itemId:'2', ok:true}); await pausa();
  const timer = alarms['vr:queueNext'];
  r = await invia({type:'vr:queueSkip'}); await pausa();
  q = store.vrQueue;
  ok('a riposo il salto segna il prossimo', r.ok && q.items[2].status === 'skipped' && q.items[2].motivoSalto === 'manuale');
  ok('il ritmo resta: nessuna partenza immediata', q.state === 'waiting' && alarms['vr:queueNext'] === timer);

  // l'esito in ritardo dell'articolo saltato non sballa niente
  await invia({type:'vr:relistDone', itemId: '3', ok:true}); await pausa();
  ok('esito tardivo del saltato ignorato', store.vrQueue.items[2].status === 'skipped');

  // conteggi nella notifica
  notifiche = [];
  await sveglia('vr:queueNext'); await pausa();
  await invia({type:'vr:relistDone', itemId:'4', ok:false, error:'boh'}); await pausa();
  ok('notifica con saltati', /saltati/.test(notifiche[0]?.message||''));

  // registro delle ripubblicazioni
  store.vrHistory = [{at: Date.now()-40*86400000, id:'vecchio'}];
  await invia({type:'vr:relistLogged', itemId:'99'}); await pausa();
  ok('voce registrata', store.vrHistory.some(v=>v.id==='99'));
  ok('potato oltre i 30 giorni', !store.vrHistory.some(v=>v.id==='vecchio'));

  console.log(out.join('\n'));
  process.exit(out.some(x=>x.includes('FAIL'))?1:0);
})();
