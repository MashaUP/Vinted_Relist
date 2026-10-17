// Tutte le modalita' di prezzo e il colore di riserva, sul sorgente di rilascio.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src/relist.js'),'utf8');
const body = src.slice(src.indexOf('(() => {')+8, src.lastIndexOf('})();'));
const VR = { uuid:()=>'u', settings:{}, log(){}, warn(){}, api:{} };
VR.editorLogica = require(require('path').join(__dirname, '..', 'src/editor-logica.js'));
const window = { VR }; global.window = window;
new Function('window', body + '\n; window.__b = buildDraft;')(window);
const b = window.__b;

const base = (prezzo, colori = {}) => ({
  brand_dto:{id:1,title:"Marca"}, brand_id:1, catalog_id:3312, currency:"EUR",
  description:"desc", id:1, is_unisex:false, isbn:null, item_attributes:[],
  manufacturer:null, manufacturer_labelling:null, measurement_length:null,
  measurement_width:null, package_size_id:2, ai_photo:false,
  price:{amount:String(prezzo),currency_code:"EUR"}, shipment_prices:null, title:"T",
  ...colori,
});

const out=[]; const ok=(n,c)=>out.push(`  ${c?'OK  ':'FAIL'} ${n}`);
const p = (prezzo, ov, col) => b(base(prezzo, col), [1], ov).price;

// variazione in euro
ok('-0,50 su 10,00 → 9,50', p(10, {priceDelta:-0.5}) === 9.5);
ok('+1,00 su 10,00 → 11,00', p(10, {priceDelta:1}) === 11);
ok('-0,50 su 3,00 → 2,50', p(3, {priceDelta:-0.5}) === 2.5);
ok('non scende sotto 0,50', p(1, {priceDelta:-5}) === 0.5);
ok('centesimi senza errori di virgola mobile', p(8.1, {priceDelta:0.2}) === 8.3);
ok('delta a zero non tocca niente', p(10, {priceDelta:0}) === 10);

// le altre modalita' restano come prima
ok('percentuale ancora valida', p(10, {pricePercent:-10}) === 9);
ok('prezzo fisso ancora valido', p(10, {price:7.5}) === 7.5);
ok('fisso e delta insieme: 7,50 - 0,50', p(10, {price:7.5, priceDelta:-0.5}) === 7);

// colore di riserva
let d = b(base(10, {color1_id:null, color2_id:null}), [1], {colorIds:[1]});
ok('colore messo dove manca', JSON.stringify(d.color_ids) === '[1]');

d = b(base(10, {color1_id:3, color2_id:1}), [1], {colorIds:[9]});
ok('colore esistente non sovrascritto', JSON.stringify(d.color_ids) === '[3,1]');

d = b(base(10, {color1_id:null, color2_id:null}), [1], {});
ok('senza opzione resta vuoto', JSON.stringify(d.color_ids) === '[]');

console.log(out.join('\n'));
process.exit(out.some(x=>x.includes('FAIL'))?1:0);
