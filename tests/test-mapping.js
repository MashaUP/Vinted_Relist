// buildDraft sul sorgente di rilascio, con i dati veri dell'articolo Star Wars.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src/relist.js'),'utf8');
const body = src.slice(src.indexOf('(() => {')+8, src.lastIndexOf('})();'));
const VR = { uuid:()=>'u', settings:{}, log(){}, warn(){}, api:{} };
VR.editorLogica = require(require('path').join(__dirname, '..', 'src/editor-logica.js'));
const window = { VR }; global.window = window;
new Function('window', body + '\n; window.__b = buildDraft;')(window);
const b = window.__b;

const source = { ai_photo:false, brand_dto:{id:62370,title:"Star Wars"}, brand_id:62370,
  can_push_up:true, catalog_id:3312, color1_id:3, color2_id:1, currency:"EUR",
  description:"desc", domestic_shipment_price:null, id:9951427282,
  international_shipment_price:null, is_draft:false, is_unisex:false, isbn:null,
  item_attributes:[{a:1}], manufacturer:null, manufacturer_labelling:null,
  measurement_length:null, measurement_width:null, package_size_id:2, photos:[{}],
  price:{amount:"10.0",currency_code:"EUR"}, promoted:false, shipment_prices:null,
  title:"Lotto 4 Busti Star Wars" };

const reali = ["id","currency","temp_uuid","title","description","brand_id","brand","catalog_id",
  "isbn","is_unisex","ai_photo","price","package_size_id","shipment_prices","color_ids",
  "assigned_photos","measurement_length","measurement_width","item_attributes","manufacturer",
  "manufacturer_labelling"];

const out=[]; const ok=(n,c)=>out.push(`  ${c?'OK  ':'FAIL'} ${n}`);
const d = b(source,[111],{});
ok('nessun campo mancante', reali.filter(k=>!(k in d)).length === 0);
ok('nessun campo di troppo', Object.keys(d).filter(k=>!reali.includes(k)).length === 0);
ok('brand da brand_dto', d.brand === "Star Wars");
ok('color_ids da color1/color2', JSON.stringify(d.color_ids) === '[3,1]');
ok('prezzo scalare numerico', d.price === 10 && typeof d.price === 'number');
ok('shipment_prices sempre oggetto', JSON.stringify(d.shipment_prices) === '{"domestic":null,"international":null}');
ok('id azzerato', d.id === null);
ok('niente photos/promoted/brand_dto', !d.photos && !d.promoted && !d.brand_dto);
console.log(out.join('\n'));
process.exit(out.some(x=>x.includes('FAIL'))?1:0);
