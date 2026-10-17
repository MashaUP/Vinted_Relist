// Riempimento automatico: deduce dai tuoi articoli, non inventa.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src/relist.js'),'utf8');
const body = src.slice(src.indexOf('(() => {')+8, src.lastIndexOf('})();'));
const VR = { uuid:()=>'u', settings:{}, log(){}, warn(){}, api:{} };
VR.editorLogica = require(require('path').join(__dirname, '..', 'src/editor-logica.js'));
const window = { VR }; global.window = window;
new Function('window', body + '\n; window.__b = buildDraft; window.__p = VR.riempimentiPrevisti;')(window);
const b = window.__b, prev = window.__p;

const art = (extra = {}) => ({
  brand_dto:{id:1,title:"M"}, brand_id:1, catalog_id:3312, currency:"EUR", description:"d",
  id:1, is_unisex:false, isbn:null, item_attributes:[], manufacturer:null,
  manufacturer_labelling:null, measurement_length:null, measurement_width:null,
  package_size_id:2, ai_photo:false, price:{amount:"10.0",currency_code:"EUR"},
  shipment_prices:null, title:"T", color1_id:null, color2_id:null, ...extra,
});

// armadio osservato: 4 DVD grigio+nero, 1 rosso; categoria diversa tutta nera
const stats = {
  1:{c:"3312",v:{color_ids:"3,1",is_unisex:"false",package_size_id:"2"}},
  2:{c:"3312",v:{color_ids:"3,1",is_unisex:"false",package_size_id:"2"}},
  3:{c:"3312",v:{color_ids:"3,1",is_unisex:"false",package_size_id:"2"}},
  4:{c:"3312",v:{color_ids:"3,1",is_unisex:"false",package_size_id:"2"}},
  5:{c:"3312",v:{color_ids:"9",is_unisex:"false",package_size_id:"2"}},
  6:{c:"9999",v:{color_ids:"1",is_unisex:"true",package_size_id:"1"}},
  7:{c:"9999",v:{color_ids:"1",is_unisex:"true",package_size_id:"1"}},
};
VR.settings = { autoFill:true, itemStats:stats, colorMap:{"1":"Nero","3":"Grigio","9":"Rosso"} };

const out=[]; const ok=(n,c)=>out.push(`  ${c?'OK  ':'FAIL'} ${n}`);

let d = b(art(), [1], {});
ok('colore vuoto riempito col prevalente della categoria', JSON.stringify(d.color_ids)==='[3,1]');

d = b(art({catalog_id:9999}), [1], {});
ok('categoria diversa, valore diverso', JSON.stringify(d.color_ids)==='[1]');

d = b(art({color1_id:9}), [1], {});
ok('colore gia\u0027 presente non sovrascritto', JSON.stringify(d.color_ids)==='[9]');

d = b(art(), [1], {colorIds:[7]});
ok('la tua scelta esplicita vince sul riempimento', JSON.stringify(d.color_ids)==='[7]');

VR.settings = {...VR.settings, autoFill:false};
d = b(art(), [1], {});
ok('con l\u0027opzione spenta non riempie', JSON.stringify(d.color_ids)==='[]');
VR.settings = {...VR.settings, autoFill:true};

// una sola osservazione non e' un'abitudine
VR.settings = {...VR.settings, itemStats:{1:{c:"3312",v:{color_ids:"3,1"}}}};
d = b(art(), [1], {});
ok('una sola osservazione non basta', JSON.stringify(d.color_ids)==='[]');

// senza maggioranza netta non sceglie
VR.settings = {...VR.settings, itemStats:{
  1:{c:"3312",v:{color_ids:"3,1"}}, 2:{c:"3312",v:{color_ids:"9"}},
  3:{c:"3312",v:{color_ids:"5"}}, 4:{c:"3312",v:{color_ids:"7"}}}};
d = b(art(), [1], {});
ok('senza un valore nettamente prevalente non sceglie', JSON.stringify(d.color_ids)==='[]');

// campi che non vanno mai toccati
VR.settings = {...VR.settings, itemStats:stats};
d = b(art({isbn:null, measurement_length:null, manufacturer:null}), [1], {});
ok('isbn mai riempito', d.isbn === null);
ok('misure mai riempite', d.measurement_length === null);
ok('produttore mai riempito', d.manufacturer === null);

// package_size si segnala, non si riempie
d = b(art({package_size_id:null}), [1], {});
ok('dimensione pacco non riempita', d.package_size_id === null);
const a = prev(art({package_size_id:null}), {});
ok('dimensione pacco segnalata', a.segnalati.some(x=>/pacco/.test(x)));
ok('anteprima col nome del colore', a.previsti.some(x=>x.testo === 'Grigio e Nero'));

// ai_photo
d = b(art({ai_photo:null}), [1], {});
ok('ai_photo nullo diventa false', d.ai_photo === false);

console.log(out.join('\n'));
process.exit(out.some(x=>x.includes('FAIL'))?1:0);
