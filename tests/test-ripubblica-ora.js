// 2.2.0 — «Ripubblica ora»: l'articolo diventa il prossimo, senza interrompere
// quello in corso e con le regole della sua batch. Service worker vero.
const fs = require('fs');
const path = require('path');
let store = {}, alarms = {}, inviati = [];
const L = { alarm: [], message: [] };
const tardi = (v) => new Promise((res) => setTimeout(() => res(v), Math.random() * 3));
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
    sendMessage: async (_id, msg) => { inviati.push(cp(msg)); return msg.type === 'vr:relistStatus' ? { inCorso: false } : { accepted: true }; },
  },
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p) => p, getManifest: () => ({ version: '2.2.0' }),
    onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  webRequest: { onSendHeaders: { addListener() {} }, onBeforeRequest: { addListener() {} } },
};
require(path.join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'));
const invia = (msg) => new Promise((res) => { for (const f of L.message) if (f(msg, {}, res)) return; res(null); });
const sveglia = async (n) => { delete alarms[n]; for (const f of L.alarm) await f({ name: n }); };
const calma = () => new Promise((res) => setTimeout(res, 40));
const art = (...ids) => ids.map((id) => ({ id: String(id), title: `Art ${id}`, price: 10 }));
const q = () => store.vrQueue;
const a = (id) => q().items.find((i) => i.id === String(id));
const attesa = () => q().items.filter((i) => i.status === 'pending').map((i) => i.id).join(',');
const mandati = () => inviati.filter((x) => x.type === 'vr:relistOne');
const fine = async (id, esito = { ok: true }) => { await invia({ type: 'vr:relistDone', itemId: String(id), avviatoAt: a(id).startedAt, ...esito }); await calma(); };
const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);

(async () => {
  await invia({ type: 'vr:queueStart', items: art(1, 2, 3, 4), intervalMin: 20, overrides: { pricePercent: -10 } }); await calma();
  await invia({ type: 'vr:queueAdd', items: art(5, 6), batch: { overrides: { priceDelta: 2 } } }); await calma();
  const inizio = a(1).startedAt;

  // 1-3. articolo in attesa, il corrente non si tocca
  let r = await invia({ type: 'vr:queueNow', id: '6' }); await calma();
  ok('1. «Ripubblica ora» su un articolo in attesa', r.ok && r.dopoCorrente === true);
  ok('2. diventa il prossimo', attesa() === '6,2,3,4,5');
  ok('3. il corrente non viene interrotto né riavviato', a(1).status === 'working' && a(1).startedAt === inizio && mandati().length === 1
    && !inviati.some((m) => m.type === 'vr:relistCancel'));
  ok('   la cronologia lo dice, con la batch', q().log.some((e) => e.tipo === 'priorita' && /Batch 2/.test(e.testo)));

  // 4-5. articolo di un'altra batch: parte con le SUE regole
  await fine(1); await sveglia('vr:queueNext'); await calma();
  const sesto = mandati().find((m) => m.itemId === '6');
  ok('4. al giro dopo parte proprio quello', sesto && a(6).status === 'working');
  ok('5. con le regole della Batch 2, non della Batch 1 in esecuzione', sesto.overrides.priceDelta === 2 && !sesto.overrides.pricePercent);

  // in attesa tra due articoli: parte presto, ma non attaccato al precedente
  await fine(6);
  const prima = alarms['vr:queueNext'];
  r = await invia({ type: 'vr:queueNow', id: '4' }); await calma();
  ok('   in attesa tra due articoli: la partenza si avvicina', r.ok && r.partenza && r.partenza < prima && alarms['vr:queueNext'] === r.partenza);
  ok('   …ma almeno un minuto dopo la pubblicazione precedente', r.partenza - a(6).finishedAt >= 60000 - 50);

  // 6. completato: rifiutato
  r = await invia({ type: 'vr:queueNow', id: '1' }); await calma();
  ok('6. su un completato: rifiutato, niente ripubblicato', !r.ok && /Già ripubblicato/.test(r.motivo) && a(1).status === 'done');

  // 7. da verificare: rifiutato (vedi anche test-esito-incerto)
  await sveglia('vr:queueNext'); await calma();
  await invia({ type: 'vr:relistConfirm', itemId: '4', avviatoAt: a(4).startedAt }); await calma();
  await sveglia('vr:queueWatchdog'); await calma();
  r = await invia({ type: 'vr:queueNow', id: '4' }); await calma();
  ok('7. su un «da verificare»: rifiutato, chiede prima la verifica', a(4).status === 'verify' && !r.ok && /Verifica pubblicazione/.test(r.motivo));

  // fallito riprovabile: rimesso in coda e in cima; definitivo: no
  await sveglia('vr:queueNext'); await calma();
  const corrente = q().items.find((i) => i.status === 'working').id;
  await fine(corrente, { ok: false, error: 'boom', categoria: 'interno', sicuro: 'si' });
  r = await invia({ type: 'vr:queueNow', id: corrente }); await calma();
  ok('   fallito riprovabile: rimesso in coda come prossimo', r.ok && r.riattivato === 'error' && attesa().startsWith(corrente));
  await sveglia('vr:queueNext'); await calma();
  await fine(corrente, { ok: false, error: 'Articolo non trovato', categoria: 'non-consentito', sicuro: 'no' });
  r = await invia({ type: 'vr:queueNow', id: corrente }); await calma();
  ok('   fallito definitivo: rifiutato', !r.ok && /non serve/.test(r.motivo));

  // 8. durante una pausa: diventa il primo, la pausa resta
  await invia({ type: 'vr:queuePause' }); await calma();
  const ultimo = attesa().split(',').pop();
  r = await invia({ type: 'vr:queueNow', id: ultimo }); await calma();
  ok('8. in pausa: diventa il primo, la coda resta in pausa e non parte niente', r.ok && r.stato === 'paused' && attesa().startsWith(ultimo) && q().state === 'paused' && !('vr:queueNext' in alarms));

  // 9. priorità persistente: nella coda salvata, e dopo la ripresa parte quello
  const salvata = cp(store.vrQueue);
  ok('9. la priorità è salvata con la coda', salvata.items.filter((i) => i.status === 'pending')[0].id === ultimo && salvata.items.find((i) => i.id === ultimo).prioritaAt);
  await invia({ type: 'vr:queueResume' }); await calma();
  await sveglia('vr:queueNext'); await calma();
  ok('   alla ripresa parte lui', a(ultimo).status === 'working');

  // non valido
  r = await invia({ type: 'vr:queueNow', id: 'abc' }); await calma();
  ok('   id non valido: rifiutato', !r.ok);

  console.log(out.join('\n'));
  process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
})();
