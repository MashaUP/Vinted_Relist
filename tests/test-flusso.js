// relist() eseguito davvero, con canvas e API di Vinted simulate: le scelte
// dell'editor (ordine, rimozione, rotazione, ritaglio, testi) devono arrivare all'upload.
const fs = require('fs');
const leggi = (f) => fs.readFileSync(require('path').join(__dirname, '..', 'src') + '/' + f, 'utf8');
const corpo = (s) => s.slice(s.indexOf('(() => {') + 8, s.lastIndexOf('})();'));

let store = {}, operazioni = [], caricati = [], scaricati = [], creato = null, eliminati = [];
global.chrome = {
  storage: { local: {
    get: async (k) => { if (Array.isArray(k)) { const o={}; for (const x of k) o[x]=store[x]; return o; }
      if (typeof k === 'string') return {[k]: store[k]}; return {...store}; },
    set: async (o) => Object.assign(store, o), remove: async (k) => { delete store[k]; } } },
  runtime: { sendMessage: async () => ({}) },
};
global.createImageBitmap = async (b) => ({ width: 1200, height: 800, sorgente: b.nome, close(){} });
global.document = { createElement: () => {
  const c = { width: 0, height: 0,
    getContext: () => ({ set imageSmoothingQuality(v){},
      scale: (...a) => operazioni.push(['scale', ...a]),
      translate: (...a) => operazioni.push(['translate', ...a]),
      rotate: (a) => operazioni.push(['rotate', Math.round(a * 180 / Math.PI)]),
      drawImage: (bm) => operazioni.push(['draw', bm.sorgente]) }),
    toBlob: (cb) => { const b = new Blob([new Uint8Array(4096)], { type: 'image/jpeg' }); b.dim = [c.width, c.height]; cb(b); } };
  return c; } };

const VR = { uuid: () => 'u-' + Math.random().toString(36).slice(2, 7), settings: { deleteOld: true, order: 'safe', delayMs: 0 },
  log(){}, warn(){}, sleep: async () => {} };
global.window = { VR };
new Function('window', corpo(leggi('editor-logica.js').replace('(function (root) {', '(() => { const root = window;').replace(/\}\)\(typeof window[^\n]*/, '})();')))(global.window);
new Function('window', 'chrome', 'createImageBitmap', 'document', corpo(leggi('relist.js')))(global.window, chrome, createImageBitmap, document);

const sorgente = {
  id: 1, title: 'Titolo vecchio', description: 'Descrizione #starwars vecchia', catalog_id: 3312,
  brand_dto: { id: 1, title: 'M' }, color1_id: 3, currency: 'EUR', price: { amount: '10.0' },
  photos: [{ full_size_url: 'A' }, { full_size_url: 'B' }, { full_size_url: 'C' }],
};
VR.api = {
  getUploadDraft: async () => JSON.parse(JSON.stringify(sorgente)),
  downloadPhoto: async (u) => { scaricati.push(u); const b = new Blob([new Uint8Array(10)]); b.nome = u; return b; },
  uploadPhoto: async (blob) => { caricati.push(blob.dim); return caricati.length * 100; },
  createItem: async (draft) => { creato = draft; return { id: 999 }; },
  deleteItem: async (id) => { eliminati.push(id); },
};

const out=[]; const ok=(n,c)=>out.push(`  ${c?'OK  ':'FAIL'} ${n}`);
(async () => {
  // 1. senza editor: tutte le foto, ordine originale, nessuna trasformazione
  await VR.relist(1, {});
  ok('senza editor: tre foto nell’ordine originale', scaricati.join('') === 'ABC');
  ok('senza editor: nessuna rotazione', !operazioni.some(o => o[0] === 'rotate' && o[1] !== 0));
  ok('senza editor: dimensioni intatte', caricati.every(d => d[0] === 1200 && d[1] === 800));

  // 2. con l'editor: C in copertina, B tolta, C ruotata, A ritagliata a meta'
  scaricati = []; caricati = []; operazioni = [];
  const blobC = new Blob([new Uint8Array(10)]); blobC.nome = 'C';
  await VR.relist(1, {
    title: 'Titolo nuovo', price: 8.5,
    photos: [{ url: 'C', rotate: 90, blob: blobC }, { url: 'A', crop: { x: 0, y: 0, w: .5, h: 1 } }],
  });
  ok('ordine dell’editor rispettato e foto tolta assente', operazioni.filter(o => o[0] === 'draw').map(o => o[1]).join('') === 'CA');
  ok('foto gia’ scaricata dall’editor non riscaricata', scaricati.join('') === 'A');
  ok('rotazione applicata alla prima', operazioni.some(o => o[0] === 'rotate' && o[1] === 90));
  ok('prima foto caricata in verticale (800x1200)', caricati[0][0] === 800 && caricati[0][1] === 1200);
  ok('seconda caricata ritagliata (600x800)', caricati[1][0] === 600 && caricati[1][1] === 800);
  ok('due foto nel nuovo annuncio, nell’ordine', creato.assigned_photos.map(p => p.id).join() === '100,200');
  ok('titolo e prezzo inviati', creato.title === 'Titolo nuovo' && creato.price === 8.5);

  // 3. sostituzione in blocco
  await VR.relist(1, { replace: { find: '#STARWARS', with: '#sw' } });
  ok('sostituzione in blocco nella descrizione', creato.description === 'Descrizione #sw vecchia');

  // 4. la bozza locale sparisce dopo la pubblicazione
  store.editorDrafts = { 1: { title: 'bozza' }, 2: { title: 'altra' } };
  VR.scartaBozza = async (id) => { delete store.editorDrafts[id]; };
  await VR.relist(1, {});
  ok('bozza dell’articolo pubblicato scartata', !(1 in store.editorDrafts));
  ok('le bozze degli altri articoli restano', 2 in store.editorDrafts);

  console.log(out.join('\n'));
  process.exit(out.some(x=>x.includes('FAIL'))?1:0);
})().catch(e => { console.error(e); process.exit(1); });
