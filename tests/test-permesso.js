// 2.3.0 — «Fermato prima dell'invio a Vinted: permesso negato».
// Nella 2.2 questa frase usciva ogni volta che la risposta del service worker
// al permesso arrivava senza motivo: un errore interno (per esempio il
// salvataggio della coda rifiutato da chrome.storage) o una risposta vuota.
// Qui: ogni no ha codice e motivo, un problema tecnico ferma la coda invece di
// annullare un articolo dopo l'altro, la diagnostica lo registra, la riparazione
// sistema i dati, il controllo degli aggiornamenti avvisa una volta per versione.
const fs = require('fs');
const path = require('path');
let store = {}, alarms = {}, inviati = [], notifiche = [], scritturaRotta = null, risposteFetch = [];
const sessione = { vrTokens: { csrf: 'SEGRETO-CSRF-1234567890', anonId: 'anon-xyz' } };
const L = { alarm: [], message: [], changed: [] };
const tardi = (v) => new Promise((r) => setTimeout(() => r(v), Math.random() * 3));
const copia = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
global.chrome = {
  storage: {
    local: {
      QUOTA_BYTES: 10485760,
      get: async (k) => {
        if (k === null) return tardi(copia(store));
        if (typeof k === 'string') return tardi({ [k]: copia(store[k]) });
        if (Array.isArray(k)) { const o = {}; for (const x of k) o[x] = copia(store[x]); return tardi(o); }
        const o = {}; for (const [a, b] of Object.entries(k || {})) o[a] = a in store ? copia(store[a]) : b; return tardi(o);
      },
      set: async (o) => { if (scritturaRotta && scritturaRotta(o)) throw new Error('QUOTA_BYTES quota exceeded'); return tardi(Object.assign(store, copia(o))); },
      remove: async (k) => tardi([].concat(k).forEach((x) => delete store[x])),
      getBytesInUse: async () => JSON.stringify(store).length,
    },
    session: { get: async (k) => (k == null ? { ...sessione } : { [k]: sessione[k] }), set: async (o) => Object.assign(sessione, o) },
    onChanged: { addListener: (f) => L.changed.push(f) },
  },
  alarms: {
    create: (n, o) => { alarms[n] = { when: o.when ?? Date.now() + (o.delayInMinutes || 0) * 60000, periodInMinutes: o.periodInMinutes }; },
    clear: (n) => { delete alarms[n]; }, get: async (n) => (alarms[n] ? { name: n, periodInMinutes: alarms[n].periodInMinutes } : undefined),
    getAll: async () => Object.entries(alarms).map(([name, a]) => ({ name, scheduledTime: a.when, periodInMinutes: a.periodInMinutes })),
    onAlarm: { addListener: (f) => L.alarm.push(f) },
  },
  permissions: { getAll: async () => ({ permissions: ['storage', 'webRequest', 'alarms', 'notifications', 'idle', 'downloads'], origins: [] }), contains: async () => true },
  idle: { queryState: async () => 'active' },
  notifications: { create: (id, o) => notifiche.push({ id, ...o }), clear() {}, onClicked: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: {
    query: async () => [{ id: 1, status: 'complete' }],
    get: async (id) => ({ id }),
    sendMessage: async (_id, m) => {
      inviati.push(m);
      if (m.type === 'vr:ping') return { build: '2.4.0', manifest: '2.4.0', pagina: 'armadio-mio', utenteNoto: true, lavorazioni: 1 };
      if (m.type === 'vr:relistStatus') return { inCorso: true, passo: 'Foto' };
      return { accepted: true };
    },
  },
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p) => p, getManifest: () => ({ version: '2.4.0', permissions: ['storage', 'webRequest', 'alarms', 'notifications', 'idle', 'downloads'], host_permissions: ['https://www.vinted.it/*'] }),
    onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  webRequest: { onSendHeaders: { addListener() {} }, onBeforeRequest: { addListener() {} } },
};
global.fetch = async (url) => { const r = risposteFetch.shift(); if (!r) throw new Error('rete'); return { ok: r.status === 200, status: r.status, text: async () => JSON.stringify(r.corpo) }; };
require(path.join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'));

const invia = (m) => new Promise((r) => { for (const f of L.message) if (f(m, {}, r)) return; r(null); });
const sveglia = async (n) => { delete alarms[n]; for (const f of L.alarm) await f({ name: n }); };
const calma = () => new Promise((r) => setTimeout(r, 40));
const art = (...ids) => ids.map((id) => ({ id: String(id), title: `Titolo privato ${id}`, price: 10 }));
const q = () => store.vrQueue;
const a = (id) => q().items.find((i) => i.id === String(id));
const permesso = (id, extra = {}) => invia({ type: 'vr:relistConfirm', itemId: String(id), avviatoAt: a(id).startedAt, traccia: { fotoIds: ['1'] }, build: '2.4.0', ...extra });
const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);

