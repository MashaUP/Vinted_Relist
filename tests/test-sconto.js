// buildDraft con le modifiche in blocco, sui dati veri dell'articolo Star Wars.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src/relist.js'),'utf8');
const body = src.slice(src.indexOf('(() => {')+8, src.lastIndexOf('})();'));
const VR = { uuid: () => 'u', settings: {}, log(){}, warn(){}, api:{} };
VR.editorLogica = require(require('path').join(__dirname, '..', 'src/editor-logica.js'));
const window = { VR }; global.window = window;
new Function('window', body + '\n; window.__b = buildDraft;')(window);
const b = window.__b;

const source = { brand_dto:{id:62370,title:"Star Wars"}, brand_id:62370, catalog_id:3312,
  color1_id:3, color2_id:1, currency:"EUR", description:"Descrizione originale.", id:1,
  is_unisex:false, isbn:null, item_attributes:[], manufacturer:null, manufacturer_labelling:null,
  measurement_length:null, measurement_width:null, package_size_id:2, ai_photo:false,
  price:{amount:"10.0",currency_code:"EUR"}, shipment_prices:null, title:"Lotto Star Wars" };

const out=[]; const ok=(n,c)=>out.push(`  ${c?'OK  ':'FAIL'} ${n}`);

let d = b(source,[1],{});
ok('senza opzioni il prezzo resta 10', d.price === 10);

d = b(source,[1],{ pricePercent: -10 });
ok('-10% su 10,00 → 9,00', d.price === 9);

d = b(source,[1],{ pricePercent: -15 });
ok('-15% su 10,00 → 8,50', d.price === 8.5);

d = b(source,[1],{ pricePercent: -99 });
ok('mai sotto il minimo di 0,50', d.price === 0.5);

d = b(source,[1],{ price: 7.5, pricePercent: -20 });
ok('prezzo fisso poi percentuale → 6,00', d.price === 6);

d = b(source,[1],{ descriptionAppend: "#starwars #collezionismo" });
ok('riga aggiunta in fondo', d.description === "Descrizione originale.\n#starwars #collezionismo");
ok('descrizione originale intatta', d.description.startsWith("Descrizione originale."));

d = b(source,[1],{ pricePercent: 0 });
ok('percentuale a zero non tocca niente', d.price === 10);

console.log(out.join('\n'));
process.exit(out.some(x=>x.includes('FAIL'))?1:0);
