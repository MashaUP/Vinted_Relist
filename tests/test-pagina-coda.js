// 2.2.0 — Lato pagina (src/queue.js + src/relist.js): giornale del tentativo,
// permesso prima dell'invio, esito ritrasmesso finché il service worker non lo
// riceve, risposta alla sonda, osservazioni per la verifica.
const fs = require('fs');
const path = require('path');
const leggi = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const corpo = (s) => s.slice(s.indexOf('(() => {') + 8, s.lastIndexOf('})();'));
const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);
const calma = (ms = 30) => new Promise((r) => setTimeout(r, ms));

let store = {}, ascolto = [], messaggi = [], risposte = {}, giornali = [];
global.chrome = {
  storage: {
    local: {
      get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : {}),
      set: async (o) => { for (const [k, v] of Object.entries(o)) if (k.startsWith('vrOp:')) giornali.push(JSON.parse(JSON.stringify(v))); Object.assign(store, o); },
      remove: async (k) => { delete store[k]; },
    },
    onChanged: { addListener() {} },
  },
  runtime: {
    onMessage: { addListener: (f) => ascolto.push(f) },
    sendMessage: async (m) => {
      messaggi.push(m);
      const r = risposte[m.type];
      return typeof r === 'function' ? r(m) : r ?? {};
    },
  },
};
const VR = {
  h: () => ({ append() {}, remove() {} }), bars: new Map(), settings: { userId: '77' }, sleep: async () => {},
  toast: Object.assign(() => ({}), { chiudiTutti() {} }), log() {}, warn() {},
  esclusivo: (id, f) => f(), esitoDaErrore: (e) => (e?.incerto ? 'uncertain' : e?.parziale ? 'partial' : 'error'),
  editorLogica: require(path.join(__dirname, '..', 'src/editor-logica.js')),
};
global.window = { VR, CodaLogica: require(path.join(__dirname, '..', 'src/coda-logica.js')) };
global.document = { querySelector: () => null, querySelectorAll: () => [], body: { append() {} } };
new Function('window', 'chrome', 'document', corpo(leggi('queue.js')))(global.window, chrome, document);

const manda = (m) => new Promise((r) => { let risposto = false; for (const f of ascolto) { const asinc = f(m, {}, (x) => { risposto = true; r(x); }); if (asinc === true) return; } if (!risposto) r(undefined); });
const fasi = (id) => giornali.filter((g) => g.id === id).map((g) => g.fase);

