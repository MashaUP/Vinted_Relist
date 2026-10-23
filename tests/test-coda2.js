// Coda 2.0: doppio avvio, esiti incerti/parziali, annullati, riprova falliti,
// verifica manuale, eventi, badge, clic sulla notifica, avanzamento.
const fs = require('fs');
let store = {}, alarms = {}, tabs = [{ id: 1, status: 'complete' }];
let notifiche = [], badge = '', aperte = [], contesti = [];
const sessione = {};
const L = { alarm: [], message: [], clic: [] };
global.chrome = {
  storage: { local: {
    get: async (k) => { if (typeof k === 'string') return { [k]: store[k] };
      if (k && !Array.isArray(k)) { const o = {}; for (const [a, b] of Object.entries(k)) o[a] = a in store ? store[a] : b; return o; }
      return store; },
    set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))), remove: async (k) => { delete store[k]; } },
    session: { get: async (k) => ({ [k]: sessione[k] }), set: async (o) => Object.assign(sessione, o) }, onChanged: { addListener() {} } },
  alarms: { create: (n, o) => { alarms[n] = o.when ?? Date.now() + (o.delayInMinutes || 0) * 60000; },
    clear: (n) => { delete alarms[n]; }, get: async (n) => alarms[n] ? { name: n } : undefined,
    onAlarm: { addListener: (f) => L.alarm.push(f) } },
  idle: { queryState: async () => 'active' },
  notifications: { create: (id, o) => notifiche.push({ id, ...o }), clear() {}, onClicked: { addListener: (f) => L.clic.push(f) } },
  action: { setBadgeText: async ({ text }) => { badge = text; }, setBadgeBackgroundColor: async () => {} },
  tabs: { query: async () => tabs, sendMessage: async () => ({}), create: async (o) => { aperte.push(['nuova', o.url]); return {}; },
    update: async (id, o) => { aperte.push(['riusata', id, o.url]); return { windowId: 1 }; } },
  windows: { update: async () => {} },
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p) => 'chrome-extension://x/' + p,
    getManifest: () => ({ version: '2.0.0' }), getContexts: async () => contesti,
    onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  webRequest: { onSendHeaders: { addListener() {} }, onBeforeRequest: { addListener() {} } },
};
require(require('path').join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(require('path').join(__dirname, '..', 'background.js'), 'utf8'));

const invia = (m) => new Promise((r) => { for (const f of L.message) if (f(m, {}, r)) return; r(null); });
const sveglia = async (n) => { delete alarms[n]; for (const f of L.alarm) await f({ name: n }); };
const pausa = () => new Promise((r) => setTimeout(r, 15));
// Interrompi: se un articolo e' in volo la pagina rispetta l'annullamento (esito "cancelled").
const ferma = async () => {
  await invia({ type: 'vr:queueStop' }); await pausa();
  const c = store.vrQueue?.items?.find((i) => i.status === 'working');
  if (c) { await invia({ type: 'vr:relistDone', itemId: c.id, ok: false, outcome: 'cancelled' }); await pausa(); }
};
const items = (n, d = 0) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1 + d), title: 'A' + (i + 1 + d) }));
const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);

