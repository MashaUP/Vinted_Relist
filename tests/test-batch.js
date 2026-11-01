// 2.2.0 — Batch con regole indipendenti nella stessa coda.
// Modello (coda-logica) e service worker vero con storage finto.
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'src/coda-logica.js'));
const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);
const art = (...ids) => ids.map((id) => ({ id: String(id), title: `Art ${id}`, price: 10 }));
const T0 = 1_700_000_000_000;

// ------------------------------------------------------------- modello
const A = { pricePercent: -10 };
const B = { priceDelta: 2, descriptionAppend: 'Spedizione rapida' };
let { coda } = C.nuova({ items: art(1, 2, 3), overrides: A, campi: { modo: 'percent', valore: '-10' }, ora: T0 });
ok('una coda nuova ha la Batch 1 con le sue regole', coda.batches.length === 1 && coda.batches[0].nome === 'Batch 1' && coda.items.every((i) => i.batch === 'b1'));
ok('coda.overrides resta uguale alla prima batch (compatibilità)', JSON.stringify(coda.overrides) === JSON.stringify(A));
let r = C.aggiungi(coda, art(4, 5), { batch: { overrides: B, campi: { modo: 'delta', valore: '2' } } }, T0 + 1);
ok('aggiungere con regole nuove crea la Batch 2', r.ok && r.batch === 'b2' && C.trova(coda, '4').batch === 'b2' && coda.batches[1].nome === 'Batch 2');
ok('la Batch 1 non cambia', JSON.stringify(coda.batches[0].overrides) === JSON.stringify(A) && C.trova(coda, '1').batch === 'b1');
ok('ogni articolo ha le regole della SUA batch', C.overridesDi(coda, '1').pricePercent === -10 && C.overridesDi(coda, '4').priceDelta === 2 && !('priceDelta' in C.overridesDi(coda, '1')));
r = C.aggiungi(coda, art(6), { batch: { overrides: { price: 5 } } }, T0 + 2);
ok('terza batch con altre regole', coda.batches.length === 3 && C.overridesDi(coda, '6').price === 5);
r = C.aggiungi(coda, art(7), { batchId: 'b2' }, T0 + 3);
ok('ci si può unire a una batch esistente', C.trova(coda, '7').batch === 'b2' && coda.batches.length === 3);
r = C.aggiungi(coda, art(8), {}, T0 + 4);
ok('senza regole (messaggio 2.1): batch nuova con le regole della prima', coda.batches.length === 4 && C.overridesDi(coda, '8').pricePercent === -10);
ok('regole ripulite: chiavi sconosciute scartate', C.pulisciOverrides({ pricePercent: -5, evil: 1, title: 'x' }).evil === undefined && C.pulisciOverrides({ title: 'x' }) === null);
const copia = C.overridesDi(coda, '4'); copia.priceDelta = 99;
ok('le regole date alla pagina sono una copia', coda.batches[1].overrides.priceDelta === 2);

// riepilogo e modifica
C.avviaArticolo(coda, '1', T0 + 5);
C.concludiArticolo(coda, '1', { ok: true }, T0 + 6);
C.avviaArticolo(coda, '2', T0 + 7);
let rb = C.riepilogoBatch(coda);
ok('riepilogo per batch: articoli, completati, in attesa, stato', rb[0].totale === 3 && rb[0].conteggi.done === 1 && rb[0].conteggi.pending === 1 && rb[0].stato === 'in corso' && rb[1].stato === 'in attesa');
ok('il corrente ha registrato con quali regole è partito', C.trova(coda, '2').regole.batch === 'b1' && C.trova(coda, '2').regole.rev === 1);
r = C.modificaBatch(coda, 'b1', { overrides: { pricePercent: -20 }, campi: { modo: 'percent', valore: '-20' } }, T0 + 8);
ok('modifica di una batch: solo i suoi in attesa', r.ok && r.applicati.join() === '3' && r.esclusi.map((x) => x.id).sort().join() === '1,2');
ok('il corrente e i completati restano con la revisione 1', C.trova(coda, '2').regole.rev === 1 && coda.batches[0].storico[0].overrides.pricePercent === -10 && coda.batches[0].rev === 2);
ok('le altre batch non cambiano', C.overridesDi(coda, '4').priceDelta === 2 && C.overridesDi(coda, '6').price === 5);
ok('modifica senza articoli in attesa: rifiutata con il motivo', !C.modificaBatch(coda, 'b9').ok && !C.modificaBatch({ ...coda, items: coda.items.map((i) => (i.batch === 'b3' ? { ...i, status: 'done' } : i)) }, 'b3').ok);

// migrazione di una coda 2.1 (senza batch)
const vecchia = { v: 3, startedAt: T0, running: true, state: 'waiting', overrides: { pricePercent: -5 }, modello: 'Saldi', items: [{ id: '1', title: 'A', status: 'pending' }, { id: '2', title: 'B', status: 'done' }], log: [] };
const m = C.migra(vecchia);
ok('coda 2.1: tutti gli articoli diventano la Batch 1, con le regole di partenza', m.batches.length === 1 && m.items.every((i) => i.batch === 'b1') && m.batches[0].overrides.pricePercent === -5 && m.batches[0].modello === 'Saldi');
ok('…senza toccare l\'originale né gli stati', !vecchia.batches && m.items[1].status === 'done');
const arch = C.perArchivio(coda, T0 + 9);
ok('archivio: batch e appartenenza conservate', arch.batches.length === 4 && arch.items.find((i) => i.id === '4').batch === 'b2' && arch.items.find((i) => i.id === '2').regole.rev === 1);
ok('CSV e JSON dicono la batch', /Batch 2/.test(C.esportaCSV(coda)) && C.esportaJSON(coda).sessione.batch.length === 4);

