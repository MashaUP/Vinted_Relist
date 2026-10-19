// 2.0.1 — Campi che dipendono dalla categoria: is_unisex, colore, formato appreso.
// Libri, manga e abbigliamento non hanno gli stessi requisiti.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src/relist.js'), 'utf8');
const body = src.slice(src.indexOf('(() => {') + 8, src.lastIndexOf('})();'));
const VR = { uuid: () => 'u', settings: {}, log() {}, warn() {}, api: {}, sleep: async () => {} };
VR.editorLogica = require(require('path').join(__dirname, '..', 'src/editor-logica.js'));
const L = VR.editorLogica;
const window = { VR }; global.window = window;
new Function('window', body + '\n; window.__b = buildDraft;')(window);
const b = window.__b;

const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);

const LIBRI = 2320, MANGA = 2330, GIACCHE = 1800, MISTA = 4000;

// Un libro come lo restituisce la lettura: niente is_unisex, niente colore.
const libro = (extra = {}) => ({
  id: 101, catalog_id: LIBRI, title: 'Uno splendido disastro', description: 'Garzanti, condizioni buone',
  brand_dto: { id: 5, title: 'Garzanti' }, price: { amount: '1.5', currency_code: 'EUR' },
  color1_id: null, color2_id: null, package_size_id: 1, isbn: '9788811', item_attributes: [{ code: 'condition', ids: [6] }],
  photos: [{ full_size_url: 'https://images1.vinted.net/a.jpg' }], ...extra,
});
const giacca = (extra = {}) => ({
  id: 201, catalog_id: GIACCHE, title: 'Giacca in denim', description: 'taglia M',
  brand_dto: { id: 9, title: 'Levi' }, price: { amount: '20.0', currency_code: 'EUR' },
  color1_id: null, color2_id: null, is_unisex: false, size_id: 207, status_id: 3, package_size_id: 2,
  photos: [{ full_size_url: 'https://images1.vinted.net/b.jpg' }], ...extra,
});

// Il tuo armadio osservato. Libri: nessuno ha colore o unisex. Giacche: tutte con colore e unisex.
const stats = {
  102: { c: String(LIBRI), v: { package_size_id: '1' } },
  103: { c: String(LIBRI), v: { package_size_id: '1' } },
  104: { c: String(LIBRI), v: { package_size_id: '1' } },
  202: { c: String(GIACCHE), v: { color_ids: '3', is_unisex: 'false', package_size_id: '2' } },
  203: { c: String(GIACCHE), v: { color_ids: '3', is_unisex: 'false', package_size_id: '2' } },
  204: { c: String(GIACCHE), v: { color_ids: '3', is_unisex: 'false', package_size_id: '2' } },
  401: { c: String(MISTA), v: { color_ids: '12' } },
  402: { c: String(MISTA), v: { color_ids: '12' } },
  403: { c: String(MISTA), v: {} },
};
// Il formato unico appreso da una giacca modificata a mano (la causa dei falsi allarmi sui libri).
const formatoGiacca = {
  fields: ['title', 'catalog_id', 'is_unisex', 'size_id', 'status_id', 'color_ids', 'package_size_id'],
  sample: { catalog_id: GIACCHE, is_unisex: false, size_id: 207, status_id: 3, color_ids: [3], package_size_id: 2 },
};
const base = () => ({ autoFill: true, itemStats: stats, colorMap: { 3: 'Blu', 12: 'Bianco' }, itemFormat: formatoGiacca, itemFormats: {} });
VR.settings = base();
VR.api.getUploadDraft = async (id) => ({ ...attuale });
let attuale = libro();
const canary = async (item, o = {}) => { attuale = item; return VR.canary(item.id, o, { foto: false }); };

