// Modello puro della coda (2.1.0): transizioni per id, dedup, ordine, esiti, stima, salute, esportazione.
const C = require(require('path').join(__dirname, '..', 'src/coda-logica.js'));
const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);
const T0 = 1_700_000_000_000;
const art = (id, extra = {}) => ({ id, title: `Art ${id}`, price: 10, thumb: 'https://images1.vinted.net/x.jpg', ...extra });
const ordine = (c) => C.inAttesa(c).map((a) => a.id).join(',');
const stati = (c) => c.items.map((a) => `${a.id}:${a.status}`).join(' ');

// --- creazione
let { coda, saltati } = C.nuova({ items: [art('1'), art('2'), art('2'), { id: 'abc' }, art('3')], intervalMin: 20, ora: T0 });
ok('creazione: ripetuti e id non validi scartati con motivo', coda.items.length === 3 && saltati.length === 2 && saltati.some((s) => /ripetuto/.test(s.motivo)) && saltati.some((s) => /non valido/.test(s.motivo)));
ok('creazione: miniatura solo dal CDN, prezzo conservato', C.nuova({ items: [{ id: '9', thumb: 'https://evil.x/a.png', price: '7.5' }], ora: T0 }).coda.items[0].thumb === null && coda.items[0].price === 10);
ok('creazione: evento nel registro, natura locale', coda.log[0].tipo === 'creata' && coda.log[0].natura === 'locale');
ok('avvio programmato', C.nuova({ items: [art('1')], startAt: T0 + 3600e3, ora: T0 }).coda.state === 'scheduled');

// --- elaborazione: un solo articolo alla volta
ok('avvio articolo', C.avviaArticolo(coda, '1', T0 + 1000).ok && C.corrente(coda).id === '1');
ok('mai due articoli in elaborazione', !C.avviaArticolo(coda, '2', T0 + 1000).ok);

// --- aggiunta durante l'esecuzione (1-2, 11)
let r = C.aggiungi(coda, [art('4')], {}, T0 + 2000);
ok('1. aggiunta di un articolo a coda in esecuzione', r.aggiunti.join() === '4' && ordine(coda) === '2,3,4');
r = C.aggiungi(coda, [art('5'), art('6')], { dove: 'cima' }, T0 + 2000);
ok('2. aggiunta multipla in cima: subito dopo il corrente', ordine(coda) === '5,6,2,3,4');
ok('3. l\'articolo corrente non viene toccato', C.corrente(coda).id === '1' && C.corrente(coda).startedAt === T0 + 1000);
r = C.aggiungi(coda, [art('2'), art('1'), art('7'), art('7')], {}, T0 + 2000);
ok('11. già in coda / in elaborazione / ripetuto: rifiutati con il motivo', r.aggiunti.join() === '7' && r.rifiutati.length === 3 &&
  r.rifiutati.find((x) => x.id === '2').motivo.includes('posizione') && /in elaborazione/.test(r.rifiutati.find((x) => x.id === '1').motivo));
ok('    valutaAggiunta non modifica la coda', (() => { const prima = JSON.stringify(coda); C.valutaAggiunta(coda, [art('99')]); return JSON.stringify(coda) === prima; })());

// --- rimozione (4-6, 12)
r = C.rimuovi(coda, ['6'], T0 + 3000);
ok('4. rimozione di un articolo in attesa', r.rimossi.join() === '6' && C.trova(coda, '6').status === 'removed' && ordine(coda) === '5,2,3,4,7');
r = C.rimuovi(coda, ['5', '3'], T0 + 3000);
ok('5. rimozione multipla', r.rimossi.length === 2 && ordine(coda) === '2,4,7');
r = C.rimuovi(coda, ['1'], T0 + 3000);
ok('6. l\'articolo corrente non si rimuove: serve «Annulla operazione»', !r.ok && /Annulla operazione/.test(r.rifiutati[0].motivo) && C.corrente(coda).id === '1');
ok('    la rimozione non cambia l\'identità degli altri', C.trova(coda, '4').title === 'Art 4' && C.trova(coda, '2').status === 'pending');
ok('    i rimossi non contano nel totale della sessione', C.conta(coda).totale === 4 && C.conta(coda).removed === 3);

// --- annullamento del corrente (7)
r = C.annullaCorrente(coda, T0 + 3500);
ok('7. annullare il corrente è una richiesta, non un\'interruzione', r.ok && C.corrente(coda).annullaRichiesto === true && C.corrente(coda).status === 'working');
r = C.concludiArticolo(coda, '1', { ok: true }, T0 + 4000);
ok('    se era già stato inviato, l\'esito vero vince', C.trova(coda, '1').status === 'done' && !C.trova(coda, '1').annullaRichiesto);

