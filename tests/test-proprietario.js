// 2.3.0 — Bottoni e azioni solo nel tuo armadio (src/content.js, src/relist.js).
const fs = require('fs');
const path = require('path');
const leggi = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);
const calma = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// DOM minimo: card con link agli articoli, barre che si possono togliere
let pagina = { edit: false, cards: [] };
const tolti = [];
const nodo = (classe) => ({ classList: { contains: (c) => c === classe }, remove() { tolti.push(classe); }, dataset: {} });
let barre = [];
global.document = {
  body: { append() {} },
  querySelector: (sel) => (/\/edit"]$/.test(sel) && pagina.edit ? {} : null),
  querySelectorAll: (sel) => {
    if (sel.startsWith('.vr-bar')) return barre;
    if (sel === 'a[href*="/items/"]') return pagina.cards;
    return [];
  },
  getElementById: () => null,
};
global.location = { pathname: '/', origin: 'https://www.vinted.it', href: 'https://www.vinted.it/' };
global.MutationObserver = class { observe() {} };
const scritte = [];
const ascolto = [];
const cambi = [];
// ridisegno come dopo un cambio della pagina (qui: un aggiornamento dell'account in memoria)
const ridisegna = async () => { for (const f of cambi) f({ userId: { newValue: VR.settings.userId } }, 'local'); await new Promise((r) => setTimeout(r, 300)); };
global.chrome = {
  storage: { local: { get: async () => ({}), set: async (o) => scritte.push(o) }, onChanged: { addListener: (f) => cambi.push(f) } },
  runtime: { onMessage: { addListener: (f) => ascolto.push(f) }, getManifest: () => ({ version: '2.3.1' }), sendMessage: async () => ({ ok: true }) },
};
let cookie = null;
let benvenuto = 0;
const costruite = [];
const VR = {
  settings: { userId: '77', vintedOrigin: 'https://www.vinted.it' },
  loadSettings: async () => VR.settings,
  cookie: () => cookie,
  h: () => ({ append() {}, dataset: {} }),
  buildActionBar: (id) => { costruite.push(id); return { classList: { add() {} }, addEventListener() {} }; },
  showOnboarding: () => { benvenuto++; },
  selection: { nessuno: () => { VR.svuotate = (VR.svuotate || 0) + 1; } },
  log() {}, warn() {}, BUILD: '2.3.1',
};
global.window = { VR, addEventListener() {}, postMessage() {} };
const corpo = leggi('content.js');
const timer = global.setInterval;
global.setInterval = () => 0;                     // il controllo dell'indirizzo lo facciamo a mano
new Function('window', 'chrome', 'document', 'location', 'MutationObserver', corpo.slice(corpo.indexOf('(async () => {'), corpo.lastIndexOf('})();') + 5))(global.window, chrome, document, location, MutationObserver);
global.setInterval = timer;

const vai = (p) => { location.pathname = p; location.href = `https://www.vinted.it${p}`; };
const card = (id) => {
  const c = { dataset: {}, nextElementSibling: null, closest: () => c, querySelectorAll: () => [1], insertAdjacentElement() {}, getAttribute: () => `/items/${id}-x`, innerText: '', textContent: '' };
  c.getAttribute = (a) => (a === 'href' ? `/items/${id}-x` : null);
  c.closest = () => c;
  return c;
};

(async () => {
  await calma();
  const tipo = () => VR.contesto().tipo;
  vai('/member/77-andrea');
  ok('1. il tuo armadio (indirizzo e account coincidono)', tipo() === 'armadio-mio' && VR.nelMioArmadio());
  vai('/member/88-altro');
  ok('2. l\'armadio di un altro: niente', tipo() === 'armadio-altrui' && !VR.nelMioArmadio());
  vai('/member/77-andrea/favourites');
  ok('3. sottopagine del tuo profilo (preferiti: articoli di altri): niente', tipo() === 'profilo-sezione');
  vai('/catalog?search_text=libri');
  ok('4. ricerca e catalogo: niente', tipo() === 'altro');
  vai('/items/555-libro');
  pagina.edit = false;
  ok('5. pagina di un annuncio senza il link di modifica: non è tuo', tipo() === 'articolo' && !VR.puoAgireSu('555'));
  pagina.edit = true;
  ok('   con il link di modifica di Vinted e il tuo account: tuo', tipo() === 'articolo-mio' && VR.puoAgireSu('555') && !VR.puoAgireSu('556'));
  pagina.edit = false;
  VR.settings.userId = null;
  vai('/member/77-andrea');
  ok('6. account non riconosciuto: nel dubbio niente, anche nel tuo armadio', tipo() === 'armadio-incerto' && !VR.nelMioArmadio());
  VR.settings.userId = '77';
  VR.settings.vintedOrigin = 'https://www.vinted.fr';
  ok('   account riconosciuto su un altro dominio Vinted: niente', tipo() === 'armadio-incerto');
  VR.settings.vintedOrigin = 'https://www.vinted.it';
  cookie = '88';
  ok('   il cookie dice un altro account: vale il cookie', tipo() === 'armadio-altrui');
  cookie = null;

  // Barre: costruite solo nel tuo armadio, tolte quando cambi pagina
  pagina.cards = [card('101'), card('102')];
  costruite.length = 0;
  vai('/member/88-altro');
  await ridisegna();
  ok('7. nell\'armadio altrui non si costruisce nessuna barra', costruite.length === 0);
  vai('/member/77-andrea');
  await ridisegna();
  ok('   nel tuo sì, una per articolo, e il benvenuto solo qui', costruite.join() === '101,102' && benvenuto === 1);
  barre = [nodo('vr-bar'), nodo('vr-bar')];
  tolti.length = 0;
  const prima = VR.svuotate || 0;
  vai('/member/88-altro');
  await ridisegna();
  ok('8. dal tuo armadio a quello di un altro (senza ricaricare): barre tolte, selezione svuotata', tolti.length >= 2 && (VR.svuotate || 0) > prima);
  vai('/member/77-andrea'); await ridisegna();
  ok('   e tornando nel tuo le barre si rifanno', costruite.length >= 2);

  // La pagina non scrive più chi sei: lo fa solo il service worker, dal cookie
  ok('9. la pagina non scrive id utente né dominio', !scritte.some((o) => 'userId' in o || 'vintedOrigin' in o));

  // ping della diagnostica
  let risposta = null;
  for (const f of ascolto) f({ type: 'vr:ping' }, {}, (x) => { if (x) risposta = x; });
  ok('10. la diagnostica sa che codice e che tipo di pagina, senza indirizzo né id', risposta?.build === '2.3.1' && risposta.pagina === 'armadio-mio' && !JSON.stringify(risposta).includes('77'));

  // relist(): controllo di proprietà dentro la funzione comune a bottone e coda
  const VR2 = { uuid: () => 'u', settings: { userId: '77' }, log() {}, warn() {}, sleep: async () => {}, editorLogica: require(path.join(__dirname, '..', 'src/editor-logica.js')) };
  const rel = leggi('relist.js');
  new Function('window', 'chrome', rel.slice(rel.indexOf('(() => {') + 8, rel.lastIndexOf('})();')))({ VR: VR2 }, { storage: { local: { set: async () => {}, remove: async () => {}, get: async () => ({}) } }, runtime: { sendMessage: async () => ({}) } });
  const prova = (src, opz) => { try { VR2.controllaProprieta(src, opz); return 'ok'; } catch (e) { return e.nonTuo ? 'no' : 'errore'; } };
  ok('11. annuncio con proprietario diverso: bloccato', prova({ user_id: 88 }) === 'no');
  ok('    tuo: ok; dalla lettura per la pubblicazione senza proprietario: ok (Vinted la dà solo a te)', prova({ user_id: 77 }) === 'ok' && prova({}) === 'ok');
  ok('    dalla scheda pubblica senza proprietario o senza sapere chi sei: bloccato', prova({}, { pubblica: true }) === 'no' && (VR2.settings.userId = null, prova({ user: { id: 77 } }, { pubblica: true })) === 'no');
  VR2.settings.userId = '77';
  let errore = null;
  VR2.api = { getUploadDraft: async () => { throw Object.assign(new Error('403'), { status: 403 }); }, getItem: async () => ({ id: 9, user: { id: 88 }, photos: [{ full_size_url: 'x' }] }), uploadPhoto: async () => { throw new Error('non doveva arrivare qui'); } };
  try { await VR2.relist(9, {}, () => {}, {}); } catch (e) { errore = e; }
  ok('    relist di un annuncio altrui (dalla scheda pubblica): fermato prima di qualunque upload', errore?.nonTuo === true);
  const C = require(path.join(__dirname, '..', 'src/coda-logica.js'));
  ok('    e classificato «non è un tuo annuncio», non riprovabile', C.classificaErrore(errore).sicuroRiprovare === 'no' && /Non è un tuo annuncio/.test(C.classificaErrore(errore).etichetta));

  console.log(out.join('\n'));
  process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
})();
