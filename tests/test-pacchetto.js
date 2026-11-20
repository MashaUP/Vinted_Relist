// 2.7.0 — Pacchetto (scripts/pacchetto.sh) e version.json, come da standard comuni (sez. 2 e 5):
// cartella Vinted_Relist/ nello zip, niente file di sviluppo, zip riproducibile, sha256 in
// version.json uguale allo zip nella radice, un solo zip nella radice.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const out = []; const ok = (n, c, extra = '') => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}${!c && extra ? ` — ${extra}` : ''}`);
const RADICE = path.join(__dirname, '..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const manifest = JSON.parse(fs.readFileSync(path.join(RADICE, 'manifest.json'), 'utf8'));
const vj = JSON.parse(fs.readFileSync(path.join(RADICE, 'version.json'), 'utf8'));
const NOME = `Vinted_Relist-${manifest.version}.zip`;

// version.json
ok('1. version.json: stessa versione del manifest, data, note come elenco (≤12 da ≤300)',
  vj.version === manifest.version && /^\d{4}-\d{2}-\d{2}$/.test(vj.date) && Array.isArray(vj.notes) && vj.notes.length >= 1 && vj.notes.length <= 12 && vj.notes.every((n) => typeof n === 'string' && n.length <= 300));
ok('2. version.json: zip con il nome giusto e sha256 di 64 caratteri', vj.zip === NOME && /^[a-f0-9]{64}$/.test(vj.sha256 || ''), `${vj.zip} ${vj.sha256}`);
const zipRadice = fs.readdirSync(RADICE).filter((f) => /^Vinted_Relist-.*\.zip$/.test(f));
ok('3. un solo zip nella radice, quello della versione', zipRadice.length === 1 && zipRadice[0] === NOME, zipRadice.join(', '));
ok('4. lo sha256 di version.json è quello dello zip nella radice', fs.existsSync(path.join(RADICE, NOME)) && sha(path.join(RADICE, NOME)) === vj.sha256);

// pacchetto
const a = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-pk-a-'));
const b = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-pk-b-'));
let ris = '';
try {
  ris = execFileSync('bash', [path.join(RADICE, 'scripts', 'pacchetto.sh'), a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('bash', [path.join(RADICE, 'scripts', 'pacchetto.sh'), `v${manifest.version}`, b], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  ok('5. lo script di pacchetto termina senza errori', false, String(e.stderr || e.message).slice(0, 400));
}
const za = path.join(a, NOME); const zb = path.join(b, NOME);
if (fs.existsSync(za) && fs.existsSync(zb)) {
  ok('5. lo script di pacchetto termina senza errori', /Creato/.test(ris));
  const elenco = execFileSync('unzip', ['-Z1', za], { encoding: 'utf8' }).trim().split('\n');
  ok('6. tutto dentro la cartella Vinted_Relist/, con il manifest', elenco.every((f) => f.startsWith('Vinted_Relist/')) && elenco.includes('Vinted_Relist/manifest.json'));
  ok('7. niente file di sviluppo nello zip', !elenco.some((f) => /^Vinted_Relist\/(tests|docs|scripts|\.github|node_modules)\/|package(-lock)?\.json$|eslint\.config\.js$|version\.json$|\.zip$/.test(f)));
  ok('8. avvertenze, guide in 5 lingue e licenza nello zip', ['DISCLAIMER.md', 'README.md', 'README.en.md', 'README.fr.md', 'README.es.md', 'README.de.md', 'LICENSE', 'CHANGELOG.md'].every((f) => elenco.includes(`Vinted_Relist/${f}`)));
  ok('9. riproducibile: due pacchetti di fila hanno lo stesso SHA-256', sha(za) === sha(zb));
  ok('10. file .sha256 accanto allo zip', fs.readFileSync(`${za}.sha256`, 'utf8').trim() === `${sha(za)}  ${NOME}`);
  // Solo un avviso: un README corretto dopo il rilascio cambia lo zip ricostruito ma non chiede
  // una versione nuova (G6). Lo zip nella radice resta quello verificato da version.json (test 4).
  if (!(fs.existsSync(path.join(RADICE, NOME)) && sha(za) === sha(path.join(RADICE, NOME)))) {
    out.push('  NOTA lo zip ricostruito è diverso da quello nella radice: sorgenti cambiati dopo l\'ultimo «npm run package»');
  }
}
// tag sbagliato: si ferma
let fermo = false;
try { execFileSync('bash', [path.join(RADICE, 'scripts', 'pacchetto.sh'), 'v0.0.1', a], { stdio: 'pipe' }); } catch (e) { fermo = /manifest\.json dice/.test(String(e.stderr)); }
ok('12. tag diverso dalla versione: il pacchetto si ferma', fermo);
fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true });

const ko = out.filter((r) => r.includes('FAIL')).length;
const okN = out.filter((r) => r.includes(' OK ')).length;
console.log(out.join('\n'));
console.log(`${okN} OK, ${ko} FAIL`);
process.exit(ko ? 1 : 0);
