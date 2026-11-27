// 2.7.1 — «Token CSRF non trovato» con profilo rilevato (segnalazione su vinted.fr, 2.7.0).
// Il token di sessione si legge da tre fonti, in ordine: le richieste di Vinted viste dal
// service worker (per sito), la pagina aperta, la pagina di pubblicazione /items/new.
// Il caso del bug: il token c'e' solo nei dati di Next.js dentro gli <script>, dove le
// virgolette sono precedute da «\» (\"CSRF_TOKEN\":\"…\") — forma DEDOTTA da progetti
// pubblici che leggono Vinted (Vintrack-Vinted-Monitor, client.go), non ancora misurata
// sul sito vero. Le espressioni della 2.7.0 non la riconoscevano.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const out = []; const ok = (n, c, extra = '') => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}${!c && extra ? ` — ${extra}` : ''}`);
const API = fs.readFileSync(path.join(__dirname, '..', 'src', 'api.js'), 'utf8');

const UUID = '7d3c2a10-4b5e-4f60-9a1b-2c3d4e5f6a7b';
const UUID2 = '11111111-2222-4333-8444-555555555555';
// Pagina «come Next.js»: niente <meta>, il token dentro i dati passati agli script (dedotto).
const paginaFlight = (t = UUID) => `<!doctype html><html lang="fr-FR"><head><title>Vinted</title></head><body><main>Dressing</main>
<script>self.__next_f.push([1,"5:[\\"$\\",\\"$L6\\",null,{\\"config\\":{\\"CSRF_TOKEN\\":\\"${t}\\",\\"ANON_ID\\":\\"x\\"}}]\\n"])</script></body></html>`;
const paginaMeta = (t = UUID) => `<!doctype html><html><head><meta name="csrf-token" content="${t}"></head><body></body></html>`;
const paginaJson = (t = UUID) => `<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"CSRF_TOKEN":"${t}"}}</script></body></html>`;
const paginaVuota = '<!doctype html><html><body><main>Dressing</main><script>window.x=1</script></body></html>';

/**
 * Pagina di Vinted simulata con api.js caricato.
 * sw: risposta del service worker a vr:getTokens ({ csrf } | 'errore' | 'scollegata')
 * nuova: risposta a GET /items/new ({ status, url, html } | 'rete')
 * api: risposta alle chiamate /api/v2 (status per token)
 */
function apri({ html = paginaVuota, origine = 'https://www.vinted.fr', sw = {}, nuova = { status: 200, html: paginaVuota }, apiStatus = () => 200, cookie = '' } = {}) {
  const dom = new JSDOM(html, { url: `${origine}/member/42`, runScripts: 'outside-only' });
  const w = dom.window;
  const messaggi = []; const richieste = [];
  let id = 'ext';
  w.chrome = {
    runtime: {
      get id() { return id; },
      sendMessage: async (m) => {
        messaggi.push(m);
        if (m.type === 'vr:getTokens') {
          if (sw === 'errore') throw new Error('Could not establish connection. Receiving end does not exist.');
          if (sw === 'scollegata') throw new Error('Extension context invalidated.');
          return { ok: true, tokens: typeof sw === 'function' ? sw() : sw };
        }
        return { ok: true };
      },
      getManifest: () => ({ version: '2.7.1' }),
    },
  };
  w.VR = { settings: {}, log() {}, warn() {}, cookie: (n) => (cookie.match(new RegExp(`(?:^|; )${n}=([^;]*)`)) || [])[1] || null };
  w.fetch = async (url, init = {}) => {
    richieste.push({ url: String(url), init });
    if (/\/items\/new$/.test(url)) {
      if (nuova === 'rete') throw new TypeError('Failed to fetch');
      return { ok: nuova.status === 200, status: nuova.status, url: nuova.url || url, redirected: Boolean(nuova.url), text: async () => nuova.html || '' };
    }
    const token = init.headers?.['X-CSRF-Token'];
    const s = apiStatus(token, url);
    return { ok: s === 200, status: s, text: async () => (s === 200 ? JSON.stringify({ item: { id: 1, title: 't' } }) : JSON.stringify({ message: 'no' })) };
  };
  w.eval(API);
  return { w, VR: w.VR, messaggi, richieste, scollega: () => { id = undefined; } };
}
const tokenUsato = (p) => p.richieste.filter((r) => r.url.includes('/api/v2/')).map((r) => r.init.headers['X-CSRF-Token']);
const prova = async (p) => { try { await p.VR.api.getUploadDraft(1); return null; } catch (e) { return e; } };

