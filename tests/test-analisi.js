const A = require(require('path').join(__dirname, '..', 'src/analisi.js'));
const G = 86400000, ORA = Date.UTC(2026, 9, 7, 12);
const out=[]; const ok=(n,c)=>out.push(`  ${c?'OK  ':'FAIL'} ${n}`);

// --- categorie: gruppi disgiunti e completi ---
const inv = {
  a: { title:'A', price:10, relistedAt: ORA - 2*G, firstSeen: ORA - 40*G },   // recente
  b: { title:'B', price:5,  relistedAt: ORA - 30*G, firstSeen: ORA - 40*G },  // stagnante
  c: { title:'C', price:20, firstSeen: ORA - 25*G },                          // stagnante, mai toccato
  d: { title:'D', price:8,  relistedAt: ORA - 10*G, firstSeen: ORA - 40*G },  // da ottimizzare (q 50)
  e: { title:'E', price:null, firstSeen: ORA - 3*G },                          // mai
  f: { title:'F', price:12, relistedAt: ORA - 10*G, firstSeen: ORA - 40*G },  // in regola (q 90)
};
const q = { d:{score:50}, f:{score:90} };
const g = A.classifica(inv, q, ORA);
ok('recenti', JSON.stringify(g.recenti) === '["a"]');
ok('stagnanti, anche se mai toccati', JSON.stringify(g.stagnanti.sort()) === '["b","c"]');
ok('da ottimizzare per punteggio', JSON.stringify(g.ottimizzare) === '["d"]');
ok('mai ripubblicati', JSON.stringify(g.mai) === '["e"]');
ok('in regola', JSON.stringify(g.regola) === '["f"]');
const tutti = Object.values(g).flat();
ok('gruppi disgiunti e completi', tutti.length === 6 && new Set(tutti).size === 6);

const v = A.valoreTotale(inv);
ok('valore totale, prezzi ignoti esclusi', v.totale === 55 && v.conPrezzo === 5);

// --- duplicati ---
const dup = A.duplicati({
  1: { title:'DVD Ghost Rider - Nicolas Cage', price:5 },
  2: { title:'Dvd ghost rider Nicolas Cage', price:5 },
  3: { title:'DVD Ghost Rider - Nicolas Cage', price:9 },    // stesso titolo, prezzo diverso
  4: { title:'Blu-ray Vikings prima stagione', price:10 },
  5: { title:'Lotto', price:3 },                              // troppo corto per giudicare
  6: { title:'Lotto', price:3 },
});
ok('trova il duplicato con maiuscole e punteggiatura diverse', dup.some(c=>[c.a,c.b].sort().join()==='1,2'));
ok('stesso titolo ma prezzo diverso: non e\u0027 un duplicato', !dup.some(c=>[c.a,c.b].includes('3')));
ok('titoli diversi ignorati', !dup.some(c=>[c.a,c.b].includes('4')));
ok('titoli di una parola non giudicati', !dup.some(c=>[c.a,c.b].includes('5')));

// --- visite a 48 ore ---
ok('punto piu\u0027 vicino alle 48 ore', A.visite48([[ORA+10*3600000,3],[ORA+47*3600000,20],[ORA+70*3600000,31]], ORA) === 20);
ok('fuori finestra: nessuna misura', A.visite48([[ORA+5*3600000,3],[ORA+90*3600000,40]], ORA) === null);

// --- catene e consiglio ---
const domenicaSera = (sett) => { const d = new Date(Date.UTC(2026, 8, 6 + sett*7, 18)); return d.getTime(); };
const lunediMattina = (sett) => { const d = new Date(Date.UTC(2026, 8, 7 + sett*7, 7)); return d.getTime(); };
const snaps = [
  { n:1, at: domenicaSera(0),  old:{id:'x0',price:45}, new:{id:'x1',price:45,title:'Air Max'}, visite48: 30 },
  { n:2, at: lunediMattina(1), old:{id:'x1',price:45}, new:{id:'x2',price:42,title:'Air Max'}, visite48: 8 },
  { n:3, at: domenicaSera(2),  old:{id:'x2',price:42}, new:{id:'x3',price:42,title:'Air Max'}, visite48: 34 },
  { n:4, at: lunediMattina(3), old:{id:'x3',price:42}, new:{id:'x4',price:40,title:'Air Max'}, visite48: 6 },
  { n:5, at: domenicaSera(0),  old:{id:'y0',price:10}, new:{id:'y1',price:10,title:'Altro'}, visite48: 4 },
];
const c = A.catene(snaps);
ok('due catene distinte', c.length === 2);
ok('catena ricostruita in ordine', c.find(x=>x[0].old.id==='x0').map(s=>s.n).join() === '1,2,3,4');

const cons = A.consiglioArticolo(c.find(x=>x[0].old.id==='x0'), {});
ok('consiglio con misure sufficienti', cons.sufficiente);
ok(`giorno migliore: ${cons.giorno}`, cons.giorno === 'domenica');
ok(`fascia migliore: ${cons.fascia}`, ['sera','pomeriggio'].includes(cons.fascia));
ok(`fascia di prezzo: ${cons.prezzoMin}–${cons.prezzoMax}`, cons.prezzoMin === 42 && cons.prezzoMax === 45);
ok('prezzo invariato rende di piu\u0027', cons.sulPrezzo === 'invariato');

const poco = A.consiglioArticolo(c.find(x=>x[0].old.id==='y0'), {});
ok('con una misura sola non consiglia', !poco.sufficiente && poco.mancano === 2);

const and = A.andamento(A.misure(snaps, {}), 2);
ok('andamento: solo gruppi con abbastanza misure', and.giorni.every(x=>x.n>=2));
ok('andamento ordinato per media', and.giorni[0].media >= (and.giorni[1]?.media ?? 0));

// catena con ciclo non deve bloccarsi
const ciclo = [{n:1,at:0,old:{id:'a'},new:{id:'b'}},{n:2,at:1,old:{id:'b'},new:{id:'a'}}];
ok('nessun ciclo infinito', Array.isArray(A.catene(ciclo)));

console.log(out.join('\n'));
process.exit(out.some(x=>x.includes('FAIL'))?1:0);
