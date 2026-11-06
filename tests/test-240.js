// 2.4.0 — Intervallo per batch, articoli venduti, duplicati fra batch.
// Modello (coda-logica) e service worker vero con storage finto e latenze casuali.
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'src/coda-logica.js'));
const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);
const art = (...ids) => ids.map((id) => ({ id: String(id), title: `Art ${id}`, price: 10 }));
const T0 = 1_700_000_000_000;
const MIN = 60_000;

// ------------------------------------------------------------- modello
{
  let { coda } = C.nuova({ items: art(1, 2), intervalMin: 20, ora: T0 });
  ok('M1. la prima batch ha l\'intervallo della coda', coda.batches[0].intervalMin === 20 && C.intervalloPer(coda, '1') === 20);
  C.aggiungi(coda, art(3, 4), { batch: { overrides: { priceDelta: 1 }, intervalMin: 5 } }, T0 + 1);
  ok('M2. una batch nuova ha il suo intervallo, la prima non cambia', C.intervalloPer(coda, '3') === 5 && C.intervalloPer(coda, '1') === 20 && coda.batches[0].intervalMin === 20);
  C.aggiungi(coda, art(5), { batch: { overrides: { priceDelta: 2 } } }, T0 + 2);
  ok('M3. batch nuova senza intervallo: quello della prima (compatibile con i messaggi 2.3)', C.intervalloPer(coda, '5') === 20);
  C.aggiungi(coda, art(6), { batchId: 'b2' }, T0 + 3);
  ok('M4. unirsi a una batch esistente: il suo intervallo', C.intervalloPer(coda, '6') === 5);
  const conIntervallo = (v) => {
    const { coda: k } = C.nuova({ items: art(9), intervalMin: 20, ora: T0 });
    C.aggiungi(k, art(10), { batch: { overrides: { priceDelta: 1 }, intervalMin: v } }, T0 + 1);
    return C.intervalloPer(k, '10');
  };
  ok('M5. valori non validi scartati (0, testo, negativi): resta quello della coda; oltre 240 si ferma a 240', [0, 'abc', -3, null].every((v) => conIntervallo(v) === 20) && conIntervallo(241) === 240 && conIntervallo(1) === 1);
  ok('M6. il prossimo intervallo è quello della batch del PROSSIMO articolo', C.intervalloProssimo(coda) === 20);
  coda.items.find((i) => i.id === '1').status = 'done';
  coda.items.find((i) => i.id === '2').status = 'done';
  ok('    finita la batch 1 si passa all\'intervallo della batch 2', C.intervalloProssimo(coda) === 5);
  const r = C.modificaBatch(coda, 'b2', { overrides: { priceDelta: 3 }, intervalMin: 12 }, T0 + 4);
  ok('M7. modificare una batch cambia il suo intervallo e conserva il vecchio nello storico', r.ok !== false && C.intervalloPer(coda, '3') === 12 && coda.batches[1].storico.at(-1).intervalMin === 5);
  const riep = C.riepilogoBatch(coda);
  ok('M8. il riepilogo mostra l\'intervallo di ogni batch', riep.map((b) => b.intervalMin).join() === '20,12,20');
  const copia = C.migra(JSON.parse(JSON.stringify(coda)));
  ok('M9. salvata e riletta (riavvio): intervalli intatti', copia.batches.map((b) => b.intervalMin).join() === '20,12,20' && C.intervalloProssimo(copia) === 12);
  const { coda: riparata } = C.riparaStruttura(JSON.parse(JSON.stringify(coda)));
  ok('    la riparazione della struttura non li tocca', (riparata || coda).batches.map((b) => b.intervalMin).join() === '20,12,20');
  coda.state = 'waiting'; coda.nextAt = T0 + 10 + 12 * MIN;
  const s1 = C.stima(coda, T0 + 10)?.rimanenteMs;
  ok('M10. la stima somma l\'intervallo di ogni articolo in attesa (attesa in corso 12, poi 4 e 6 a 12, 5 a 20)', s1 === (12 + 12 + 20 + 12) * MIN);
  const e = C.classificaErrore({ venduto: true, message: 'venduto' });
  ok('M11. «venduto» è un esito definitivo, non da riprovare', e.categoria === 'venduto' && e.sicuroRiprovare === 'no');
  const x = coda.items.find((i) => i.id === '5');
  Object.assign(x, { status: 'skipped', motivoSalto: 'venduto' });
  const v = C.valutaAggiunta ? C.valutaAggiunta(coda, art(5)) : null;
  const ra = C.aggiungi(coda, art(5), { batch: { overrides: { priceDelta: 9 } } }, T0 + 5);
  ok('M12. saltato perché venduto: non si rimette in coda', ra.rifiutati.some((z) => z.id === '5' && /venduto/.test(z.motivo)) && x.status === 'skipped' && (!v || v[0].esito === 'rifiuta'));
  const rd = C.aggiungi(coda, art(3, 4), { batch: { overrides: { priceDelta: 7 } } }, T0 + 6);
  ok('M13. già in attesa in un\'altra batch: rifiutato, non duplicato', rd.rifiutati.length === 2 && coda.items.filter((i) => i.id === '3').length === 1);
}

