// 2.6.0 — Bug dei telefoni (segnalato da un utente francese): Vinted chiedeva di
// scegliere il modello anche se l'annuncio lo aveva. Il modello (ontology_model_id,
// ontology_collection_id, model {id}) ora passa nella pubblicazione; se Vinted lo
// chiede comunque, il messaggio dice cosa fare. relist() vero con API simulate.
const fs = require('fs');
const path = require('path');
const out = []; const ok = (n, c, extra = '') => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}${!c && extra ? ` — ${extra}` : ''}`);
const leggi = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const corpo = (t) => t.slice(t.indexOf('(() => {') + 8, t.lastIndexOf('})();'));

const store = {};
const chromeFinto = {
  storage: { local: { get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : { ...store }), set: async (o) => Object.assign(store, o), remove: async () => {} } },
  runtime: { sendMessage: async () => ({}) },
};
const docFinto = { createElement: () => { const c = { getContext: () => ({ set imageSmoothingQuality(_) {}, scale() {}, translate() {}, rotate() {}, drawImage() {} }), toBlob: (cb) => cb(new Blob([new Uint8Array(4096)], { type: 'image/jpeg' })) }; return c; } };
const bitmap = async () => ({ width: 800, height: 600, close() {} });
const VR = { uuid: () => 'u-1', settings: { deleteOld: false, order: 'safe', delayMs: 0, userId: '77' }, log() {}, warn() {}, sleep: async () => {} };
const win = { VR };
new Function('window', corpo(leggi('editor-logica.js').replace('(function (root) {', '(() => { const root = window;').replace(/\}\)\(typeof window[^\n]*/, '})();')))(win);
new Function('window', 'chrome', 'createImageBitmap', 'document', corpo(leggi('relist.js')))(win, chromeFinto, bitmap, docFinto);

let sorgente = null; let creato = null; let rifiuto = null;
VR.api = {
  getUploadDraft: async () => JSON.parse(JSON.stringify(sorgente)),
  downloadPhoto: async () => new Blob([new Uint8Array(5000)], { type: 'image/jpeg' }),
  uploadPhoto: async () => 7001,
  createItem: async (d) => { creato = d; if (rifiuto) throw rifiuto; return { id: 90001 }; },
  deleteItem: async () => {},
};
const telefono = (o = {}) => ({
  id: 555, user_id: 77, title: 'iPhone 12 128 Go', description: 'Très bon état', catalog_id: 2328, brand_id: 54661, brand_dto: { id: 54661, title: 'Apple' },
  status_id: 2, price: { amount: '320.0', currency_code: 'EUR' }, currency: 'EUR', package_size_id: 1, color1_id: 1, color2_id: null,
  photos: [{ id: 1, url: 'https://images1.vinted.net/t/1.jpg' }], item_attributes: [{ code: 'condition', ids: [2] }],
  ontology_model_id: 30123, ontology_collection_id: null, model: { id: 30123, title: 'iPhone 12' }, manufacturer: null, ...o,
});

(async () => {
  sorgente = telefono();
  await VR.relist('555', {}, () => {}, {});
  ok('B1. telefono: il modello dell\'annuncio arriva a Vinted (ontology_model_id)', creato.ontology_model_id === 30123, JSON.stringify(creato).slice(0, 200));
  ok('    marca, categoria e condizioni come prima; nessun campo modello vuoto aggiunto', creato.brand_id === 54661 && creato.catalog_id === 2328 && creato.status_id === 2 && !('ontology_collection_id' in creato));
  sorgente = telefono({ ontology_model_id: null });
  await VR.relist('555', {}, () => {}, {});
  ok('B2. lettura con solo model {id, title}: l\'id va in ontology_model_id', creato.ontology_model_id === 30123);
  sorgente = telefono({ ontology_collection_id: 812 });
  await VR.relist('555', {}, () => {}, {});
  ok('B3. serie (ontology_collection_id): passa anche quella', creato.ontology_collection_id === 812);
  // campo imparato da una modifica vera su Vinted per questa categoria
  VR.settings.itemFormats = { 2328: { campi: ['title', 'catalog_id', 'model_id', 'item_attributes'], neutri: [], at: 1 } };
  sorgente = telefono();
  await VR.relist('555', {}, () => {}, {});
  ok('B4. se Vinted usa un altro nome (imparato modificando un telefono), riceve lo stesso id', creato.model_id === 30123 && creato.ontology_model_id === 30123);
  VR.settings.itemFormats = { 1: { campi: ['title', 'model_id'], neutri: [], at: 1 } };
  sorgente = telefono();
  await VR.relist('555', {}, () => {}, {});
  ok('B5. campi imparati di un\'altra categoria: non si usano per questa', !('model_id' in creato));
  VR.settings.itemFormats = {};
  sorgente = { ...telefono(), catalog_id: 2319, ontology_model_id: null, model: null, title: 'Libro' };
  await VR.relist('555', {}, () => {}, {});
  ok('B6. libro (senza modello): nessun campo modello nel payload, come prima', !('ontology_model_id' in creato) && !('model_id' in creato));

  // Vinted rifiuta comunque per il modello: messaggio con cosa fare
  const casi = [
    ['model: Sélectionnez le modèle', 'fr'], ['Seleziona il modello', 'it'], ['Please select a model', 'en'], ['Selecciona el modelo', 'es'], ['Bitte wähle ein Modell', 'de'],
  ];
  for (const [msg, l] of casi) {
    sorgente = telefono();
    rifiuto = Object.assign(new Error(msg), { status: 400, campi: [msg] });
    let e = null;
    try { await VR.relist('555', {}, () => {}, {}); } catch (x) { e = x; }
    ok(`B7. rifiuto «${msg}» (${l}): riconosciuto, con il consiglio`, e?.modello === true && e.message.startsWith(msg) && /Modifica/.test(e.message), e?.message);
  }
  sorgente = telefono();
  rifiuto = Object.assign(new Error('Il prezzo è troppo basso'), { status: 400, campi: ['price: troppo basso'] });
  let e2 = null;
  try { await VR.relist('555', {}, () => {}, {}); } catch (x) { e2 = x; }
  ok('B8. altri rifiuti (prezzo, modifica…): nessun consiglio sul modello', !e2?.modello && e2.message === 'Il prezzo è troppo basso');
  rifiuto = Object.assign(new Error('Vinted non ha risposto'), { incerto: true, rete: true });
  let e3 = null;
  try { await VR.relist('555', {}, () => {}, {}); } catch (x) { e3 = x; }
  ok('B9. esito incerto: resta incerto (il consiglio sul modello non lo copre)', e3?.incerto && !e3.modello && /Esito incerto/.test(e3.message));
  rifiuto = null;
  ok('B10. la diagnostica dei campi mostra il modello', VR.diagnosiCampi(telefono()).some((r) => JSON.stringify(r).includes('ontology_model_id')));

  console.log(out.join('\n'));
  const ko = out.filter((x) => x.includes('FAIL')).length;
  console.log(`${out.length - ko} OK, ${ko} FAIL`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
