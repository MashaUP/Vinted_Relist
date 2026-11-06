#!/usr/bin/env bash
# Crea lo zip dell'estensione pronto per «Carica estensione non pacchettizzata»:
# manifest.json nella radice dell'archivio, solo i file che servono al browser.
# Lo usa il workflow delle release (.github/workflows/release.yml) e si puo'
# lanciare a mano:  scripts/pacchetto.sh [versione-attesa] [cartella-di-uscita]
# Esce con errore se la versione non coincide o se manca un file del manifest.
set -euo pipefail

RADICE="$(cd "$(dirname "$0")/.." && pwd)"
ATTESA="${1:-}"
USCITA="${2:-$RADICE/dist}"

VERSIONE="$(node -p "require('$RADICE/manifest.json').version")"
if [[ -n "$ATTESA" && "${ATTESA#v}" != "$VERSIONE" ]]; then
  echo "::error::La release è ${ATTESA} ma manifest.json dice ${VERSIONE}: allinea le versioni prima di pubblicare." >&2
  exit 1
fi
VERSIONE_JSON="$(node -p "require('$RADICE/version.json').version")"
if [[ "$VERSIONE_JSON" != "$VERSIONE" ]]; then
  echo "::error::version.json dice ${VERSIONE_JSON}, manifest.json ${VERSIONE}: «Cerca aggiornamento» darebbe informazioni sbagliate." >&2
  exit 1
fi

NOME="Vinted_Relist-${VERSIONE}.zip"
LAVORO="$(mktemp -d)"
trap 'rm -rf "$LAVORO"' EXIT

# Solo quello che il browser carica, piu' licenza e istruzioni. Niente test,
# documentazione di sviluppo, workflow, script, zip vecchi.
FILE=(manifest.json background.js links.json README.md CHANGELOG.md LICENSE)
CARTELLE=(src icons)
for f in "${FILE[@]}"; do
  [[ -f "$RADICE/$f" ]] || { echo "::error::Manca $f" >&2; exit 1; }
  cp "$RADICE/$f" "$LAVORO/"
done
for d in "${CARTELLE[@]}"; do
  [[ -d "$RADICE/$d" ]] || { echo "::error::Manca la cartella $d" >&2; exit 1; }
  cp -R "$RADICE/$d" "$LAVORO/"
done
find "$LAVORO" \( -name '.DS_Store' -o -name 'Thumbs.db' -o -name '*.log' -o -name '*~' \) -delete

# Ogni file nominato dal manifest deve esserci.
node -e '
  const fs = require("fs"), path = require("path");
  const dir = process.argv[1];
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const file = [
    m.background?.service_worker,
    ...(m.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
    m.action?.default_popup, m.options_page, ...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {}),
    ...(m.web_accessible_resources || []).flatMap((w) => w.resources || []).filter((r) => !r.includes("*")),
  ].filter(Boolean);
  const mancanti = file.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (mancanti.length) { console.error("::error::File del manifest mancanti: " + mancanti.join(", ")); process.exit(1); }
  // importScripts del service worker
  const sw = fs.readFileSync(path.join(dir, m.background.service_worker), "utf8");
  const importati = [...sw.matchAll(/importScripts\(([^)]*)\)/g)].flatMap((x) => [...x[1].matchAll(/"([^"]+)"/g)].map((y) => y[1]));
  const persi = importati.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (persi.length) { console.error("::error::Script importati mancanti: " + persi.join(", ")); process.exit(1); }
' "$LAVORO"

mkdir -p "$USCITA"
rm -f "$USCITA/$NOME"
(cd "$LAVORO" && zip -qrX "$USCITA/$NOME" .)

# Controllo dell'archivio: manifest.json nella radice, nessun file di sviluppo.
ELENCO="$(unzip -Z1 "$USCITA/$NOME")"
grep -qx 'manifest.json' <<<"$ELENCO" || { echo "::error::manifest.json non è nella radice dello zip" >&2; exit 1; }
if grep -Eq '^(tests|docs|scripts|\.github|node_modules)/|\.zip$' <<<"$ELENCO"; then
  echo "::error::Nello zip ci sono file di sviluppo" >&2; exit 1
fi
echo "Creato $USCITA/$NOME ($(wc -l <<<"$ELENCO") file, $(du -h "$USCITA/$NOME" | cut -f1))"
echo "nome=$NOME" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "percorso=$USCITA/$NOME" >> "${GITHUB_OUTPUT:-/dev/null}"
