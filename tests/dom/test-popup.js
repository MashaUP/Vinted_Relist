// Popup 2.0: viste, coda, notifiche, salute, aggiornamenti, impostazioni.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = require('path').join(__dirname, '..', '..', 'src') + '/';
let pass = 0, fail = 0;
const ok = (n, c) => { console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}`); c ? pass++ : fail++; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const CHANGELOG = '# Changelog\n\n## 2.0.0 · Popup nuovo (17 ottobre 2026)\n- **Popup** a schede\n- Download delle foto\n\n## 1.9.0 · Editor\n- Ritaglio\n';

async function apri(store, { hash = '', session = {}, versioneRemota = null, statoRemoto = 200, inScheda = false } = {}) {
  const html = fs.readFileSync(SRC + 'popup.html', 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: `chrome-extension://abc/src/popup.html${hash}` });
  const w = dom.window;
  const ascoltatori = [];
  const messaggi = [];
  const schede = [];
  const scaricati = [];
  const richieste = [];
  const errori = [];
  w.addEventListener('error', (e) => errori.push(e.message));
  let ricaricata = false;
  w.chrome = {
    storage: {
      local: {
        get: async (k) => {
          if (k === null || k === undefined) return JSON.parse(JSON.stringify(store));
          if (typeof k === 'string') return { [k]: store[k] };
          if (Array.isArray(k)) { const o = {}; for (const x of k) o[x] = store[x]; return o; }
          const o = {}; for (const [a, b] of Object.entries(k)) o[a] = a in store ? store[a] : b; return o;
        },
        set: async (o) => {
          const changes = {};
          for (const [k, v] of Object.entries(o)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
          ascoltatori.forEach((f) => f(changes, 'local'));
        },
        remove: async (k) => { const changes = { [k]: { oldValue: store[k] } }; delete store[k]; ascoltatori.forEach((f) => f(changes, 'local')); },
      },
      session: { get: async (k) => ({ [k]: session[k] }) },
      onChanged: { addListener: (f) => ascoltatori.push(f) },
    },
    runtime: {
      getManifest: () => ({ version: '2.0.0' }),
      getURL: (p) => `chrome-extension://abc/${p}`,
      sendMessage: async (m) => { messaggi.push(m); return { ok: true }; },
      reload: () => { ricaricata = true; },
    },
    tabs: { query: async () => [], create: async (o) => schede.push(o.url), getCurrent: async () => (inScheda ? { id: 1 } : undefined) },
    downloads: { download: async (o) => { scaricati.push(o); return 1; } },
  };
  w.fetch = async (url) => {
    richieste.push(url);
    if (url.endsWith('CHANGELOG.md')) return { ok: true, text: async () => CHANGELOG };
    return { ok: statoRemoto === 200, status: statoRemoto, text: async () => JSON.stringify(versioneRemota) };
  };
  let appunti = '';
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { appunti = t; } } });
  w.close = () => {};
  for (const f of ['utils.js', 'versione.js', 'impostazioni.js', 'popup.js']) w.eval(fs.readFileSync(SRC + f, 'utf8'));
  await tick(30);
  const d = w.document;
  return {
    w, d, store, messaggi, schede, scaricati, richieste, errori, ascoltatori,
    appunti: () => appunti, ricaricata: () => ricaricata,
    btn: (testo, radice = d) => [...radice.querySelectorAll('button')].find((b) => b.textContent.trim() === testo),
    tab: (nome) => d.querySelector(`.tab[data-tab="${nome}"]`),
    cambia: async (input, valore) => {
      if (input.type === 'checkbox') input.checked = valore; else input.value = valore;
      input.dispatchEvent(new w.Event('input'));
      input.dispatchEvent(new w.Event('change'));
      await tick();
    },
  };
}

const EVENTI = [
  { id: 'a', at: Date.now() - 120000, kind: 'error', title: 'Ripubblicazione fallita', text: 'Vinted ha rifiutato', itemId: '55', queue: null, read: false },
  { id: 'b', at: Date.now() - 3600000 * 3, kind: 'end', title: 'Coda finita', text: '3 ripubblicati', itemId: null, queue: 1700, read: false },
  { id: 'c', at: Date.now() - 86400000 * 3, kind: 'ok', title: 'Ripubblicato', text: '', itemId: null, queue: null, read: true },
];