(async () => {
  // ------------------------------------------------ causa del bug
  let p = apri({ html: paginaFlight(), nuova: { status: 200, html: paginaFlight() } });
  let e = await prova(p);
  ok('1. RIPRODUZIONE: token solo nei dati di Next.js (virgolette con «\\»), nessuna richiesta vista → letto dalla pagina', !e && tokenUsato(p)[0] === UUID, e?.message);
  ok('   senza scaricare /items/new', !p.richieste.some((r) => /items\/new/.test(r.url)));
  p = apri({ html: paginaVuota, nuova: { status: 200, html: paginaFlight() } });
  e = await prova(p);
  ok('2. pagina aperta senza token, pagina di pubblicazione con i dati di Next.js → letto da lì', !e && tokenUsato(p)[0] === UUID, e?.message);

  // ------------------------------------------------ fonti
  p = apri({ sw: { csrf: UUID2 }, html: paginaFlight() });
  e = await prova(p);
  ok('3. token visto nelle richieste di Vinted (per questo sito): ha la precedenza', !e && tokenUsato(p)[0] === UUID2);
  ok('   la richiesta al service worker dice il sito della pagina', p.messaggi.find((m) => m.type === 'vr:getTokens')?.origine === 'https://www.vinted.fr');
  for (const [nome, html] of [['<meta name="csrf-token">', paginaMeta()], ['__NEXT_DATA__ senza «\\»', paginaJson()]]) {
    p = apri({ html });
    e = await prova(p);
    ok(`4. forme già note: ${nome}`, !e && tokenUsato(p)[0] === UUID, e?.message);
  }
  p = apri({ html: '<!doctype html><html><body><script>var csrf_token_missing_message="Il token manca, riprova più tardi per favore"</script></body></html>' });
  e = await prova(p);
  ok('5. testi che somigliano a un token non vengono presi per token', e?.categoria === 'token-assente' && !tokenUsato(p).length, e?.message);

  // ------------------------------------------------ errori distinti
  p = apri({ nuova: { status: 200, html: paginaVuota } });
  e = await prova(p);
  ok('6. token in nessuna fonte: «token-assente», messaggio che non dice di ricaricare e basta', e?.categoria === 'token-assente' && /forme conosciute/.test(e.message) && /diagnostica/.test(e.message), e?.message);
  ok('   nessuna richiesta alle API senza token', !tokenUsato(p).length);
  p = apri({ nuova: { status: 200, url: 'https://www.vinted.fr/member/signup/select_type?ref_url=%2Fitems%2Fnew', html: '<html></html>' } });
  e = await prova(p);
  ok('7. pagina di pubblicazione rimandata all\'accesso: «sessione-scaduta»', e?.categoria === 'sessione-scaduta' && /accedi di nuovo/.test(e.message), e?.message);
  p = apri({ nuova: { status: 503, html: '' } });
  e = await prova(p);
  ok('8. pagina di pubblicazione con errore HTTP: «pagina-non-letta» con il codice', e?.categoria === 'pagina-non-letta' && /HTTP 503/.test(e.message), e?.message);
  p = apri({ nuova: 'rete' });
  e = await prova(p);
  ok('9. rete assente: «pagina-non-letta»', e?.categoria === 'pagina-non-letta' && /rete/.test(e.message), e?.message);
  p = apri({ sw: 'errore', html: paginaFlight() });
  e = await prova(p);
  ok('10. service worker che non risponde: il token della pagina basta', !e && tokenUsato(p)[0] === UUID, e?.message);
  p = apri({ sw: 'errore', nuova: { status: 200, html: paginaVuota } });
  e = await prova(p);
  ok('    …e senza token da nessuna parte: «comunicazione», lo dice', e?.categoria === 'comunicazione' && /service worker/.test(e.message), e?.message);
  p = apri({ sw: 'scollegata', html: paginaFlight() });
  e = await prova(p);
  ok('11. estensione ricaricata con la pagina aperta: «ricarica la pagina», niente richieste', e?.scollegata === true && /ricarica questa pagina/.test(e.message) && !tokenUsato(p).length, e?.message);

  // ------------------------------------------------ token cambiato / scaduto
  p = apri({ sw: { csrf: 'vecchio-token-scaduto-0000000000' }, html: paginaFlight(UUID), apiStatus: (t) => (t === UUID ? 200 : 403) });
  e = await prova(p);
  ok('12. 403 con il token visto prima: si riprova una volta con quello della pagina', !e && tokenUsato(p).join() === `vecchio-token-scaduto-0000000000,${UUID}`, e?.message || tokenUsato(p).join());
  ok('    il service worker dimentica il token rifiutato (senza che finisca in un log)', p.messaggi.some((m) => m.type === 'vr:tokenRifiutato' && m.csrf === 'vecchio-token-scaduto-0000000000'));
  p = apri({ html: paginaFlight(UUID), apiStatus: () => 403 });
  e = await prova(p);
  ok('13. 403 e nessun altro token: resta «antibot», nessun secondo tentativo con lo stesso token', e?.blocked === true && tokenUsato(p).length === 1, e?.message);
  p = apri({ html: paginaFlight(UUID), apiStatus: () => 401 });
  e = await prova(p);
  ok('14. 401: «sessione-scaduta», accedi di nuovo', e?.categoria === 'sessione-scaduta' && e.status === 401 && /accedi di nuovo/.test(e.message), e?.message);
  let corrente = UUID;
  p = apri({ sw: () => ({ csrf: corrente }) });
  await prova(p); corrente = UUID2;
  p.VR.api.dimenticaToken?.();
  await prova(p);
  ok('15. token cambiato durante la sessione: dopo l\'azzeramento si usa quello nuovo', tokenUsato(p).join() === `${UUID},${UUID2}`, tokenUsato(p).join());

  // ------------------------------------------------ prova senza rete (Salute)
  p = apri({ html: paginaFlight() });
  let r = (await p.VR.provaSessione?.()) || {};
  ok('16. provaSessione: pronta, fonte «pagina», nessun valore nella risposta', r.ok && r.fonte === 'pagina' && r.origine === 'https://www.vinted.fr' && !JSON.stringify(r).includes(UUID), JSON.stringify(r));
  ok('    nessuna richiesta di rete per la prova', p.richieste.length === 0);
  p = apri({ html: paginaVuota });
  r = (await p.VR.provaSessione?.()) || {};
  ok('17. provaSessione senza token nella pagina: «da-verificare», non «pronta»', !r.ok && r.categoria === 'non-nella-pagina' && p.richieste.length === 0, JSON.stringify(r));

  // ------------------------------------------------ stato riferito al service worker
  p = apri({ html: paginaFlight() });
  await prova(p);
  const stato = p.messaggi.filter((m) => m.type === 'vr:statoSessione').at(-1);
  ok('18. esito riferito al service worker: fonte e categoria, mai il token', stato?.esito === 'ok' && stato.fonte === 'pagina' && !JSON.stringify(p.messaggi.filter((m) => m.type === 'vr:statoSessione')).includes(UUID), JSON.stringify(stato));
  p = apri({ nuova: { status: 200, html: paginaVuota } });
  await prova(p);
  ok('    anche l\'errore, con la categoria', p.messaggi.some((m) => m.type === 'vr:statoSessione' && m.esito === 'errore' && m.categoria === 'token-assente'));

  // ------------------------------------------------ lingua della richiesta (dominio)
  p = apri({ html: paginaFlight() });
  await prova(p);
  ok('19. senza cookie della lingua: «locale» dalla pagina (fr-FR), non it-IT fisso', p.richieste.find((x) => x.url.includes('/api/v2/'))?.init.headers.locale === 'fr-FR');

  // ------------------------------------------------ traduzioni dei messaggi nuovi
  const I = require(path.join(__dirname, '..', 'src', 'i18n.js'));
  const messaggi = [];
  for (const opz of [{ nuova: { status: 200, html: paginaVuota } }, { nuova: { status: 200, url: 'https://www.vinted.fr/member/signup/x', html: '' } }, { nuova: { status: 503 } }, { nuova: 'rete' }, { sw: 'errore', nuova: { status: 200, html: paginaVuota } }, { html: paginaFlight(), apiStatus: () => 401 }]) {
    messaggi.push((await prova(apri(opz)))?.message);
  }
  const POPUP = ['pronta su vinted.fr: token letto dalla pagina aperta (non viene mostrato)', 'pronta su vinted.fr: token letto dalla pagina di pubblicazione (non viene mostrato)',
    'non pronta su vinted.fr: token di sessione non trovato nelle forme conosciute: manda la diagnostica', 'la scheda di vinted.fr non risponde (ancora in caricamento o con il codice di prima dell\'aggiornamento): ricaricala (F5)',
    'da verificare su vinted.fr: il token non è nella pagina aperta; al primo invio si cerca nella pagina di pubblicazione', 'nessuna scheda di Vinted aperta: serve per pubblicare', 'Sessione di Vinted non letta'];
  for (const l of ['en', 'fr', 'es', 'de']) {
    I.imposta(l, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'lang', `${l}.json`), 'utf8')));
    const rimasti = [...messaggi, ...POPUP].filter((m) => { const t = I.traduci(m); return !m || t === m || /\b(pagina|sessione|scheda|letto|pronta|riprova|accedi)\b/.test(t); });
    ok(`20. ${l}: messaggi della sessione tradotti`, !rimasti.length, rimasti.join(' | '));
  }

  const ko = out.filter((x) => x.includes('FAIL')).length;
  console.log(out.join('\n'));
  console.log(`${out.length - ko} OK, ${ko} FAIL`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
