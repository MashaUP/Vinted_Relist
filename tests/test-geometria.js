// Geometria di rotazione e ritaglio: si verifica mappando gli angoli dell'output.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src/relist.js'),'utf8');
const body = src.slice(src.indexOf('(() => {')+8, src.lastIndexOf('})();'));
const VR = { uuid:()=>'u', settings:{}, log(){}, warn(){}, api:{} };
VR.editorLogica = require(require('path').join(__dirname, '..', 'src/editor-logica.js'));
const window = { VR }; global.window = window;
global.chrome = { storage: { local: { get: async()=>({}), set: async()=>{} } } };
new Function('window', body)(window);
const G = VR.geometria;

const out=[]; const ok=(n,c)=>out.push(`  ${c?'OK  ':'FAIL'} ${n}`);

/** Punto dell'immagine originale che finisce nel pixel (px,py) dell'output: la trasformazione inversa del canvas. */
function sorgenteDi(px, py, bw, bh, g) {
  // inverso di: scale → translate(-ox,-oy) → translate(W/2,H/2) → rotate(r) → drawImage(-bw/2,-bh/2)
  let x = px / g.scala + g.ox - g.W / 2;
  let y = py / g.scala + g.oy - g.H / 2;
  const a = -g.r * Math.PI / 180;
  const rx = x * Math.cos(a) - y * Math.sin(a);
  const ry = x * Math.sin(a) + y * Math.cos(a);
  return [Math.round(rx + bw / 2), Math.round(ry + bh / 2)];
}
const vicino = (a, b) => Math.abs(a[0]-b[0]) <= 1 && Math.abs(a[1]-b[1]) <= 1;

// foto 1200x800, nessuna modifica
let g = G(1200, 800, { maxSide: 1600 });
ok('senza modifiche: stesse dimensioni', g.larghezza === 1200 && g.altezza === 800);
ok('angolo in alto a sinistra resta li’', vicino(sorgenteDi(0,0,1200,800,g), [0,0]));

// rotazione 90°: diventa verticale, e l'alto-sinistra dell'output viene dal basso-sinistra
g = G(1200, 800, { rotate: 90, maxSide: 1600 });
ok('90°: 800x1200', g.larghezza === 800 && g.altezza === 1200);
ok('90° orario: alto-sinistra ← basso-sinistra', vicino(sorgenteDi(0,0,1200,800,g), [0,800]));
ok('90° orario: alto-destra ← alto-sinistra', vicino(sorgenteDi(800,0,1200,800,g), [0,0]));

g = G(1200, 800, { rotate: 180, maxSide: 1600 });
ok('180°: alto-sinistra ← basso-destra', vicino(sorgenteDi(0,0,1200,800,g), [1200,800]));

g = G(1200, 800, { rotate: -90, maxSide: 1600 });
ok('-90° equivale a 270°', g.r === 270 && g.larghezza === 800);
ok('270°: alto-sinistra ← alto-destra', vicino(sorgenteDi(0,0,1200,800,g), [1200,0]));

// ritaglio della meta' destra, senza rotazione
g = G(1200, 800, { crop: { x: .5, y: 0, w: .5, h: 1 }, maxSide: 1600 });
ok('ritaglio meta’ destra: 600x800', g.larghezza === 600 && g.altezza === 800);
ok('ritaglio: alto-sinistra ← centro in alto', vicino(sorgenteDi(0,0,1200,800,g), [600,0]));

// rotazione e ritaglio insieme: il ritaglio e' nello spazio gia' ruotato
g = G(1200, 800, { rotate: 90, crop: { x: 0, y: 0, w: 1, h: .5 }, maxSide: 1600 });
ok('90° + meta’ alta: 800x600', g.larghezza === 800 && g.altezza === 600);
ok('90° + meta’ alta: alto-sinistra ← basso-sinistra', vicino(sorgenteDi(0,0,1200,800,g), [0,800]));

// riduzione al lato massimo dopo il ritaglio
g = G(4000, 3000, { maxSide: 1600 });
ok('riduce al lato massimo', g.larghezza === 1600 && g.altezza === 1200);
g = G(4000, 3000, { crop: { x:0, y:0, w:.25, h:.25 }, maxSide: 1600 });
ok('non ingrandisce un ritaglio piccolo', g.larghezza === 1000 && g.scala === 1);

// ritagli assurdi vengono contenuti
g = G(1000, 1000, { crop: { x: .9, y: .9, w: .5, h: .5 }, maxSide: 1600 });
ok('ritaglio oltre il bordo contenuto nell’immagine', g.ox + g.larghezza / g.scala <= 1000 + 1);
g = G(1000, 1000, { crop: { x: 0, y: 0, w: 0, h: 0 }, maxSide: 1600 });
ok('ritaglio nullo: minimo 5%', g.larghezza === 50);

console.log(out.join('\n'));
process.exit(out.some(x=>x.includes('FAIL'))?1:0);
