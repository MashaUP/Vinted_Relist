// Dashboard 2.1: menu di gestione della coda + inventario, storico, piede.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = require('path').join(__dirname, '..', '..', 'src/');
let pass = 0, fail = 0;
const ok = (n, c) => { console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}`); c ? pass++ : fail++; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const ORA = Date.now();

const art = (id, status, extra = {}) => ({ id: String(id), title: `Articolo ${id}`, status, price: 10 + Number(id), thumb: null, addedAt: ORA - 3600e3, ...extra });
function codaInCorso(extra = {}) {
  return {
    v: 3, running: true, state: 'waiting', startedAt: ORA - 3600e3, nextAt: ORA + 600e3, intervalMin: 20, overrides: { pricePercent: -10 },
    items: [
      art(1, 'done', { startedAt: ORA - 3000e3, finishedAt: ORA - 2950e3 }),
      art(2, 'error', { error: 'prezzo rifiutato', categoria: 'dati', sicuro: 'dopo-correzione', startedAt: ORA - 2000e3, finishedAt: ORA - 1950e3 }),
      art(3, 'verify', { error: 'timeout', categoria: 'incerto', sicuro: 'no' }),
      art(4, 'pending', { title: 'Zaino rosso' }), art(5, 'pending', { title: 'Borsa blu' }), art(6, 'pending', { title: 'Astuccio' }),
    ],
    log: [
      { at: ORA - 3600e3, tipo: 'creata', natura: 'locale', testo: 'Coda creata con 6 articoli.' },
      { at: ORA - 2950e3, tipo: 'completato', natura: 'vinted', testo: 'Ripubblicato: Articolo 1', id: '1', esito: 'done' },
      { at: ORA - 1950e3, tipo: 'fallito', natura: 'vinted', testo: 'Non riuscito: Articolo 2', id: '2', azione: 'correggi con Modifica, poi riprova' },
    ],
    ...extra,
  };
}

async function apri({ hash = '', store = {}, risposte = {}, sessione = {}, linkRemoto = null, statoLink = 404 } = {}) {
  const sorgente = fs.readFileSync(SRC + 'dashboard.html', 'utf8');
  // Gli script nell'ordine dell'HTML: un file aggiunto alla pagina entra anche nel test.
  const script = [...sorgente.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const html = sorgente.replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: `chrome-extension://abc/src/dashboard.html${hash}`, pretendToBeVisual: true });
  const w = dom.window;
  const dati = { vintedOrigin: 'https://www.vinted.it', inventory: {}, qualityScores: {}, vrSnapshots: [], vrQueueArchive: [], ...store };
  const messaggi = [], schede = [], errori = [], scaricati = [], cambi = [];
  let appunti = '';
  w.addEventListener('error', (e) => errori.push(e.message));
  w.HTMLElement.prototype.scrollIntoView = function () { this.dataset.scrolled = '1'; };
  const notifica = (ch, area) => cambi.forEach((f) => f(ch, area));
  w.chrome = {
    storage: {
      local: {
        get: async (k) => {
          if (typeof k === 'string') return { [k]: JSON.parse(JSON.stringify(dati[k] ?? null)) ?? undefined };
          if (Array.isArray(k)) { const o = {}; for (const x of k) o[x] = dati[x]; return JSON.parse(JSON.stringify(o)); }
          const o = {}; for (const [a, b] of Object.entries(k)) o[a] = a in dati ? dati[a] : b; return JSON.parse(JSON.stringify(o));
        },
        set: async (o) => { const ch = {}; for (const [k, v] of Object.entries(o)) { ch[k] = { newValue: v }; dati[k] = v; } notifica(ch, 'local'); },
      },
      session: { get: async (k) => ({ [k]: sessione[k] }) },
      onChanged: { addListener: (f) => cambi.push(f) },
    },
    runtime: { getManifest: () => ({ version: '2.1.0' }), getURL: (p) => `chrome-extension://abc/${p}`,
      sendMessage: async (m) => { messaggi.push(m); const r = risposte[m.type]; return typeof r === 'function' ? r(m) : r ?? { ok: true }; } },
    tabs: { create: (o) => schede.push(o.url), query: async () => [] },
    downloads: { download: async (o) => { scaricati.push(o); return 1; } },
  };
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { appunti = t; } } });
  w.confirm = () => true; w.alert = () => {};
  w.open = (u) => schede.push(u);
  const richiesteLink = [];
  w.fetch = async (url) => {
    if (url === 'chrome-extension://abc/links.json') return { ok: true, status: 200, text: async () => fs.readFileSync(SRC + '../links.json', 'utf8') };
    if (/\/contents\/links\.json$/.test(url)) {
      richiesteLink.push(url);
      return { ok: statoLink === 200, status: statoLink, text: async () => JSON.stringify(linkRemoto) };
    }
    throw new TypeError('rete non prevista nel test: ' + url);
  };
  // Come nel browser: script classici con le dichiarazioni globali condivise (un solo eval).
  w.eval(script.map((f) => fs.readFileSync(SRC + f, 'utf8')).join('\n;\n'));
  await tick(40);
  const d = w.document;
  const righe = () => [...d.querySelectorAll('#queueList li.q-row')];
  return {
    w, d, dati, messaggi, schede, errori, scaricati, notifica, appunti: () => appunti, righe, richiesteLink,
    riga: (id) => d.querySelector(`#queueList li[data-id="${id}"]`),
    btn: (testo, radice = d) => [...radice.querySelectorAll('button')].find((b) => b.textContent.trim() === testo || b.getAttribute('aria-label') === testo),
    ultimo: (tipo) => [...messaggi].reverse().find((m) => m.type === tipo),
    aggiorna: async (coda) => { dati.vrQueue = coda; notifica({ vrQueue: { newValue: coda } }, 'local'); await tick(); },
    tasto: (key, extra = {}) => d.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, ...extra })),
  };
}

