// Link del progetto: validazione, precedenza, cache (link.js) e il links.json del pacchetto.
const fs = require('fs');
const path = require('path');
const RADICE = (require('path').join(__dirname, '..') + '/');
const Lk = require(RADICE + 'src/link.js');
const V = require(RADICE + 'src/versione.js');
let pass = 0, fail = 0;
const ok = (n, c) => { console.log(`  ${c ? 'OK  ' : 'FAIL'} ${n}`); c ? pass++ : fail++; };

const testo = fs.readFileSync(RADICE + 'links.json', 'utf8');
const pacchetto = Lk.valida(testo);
const base = (links, extra = {}) => ({ schemaVersion: 1, project: 'vinted-relist', revision: 1, links, ...extra });

// ------------------------------------------------------------- file del pacchetto
ok('1. links.json del pacchetto valido, nessuna voce scartata', pacchetto.ok && pacchetto.scartati.length === 0);
ok('   contiene github, discord, kofi, documentation, bug-report, feature-request, changelog',
  ['github', 'discord', 'kofi', 'documentation', 'bug-report', 'feature-request', 'changelog'].every((id) => pacchetto.links[id]?.enabled));
ok('   GitHub coincide con il repository del controllo aggiornamenti', pacchetto.links.github.url === V.urlRepo(V.REPO));
ok('   Ko-fi è quello del progetto', pacchetto.links.kofi.url === 'https://ko-fi.com/mashaup');
ok('   nessun segreto nel file pubblico', !/token|secret|password|cookie|api[_-]?key|authorization/i.test(testo));
ok('   versione.js non ha più un suo indirizzo Ko-fi', !('KOFI' in V) && !/ko-fi/.test(fs.readFileSync(RADICE + 'src/versione.js', 'utf8')));
const html = ['src/popup.html', 'src/dashboard.html'].map((f) => fs.readFileSync(RADICE + f, 'utf8')).join('\n');
ok('   nessun URL di GitHub/Discord/Ko-fi scritto nelle pagine', !/https:\/\/(github\.com|discord\.gg|discord\.com|ko-fi\.com)/.test(html));

// ------------------------------------------------------------------- validazione
ok('2. JSON malformato rifiutato', !Lk.valida('{"a":').ok && /JSON/.test(Lk.valida('{"a":').errore));
ok('   non un oggetto', !Lk.valida('[]').ok && !Lk.valida('null').ok && !Lk.valida('"x"').ok);
ok('   schema più recente: incompatibile', Lk.valida(base({}, { schemaVersion: 2 })).incompatibile === true);
ok('   schema mancante o zero', !Lk.valida({ project: 'vinted-relist', links: {} }).ok && !Lk.valida(base({}, { schemaVersion: 0 })).ok);
ok('   progetto diverso rifiutato', /altro progetto/.test(Lk.valida(base({}, { project: 'keep-watching' })).errore));
ok('   progetto configurabile (riuso)', Lk.valida(base({}, { project: 'keep-watching' }), { progetto: 'keep-watching' }).ok);
ok('   senza links', !Lk.valida({ schemaVersion: 1, project: 'vinted-relist' }).ok);
ok('   revision non valida → 0', Lk.valida(base({}, { revision: -3 })).revision === 0 && Lk.valida(base({}, { revision: '7' })).revision === 0);
ok('   campi sconosciuti ignorati', Lk.valida(base({ github: { url: 'https://github.com/a', extra: 1 } }, { futuro: true })).ok);

const prova = (url, id = 'x-link') => Lk.urlSicuro(url, id);
ok('3. https consentito', prova('https://github.com/MashaUP/Vinted_Relist').ok);
ok('   http rifiutato', /protocollo/.test(prova('http://github.com/').motivo));
ok('   javascript: e data: rifiutati', !prova('javascript:alert(1)').ok && !prova('data:text/html,<b>x</b>').ok);
ok('   javascript: con maiuscole e spazi', !prova('  JaVaScRiPt:alert(1)').ok && !prova('java\nscript:alert(1)').ok);
ok('   credenziali e porta rifiutate', !prova('https://u:p@github.com/').ok && !prova('https://github.com:8443/').ok);
ok('   sito fuori elenco', /non consentito/.test(prova('https://evil.example/').motivo));
ok('   finto sottodominio rifiutato', !prova('https://github.com.evil.example/').ok && !prova('https://evilgithub.com/').ok);
ok('   host atteso per id noti', !prova('https://github.com/x', 'discord').ok && prova('https://discord.com/invite/abc', 'discord').ok && !prova('https://discord.gg/abc', 'kofi').ok);
ok('   vuoto, non stringa, troppo lungo', !prova('').ok && !prova(42).ok && !prova('https://github.com/' + 'a'.repeat(600)).ok);
ok('   malformato non fa crash', !prova('https://').ok && !prova('::::').ok);

