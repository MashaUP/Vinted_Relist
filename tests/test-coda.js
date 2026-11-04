// Simula il service worker: storage, alarms e schede finte, poi esegue la coda.
const fs = require('fs');
let store = {}, alarms = {}, tabs = [{ id: 1, status: 'complete' }];
let orologio = Date.now();
const listeners = { alarm: [], message: [] };

global.chrome = {
  storage: {
    local: {
      get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : store),
      set: async (o) => Object.assign(store, o),
      remove: async (k) => { delete store[k]; },
    },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener: () => {} },
  },
  alarms: {
    create: (name, opts) => { alarms[name] = opts.when ?? orologio + (opts.delayInMinutes * 60000); },
    clear: (name) => { delete alarms[name]; },
    onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
  },
  tabs: {
    query: async () => tabs,
    sendMessage: async (id) => { if (!tabs.length) throw new Error('no tab'); return { accepted: true }; },
  },
  runtime: { onMessage: { addListener: (fn) => listeners.message.push(fn) } },
  webRequest: { onSendHeaders: { addListener: () => {} }, onBeforeRequest: { addListener: () => {} } },
};

require(require('path').join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(require('path').join(__dirname, '..', 'background.js'), 'utf8'));

const invia = (msg) => new Promise((res) => {
  for (const fn of listeners.message) if (fn(msg, {}, res)) return;
  res(null);
});
const sveglia = async (name) => {
  delete alarms[name];
  for (const fn of listeners.alarm) await fn({ name });
};
const attesa = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  const esiti = [];
  const ok = (n, c) => esiti.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);

  // avvio con 3 articoli, 20 minuti
  await invia({ type: 'vr:queueStart', items: [{id:'1',title:'A'},{id:'2',title:'B'},{id:'3',title:'C'}], intervalMin: 20 });
  await attesa();
  let q = store.vrQueue;
  ok('coda avviata con 3 articoli', q.items.length === 3 && q.running);
  ok('primo parte subito (stato working)', q.state === 'working');
  ok('watchdog armato', 'vr:queueWatchdog' in alarms);

  // primo riesce
  await invia({ type: 'vr:relistDone', itemId: '1', ok: true });
  await attesa();
  q = store.vrQueue;
  ok('primo segnato done', q.items[0].status === 'done');
  ok('il prossimo è il secondo, niente in lavorazione', q.items[1].status === 'pending' && !q.items.some((i) => i.status === 'working'));
  ok('watchdog disarmato', !('vr:queueWatchdog' in alarms));
  const fra = Math.round((alarms['vr:queueNext'] - Date.now()) / 60000);
  ok(`prossimo fra ~20 min (${fra})`, fra === 20);

  // secondo fallisce ma la coda prosegue
  await sveglia('vr:queueNext'); await attesa();
  await invia({ type: 'vr:relistDone', itemId: '2', ok: false, error: 'prezzo rifiutato' });
  await attesa();
  q = store.vrQueue;
  ok('errore registrato senza fermare la coda', q.items[1].status === 'error' && q.running);
  ok('messaggio di errore conservato', q.items[1].error === 'prezzo rifiutato');

  // esito fuori tempo massimo non deve sballare l'indice
  const prima = JSON.stringify(store.vrQueue);
  await invia({ type: 'vr:relistDone', itemId: '99', ok: true });
  await attesa();
  ok('esito di un articolo non corrente ignorato', JSON.stringify(store.vrQueue) === prima);

  // nessuna scheda Vinted: attende invece di consumare l'articolo
  tabs = [];
  await sveglia('vr:queueNext'); await attesa();
  q = store.vrQueue;
  ok('senza scheda non consuma l\u0027articolo', q.items[2].status === 'pending' && q.state === 'waiting');
  ok('riprova fra 1 minuto', Math.round((alarms['vr:queueNext'] - Date.now()) / 60000) === 1);
  tabs = [{ id: 1, status: 'complete' }];

  // watchdog (2.2): la scheda non ha piu' il lavoro (qui: chiusa) e il permesso di
  // inviare non era stato chiesto → niente e' arrivato a Vinted: interrotto, non
  // «da verificare». Fino alla 2.1 qui diventava «da verificare» alla cieca.
  await sveglia('vr:queueNext'); await attesa();
  await sveglia('vr:queueWatchdog'); await attesa();
  q = store.vrQueue;
  ok('watchdog, scheda chiusa prima dell\u0027invio: rimesso in cima da solo, non «da verificare»', q.items[2].status === 'pending' && q.items[2].ripresoDaSolo && q.running);
  await sveglia('vr:queueNext'); await attesa();
  await sveglia('vr:queueWatchdog'); await attesa();
  q = store.vrQueue;
  ok('seconda interruzione: resta «Interrotto», riprovabile', q.items[2].status === 'interrupted' && q.items[2].sicuro === 'si');
  ok('coda conclusa a fine elenco', !q.running && q.state === 'done');
  // 2.3: la sveglia degli aggiornamenti (ogni 12 ore) non e' della coda
  const sveglieCoda = () => Object.keys(alarms).filter((n) => n !== 'vr:updateCheck');
  ok('nessun alarm residuo della coda', sveglieCoda().length === 0);

  // stop manuale
  await invia({ type: 'vr:queueStart', items: [{id:'7',title:'G'}], intervalMin: 5 });
  await attesa();
  await invia({ type: 'vr:queueStop' });
  await attesa();
  ok('stop con un articolo in volo: si chiude quando arriva il suo esito', store.vrQueue.running && store.vrQueue.stopDopoCorrente && store.vrQueue.items[0].status === 'working');
  await invia({ type: 'vr:relistDone', itemId: '7', ok: true });
  await attesa();
  ok('stop manuale ferma tutto, con l\u0027esito vero dell\u0027articolo', !store.vrQueue.running && store.vrQueue.items[0].status === 'done' && sveglieCoda().length === 0);

  console.log(esiti.join('\n'));
  process.exit(esiti.some((e) => e.includes('FAIL')) ? 1 : 0);
})();
