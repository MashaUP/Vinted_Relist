// Finestra "Opzioni della coda" e avvio con controllo preventivo, in un DOM simulato.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = require('path').join(__dirname, '..', '..', 'src') + '/';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const doc = window.document;
const store = { inventory: { 11: { price: 10, title: 'Libro di cucina' } } };
const messaggi = [];
const errori = [];
window.addEventListener('error', (e) => errori.push(e.message));
window.chrome = {
  storage: { local: {
    get: async (k) => { if (typeof k === 'string') return { [k]: store[k] };
      if (Array.isArray(k)) { const o = {}; for (const x of k) o[x] = store[x]; return o; }
      if (k && typeof k === 'object') { const o = {}; for (const [a, b] of Object.entries(k)) o[a] = a in store ? store[a] : b; return o; }
      return { ...store }; },
    set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))), remove: async (k) => { delete store[k]; } },
    onChanged: { addListener() {} } },
  runtime: { sendMessage: async (m) => { messaggi.push(m); return m.type === 'vr:queueStart' ? { ok: true } : {}; }, onMessage: { addListener() {} } },
};
for (const f of ['utils.js', 'api.js', 'editor-logica.js', 'relist.js', 'editor.js', 'queue.js', 'ui.js']) {
  window.eval(fs.readFileSync(SRC + f, 'utf8'));
}
const VR = window.VR;
VR.settings = { ...VR.DEFAULTS, colorMap: { 1: 'Nero' }, canary: true };
VR.sleep = async () => {};
const letti = [];
VR.canary = async (id) => { letti.push(id); return { ok: true, problemi: [], avvisi: ['Nessun colore'] }; };

