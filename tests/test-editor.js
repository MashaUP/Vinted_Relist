const L = require(require('path').join(__dirname, '..', 'src/editor-logica.js'));
const out=[]; const ok=(n,c)=>out.push(`  ${c?'OK  ':'FAIL'} ${n}`);

const base = {
  title: 'DVD Ghost Rider - Nicolas Cage, edizione italiana',
  description: 'DVD originale in ottime condizioni, disco senza graffi, custodia integra con libretto.',
  price: 5, colorIds: [1],
  photos: [{url:'a'},{url:'b'},{url:'c'}],
};

let c = L.controlla(base);
ok('annuncio a posto: nessun errore ne avviso', c.ok && !c.avvisi.length);

c = L.controlla({...base, title: ''});
ok('titolo vuoto è un errore', !c.ok && c.errori[0].campo === 'title');
c = L.controlla({...base, title: 'x'.repeat(101)});
ok('titolo oltre 100 è un errore', !c.ok);
c = L.controlla({...base, title: 'DVD'});
ok('titolo corto è solo un avviso', c.ok && c.avvisi.some(a=>a.campo==='title'));
c = L.controlla({...base, title: 'DVD GHOST RIDER ORIGINALE'});
ok('tutto maiuscolo è un avviso', c.avvisi.some(a=>/maiuscolo/.test(a.testo)));

c = L.controlla({...base, description: base.description + ' Scrivimi a mario.rossi@gmail.com'});
ok('email in descrizione segnalata', c.avvisi.some(a=>/contatti/.test(a.testo)));
c = L.controlla({...base, description: base.description + ' tel 333 123 4567'});
ok('telefono in descrizione segnalato', c.avvisi.some(a=>/contatti/.test(a.testo)));
c = L.controlla({...base, description: base.description + ' contattami su whatsapp'});
ok('whatsapp segnalato', c.avvisi.some(a=>/contatti/.test(a.testo)));
c = L.controlla({...base, description: 'Lotto di 4 DVD del 2007, 120 minuti ciascuno, ottimo stato.'});
ok('numeri normali non sono un telefono', !c.avvisi.some(a=>/contatti/.test(a.testo)));

c = L.controlla({...base, price: 0});
ok('prezzo zero è un errore', !c.ok);
c = L.controlla({...base, photos: []});
ok('zero foto è un errore', !c.ok);
c = L.controlla({...base, photos: [{url:'a'}]});
ok('una foto è solo un avviso', c.ok && c.avvisi.some(a=>a.campo==='photos'));

c = L.controlla({...base, colorIds: []}, { coloreMancante: true });
ok('colore mancante: avviso, non blocca (l’originale è online così)', c.ok && c.avvisi.some(a=>a.campo==='color' && /online così/.test(a.testo)));
c = L.controlla({...base, colorIds: []}, { coloreMancante: true, categoriaConColori: true });
ok('categoria dove gli altri hanno colore: avviso più deciso, sempre non bloccante', c.ok && c.avvisi.some(a=>/potrebbe chiederlo/.test(a.testo)));
c = L.controlla({...base, colorIds: []}, { coloreMancante: true, coloreRiempito: true });
ok('riempito in automatico: nessun avviso sul colore', c.ok && !c.avvisi.some(a=>a.campo==='color'));

// differenze
let d = L.differenze(base, base);
ok('nessuna differenza se nulla cambia', d.length === 0);
d = L.differenze(base, {...base, price: 4.5});
ok('prezzo cambiato', d.length === 1 && d[0].campo === 'Prezzo' && d[0].dopo === 4.5);
d = L.differenze(base, {...base, title: base.title + '  '});
ok('spazi in coda non contano come modifica', d.length === 0);
d = L.differenze(base, {...base, photos: [{url:'b'},{url:'a'},{url:'c'}]});
ok('nuova copertina riconosciuta', d[0]?.campo === 'Foto' && /nuova copertina/.test(d[0].dopo));
d = L.differenze(base, {...base, photos: [{url:'a'},{url:'c'},{url:'b'}]});
ok('riordino senza cambio copertina', /ordine cambiato/.test(d[0]?.dopo));
d = L.differenze(base, {...base, photos: [{url:'a'},{url:'b'}]});
ok('foto tolta', /1 tolta/.test(d[0]?.dopo) && /2 foto/.test(d[0]?.dopo));
d = L.differenze(base, {...base, photos: [{url:'a', rotate:90},{url:'b'},{url:'c', crop:{x:0,y:0,w:.5,h:.5}}]});
ok('rotazione e ritaglio contati', /2 ruotate o ritagliate/.test(d[0]?.dopo));
d = L.differenze(base, {...base, photos: [{url:'a', rotate:360},{url:'b'},{url:'c'}]});
ok('giro completo non è una modifica', d.length === 0);
ok('haModifiche coerente', L.haModifiche(base, {...base, price: 6}) && !L.haModifiche(base, base));

// riordino
ok('sposta avanti', L.sposta(['a','b','c'], 0, 2).join('') === 'bca');
ok('sposta indietro', L.sposta(['a','b','c'], 2, 0).join('') === 'cab');
ok('indici fuori range: nessun danno', L.sposta(['a','b'], 5, 0).join('') === 'ab');

// sostituzione in blocco
ok('sostituzione letterale, maiuscole ignorate', L.sostituisci('#StarWars e #starwars', '#starwars', '#sw') === '#sw e #sw');
ok('caratteri speciali presi alla lettera', L.sostituisci('prezzo (trattabile).', '(trattabile).', 'fisso') === 'prezzo fisso');
ok('cerca vuoto non tocca niente', L.sostituisci('abc', '', 'x') === 'abc');

console.log(out.join('\n'));
process.exit(out.some(x=>x.includes('FAIL'))?1:0);