// ------------------------------------------------------- service worker
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
    sendMessage: async (_id, msg) => { inviati.push(cp(msg)); return msg.type === 'vr:relistStatus' ? { inCorso: true } : { accepted: true }; },
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
const q = () => store.vrQueue;
const a = (id) => q().items.find((i) => i.id === String(id));
const mandati = () => inviati.filter((x) => x.type === 'vr:relistOne');
const fine = async (id, esito = { ok: true }) => { await invia({ type: 'vr:relistDone', itemId: String(id), avviatoAt: a(id).startedAt, ...esito }); await calma(); };

(async () => {
  // 1-2. prima batch, coda avviata
  await invia({ type: 'vr:queueStart', items: art(11, 12, 13), intervalMin: 20, overrides: A, campi: { modo: 'percent', valore: '-10' } }); await calma();
  ok('SW 1. prima batch creata e avviata', q().batches.length === 1 && a(11).status === 'working');
  ok('SW 2. la pagina riceve le regole della Batch 1', mandati()[0].overrides.pricePercent === -10);
  // 3-4. seconda batch con regole diverse durante l'esecuzione
  const inizio = a(11).startedAt;
  let ris = await invia({ type: 'vr:queueAdd', items: art(21, 22), batch: { overrides: B, campi: { modo: 'delta', valore: '2' } } }); await calma();
  ok('SW 3. aggiunta con regole nuove = Batch 2, senza fermare né riavviare la coda', ris.ok && ris.batch === 'b2' && a(11).status === 'working' && a(11).startedAt === inizio && mandati().length === 1);
  ok('SW 4. la Batch 1 mantiene le sue regole', q().batches[0].overrides.pricePercent === -10 && !q().batches[0].overrides.priceDelta);
  // 5-6. ogni articolo pubblicato con le regole della sua batch
  await fine(11); await sveglia('vr:queueNext'); await calma();
  await fine(12); await sveglia('vr:queueNext'); await calma();
  await fine(13); await sveglia('vr:queueNext'); await calma();
  const regoleDi = (id) => mandati().find((x) => x.itemId === String(id)).overrides;
  ok('SW 5. Batch 1 pubblicata con la Configurazione A', [11, 12, 13].every((id) => regoleDi(id).pricePercent === -10 && !regoleDi(id).priceDelta));
  ok('SW 6. Batch 2 pubblicata con la Configurazione B', regoleDi(21).priceDelta === 2 && regoleDi(21).descriptionAppend === 'Spedizione rapida' && !regoleDi(21).pricePercent);
  // 7-8. persistenza: nuovo service worker, stessa memoria
  const salvata = cp(store.vrQueue);
  ok('SW 7-8. configurazioni salvate con la coda (sopravvivono a popup e browser chiusi)', salvata.batches.length === 2 && salvata.items.find((i) => i.id === '22').batch === 'b2' && salvata.batches[1].campi.modo === 'delta');
  // 9. modifica di una batch senza alterare le altre
  ris = await invia({ type: 'vr:queueAdd', items: art(31), batch: { overrides: { price: 4 } } }); await calma();
  ris = await invia({ type: 'vr:queueBatchEdit', batchId: 'b2', overrides: { priceDelta: 3 }, campi: { modo: 'delta', valore: '3' } }); await calma();
  ok('SW 9. modifica della Batch 2: solo il suo in attesa, il corrente no', ris.ok && ris.applicati.join() === '22' && ris.esclusi.some((x) => x.id === '21' && x.stato === 'working'));
  ok('    le altre batch invariate', q().batches[0].overrides.pricePercent === -10 && q().batches[2].overrides.price === 4);
  await fine(21); await sveglia('vr:queueNext'); await calma();
  ok('    il prossimo della Batch 2 parte con le regole nuove', regoleDi(22).priceDelta === 3);
  ok('    il corrente era partito con le vecchie (revisione 1)', regoleDi(21).priceDelta === 2 && a(21).regole.rev === 1 && a(22).regole.rev === 2);
  // 10. riprendere una sessione con più batch: ogni gruppo con le sue regole
  await fine(22, { ok: false, error: 'boom', categoria: 'interno', sicuro: 'si' }); await sveglia('vr:queueNext'); await calma();
  await fine(31, { ok: false, error: 'boom', categoria: 'interno', sicuro: 'si' }); await calma();
  ok('    sessione conclusa con due falliti in batch diverse', !q().running && store.vrQueueArchive?.length === 1);
  inviati = [];
  ris = await invia({ type: 'vr:queueRetry', queue: q().startedAt }); await calma();
  ok('SW 10. ripresa dei falliti: una batch per gruppo, ognuna con le sue regole', ris.ok && q().batches.length === 2
    && C.overridesDi(q(), '22').priceDelta === 3 && C.overridesDi(q(), '31').price === 4);
  ok('    e la pagina riceve quelle giuste', mandati()[0].itemId === '22' && mandati()[0].overrides.priceDelta === 3);

  // coda 2.1 in corso al momento dell'aggiornamento
  store.vrQueue = { v: 3, startedAt: 5, running: true, state: 'waiting', nextAt: Date.now() + 60000, intervalMin: 20, overrides: { pricePercent: -5 },
    items: [{ id: '91', title: 'A', status: 'pending' }], log: [] };
  alarms['vr:queueNext'] = Date.now() + 60000;
  ris = await invia({ type: 'vr:queueAdd', items: art(92), batch: { overrides: { priceDelta: 1 } } }); await calma();
  ok('coda della 2.1 in corso: i suoi articoli sono la Batch 1, i nuovi la Batch 2', q().batches.length === 2 && C.overridesDi(q(), '91').pricePercent === -5 && C.overridesDi(q(), '92').priceDelta === 1);

  console.log(out.join('\n'));
  process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
})();