const v = Lk.valida(base({
  github: { url: 'https://github.com/a/b', label: '  GitHub\u0000\n del progetto  ' },
  discord: { url: 'javascript:alert(1)' },
  kofi: { enabled: 'no' },
  'Bad_ID': { url: 'https://github.com/' },
  constructor: { url: 'https://github.com/c' },
  nuovo: { url: 'https://mashaup.github.io/pagina', label: 'Pagina' },
  spento: { enabled: false },
  lista: [],
}));
ok('4. voce per voce: le valide restano', v.ok && v.links.github.url === 'https://github.com/a/b' && v.links.nuovo.enabled);
ok('   etichetta ripulita da caratteri di controllo', v.links.github.label === 'GitHub del progetto');
ok('   scartate con motivo: protocollo, enabled non booleano, id, array', ['discord', 'kofi', 'Bad_ID', 'lista'].every((id) => v.scartati.some((x) => x.id === id)));
ok('   spenta senza url: valida', v.links.spento.enabled === false && v.links.spento.url === '');
ok('   id «constructor» trattato come dato', v.links.constructor.url === 'https://github.com/c');
const tanti = {}; for (let i = 0; i < 30; i++) tanti[`l${i}x`] = { url: 'https://github.com/' + i };
ok('   al massimo 20 link', Object.keys(Lk.valida(base(tanti)).links).length === 20);

// ------------------------------------------------------------------- precedenza
const cache = (links, revision = 2, extra = {}) => ({ ok: true, revision, links: Lk.valida(base(links, { revision })).links, at: 1000, repo: 'MashaUP/Vinted_Relist', ...extra });
let r = Lk.risolvi({ predefinita: pacchetto, cache: null });
ok('5. senza remoto: i predefiniti', r.fonte === 'predefinita' && r.links.discord.url === 'https://discord.gg/EPsbQCuAkx');
r = Lk.risolvi({ predefinita: pacchetto, cache: cache({ discord: { url: 'https://discord.gg/Nuovo' } }), repo: 'MashaUP/Vinted_Relist' });
ok('   cache valida: Discord nuovo, gli altri restano', r.fonte === 'remota' && r.links.discord.url === 'https://discord.gg/Nuovo' && r.links.github.url === pacchetto.links.github.url);
ok('   etichetta vuota nel remoto: resta la predefinita', r.links.discord.label === 'Discord');
r = Lk.risolvi({ predefinita: pacchetto, cache: cache({ discord: { url: 'https://discord.gg/Nuovo' } }, 0) });
ok('   cache più vecchia del pacchetto: ignorata', r.fonte === 'predefinita');
r = Lk.risolvi({ predefinita: pacchetto, cache: cache({ discord: { url: 'https://discord.gg/N' } }), repo: 'altro/repo' });
ok('   cache di un altro repository: ignorata', r.fonte === 'predefinita');
r = Lk.risolvi({ predefinita: pacchetto, cache: cache({ discord: { enabled: false } }) });
ok('   il remoto può spegnere, non cancellare', r.links.discord.enabled === false && !Lk.link(r, 'discord') && Lk.link(r, 'github'));
r = Lk.risolvi({ predefinita: pacchetto, cache: cache({ wiki: { url: 'https://mashaup.github.io/wiki', label: 'Wiki' } }) });
ok('   un servizio nuovo si aggiunge senza toccare la UI, in fondo', Lk.elenco(r).at(-1).id === 'wiki' && Lk.elenco(r)[0].id === 'github');
r = Lk.risolvi({ predefinita: { ok: false }, cache: null });
ok('   pacchetto illeggibile: nessun link, nessun crash', Lk.elenco(r).length === 0 && Lk.link(r, 'github') === null);
ok('   link mancante → null', Lk.link(Lk.risolvi({ predefinita: pacchetto }), 'inesistente') === null);

