// L'editor in un DOM simulato: apre, modifica, ritaglia, anteprima, pubblica.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = require('path').join(__dirname, '..', '..', 'src') + '/';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const store = {}; const messaggi = [];
window.chrome = {
  storage: { local: {
    get: async (k) => { if (typeof k === 'string') return {[k]: store[k]};
      if (Array.isArray(k)) { const o={}; for (const x of k) o[x]=store[x]; return o; }
      if (k && typeof k === 'object') { const o={}; for (const [a,b] of Object.entries(k)) o[a]= a in store?store[a]:b; return o; }
      return {...store}; },
    set: async (o) => Object.assign(store, o), remove: async (k) => { delete store[k]; } },
    onChanged: { addListener(){} } },
  runtime: { sendMessage: async (m) => { messaggi.push(m); if (m.type === 'vr:download') return { ok: true, nome: m.nome }; return {}; }, onMessage: { addListener(){} } },
};
// jsdom non ha Blob.arrayBuffer (Chrome si'): lo aggiungo solo qui.
window.Blob.prototype.arrayBuffer = function () { return new Promise((ok) => { const r = new window.FileReader(); r.onload = () => ok(r.result); r.readAsArrayBuffer(this); }); };
window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {};
window.createImageBitmap = async () => ({ width: 1200, height: 800, close(){} });
window.HTMLCanvasElement.prototype.getContext = () => ({ scale(){}, translate(){}, rotate(){}, drawImage(){}, set imageSmoothingQuality(v){} });
window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new window.Blob([new Uint8Array(4096)])); };

for (const f of ['utils.js', 'api.js', 'editor-logica.js', 'relist.js', 'editor.js', 'queue.js', 'ui.js']) {
  window.eval(fs.readFileSync(SRC + f, 'utf8'));
}
const VR = window.VR;
VR.settings = { ...VR.DEFAULTS, deleteOld: true, colorMap: { 1: 'Nero', 3: 'Grigio' } };
const sorgente = {
  id: 7, title: 'DVD Ghost Rider - Nicolas Cage', description: 'DVD originale in ottime condizioni, disco senza graffi, custodia integra.',
  catalog_id: 3312, brand_dto: { id: 1, title: 'M' }, color1_id: null, color2_id: null,
  price: { amount: '5.0' }, item_attributes: [{}], package_size_id: 2,
  photos: [{ full_size_url: 'A' }, { full_size_url: 'B' }, { full_size_url: 'C' }],
};
VR.api.getUploadDraft = async () => JSON.parse(JSON.stringify(sorgente));
const BYTE = {
  A: [0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50,0,0,0,0],
  B: [0xff,0xd8,0xff,0xe0,0,0,0,0,0,0,0,0,0,0,0,0],
};
VR.api.downloadPhoto = async (u) => {
  if (!BYTE[u]) throw new Error('rete');
  return new window.Blob([new Uint8Array(BYTE[u])], { type: 'image/jpeg' });
};

const doc = window.document;
const tick = () => new Promise((r) => setTimeout(r, 30));
const testi = () => doc.querySelector('.vr-editor').textContent;
const bottone = (t) => [...doc.querySelectorAll('.vr-editor button')].find((b) => b.textContent.trim().startsWith(t));
const out=[]; const ok=(n,c)=>out.push(`  ${c?'OK  ':'FAIL'} ${n}`);
const errori = []; window.addEventListener('error', (e) => errori.push(e.message));