let pass = 0, fail = 0;
const ok = (n, c) => { console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}`); c ? pass++ : fail++; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const btn = (testo, radice = doc) => [...radice.querySelectorAll('button')].find((b) => b.textContent.trim() === testo);
const dialogo = () => doc.querySelector('.vr-options');
const campi = () => {
  const d = dialogo();
  const [modo, colore] = d.querySelectorAll('select');
  return { modo, colore, valore: d.querySelector('input[inputmode=decimal]'), aggiunta: d.querySelector('textarea'),
    quando: d.querySelector('input[type=datetime-local]'), intervallo: d.querySelector('input[type=number]') };
};
const scrivi = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input')); };

(async () => {
  await tick();
  // un articolo selezionato
  const casella = doc.createElement('input'); casella.type = 'checkbox'; casella.className = 'vr-bar__pick'; casella.dataset.vrId = '11';
  doc.body.append(casella);
  VR.selection.registra('11', casella);
  VR.selection.cambia('11', true);
  ok('pannello di selezione visibile', /1 articolo selezionato/.test(doc.querySelector('.vr-queue__title').textContent));

  VR.toast('Ripubblicato', 'info');
  ok('toast presente prima delle opzioni', doc.querySelector('.vr-toast'));
  btn('Opzioni').click(); await tick();
  ok('le opzioni chiudono subito i toast (uscita animata)', doc.querySelector('.vr-toast').classList.contains('vr-toast--out'));
  await tick(250);
  ok('...e poi li tolgono dalla pagina', !doc.querySelector('.vr-toast'));
  ok('finestra con quattro sezioni', [...dialogo().querySelectorAll('legend')].map((l) => l.textContent).join('|') === 'Prezzo|Testo e descrizione|Dati mancanti|Pianificazione');
  ok('stato iniziale: salvate', /^Salvate$/.test(dialogo().querySelector('.vr-editor__badge').textContent));
  ok('dialogo accessibile', dialogo().getAttribute('role') === 'dialog' && dialogo().getAttribute('aria-labelledby') === 'vr-opt-title');

  let c = campi();
  c.modo.value = 'percent'; c.modo.dispatchEvent(new window.Event('change'));
  scrivi(c.valore, '-10');
  ok('anteprima del prezzo sull’articolo selezionato', /10,00\s€ → 9,00\s€/.test(dialogo().querySelector('.vr-preview-price').textContent));
  ok('unità percentuale', dialogo().querySelector('.vr-unit').textContent === '%');
  ok('modifiche non salvate segnalate', /non salvate/.test(dialogo().querySelector('.vr-editor__badge').textContent));

  scrivi(c.valore, '0');
  const errValore = dialogo().querySelector('#vr-err-valore');
  ok('valore zero: errore in linea', !errValore.hidden && errValore.textContent.length > 0);
  ok('campo segnato non valido', dialogo().querySelector('.vr-input-unit').classList.contains('is-invalid'));
  ok('salva e avvia spenti con un errore', btn('Salva', dialogo()).disabled && btn('Salva e avvia', dialogo()).disabled);
  scrivi(c.valore, '-10');
  ok('errore sparisce corretto il valore', errValore.hidden && !btn('Salva', dialogo()).disabled);

  scrivi(c.intervallo, '0');
  ok('intervallo 0 rifiutato', !dialogo().querySelector('#vr-err-intervallo').hidden);
  ok('anteprima del prezzo giusta anche con un errore in un altro campo', /10,00\s€ → 9,00\s€/.test(dialogo().querySelector('.vr-preview-price').textContent));
  scrivi(c.intervallo, '15');
  const ieri = new Date(Date.now() - 86400000);
  const locale = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  scrivi(c.quando, locale(ieri));
  ok('orario nel passato rifiutato', !dialogo().querySelector('#vr-err-quando').hidden);
  scrivi(c.quando, '');
  scrivi(c.aggiunta, 'Spedizione rapida.');
  c.colore.value = 'auto'; c.colore.dispatchEvent(new window.Event('change'));

  btn('Salva', dialogo()).click(); await tick(); await tick();
  ok('salva chiude la finestra', !dialogo());
  ok('bozza salvata', store.queueDraft?.modo === 'percent' && store.queueDraft.valore === '-10' && store.queueDraft.colore === 'auto');
  ok('l’orario non viene salvato', !('quando' in store.queueDraft));
  ok('intervallo salvato nelle impostazioni', store.queueIntervalMin === 15);
  ok('riassunto nel pannello', /-10% sul prezzo/.test(doc.querySelector('.vr-queue__sub').textContent) && /ogni 15 min/.test(doc.querySelector('.vr-queue__sub').textContent));

  // riapertura: valori ripresi, poi annulla senza salvare
  btn('Opzioni').click(); await tick();
  c = campi();
  ok('riaperta con i valori salvati', c.modo.value === 'percent' && c.valore.value === '-10' && c.intervallo.value === '15' && c.colore.value === 'auto');
  ok('riaperta: salvate', /^Salvate$/.test(dialogo().querySelector('.vr-editor__badge').textContent));
  btn('Ripristina predefiniti', dialogo()).click();
  ok('ripristina svuota i campi', c.modo.value === '' && c.aggiunta.value === '' && c.intervallo.value === '20');
  btn('Annulla', dialogo()).click(); await tick();
  ok('annulla non tocca la bozza', store.queueDraft.modo === 'percent');

  // la X chiude senza salvare
  btn('Opzioni').click(); await tick();
  scrivi(campi().aggiunta, 'non salvare');
  dialogo().querySelector('.vr-close').click(); await tick();
  ok('la X chiude senza salvare', !dialogo() && store.queueDraft.aggiunta === 'Spedizione rapida.');

  // Esc chiude
  btn('Opzioni').click(); await tick();
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  ok('Esc chiude la finestra', !dialogo());

  // avvio: controllo preventivo → riepilogo → coda
  btn('Avvia').click();
  for (let k = 0; k < 20 && !doc.querySelector('.vr-summary'); k++) await tick();
  ok('controllo preventivo letto senza pubblicare', letti.join() === '11');
  ok('riepilogo: 1 con avvisi', /1\s*con avvisi/.test(doc.querySelector('.vr-summary').textContent));
  ok('niente avviato prima della conferma', !messaggi.some((m) => m.type === 'vr:queueStart'));
  btn('Avvia').click();   // quello del riepilogo (il pannello mostra il controllo)
  for (let k = 0; k < 20 && !messaggi.some((m) => m.type === 'vr:queueStart'); k++) await tick();
  const avvio = messaggi.find((m) => m.type === 'vr:queueStart');
  ok('coda avviata con le opzioni salvate', avvio && avvio.overrides.pricePercent === -10 && avvio.overrides.autoFill === true && avvio.intervalMin === 15);
  ok('aggiunta alla descrizione passata', avvio?.overrides.descriptionAppend === 'Spedizione rapida.');
  await tick();
  ok('selezione svuotata dopo l’avvio', !doc.querySelector('.vr-queue'));

  // annullare il riepilogo non lascia il bottone Avvia spento
  VR.selection.cambia('11', true);
  btn('Avvia').click();
  for (let k = 0; k < 20 && !doc.querySelector('.vr-summary'); k++) await tick();
  btn('Annulla', doc.querySelector('.vr-summary').closest('.vr-card')).click();
  for (let k = 0; k < 10; k++) await tick();
  ok('riepilogo annullato: nessuna seconda coda', messaggi.filter((m) => m.type === 'vr:queueStart').length === 1);
  ok('riepilogo annullato: Avvia di nuovo usabile', btn('Avvia') && !btn('Avvia').disabled);

  ok('nessun errore JavaScript', !errori.length);
  console.log(`\n${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
