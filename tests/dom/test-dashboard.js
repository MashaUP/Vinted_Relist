// Dashboard 2.0: pannello coda (#coda-<id>), ricerca, ordinamento, miniature, confronto.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = require('path').join(__dirname, '..', '..', 'src') + '/';
let pass = 0, fail = 0;
const ok = (n, c) => { console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}`); c ? pass++ : fail++; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const ora = Date.now();

function store() {
  return {
    vintedOrigin: 'https://www.vinted.it',
    inventory: {
      '11': { title: 'Libro di cucina', price: 8, views: 30, favs: 2, relistedAt: ora - 9 * 86400000, thumb: 'https://images1.vinted.net/a.webp' },
      '12': { title: 'Giacca in denim', price: 25, views: 100, favs: 9, relistedAt: ora - 2 * 86400000, thumb: 'https://evil.example/x.png' },
      '13': { title: 'Perché leggere i classici', price: 5, views: 4, favs: 0 },
    },
    qualityScores: { '11': { score: 80 }, '12': { score: 55 } },
    vrSnapshots: [{ n: 1, at: ora - 86400000, old: { id: '9', title: 'Giacca jeans', description: 'Bella', price: 30 }, new: { id: '12', title: 'Giacca in denim', description: 'Bella', price: 25 } }],
    vrQueue: { running: false, startedAt: 2000, finishedAt: 2100, index: 3, items: [
      { id: '11', title: 'Libro di cucina', status: 'done' },
      { id: '12', title: 'Giacca in denim', status: 'verify', error: 'Esito incerto' },
      { id: '13', title: 'Perché leggere', status: 'error', error: 'prezzo rifiutato' }] },
    vrQueueArchive: [{ startedAt: 1000, finishedAt: 1100, items: [{ id: '5', title: 'Vecchio', status: 'done' }] }],
  };
}

async function apri(hash = '', dati = store()) {
  const html = fs.readFileSync(SRC + 'dashboard.html', 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: `chrome-extension://abc/src/dashboard.html${hash}` });
  const w = dom.window;
  const messaggi = [], schede = [], errori = [], asc = [];
  w.addEventListener('error', (e) => errori.push(e.message));
  w.HTMLElement.prototype.scrollIntoView = function () { this.dataset.scrolled = '1'; };
  w.chrome = {
    storage: { local: {
      get: async (k) => { const o = {}; for (const [a, b] of Object.entries(k)) o[a] = a in dati ? dati[a] : b; return JSON.parse(JSON.stringify(o)); },
      set: async (o) => { const ch = {}; for (const [k, v] of Object.entries(o)) { ch[k] = { newValue: v }; dati[k] = v; } asc.forEach((f) => f(ch, 'local')); },
    }, onChanged: { addListener: (f) => asc.push(f) } },
    runtime: { getManifest: () => ({ version: '2.0.0' }), getURL: (p) => `chrome-extension://abc/${p}`,
      sendMessage: async (m) => { messaggi.push(m); return { ok: true }; } },
    tabs: { create: (o) => schede.push(o.url), query: async () => [] },
  };
  w.confirm = () => true; w.alert = () => {};
  for (const f of ['analisi.js', 'dashboard.js']) w.eval(fs.readFileSync(SRC + f, 'utf8'));
  await tick(30);
  return { w, d: w.document, dati, messaggi, schede, errori,
    righe: () => [...w.document.querySelectorAll('#items tr')].map((r) => r.children[1].querySelector('a').textContent) };
}