(async () => {
  // ---------------------------------------------------------------- coda vuota
  let p = await apri({ userId: '129315368', vintedOrigin: 'https://www.vinted.it' });
  let a = p.d.querySelector('#queueCard a.btn');
  ok('coda vuota: bottone verso il tuo armadio', a.href === 'https://www.vinted.it/member/129315368' && /Apri armadio/.test(a.textContent));
  ok('Home visibile all’apertura', !p.d.getElementById('view-home').hidden && p.d.getElementById('view-salute').hidden);
  ok('versione in testa', p.d.getElementById('version').textContent === 'v2.0.0');
  const kofi = [...p.d.querySelectorAll('a[href="https://ko-fi.com/mashaup"]')];
  ok('link Ko-fi presente (home e impostazioni)', kofi.length === 2 && kofi.every((k) => k.rel.includes('noopener')));

  p = await apri({ vintedOrigin: 'https://www.vinted.fr' });
  a = p.d.querySelector('#queueCard a.btn');
  ok('senza id: «Apri Vinted» sul dominio visitato', a.href === 'https://www.vinted.fr/' && a.textContent === 'Apri Vinted');
  await p.w.chrome.storage.local.set({ userId: '42' });
  a = p.d.querySelector('#queueCard a.btn');
  ok('id arrivato col popup aperto: link aggiornato', a.href === 'https://www.vinted.fr/member/42');
  await tick(10);
  ok('profilo arrivato: lo stato torna «Pronto»', p.d.getElementById('healthText').textContent === 'Pronto');

  // ------------------------------------------------------------- coda in corso
  const items = Array.from({ length: 12 }, (_, i) => ({ id: String(100 + i), title: `Articolo ${i}`, status: i < 2 ? 'done' : i === 2 ? 'error' : 'pending', thumb: i === 3 ? 'https://images1.vinted.net/t/x.webp' : null }));
  p = await apri({ userId: '1', vrQueue: { running: true, state: 'working', index: 3, items, startedAt: 1700, step: 'Carico le foto 2 di 5' } });
  const card = p.d.getElementById('queueCard');
  ok('anello 3/12', card.querySelector('.ring span').textContent === '3/12');
  ok('chip «In corso» e passo corrente', /In corso/.test(card.textContent) && /Carico le foto 2 di 5/.test(card.textContent));
  ok('articolo corrente con miniatura del CDN', card.querySelector('.current img')?.getAttribute('src') === 'https://images1.vinted.net/t/x.webp');
  ok('contatori: 2 completati, 1 fallito, 9 rimanenti', [...card.querySelectorAll('.counters b')].map((b) => b.textContent).join() === '2,1,0,9');
  p.btn('Pausa').click(); p.btn('Salta').click(); p.btn('Interrompi').click(); await tick();
  ok('Pausa/Salta/Interrompi mandano i comandi', p.messaggi.map((m) => m.type).join() === 'vr:queuePause,vr:queueSkip,vr:queueStop');

  // miniatura da un dominio estraneo: ignorata
  items[3].thumb = 'https://evil.example/x.png';
  await p.w.chrome.storage.local.set({ vrQueue: { running: true, state: 'working', index: 3, items, startedAt: 1700 } });
  ok('miniature solo dal CDN di Vinted', !card.querySelector('.current img'));

  // ------------------------------------------------------------ coda conclusa
  const fine = [
    { id: '1', title: 'Giacca', status: 'done' },
    { id: '2', title: 'Libro', status: 'error', error: 'Vinted ha rifiutato: prezzo' },
    { id: '3', title: 'DVD', status: 'verify', error: 'Esito incerto' },
  ];
  p = await apri({ userId: '1', vrQueue: { running: false, finishedAt: 2, startedAt: 1700, index: 3, items: fine } });
  ok('coda finita: 2 da guardare', /Coda finita: 2 da guardare/.test(p.d.getElementById('queueCard').textContent));
  ok('problemi elencati con il motivo', p.d.querySelectorAll('.problems li').length === 2 && /prezzo/.test(p.d.querySelector('.problems').textContent));
  p.btn('È stato pubblicato').click(); await tick();
  ok('risolvere un «da verificare»', JSON.stringify(p.messaggi.at(-1)) === JSON.stringify({ type: 'vr:queueResolve', itemId: '3', pubblicato: true, queue: 1700 }));
  p.btn('Riprova i falliti (1)').click(); await tick();
  ok('riprova solo i falliti', p.messaggi.at(-1).type === 'vr:queueRetry');
  p.btn('Dettagli').click(); await tick();
  ok('dettagli: dashboard sulla coda giusta', p.messaggi.at(-1).type === 'vr:openPage' && p.messaggi.at(-1).pagina === 'src/dashboard.html#coda-1700');
  ok('stato estensione: da controllare', /Da controllare: coda/.test(p.d.getElementById('healthText').textContent) && !p.d.getElementById('healthBadge').hidden);

  // ---------------------------------------------------------------- notifiche
  p = await apri({ userId: '1', vrEvents: JSON.parse(JSON.stringify(EVENTI)) });
  const badge = p.d.getElementById('unreadBadge');
  ok('badge: 2 non lette, rosso per l’errore', !badge.hidden && badge.textContent === '2' && badge.classList.contains('problem'));
  p.tab('notifiche').click(); await tick();
  ok('scheda notifiche: tre eventi', p.d.querySelectorAll('.event').length === 3);
  ok('aperta la scheda, segnate lette', p.messaggi.some((m) => m.type === 'vr:eventsRead'));
  ok('tempo relativo', /2 min fa/.test(p.d.querySelector('.event-time').textContent));
  p.btn('Problemi').click();
  ok('filtro problemi', p.d.querySelectorAll('.event').length === 1);
  p.btn('Tutte').click();
  p.d.querySelectorAll('.event')[1].click(); await tick();
  ok('clic su evento di coda: dashboard', p.messaggi.at(-1).pagina === 'src/dashboard.html#coda-1700');
  p.d.querySelectorAll('.event')[0].click(); await tick();
  ok('clic su evento di articolo: annuncio', p.schede.at(-1) === 'https://www.vinted.it/items/55');
  p.btn('Svuota').click(); await tick();
  ok('svuota', p.store.vrEvents.length === 0 && !p.d.querySelector('.event') && !p.d.getElementById('eventsEmpty').hidden);

  // hash: notifica di sistema → popup.html#notifiche
  p = await apri({ vrEvents: JSON.parse(JSON.stringify(EVENTI)) }, { hash: '#notifiche' });
  ok('#notifiche apre la vista giusta', !p.d.getElementById('view-notifiche').hidden);

  // ------------------------------------------------------------------ salute
  p = await apri({ userId: '129315368', vintedOrigin: 'https://www.vinted.it', colorMap: { 1: 'Nero' }, delayMs: 1500,
    vrQueue: { running: false, finishedAt: 2, startedAt: 1700, items: [{ id: '9', title: 'Mail mario@example.com', status: 'error', error: 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc' }] } },
  { session: { vrTokens: { csrf: 'SEGRETO-CSRF-123' } } });
  p.tab('salute').click(); await tick(20);
  const checks = p.d.getElementById('checks').textContent;
  ok('controlli elencati', p.d.querySelectorAll('#checks li').length === 8);
  ok('sessione attiva ma token mai mostrato', /attiva/.test(checks) && !/SEGRETO/.test(p.d.body.innerHTML));
  ok('changelog incluso nel pacchetto', /2\.0\.0 · Popup nuovo/.test(p.d.getElementById('changelog').textContent) && /Popup a schede/.test(p.d.getElementById('changelog').textContent));
  p.btn('Prepara la diagnostica').click(); await tick(20);
  const diag = p.d.getElementById('diagText').value;
  ok('diagnostica: anteprima prima di copiare', !p.d.getElementById('diagBox').hidden && /Vinted Relist 2\.0\.0/.test(diag));
  ok('diagnostica senza segreti, id, email né titoli', !/SEGRETO|129315368|mario@example|eyJhbGci/.test(diag) && /\[token\]/.test(diag) && !/Mail/.test(diag));
  ok('diagnostica senza dati appresi', !/colorMap|Nero/.test(diag) && /delayMs: 1500/.test(diag));
  p.btn('Copia diagnostica').click(); await tick();
  ok('copiata negli appunti', p.appunti() === diag);

  // ----------------------------------------------------------- aggiornamenti
  p = await apri({ vrQueue: { running: true, state: 'working', index: 0, items: [{ id: '1', title: 'x', status: 'pending' }] } },
    { versioneRemota: { version: '2.1.0', date: '2026-11-01', zip: 'Vinted_Relist-2.1.0.zip', notes: ['Novità A', '<b>x</b>'] } });
  p.tab('salute').click(); await tick(10);
  p.btn('Cerca aggiornamento').click(); await tick(20);
  ok('chiede version.json al repository predefinito', p.richieste.includes('https://api.github.com/repos/MashaUP/Vinted_Relist/contents/version.json'));
  ok('aggiornamento disponibile', /Disponibile la 2\.1\.0 \(hai la 2\.0\.0\)/.test(p.d.getElementById('updateResult').textContent) && !p.d.getElementById('updateAvailable').hidden);
  ok('note mostrate come testo, non HTML', p.d.querySelectorAll('#updateNotes li').length === 2 && !p.d.querySelector('#updateNotes b'));
  p.btn('Scarica lo zip').click(); await tick();
  ok('scarica lo zip dal repository', p.schede.at(-1) === 'https://github.com/MashaUP/Vinted_Relist/raw/HEAD/Vinted_Relist-2.1.0.zip');
  ok('installazione bloccata con un articolo in pubblicazione', p.btn('Installa l\'aggiornamento').disabled && /in pubblicazione/.test(p.d.getElementById('reloadWarn').textContent));
  const prima = p.richieste.length;
  p.btn('Cerca aggiornamento').click(); await tick(20);
  ok('un controllo al minuto: niente seconda richiesta', p.richieste.length === prima && /tra un minuto/.test(p.d.getElementById('updateResult').textContent));
  await p.w.chrome.storage.local.set({ vrQueue: { running: true, state: 'paused', index: 0, items: [{ id: '1', title: 'x', status: 'pending' }] } });
  ok('in pausa si può installare, con avviso', !p.btn('Installa l\'aggiornamento').disabled && /interrotta/.test(p.d.getElementById('reloadWarn').textContent));
  p.btn('Installa l\'aggiornamento').click();
  ok('installa = ricarica dei file locali', p.ricaricata());

  p = await apri({ updateRepo: 'MashaUP/Altro' }, { statoRemoto: 404 });
  p.tab('salute').click(); await tick(10);
  p.btn('Cerca aggiornamento').click(); await tick(20);
  ok('repository personalizzato', p.richieste.includes('https://api.github.com/repos/MashaUP/Altro/contents/version.json'));
  ok('404: spiega privato o nome sbagliato', /Repository non trovato/.test(p.d.getElementById('updateResult').textContent));

  p = await apri({}, { versioneRemota: { version: '2.0.0' } });
  p.tab('salute').click(); await tick(10);
  p.btn('Cerca aggiornamento').click(); await tick(20);
  ok('già aggiornata', /Hai l'ultima versione/.test(p.d.getElementById('updateResult').textContent) && p.d.getElementById('updateAvailable').hidden);

  // ------------------------------------------------------------ impostazioni
  p = await apri({ delayMs: 1200, deleteOld: true });
  p.d.getElementById('openSettings').click();
  ok('ingranaggio apre le impostazioni', !p.d.getElementById('view-impostazioni').hidden && p.d.getElementById('headTitle').textContent === 'Impostazioni');
  const campo = (k) => p.d.querySelector(`[data-key="${k}"]`);
  ok('valori caricati', campo('delayMs').value === '1200' && campo('deleteOld').checked);
  await p.cambia(campo('delayMs'), '100');
  ok('pausa troppo bassa: errore e non salvata', p.store.delayMs === 1200 && /300/.test(p.d.querySelector('#err-delayMs').textContent) && campo('delayMs').getAttribute('aria-invalid') === 'true');
  await p.cambia(campo('delayMs'), '800');
  ok('valore corretto salvato come numero', p.store.delayMs === 800 && p.d.querySelector('#err-delayMs').hidden);
  await p.cambia(campo('peakWindows'), '22:00-01:00');
  ok('fascia a cavallo della mezzanotte rifiutata', p.store.peakWindows === undefined && /mezzanotte/.test(p.d.querySelector('#err-peakWindows').textContent));
  await p.cambia(campo('peakWindows'), ' 9:00-12:00 ,18:00-21:30');
  ok('fasce valide normalizzate', p.store.peakWindows === '9:00-12:00, 18:00-21:30' && campo('peakWindows').value === '9:00-12:00, 18:00-21:30');
  await p.cambia(campo('deleteOld'), false);
  ok('interruttore salvato', p.store.deleteOld === false && /Salvato/.test(p.d.getElementById('savedFlag').textContent));
  await p.cambia(campo('updateRepo'), 'https://github.com/x');
  ok('repository non valido rifiutato', p.store.updateRepo === undefined);
  await p.cambia(campo('autoRuleDays'), '61');
  ok('giorni fuori intervallo rifiutati', p.store.autoRuleDays === undefined);

  p.store.colorMap = { 1: 'Nero' }; p.store.userId = '7';
  p.btn('Esporta').click(); await tick(10);
  const file = p.scaricati.at(-1);
  const json = JSON.parse(decodeURIComponent(file.url.split(',')[1]));
  ok('backup: file JSON nella cartella dell’estensione', /^Vinted Relist\/vinted-relist-impostazioni-\d{4}-\d{2}-\d{2}\.json$/.test(file.filename));
  ok('backup: solo impostazioni, niente dati appresi o id', json.impostazioni.delayMs === 800 && !('colorMap' in json.impostazioni) && !('userId' in json.impostazioni));

  p.btn('Importa…').click(); await tick();
  ok('importa dal popup: apre la scheda (il selettore chiuderebbe il popup)', p.messaggi.at(-1)?.pagina === 'src/popup.html#impostazioni');

  ok('nessun errore JavaScript', !p.errori.length);
  console.log(`\n${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
