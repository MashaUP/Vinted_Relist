// 2.1.0 — Code dinamiche nel service worker: modifiche durante l'esecuzione e la pausa,
// messaggi concorrenti, annullamento del corrente, prudenza, pausa a tempo, recupero.
// Storage con latenze casuali, come in Chrome: e' qui che si vedono le gare.
const fs = require('fs');
let store = {}, alarms = {}, tabs = [{ id: 1, status: 'complete' }];
let inviati = [], notifiche = [], rispostaAnnulla = { ok: true };
const sessione = {};
const L = { alarm: [], message: [] };
const tardi = (v) => new Promise((r) => setTimeout(() => r(v), Math.random() * 4));
const copia = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
global.chrome = {
  storage: {
    local: {
      get: async (k) => {
        if (typeof k === 'string') return tardi({ [k]: copia(store[k]) });
        const o = {}; for (const [a, b] of Object.entries(k || {})) o[a] = a in store ? copia(store[a]) : b; return tardi(o);
      },
      set: async (o) => tardi(Object.assign(store, copia(o))),
      remove: async (k) => tardi(delete store[k]),
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
  notifications: { create: (id, o) => notifiche.push({ id, ...o }), clear() {}, onClicked: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: {
    query: async () => tabs,
    sendMessage: async (_id, m) => { inviati.push(m); return m.type === 'vr:relistCancel' ? rispostaAnnulla : { accepted: true }; },
  },
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p) => p, getManifest: () => ({ version: '2.1.0' }),
    onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  webRequest: { onSendHeaders: { addListener() {} }, onBeforeRequest: { addListener() {} } },
};
require(require('path').join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(require('path').join(__dirname, '..', 'background.js'), 'utf8'));

const invia = (m) => new Promise((r) => { for (const f of L.message) if (f(m, {}, r)) return; r(null); });
const sveglia = async (n) => { delete alarms[n]; for (const f of L.alarm) await f({ name: n }); };
const calma = () => new Promise((r) => setTimeout(r, 40));
const art = (...ids) => ids.map((id) => ({ id: String(id), title: `Art ${id}`, price: 5 }));
const q = () => store.vrQueue;
const st = (id) => q().items.find((i) => i.id === String(id))?.status;
const attesa = () => q().items.filter((i) => i.status === 'pending').map((i) => i.id).join(',');
const pubblicazioni = () => inviati.filter((m) => m.type === 'vr:relistOne').map((m) => m.itemId);
const azzera = () => { store = {}; alarms = {}; inviati = []; notifiche = []; rispostaAnnulla = { ok: true }; };

const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);

(async () => {
  // 1-3: aggiunta durante l'esecuzione, il corrente non si tocca
  azzera();
  await invia({ type: 'vr:queueStart', items: art(1, 2, 3), intervalMin: 20 }); await calma();
  const inizio = q().items[0].startedAt;
  let r = await invia({ type: 'vr:queueAdd', items: art(4) }); await calma();
  ok('1. aggiunta a coda in esecuzione', r.ok && r.aggiunti.join() === '4' && attesa() === '2,3,4');
  r = await invia({ type: 'vr:queueAdd', items: art(5, 6), dove: 'cima' }); await calma();
  ok('2. aggiunta multipla in cima', attesa() === '5,6,2,3,4');
  ok('3. il corrente non viene riavviato né rimandato', st(1) === 'working' && q().items[0].startedAt === inizio && pubblicazioni().join() === '1');

  // 11: duplicato
  r = await invia({ type: 'vr:queueAdd', items: art(2, 1) }); await calma();
  ok('11. già presente o in corso: rifiutato con il motivo', !r.aggiunti.length && r.rifiutati.length === 2 && /posizione/.test(r.rifiutati.find((x) => x.id === '2').motivo));

  // 4-6
  r = await invia({ type: 'vr:queueRemove', ids: ['6'] }); await calma();
  ok('4. rimozione di un articolo in attesa', r.ok && st(6) === 'removed' && attesa() === '5,2,3,4');
  r = await invia({ type: 'vr:queueRemove', ids: ['5', '3'] }); await calma();
  ok('5. rimozione multipla', r.rimossi.length === 2 && attesa() === '2,4');
  r = await invia({ type: 'vr:queueRemove', ids: ['1'] }); await calma();
  ok('6. il corrente non si rimuove: si indica «Annulla operazione»', !r.ok && /Annulla operazione/.test(r.rifiutati[0].motivo) && st(1) === 'working');

  // 7: annullamento troppo tardi (richiesta gia' partita)
  rispostaAnnulla = { ok: false, troppoTardi: true };
  r = await invia({ type: 'vr:queueCancelCurrent' }); await calma();
  ok('7. annulla con la richiesta già partita: lo dice e aspetta l\'esito', r.troppoTardi && st(1) === 'working' && q().log.some((e) => /era già partita/.test(e.testo)));
  await invia({ type: 'vr:relistDone', itemId: '1', ok: true }); await calma();
  ok('   l\'esito vero vince', st(1) === 'done');

  // 16: concorrenza — esito, passo e modifiche nello stesso istante
  await sveglia('vr:queueNext'); await calma();
  ok('   prossimo: il primo in attesa', st(2) === 'working');
  await Promise.all([
    invia({ type: 'vr:queueProgress', itemId: '2', step: 'Fatto' }),
    invia({ type: 'vr:relistDone', itemId: '2', ok: true }),
    invia({ type: 'vr:queueAdd', items: art(7) }),
    invia({ type: 'vr:queueMove', ids: ['7'], dove: 'cima' }),
    invia({ type: 'vr:queueRemove', ids: ['4'] }),
  ]); await calma();
  ok('16. messaggi concorrenti: nessun esito perso, modifiche tutte applicate', st(2) === 'done' && st(4) === 'removed' && attesa() === '7');
  ok('    nessuna doppia elaborazione', pubblicazioni().join() === '1,2');
  ok('    rev cresce a ogni scrittura', q().rev > 5);

  // 12: rimozione dell'ultimo in attesa → sessione chiusa, coerente
  r = await invia({ type: 'vr:queueRemove', ids: ['7'] }); await calma();
  ok('12. tolto l\'ultimo in attesa: sessione chiusa e archiviata', !q().running && q().state === 'done' && store.vrQueueArchive?.[0]?.startedAt === q().startedAt);
  ok('    nessuna sveglia residua', !Object.keys(alarms).length);

  // 8-10: modifiche durante la pausa, ripresa con l'ordine nuovo
  azzera();
  await invia({ type: 'vr:queueStart', items: art(10, 11, 12), intervalMin: 20 }); await calma();
  await invia({ type: 'vr:relistDone', itemId: '10', ok: true }); await calma();
  r = await invia({ type: 'vr:queuePause' }); await calma();
  ok('    pausa a riposo', r.ok && q().state === 'paused' && !('vr:queueNext' in alarms));
  await invia({ type: 'vr:queueAdd', items: art(13) }); await calma();
  await invia({ type: 'vr:queueMove', ids: ['13'], dove: 'cima' }); await calma();
  r = await invia({ type: 'vr:queueReorder', ordine: ['13', '12', '11'] }); await calma();
  ok('8-9. in pausa: aggiunta e riordino', r.ok && attesa() === '13,12,11');
  r = await invia({ type: 'vr:queueReorder', ordine: ['12', '11'] }); await calma();
  ok('    riordino con un elenco vecchio: rifiutato, ordine intatto', !r.ok && /cambiata/.test(r.motivo) && attesa() === '13,12,11');
  await invia({ type: 'vr:queueResume' }); await calma();
  await sveglia('vr:queueNext'); await calma();
  ok('10. ripresa: parte il primo dell\'ordine nuovo', st(13) === 'working' && pubblicazioni().slice(-1)[0] === '13');

  // 18: esito incerto → da verificare, mai riprovato da solo
  await invia({ type: 'vr:relistDone', itemId: '13', ok: false, outcome: 'uncertain', error: 'timeout', categoria: 'incerto', sicuro: 'no' }); await calma();
  ok('18. incerto → da verificare', st(13) === 'verify');
  r = await invia({ type: 'vr:queueRetry', ids: ['13'] }); await calma();
  ok('    riprovare un incerto è rifiutato', !r.ok && st(13) === 'verify');
  r = await invia({ type: 'vr:queueAdd', items: art(13) }); await calma();
  ok('    rimetterlo in coda aggiungendolo è rifiutato', !r.aggiunti.length && !r.riattivati.length);
  await invia({ type: 'vr:queueResolve', itemId: '13', pubblicato: false }); await calma();
  r = await invia({ type: 'vr:queueRetry', ids: ['13'] }); await calma();
  ok('    verificato «non uscito»: ora si può riprovare, in fondo', r.ok && attesa() === '12,11,13');

  // 17 + prudenza: errori di fila mettono in pausa da soli, la coda resta sana
  for (const id of ['12', '11', '13']) {
    await sveglia('vr:queueNext'); await calma();
    await invia({ type: 'vr:relistDone', itemId: id, ok: false, error: 'boom', categoria: 'interno', sicuro: 'si' }); await calma();
  }
  ok('17. errori su singoli articoli non corrompono la coda', st(12) === 'error' && st(11) === 'error' && st(13) === 'pending');
  ok('    prudenza: l\'incerto di prima più due falliti fanno tre di fila → pausa prima del 13', q().state === 'paused' && q().pausaAuto && pubblicazioni().filter((x) => x === '13').length === 1);

  azzera();
  await invia({ type: 'vr:queueStart', items: art(20, 21, 22, 23, 24), intervalMin: 20 }); await calma();
  for (const id of ['20', '21', '22']) {
    if (id !== '20') { await sveglia('vr:queueNext'); await calma(); }
    await invia({ type: 'vr:relistDone', itemId: id, ok: false, outcome: id === '21' ? 'uncertain' : 'error', error: 'x' }); await calma();
  }
  ok('    modalità prudente: 3 esiti negativi di fila → pausa da sola, con il motivo', q().state === 'paused' && q().pausaAuto && /3 esiti negativi/.test(q().motivoPausa));
  ok('    nessuna sveglia: non parte niente finché non decidi', !('vr:queueNext' in alarms) && attesa() === '23,24');
  await invia({ type: 'vr:queueResume' }); await calma();
  ok('    ripresa: prudenza azzerata', q().state === 'waiting' && q().erroriDiFila === 0 && !q().pausaAuto);

  // pausa dopo l'articolo corrente e pausa a tempo
  await sveglia('vr:queueNext'); await calma();
  r = await invia({ type: 'vr:queuePause', minuti: 30 }); await calma();
  ok('    pausa durante un articolo: scatta dopo il suo esito', r.dopoCorrente && st(23) === 'working' && q().pausaDopoCorrente);
  await invia({ type: 'vr:relistDone', itemId: '23', ok: true }); await calma();
  ok('    pausa a tempo: sveglia di ripresa programmata', q().state === 'paused' && Math.round((alarms['vr:queueResume'] - Date.now()) / 60000) === 30);
  await sveglia('vr:queueResume'); await calma();
  ok('    la sveglia di ripresa riprende la coda', q().state === 'waiting' && 'vr:queueNext' in alarms);

  // 14: riavvio del service worker con un articolo in volo
  await sveglia('vr:queueNext'); await calma();
  ok('    articolo in volo', st(24) === 'working');
  delete alarms['vr:queueWatchdog'];                          // estensione ricaricata: sveglie perse
  await recuperaCoda(); await calma();
  ok('14. dopo il riavvio l\'articolo in volo è da verificare, la sessione aspetta te', st(24) === 'verify' && q().state === 'recovering');
  await invia({ type: 'vr:relistDone', itemId: '24', ok: true }); await calma();
  ok('    un esito tardivo dalla scheda vecchia non riscrive niente', st(24) === 'verify');

  // interrompi con un articolo in volo
  azzera();
  await invia({ type: 'vr:queueStart', items: art(30, 31, 32), intervalMin: 20 }); await calma();
  r = await invia({ type: 'vr:queueStop' }); await calma();
  ok('    interrompi con un articolo in volo: in chiusura, gli altri annullati', r.inChiusura && q().running && st(31) === 'cancelled' && st(32) === 'cancelled');
  ok('    e chiede l\'annullamento alla pagina', inviati.some((m) => m.type === 'vr:relistCancel' && m.itemId === '30'));
  r = await invia({ type: 'vr:queueAdd', items: art(33) }); await calma();
  ok('    in chiusura non si aggiunge', !r.ok && /chiudendo/.test(r.error));
  await invia({ type: 'vr:relistDone', itemId: '30', ok: false, outcome: 'cancelled' }); await calma();
  ok('    esito «annullato prima dell\'invio»: sessione chiusa', !q().running && st(30) === 'cancelled');

  // ripresa di una sessione passata: mai i completati
  azzera();
  store.vrQueueArchive = [{ v: 3, startedAt: 111, intervalMin: 15, overrides: { pricePercent: -5 }, items: [
    { id: '40', title: 'A', status: 'done' }, { id: '41', title: 'B', status: 'error', sicuro: 'si' },
    { id: '42', title: 'C', status: 'cancelled' }, { id: '43', title: 'D', status: 'verify' }] }];
  r = await invia({ type: 'vr:queueRestore', queue: 111 }); await calma();
  ok('    ripresa di una sessione: solo falliti e annullati, con le stesse opzioni', r.ok && q().items.map((i) => i.id).join() === '41,42' && q().intervalMin === 15 && q().overrides.pricePercent === -5);
  ok('    esclusi elencati con il motivo', r.esclusi.map((e) => `${e.id}:${e.motivo}`).join() === '40:già ripubblicato,43:esito da verificare');
  r = await invia({ type: 'vr:queueRestore', queue: 111 }); await calma();
  ok('    ripresa con una coda attiva: si aggiungono, niente doppioni', r.aggiuntaAllaCodaInCorso === undefined && !r.aggiunti?.length && r.rifiutati?.length === 2);

  // svuota: solo a coda conclusa
  r = await invia({ type: 'vr:queueClear' });
  ok('    «Nascondi» rifiutato con la coda attiva', !r.ok && !!store.vrQueue);

  // registro: modifiche locali distinte dagli esiti di Vinted
  const log = q().log;
  ok('    registro con creazione, avvio, aggiunte, natura', log.some((e) => e.tipo === 'creata') && log.some((e) => e.tipo === 'avviata') && log.every((e) => e.natura));

  console.log(out.join('\n'));
  process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
