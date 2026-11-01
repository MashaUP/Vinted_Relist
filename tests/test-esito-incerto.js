// 2.2.0 — Esito incerto: il controllo dopo 6 minuti non decide alla cieca.
// Service worker vero (background.js) con storage, sveglie e schede finte; la
// "pagina" risponde alla sonda, alla verifica e al permesso di inviare.
// Casi richiesti: pubblicato senza risposta, scheda non raggiungibile, service
// worker fermato, risposta in ritardo, pubblicato non riconosciuto, non
// pubblicato, verifica automatica riuscita e impossibile, riprova di un incerto,
// recupero dopo il riavvio. In piu': la sequenza dello screenshot (2.1).
const fs = require('fs');
const path = require('path');
let store = {}, alarms = {}, inviati = [];
let schede = new Map();          // tabId → { lavoro: Map(id → stato), verifica: fn }
const sessione = {};
const L = { alarm: [], message: [] };
const tardi = (v) => new Promise((r) => setTimeout(() => r(v), Math.random() * 3));
const copia = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

global.chrome = {
  storage: {
    local: {
      get: async (k) => {
        if (k === null) return tardi(copia(store));
        if (typeof k === 'string') return tardi({ [k]: copia(store[k]) });
        if (Array.isArray(k)) { const o = {}; for (const x of k) o[x] = copia(store[x]); return tardi(o); }
        const o = {}; for (const [a, b] of Object.entries(k || {})) o[a] = a in store ? copia(store[a]) : b; return tardi(o);
      },
      set: async (o) => tardi(Object.assign(store, copia(o))),
      remove: async (k) => tardi([].concat(k).forEach((x) => delete store[x])),
    },
    session: { get: async (k) => ({ [k]: sessione[k] }), set: async (o) => Object.assign(sessione, o) },
    onChanged: { addListener() {} },
  },
  alarms: {
    create: (n, o) => { alarms[n] = o.when ?? Date.now() + (o.delayInMinutes || 0) * 60000; },
    clear: (n) => { delete alarms[n]; }, get: async (n) => (alarms[n] ? { name: n } : undefined),
    onAlarm: { addListener: (f) => L.alarm.push(f) },
  },
  idle: { queryState: async () => 'active' },
  notifications: { create() {}, clear() {}, onClicked: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: {
    query: async () => [...schede.keys()].map((id) => ({ id, status: 'complete' })),
    get: async (id) => { if (!schede.has(id)) throw new Error('No tab with id'); return { id, discarded: false }; },
    sendMessage: async (id, m) => {
      inviati.push({ tab: id, ...m });
      const s = schede.get(id);
      if (!s) throw new Error('Could not establish connection. Receiving end does not exist.');
      if (m.type === 'vr:relistOne') { s.lavoro.set(m.itemId, { avviatoAt: m.avviatoAt, overrides: m.overrides }); return { accepted: true }; }
      if (m.type === 'vr:relistStatus') {
        if (s.muta) return new Promise(() => {});                 // congelata: non risponde
        const l = s.lavoro.get(m.itemId);
        return l ? { inCorso: true, fase: 'preparazione', passo: 'Foto 3/8…', passoAt: Date.now() } : { inCorso: false };
      }
      if (m.type === 'vr:verifyRelist') return s.verifica ? s.verifica(m) : { vecchio: 'ignoto', nuovo: 'ignoto', limiti: [] };
      if (m.type === 'vr:relistCancel') return { ok: true };
      return {};
    },
  },
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p) => p, getManifest: () => ({ version: '2.2.0' }),
    onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  webRequest: { onSendHeaders: { addListener() {} }, onBeforeRequest: { addListener() {} } },
};
require(path.join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'));

const invia = (m) => new Promise((r) => { for (const f of L.message) if (f(m, {}, r)) return; r(null); });
const sveglia = async (n) => { delete alarms[n]; for (const f of L.alarm) await f({ name: n }); };
const calma = () => new Promise((r) => setTimeout(r, 40));
const art = (...ids) => ids.map((id) => ({ id: String(id), title: `Art ${id}`, price: 10 }));
const q = () => store.vrQueue;
const a = (id) => q().items.find((i) => i.id === String(id));
const scheda = (id = 1) => { const s = { lavoro: new Map(), verifica: null, muta: false }; schede.set(id, s); return s; };
const azzera = () => { store = {}; alarms = {}; inviati = []; schede = new Map(); };
const permesso = (id, traccia = {}) => invia({ type: 'vr:relistConfirm', itemId: String(id), avviatoAt: a(id).startedAt, traccia });
const giornale = (id, g) => { store[`vrOp:${id}`] = { id: String(id), avviatoAt: a(id).startedAt, at: Date.now(), ...g }; };

const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);