(async () => {
  // 1-2. booleani conservati
  ok('1. is_unisex: false non viene scartato', b(giacca({ is_unisex: false }), [1]).is_unisex === false);
  ok('2. is_unisex: true viene conservato', b(giacca({ is_unisex: true }), [1]).is_unisex === true);
  ok('   false conta come valore nelle statistiche, non come vuoto', VR.chiaveCampo('is_unisex', { is_unisex: false }) === 'false');
  let righe = VR.diagnosiCampi(giacca({ is_unisex: false }));
  ok('   diagnosi: false conservato, fonte originale', righe.find((r) => r.campo === 'is_unisex').inviato === 'false' && righe.find((r) => r.campo === 'is_unisex').fonte === 'originale');

  // 3. libro: campi facoltativi assenti → nessun avviso, nessun blocco
  let r = await canary(libro());
  ok('3. libro senza is_unisex né colore: pronto, nessun avviso', r.ok && r.avvisi.length === 0);
  ok('   le assenze restano visibili come note', r.note.some((n) => /is_unisex/.test(n)) && r.note.some((n) => /Nessun colore/.test(n)));
  ok('   il formato appreso da una giacca non vale per i libri', r.note.some((n) => /altra categoria/.test(n)) && !r.avvisi.some((a) => /formato appreso/.test(a)));

  // 4. obbligatorio sconosciuto: mai inventato
  VR.settings = { ...base(), itemFormats: { [LIBRI]: { campi: ['title', 'is_unisex'], neutri: [] } } };
  r = await canary(libro());
  const d = b(libro(), [1]);
  ok('4. Vinted lo manda con un valore per questa categoria: avviso di differenza reale', r.avvisi.some((a) => /is_unisex: Vinted lo manda con un valore/.test(a)));
  ok('   …ma il valore non viene inventato', !('is_unisex' in d));
  VR.settings = { ...base(), itemFormats: { [LIBRI]: { campi: ['title', 'is_unisex'], neutri: ['is_unisex'] } } };
  r = await canary(libro());
  ok('   Vinted lo manda vuoto/false per i libri: equivalente, solo nota', r.ok && !r.avvisi.some((a) => /is_unisex/.test(a)) && r.note.some((n) => /is_unisex: Vinted lo manda vuoto/.test(n)));
  VR.settings = base();

  // 5. colore assente senza prove resta assente
  ok('5. libro: color_ids resta [] (nessun libro ha colore)', JSON.stringify(b(libro(), [1]).color_ids) === '[]');

  // 6. colore dedotto finisce nel payload
  const gd = b(giacca({ is_unisex: undefined }), [1]);
  ok('6. giacca senza colore: dedotto e inviato', JSON.stringify(gd.color_ids) === '[3]');
  righe = VR.diagnosiCampi(giacca());
  const rc = righe.find((x) => x.campo === 'color_ids');
  ok('   diagnosi: fonte riempimento, valore nel payload finale', rc.fonte === 'riempimento' && rc.inviato === '[3]' && rc.trasformato === '[]');

  // 7. niente travasi fra categorie
  const g2 = giacca(); delete g2.is_unisex;
  ok('   is_unisex mancante su una giacca: dedotto false dalle altre giacche', b(g2, [1]).is_unisex === false);
  const l2 = b(libro(), [1]);
  ok('7. il libro non prende né colore né unisex dalle giacche', JSON.stringify(l2.color_ids) === '[]' && !('is_unisex' in l2));
  ok('   manga senza articoli osservati: niente riempimento', JSON.stringify(b(libro({ id: 301, catalog_id: MANGA }), [1]).color_ids) === '[]');

  // 8. confronto con il formato appreso
  const formato = { campi: ['is_unisex', 'size_id', 'isbn'], neutri: ['is_unisex'] };
  ok('8. neutro (false/null) → nota', L.campoMancante('is_unisex', formato).livello === 'nota');
  ok('   con valore → avviso', L.campoMancante('size_id', formato).livello === 'avviso');
  ok('   non usato dalla categoria → nota', L.campoMancante('color_ids', formato).livello === 'nota');
  ok('   nessun formato per la categoria → nota', L.campoMancante('is_unisex', null).livello === 'nota');
  ok('   valoreNeutro', [null, undefined, false, '', [], {}].every(L.valoreNeutro) && ![0, true, 'x', [1], { a: 1 }].some(L.valoreNeutro));
  VR.settings = { ...base(), itemFormat: { ...formatoGiacca, sample: { ...formatoGiacca.sample, catalog_id: LIBRI } } };
  ok('   formato unico della stessa categoria (dati precedenti alla 2.0.1): usato, con i neutri', VR.formatoPerCategoria(LIBRI).neutri.includes('is_unisex') && !VR.formatoPerCategoria(LIBRI).neutri.includes('size_id'));
  VR.settings = base();
  ok('   formato unico di un\'altra categoria: ignorato', VR.formatoPerCategoria(LIBRI) === null);

  // 9. conversione completa senza perdite
  const pieno = giacca({
    is_unisex: true, color1_id: 3, color2_id: 12, isbn: null, measurement_length: 10, measurement_width: 5,
    manufacturer: 'X', manufacturer_labelling: 'Y', item_attributes: [{ code: 'a', ids: [1] }],
    domestic_shipment_price: '2.9', promoted: true, view_count: 40,
  });
  const dp = b(pieno, [1]);
  ok('9. nessun campo valido perso', dp.is_unisex === true && dp.size_id === 207 && dp.status_id === 3 && dp.package_size_id === 2 &&
    dp.measurement_length === 10 && dp.manufacturer === 'X' && dp.manufacturer_labelling === 'Y' && dp.isbn === null &&
    dp.item_attributes.length === 1 && JSON.stringify(dp.color_ids) === '[3,12]' && dp.brand === 'Levi' && dp.brand_id === 9 && dp.price === 20);
  ok('   campi di sola lettura esclusi', !('promoted' in dp) && !('view_count' in dp) && !('brand_dto' in dp) && !('color1_id' in dp));
  ok('   id colore non validi scartati, non inviati', JSON.stringify(b(giacca({ color1_id: 'abc', color2_id: -1 }), [1]).color_ids) === '[3]');

  // 10. controllo preventivo e pubblicazione coerenti
  VR.settings = { ...base(), autoFill: false };
  r = await canary(giacca());
  const spento = b(giacca(), [1]);
  ok('10. riempimento spento: né l\'anteprima né l\'invio riempiono', JSON.stringify(spento.color_ids) === '[]' && !r.avvisi.some((a) => /metto/.test(a)) && VR.riempimentiPrevisti(giacca()).previsti.length === 0);
  // 11. requisiti diversi per tipologia
  ok('11. giacca senza colore (riempimento spento): avviso, tutte le giacche ce l\'hanno', r.ok && r.avvisi.some((a) => /tutti gli altri tuoi 3 articoli/.test(a)));
  r = await canary(libro());
  const rm = await canary(libro({ id: 301, catalog_id: MANGA }));
  ok('    libro: nessun avviso; manga: nessun avviso', !r.avvisi.length && !rm.avvisi.length);
  VR.settings = { ...base(), autoFill: true };
  r = await canary(giacca());
  ok('    giacca con riempimento attivo: avviso sul riempimento previsto, non sul colore mancante', r.avvisi.some((a) => /colore vuoto, metto «Blu»/.test(a)) && !r.avvisi.some((a) => /Nessun colore/.test(a)));

  // 12. caso ambiguo: categoria mista
  const mista = libro({ id: 404, catalog_id: MISTA });
  ok('12. categoria mista (2 con colore, 1 senza): nessun colore inventato', JSON.stringify(b(mista, [1]).color_ids) === '[]');
  r = await canary(mista);
  ok('    diagnosi comprensibile: facoltativo, con i numeri', r.ok && !r.avvisi.length && r.note.some((n) => /solo su 2 articoli su 3/.test(n)));

  // Coerenza con il punteggio di completezza
  VR.settings = base();
  const pLibro = VR.punteggio(libro());
  ok('    completezza: a un libro senza colore non si tolgono punti', !pLibro.voci.some((v) => v.testo === 'Colore'));
  ok('    completezza: a una giacca senza colore sì', VR.punteggio(giacca()).voci.some((v) => v.testo === 'Colore' && !v.ok));

  // Diagnosi: niente testi dell'annuncio, solo i campi
  righe = VR.diagnosiCampi(libro());
  ok('    diagnosi senza titolo né descrizione', !JSON.stringify(righe).includes('splendido') && righe.every((x) => 'fonte' in x && 'motivo' in x && 'livello' in x));
  ok('    diagnosi distingue assente da null', righe.find((x) => x.campo === 'is_unisex').originale === '(assente)' && /color1_id=null/.test(righe.find((x) => x.campo === 'color_ids').originale));

  // Editor: stessa regola
  let c = L.controlla({ title: 'Uno splendido disastro', description: 'x'.repeat(60), price: 1.5, colorIds: [], photos: [1, 2, 3] },
    { coloreMancante: true, categoria: VR.categoriaInfo(LIBRI, 101) });
  ok('    editor, libro: nessun avviso sul colore, solo nota', c.ok && !c.avvisi.some((a) => a.campo === 'color') && c.note.some((n) => n.campo === 'color'));
  c = L.controlla({ title: 'Giacca in denim blu', description: 'x'.repeat(60), price: 20, colorIds: [], photos: [1, 2, 3] },
    { coloreMancante: true, categoria: VR.categoriaInfo(GIACCHE, 201) });
  ok('    editor, giacca: avviso sul colore, mai bloccante', c.ok && c.avvisi.some((a) => a.campo === 'color'));

  console.log(out.join('\n'));
  process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
