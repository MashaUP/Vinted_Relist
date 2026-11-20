// Estrae i testi italiani dell'interfaccia (stringhe, template con {0},{1}…, testo degli HTML)
// e dice quali non hanno ancora una traduzione in src/lang/*.json.
//   node scripts/i18n-estrai.js [cartella-del-progetto] [uscita.json]
// Usa acorn, acorn-walk e parse5 (devDependencies di tests/package.json).
const fs = require('fs'), path = require('path');
const req = (m) => require(require.resolve(m, { paths: [path.join(__dirname, '..', 'tests'), process.cwd()] }));
const acorn = req('acorn'), walk = req('acorn-walk'), parse5 = req('parse5');
const DIR = process.argv[2] || path.join(__dirname, '..');
const file = fs.readdirSync(path.join(DIR, 'src')).filter((f) => /\.(js|html)$/.test(f)).map((f) => path.join('src', f)).concat(['background.js']);
const SALTA = new Set(['src/i18n.js', 'src/page-bridge.js', 'src/vintory-zip.js', 'src/vintory-db.js', 'src/link.js', 'src/link-chrome.js']);
const voci = new Map();
const parola = /[a-zàèéìòù]{2,}/i;
const sembraTesto = (s) => {
  const t = s.trim();
  if (t.length < 2 || !parola.test(t)) return false;
  if (/^[a-z][a-zA-Z0-9_:.-]*$/.test(t)) return false;           // chiavi, classi, tipi di messaggio
  if (/^(https?:|chrome|\/|\.|#|\[|data:|image\/|application\/|vr[:-]|[a-z-]+\s*[:{]|@)/.test(t)) return false;
  if (/^[\w-]+(\s+[\w.#[\]=-]+)*$/.test(t) && !/[A-ZÀ-Ü]/.test(t[0]) && !/\s/.test(t)) return false;
  if (/[{};]\s*$/.test(t) && /[:;]/.test(t) && !/\s[a-zàèéìòù]+\s/i.test(t)) return false;
  if (/^(GET|POST|PUT|DELETE)\b/.test(t)) return false;
  if (/^[a-z0-9_]+(,\s*[a-z0-9_]+)+$/i.test(t)) return false;
  if (/^(input|button|div|span|a|li|ul|img|label|select|option|textarea)([.#[:\s>,]|$)/.test(t)) return false;
  return true;
};
function aggiungi(testo, dove) {
  const t = testo.replace(/\s+/g, ' ').trim();
  if (!sembraTesto(t)) return;
  if (!voci.has(t)) voci.set(t, new Set());
  voci.get(t).add(dove);
}
for (const f of file) {
  if (SALTA.has(f)) continue;
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  if (f.endsWith('.html')) {
    const doc = parse5.parse(src);
    const visita = (n) => {
      if (n.nodeName === 'script' || n.nodeName === 'style') return;
      if (n.nodeName === '#text') aggiungi(n.value, f);
      for (const a of n.attrs || []) if (['title', 'placeholder', 'aria-label', 'alt', 'content'].includes(a.name)) aggiungi(a.value, f);
      for (const c of n.childNodes || []) visita(c);
      if (n.content) visita(n.content);
    };
    visita(doc);
    continue;
  }
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }); } catch (e) { console.error(f, e.message); continue; }
  // Testi dentro console.*, VR.log/warn: solo per lo sviluppo, non si traducono.
  const esclusi = [];
  walk.full(ast, (n) => {
    if (n.type !== 'CallExpression') return;
    const c = n.callee;
    const nome = c.type === 'MemberExpression' ? `${c.object.name || c.object.property?.name || ''}.${c.property.name || ''}` : c.name;
    if (/^(console\.\w+|VR\.(log|warn|debug)|RegExp\.|\.querySelector(All)?|\.closest|\.matches)$/.test(nome) || /^(RegExp|importScripts|querySelector|querySelectorAll|closest|matches|addEventListener|getAttribute|setAttribute|removeAttribute)$/.test(c.property?.name || c.name || '')) esclusi.push([n.start, n.end]);
  });
  const fuori = (n) => esclusi.some(([a, b]) => n.start >= a && n.end <= b);
  // Concatenazioni "a" + x + "b": il testo che arriva nel DOM e' quello intero.
  walk.full(ast, (n) => {
    if (n.type !== 'BinaryExpression' || n.operator !== '+' || fuori(n)) return;
    const pezzi = [];
    let k = 0;
    const piatta = (e) => {
      if (e.type === 'BinaryExpression' && e.operator === '+') { piatta(e.left); piatta(e.right); return; }
      if (e.type === 'Literal' && typeof e.value === 'string') { pezzi.push(e.value); return; }
      if (e.type === 'TemplateLiteral') { e.quasis.forEach((q, i) => { pezzi.push(q.value.cooked ?? q.value.raw); if (i < e.expressions.length) pezzi.push(`{${k++}}`); }); return; }
      pezzi.push(`{${k++}}`);
    };
    piatta(n);
    const t = pezzi.join('');
    if (pezzi.length > 1 && parola.test(t.replace(/\{\d+\}/g, '')) && t.replace(/\{\d+\}/g, '').trim().length > 12) aggiungi(t, f);
  });
  walk.full(ast, (n) => {
    if ((n.type === 'Literal' || n.type === 'TemplateLiteral') && fuori(n)) return;
    if (n.type === 'Literal' && typeof n.value === 'string') aggiungi(n.value, f);
    if (n.type === 'TemplateLiteral') {
      const pezzi = [];
      n.quasis.forEach((q, i) => { pezzi.push(q.value.cooked ?? q.value.raw); if (i < n.expressions.length) pezzi.push(`{${i}}`); });
      const t = pezzi.join('');
      if (n.expressions.length && !parola.test(t.replace(/\{\d+\}/g, ''))) return;
      aggiungi(t, f);
    }
  });
}
const elenco = [...voci.entries()].map(([t, d]) => ({ t, d: [...d] }));
module.exports = elenco;
if (require.main === module) {
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(elenco, null, 1));
  const en = JSON.parse(fs.readFileSync(path.join(DIR, 'src/lang/en.json'), 'utf8'));
  const senza = elenco.filter((v) => !(v.t in en));
  console.log(`${elenco.length} testi, ${senza.length} senza traduzione (molti sono codice: classi, URL, chiavi):`);
  for (const v of senza) console.log(`  ${JSON.stringify(v.t)}  ← ${v.d.join(', ')}`);
}