(async () => {
  let inviato = null;
  VR.openEditor(7, (o) => { inviato = o; });
  await tick(); await tick();

  ok('si apre con tre foto', doc.querySelectorAll('.vr-photo:not(.vr-photo--add)').length === 3);
  ok('copertina segnata sulla prima', doc.querySelector('.vr-photo .vr-photo__cover') !== null);
  ok('badge: nessuna modifica', /Nessuna modifica/.test(doc.querySelector('.vr-editor__badge').textContent));
  ok('nessun «null» scritto nei controlli', !/\bnull\b/.test(doc.querySelector('.vr-checks').textContent));
  ok('colore mancante senza prove: nota, né avviso né errore', /Nessun colore/.test(doc.querySelector('.vr-check-row.is-note')?.textContent || '') && !doc.querySelector('.vr-check-row.is-error') && ![...doc.querySelectorAll('.vr-check-row.is-warn')].some((r) => /colore/i.test(r.textContent)));
  ok('l’anteprima non è bloccata dal colore', !bottone('Anteprima').disabled);
  ok('colore indicato come facoltativo', /facoltativo/.test(testi()));

  // --- download delle foto
  const dl = doc.querySelector('.vr-dl'); dl.open = true;
  ok('sezione download con tutte e tre le foto originali', dl.querySelectorAll('.vr-dl__item').length === 3);
  const scarica = [...dl.querySelectorAll('button')].find((b) => /Scarica selezionate/.test(b.textContent));
  ok('senza selezione il download è spento', scarica.disabled && /\(0\)/.test(scarica.textContent));
  [...dl.querySelectorAll('button')].find((b) => b.textContent === 'Seleziona tutte').click(); await tick();
  ok('seleziona tutte: (3) e acceso', !scarica.disabled && /\(3\)/.test(scarica.textContent));
  const ordinePrima = [...doc.querySelectorAll('.vr-photo:not(.vr-photo--add) img')].map((i) => i.alt).join();
  scarica.click();
  for (let k = 0; k < 40 && !/salvate|non riuscite/.test(dl.textContent); k++) await tick();
  const scaricati = messaggi.filter((m) => m.type === 'vr:download');
  ok('due foto inviate al download, la terza fallisce senza fermare le altre', scaricati.length === 2);
  ok('formato vero dai byte: webp resta webp', scaricati.some((m) => m.nome === 'vinted-7-foto-01.webp' && m.url.startsWith('data:image/webp')));
  ok('jpeg resta jpeg', scaricati.some((m) => m.nome === 'vinted-7-foto-02.jpg' && m.url.startsWith('data:image/jpeg')));
  ok('riepilogo unico con la foto non riuscita', /2 salvate, 1 non riuscite: foto 3/.test(dl.textContent));
  ok('scaricare non tocca le foto da ripubblicare', [...doc.querySelectorAll('.vr-photo:not(.vr-photo--add) img')].map((i) => i.alt).join() === ordinePrima);
  [...dl.querySelectorAll('button')].find((b) => b.textContent === 'Deseleziona tutte').click(); await tick();
  ok('deseleziona tutte: (0)', /\(0\)/.test(scarica.textContent) && scarica.disabled);
  messaggi.length = 0;
  dl.querySelector('.vr-dl__one').click();
  for (let k = 0; k < 40 && !messaggi.some((m) => m.type === 'vr:download'); k++) await tick();
  ok('download singolo dalla miniatura', messaggi.filter((m) => m.type === 'vr:download').length === 1);

  // sceglie comunque un colore dall'elenco imparato
  const colore = doc.querySelector('.vr-editor .vr-row select');
  colore.value = '1'; colore.dispatchEvent(new window.Event('change'));
  await tick();
  ok('scelto il colore, l’avviso sparisce', !/Nessun colore/.test(doc.querySelector('.vr-checks').textContent));
  ok('badge: bozza locale non inviata', /non ancora inviata/.test(doc.querySelector('.vr-editor__badge').textContent));

  // prezzo e titolo
  const [titolo] = doc.querySelectorAll('.vr-editor input[type=text]');
  const prezzo = doc.querySelector('.vr-editor input[type=number]');
  prezzo.value = '4.5'; prezzo.dispatchEvent(new window.Event('input'));
  titolo.value = 'DVD GHOST RIDER NICOLAS CAGE'; titolo.dispatchEvent(new window.Event('input'));
  await tick();
  ok('avviso maiuscolo in tempo reale', /maiuscolo/.test(testi()));
  ok('contatore del titolo', /28\/100/.test(testi()));

  // ruota la seconda, toglie la terza
  let tessere = doc.querySelectorAll('.vr-photo:not(.vr-photo--add)');
  tessere[1].querySelector('[title="Ruota a destra"]').click(); await tick();
  tessere = doc.querySelectorAll('.vr-photo:not(.vr-photo--add)');
  tessere[2].querySelector('[title="Togli dall\'annuncio"]').click(); await tick();
  ok('foto tolta', doc.querySelectorAll('.vr-photo:not(.vr-photo--add)').length === 2);
  ok('si puo’ rimettere la foto tolta', /\+ 1 tolta/.test(testi()));

  // riordino con trascinamento: la seconda diventa copertina
  tessere = doc.querySelectorAll('.vr-photo:not(.vr-photo--add)');
  const trascina = (tipo, el) => { const e = new window.Event(tipo, { bubbles: true }); e.dataTransfer = { effectAllowed: '' }; e.preventDefault = () => {}; el.dispatchEvent(e); };
  trascina('dragstart', tessere[1]); trascina('drop', tessere[0]); await tick();

  // ritaglio della nuova seconda (A) con il preset quadrato
  tessere = doc.querySelectorAll('.vr-photo:not(.vr-photo--add)');
  tessere[1].querySelector('[title="Ritaglia"]').click(); await tick(); await tick();
  ok('vista di ritaglio aperta', /Ritaglia la foto 2/.test(testi()));
  const img = doc.querySelector('.vr-crop__img');
  Object.defineProperty(img, 'naturalWidth', { value: 1200 }); Object.defineProperty(img, 'naturalHeight', { value: 800 });
  bottone('Quadrato').click(); await tick();
  ok('preset quadrato mostra la selezione', !doc.querySelector('.vr-crop__sel').hidden);
  bottone('Applica').click(); await tick();
  ok('torna all’editor con la foto segnata come ritagliata', doc.querySelector('.vr-photo__tag')?.textContent === 'ritagliata');

  // la bozza si salva da sola
  await new Promise((r) => setTimeout(r, 600));
  ok('bozza salvata in locale', store.editorDrafts?.[7]?.price === 4.5);

  // anteprima
  bottone('Anteprima').click(); await tick();
  ok('anteprima: elenca cosa verra’ inviato', /Cosa verrà inviato a Vinted/.test(testi()));
  ok('anteprima: prezzo prima e dopo', /5,00\s?€/.test(testi()) && /4,50\s?€/.test(testi()));
  ok('anteprima: foto riassunte', /nuova copertina/.test(testi()) && /1 tolta/.test(testi()) && /2 ruotate o ritagliate/.test(testi()));
  ok('anteprima: dice cosa succede alla pubblicazione', /ripartono da zero/.test(testi()));

  bottone('Pubblica').click(); await tick();
  ok('pubblica: overlay chiuso', !doc.querySelector('.vr-editor'));
  ok('pubblica: ordine e trasformazioni', inviato.photos.map((f) => `${f.url}${f.rotate}${f.crop ? 'c' : ''}`).join(',') === 'B90,A0c');
  ok('pubblica: blob gia’ scaricati passati all’upload', inviato.photos.every((f) => f.blob));
  ok('pubblica: testi, prezzo e colore', inviato.price === 4.5 && inviato.colorIds[0] === 1 && /GHOST/.test(inviato.title));

  // riapertura: riprende la bozza; "Annulla modifiche" torna all'originale e la scarta
  store.editorDrafts = { 7: { at: Date.now(), title: 'Bozza ripresa', description: sorgente.description, price: 3, colorIds: [3], photos: [{ url: 'A' }, { url: 'B' }, { url: 'C' }] } };
  VR.openEditor(7, () => {}); await tick(); await tick();
  ok('riapertura riprende la bozza', doc.querySelector('.vr-editor input[type=text]').value === 'Bozza ripresa');
  bottone('Annulla modifiche').click(); await tick(); await tick();
  ok('annulla modifiche torna all’originale', doc.querySelector('.vr-editor input[type=text]').value === sorgente.title);
  ok('...e scarta la bozza', !(7 in store.editorDrafts));

  ok('nessun errore JavaScript', errori.length === 0);
  if (errori.length) console.log(errori);
  console.log(out.join('\n'));
  process.exit(out.some(x=>x.includes('FAIL'))?1:0);
})().catch((e) => { console.error(e); process.exit(1); });
