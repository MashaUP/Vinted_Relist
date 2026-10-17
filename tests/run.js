// Esegue tutte le suite e riassume. I test DOM richiedono `npm install` in questa cartella.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const suite = [
  ...fs.readdirSync(__dirname).filter((f) => /^test-.*\.js$/.test(f)).sort(),
  ...fs.readdirSync(path.join(__dirname, 'dom')).filter((f) => /^test-.*\.js$/.test(f)).sort().map((f) => `dom/${f}`),
];
let jsdom = true;
try { require.resolve('jsdom', { paths: [__dirname] }); } catch { jsdom = false; }

let totOk = 0, totFail = 0, saltate = 0;
for (const s of suite) {
  if (s.startsWith('dom/') && !jsdom) { console.log(`- ${s}: saltata (manca jsdom, esegui npm install)`); saltate++; continue; }
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { encoding: 'utf8', cwd: path.dirname(path.join(__dirname, s)) });
  const out = `${r.stdout}${r.stderr}`;
  const ok = (out.match(/^\s*OK\b/gm) || []).length;
  const fail = (out.match(/^\s*FAIL\b/gm) || []).length + (r.status && !/FAIL/.test(out) ? 1 : 0);
  totOk += ok; totFail += fail;
  console.log(`${fail ? '✗' : '✓'} ${s}: ${ok} OK${fail ? `, ${fail} FAIL` : ''}`);
  if (fail) console.log(out.split('\n').filter((l) => /FAIL|Error/.test(l)).slice(0, 10).map((l) => `    ${l.trim()}`).join('\n'));
}
console.log(`\nTotale: ${totOk} OK, ${totFail} FAIL${saltate ? `, ${saltate} suite saltate` : ''}`);
process.exit(totFail ? 1 : 0);
