// 2.5.0 «Ripubblica da Vintory»: lettore ZIP, validazione del formato, controlli,
// bozza costruita da relist() davvero (con API di Vinted simulate), modello della coda.
// Con VINTORY_ZIP=<file> (o tests/locale/vintory.zip) controlla anche un'esportazione vera.
const fs = require('fs');
const path = require('path');
const Z = require('../src/vintory-zip.js');
const VL = require('../src/vintory-logica.js');
const C = require('../src/coda-logica.js');
const F = require('./vintory-fixture.js');

const out = []; const ok = (n, c, extra = '') => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}${!c && extra ? ` — ${extra}` : ''}`);
const blob = (buf) => new Blob([buf]);
const foto = (n, seme = 0) => Array.from({ length: n }, (_, i) => Buffer.from(`JPEGFINTA-${seme}-${i}-${'x'.repeat(50 + i)}`));
const hex = async (b) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');

(async () => {
  // ------------------------------------------------------------ A. ZIP
  const base = [{ id: '5123456789', foto: foto(3) }];
  for (const deflate of [false, true]) {
    const { zip } = F.esportazione(base, { deflate });
    const voci = await Z.leggi(blob(zip));
    const j = JSON.parse(await voci.get('vintory-relist.json').text());
    const b2 = await voci.get('photos/5123456789/02.jpg').bytes();
    ok(`A${deflate ? 2 : 1}. ZIP ${deflate ? 'deflate' : 'stored'}: indice, JSON e foto letti uguali`, voci.size === 4 && j.format === 'vintory-relist' && Buffer.from(b2).equals(base[0].foto[1]));
  }
  let err = null;
  try { await Z.leggi(blob(Buffer.from('non sono uno zip, solo testo abbastanza lungo'))); } catch (e) { err = e.message; }
  ok('A3. file che non è uno ZIP: errore chiaro', /non è uno ZIP/.test(err || ''));
  const { zip: intero } = F.esportazione(base);
  err = null;
  try { const v = await Z.leggi(blob(intero.subarray(0, intero.length - 30))); err = v.size ? null : 'vuoto'; } catch (e) { err = e.message; }
  ok('A4. ZIP troncato: errore, niente di letto a metà', Boolean(err));
  const pericoloso = F.zip([{ nome: '../fuori.txt', dati: 'x' }, { nome: '/assoluto', dati: 'x' }, { nome: 'a\\b', dati: 'x' }, { nome: 'ok.txt', dati: 'y' }]);
  const vp = await Z.leggi(blob(pericoloso));
  ok('A5. nomi pericolosi (../, /, \\) ignorati', vp.size === 1 && vp.has('ok.txt'));
  ok('A6. crc32 come zlib', Z.crc32(Buffer.from('123456789')) === 0xcbf43926);

  // ------------------------------------------------------------ B. formato
  const P = (j) => VL.leggiPacchetto(j);
  ok('B1. formato e schema 2: accettato', P({ format: 'vintory-relist', schema: 2, listings: [], campoNuovo: 1 }).ok);
  ok('B2. formato diverso: rifiutato', !P({ format: 'altro', schema: 2, listings: [] }).ok);
  ok('B3. backup completo di Vintory: rifiutato, con la strada giusta', /Per Vinted_Relist/.test(P({ format: 'vintory-backup', schema: 1 }).errore));
  ok('B4. schema 3: «aggiorna Vinted_Relist»', /aggiorna Vinted_Relist/.test(P({ format: 'vintory-relist', schema: 3, listings: [] }).errore));
  ok('B5. schema 1 (Vintory 1.0.x): non supportato, «aggiorna Vintory»', /aggiorna Vintory/.test(P({ format: 'vintory-relist', schema: 1, listings: [] }).errore));
  ok('B6. senza elenco di annunci: rifiutato', !P({ format: 'vintory-relist', schema: 2 }).ok && !P(null).ok && !P([]).ok);

  // ------------------------------------------------------------ C. controlli per annuncio
  const ctx = (extra = {}) => ({ nomi: new Set(['photos/1/01.jpg', 'photos/1/02.jpg']), userId: '77', registro: {}, coda: null, archivio: [], ...extra });
  const l = (o = {}) => F.annuncio({ id: '1', foto: foto(2), ...o });
  let v = VL.valuta(l(), ctx());
  ok('C1. annuncio completo e tuo: nessun blocco', !v.blocchi.length && v.foto.length === 2 && v.prezzo === 5, v.blocchi.join(' | '));
  ok('C2. sellerId di un altro account: bloccato', /altro account/.test(VL.valuta(l({ seller: '99' }), ctx()).blocchi.join()));
  ok('C3. account non riconosciuto: bloccato (nel dubbio, niente)', /non riconosciuto/.test(VL.valuta(l(), ctx({ userId: null })).blocchi.join()));
  ok('C4. sellerId mancante: bloccato', /non sa di chi/.test(VL.valuta({ ...l(), sellerId: null }, ctx()).blocchi.join()));
  ok('C5. uploadDraft nullo: bloccato, con cosa fare', /Aggiorna da Vinted/.test(VL.valuta(l({ draft: false }), ctx()).blocchi.join()));
  ok('C6. foto elencata ma assente nello ZIP: bloccato', /mancante nello ZIP/.test(VL.valuta(l(), ctx({ nomi: new Set(['photos/1/01.jpg']) })).blocchi.join()));
  const fuori = l(); fuori.photos[0].file = 'photos/2/01.jpg';
  ok('C7. foto in una cartella di un altro annuncio: bloccato', /percorso non valido/.test(VL.valuta(fuori, ctx()).blocchi.join()));
  const senzaSha = l(); senzaSha.photos[1].sha256 = '';
  ok('C8. foto senza sha256: bloccato', /sha256/.test(VL.valuta(senzaSha, ctx()).blocchi.join()));
  ok('C9. foto mancanti nell\'archivio di Vintory: avviso, non blocco', (() => { const x = VL.valuta(l({ photosMissing: 2 }), ctx()); return !x.blocchi.length && /2 foto non erano/.test(x.avvisi.join()); })());
  v = VL.valuta(l({ edited: ['price', 'brand', 'condition'] }), ctx());
  ok('C10. marca e condizioni cambiate in Vintory: avviso (id originale), prezzo no', v.campiCambiati.join() === 'brand,condition' && v.avvisi.filter((a) => /Vinted riceve quella dell'annuncio originale/.test(a)).length === 2 && !v.blocchi.length);
  ok('C11. venduto secondo Vintory: bloccato', /Venduto/.test(VL.valuta(l({ online: 'sold' }), ctx()).blocchi.join()));
  ok('C12. id del modulo diverso dall\'annuncio: bloccato', (() => { const x = l(); x.uploadDraft.id = 2; return /incoerenti/.test(VL.valuta(x, ctx()).blocchi.join()); })());
  ok('C13. senza foto: bloccato', /Nessuna foto/.test(VL.valuta(F.annuncio({ id: '1', foto: [] }), ctx()).blocchi.join()));

  // decisioni con lo stato su Vinted
  v = VL.valuta(l(), ctx());
  const D = (stato, o) => VL.decidi(v, VL.statoVinted(stato), o);
  ok('D1. non più su Vinted: selezionabile e già spuntato, senza eliminare', D({ esito: 'assente' }).preselezionato && D({ esito: 'assente' }).elimina === false);
  ok('D2. ancora online: escluso di default, con «usa Ripubblica normale»', !D({ esito: 'online' }).selezionabile && /Ripubblica/.test(D({ esito: 'online' }).motivo));
  ok('D3. ancora online con la copia di Vintory: selezionabile, non spuntato da solo, elimina il vecchio', D({ esito: 'online' }, { copia: true }).selezionabile && !D({ esito: 'online' }, { copia: true }).preselezionato && D({ esito: 'online' }, { copia: true }).elimina);
  ok('D4. venduto su Vinted: escluso', !D({ esito: 'venduto' }).selezionabile);
  ok('D5. stato non chiaro o non controllato: escluso', !D({ esito: 'ignoto' }).selezionabile && !D(null).selezionabile && /scheda di Vinted/.test(D(null).motivo));
  const vc = VL.valuta(l({ edited: ['category'] }), ctx());
  ok('D6. categoria cambiata a mano: selezionabile ma non spuntato da solo', VL.decidi(vc, { esito: 'assente' }).selezionabile && !VL.decidi(vc, { esito: 'assente' }).preselezionato);
  const vg = VL.valuta(l(), ctx({ registro: { 1: { nuovoId: '555', at: Date.UTC(2026, 10, 10) } } }));
  const dg = VL.decidi(vg, { esito: 'assente' });
  ok('D7. già ripubblicato da Vintory: «già ripubblicato il …», non spuntato, serve «di nuovo»', vg.gia?.nuovoId === '555' && !dg.preselezionato && dg.serveAncora && /Già ripubblicato il/.test(dg.motivo));
  ok('    con «ripubblica di nuovo»: selezionabile', VL.decidi(vg, { esito: 'assente' }, { ancora: true }).selezionabile && !VL.decidi(vg, { esito: 'assente' }, { ancora: true }).serveAncora);
  const coda = C.nuova({ items: [{ id: '1', title: 'x', price: 1 }], intervalMin: 20 }).coda;
  ok('D8. già in coda: escluso', /già in coda/.test(VL.decidi(VL.valuta(l(), ctx({ coda })), { esito: 'assente' }).motivo));
  ok('D9. da verificare in una sessione passata: escluso', /da verificare/.test(VL.valuta(l(), ctx({ archivio: [{ items: [{ id: '1', status: 'verify' }] }] })).inCoda || ''));

  // sorgente per relist()
  const s = VL.sorgente(l({ titolo: 'Titolo di Vintory', prezzo: 4 }));
  ok('S1. vincono titolo, descrizione e prezzo di Vintory', s.title === 'Titolo di Vintory' && s.description === 'Descrizione di Titolo di Vintory' && s.price.amount === '4');
  ok('S2. restano gli id di Vinted (categoria, condizioni in item_attributes, ISBN)', s.catalog_id === 2319 && s.item_attributes[0].ids[0] === 2 && s.isbn === '9781529095258' && s.status_id === undefined);
  ok('S3. niente foto vecchie, niente stato del vecchio annuncio; proprietario dichiarato', !('photos' in s) && !('is_draft' in s) && !('can_push_up' in s) && s.user_id === '77');

  // impronta, chiave, riferimento
  const k1 = VL.chiave('1', await hex(new TextEncoder().encode(VL.testoImpronta(l()))));
  ok('K1. chiave dell\'importazione: id + impronta delle foto', VL.CHIAVE.test(k1) && k1.startsWith('vintory:1:'));
  ok('K2. riferimento da fuori: pulito, chiave sbagliata scartata', VL.pulisciRiferimento({ chiave: k1, elimina: 'si', foto: 3 }).elimina === false && VL.pulisciRiferimento({ chiave: 'vintory:1:zz' }) === null && VL.pulisciRiferimento(null) === null);

  // ------------------------------------------------------------ R. registro e pulizia delle foto
  const ora = Date.UTC(2026, 10, 14);
  let reg = VL.registra({}, { oldId: '1', nuovoId: '900', at: ora, chiave: k1 });
  ok('R1. registro: id originale → nuovo, data, impronta', reg['1'].nuovoId === '900' && reg['1'].at === ora && reg['1'].impronta === k1.split(':')[2]);
  ok('R2. stessa pubblicazione due volte: una voce sola', VL.registra(reg, { oldId: '1', nuovoId: '900' })['1'].volte === 1);
  const q = { items: [
    { id: '1', status: 'done', nuovoId: '900', vintory: { chiave: k1 } },
    { id: '2', status: 'pending', vintory: { chiave: 'vintory:2:0000000000000000' } },
    { id: '3', status: 'error', sicuro: 'no', vintory: { chiave: 'vintory:3:0000000000000000' } },
    { id: '4', status: 'error', sicuro: 'si', vintory: { chiave: 'vintory:4:0000000000000000' } },
    { id: '5', status: 'removed', vintory: { chiave: 'vintory:5:0000000000000000' } },
    { id: '6', status: 'verify', nuovoId: '906', vintory: { chiave: 'vintory:6:0000000000000000' } },
    { id: '7', status: 'skipped', vintory: { chiave: 'vintory:7:0000000000000000' } },
  ] };
  const tieni = VL.daConservare(q, [{ finishedAt: ora - 86400e3, items: [{ id: '8', status: 'interrupted', vintory: { chiave: 'vintory:8:0000000000000000' } }] },
    { finishedAt: ora - 40 * 86400e3, items: [{ id: '9', status: 'interrupted', vintory: { chiave: 'vintory:9:0000000000000000' } }] }], ora);
  ok('R3. foto tenute: in attesa, riprovabili, da verificare, sessione recente riprendibile', ['2', '4', '6', '8'].every((i) => tieni.has(`vintory:${i}:0000000000000000`)));
  ok('R4. foto cancellate: pubblicato, rimosso, saltato, fallito senza rimedio, sessione vecchia', !tieni.has(k1) && ['3', '5', '7', '9'].every((i) => !tieni.has(`vintory:${i}:0000000000000000`)));
  const elenco = [{ chiave: k1, at: ora - 3600e3 }, { chiave: 'vintory:2:0000000000000000', at: ora - 3600e3 }, { chiave: 'vintory:10:0000000000000000', at: ora - 60e3 }];
  ok('R5. un\'importazione appena salvata (non ancora in coda) non si cancella', VL.daCancellare(elenco, tieni, ora).join() === k1);
  const appena = [{ chiave: k1, at: ora - 1000 }, { chiave: 'vintory:10:0000000000000000', at: ora - 1000 }];
  ok('R5b. pubblicato subito dopo l\'aggiunta: le sue foto si cancellano subito, quelle non ancora in coda no', VL.daCancellare(appena, tieni, ora, VL.nominate(q, [])).join() === k1);
  ok('R6. registro: pubblicati e da verificare con l\'id nuovo', VL.pubblicati(q).map((x) => x.oldId).join() === '1,6');

  // ------------------------------------------------------------ Q. modello della coda
  const { coda: cq } = C.nuova({ items: [{ id: '1', title: 'a', price: 3, vintory: { chiave: k1, elimina: false, foto: 2, extra: 'x' } }, { id: '2', title: 'b', price: 3 }] });
  ok('Q1. l\'articolo in coda porta il riferimento a Vintory (pulito)', cq.items[0].vintory?.chiave === k1 && cq.items[0].vintory.extra === undefined && !('vintory' in cq.items[1]));
  const { coda: cr } = C.nuova({ items: [{ id: '1', title: 'a', vintory: { chiave: 'vintory:1:../../x' } }] });
  ok('Q2. riferimento non valido: scartato', !('vintory' in cr.items[0]));
  cq.items[0].status = 'error'; cq.items[0].sicuro = 'si';
  C.aggiungi(cq, [{ id: '1', title: 'a' }], { batch: { overrides: null, intervalMin: 5 } });
  ok('Q3. rimesso in coda dall\'armadio (senza Vintory): torna normale', cq.items[0].status === 'pending' && !('vintory' in cq.items[0]));
  ok('Q4. archivio: il riferimento resta (per riprendere la sessione)', C.perArchivio({ ...cq, items: [{ ...cq.items[1] }, { id: '3', title: 'c', status: 'cancelled', vintory: { chiave: 'vintory:3:0000000000000000' } }] }).items[1].vintory?.chiave === 'vintory:3:0000000000000000');
  ok('Q5. «ancora online» e dati di Vintory mancanti: definitivi, non da riprovare', C.classificaErrore({ online: true }).sicuroRiprovare === 'no' && C.classificaErrore({ vintory: true }).categoria === 'vintory');

  // ------------------------------------------------------------ P. relist() da Vintory, con API simulate
  const leggi = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const corpo = (t) => t.slice(t.indexOf('(() => {') + 8, t.lastIndexOf('})();'));
  let store = {}; let chiamate = []; let caricati = []; let creato = null; let statoVinted = { esito: 'assente' };
  const importazioni = new Map();
  const chromeFinto = {
    storage: { local: { get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : { ...store }), set: async (o) => Object.assign(store, o), remove: async (k) => { delete store[k]; } } },
    runtime: { sendMessage: async (m) => {
      chiamate.push(m.type);
      if (m.type === 'vr:vintoryDati') { const x = importazioni.get(m.chiave); return x ? { ok: true, id: x.id, sorgente: x.sorgente, foto: x.foto.length } : { ok: false, error: 'Dati di Vintory non più disponibili: riapri il file e rimetti l\'annuncio in coda.' }; }
      if (m.type === 'vr:vintoryFoto') { const b = importazioni.get(m.chiave)?.foto[m.i]; return b ? { ok: true, tipo: 'image/jpeg', base64: b.toString('base64') } : { ok: false }; }
      return {};
    } },
  };
  const docFinto = { createElement: () => { const c = { width: 0, height: 0, getContext: () => ({ set imageSmoothingQuality(_) {}, scale() {}, translate() {}, rotate() {}, drawImage(bm) { c.da = bm.da; } }),
    toBlob: (cb) => { const b = new Blob([new Uint8Array(4096)], { type: 'image/jpeg' }); b.da = c.da; cb(b); } }; return c; } };
  const bitmap = async (b) => ({ width: 800, height: 600, da: Buffer.from(await b.arrayBuffer()).toString(), close() {} });
  const VR = { uuid: () => `u-${Math.random().toString(36).slice(2, 7)}`, settings: { deleteOld: true, order: 'safe', delayMs: 0, userId: '77' }, log() {}, warn() {}, sleep: async () => {} };
  const win = { VR };
  new Function('window', corpo(leggi('editor-logica.js').replace('(function (root) {', '(() => { const root = window;').replace(/\}\)\(typeof window[^\n]*/, '})();')))(win);
  new Function('window', 'chrome', 'createImageBitmap', 'document', corpo(leggi('relist.js')))(win, chromeFinto, bitmap, docFinto);
  VR.api = {
    statoVintory: async () => statoVinted,
    getUploadDraft: async () => { chiamate.push('getUploadDraft'); throw new Error('non dovrebbe leggere la bozza da Vinted'); },
    downloadPhoto: async () => { chiamate.push('downloadPhoto'); throw new Error('non dovrebbe scaricare foto'); },
    uploadPhoto: async (b) => { caricati.push(b.da); return 7000 + caricati.length; },
    createItem: async (d) => { creato = d; chiamate.push('createItem'); return { id: 90001 }; },
    deleteItem: async (id) => { chiamate.push(`deleteItem:${id}`); },
  };
  const fotoP = foto(3, 7);
  const lp = F.annuncio({ id: '5123456789', foto: fotoP, titolo: 'The Atlas Six', prezzo: 4 });
  const kp = VL.chiave(lp.vintedId, 'a'.repeat(16));
  importazioni.set(kp, { id: lp.vintedId, sorgente: VL.sorgente(lp), foto: fotoP });
  const rif = { chiave: kp, elimina: false };
  const r1 = await VR.relist(lp.vintedId, { vintory: rif, priceDelta: 0 }, () => {}, {});
  ok('P1. annuncio eliminato da Vinted: creato, NIENTE eliminato, niente letto da Vinted', r1.id === 90001 && chiamate.includes('createItem') && !chiamate.some((c) => /deleteItem|getUploadDraft|downloadPhoto/.test(c)), chiamate.join());
  ok('P2. foto dallo ZIP, nell\'ordine giusto', caricati.join('|') === fotoP.map(String).join('|') && creato.assigned_photos.map((p) => p.id).join() === '7001,7002,7003');
  ok('P3. bozza: titolo, descrizione e prezzo di Vintory; categoria, condizioni e ISBN dal modulo', creato.title === 'The Atlas Six' && creato.description === 'Descrizione di The Atlas Six' && creato.price === 4 && creato.catalog_id === 2319 && creato.item_attributes?.[0]?.ids?.[0] === 2 && creato.isbn === '9781529095258' && creato.id == null);
  chiamate = []; caricati = [];
  await VR.relist(lp.vintedId, { vintory: rif, modo: 'delta', priceDelta: -1, descriptionAppend: 'Spedizione rapida' }, () => {}, {});
  ok('P4. le regole della batch valgono anche da Vintory', creato.description.endsWith('Spedizione rapida'));
  // ancora online
  statoVinted = { esito: 'online' }; chiamate = []; caricati = [];
  err = null;
  try { await VR.relist(lp.vintedId, { vintory: rif }, () => {}, {}); } catch (e) { err = e; }
  ok('P5. ancora online senza la scelta: fermato prima di tutto, niente caricato', err?.online === true && !caricati.length && !chiamate.includes('createItem'));
  chiamate = []; caricati = [];
  await VR.relist(lp.vintedId, { vintory: { ...rif, elimina: true } }, () => {}, {});
  ok('P6. ancora online con la copia di Vintory: pubblica, poi elimina il vecchio (percorso normale)', chiamate.indexOf('createItem') >= 0 && chiamate.indexOf(`deleteItem:${lp.vintedId}`) > chiamate.indexOf('createItem'));
  // venduto
  statoVinted = { esito: 'venduto' }; chiamate = []; caricati = []; err = null;
  try { await VR.relist(lp.vintedId, { vintory: rif }, () => {}, {}); } catch (e) { err = e; }
  ok('P7. venduto: fermato (si salta), niente inviato', err?.venduto === true && !caricati.length && !chiamate.includes('createItem'));
  statoVinted = { esito: 'ignoto', motivo: 'boh' }; err = null; caricati = [];
  try { await VR.relist(lp.vintedId, { vintory: rif }, () => {}, {}); } catch (e) { err = e; }
  ok('P8. stato non chiaro: fermato, niente inviato', Boolean(err) && !caricati.length);
  // proprietario
  statoVinted = { esito: 'assente' }; caricati = []; chiamate = []; err = null;
  const altro = F.annuncio({ id: '42', seller: '99', foto: foto(1) });
  const ka = VL.chiave('42', 'b'.repeat(16));
  importazioni.set(ka, { id: '42', sorgente: VL.sorgente(altro), foto: foto(1) });
  try { await VR.relist('42', { vintory: { chiave: ka } }, () => {}, {}); } catch (e) { err = e; }
  ok('P9. sellerId di un altro account: rifiutato, nessuna richiesta di scrittura', err?.nonTuo === true && !caricati.length && !chiamate.includes('createItem'));
  VR.settings.userId = null; err = null;
  try { await VR.relist(lp.vintedId, { vintory: rif }, () => {}, {}); } catch (e) { err = e; }
  ok('P10. account non riconosciuto: rifiutato', err?.nonTuo === true);
  VR.settings.userId = '77'; err = null;
  try { await VR.relist(lp.vintedId, { vintory: { chiave: VL.chiave(lp.vintedId, 'c'.repeat(16)) } }, () => {}, {}); } catch (e) { err = e; }
  ok('P11. foto non più in IndexedDB: errore definitivo con cosa fare', err?.vintory === true && /riapri il file/.test(err.message) && C.classificaErrore(err).sicuroRiprovare === 'no');
  err = null;
  try { await VR.relist('999', { vintory: rif }, () => {}, {}); } catch (e) { err = e; }
  ok('P12. dati di un altro annuncio: rifiutato', /non corrispondono/.test(err?.message || ''));
  caricati = []; chiamate = [];
  let permesso = null;
  await VR.relist(lp.vintedId, { vintory: rif }, () => {}, { oltre: async (info) => { permesso = info; } });
  ok('P13. il permesso del service worker arriva prima dell\'invio, senza eliminare', permesso?.eliminaVecchio === false && permesso.fotoIds.length === 3);

  // ------------------------------------------------------------ V. esportazione vera (facoltativa)
  const vero = process.env.VINTORY_ZIP || path.join(__dirname, 'locale', 'vintory.zip');
  if (fs.existsSync(vero)) {
    const file = await fs.openAsBlob(vero);
    const voci = await Z.leggi(file);
    const p = VL.leggiPacchetto(JSON.parse(await voci.get('vintory-relist.json').text()));
    const seller = String(p.annunci[0]?.sellerId);
    const nomi = new Set(voci.keys());
    const valutati = p.annunci.map((x) => VL.valuta(x, { nomi, userId: seller }));
    let fotoOk = 0; let fotoTot = 0;
    for (const x of valutati) for (const f of x.foto) { fotoTot++; if ((await hex(await voci.get(f.file).bytes())) === f.sha256) fotoOk++; }
    ok(`V1. esportazione vera (${p.app}): ${p.annunci.length} annunci letti, formato e schema validi`, p.ok && p.annunci.length > 0);
    ok(`V2. tutte le ${fotoTot} foto hanno lo sha256 giusto`, fotoTot > 0 && fotoOk === fotoTot, `${fotoOk}/${fotoTot}`);
    ok('V3. nessun annuncio bloccato con il suo account', valutati.every((x) => !x.blocchi.length), valutati.filter((x) => x.blocchi.length).map((x) => `${x.id}: ${x.blocchi[0]}`).slice(0, 3).join(' | '));
    ok('V4. con un altro account: tutti bloccati', p.annunci.every((x) => VL.valuta(x, { nomi, userId: '1' }).blocchi.length));
    // bozza di ognuno con relist() vero: campi del modulo intatti
    VR.settings.userId = seller; statoVinted = { esito: 'assente' };
    let bozzeOk = 0; const diff = [];
    for (const x of p.annunci) {
      const k = VL.chiave(x.vintedId, 'd'.repeat(16));
      const fv = [];
      for (const f of x.photos) fv.push(Buffer.from(await voci.get(f.file).bytes()));
      importazioni.set(k, { id: x.vintedId, sorgente: VL.sorgente(x), foto: fv });
      caricati = []; creato = null;
      await VR.relist(x.vintedId, { vintory: { chiave: k } }, () => {}, {});
      const u = x.uploadDraft;
      const attesi = [creato.title === x.title, creato.price === Number(x.price), creato.catalog_id === u.catalog_id, JSON.stringify(creato.item_attributes) === JSON.stringify(u.item_attributes),
        creato.package_size_id === u.package_size_id, (creato.brand_id ?? null) === (u.brand_id ?? u.brand_dto?.id ?? null), creato.assigned_photos.length === x.photos.length, creato.description === x.description];
      if (attesi.every(Boolean)) bozzeOk++; else diff.push(`${x.vintedId}:${attesi.map((a) => (a ? 1 : 0)).join('')}`);
      importazioni.delete(k);
    }
    ok(`V5. bozza di tutti i ${p.annunci.length} annunci veri: titolo, prezzo, descrizione, categoria, condizioni, marca, imballo, numero di foto`, bozzeOk === p.annunci.length, diff.slice(0, 4).join(' '));
  } else {
    out.push('  -    V. esportazione vera: saltata (imposta VINTORY_ZIP)');
  }

  console.log(out.join('\n'));
  const ko = out.filter((x) => x.includes('FAIL')).length;
  console.log(`${out.filter((x) => x.includes(' OK ')).length} OK, ${ko} FAIL`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