// --- ordine (9)
r = C.sposta(coda, ['7'], 'cima', T0 + 5000);
ok('9. sposta in cima', ordine(coda) === '7,2,4');
C.sposta(coda, ['7'], 'giu'); ok('   giù di uno', ordine(coda) === '2,7,4');
C.sposta(coda, ['2'], 'fondo'); ok('   in fondo', ordine(coda) === '7,4,2');
C.sposta(coda, ['4', '2'], 'su'); ok('   gruppo su di uno, ordine interno conservato', ordine(coda) === '4,2,7');
r = C.sposta(coda, ['1'], 'cima');
ok('   un articolo concluso non si sposta', !r.ok && /solo gli articoli in attesa/.test(r.rifiutati[0].motivo));
ok('   i conclusi restano dove sono', coda.items.findIndex((a) => a.id === '1') === 0);
r = C.riordina(coda, ['7', '4', '2']);
ok('   riordino completo (trascinamento)', r.ok && ordine(coda) === '7,4,2');
r = C.riordina(coda, ['7', '4']);
ok('   riordino con una coda cambiata nel frattempo: rifiutato', !r.ok && /cambiata/.test(r.motivo) && ordine(coda) === '7,4,2');

// --- esiti e prudenza (17-18)
C.avviaArticolo(coda, '7', T0 + 6000);
r = C.concludiArticolo(coda, '7', { ok: false, outcome: 'uncertain', error: 'timeout' }, T0 + 7000);
ok('18. esito incerto → da verificare, mai «fallito»', C.trova(coda, '7').status === 'verify' && C.trova(coda, '7').sicuro === 'no');
ok('    esito tardivo per un articolo non in corso: ignorato', C.concludiArticolo(coda, '7', { ok: true }).ignorato && C.trova(coda, '7').status === 'verify');
ok('    un da verificare non si riprova', !C.riprova(coda, ['7']).ok);
ok('    un da verificare non si rimette in coda aggiungendolo', C.valutaAggiunta(coda, [art('7')])[0].esito === 'rifiuta');
C.risolvi(coda, '7', false, T0 + 7100);
ok('    verificato «non uscito» → fallito e riprovabile', C.trova(coda, '7').status === 'error' && C.riprova(coda, ['7'], T0 + 7200).ok && C.trova(coda, '7').status === 'pending' && C.trova(coda, '7').tentativi === 1);
ok('    riprova lo mette in fondo', ordine(coda) === '4,2,7');
C.avviaArticolo(coda, '4', T0 + 8000);
r = C.concludiArticolo(coda, '4', { ok: false, outcome: 'error', error: 'prezzo', categoria: 'dati', sicuro: 'dopo-correzione' }, T0 + 9000);
ok('17. un errore su un articolo non tocca gli altri', C.trova(coda, '2').status === 'pending' && C.trova(coda, '7').status === 'pending');
C.avviaArticolo(coda, '2', T0 + 10000);
r = C.concludiArticolo(coda, '2', { ok: false, outcome: 'error', error: 'x' }, T0 + 11000);
ok('    tre esiti negativi di fila (incerto, fallito, fallito): modalità prudente', r.prudenza === true);
C.avviaArticolo(coda, '7', T0 + 12000);
C.concludiArticolo(coda, '7', { ok: true }, T0 + 13000);
ok('    un successo azzera il conteggio', coda.erroriDiFila === 0);
ok('    errore definitivo (404) non riprovabile', (() => { const c2 = C.nuova({ items: [art('1')], ora: T0 }).coda; C.avviaArticolo(c2, '1'); C.concludiArticolo(c2, '1', { ok: false, outcome: 'error', sicuro: 'no', error: 'non trovato' }); return !C.riprova(c2, ['1']).ok; })());
ok('12. tolto l\'ultimo in attesa (e nessuno in corso): la coda va chiusa', C.daChiudere(coda));

// --- conteggi e registro
const n = C.conta(coda);
ok('conteggi coerenti', n.done === 2 && n.error === 2 && n.removed === 3 && n.rimanenti === 0 && n.trattati === 4);
ok('registro: modifiche locali distinte dagli esiti di Vinted', coda.log.some((e) => e.tipo === 'rimosso' && e.natura === 'locale') && coda.log.some((e) => e.tipo === 'completato' && e.natura === 'vinted'));
ok('registro: azione consigliata sugli errori', coda.log.some((e) => e.tipo === 'fallito' && /correggi/.test(e.azione)));

// --- pausa: modifiche e ripresa con l'ordine nuovo (8-10)
let p = C.nuova({ items: [art('1'), art('2'), art('3')], ora: T0 }).coda;
p.state = 'paused';
C.aggiungi(p, [art('4')], { dove: 'cima' });
C.sposta(p, ['3'], 'cima');
ok('8-10. in pausa: aggiunta e riordino, il prossimo è quello nuovo', ordine(p) === '3,4,1,2' && C.prossimo(p).id === '3');

// --- stima
let s = C.nuova({ items: [art('1'), art('2'), art('3')], intervalMin: 10, ora: T0 }).coda;
let st = C.stima(s, T0);
ok('stima senza dati: approssimata e lo dice', st.affidabile === false && /approssimata/.test(st.testo) && st.rimanenteMs === 2 * 600_000);
C.avviaArticolo(s, '1', T0); C.concludiArticolo(s, '1', { ok: true }, T0 + 60_000);
C.avviaArticolo(s, '2', T0 + 700_000); C.concludiArticolo(s, '2', { ok: true }, T0 + 760_000);
s.nextAt = T0 + 760_000 + 600_000;
st = C.stima(s, T0 + 760_000);
ok('stima con durate osservate: attesa + durata media', st.affidabile && st.durataMediaMs === 60_000 && st.rimanenteMs === 600_000 + 60_000 && st.fineAlle === T0 + 760_000 + 660_000);
s.state = 'paused';
ok('in pausa: nessuna stima inventata', C.stima(s, T0).rimanenteMs === null);