(async () => {
  // ------------------------------------------------------------ 1. vuota
  let p = await apri();
  ok('1. coda vuota: stato vuoto con le istruzioni', !p.d.getElementById('queueEmpty').hidden && /Aggiungi alla coda/.test(p.d.getElementById('queueEmpty').textContent) && p.d.getElementById('queueList').hidden);

  // ------------------------------------------------ 2-3. in corso, contenuti
  p = await apri({ store: { vrQueue: codaInCorso() } });
  ok('2. elenco: tutti gli articoli della sessione', p.righe().length === 6);
  ok('   ordine vero: prima gli in attesa, con la posizione', p.righe().slice(0, 3).map((li) => li.dataset.id).join() === '4,5,6' && /#1/.test(p.riga(4).textContent));
  ok('   miniatura, titolo, prezzo, id, stato con etichetta e icona', /ID 4/.test(p.riga(4).textContent) && /14,00/.test(p.riga(4).textContent) && /◷ In attesa/.test(p.riga(4).textContent));
  ok('   errore con categoria e se riprovare', /prezzo rifiutato/.test(p.riga(2).textContent) && /Dati mancanti o rifiutati/.test(p.riga(2).textContent) && /dopo aver corretto/.test(p.riga(2).textContent));
  ok('   salute: risultati da verificare, con il perché', /Risultati da verificare/.test(p.d.getElementById('queueHealth').textContent) && /1 esito incerto/.test(p.d.getElementById('queueHealthText').textContent));
  ok('   riepilogo: totale, in attesa, completati, falliti, da verificare', /6\s*nella sessione/.test(p.d.getElementById('queueSummary').textContent) && /3\s*in attesa/.test(p.d.getElementById('queueSummary').textContent));
  ok('   stima con avvertenza', /rimanente/.test(p.d.getElementById('queueSummary').textContent) && /Stima/.test(p.d.getElementById('queueEta').textContent));
  ok('   solo azioni compatibili: verificare sul da verificare, niente riprova', p.btn('È stato pubblicato', p.riga(3)) && !p.btn('Riprova', p.riga(3)));
  ok('   un completato non ha link all\'annuncio vecchio (non esiste più)', !p.riga(1).querySelector('a.q-title'));

  // in elaborazione: articolo corrente e annullamento
  let c = codaInCorso({ state: 'working' }); c.items[3] = art(4, 'working', { title: 'Zaino rosso', startedAt: ORA - 20e3 });
  p = await apri({ store: { vrQueue: c }, sessione: { vrQueueStep: { itemId: '4', step: 'Foto 2/5…', fase: 'preparazione' } } });
  ok('3. in esecuzione: articolo corrente evidenziato con il passo', !p.d.getElementById('queueCurrent').hidden && /Zaino rosso/.test(p.d.getElementById('queueCurrent').textContent) && /si può ancora annullare/.test(p.d.getElementById('queueCurrent').textContent));
  ok('   nessun «null» scritto nel pannello (riepilogo, barra di selezione)', !/\bnull\b/.test(p.d.getElementById('coda').textContent));
  ok('   il corrente non ha «Rimuovi»: ha «Annulla operazione»', !p.btn('Rimuovi', p.riga(4)) && p.btn('Annulla operazione', p.riga(4)));
  p.btn('Annulla operazione', p.riga(4)).click(); await tick();
  ok('   annulla operazione inviata', p.ultimo('vr:queueCancelCurrent'));
  p.notifica({ vrQueueStep: { newValue: { itemId: '4', step: 'Pubblico…', fase: 'invio' } } }, 'session'); await tick();
  ok('   dopo l\'invio a Vinted: annulla disattivato con il motivo', p.btn('Annulla operazione', p.riga(4)).disabled && /già partita/.test(p.btn('Annulla operazione', p.riga(4)).title));
  ok('   controlli coerenti: pausa dopo l\'articolo, interrompi', p.btn('Pausa dopo questo articolo') && p.btn('Interrompi la sessione'));

  // --------------------------------------------- 6-9. azioni per riga e multiple
  p = await apri({ store: { vrQueue: codaInCorso() }, risposte: { 'vr:queueRemove': (m) => ({ ok: true, rimossi: m.ids, rifiutati: [] }), 'vr:queueMove': (m) => ({ ok: true, spostati: m.ids, rifiutati: [], cambiato: true }) } });
  p.btn('Rimuovi', p.riga(5)).click(); await tick();
  ok('6. rimuovi dal menu', JSON.stringify(p.ultimo('vr:queueRemove').ids) === '["5"]' && /rimosso dalla coda/.test(p.d.getElementById('queueMsg').textContent));
  ok('   «Rimuovi» spiega che su Vinted non cambia niente', /niente viene cancellato su Vinted/.test(p.btn('Rimuovi', p.riga(5)).title));
  p.btn('Sposta giù', p.riga(4)).click(); await tick();
  ok('7. riordino con i pulsanti', p.ultimo('vr:queueMove').dove === 'giu' && p.ultimo('vr:queueMove').ids[0] === '4');
  ok('   il primo non può salire', p.btn('Sposta su', p.riga(4)).disabled && p.btn('Sposta in cima', p.riga(4)).disabled);
  p.riga(5).dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true })); await tick();
  ok('   alternativa da tastiera (Alt+↓)', p.ultimo('vr:queueMove').dove === 'giu' && p.ultimo('vr:queueMove').ids[0] === '5');
  // trascinamento: 6 sopra il 4
  const dt = { setData() {}, effectAllowed: '' };
  const ev = (tipo, x = {}) => { const e = new p.w.Event(tipo, { bubbles: true, cancelable: true }); e.dataTransfer = dt; Object.assign(e, x); return e; };
  p.riga(6).dispatchEvent(ev('dragstart'));
  p.riga(4).dispatchEvent(ev('dragover', { clientY: -100 }));
  p.riga(4).dispatchEvent(ev('drop')); await tick();
  ok('   trascinamento: nuovo ordine completo al service worker', JSON.stringify(p.ultimo('vr:queueReorder')?.ordine) === '["6","4","5"]');

  // selezione multipla
  p.riga(4).querySelector('input[type=checkbox]').click();
  p.riga(5).querySelector('input[type=checkbox]').click(); await tick();
  ok('8. selezione multipla con il conteggio', /2 selezionati/.test(p.d.getElementById('queueSelBar').textContent));
  ok('   il completato e il da verificare non si selezionano', p.riga(1).querySelector('input').disabled && p.riga(3).querySelector('input').disabled);
  ok('   azioni non applicabili spente (riprova senza falliti scelti)', p.btn('Riprova', p.d.getElementById('queueSelBar')).disabled && !p.btn('Sposta in cima', p.d.getElementById('queueSelBar')).disabled);
  p.btn('Sposta in cima', p.d.getElementById('queueSelBar')).click(); await tick();
  ok('9. azione collettiva: sposta in cima', JSON.stringify(p.ultimo('vr:queueMove').ids) === '["4","5"]' && p.ultimo('vr:queueMove').dove === 'cima');
  ok('   dopo lo spostamento la selezione resta, e si vede', /2 selezionati/.test(p.d.getElementById('queueSelBar').textContent) && p.riga(4).querySelector('input').checked);
  p.riga(4).querySelector('input[type=checkbox]').click();
  p.riga(6).querySelector('input[type=checkbox]').click(); await tick();
  p.btn('Rimuovi dalla coda', p.d.getElementById('queueSelBar')).click(); await tick();
  ok('   rimozione multipla: chiede conferma in linea', !p.d.getElementById('queueConfirm').hidden && /Restano su Vinted/.test(p.d.getElementById('queueConfirm').textContent));
  p.btn('Rimuovi', p.d.getElementById('queueConfirm')).click(); await tick();
  ok('   confermata: inviata con gli id giusti', JSON.stringify(p.ultimo('vr:queueRemove').ids.sort()) === '["5","6"]');
  p.riga(2).querySelector('input[type=checkbox]').click(); await tick();
  p.btn('Riprova', p.d.getElementById('queueSelBar')).click(); await tick();
  ok('   riprova i falliti selezionati', JSON.stringify(p.ultimo('vr:queueRetry').ids) === '["2"]');
  p.btn('Deseleziona tutti')?.click(); await tick();
  ok('   deseleziona tutti', /Nessuno selezionato/.test(p.d.getElementById('queueSelBar').textContent));
  p.btn('Seleziona tutti in attesa').click(); await tick();
  ok('   seleziona tutti gli in attesa', /3 selezionati/.test(p.d.getElementById('queueSelBar').textContent));

  // ----------------------------------------------------- 10. ricerca e filtri
  p = await apri({ store: { vrQueue: codaInCorso() } });
  const cerca = p.d.getElementById('queueSearch');
  cerca.value = 'zaino'; cerca.dispatchEvent(new p.w.Event('input')); await tick(150);
  ok('10. ricerca per titolo', p.righe().length === 1 && p.righe()[0].dataset.id === '4');
  ok('    con la ricerca il riordino si spegne, e lo dice', p.btn('Sposta giù', p.riga(4)).disabled && !p.d.getElementById('queueSortNote').hidden);
  cerca.value = ''; cerca.dispatchEvent(new p.w.Event('input')); await tick(150);
  [...p.d.querySelectorAll('#queueFilters button')].find((b) => /^Problemi/.test(b.textContent)).click(); await tick();
  ok('    filtro problemi', p.righe().map((li) => li.dataset.id).sort().join() === '2,3');
  [...p.d.querySelectorAll('#queueFilters button')].find((b) => /^Tutti/.test(b.textContent)).click(); await tick();
  const sort = p.d.getElementById('queueSort');
  sort.value = 'titolo'; sort.dispatchEvent(new p.w.Event('change')); await tick();
  ok('    ordinamento per titolo: solo visivo', p.righe()[0].textContent.includes('Articolo 1') && !p.messaggi.some((m) => m.type === 'vr:queueReorder') && /solo visivo/.test(p.d.getElementById('queueSortNote').textContent));
  sort.value = 'posizione'; sort.dispatchEvent(new p.w.Event('change')); await tick();

  // ------------------------------------------------ 11. aggiornamento live
  p.riga(5).querySelector('input[type=checkbox]').click(); await tick();
  const rigaInvariata = p.riga(6);
  const nuova = codaInCorso();
  nuova.items[3].status = 'working'; nuova.items[3].startedAt = ORA; nuova.state = 'working';
  nuova.items.push(art(7, 'pending', { aggiuntoDopo: true, title: 'Nuovo arrivato' }));
  await p.aggiorna(nuova);
  ok('11. la lista si aggiorna senza riaprire: nuovo in fondo, corrente cambiato', p.riga(7) && /aggiunto durante la sessione/.test(p.riga(7).textContent) && /In elaborazione/.test(p.riga(4).textContent));
  ok('    selezione mantenuta', p.riga(5).querySelector('input').checked && /1 selezionati/.test(p.d.getElementById('queueSelBar').textContent));
  ok('    le righe che non cambiano non vengono ricreate (niente sfarfallio)', p.riga(1) && p.riga(1) === p.d.querySelector('#queueList li[data-id="1"]'));
  ok('    posizioni ricalcolate', /#1/.test(p.riga(5).textContent) && p.riga(6) !== rigaInvariata);
  const rimossa = codaInCorso(); rimossa.items[5].status = 'removed';
  await p.aggiorna(rimossa);
  ok('    rimosso altrove: compare come «Rimosso», non più tra gli in attesa', /Rimosso/.test(p.riga(6).textContent) && !p.btn('Rimuovi', p.riga(6)));

  // ---------------------------------------------- 4-5. pausa, aggiunta dal menu
  p = await apri({
    store: { vrQueue: codaInCorso({ state: 'paused', pausedRemainingMs: 60000 }), inventory: { 4: { title: 'Zaino rosso', price: 14 }, 9: { title: 'Libro nuovo', price: 3 } } },
    risposte: { 'vr:queueAdd': (m) => ({ ok: true, aggiunti: m.items.map((i) => i.id), riattivati: [], rifiutati: [] }) },
  });
  ok('4. in pausa: Riprendi, e la coda resta modificabile', p.btn('Riprendi') && p.btn('Rimuovi', p.riga(4)) && !p.btn('Sposta giù', p.riga(4)).disabled);
  const spunte = [...p.d.querySelectorAll('#items input[type=checkbox]')];
  spunte.forEach((x) => x.click()); await tick();
  ok('5. aggiunta dal menu: bottone con il conteggio', /Aggiungi alla coda \(2\)/.test(p.d.getElementById('addToQueue').textContent));
  p.d.getElementById('addToQueue').click(); await tick(20);
  const box = p.d.getElementById('addConfirm');
  ok('   conferma: chi entra, chi no e perché', !box.hidden && /Libro nuovo/.test(box.textContent) && /Zaino rosso/.test(box.querySelector('.fuori').textContent) && /posizione 1/.test(box.textContent));
  ok('   usa le opzioni della coda in corso', /-10% sul prezzo/.test(box.textContent));
  box.querySelector('input[value="cima"]').click();
  p.btn('Aggiungi 1 alla coda', box).click(); await tick(20);
  ok('   aggiunta inviata: solo il nuovo, in cima', JSON.stringify(p.ultimo('vr:queueAdd').items.map((i) => i.id)) === '["9"]' && p.ultimo('vr:queueAdd').dove === 'cima');
  ok('   selezione dell\'inventario svuotata', /^Aggiungi alla coda$/.test(p.d.getElementById('addToQueue').textContent.trim()));

  // senza coda: dal menu parte una coda nuova con le opzioni salvate
  p = await apri({ store: { inventory: { 9: { title: 'Libro nuovo', price: 3 } }, queueDraft: { modo: 'percent', valore: '-20', intervallo: '15' } } });
  p.d.querySelector('#items input[type=checkbox]').click(); await tick();
  p.d.getElementById('addToQueue').click(); await tick(20);
  ok('   senza coda: «Avvia una coda» con le opzioni salvate', /Avvia una coda con 1/.test(p.d.getElementById('addConfirm').textContent) && /-20% sul prezzo · ogni 15 min/.test(p.d.getElementById('addConfirm').textContent));
  p.btn('Avvia una coda con 1', p.d.getElementById('addConfirm')).click(); await tick(20);
  ok('   avviata con intervallo e opzioni', p.ultimo('vr:queueStart')?.intervalMin === 15 && p.ultimo('vr:queueStart').overrides.pricePercent === -20);

  // ------------------------------------------- interrompi, conferma solo se serve
  p = await apri({ store: { vrQueue: codaInCorso() } });
  p.btn('Interrompi la sessione').click(); await tick();
  ok('interrompi con articoli in attesa: conferma che spiega cosa succede', /3 articoli in attesa verranno annullati/.test(p.d.getElementById('queueConfirm').textContent) && !p.ultimo('vr:queueStop'));
  p.btn('Interrompi', p.d.getElementById('queueConfirm')).click(); await tick();
  ok('   confermato: inviato', p.ultimo('vr:queueStop'));
  p.btn('Pausa a tempo').click(); await tick();
  ok('pausa a tempo con la durata scelta', p.ultimo('vr:queuePause')?.minuti === 15);

  // ------------------------------------------------ cronologia ed esportazione
  p.d.getElementById('queueTimeline').open = true;
  ok('cronologia: eventi dal più recente', p.d.querySelectorAll('#queueLog li').length === 3 && /Non riuscito/.test(p.d.querySelector('#queueLog li').textContent));
  ok('   con l\'azione consigliata', /correggi con Modifica/.test(p.d.getElementById('queueLog').textContent));
  [...p.d.querySelectorAll('#logFilters button')].find((b) => b.textContent === 'Modifiche alla coda').click(); await tick();
  ok('   filtro: modifiche locali distinte dagli esiti di Vinted', p.d.querySelectorAll('#queueLog li').length === 1 && /Coda creata/.test(p.d.getElementById('queueLog').textContent));
  [...p.d.querySelectorAll('#logFilters button')].find((b) => b.textContent === 'Tutto').click(); await tick();
  p.btn('vai all\'articolo', p.d.getElementById('queueLog')).click(); await tick();
  ok('   «vai all\'articolo» porta alla riga', p.riga(2).dataset.scrolled === '1');
  p.btn('Esporta CSV').click(); await tick();
  const csv = p.scaricati.at(-1);
  ok('esporta CSV: nome con la data, BOM, intestazione', /^Vinted Relist\/vinted-relist-sessione-\d{8}-\d{4}\.csv$/.test(csv.filename) && decodeURIComponent(csv.url.split(',')[1]).startsWith('﻿sessione,ordine,id'));
  p.btn('Esporta JSON').click(); await tick();
  ok('esporta JSON', JSON.parse(decodeURIComponent(p.scaricati.at(-1).url.split(',')[1])).formato === 'vinted-relist-sessione');
  p.btn('Copia resoconto').click(); await tick();
  ok('copia resoconto: senza titoli', /Problemi:/.test(p.appunti()) && !/Articolo \d/.test(p.appunti()));

  // ---------------------------------------------------------------- scorciatoie
  p.tasto('f'); await tick();
  ok('scorciatoia F: solo problemi', p.righe().length === 2);
  p.tasto('f'); await tick();
  p.tasto('p'); await tick();
  ok('scorciatoia P: pausa', p.ultimo('vr:queuePause') && !p.ultimo('vr:queuePause').minuti);
  p.tasto('?'); await tick();
  ok('scorciatoia ?: elenco delle scorciatoie', p.d.getElementById('queueKeys').open);
  cerca.value = '';
  p.d.getElementById('queueSearch').dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'p', bubbles: true }));
  ok('le scorciatoie non scattano mentre scrivi', p.messaggi.filter((m) => m.type === 'vr:queuePause').length === 2);

  // --------------------------------------------- 12. sessioni passate, errori
  const archiviata = { v: 3, startedAt: 1000, finishedAt: 2000, intervalMin: 20, items: [art(20, 'done'), art(21, 'error', { sicuro: 'si', error: 'x' }), art(22, 'cancelled'), art(23, 'verify')], log: [] };
  p = await apri({ hash: '#coda-1000', store: { vrQueueArchive: [archiviata] }, risposte: { 'vr:queueRestore': { ok: true, aggiunti: ['21', '22'], esclusi: [{ id: '20', motivo: 'già ripubblicato' }, { id: '23', motivo: 'esito da verificare' }] } } });
  ok('12. #coda-<id>: sessione archiviata, portata in vista', /Sessione del/.test(p.d.getElementById('queueTitle').textContent) && p.d.getElementById('coda').dataset.scrolled === '1');
  ok('    sessione conclusa: niente riordino né rimozione', !p.btn('Rimuovi', p.riga(21)) && !p.d.querySelector('[data-azione="su"]'));
  p.btn('Riprendi gli articoli non elaborati (2)').click(); await tick();
  ok('    riprendi la sessione: dice cosa resta fuori', p.ultimo('vr:queueRestore').queue === 1000 && /già ripubblicato, esito da verificare/.test(p.d.getElementById('queueMsg').textContent));
  ok('    riprova i falliti di una sessione conclusa', p.btn('Riprova i falliti (1)'));
  p = await apri({ hash: '#coda-999', store: { vrQueueArchive: [archiviata] } });
  ok('    sessione non più in archivio: lo dice', /non è più in archivio/.test(p.d.getElementById('queueHealthText').textContent));

  // --------------------------------------------------- inventario e storico (2.0)
  const inv = {
    11: { title: 'Libro di cucina', price: 8, views: 30, favs: 2, relistedAt: ORA - 9 * 86400000, thumb: 'https://images1.vinted.net/a.webp' },
    12: { title: 'Giacca in denim', price: 25, views: 100, favs: 9, relistedAt: ORA - 2 * 86400000, thumb: 'https://evil.example/x.png' },
    13: { title: 'Perché leggere i classici', price: 5, views: 4, favs: 0 },
  };
  p = await apri({ store: { inventory: inv, qualityScores: { 11: { score: 80 }, 12: { score: 55 } },
    vrSnapshots: [{ n: 1, at: ORA - 86400000, old: { id: '9', title: 'Giacca jeans', description: 'Bella', price: 30 }, new: { id: '12', title: 'Giacca in denim', description: 'Bella', price: 25 } }] } });
  const nomi = () => [...p.d.querySelectorAll('#items tr')].map((r) => r.querySelector('a').textContent);
  ok('inventario: ordine predefinito invariato', nomi().join('|') === 'Perché leggere i classici|Libro di cucina|Giacca in denim');
  const s = p.d.getElementById('search');
  s.value = 'perche'; s.dispatchEvent(new p.w.Event('input')); await tick(150);
  ok('inventario: ricerca senza accenti', nomi().join() === 'Perché leggere i classici');
  ok('miniature solo dal CDN', [...p.d.querySelectorAll('#items img')].every((i) => i.src.startsWith('https://images1.vinted.net')));
  ok('confronto prima/dopo nello storico', /2 modifiche/.test(p.d.querySelector('.compare-box summary').textContent));
  p.d.getElementById('checkUpdate').click();
  ok('piede: cerca aggiornamento, Ko-fi, versione', p.schede.at(-1) === 'chrome-extension://abc/src/popup.html#salute' && p.d.querySelector('.foot a').href === 'https://ko-fi.com/mashaup' && p.d.getElementById('version').textContent === '2.1.0');

  const piede = (id) => p.d.querySelector(`.foot [data-link="${id}"]`);
  ok('piede: GitHub, Discord e «Segnala un problema» da links.json', piede('github').href === 'https://github.com/MashaUP/Vinted_Relist' && piede('discord').href === 'https://discord.gg/EPsbQCuAkx' && /issues\/new/.test(piede('bug-report').href));
  ok('   con etichetta visibile e icona decorativa', piede('discord').textContent.trim() === 'Discord' && piede('discord').querySelector('svg').getAttribute('aria-hidden') === 'true');
  ok('   nessun URL scritto nell\'HTML della dashboard', !/https:\/\/(github\.com|discord|ko-fi)/.test(fs.readFileSync(SRC + 'dashboard.html', 'utf8')));
  ok('nessun errore JavaScript', !p.errori.length);
  p = await apri({ statoLink: 200, linkRemoto: { schemaVersion: 1, project: 'vinted-relist', revision: 3, links: { discord: { enabled: false } } } });
  ok('piede: Discord spento dal remoto → nascosto, il resto resta', p.d.querySelector('.foot [data-link="discord"]').hidden && !p.d.querySelector('.foot [data-link="github"]').hidden);
  console.log(`\n${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