// ------------------------------------------------------------------ quando chiedere
const ora = 100 * 3600e3;
ok('6. mai chiesto: si chiede', Lk.daAggiornare({}, ora));
ok('   riuscito da poco: no', !Lk.daAggiornare({ okAt: ora - 3600e3, tentativoAt: ora - 3600e3 }, ora));
ok('   oltre 12 ore: sì', Lk.daAggiornare({ okAt: ora - 13 * 3600e3, tentativoAt: ora - 13 * 3600e3 }, ora));
ok('   dopo un errore aspetta un\'ora (niente tempeste offline)', !Lk.daAggiornare({ errore: 'x', tentativoAt: ora - 30 * 60e3 }, ora) && Lk.daAggiornare({ errore: 'x', tentativoAt: ora - 61 * 60e3 }, ora));
ok('   forzato: al massimo una volta al minuto', !Lk.daAggiornare({ okAt: ora - 30e3, tentativoAt: ora - 30e3 }, ora, { forza: true }) && Lk.daAggiornare({ okAt: ora - 61e3, tentativoAt: ora - 61e3 }, ora, { forza: true }));

ok('7. stato descritto', /versione installata/.test(Lk.descriviStato({ fonte: 'predefinita' }, {})) &&
  /aggiornati dal progetto 2 h fa/.test(Lk.descriviStato({ fonte: 'remota', aggiornatoAt: ora - 2 * 3600e3 }, {}, ora)));
ok('   errore dopo l\'ultimo successo: detto una volta', /non riuscito \(rete\)/.test(Lk.descriviStato({ fonte: 'remota', aggiornatoAt: ora - 3600e3 }, { okAt: ora - 3600e3, tentativoAt: ora, errore: 'rete' }, ora)));

// ---------------------------------------------------------------- adattatore (Node)
const store = {};
global.chrome = {
  runtime: { getURL: (p) => 'pkg:' + p },
  storage: { local: {
    get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : Object.fromEntries(Object.entries(k).map(([a, b]) => [a, a in store ? store[a] : b]))),
    set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))),
  } },
};
let risposta = null;
let chiamate = 0;
global.fetch = async (url, opz) => {
  if (url === 'pkg:links.json') return { ok: true, text: async () => testo };
  chiamate++;
  if (risposta === 'lento') return new Promise((_, rej) => opz.signal.addEventListener('abort', () => { const e = new Error('abort'); e.name = 'AbortError'; rej(e); }));
  return risposta;
};
globalThis.LinkProgetto = Lk;
globalThis.Versione = V;
require(RADICE + 'src/link-chrome.js');
const LC = globalThis.LinkChrome;

(async () => {
  const b64 = Buffer.from(JSON.stringify(base({ discord: { url: 'https://discord.gg/B64' } }, { revision: 3 }))).toString('base64');
  risposta = { ok: true, status: 200, text: async () => JSON.stringify({ encoding: 'base64', content: b64 }) };
  let e = await LC.aggiorna({ ora: 1e9 });
  ok('8. risposta in base64 (Accept ignorato) letta', e.aggiornato && (await LC.risolti()).links.discord.url === 'https://discord.gg/B64');
  risposta = { ok: false, status: 500, text: async () => '' };
  e = await LC.aggiorna({ ora: 1e9 + 13 * 3600e3 });
  ok('   errore del server: la cache valida resta', !e.aggiornato && /HTTP 500/.test(e.errore) && (await LC.risolti()).links.discord.url === 'https://discord.gg/B64');
  risposta = 'lento';
  const t0 = Date.now();
  e = await LC.aggiorna({ ora: 1e9 + 30 * 3600e3 });
  ok('   nessuna risposta: si arrende dopo il timeout', /in tempo/.test(e.errore) && Date.now() - t0 >= 7000 && Date.now() - t0 < 12000);
  const prima = chiamate;
  e = await LC.aggiorna({ ora: 1e9 + 30 * 3600e3 + 60e3 });
  ok('   subito dopo un errore non richiede di nuovo', chiamate === prima && !e.aggiornato);
  ok('   service worker non coinvolto: background.js non usa i link', !/links\.json|LinkChrome|LinkProgetto/.test(fs.readFileSync(RADICE + 'background.js', 'utf8')));
  const manifest = JSON.parse(fs.readFileSync(RADICE + 'manifest.json', 'utf8'));
  ok('   nessun permesso nuovo: niente github nei permessi', !JSON.stringify(manifest.permissions.concat(manifest.host_permissions)).includes('github'));

  console.log(`\n${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