(async () => {
  // 0. Lo screenshot: dopo 6 minuti la scheda sta ancora lavorando → si aspetta, niente verdetto.
  azzera(); scheda(1);
  await invia({ type: 'vr:queueStart', items: art(10, 11), intervalMin: 20 }); await calma();
  await sveglia('vr:queueWatchdog'); await calma();
  ok('0. controllo a 6 min con la scheda ancora al lavoro: resta «In elaborazione»', a(10).status === 'working' && 'vr:queueWatchdog' in alarms);
  ok('   …e lo scrive nella cronologia, una volta', q().log.filter((e) => e.tipo === 'controllo').length === 1);
  await sveglia('vr:queueWatchdog'); await calma();
  ok('   un secondo controllo non riempie la cronologia', q().log.filter((e) => e.tipo === 'controllo').length === 1 && a(10).controlli === 2);

  // 1. Pubblicazione completata ma risposta non ricevuta: l'esito e' nel giornale.
  await permesso(10, { fotoIds: ['501', '502'], prezzo: 9, ordine: 'safe', eliminaVecchio: true }); await calma();
  schede.get(1).lavoro.delete('10');                            // la pagina ha finito
  giornale(10, { fase: 'concluso', nuovoId: '9010', esito: { ok: true, nuovoId: '9010' } });
  await sveglia('vr:queueWatchdog'); await calma();
  ok('1. completata ma messaggio perso: «Completato» dal giornale, non «da verificare»', a(10).status === 'done' && a(10).nuovoId === '9010');
  ok('   giornale tolto una volta usato', !('vrOp:10' in store));
  ok('   la coda prosegue normalmente', q().running && 'vr:queueNext' in alarms);

  // 2. Scheda non raggiungibile (chiusa) prima dell'invio: interrotto, rimesso in cima una volta.
  azzera(); scheda(1);
  await invia({ type: 'vr:queueStart', items: art(20, 21), intervalMin: 20 }); await calma();
  schede.delete(1);
  await sveglia('vr:queueWatchdog'); await calma();
  ok('2. scheda chiusa durante la preparazione: niente inviato → rimesso in cima, non «da verificare»', a(20).status === 'pending' && q().items.filter((i) => i.status === 'pending')[0].id === '20');
  ok('   la cronologia dice perché', q().log.some((e) => e.tipo === 'interrotto' && /chiusa/.test(e.testo)));
  ok('   e riparte presto (1 min), non dopo l\'intervallo intero', Math.round((alarms['vr:queueNext'] - Date.now()) / 60000) <= 1);

  // 2b. Il vecchio tentativo non può più pubblicare: il permesso gli viene negato.
  scheda(1);
  const primo = q().log.find((e) => e.tipo === 'inizio' && e.id === '20').at;
  let r = await invia({ type: 'vr:relistConfirm', itemId: '20', avviatoAt: primo }); await calma();
  ok('2b. il tentativo dato per interrotto chiede il permesso: negato', r && r.ok === false);

  // 2c. Scheda congelata (non risponde): si aspetta, fino al limite.
  await sveglia('vr:queueNext'); await calma();
  schede.get(1).muta = true;
  const t0 = Date.now();                                        // la sonda aspetta al massimo 10 s
  await sveglia('vr:queueWatchdog'); await calma();
  ok('2c. scheda che non risponde: nessun verdetto, nuovo controllo tra poco', a(20).status === 'working' && alarms['vr:queueWatchdog'] - Date.now() <= 2 * 60000 + 1000 && Date.now() - t0 < 15000);
  schede.get(1).muta = false;

  // 3. Service worker / estensione fermati dopo l'invio: da verificare, verifica pianificata.
  await permesso(20, { fotoIds: ['601'], prezzo: 10, ordine: 'safe', eliminaVecchio: true }); await calma();
  delete alarms['vr:queueWatchdog'];
  await recuperaCoda(); await calma();
  ok('3. riavvio dopo l\'invio a Vinted: «Da verificare», sessione in attesa di te', a(20).status === 'verify' && q().state === 'recovering');
  ok('   verifica automatica pianificata', 'vr:queueVerify' in alarms);
  ok('   e il messaggio dice di non riprovare', /Non riprovare/.test(a(20).error));

  // 4. Risposta ricevuta in ritardo: vale ancora.
  r = await invia({ type: 'vr:relistDone', itemId: '20', avviatoAt: a(20).startedAt, ok: true, nuovoId: '9020' }); await calma();
  ok('4. esito vero arrivato dopo il controllo: «Completato»', a(20).status === 'done' && a(20).nuovoId === '9020');
  ok('   registrato come tardivo', q().log.some((e) => e.tipo === 'tardivo' && e.id === '20'));
  r = await invia({ type: 'vr:relistDone', itemId: '20', avviatoAt: a(20).startedAt, ok: false, error: 'x' }); await calma();
  ok('   un secondo esito non cambia un articolo già concluso', a(20).status === 'done');

  // 5. Pubblicato ma non riconosciuto: la verifica lo trova dalle foto caricate.
  azzera(); const p5 = scheda(1);
  store.inventory = { '30': { title: 'Art 30', price: 10, firstSeen: 1 }, '31': { title: 'Art 31', price: 7, firstSeen: 1 } };
  await invia({ type: 'vr:queueStart', items: art(30, 31), intervalMin: 20 }); await calma();
  await permesso(30, { fotoIds: ['701', '702'], prezzo: 8.5, ordine: 'safe', eliminaVecchio: true }); await calma();
  p5.lavoro.delete('30');                                        // pagina ricaricata: lavoro perso
  await sveglia('vr:queueWatchdog'); await calma();
  ok('5. pagina ricaricata dopo l\'invio: «Da verificare» (non fallito)', a(30).status === 'verify' && a(30).sicuro === 'no');
  p5.verifica = (m) => ({ vecchio: 'assente', nuovo: 'ignoto', trovato: m.fotoIds.includes('701') ? '9030' : null, limiti: [] });
  r = await invia({ type: 'vr:queueVerify', itemId: '30', queue: q().startedAt }); await calma();
  ok('   «Verifica pubblicazione»: trovato dalle foto → «Completato»', r.ok && a(30).status === 'done' && a(30).nuovoId === '9030');
  ok('   la verifica ha chiesto le foto di quel tentativo', inviati.some((m) => m.type === 'vr:verifyRelist' && m.fotoIds.join() === '701,702'));
  ok('   valore dell\'armadio: vecchio sostituito dal nuovo al prezzo nuovo', !store.inventory['30'] && store.inventory['9030']?.price === 8.5 && store.inventory['31'].price === 7);

  // 6. Annuncio non pubblicato: con l'invio fatto non si può dirlo da un'assenza → resta da verificare.
  await sveglia('vr:queueNext'); await calma();
  await permesso(31, { fotoIds: ['801'], prezzo: 7, ordine: 'safe', eliminaVecchio: true }); await calma();
  p5.lavoro.delete('31');
  await sveglia('vr:queueWatchdog'); await calma();
  p5.verifica = () => ({ vecchio: 'presente', nuovo: 'ignoto', trovato: null, limiti: [] });
  r = await invia({ type: 'vr:queueVerify', itemId: '31', queue: q().startedAt }); await calma();
  ok('6. niente trovato dopo l\'invio: resta «Da verificare», con cosa manca', !r.ok && a(31).status === 'verify' && /foto/.test(r.motivo));
  ok('   e il valore non cambia su un esito incerto', store.inventory['31'].price === 7 && Object.keys(store.inventory).length === 2);
  r = await invia({ type: 'vr:queueResolve', itemId: '31', pubblicato: false, queue: q().startedAt }); await calma();
  ok('   «Confermo: non uscito» lo rende riprovabile', (a(31) || store.vrQueueArchive[0].items.find((i) => i.id === '31')).status === 'error');

  // 7. Verifica automatica riuscita (sveglia), 8. impossibile (nessuna scheda Vinted).
  azzera(); const p7 = scheda(1);
  await invia({ type: 'vr:queueStart', items: art(40, 41), intervalMin: 20 }); await calma();
  await permesso(40, { fotoIds: ['901'], ordine: 'safe', eliminaVecchio: true }); await calma();
  p7.lavoro.delete('40');
  giornale(40, { fase: 'creato', nuovoId: '9040' });            // Vinted aveva restituito l'id
  await sveglia('vr:queueWatchdog'); await calma();
  ok('7. id del nuovo annuncio nel giornale: «Da verificare» con l\'id annotato', a(40).status === 'verify' && a(40).traccia?.nuovoId === '9040');
  p7.verifica = (m) => ({ vecchio: 'assente', nuovo: m.nuovoId === '9040' ? 'presente' : 'ignoto', trovato: null, limiti: [] });
  await sveglia('vr:queueVerify'); await calma();
  ok('   verifica automatica: «Completato» senza fare niente', a(40).status === 'done');
  ok('   e un evento «Verificato» nel centro notifiche', (store.vrEvents || []).some((e) => e.kind === 'ok' && /Verificato/.test(e.title)));

  await sveglia('vr:queueNext'); await calma();
  await permesso(41, { fotoIds: ['911'], ordine: 'safe', eliminaVecchio: true }); await calma();
  p7.lavoro.delete('41');
  await sveglia('vr:queueWatchdog'); await calma();
  schede.clear();
  r = await invia({ type: 'vr:queueVerify', itemId: '41', queue: q().startedAt }); await calma();
  ok('8. verifica impossibile senza scheda Vinted: resta «Da verificare» e lo dice', !r.ok && /nessuna scheda/.test(r.motivo) && (q().items.find((i) => i.id === '41') || {}).status === 'verify');
  delete alarms['vr:queueVerify'];
  await sveglia('vr:queueVerify'); await calma();
  ok('   la verifica automatica riprova più tardi', 'vr:queueVerify' in alarms);

  // 9. Un incerto non si ripubblica: né «Ripubblica ora», né riprova, né aggiunta.
  azzera(); scheda(1);
  await invia({ type: 'vr:queueStart', items: art(50, 51, 52), intervalMin: 20 }); await calma();
  await permesso(50, { fotoIds: ['1'] }); await calma();
  schede.get(1).lavoro.delete('50');
  await sveglia('vr:queueWatchdog'); await calma();
  r = await invia({ type: 'vr:queueNow', id: '50' }); await calma();
  ok('9. «Ripubblica ora» su un incerto: rifiutato, chiede la verifica', !r.ok && /Verifica pubblicazione/.test(r.motivo) && a(50).status === 'verify');
  r = await invia({ type: 'vr:queueRetry', ids: ['50'] }); await calma();
  ok('   «Riprova»: rifiutato', !r.ok && a(50).status === 'verify');
  r = await invia({ type: 'vr:queueAdd', items: art(50) }); await calma();
  ok('   «Aggiungi alla coda»: rifiutato', !r.aggiunti?.length && a(50).status === 'verify');
  ok('   e non è mai stato rimandato alla pagina', inviati.filter((m) => m.type === 'vr:relistOne' && m.itemId === '50').length === 1);

  // 10. Recupero dopo il riavvio in preparazione: torna in cima, niente doppioni.
  azzera(); scheda(1);
  await invia({ type: 'vr:queueStart', items: art(60, 61), intervalMin: 20 }); await calma();
  delete alarms['vr:queueWatchdog'];
  await recuperaCoda(); await calma();
  ok('10. riavvio durante la preparazione: rimesso in cima, sessione in attesa di te', a(60).status === 'pending' && q().state === 'recovering');
  await invia({ type: 'vr:queueRecover' }); await calma();
  ok('    alla ripresa riparte quello, una volta sola', a(60).status === 'working' && inviati.filter((m) => m.type === 'vr:relistOne' && m.itemId === '60').length === 2);

  // 11. Annullamento: se la pagina non riceve il messaggio, il permesso viene comunque negato.
  r = await invia({ type: 'vr:queueCancelCurrent' }); await calma();
  r = await permesso(60);
  ok('11. annullamento chiesto: il permesso di inviare è negato', r.ok === false && r.annullato === true);

  // 12. Oltre il limite di 30 minuti, ancora in preparazione: annullato in sicurezza (interrotto).
  azzera(); scheda(1);
  await invia({ type: 'vr:queueStart', items: art(70), intervalMin: 20 }); await calma();
  store.vrQueue.items[0].startedAt = Date.now() - 31 * 60000;
  store['vrOp:70'] = undefined;
  await sveglia('vr:queueWatchdog'); await calma();
  ok('12. oltre 30 minuti in preparazione: chiesto l\'annullamento e niente inviato', inviati.some((m) => m.type === 'vr:relistCancel' && m.itemId === '70') && ['pending', 'interrupted'].includes(store.vrQueue.items[0].status));

  console.log(out.join('\n'));
  process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
})();
