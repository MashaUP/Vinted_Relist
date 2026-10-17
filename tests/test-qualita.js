// Punteggio di completezza e snapshot, sul sorgente di rilascio.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src/relist.js'),'utf8');
const body = src.slice(src.indexOf('(() => {')+8, src.lastIndexOf('})();'));
let store = {};
global.chrome = { storage: { local: {
  get: async (k) => { if (Array.isArray(k)) { const o={}; for (const x of k) o[x]=store[x]; return o; } return {[k]:store[k]}; },
  set: async (o) => Object.assign(store, o) } } };
const VR = { uuid:()=>'u', settings:{}, log(){}, warn(){}, api:{} };
VR.editorLogica = require(require('path').join(__dirname, '..', 'src/editor-logica.js'));
const window = { VR }; global.window = window;
new Function('window','chrome', body + '\n; window.__snap = registraSnapshot;')(window, global.chrome);

const out=[]; const ok=(n,c)=>out.push(`  ${c?'OK  ':'FAIL'} ${n}`);
const P = VR.punteggio;

const completo = { photos:[1,2,3,4,5], brand_id:1, color1_id:3, item_attributes:[{}],
  description:'x'.repeat(200), title:'Lotto 4 Busti Star Wars Kinder Gran Sorpresa', package_size_id:2 };
ok('annuncio completo: 100', P(completo).score === 100);
ok('nessun consiglio se e\u0027 tutto a posto', P(completo).consigli.length === 0);

const povero = { photos:[1], title:'DVD', description:'ok' };
const r = P(povero);
ok(`annuncio povero sotto 30 (${r.score})`, r.score < 30);
ok('segnala titolo poco descrittivo', r.voci.some(v=>v.testo==='Titolo poco descrittivo' && !v.ok));
ok('segnala descrizione corta', r.voci.some(v=>v.testo==='Descrizione corta' && !v.ok));
ok('consiglia qualcosa', r.consigli.length > 0);

// la taglia pesa solo dove la categoria la prevede
const dvd = { ...completo };
const maglia = { ...completo, size_id: null };
ok('DVD senza campo taglia: non penalizzato', P(dvd).score === 100);
ok('maglia senza taglia: penalizzata', P(maglia).score < 100);

// la condizione vale anche da item_attributes
ok('condizione da item_attributes', P({...completo, item_attributes:[{}]}).voci.find(v=>v.testo==='Condizione').ok);
ok('condizione da status_id', P({...completo, item_attributes:[], status_id:2}).voci.find(v=>v.testo==='Condizione').ok);

// --- snapshot ---
(async () => {
  const ORA = Date.now();
  store = { inventory: { '100': { title:'Vecchio', price:10, views:12, firstSeen: ORA-30*86400000,
    series:[[ORA-50*3600000, 3],[ORA-2*3600000, 12]] } }, vrSnapshots: [] };
  const source = { title:'Vecchio', description:'desc vecchia', price:{amount:'10.0'} };
  await window.__snap('100', source, { title:'Vecchio', price:9 }, { id: 200 });

  const s = store.vrSnapshots[0];
  ok('snapshot registrato', s && s.old.id === '100' && s.new.id === '200');
  ok('conserva la descrizione vecchia per il ripristino', s.old.description === 'desc vecchia');
  ok('prezzo vecchio come numero', s.old.price === 10 && s.new.price === 9);
  ok('visite accumulate dal vecchio annuncio', s.viewsBefore === 12);
  ok('inventario sposta il vecchio id sul nuovo', !store.inventory['100'] && store.inventory['200']);
  ok('anzianita\u0027 originale conservata', store.inventory['200'].firstSeen === ORA-30*86400000);
  ok('data di ripubblicazione registrata', store.inventory['200'].relistedAt >= ORA);

  // secondo relist: chiude la misura del primo prima di perderne la serie
  store.inventory['200'].series = [[s.at, 0], [s.at + 47*3600000, 25]];
  await window.__snap('200', { title:'Vecchio', description:'d', price:{amount:'9'} }, { title:'Vecchio', price:9 }, { id: 300 });
  ok('misura a 48h salvata sul relist precedente', store.vrSnapshots[0].visite48 === 25);
  ok('numerazione progressiva', store.vrSnapshots[1].n === 2);

  console.log(out.join('\n'));
  process.exit(out.some(x=>x.includes('FAIL'))?1:0);
})();