(async () => {
  let p = await apri('#coda-2000');
  const pan = p.d.getElementById('coda');
  ok('#coda-<id>: pannello visibile e portato in vista', !pan.hidden && pan.dataset.scrolled === '1');
  ok('prima i da verificare, poi i falliti', [...p.d.querySelectorAll('#queueList li')].map((l) => l.className).join() === 'q-verify,q-error,q-done');
  ok('contatori per stato', /1\s*Completato/.test(p.d.getElementById('queueCounters').textContent) && /1\s*Da verificare/.test(p.d.getElementById('queueCounters').textContent));
  [...p.d.querySelectorAll('#queueList button')].find((b) => b.textContent === 'Non è uscito').click(); await tick();
  ok('risoluzione con l’id della coda', JSON.stringify(p.messaggi.at(-1)) === JSON.stringify({ type: 'vr:queueResolve', itemId: '12', pubblicato: false, queue: 2000 }));
  [...p.d.querySelectorAll('#queueActions button')].find((b) => /Riprova i falliti \(1\)/.test(b.textContent)).click(); await tick();
  ok('riprova i falliti di questa coda', p.messaggi.at(-1).type === 'vr:queueRetry' && p.messaggi.at(-1).queue === 2000);
  ok('conferma dell’avvio', /Coda avviata/.test(p.d.getElementById('queueActions').textContent));
  [...p.d.querySelectorAll('#queueFilters button')].find((b) => /^Fallito/.test(b.textContent)).click();
  ok('filtro per stato', p.d.querySelectorAll('#queueList li').length === 1);
  const pick = p.d.getElementById('queuePick');
  ok('scelta tra coda attuale e archiviata', pick.options.length === 2 && !pick.hidden);
  pick.value = '1000'; pick.dispatchEvent(new p.w.Event('change'));
  ok('coda archiviata mostrata', p.d.querySelectorAll('#queueList li').length === 1 && /Vecchio/.test(p.d.getElementById('queueList').textContent) && p.w.location.hash === '#coda-1000');

  // aggiornamento live: il SW risolve → solo il pannello si ridisegna
  const q = p.dati.vrQueue; q.items[1].status = 'done';
  await p.w.chrome.storage.local.set({ vrQueue: q }); await tick();
  pick.value = '2000'; pick.dispatchEvent(new p.w.Event('change'));
  ok('modifiche della coda arrivano senza ricaricare', !p.d.querySelector('#queueList .q-verify'));

  p = await apri('#coda-999');
  ok('coda non più in archivio: lo dice', /non è più in archivio/.test(p.d.getElementById('queueNote').textContent));

  p = await apri('', { ...store(), vrQueue: null, vrQueueArchive: [{ startedAt: 1, items: [{ id: '1', status: 'done' }] }] });
  ok('senza problemi e senza #coda il pannello resta chiuso', p.d.getElementById('coda').hidden);
  p.w.location.hash = '#coda'; p.w.dispatchEvent(new p.w.HashChangeEvent('hashchange')); await tick();
  ok('hashchange apre il pannello', !p.d.getElementById('coda').hidden);

  // ------------------------------------------------------------- articoli
  p = await apri();
  ok('ordine predefinito: relist più vecchi prima', p.righe().join('|') === 'Perché leggere i classici|Libro di cucina|Giacca in denim');
  const sort = p.d.getElementById('sort');
  sort.value = 'price-desc'; sort.dispatchEvent(new p.w.Event('change'));
  ok('ordina per prezzo', p.righe()[0] === 'Giacca in denim');
  sort.value = 'quality'; sort.dispatchEvent(new p.w.Event('change'));
  ok('qualità più bassa prima, senza punteggio in fondo', p.righe().join('|') === 'Giacca in denim|Libro di cucina|Perché leggere i classici');
  const s = p.d.getElementById('search');
  s.value = 'perche'; s.dispatchEvent(new p.w.Event('input')); await tick(150);
  ok('ricerca senza accenti', p.righe().join() === 'Perché leggere i classici');
  ok('conteggio dei risultati', /1 di 3 articoli/.test(p.d.getElementById('itemsHint').textContent));
  s.value = 'zzz'; s.dispatchEvent(new p.w.Event('input')); await tick(150);
  ok('nessun risultato: lo dice', /Nessun articolo contiene «zzz»/.test(p.d.getElementById('itemsHint').textContent));
  s.value = ''; s.dispatchEvent(new p.w.Event('input')); await tick(150);
  const imgs = [...p.d.querySelectorAll('#items img')];
  ok('miniature lazy solo dal CDN di Vinted', imgs.length === 1 && imgs[0].getAttribute('loading') === 'lazy' && imgs[0].src === 'https://images1.vinted.net/a.webp');
  imgs[0].dispatchEvent(new p.w.Event('error'));
  ok('foto non più disponibile: riquadro vuoto', !p.d.querySelector('#items img') && p.d.querySelectorAll('#items .ph').length === 3);

  const conf = p.d.querySelector('.compare-box');
  ok('confronto prima/dopo con il numero di modifiche', /2 modifiche/.test(conf.querySelector('summary').textContent));
  ok('campo invariato segnato', /invariato/.test(conf.textContent) && conf.querySelectorAll('tr.changed').length === 2);

  p.d.getElementById('checkUpdate').click();
  ok('cerca aggiornamento → popup sulla salute', p.schede.at(-1) === 'chrome-extension://abc/src/popup.html#salute');
  ok('Ko-fi nel piede', p.d.querySelector('.foot a').href === 'https://ko-fi.com/mashaup');
  ok('versione nel piede', p.d.getElementById('version').textContent === '2.0.0');
  ok('nessun errore JavaScript', !p.errori.length);
  console.log(`\n${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
