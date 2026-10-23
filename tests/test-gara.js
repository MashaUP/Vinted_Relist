// Regressione 2.0.x: l'aggiornamento del passo e l'esito arrivavano insieme e il primo
// sovrascriveva il secondo. Storage con latenze casuali, 40 giri.
const fs = require('fs');
let store = {}, alarms = {};
const L = { alarm: [], message: [] };
// storage asincrono vero: ogni operazione richiede qualche giro dell'event loop, come in Chrome
const tardi = (v) => new Promise((r) => setTimeout(() => r(v), Math.random() * 5));
global.chrome = {
  storage: { local: {
    get: async (k) => tardi(typeof k === 'string' ? { [k]: JSON.parse(JSON.stringify(store[k] ?? null)) ?? undefined } : (() => { const o = {}; for (const [a, b] of Object.entries(k || {})) o[a] = a in store ? JSON.parse(JSON.stringify(store[a])) : b; return o; })()),
    set: async (o) => tardi(Object.assign(store, JSON.parse(JSON.stringify(o)))), remove: async (k) => { delete store[k]; } },
    session: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
  alarms: { create: (n, o) => { alarms[n] = 1; }, clear: (n) => { delete alarms[n]; }, get: async (n) => alarms[n], onAlarm: { addListener: (f) => L.alarm.push(f) } },
  idle: { queryState: async () => 'active' },
  notifications: { create() {}, clear() {}, onClicked: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: { query: async () => [{ id: 1, status: 'complete' }], sendMessage: async () => ({}) },
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p) => p, getManifest: () => ({ version: 'x' }), onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  webRequest: { onSendHeaders: { addListener() {} }, onBeforeRequest: { addListener() {} } },
};
require(require('path').join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(require('path').join(__dirname, '..', 'background.js'), 'utf8'));
const invia = (m) => new Promise((r) => { for (const f of L.message) if (f(m, {}, r)) return; r(null); });
(async () => {
  let regressioni = 0;
  for (let giro = 0; giro < 40; giro++) {
    store = {};
    await invia({ type: 'vr:queueStart', items: [{ id: '1' }, { id: '2' }], intervalMin: 20 });
    // come fa queue.js: passo("Fatto") e subito dopo l'esito
    await Promise.all([
      invia({ type: 'vr:queueProgress', itemId: '1', step: 'Fatto' }),
      invia({ type: 'vr:relistDone', itemId: '1', ok: true }),
    ]);
    await new Promise((r) => setTimeout(r, 30));
    if (store.vrQueue.items[0].status !== 'done') regressioni++;
    await invia({ type: 'vr:queueStop' });
  }
  // Fino alla 2.0.1 succedeva circa 1 volta su 4: l'articolo tornava "in attesa" e veniva ripubblicato.
  console.log(`  ${regressioni === 0 ? 'OK  ' : 'FAIL'} passo «Fatto» ed esito insieme: esito mai perso (${40 - regressioni}/40)`);
  process.exit(regressioni ? 1 : 0);
})();