(async () => {
  store = { userId: '129315368', humanRhythm: false };
  await invia({ type: 'vr:queueStart', items: art(10549068618, 10548880362, 3), intervalMin: 20 }); await calma();
  const primo = '10549068618';

  // 1. Il meccanismo dello screenshot: il salvataggio della coda rifiutato durante il permesso.
  let rotte = 0;
  scritturaRotta = (o) => 'vrQueue' in o && ++rotte <= 2;          // due tentativi falliti (anche dopo la compattazione)
  let r = await permesso(primo); await calma();
  scritturaRotta = null;
  ok('1. salvataggio rifiutato: no con codice «salvataggio» e la causa, non un no muto', r.ok === false && r.codice === 'salvataggio' && /QUOTA_BYTES/.test(r.motivo) && /spazio usato/.test(r.motivo) && r.ritentabile);
  ok('   la fase non risulta «invio»: niente è autorizzato', a(primo).fase === 'preparazione');
  ok('   registrato fra gli errori, senza id né titoli', store.vrErrori?.[0]?.codice === 'salvataggio' && !JSON.stringify(store.vrErrori).includes('Titolo privato') && !JSON.stringify(store.vrErrori).includes(primo));
  rotte = 0;
  scritturaRotta = (o) => 'vrQueue' in o && ++rotte <= 1;          // la prima fallisce, poi c'è spazio
  r = await permesso(primo); await calma();
  scritturaRotta = null;
  ok('   quota piena una volta: compatta, riprova e concede', r.ok === true && a(primo).fase === 'invio');

  // 2. Versioni diverse fra pagina e service worker (file vecchi in memoria).
  await invia({ type: 'vr:relistDone', itemId: primo, avviatoAt: a(primo).startedAt, ok: true }); await calma();
  await sveglia('vr:queueNext'); await calma();
  r = await permesso('10548880362', { build: '2.2.0' }); await calma();
  ok('2. versione della pagina diversa: no con codice «versione» e cosa fare', !r.ok && r.codice === 'versione' && /ricarica la scheda/.test(r.motivo));

  // 3. Eccezione interna nel gestore: codice e motivo, non {ok:false} muto.
  const vera = CodaLogica.annotaTraccia;
  CodaLogica.annotaTraccia = () => { throw new TypeError("Cannot read properties of undefined (reading 'fotoIds')"); };
  r = await permesso('10548880362'); await calma();
  CodaLogica.annotaTraccia = vera;
  ok('3. errore interno: codice «interno» e il messaggio vero', !r.ok && r.codice === 'interno' && /reading 'fotoIds'/.test(r.motivo) && r.ritentabile);

  // 4. La pagina riferisce l'interruzione tecnica: la coda si ferma con il motivo, non annulla gli altri.
  await invia({ type: 'vr:relistDone', itemId: '10548880362', avviatoAt: a('10548880362').startedAt, ok: false, outcome: 'interrupted', categoria: 'comunicazione', sicuro: 'si',
    error: "Fermato prima dell'invio a Vinted: errore interno del service worker (x). Nessun annuncio creato o eliminato." }); await calma();
  ok('4. problema tecnico: coda in pausa con il motivo vero', q().state === 'paused' && q().pausaAuto && /errore interno del service worker/.test(q().motivoPausa) && /Niente è stato inviato/.test(q().motivoPausa));
  ok('   l\'articolo torna in cima, gli altri restano in attesa (nessun «Annullato» a catena)', a('10548880362').status === 'pending' && a(3).status === 'pending' && !q().items.some((i) => i.status === 'cancelled'));
  ok('   nessun nuovo invio alla pagina mentre è in pausa', !('vr:queueNext' in alarms));

  // 5. Report diagnostico: confrontabile, senza segreti.
  store.vrBackup_finto = 1;
  store['vrBackup:999'] = { draft: { title: 'Titolo privato backup' } };
  store.showOnOtherProfiles = true;
  const rep = await invia({ type: 'vr:diagnosi' });
  const testo = JSON.stringify(rep);
  ok('5. report: formato, versioni dei tre componenti, permessi', rep.formato === 'vinted-relist-diagnosi' && rep.versioni.serviceWorker === '2.4.0' && rep.versioni.codaLogica === '2.4.0' && rep.permessi.mancanti.length === 0 && rep.permessi.hostRichiesti === 1);
  ok('   spazio usato e gruppi di chiavi (solo misure)', rep.archivio.totale > 0 && rep.archivio.gruppi['vrBackup:*'].chiavi === 1 && rep.copieSicurezza === 1);
  ok('   struttura della coda, sveglie, schede che rispondono e con quale codice', rep.coda.schema === 3 && rep.coda.batch === 1 && rep.sveglie.length > 0 && rep.schede.dettaglio[0].build === '2.4.0' && rep.schede.dettaglio[0].pagina === 'armadio-mio');
  ok('   dati di versioni vecchie segnalati', rep.datiVecchi.includes('showOnOtherProfiles'));
  ok('   errori recenti con i codici', rep.erroriRecenti.some((e) => e.codice === 'salvataggio') && rep.erroriRecenti.some((e) => e.codice === 'versione'));
  ok('   niente token, id utente, titoli', !/SEGRETO-CSRF|anon-xyz|129315368|Titolo privato/.test(testo) && rep.sessione.tokenCsrf === true);
  const diff = Versione.differenzeRapporti(rep, { ...rep, generato: 'altro', versioni: { ...rep.versioni, codaLogica: '2.2.0' } });
  ok('   confronto fra due report: solo le differenze vere', diff.length === 1 && diff[0].percorso === 'versioni.codaLogica');

  // 6. Riparazione mirata.
  store.vrQueue.items.push({ id: '3', title: 'doppio', status: 'pending' }, { id: '77', title: 'x', status: 'boh' });
  store.vrQueue.items[2].status = 'working'; store.vrQueue.items[2].startedAt = Date.now();
  store.vrQueue.items[1].status = 'working';
  store['vrOp:555'] = { at: Date.now() };
  r = await invia({ type: 'vr:riparaCoda' }); await calma();
  const doppi = q().items.filter((i) => i.id === '3').length;
  ok('6. ripara: doppione tolto, stato sconosciuto sistemato, un solo «in elaborazione»', r.ok && doppi === 1 && a(77).status === 'cancelled' && q().items.filter((i) => i.status === 'working').length <= 1 && q().items.some((i) => i.status === 'verify'));
  ok('   copia di com\'era conservata, giornale orfano tolto, inventario e impostazioni intatti', store.vrQueuePrimaRiparazione?.coda?.items?.length === 5 && !('vrOp:555' in store) && store.userId === '129315368');
  ok('   nel dubbio «da verificare», mai «in attesa»', !q().items.some((i) => i.status === 'pending' && i.startedAt));

  // 7. All'avvio del service worker la stessa riparazione, registrata.
  store.vrQueue.items.push({ id: '3', title: 'ancora doppio', status: 'pending' });
  await recuperaCoda(); await calma();
  ok('7. all\'avvio: struttura sistemata e annotata fra gli errori', q().items.filter((i) => i.id === '3').length === 1 && store.vrErrori.some((e) => e.dove === 'avvio' && /doppione/.test(e.messaggio)));

  // 8. Aggiornamenti: sveglia ogni 12 ore, una notifica per versione.
  await programmaControlloAggiornamenti(); await calma();
  ok('8. sveglia degli aggiornamenti ogni 12 ore', alarms['vr:updateCheck']?.periodInMinutes === 720);
  const versione = (v) => ({ status: 200, corpo: { version: v, date: '2026-11-04', zip: `Vinted_Relist-${v}.zip`, notes: ['Novità'] } });
  risposteFetch = [versione('2.5.0')];
  await sveglia('vr:updateCheck'); await calma();
  ok('   2.5.0 pubblicata: una notifica', notifiche.filter((n) => /2\.5\.0/.test(n.title)).length === 1 && store.updateNotified.versione === '2.5.0');
  store.updateCheck.at = 0; risposteFetch = [versione('2.5.0')];
  await sveglia('vr:updateCheck'); await calma();
  store.updateCheck.at = 0; risposteFetch = [versione('2.5.0')];
  await sveglia('vr:updateCheck'); await calma();
  ok('   2.5.0 di nuovo, due volte: nessuna nuova notifica', notifiche.filter((n) => /2\.5\.0/.test(n.title)).length === 1);
  store.updateCheck.at = 0; risposteFetch = [versione('2.6.0-beta.1')];
  await sveglia('vr:updateCheck'); await calma();
  ok('   prerelease: nessuna notifica a chi ha una versione stabile', !notifiche.some((n) => /beta/.test(n.title)));
  store.updateCheck.at = 0; risposteFetch = [versione('2.6.0')];
  await sveglia('vr:updateCheck'); await calma();
  ok('   2.6.0: nuova notifica', notifiche.filter((n) => /2\.6\.0/.test(n.title)).length === 1 && store.updateNotified.versione === '2.6.0');
  const prima = notifiche.length;
  risposteFetch = [];
  await sveglia('vr:updateCheck'); await calma();
  ok('   controllo recente: nessuna richiesta nuova', notifiche.length === prima && risposteFetch.length === 0);
  store.updateCheck.at = 0; risposteFetch = [];
  await sveglia('vr:updateCheck'); await calma();
  ok('   GitHub irraggiungibile: nessuna notifica, errore conservato', notifiche.length === prima && /non è raggiungibile/.test(store.updateCheck.remota.errore));
  store.autoUpdateCheck = false;
  await programmaControlloAggiornamenti();
  ok('   spento nelle impostazioni: niente sveglia', !('vr:updateCheck' in alarms));

  console.log(out.join('\n'));
  process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
})();