(async () => {
  // --- doppio avvio
  let r = await invia({ type: 'vr:queueStart', items: items(3), intervalMin: 20 }); await pausa();
  ok('primo avvio', r.ok && !r.duplicato);
  const prima = JSON.stringify(store.vrQueue);
  r = await invia({ type: 'vr:queueStart', items: items(3), intervalMin: 20 }); await pausa();
  ok('doppio clic: stessa coda, nessun riavvio', r.ok && r.duplicato && JSON.stringify(store.vrQueue) === prima);
  r = await invia({ type: 'vr:queueStart', items: items(2, 10), intervalMin: 20 }); await pausa();
  ok('coda diversa mentre una gira: rifiutata', !r.ok && /già una coda/.test(r.error));

  // --- esiti tipizzati
  await invia({ type: 'vr:queueProgress', itemId: '1', step: 'Foto 2/5…' }); await pausa();
  ok('avanzamento nello storage di sessione, la coda non viene riscritta', sessione.vrQueueStep?.step === 'Foto 2/5…' && !('step' in store.vrQueue));
  await invia({ type: 'vr:queueProgress', itemId: '99', step: 'altro' }); await pausa();
  ok('avanzamento di un altro articolo ignorato', sessione.vrQueueStep?.step === 'Foto 2/5…');

  await invia({ type: 'vr:relistDone', itemId: '1', ok: false, outcome: 'uncertain', error: 'timeout' }); await pausa();
  ok('esito incerto → da verificare', store.vrQueue.items[0].status === 'verify');
  ok('evento incerto registrato', store.vrEvents?.[0]?.kind === 'uncertain');
  ok('badge con 1 da guardare', badge === '1');

  await sveglia('vr:queueNext'); await pausa();
  await invia({ type: 'vr:relistDone', itemId: '2', ok: false, outcome: 'partial', error: 'vecchio online' }); await pausa();
  ok('esito parziale → da verificare (non riprovabile)', store.vrQueue.items[1].status === 'verify');

  await sveglia('vr:queueNext'); await pausa();
  await invia({ type: 'vr:relistDone', itemId: '3', ok: false, outcome: 'error', error: 'prezzo rifiutato' }); await pausa();
  ok('errore vero → fallito', store.vrQueue.items[2].status === 'error');
  ok('coda finita', !store.vrQueue.running);

  const n = notifiche[notifiche.length - 1];
  ok('notifica con id della coda', n.id === `vr-coda-${store.vrQueue.startedAt}`);
  ok('notifica che conta incerti e falliti', /1 falliti/.test(n.message) && /2 da verificare/.test(n.message));
  ok('notifica che resta finché non la guardi', n.requireInteraction === true);

  // --- archivio delle code concluse
  const primaCoda = store.vrQueue.startedAt;
  ok('coda conclusa archiviata', store.vrQueueArchive?.[0]?.startedAt === primaCoda && store.vrQueueArchive[0].items.length === 3);
  ok('archivio compatto: niente passi né stato interno, con registro e conteggi', !('step' in store.vrQueueArchive[0]) && !('nextAt' in store.vrQueueArchive[0]) && !('running' in store.vrQueueArchive[0]) && store.vrQueueArchive[0].log.length > 0 && store.vrQueueArchive[0].conteggi.verify === 2);

  // --- riprova: solo i falliti, mai i da verificare
  r = await invia({ type: 'vr:queueRetry' }); await pausa();
  ok('riprova falliti: solo l’articolo 3', r.ok && store.vrQueue.items.map((i) => i.id).join() === '3');
  await ferma();

  ok('dopo «riprova» la coda vecchia resta nell’archivio', store.vrQueueArchive.some((q) => q.startedAt === primaCoda));
  await invia({ type: 'vr:queueResolve', itemId: '1', pubblicato: true, queue: primaCoda }); await pausa();
  await ferma();
  r = await invia({ type: 'vr:queueRetry', queue: primaCoda }); await pausa();
  ok('riprova da una coda archiviata', r.ok && store.vrQueue.items.map((i) => i.id).join() === '3' && store.vrQueue.intervalMin === 20);
  await ferma();
  ok('verifica di una coda archiviata', store.vrQueueArchive.find((q) => q.startedAt === primaCoda).items[0].status === 'done');

  // --- lo stesso articolo due volte nella stessa richiesta
  r = await invia({ type: 'vr:queueStart', items: [{ id: '5' }, { id: '5' }, { id: '6' }] }); await pausa();
  ok('articolo ripetuto nella richiesta: entra una volta sola', r.ok && store.vrQueue.items.map((i) => i.id).join() === '5,6');
  await ferma();

  // --- stop con in attesa
  await invia({ type: 'vr:queueStart', items: items(3, 20), intervalMin: 20 }); await pausa();
  await invia({ type: 'vr:relistDone', itemId: '21', ok: true }); await pausa();
  await ferma();
  ok('interrompere: gli ultimi due annullati', store.vrQueue.items.filter((i) => i.status === 'cancelled').length === 2);
  ok('riavvio della stessa selezione dopo uno stop: parte', (await invia({ type: 'vr:queueStart', items: items(3, 20) })).ok);
  await ferma();

  // --- verifica manuale
  store.vrQueue = { running: false, items: [{ id: '7', status: 'verify', title: 'X' }, { id: '8', status: 'verify', title: 'Y' }] };
  await invia({ type: 'vr:queueResolve', itemId: '7', pubblicato: true }); await pausa();
  await invia({ type: 'vr:queueResolve', itemId: '8', pubblicato: false }); await pausa();
  ok('verificato pubblicato → completato', store.vrQueue.items[0].status === 'done');
  ok('verificato non pubblicato → fallito, quindi riprovabile', store.vrQueue.items[1].status === 'error');

  // --- articolo ripubblicato a mano dopo l'avvio: saltato
  await invia({ type: 'vr:queueStart', items: items(2, 30), intervalMin: 20 }); await pausa();
  store.vrHistory = [{ id: '32', at: Date.now() + 1 }];
  await invia({ type: 'vr:relistDone', itemId: '31', ok: true }); await pausa();
  await sveglia('vr:queueNext'); await pausa();
  ok('ripubblicato a mano nel frattempo: saltato', store.vrQueue.items[1].status === 'skipped' && !store.vrQueue.running);

  // --- watchdog: incerto, non fallito
  await invia({ type: 'vr:queueStart', items: items(1, 40), intervalMin: 20 }); await pausa();
  await sveglia('vr:queueWatchdog'); await pausa();
  ok('watchdog → da verificare', store.vrQueue.items[0].status === 'verify');

  // --- eventi
  const prima2 = store.vrEvents.length;
  await invia({ type: 'vr:event', evento: { kind: 'error', title: 'T', text: 'x' } });
  await invia({ type: 'vr:event', evento: { kind: 'error', title: 'T', text: 'x' } }); await pausa();
  ok('stesso evento due volte in un minuto: uno solo', store.vrEvents.length === prima2 + 1);
  await invia({ type: 'vr:event', evento: { kind: 'boh', title: 'Z', itemId: '12abc<script>' } }); await pausa();
  ok('tipo sconosciuto → info, id ripulito', store.vrEvents[0].kind === 'info' && store.vrEvents[0].itemId === '12');
  await invia({ type: 'vr:eventsRead' }); await pausa();
  ok('letti: badge vuoto', badge === '' && store.vrEvents.every((e) => e.read));

  // --- clic sulla notifica
  aperte = []; contesti = [];
  for (const f of L.clic) await f('vr-coda-123');
  ok('clic senza dashboard aperta: scheda nuova sul riepilogo', aperte[0]?.[0] === 'nuova' && /dashboard\.html#coda-123$/.test(aperte[0][1]));
  aperte = []; contesti = [{ tabId: 9, documentUrl: 'chrome-extension://x/src/dashboard.html#altro' }];
  for (const f of L.clic) await f('vr-coda-456');
  ok('clic con dashboard aperta: riusa la scheda', aperte[0]?.[0] === 'riusata' && aperte[0][1] === 9);
  ok('archivio limitato a 10 code', store.vrQueueArchive.length <= 10);

  // --- formato appreso per categoria (2.0.1)
  await ricordaFormatoCategoria({ catalog_id: 2320, title: 'Libro segreto', is_unisex: false, isbn: '978', color_ids: [] }, ['title', 'is_unisex', 'isbn', 'color_ids']);
  await ricordaFormatoCategoria({ catalog_id: 1800, title: 'Giacca', is_unisex: true, size_id: 207 }, ['title', 'is_unisex', 'size_id']);
  const f = store.itemFormats;
  ok('formato salvato per categoria', JSON.stringify(f['2320'].campi) === '["title","is_unisex","isbn","color_ids"]' && JSON.stringify(f['1800'].campi) === '["title","is_unisex","size_id"]');
  ok('neutri: false e [] sì, valori no', JSON.stringify(f['2320'].neutri) === '["is_unisex","color_ids"]' && JSON.stringify(f['1800'].neutri) === '[]');
  ok('salvati solo i nomi dei campi, non il contenuto', !JSON.stringify(f).includes('Libro segreto'));
  await ricordaFormatoCategoria({ title: 'x' }, ['title']);
  ok('senza categoria non si salva niente', Object.keys(store.itemFormats).length === 2);

  console.log(out.join('\n'));
  process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
