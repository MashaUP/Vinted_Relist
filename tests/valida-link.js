#!/usr/bin/env node
// Controlla un links.json prima di pubblicarlo: le stesse regole che usa l'estensione.
//   node tests/valida-link.js            → controlla links.json nella radice del repository
//   node tests/valida-link.js altro.json → controlla un altro file
const fs = require('fs');
const path = require('path');
const L = require(path.join(__dirname, '..', 'src', 'link.js'));

const file = process.argv[2] || path.join(__dirname, '..', 'links.json');
let testo;
try {
  testo = fs.readFileSync(file, 'utf8');
} catch (e) {
  console.error(`Non riesco a leggere ${file}: ${e.message}`);
  process.exit(2);
}

const r = L.valida(testo);
if (!r.ok) {
  console.error(`NON VALIDO: ${r.errore}`);
  process.exit(1);
}
console.log(`${path.basename(file)}: schema ${L.SCHEMA}, progetto ${L.PROGETTO}, revision ${r.revision}`);
for (const v of L.elenco(L.risolvi({ predefinita: r }))) console.log(`  acceso  ${v.id.padEnd(16)} ${v.url}`);
for (const [id, v] of Object.entries(r.links)) if (!v.enabled) console.log(`  spento  ${id}`);
for (const s of r.scartati) console.log(`  SCARTATO ${s.id}: ${s.motivo}`);
if (r.scartati.length) {
  console.error(`\n${r.scartati.length} voci scartate: l'estensione userebbe le altre, ma conviene correggerle.`);
  process.exit(1);
}
console.log('\nOK: si può pubblicare. Ricorda di aumentare "revision" a ogni modifica.');
