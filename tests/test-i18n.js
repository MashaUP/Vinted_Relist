// 2.6.0 — Lingue: scelta, traduzione dei testi (esatti, con parti variabili, a pezzi),
// dizionari coerenti, traduzione del DOM (pagine dell'estensione e solo l'estensione su Vinted),
// ritorno all'italiano, testi dell'utente mai tradotti, copertura dei testi del codice.
const fs = require('fs');
const path = require('path');
const out = []; const ok = (n, c, extra = '') => out.push(`  ${c ? 'OK  ' : 'FAIL'} ${n}${!c && extra ? ` — ${extra}` : ''}`);
const RADICE = path.join(__dirname, '..');
const I = require('../src/i18n.js');
const LINGUE = ['en', 'fr', 'es', 'de'];
const diz = Object.fromEntries(LINGUE.map((l) => [l, JSON.parse(fs.readFileSync(path.join(RADICE, 'src/lang', `${l}.json`), 'utf8'))]));
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ------------------------------------------------------------ scelta
  ok('L1. automatica: lingua del browser se è fra le nostre (fr-FR → fr, de-AT → de)', I.scegli('auto', 'fr-FR') === 'fr' && I.scegli('auto', 'de-AT') === 'de' && I.scegli(undefined, 'es') === 'es');
  ok('L2. automatica con una lingua che non abbiamo (pt, pl): inglese', I.scegli('auto', 'pt-PT') === 'en' && I.scegli('auto', 'pl') === 'en' && I.scegli('auto', '') === 'en');
  ok('L3. scelta esplicita: vince sul browser; codice sconosciuto → automatica', I.scegli('it', 'fr-FR') === 'it' && I.scegli('xx', 'de') === 'de');

  // ------------------------------------------------------------ traduzione dei testi
  I.imposta('fr', diz.fr);
  ok('T1. testo esatto', I.traduci('Ripubblica') === 'Republier' && I.traduci('Modifica') === 'Modifier');
  ok('T2. spazi intorno conservati', I.traduci('  Ripubblica\n') === '  Republier\n');
  ok('T3. con parti variabili: «Aggiungi {0} come {1}»', I.traduci('Aggiungi 3 come Batch 2') === 'Ajouter 3 comme Lot 2', I.traduci('Aggiungi 3 come Batch 2'));
  ok('T4. la parte variabile si traduce a sua volta («Errore: …»)', I.traduci('Coda fermata da sola: leggi gli errori, poi Riprendi') === "File arrêtée d'elle-même : lisez les erreurs, puis Reprendre", I.traduci('Coda fermata da sola: leggi gli errori, poi Riprendi'));
  ok('T5. numero davanti a una parola nota: «3 articoli»', I.traduci('3 articoli') === '3 articles' && I.traduci('12 foto') === '12 photos');
  ok('T6. testo composto a pezzi (·): ogni pezzo noto si traduce', I.traduci('Pausa · Riprendi') === 'Pause · Reprendre', I.traduci('Pausa · Riprendi'));
  ok('T7. testo sconosciuto: resta com\'è', I.traduci('Borsa nera Zara taglia M') === 'Borsa nera Zara taglia M' && I.traduci('12,50 €') === '12,50 €');
  ok('T8. t(): chiave con valori', I.t('Batch {0}', 4) === 'Lot 4' && I.t('Pausa') === 'Pause');
  I.imposta('de', diz.de);
  ok('T9. tedesco: stessi meccanismi', I.traduci('Coda') === 'Warteschlange' && I.traduci('Aggiungi alla coda (5)') === 'Zur Warteschlange hinzufügen (5)');
  I.imposta('it', null);
  ok('T10. italiano: niente cambia, t() riempie i valori', I.traduci('Ripubblica') === 'Ripubblica' && I.t('Batch {0}', 2) === 'Batch 2');
  I.imposta('en', diz.en);
  ok('T11. il consiglio sul modello (bug dei telefoni) è tradotto', /Vinted is asking for the item's model/.test(I.traduci("Vinted chiede il modello dell'articolo. Apri l'annuncio su Vinted, «Modifica», controlla che il modello sia scelto e salva: l'estensione impara così i campi di questa categoria. Poi riprova; se non basta, manda il report diagnostico (popup › Diagnostica).")));
  ok('T12. errore di Vinted + consiglio: «… — consiglio» tradotto a pezzi', /— Vinted is asking for the item's model/.test(I.traduci("model: Seleziona il modello — Vinted chiede il modello dell'articolo. Apri l'annuncio su Vinted, «Modifica», controlla che il modello sia scelto e salva: l'estensione impara così i campi di questa categoria. Poi riprova; se non basta, manda il report diagnostico (popup › Diagnostica).")));

  // ------------------------------------------------------------ dizionari
  const chiavi = LINGUE.map((l) => Object.keys(diz[l]).sort().join('\n'));
  ok('D1. le quattro lingue hanno le stesse voci', chiavi.every((k) => k === chiavi[0]), LINGUE.map((l) => Object.keys(diz[l]).length).join('/'));
  const ph = (s) => (s.match(/\{\d+\}/g) || []).sort().join();
  const rotte = LINGUE.flatMap((l) => Object.entries(diz[l]).filter(([k, v]) => !v || typeof v !== 'string' || ph(k) !== ph(v)).map(([k]) => `${l}: ${k}`));
  ok('D2. nessuna traduzione vuota e segnaposto {n} identici', rotte.length === 0, rotte.slice(0, 3).join(' | '));
  ok('D3. oltre 1300 voci per lingua', Object.keys(diz.en).length > 1300);
  const manifest = JSON.parse(fs.readFileSync(path.join(RADICE, 'manifest.json'), 'utf8'));
  ok('D4. nessun file di lingua esposto a Vinted (web_accessible_resources)', !JSON.stringify(manifest.web_accessible_resources || []).includes('lang'));

  // ------------------------------------------------------------ DOM
  let JSDOM = null;
  try { ({ JSDOM } = require('jsdom')); } catch { JSDOM = null; }
  if (JSDOM) {
    const dom = new JSDOM(`<!DOCTYPE html><html lang="it"><head><title>Vinted Relist — Armadio</title></head><body>
      <h1>Il tuo armadio</h1><button id="b" title="Impostazioni" aria-label="Impostazioni">Riprendi</button>
      <input id="i" placeholder="Cerca per titolo…"><a href="https://www.vinted.it/items/1-x" id="titolo">Pausa</a>
      <p id="np" data-vr-noi18n>Ripubblica</p><textarea id="ta">Ripubblica</textarea></body></html>`, { pretendToBeVisual: true });
    const w = dom.window; const d = w.document;
    I.imposta('it', null);
    I.collega(d);
    await I.applica('fr', async () => diz.fr);
    ok('M1. pagina dell\'estensione: testi, title, aria-label, placeholder e <title> tradotti', d.querySelector('h1').textContent === 'Votre dressing' && d.getElementById('b').textContent === 'Reprendre'
      && d.getElementById('b').title === 'Réglages' && d.getElementById('b').getAttribute('aria-label') === 'Réglages' && d.getElementById('i').placeholder === 'Chercher par titre…' && d.title === 'Vinted Relist — Dressing' && d.documentElement.lang === 'fr', `${d.querySelector('h1').textContent} | ${d.title}`);
    ok('M2. titoli degli annunci (link agli articoli), data-vr-noi18n e textarea: mai tradotti', d.getElementById('titolo').textContent === 'Pausa' && d.getElementById('np').textContent === 'Ripubblica' && d.getElementById('ta').value === 'Ripubblica');
    const nuovo = d.createElement('div'); nuovo.innerHTML = '<span>Coda in pausa</span><button title="Chiudi">Annulla</button>';
    d.body.append(nuovo);
    await tick();
    ok('M3. elementi aggiunti dopo: tradotti dall\'osservatore', nuovo.textContent === 'File en pauseAnnuler' && nuovo.querySelector('button').title === 'Fermer', nuovo.textContent);
    d.getElementById('b').textContent = 'Pausa';
    await tick();
    ok('M4. il codice cambia un testo: si traduce il nuovo', d.getElementById('b').textContent === 'Pause');
    d.getElementById('b').firstChild.nodeValue = 'Riprendi';
    await tick();
    ok('M5. anche cambiando il nodo di testo direttamente (characterData)', d.getElementById('b').textContent === 'Reprendre');
    await I.applica('de', async () => diz.de);
    ok('M6. cambio di lingua al volo: ritradotto dall\'originale italiano', d.querySelector('h1').textContent === 'Ihr Kleiderschrank' && nuovo.querySelector('span').textContent === 'Warteschlange pausiert' && d.getElementById('b').title === 'Einstellungen');
    await I.applica('it', async () => null);
    ok('M7. ritorno all\'italiano: tornano gli originali', d.querySelector('h1').textContent === 'Il tuo armadio' && nuovo.querySelector('span').textContent === 'Coda in pausa' && d.getElementById('b').title === 'Impostazioni' && d.getElementById('i').placeholder === 'Cerca per titolo…');
    await I.applica('es', async () => { throw new Error('rete'); });
    ok('M8. dizionario non caricabile: resta in italiano, niente si rompe', I.lingua === 'it' && d.querySelector('h1').textContent === 'Il tuo armadio');

    // pagina di Vinted: solo gli elementi dell'estensione
    const v = new JSDOM(`<!DOCTYPE html><html><body><header><a>Coda</a><span>Pausa</span></header>
      <div class="feed"><div class="vr-bar"><button>Ripubblica</button><button title="Modifica">Modifica</button></div><p>Riprendi</p></div></body></html>`, { pretendToBeVisual: true });
    const vd = v.window.document;
    I.collega(vd, { dentro: (n) => Boolean(n?.closest?.('[class^="vr-"], [class*=" vr-"], [data-vr-ui]')) });
    await I.applica('es', async () => diz.es);
    ok('M9. su Vinted: tradotti i bottoni dell\'estensione', [...vd.querySelectorAll('.vr-bar button')].map((b) => b.textContent).join() === 'Republicar,Editar' && vd.querySelector('.vr-bar button[title]').title === 'Editar');
    ok('M10. su Vinted: il sito non si tocca (header, testi fuori dall\'estensione, lingua della pagina)', vd.querySelector('header').textContent === 'CodaPausa' && vd.querySelector('.feed > p').textContent === 'Riprendi' && !vd.documentElement.getAttribute('lang'));
    const toast = vd.createElement('div'); toast.className = 'vr-toast vr-toast--ok'; toast.textContent = 'Articolo ripubblicato.';
    vd.body.append(toast);
    await tick();
    ok('M11. su Vinted: avvisi aggiunti dopo dall\'estensione tradotti', toast.textContent === 'Artículo republicado.', toast.textContent);
  } else {
    out.push('  -    M. DOM: saltato (jsdom non installato: cd tests && npm install)');
  }

  // ------------------------------------------------------------ copertura dei testi del codice
  let catalogo = null;
  try { catalogo = require('../scripts/i18n-estrai.js'); } catch { catalogo = null; }
  if (catalogo) {
    const codice = /^(\{\d+\}|[A-Z][A-Za-z-]+|[a-z]+[\s/:#.*;[\]=_-].*|.*[/.](json|md|png|html|js)(#.*)?|var\(.*|(btn|desc|hint|tag|num|q-row|health)\b.*|[A-Z]{2,}|use strict|SHA-256|EUR|Vintory|Vinted Relist.*|MashaUP\/Vinted_Relist|Alt|Escape|NFD|array\(\{0\}\)|color1_id=.*|\{0\} MB|HTTP \{0\}|ID \{0\}|\{0\} min|photos\/\{0\}\/|;base64,)$/;
    const senza = catalogo.filter((v) => !(v.t in diz.en) && !codice.test(v.t));
    ok(`C1. testi dell'interfaccia senza traduzione: ${senza.length} (pezzi di frasi composte)`, senza.length <= 25, senza.slice(0, 5).map((v) => v.t).join(' | '));
  } else {
    out.push('  -    C. copertura: saltata (acorn non installato: cd tests && npm install)');
  }

  console.log(out.join('\n'));
  const ko = out.filter((x) => x.includes('FAIL')).length;
  console.log(`${out.filter((x) => x.includes(' OK ')).length} OK, ${ko} FAIL`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
