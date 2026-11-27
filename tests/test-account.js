// 2.7.0 — «Profilo non rilevato» (segnalato da un utente dopo l'aggiornamento):
// l'account si riconosce anche dal caricamento delle pagine, il service worker
// registra cosa ha visto di Vinted (mai i valori dei cookie), il popup dice
// perche' il profilo manca e la diagnostica distingue le righe informative.
/* global accountDaCookie -- funzioni del service worker, caricato con eval qui sotto */
const fs = require('fs');
const path = require('path');
const out = []; const ok = (n, c, extra = '') => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}${!c && extra ? ` — ${extra}` : ''}`);
const RADICE = path.join(__dirname, '..');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload) => `${b64({ alg: 'HS256' })}.${b64(payload)}.firmaSegreta123`;

let store = {};
let scritture = 0;
const ascoltatori = [];
const L = { message: [] };
const cp = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
global.chrome = {
  storage: {
    local: {
      get: async (k) => {
        if (k === null) return cp(store);
        if (typeof k === 'string') return { [k]: cp(store[k]) };
        if (Array.isArray(k)) { const o = {}; for (const x of k) o[x] = cp(store[x]); return o; }
        const o = {}; for (const [a, b] of Object.entries(k || {})) o[a] = a in store ? cp(store[a]) : b; return o;
      },
      set: async (o) => { scritture++; Object.assign(store, cp(o)); },
      remove: async (k) => { [].concat(k).forEach((x) => delete store[x]); },
    },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {} },
  },
  alarms: { create() {}, clear() {}, get: async () => undefined, getAll: async () => [], onAlarm: { addListener() {} } },
  idle: { queryState: async () => 'active' },
  tabs: { query: async () => [], get: async (id) => ({ id }), sendMessage: async () => ({}) },
  permissions: { getAll: async () => ({ permissions: [] }), contains: async () => true },
  runtime: { onMessage: { addListener: (f) => L.message.push(f) }, getURL: (p) => p, getManifest: () => ({ version: '2.7.1', permissions: [], host_permissions: [] }),
    onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
  webRequest: {
    onSendHeaders: { addListener: (f, filtro, extra) => ascoltatori.push({ f, filtro, extra }) },
    onBeforeRequest: { addListener() {} },
  },
};
require(path.join(__dirname, 'sw-stubs.js'))(global.chrome);
eval(fs.readFileSync(path.join(RADICE, 'background.js'), 'utf8'));
const invia = (msg) => new Promise((res) => { for (const f of L.message) if (f(msg, {}, res)) return; res(null); });
const calma = () => new Promise((res) => setTimeout(res, 20));

const pagina = ascoltatori.find((a) => (a.filtro.types || []).includes('main_frame'));
const api = ascoltatori.find((a) => a.filtro.urls.some((u) => u.includes('/api/')) && !a.filtro.types);
const richiesta = (a, url, cookie, altri = []) => a.f({ url, requestHeaders: [...(cookie == null ? [] : [{ name: 'Cookie', value: cookie }]), ...altri] });

(async () => {
  // ------------------------------------------------ cookie → account
  const T = jwt({ sub: 4242, exp: 9e9 });
  ok('1. v_uid', JSON.stringify(accountDaCookie('a=1; v_uid=123456; b=2')) === '{"id":"123456","fonte":"v_uid"}');
  ok('2. token di accesso (sub)', accountDaCookie(`access_token_web=${T}`).id === '4242' && accountDaCookie(`access_token_web=${T}`).fonte === 'token');
  ok('3. solo token di rinnovo (nuovo in 2.7.0)', accountDaCookie(`x=1; refresh_token_web=${T}`).id === '4242');
  ok('4. cookie dell\'account in un formato sconosciuto: «illeggibile»', accountDaCookie('v_uid=abc; access_token_web=opaco').fonte === 'illeggibile' && accountDaCookie('v_uid=abc').id === null);
  ok('5. cookie senza account: «nessuno»; nessun cookie: «assente»', accountDaCookie('anon_id=x; _vinted_fr_session=y').fonte === 'nessuno' && accountDaCookie(null).fonte === 'assente');
  ok('6. id solo numerico, cookie vuoto: assente', accountDaCookie('v_uid=99').id === '99' && accountDaCookie('').fonte === 'assente');

  // ------------------------------------------------ ascoltatori
  ok('7. ascolto delle pagine: solo documenti, sugli stessi siti dei permessi, con i cookie',
    pagina && pagina.filtro.types.join() === 'main_frame,sub_frame' && pagina.filtro.urls.length === 17 && pagina.filtro.urls.every((u) => /^https:\/\/www\.vinted\.[a-z.]+\/\*$/.test(u)) && pagina.filtro.urls.join() === require(path.join(RADICE, 'manifest.json')).host_permissions.filter((h) => h.startsWith('https://www.vinted.')).join() && pagina.extra.includes('extraHeaders'));
  ok('   ascolto delle API invariato', Boolean(api) && api.filtro.urls.every((u) => /\/api\/\*$/.test(u)));

  // pagina caricata: account riconosciuto senza chiamate alle API
  richiesta(pagina, 'https://www.vinted.fr/member/555', `anon_id=x; access_token_web=${T}`);
  await calma();
  ok('8. il caricamento di una pagina basta a riconoscere l\'account', store.userId === '4242' && store.vintedOrigin === 'https://www.vinted.fr');
  ok('   vrVisto: pagina vista, fonte e dominio, versione', store.vrVisto?.atPagina > 0 && store.vrVisto.cookie === 'token' && store.vrVisto.dominio === 'vinted.fr' && store.vrVisto.build === require(path.join(RADICE, 'manifest.json')).version && !store.vrVisto.atApi);
  ok('   nessun valore di cookie o token salvato', !JSON.stringify(store).includes('firmaSegreta') && !JSON.stringify(store).includes(T.split('.')[1]));

  // tante richieste uguali: poche scritture
  const prima = scritture;
  for (let i = 0; i < 60; i++) richiesta(api, 'https://www.vinted.fr/api/v2/x', `access_token_web=${T}`);
  await calma();
  ok('9. 60 chiamate alle API: vrVisto si scrive una volta sola (atApi nuovo)', scritture - prima === 1 && store.vrVisto.atApi > 0, `${scritture - prima} scritture`);
  // cambia lo stato del cookie: si scrive subito
  richiesta(api, 'https://www.vinted.fr/api/v2/x', 'anon_id=x');
  await calma();
  ok('10. disconnesso: si scrive subito «nessuno», l\'id salvato resta', store.vrVisto.cookie === 'nessuno' && store.userId === '4242');

  // ------------------------------------------------ report completo
  const rep = await invia({ type: 'vr:diagnosi' });
  ok('11. report: blocco «riconoscimento» con età e fonte, senza valori',
    rep?.riconoscimento?.utenteNoto === true && rep.riconoscimento.cookie === 'nessuno' && rep.riconoscimento.dominio === 'vinted.fr' && Number.isInteger(rep.riconoscimento.ultimaPaginaDaS),
    JSON.stringify(rep?.riconoscimento || rep));

  // ------------------------------------------------ popup: perche' il profilo manca
  const sorgente = fs.readFileSync(path.join(RADICE, 'src', 'popup.js'), 'utf8');
  const pezzo = sorgente.slice(sorgente.indexOf('const COOKIE_ACCOUNT'), sorgente.indexOf('async function controlli()'));
  const crea = (uid) => new Function('userId', 'fa', `${pezzo}; return { dettaglioProfilo, dettaglioVisto };`)(uid, () => '3 min fa');
  const P = crea(null);
  ok('12. mai vista una richiesta: ricaricare la scheda', /ricarica una scheda di Vinted \(F5\)/.test(P.dettaglioProfilo(null)) && /nessuna vista/.test(P.dettaglioVisto(null)));
  ok('13. senza cookie dell\'account: accedere', /non risulta connesso/.test(P.dettaglioProfilo({ at: 1, cookie: 'nessuno' })) && /non risulta connesso/.test(P.dettaglioProfilo({ at: 1, cookie: 'assente' })));
  ok('14. formato nuovo: mandare la diagnostica', /formato nuovo, manda la diagnostica/.test(P.dettaglioProfilo({ at: 1, cookie: 'illeggibile' })));
  ok('15. riga «Richieste di Vinted»', P.dettaglioVisto({ at: 1, cookie: 'v_uid', dominio: 'vinted.fr' }) === 'vista 3 min fa su vinted.fr · cookie dell\'account: trovato (v_uid)');
  ok('16. profilo rilevato', crea('7').dettaglioProfilo({ at: 1, cookie: 'nessuno' }) === 'rilevato');

  // ------------------------------------------------ traduzioni
  const I = require(path.join(RADICE, 'src', 'i18n.js'));
  const nuove = [P.dettaglioProfilo(null), P.dettaglioProfilo({ at: 1, cookie: 'nessuno' }), P.dettaglioProfilo({ at: 1, cookie: 'illeggibile' }), P.dettaglioVisto(null), 'Richieste di Vinted',
    ...['v_uid', 'token', 'nessuno', 'assente', 'illeggibile'].map((c) => P.dettaglioVisto({ at: 1, cookie: c, dominio: 'vinted.fr' }))];
  for (const l of ['en', 'fr', 'es', 'de']) {
    I.imposta(l, JSON.parse(fs.readFileSync(path.join(RADICE, 'src', 'lang', `${l}.json`), 'utf8')));
    const tradotte = nuove.map((t) => I.traduci(t));
    const rimaste = tradotte.filter((t, i) => t === nuove[i] || /ricarica|rilevato|connesso|trovato|assente|nessun|Richieste|cookie dell'account| min fa|formato nuovo/.test(t));
    ok(`17. ${l}: testi nuovi tradotti`, !rimaste.length, rimaste.join(' | '));
  }
  I.imposta('en', JSON.parse(fs.readFileSync(path.join(RADICE, 'src', 'lang', 'en.json'), 'utf8')));
  ok('   esempio inglese', I.traduci(P.dettaglioVisto({ at: 1, cookie: 'v_uid', dominio: 'vinted.fr' })) === 'seen 3 min ago on vinted.fr · account cookie: found (v_uid)', I.traduci(P.dettaglioVisto({ at: 1, cookie: 'v_uid', dominio: 'vinted.fr' })));
  ok('   «ora» del popup tradotto', I.traduci('ora') === 'just now');

  // ------------------------------------------------ testo della diagnostica
  const V = require(path.join(RADICE, 'src', 'versione.js'));
  const testo = V.costruisciDiagnostica({ versione: '2.7.1', controlli: [
    { ok: true, livello: 'ok', nome: 'A', dettaglio: 'x' }, { ok: true, livello: 'info', nome: 'B', dettaglio: 'y' }, { ok: false, livello: 'warn', nome: 'C', dettaglio: 'z' }, { ok: true, nome: 'D', dettaglio: 'vecchio formato' }] });
  ok('18. diagnostica: «ok», «--» per le informative, «!!»; senza livello come prima',
    testo.includes('  ok A: x') && testo.includes('  -- B: y') && testo.includes('  !! C: z') && testo.includes('  ok D: vecchio formato'));

  const ko = out.filter((r) => r.includes('FAIL')).length;
  console.log(out.join('\n'));
  console.log(`${out.length - ko} OK, ${ko} FAIL`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