// ------------------------------------------------------------- service worker
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
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p) => p, getManifest: () => ({ version: '2.4.0' }),
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

(async () => {
  await calma();
  // 1. coda con la prima batch a 20 minuti
  azzera();
  await invia({ type: 'vr:queueStart', items: art(11, 12), intervalMin: 20 }); await calma();
  ok('SW 1. coda avviata: la Batch 1 ha 20 minuti', q().batches[0].intervalMin === 20 && corrente() === '11');
  // 2. batch nuova a 5 minuti, aggiunta mentre il primo è in lavorazione
  let r = await invia({ type: 'vr:queueAdd', items: art(21, 22), batch: { overrides: { priceDelta: 1 }, intervalMin: 5 } }); await calma();
  ok('SW 2. batch nuova con il suo intervallo, la prima non cambia', r.ok && q().batches[1].intervalMin === 5 && q().batches[0].intervalMin === 20);
  // 3. dopo un articolo della batch 1, con il prossimo della batch 1: 20 minuti
  await fine(11);
  ok('SW 3. prossimo della Batch 1: attesa di 20 minuti', attesaMin() === 20);
  // 4. aggiungere una batch durante l'attesa non riavvia il timer
  const primaSveglia = alarms['vr:queueNext'];
  const primaNext = q().nextAt;
  r = await invia({ type: 'vr:queueAdd', items: art(31), batch: { overrides: { priceDelta: 2 }, intervalMin: 3 } }); await calma();
  ok('SW 4. aggiunta durante l\'attesa: sveglia e orario identici', r.ok && alarms['vr:queueNext'] === primaSveglia && q().nextAt === primaNext);
  // 5. modificare l'intervallo di una batch durante l'attesa non riavvia il timer
  r = await invia({ type: 'vr:queueBatchEdit', batchId: 'b2', overrides: { priceDelta: 1 }, intervalMin: 7 }); await calma();
  ok('SW 5. modifica dell\'intervallo durante l\'attesa: timer non toccato, valore salvato', r.ok && alarms['vr:queueNext'] === primaSveglia && q().batches[1].intervalMin === 7);
  // 6. passaggio di batch: il prossimo è della Batch 2 → 7 minuti
  await sveglia('vr:queueNext'); await calma();
  ok('    alla sveglia parte il 12', corrente() === '12');
  await fine(12);
  ok('SW 6. passaggio alla Batch 2: attesa con il SUO intervallo (7)', attesaMin() === 7);
  // 7. pausa e ripresa: il tempo restante non si azzera
  await invia({ type: 'vr:queuePause' }); await calma();
  const restante = q().pausedRemainingMs;
  ok('SW 7. in pausa il tempo restante resta quello dell\'attesa in corso', q().state === 'paused' && Math.round(restante / MIN) === 7);
  await invia({ type: 'vr:queueResume' }); await calma();
  ok('    ripresa: si riparte dal tempo restante, non da capo con un altro intervallo', Math.abs(attesaMin() - 7) <= 1);
  // 8. riavvio del browser con la sveglia al suo posto: niente si azzera
  const svegliaRiavvio = alarms['vr:queueNext'];
  await recuperaCoda(); await calma();
  ok('SW 8. riavvio (sveglia conservata): stessa sveglia, intervalli delle batch intatti', alarms['vr:queueNext'] === svegliaRiavvio && q().batches.map((b) => b.intervalMin).join() === '20,7,3' && q().state === 'waiting');
  // 9. rimuovere il prossimo durante l'attesa: la sveglia resta
  r = await invia({ type: 'vr:queueRemove', ids: ['21'] }); await calma();
  ok('SW 9. tolto il prossimo durante l\'attesa: sveglia non toccata', alarms['vr:queueNext'] === svegliaRiavvio && a(21).status !== 'pending');
  await sveglia('vr:queueNext'); await calma();
  ok('    alla sveglia parte il successivo (22, Batch 2)', corrente() === '22');
  await fine(22);
  ok('SW 10. ultimo della Batch 2, prossimo della Batch 3: 3 minuti', attesaMin() === 3);

  // 11. venduto durante la coda: saltato, la coda continua
  await sveglia('vr:queueNext'); await calma();
  r = await invia({ type: 'vr:queueAdd', items: art(41), batchId: 'b3' }); await calma();
  ok('    in lavorazione il 31', corrente() === '31');
  await fine(31, { ok: false, outcome: 'skipped', motivoSalto: 'venduto', error: 'Articolo venduto: non si ripubblica', categoria: 'venduto', sicuro: 'no' });
  ok('SW 11. venduto nel frattempo: saltato, la coda NON si ferma', a(31).status === 'skipped' && a(31).motivoSalto === 'venduto' && q().running && q().state === 'waiting' && alarms['vr:queueNext']);
  await calma();
  ok('    l\'inventario lo segna come venduto', store.inventory?.['31']?.venduto === true);
  r = await invia({ type: 'vr:queueAdd', items: art(31), batch: { overrides: { priceDelta: 1 } } }); await calma();
  ok('SW 12. il venduto non si rimette in coda', (r.rifiutati || []).some((x) => x.id === '31' && /venduto/.test(x.motivo)) && a(31).status === 'skipped');

  // 13. duplicati fra batch, anche con due aggiunte contemporanee
  const [d1, d2] = await Promise.all([
    invia({ type: 'vr:queueAdd', items: art(51, 52), batch: { overrides: { priceDelta: 4 }, intervalMin: 9 } }),
    invia({ type: 'vr:queueAdd', items: art(52, 53), batch: { overrides: { priceDelta: 6 }, intervalMin: 9 } }),
  ]); await calma();
  ok('SW 13. due aggiunte contemporanee dello stesso articolo: entra una volta sola', q().items.filter((i) => i.id === '52').length === 1 && [...(d1.rifiutati || []), ...(d2.rifiutati || [])].some((x) => x.id === '52'));
  r = await invia({ type: 'vr:queueAdd', items: art(41, 51), batch: { overrides: { priceDelta: 8 } } }); await calma();
  ok('SW 14. già in coda in un\'altra batch: rifiutato', (r.rifiutati || []).length === 2 && q().items.filter((i) => i.id === '41').length === 1);

  // 15. venduto (dall'inventario) non entra né con «Avvia» né con «Aggiungi»
  azzera();
  store.inventory = { 61: { id: '61', venduto: true } };
  r = await invia({ type: 'vr:queueStart', items: art(61), intervalMin: 20 }); await calma();
  ok('SW 15. coda di soli venduti: non parte, con il motivo', r.ok === false && /venduto/.test(r.error) && !q()?.running);
  r = await invia({ type: 'vr:queueStart', items: art(61, 62), intervalMin: 20 }); await calma();
  ok('    con un venduto e uno no: parte solo il secondo, il venduto è tra i rifiutati', r.ok && q().items.map((i) => i.id).join() === '62' && r.rifiutati.some((x) => x.id === '61'));
  r = await invia({ type: 'vr:queueAdd', items: art(61), batch: { overrides: { priceDelta: 1 } } }); await calma();
  ok('    e nemmeno con «Aggiungi alla coda»', !q().items.some((i) => i.id === '61') && r.rifiutati.some((x) => x.id === '61'));

  // 16. da verificare in una sessione passata: non si rimette in coda
  azzera();
  store.vrQueueArchive = [{ startedAt: T0, items: [{ id: '71', status: 'verify', title: 'x' }] }];
  r = await invia({ type: 'vr:queueStart', items: art(71, 72), intervalMin: 20 }); await calma();
  ok('SW 16. esito incerto in una sessione passata: non si rimette in coda', r.ok && !q().items.some((i) => i.id === '71') && r.rifiutati.some((x) => x.id === '71' && /verificare/.test(x.motivo)));

  console.log(out.join('\n'));
  const ko = out.filter((x) => x.includes('FAIL')).length;
  console.log(`${out.length - ko} OK, ${ko} FAIL`);
  process.exit(ko ? 1 : 0);
})();