// --- salute
const sal = (mod) => { const c = C.nuova({ items: [art('1'), art('2')], ora: T0 }).coda; mod(c); return C.salute(c); };
ok('salute: tutto regolare', sal(() => {}).livello === 'ok');
ok('salute: pausa manuale', sal((c) => { c.state = 'paused'; }).livello === 'pausa');
ok('salute: bloccata dalla prudenza, con il motivo', (() => { const x = sal((c) => { c.state = 'paused'; c.pausaAuto = true; c.motivoPausa = '3 errori di fila'; }); return x.livello === 'bloccata' && /3 errori/.test(x.perche); })());
ok('salute: da verificare', sal((c) => { C.avviaArticolo(c, '1'); C.concludiArticolo(c, '1', { ok: false, outcome: 'partial' }); }).livello === 'verificare');
ok('salute: sessione interrotta', sal((c) => { c.state = 'recovering'; }).livello === 'attenzione');
ok('salute: rallentamento detto come indizio', /probabile/.test(sal((c) => { c.backoff = 1; }).perche));

// --- classificazione errori
const k = C.classificaErrore;
ok('errori: incerto non riprovabile', k({ incerto: true }).categoria === 'incerto' && k({ incerto: true }).sicuroRiprovare === 'no');
ok('errori: parziale', /vecchio non eliminato/.test(k({ parziale: true }).etichetta));
ok('errori: 429 temporaneo, 403 sessione, 404 definitivo', k({ status: 429 }).categoria === 'temporaneo' && k({ status: 403 }).categoria === 'sessione' && k({ status: 404 }).sicuroRiprovare === 'no');
ok('errori: campi → dati, riprovare dopo la correzione', k({ status: 400, campi: {} }).sicuroRiprovare === 'dopo-correzione');
ok('errori: rete, interno, annullato', k({ rete: true }).categoria === 'rete' && k({}).categoria === 'interno' && k({ annullato: true }).categoria === 'annullato');

// --- archivio, ripresa sessione, esportazione
const arch = C.perArchivio(coda, T0 + 99_000);
ok('archivio: compatto, con registro e conteggi', arch.v === 3 && arch.log.length > 0 && arch.conteggi.done === 2 && !('nextAt' in arch));
let { riprendibili, esclusi } = C.daRiprendere({ items: [
  { id: '1', status: 'done' }, { id: '2', status: 'error', sicuro: 'si' }, { id: '3', status: 'cancelled' },
  { id: '4', status: 'verify' }, { id: '5', status: 'removed' }, { id: '6', status: 'error', sicuro: 'no' }] });
ok('ripresa di una sessione: solo falliti riprovabili e annullati, mai i completati', riprendibili.map((a) => a.id).join() === '2,3' && esclusi.map((e) => e.id).join() === '1,4,5,6');
const csv = C.esportaCSV({ startedAt: T0, items: [{ id: '1', title: '=HYPERLINK("x")', status: 'done' }, { id: '2', title: 'Libro, "bello"', status: 'error', error: 'a\nb' }] });
ok('CSV: intestazione e righe', csv.split('\r\n')[0].startsWith('sessione,ordine,id,titolo,stato'));
ok('CSV: formule neutralizzate, virgolette e a capo protetti', csv.includes(`'=HYPERLINK`) && csv.includes('"Libro, ""bello"""') && csv.includes('"a\nb"'));
const js = C.esportaJSON(coda, '2.1.0');
ok('JSON: formato riconoscibile, eventi con natura', js.formato === 'vinted-relist-sessione' && js.eventi.every((e) => e.natura) && js.articoli.length === coda.items.length);
const res = C.resoconto(coda, T0 + 99_000);
ok('resoconto: senza titoli, con id e stati', !/Art \d/.test(res) && /4 — Fallito/.test(res));

// --- migrazione dal formato con indice (2.0.x)
const vecchia = { running: true, state: 'working', index: 1, startedAt: T0, startedItemAt: T0 + 5, pauseRequested: true,
  items: [{ id: '1', title: 'A', status: 'done' }, { id: '2', title: 'B', status: 'pending' }, { id: '3', title: 'C', status: 'pending' }] };
const m = C.migra(vecchia);
ok('migrazione: l\'articolo all\'indice in lavorazione diventa «working»', m.v === 3 && stati(m) === '1:done 2:working 3:pending' && !('index' in m));
ok('migrazione: pausa richiesta conservata', m.pausaDopoCorrente === true && !('pauseRequested' in m));
ok('migrazione: una coda già nuova resta com\'è', C.migra(coda) === coda);

console.log(out.join('\n'));
process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
