// 2.1.0 — Annullamento dell'articolo in lavorazione: rispettato solo prima del punto di non ritorno.
const fs = require('fs');
const leggi = (f) => fs.readFileSync(require('path').join(__dirname, '..', 'src/') + f, 'utf8');
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
const azzera = () => { caricati = []; scaricati = []; creato = null; eliminati = []; store = {}; };
(async () => {
  // annullato subito: niente foto caricate, niente creato, niente eliminato, copia rimossa
  azzera();
  let errore = null;
  try { await VR.relist(1, {}, () => {}, { annullato: () => true }); } catch (e) { errore = e; }
  ok('annullato prima di iniziare: errore «annullato»', errore?.annullato === true && /nessun annuncio creato o eliminato/.test(errore.message));
  ok('…nessuna foto caricata, niente creato, niente eliminato', !caricati.length && !creato && !eliminati.length);
  ok('…copia di sicurezza tolta: non serve', !Object.keys(store).some((k) => k.startsWith('vrBackup:')));

  // annullato a metà delle foto: si ferma prima della successiva
  azzera();
  let chiesto = false;
  VR.api.uploadPhoto = async (blob) => { caricati.push(blob.dim); if (caricati.length === 2) chiesto = true; return caricati.length * 100; };
  errore = null;
  try { await VR.relist(1, {}, () => {}, { annullato: () => chiesto }); } catch (e) { errore = e; }
  ok('annullato dopo 2 foto: la terza non parte, niente creato', errore?.annullato && caricati.length === 2 && !creato && !eliminati.length);

  // ordine "pubblica, poi elimina": il punto di non ritorno è la creazione
  azzera();
  VR.api.uploadPhoto = async (blob) => { caricati.push(blob.dim); return caricati.length * 100; };
  let oltre = false; chiesto = false;
  VR.api.createItem = async (draft) => { chiesto = true; creato = draft; return { id: 999 }; };
  await VR.relist(1, {}, () => {}, { annullato: () => chiesto, oltre: () => { oltre = true; } });
  ok('richiesta arrivata durante la creazione: ignorata, l\'operazione finisce', oltre && creato && eliminati.join() === '1');

  // ordine "elimina, poi pubblica": il punto di non ritorno è l'eliminazione
  azzera();
  VR.settings.order = 'clean';
  oltre = false; chiesto = false;
  const passi = [];
  VR.api.deleteItem = async (id) => { chiesto = true; eliminati.push(id); };
  VR.api.createItem = async (draft) => { creato = draft; return { id: 999 }; };
  await VR.relist(1, {}, (p) => passi.push(p), { annullato: () => chiesto, oltre: () => { oltre = true; passi.push('<oltre>'); } });
  ok('con «elimina, poi pubblica» il punto di non ritorno è prima dell\'eliminazione', passi.indexOf('<oltre>') < passi.indexOf('Elimino il vecchio annuncio…') && creato && eliminati.join() === '1');
  VR.settings.order = 'safe';

  // senza segnale: comportamento di prima
  azzera();
  await VR.relist(1, {});
  ok('senza segnale (bottone sulla card): come prima', creato && eliminati.join() === '1');

  console.log(out.join('\n'));
  process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
