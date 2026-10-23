// Moduli puri 2.0: versioni, aggiornamenti, diagnostica, impostazioni.
const V = require(require('path').join(__dirname, '..', 'src/versione.js'));
const I = require(require('path').join(__dirname, '..', 'src/impostazioni.js'));
const out = []; const ok = (n, c) => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}`);

ok('1.10.0 dopo 1.9.0 (numerico, non alfabetico)', V.confrontaVersioni('1.10.0', '1.9.0') === 1);
ok('uguali', V.confrontaVersioni('2.0.0', '2.0.0') === 0);
ok('non semver → null', V.confrontaVersioni('2.0', '2.0.0') === null && V.confrontaVersioni('v2.0.0', '2.0.0') === null);

let r = V.leggiVersioneRemota('{"version":"2.1.0","zip":"Vinted_Relist-2.1.0.zip","notes":["a",3,"b"],"date":"2026-11-01"}');
ok('version.json valido', r.ok && r.versione === '2.1.0' && r.zip === 'Vinted_Relist-2.1.0.zip' && r.note.join() === 'a,b' && r.data === '2026-11-01');
r = V.leggiVersioneRemota('{"version":"2.1.0","zip":"../../evil.exe"}');
ok('zip con nome inatteso scartato', r.ok && r.zip === null);
ok('JSON rotto', !V.leggiVersioneRemota('{').ok);
ok('versione mancante', !V.leggiVersioneRemota('{"zip":"x"}').ok);
const b64 = Buffer.from(JSON.stringify({ version: '3.0.0', notes: ['è nuovo'] })).toString('base64');
r = V.leggiVersioneRemota(JSON.stringify({ encoding: 'base64', content: b64.slice(0, 10) + '\n' + b64.slice(10) }));
ok('risposta GitHub in base64 (con a capo e accenti)', r.ok && r.versione === '3.0.0' && r.note[0] === 'è nuovo');
ok('note troncate a 12', V.leggiVersioneRemota({ version: '1.0.0', notes: Array(20).fill('x') }).note.length === 12);

ok('stato: disponibile', V.statoAggiornamento('2.0.0', { ok: true, versione: '2.0.1' }).stato === 'disponibile');
ok('stato: aggiornata', V.statoAggiornamento('2.0.0', { ok: true, versione: '2.0.0' }).stato === 'aggiornata');
ok('stato: avanti', V.statoAggiornamento('2.1.0', { ok: true, versione: '2.0.0' }).stato === 'avanti');
ok('stato: errore', V.statoAggiornamento('2.0.0', { ok: false, errore: 'x' }).stato === 'errore');
ok('url con repository personalizzato', V.urlVersione('a/b') === 'https://api.github.com/repos/a/b/contents/version.json' && V.urlZip('Vinted_Relist-1.0.0.zip', 'a/b') === 'https://github.com/a/b/raw/HEAD/Vinted_Relist-1.0.0.zip');
ok('un controllo al minuto', !V.puoControllare({ at: 1000 }, 30000) && V.puoControllare({ at: 1000 }, 62000) && V.puoControllare(null));
ok('404 spiegato', /pubblico/.test(V.erroreGithub(404)) && /limitato/.test(V.erroreGithub(403)) && /raggiungibile/.test(V.erroreGithub(0)));
ok('Ko-fi non più in versione.js (sta in links.json)', !('KOFI' in V));

const md = '# Changelog\n\n## 2.0.0 · Grande (17 ottobre 2026)\n- **uno**\n- `due`\n\n## 1.9.0 - Editor\n* tre\n## 1.8.0\n- quattro\n';
const sez = V.sezioniChangelog(md, 2);
ok('changelog: sezioni e voci ripulite', sez.length === 2 && sez[0].titolo === 'Grande (17 ottobre 2026)' && sez[0].righe.join() === 'uno,due' && sez[1].titolo === 'Editor');

const diag = V.costruisciDiagnostica({ versione: '2.0.0', impostazioni: { delayMs: 1200, userId: '99', colorMap: { 1: 'x' } },
  eventi: [{ at: 0, kind: 'error', title: 'X https://www.vinted.it/items/5', text: 'mail a@b.it id 123e4567-e89b-12d3-a456-426614174000' }],
  controlli: [{ ok: true, nome: 'Sessione', dettaglio: 'ok' }] });
ok('diagnostica: niente id utente o dati appresi', !/userId|colorMap|99/.test(diag) && /delayMs: 1200/.test(diag));
ok('diagnostica: url, email, uuid oscurati', /\[url\]/.test(diag) && /\[email\]/.test(diag) && /\[uuid\]/.test(diag));

ok('fasce valide', I.validaFasce('12:30-14:00, 19:30-22:30').fasce.length === 2);
ok('fascia vuota', !I.validaFasce('').ok);
ok('orario inesistente', /inesistente/.test(I.validaFasce('25:00-26:00').errore));
ok('mezzanotte', /mezzanotte/.test(I.validaFasce('23:00-01:00').errore));
ok('formato', /formato/.test(I.validaFasce('mattina').errore));
ok('delayMs minimo 300', !I.validaImpostazione('delayMs', '299').ok && I.validaImpostazione('delayMs', '300').valore === 300);
ok('numeri non interi rifiutati', !I.validaImpostazione('autoRuleMax', '2.5').ok && !I.validaImpostazione('autoRuleMax', '').ok);
ok('scelte chiuse', !I.validaImpostazione('order', 'boh').ok && I.validaImpostazione('toastDuration', 'long').ok);
ok('repository', I.validaImpostazione('updateRepo', 'MashaUP/Vinted_Relist').ok && !I.validaImpostazione('updateRepo', 'https://x').ok && I.validaImpostazione('updateRepo', '').valore === '');
ok('chiave sconosciuta', !I.validaImpostazione('userId', '1').ok);

const exp = I.esportaImpostazioni({ delayMs: 900, userId: '5', colorMap: {}, photoFormat: {}, peakOnly: true }, '2.0.0');
ok('esporta solo impostazioni', Object.keys(exp.impostazioni).sort().join() === 'delayMs,peakOnly' && exp.formato === 'vinted-relist-impostazioni');
r = I.importaImpostazioni(JSON.stringify({ ...exp, impostazioni: { ...exp.impostazioni, delayMs: 5, userId: '9', canary: false } }));
ok('importa: valide sì, invalide e sconosciute scartate', r.ok && r.valori.peakOnly === true && r.valori.canary === false && !('delayMs' in r.valori) && r.scartate.sort().join() === 'delayMs,userId');
ok('importa: file estraneo rifiutato', !I.importaImpostazioni('{"a":1}').ok && !I.importaImpostazioni('nope').ok);

console.log(out.join('\n'));
process.exit(out.some((x) => x.includes('FAIL')) ? 1 : 0);
