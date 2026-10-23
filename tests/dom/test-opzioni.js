// Finestra "Opzioni della coda" e avvio con controllo preventivo, in un DOM simulato.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = require('path').join(__dirname, '..', '..', 'src/');

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const doc = window.document;
const store = { inventory: { 11: { price: 10, title: 'Libro di cucina' } } };
const messaggi = [];
const ascoltatori = [];
const cambi = [];
let risposta = (m) => (m.type === 'vr:queueStart' ? { ok: true } : {});
const errori = [];
window.addEventListener('error', (e) => errori.push(e.message));
window.chrome = {
  storage: { local: {
    get: async (k) => { if (typeof k === 'string') return { [k]: store[k] };
      if (Array.isArray(k)) { const o = {}; for (const x of k) o[x] = store[x]; return o; }
      if (k && typeof k === 'object') { const o = {}; for (const [a, b] of Object.entries(k)) o[a] = a in store ? store[a] : b; return o; }
      return { ...store }; },
    set: async (o) => {
      const ch = {};
      for (const [k, v] of Object.entries(o)) ch[k] = { oldValue: store[k], newValue: JSON.parse(JSON.stringify(v)) };
      Object.assign(store, JSON.parse(JSON.stringify(o)));
      cambi.forEach((f) => f(ch, 'local'));
    },
    remove: async (k) => { const ch = { [k]: { oldValue: store[k] } }; delete store[k]; cambi.forEach((f) => f(ch, 'local')); } },
    onChanged: { addListener: (f) => cambi.push(f) } },
  runtime: { sendMessage: async (m) => { messaggi.push(m); return risposta(m); }, onMessage: { addListener: (f) => ascoltatori.push(f) } },
};
for (const f of ['utils.js', 'api.js', 'editor-logica.js', 'relist.js', 'editor.js', 'coda-logica.js', 'queue.js', 'ui.js']) {
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
const riepilogo = () => doc.querySelector('.vr-summary')?.closest('.vr-card');
const confermaRiepilogo = () => [...riepilogo().querySelectorAll('button')].find((b) => /^(Avvia|Aggiungi)/.test(b.textContent)).click();
const aspetta = async (cond) => { for (let k = 0; k < 40 && !cond(); k++) await tick(); };
const campi = () => {
  const d = dialogo();
  const sezioni = d.querySelectorAll('fieldset');
  const modo = sezioni[0].querySelector('select');
  const colore = sezioni[2].querySelector('select');
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
  ok('riepilogo: prezzo prima → dopo nell\'ordine di pubblicazione', /10,00\s€ →\s9,00\s€/.test(riepilogo().querySelector('.vr-plan').textContent));
  ok('riepilogo: opzioni descritte', /-10% sul prezzo/.test(riepilogo().textContent));
  confermaRiepilogo();
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

  // solo note (es. libro senza colore): non sono avvisi; il riepilogo c'e' sempre
  VR.canary = async () => ({ ok: true, problemi: [], avvisi: [], note: ['Nessun colore, come nell\'annuncio online.'] });
  const avviiPrima = messaggi.filter((m) => m.type === 'vr:queueStart').length;
  VR.selection.cambia('11', true);
  btn('Avvia').click();
  await aspetta(() => riepilogo());
  ok('solo note: 1 pronto, note a parte', /1\s*pronti/.test(riepilogo().querySelector('.vr-summary').textContent) && /Note, non sono problemi \(1\)/.test(riepilogo().textContent));
  confermaRiepilogo();
  await aspetta(() => messaggi.filter((m) => m.type === 'vr:queueStart').length > avviiPrima);
  ok('confermato il riepilogo, la coda parte', messaggi.filter((m) => m.type === 'vr:queueStart').length === avviiPrima + 1);

  // ---------------------------------------------- modelli di opzioni
  VR.selection.cambia('11', true); await tick();
  btn('Opzioni').click(); await tick();
  c = campi();
  c.modo.value = 'percent'; c.modo.dispatchEvent(new window.Event('change'));
  scrivi(c.valore, '-15');
  btn('Salva come modello…', dialogo()).click(); await tick();
  const nomeInput = dialogo().querySelector('.vr-templates__ask input');
  nomeInput.value = 'Saldi';
  btn('Salva', dialogo().querySelector('.vr-templates__ask')).click(); await tick(); await tick();
  ok('modello salvato, senza orario né articoli', store.queueTemplates?.[0]?.nome === 'Saldi' && store.queueTemplates[0].opzioni.valore === '-15' && !('quando' in store.queueTemplates[0].opzioni));
  ok('nome del modello mostrato', /Modello «Saldi»/.test(dialogo().textContent));
  scrivi(c.valore, '-20');
  ok('modificato dopo il modello: il nome sparisce', !/Modello «Saldi»/.test(dialogo().textContent));
  const sel = dialogo().querySelector('.vr-templates select');
  sel.value = 'Saldi'; sel.dispatchEvent(new window.Event('change'));
  btn('Applica', dialogo()).click(); await tick();
  ok('applicare con modifiche non salvate chiede conferma', /sostituirle con «Saldi»/.test(dialogo().querySelector('.vr-templates__ask').textContent) && c.valore.value === '-20');
  btn('Sostituisci', dialogo()).click(); await tick();
  ok('confermato: campi dal modello, ancora da salvare', c.valore.value === '-15' && /non salvate/.test(dialogo().querySelector('.vr-editor__badge').textContent));
  btn('Salva', dialogo()).click(); await tick(); await tick();
  ok('salvato: le opzioni ricordano il modello', store.queueDraft.modello === 'Saldi' && store.queueDraft.valore === '-15');
  btn('Opzioni').click(); await tick();
  if (dialogo()) {
    const sel2 = dialogo().querySelector('.vr-templates select');
    sel2.value = 'Saldi'; sel2.dispatchEvent(new window.Event('change'));
    btn('Elimina', dialogo()).click(); await tick();
    btn('Elimina', dialogo().querySelector('.vr-templates__ask')).click(); await tick(); await tick();
    ok('modello eliminato con conferma', !store.queueTemplates.length);
    btn('Annulla', dialogo())?.click(); await tick();
  }

  // ---------------------------------------------- coda in corso: si aggiunge
  const T = Date.now();
  const codaAttiva = { v: 3, running: true, state: 'waiting', startedAt: T, intervalMin: 20, overrides: { pricePercent: -10 }, nextAt: T + 600000,
    items: [{ id: '50', title: 'In corso', status: 'working' }, { id: '12', title: 'Già in coda', status: 'pending' }], log: [] };
  await window.chrome.storage.local.set({ vrQueue: codaAttiva });
  for (const id of ['11', '12']) { const c = doc.createElement('input'); c.type = 'checkbox'; c.className = 'vr-bar__pick'; c.dataset.vrId = id; doc.body.append(c); VR.selection.registra(id, c); VR.selection.cambia(id, true); }
  store.inventory['12'] = { price: 4, title: 'Già in coda' };
  await tick();
  const bAgg = [...doc.querySelectorAll('.vr-queue button')].find((b) => /Aggiungi alla coda \(2\)/.test(b.textContent));
  ok('coda in corso: «Aggiungi alla coda (2)» al posto di Avvia', bAgg && !btn('Avvia'));
  VR.canary = async () => ({ ok: true, problemi: [], avvisi: [], note: [] });
  risposta = (m) => (m.type === 'vr:queueAdd' ? { ok: true, aggiunti: m.items.map((i) => i.id), riattivati: [], rifiutati: [] } : {});
  bAgg.click();
  await aspetta(() => riepilogo());
  ok('riepilogo d\'aggiunta: titolo, opzioni della coda in corso', /Aggiungi alla coda in corso/.test(riepilogo().textContent) && /Useranno le opzioni della coda in corso: -10% sul prezzo/.test(riepilogo().textContent));
  ok('il già in coda è escluso con il motivo, prima del controllo', /Non aggiungibili \(1\)/.test(riepilogo().textContent) && /posizione 1/.test(riepilogo().textContent));
  riepilogo().querySelector('input[value="cima"]').click();
  confermaRiepilogo();
  await aspetta(() => messaggi.some((m) => m.type === 'vr:queueAdd'));
  const agg = messaggi.find((m) => m.type === 'vr:queueAdd');
  ok('aggiunta inviata: solo il nuovo, in cima', agg.items.map((i) => i.id).join() === '11' && agg.dove === 'cima');
  ok('nessuna coda nuova avviata', messaggi.filter((m) => m.type === 'vr:queueStart').length === avviiPrima + 1);

  // ---------------------------------------------- annullamento nella pagina
  let segnale = null; let sblocca;
  VR.relist = (id, o, passo, s) => { segnale = s; return new Promise((r) => { sblocca = r; }); };
  VR.esclusivo = (id, lavoro) => lavoro();
  const onMsg = (m) => new Promise((r) => { for (const f of ascoltatori) if (f.length >= 2) f(m, {}, r); });
  onMsg({ type: 'vr:relistOne', itemId: '77', overrides: {} });
  await tick();
  let rc = await onMsg({ type: 'vr:relistCancel', itemId: '77' });
  ok('annulla prima dell\'invio: accettato e passato a relist', rc.ok && segnale.annullato() === true);
  segnale.oltre();
  rc = await onMsg({ type: 'vr:relistCancel', itemId: '77' });
  ok('annulla dopo il punto di non ritorno: troppo tardi', rc.troppoTardi === true);
  const err = new Error('Annullato prima dell\'invio'); err.annullato = true;
  const fine = new Promise((r) => { risposta = (m) => { if (m.type === 'vr:relistDone') r(m); return {}; }; });
  sblocca(Promise.reject(err));
  const done = await fine;
  ok('esito annullato riferito come «cancelled», con categoria', done.outcome === 'cancelled' && done.categoria === 'annullato');
  await tick();
  rc = await onMsg({ type: 'vr:relistCancel', itemId: '77' });
  ok('a lavoro finito non c\'è più niente da annullare', rc.ok === false && !rc.troppoTardi);

  ok('nessun errore JavaScript', !errori.length);
  console.log(`\n${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