(async () => {
  // A. pubblicazione regolare: permesso, giornale in ordine, esito con l'id nuovo
  let dentro = null;
  VR.relist = async (id, overrides, passo, segnale) => {
    passo('Foto 1/2…');
    dentro = await manda({ type: 'vr:relistStatus', itemId: id });
    await segnale.oltre({ fotoIds: ['501'], prezzo: 9, ordine: 'safe', eliminaVecchio: true });
    await segnale.creato('9001');
    return { id: 9001 };
  };
  risposte = { 'vr:relistConfirm': { ok: true }, 'vr:relistDone': { ok: true } };
  await manda({ type: 'vr:relistOne', itemId: '1', avviatoAt: 111, sessione: 100, overrides: { pricePercent: -10 } });
  await calma();
  ok('A. la sonda durante il lavoro risponde «in corso», con il passo', dentro?.inCorso === true && dentro.passo === 'Foto 1/2…');
  ok('   il permesso viene chiesto con le foto caricate e l\'avvio', messaggi.some((m) => m.type === 'vr:relistConfirm' && m.avviatoAt === 111 && m.traccia.fotoIds[0] === '501'));
  ok('   giornale: preparazione → invio → creato → concluso', fasi('1').join() === 'preparazione,invio,creato,concluso');
  ok('   l\'esito c\'è nel giornale prima che parta il messaggio', giornali.find((g) => g.id === '1' && g.fase === 'concluso').esito.nuovoId === '9001');
  ok('   esito mandato con l\'id nuovo e l\'avvio del tentativo', messaggi.some((m) => m.type === 'vr:relistDone' && m.ok && m.nuovoId === '9001' && m.avviatoAt === 111));
  const dopo = await manda({ type: 'vr:relistStatus', itemId: '1' });
  ok('   a lavoro finito la sonda risponde «non in corso»', dopo?.inCorso === false);

  // B. 2.3: ogni no ha il suo motivo. Fino alla 2.2 un errore interno del
  // service worker o una risposta vuota diventavano «permesso negato».
  const tenta = async (id, risposta) => {
    messaggi = []; let creato = false;
    VR.relist = async (i, o, passo, segnale) => { await segnale.oltre({}); creato = true; return { id: 1 }; };
    risposte = { 'vr:relistConfirm': risposta, 'vr:relistDone': { ok: true } };
    await manda({ type: 'vr:relistOne', itemId: id, avviatoAt: 222 }); await calma(80);
    return { creato, esito: messaggi.find((m) => m.type === 'vr:relistDone'), chieste: messaggi.filter((m) => m.type === 'vr:relistConfirm').length };
  };
  let t = await tenta('2', { ok: false, codice: 'non-in-lavorazione', motivo: "l'articolo non è più quello in lavorazione" });
  ok('B1. no con motivo: niente inviato, il motivo vero (non «permesso negato»)', !t.creato && t.esito.outcome === 'interrupted' && /non è più quello in lavorazione/.test(t.esito.error) && !/permesso negato/.test(t.esito.error) && t.chieste === 1);
  t = await tenta('3', { ok: false, codice: 'annullato', annullato: true, motivo: 'hai chiesto di annullarlo' });
  ok('B2. annullamento chiesto da te: «Annullato»', !t.creato && t.esito.outcome === 'cancelled' && t.esito.categoria === 'annullato');
  t = await tenta('4', () => null);
  ok('B3. risposta vuota: ripetuta 4 volte, poi «Interrotto» con il motivo esatto', !t.creato && t.chieste === 4 && t.esito.outcome === 'interrupted' && t.esito.categoria === 'comunicazione' && /senza un esito/.test(t.esito.error));
  let giri = 0;
  t = await tenta('5', () => (++giri === 1 ? { ok: false, codice: 'interno', tecnico: true, ritentabile: true, motivo: 'errore interno del service worker (QUOTA_BYTES quota exceeded)' } : { ok: true }));
  ok('B4. errore interno ritentabile: ripetuto, e al secondo giro si pubblica', t.creato && t.chieste === 2 && t.esito.ok);
  giri = 0;
  t = await tenta('6', () => ({ ok: false, codice: 'salvataggio', tecnico: true, ritentabile: true, motivo: 'il service worker non riesce a salvare la coda (QUOTA_BYTES quota exceeded); spazio usato 9.99 MB su 10.00 MB' }));
  ok('B5. salvataggio sempre fallito: «Interrotto» con causa e spazio usato', !t.creato && t.chieste === 4 && t.esito.categoria === 'comunicazione' && /QUOTA_BYTES/.test(t.esito.error) && /spazio usato/.test(t.esito.error));
  t = await tenta('7', () => { throw new Error('Extension context invalidated.'); });
  ok('B6. estensione ricaricata: una sola richiesta, «ricarica la scheda»', !t.creato && t.chieste === 1 && /ricarica la scheda di Vinted/.test(t.esito.error));
  t = await tenta('8', () => { throw new Error('Could not establish connection. Receiving end does not exist.'); });
  ok('B7. service worker irraggiungibile: ripetuto, poi il messaggio del browser', !t.creato && t.chieste === 4 && /non risponde \(Could not establish connection/.test(t.esito.error));
  VR.BUILD = '2.3.1';
  t = await tenta('9', { ok: true });
  ok('B8. la richiesta di permesso porta la versione del codice della pagina', messaggi.find((m) => m.type === 'vr:relistConfirm').build === '2.3.1');

  // C. esito ritrasmesso finché non arriva la conferma
  messaggi = [];
  let tentativi = 0;
  VR.relist = async () => ({ id: 9004 });
  risposte = { 'vr:relistDone': () => { tentativi++; if (tentativi < 3) throw new Error('Could not establish connection'); return { ok: true }; } };
  await manda({ type: 'vr:relistOne', itemId: '4', avviatoAt: 444 }); await calma(60);
  ok('C. esito perso due volte: ritrasmesso finché il service worker lo conferma', tentativi === 3);

  // D. pubblicato ma vecchio non eliminato: l'id nuovo viaggia con l'esito parziale
  messaggi = [];
  VR.relist = async (id, o, p, segnale) => { await segnale.oltre({}); await segnale.creato('9005'); const e = new Error('Nuovo annuncio pubblicato, ma il vecchio non è stato eliminato'); e.parziale = true; e.nuovoId = '9005'; throw e; };
  risposte = { 'vr:relistConfirm': { ok: true }, 'vr:relistDone': { ok: true } };
  await manda({ type: 'vr:relistOne', itemId: '5', avviatoAt: 555 }); await calma();
  const e5 = messaggi.find((m) => m.type === 'vr:relistDone');
  ok('D. esito parziale con l\'id del nuovo annuncio', e5.outcome === 'partial' && e5.nuovoId === '9005');

  // E. osservazioni per la verifica (relist.js): foto, id nuovo, limiti
  const VR2 = { uuid: () => 'u', settings: { userId: '77' }, log() {}, warn() {}, sleep: async () => {} };
  VR2.editorLogica = VR.editorLogica;
  const finestra = { VR: VR2 };
  new Function('window', 'chrome', corpo(leggi('relist.js')))(finestra, chrome);
  const esistenti = { '10': 'assente', '9010': 'presente' };
  VR2.api = {
    stato: async (id) => esistenti[id] || 'ignoto',
    armadioRecenti: async () => [{ id: 9011, photos: [{ id: 999 }, { id: 701 }] }, { id: 9012, photos: [{ id: 5 }] }],
  };
  let o = await VR2.verificaPubblicazione({ itemId: '10', fotoIds: ['701'] });
  ok('E. annuncio riconosciuto dalle foto caricate (non da titolo o prezzo)', o.trovato === '9011' && o.vecchio === 'assente');
  o = await VR2.verificaPubblicazione({ itemId: '10', nuovoId: '9010' });
  ok('   con l\'id del nuovo annuncio: si guarda quello', o.nuovo === 'presente' && o.trovato === null);
  VR2.settings.userId = null;
  o = await VR2.verificaPubblicazione({ itemId: '10', fotoIds: ['701'] });
  ok('   senza id utente: lo dice, non indovina', o.trovato === null && /id utente/.test(o.limiti[0]));
  VR2.settings.userId = '77';
  VR2.api.armadioRecenti = async () => { throw new Error('HTTP 404'); };
  o = await VR2.verificaPubblicazione({ itemId: '10', fotoIds: ['701'] });
  ok('   armadio non leggibile: lo dice', o.trovato === null && /HTTP 404/.test(o.limiti[0]));
  const r = await manda({ type: 'vr:verifyRelist', itemId: 'x<y' });
  ok('   id non valido dalla richiesta: rifiutato', /non valido/.test(r.limiti[0]));

  // F. relist: permesso subito prima della creazione, id annotato subito dopo
  const ordine = [];
  Object.assign(VR2.settings, { deleteOld: true, order: 'safe', delayMs: 0 });
  VR2.api = {
    getUploadDraft: async () => ({ id: 20, title: 'T', description: 'd', price: { amount: '10' }, currency: 'EUR', catalog_id: 1, photos: [{ full_size_url: 'A' }] }),
    downloadPhoto: async () => new Blob([new Uint8Array(4096)]),
    uploadPhoto: async () => 701,
    createItem: async () => { ordine.push('crea'); return { id: 9020 }; },
    deleteItem: async () => { ordine.push('elimina'); },
  };
  risposte = {};
  await VR2.relist(20, {}, () => {}, {
    oltre: async (info) => { ordine.push(`permesso:${info.fotoIds.join()}:${info.ordine}`); },
    creato: async (id) => { ordine.push(`creato:${id}`); },
  });
  ok('F. ordine: permesso (con le foto) → crea → id annotato → elimina il vecchio', ordine.join(' ') === 'permesso:701:safe crea creato:9020 elimina');
  ordine.length = 0;
  let errore = null;
  try {
    await VR2.relist(20, {}, () => {}, { oltre: async () => { const e = new Error('negato'); e.annullato = true; throw e; } });
  } catch (e) { errore = e; }
  ok('   permesso negato: niente creato, niente eliminato, copia di sicurezza tolta', errore?.annullato && !ordine.length && !Object.keys(store).some((k) => k.startsWith('vrBackup:')));

  console.log(out.join('\n'));
  process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
})();
