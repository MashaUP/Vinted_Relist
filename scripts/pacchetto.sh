#!/usr/bin/env bash
# Pacchetto di Vinted Relist (standard comuni, sez. 5).
#
#   scripts/pacchetto.sh [vX.Y.Z] [uscita]            → npm run build
#     dist/Vinted_Relist-X.Y.Z.zip (cartella Vinted_Relist/, pronta per
#     «Carica estensione non pacchettizzata») e dist/Vinted_Relist-X.Y.Z.zip.sha256.
#     Con il tag (release.yml) si ferma se non coincide con manifest.json.
#
#   scripts/pacchetto.sh --github [uscita]            → npm run package
#     in piu': aggiorna versione e nome dello zip nei README, sostituisce lo zip
#     nella radice del repository, scrive zip e sha256 in version.json e crea
#     dist/Vinted_Relist_GitHub.zip (cartella Vinted_Relist_GitHub/ con tutti i
#     file del repository tranne node_modules, dist e .git).
#
# Lo zip e' riproducibile: stessi file → stessi byte (date fisse dal version.json,
# ordine fisso, permessi fissi). Cosi' la release ricostruita dalle Actions ha lo
# stesso SHA-256 dello zip nella radice, quello che scarica «Cerca aggiornamento».
set -euo pipefail

RADICE="$(cd "$(dirname "$0")/.." && pwd)"
GITHUB=0
ARGOMENTI=()
for a in "$@"; do
  if [[ "$a" == "--github" ]]; then GITHUB=1; else ARGOMENTI+=("$a"); fi
done
ATTESA=""
if [[ ${#ARGOMENTI[@]} -gt 0 && "${ARGOMENTI[0]}" =~ ^v?[0-9] ]]; then ATTESA="${ARGOMENTI[0]}"; ARGOMENTI=("${ARGOMENTI[@]:1}"); fi
USCITA="${ARGOMENTI[0]:-$RADICE/dist}"
mkdir -p "$USCITA"
USCITA="$(cd "$USCITA" && pwd)"

errore() { echo "::error::$*" >&2; exit 1; }

# ---------------------------------------------------------------- versioni
VERSIONE="$(node -p "require('$RADICE/manifest.json').version")"
[[ "$VERSIONE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || errore "manifest.json: versione «$VERSIONE» non nel formato x.y.z"
if [[ -n "$ATTESA" && "${ATTESA#v}" != "$VERSIONE" ]]; then
  errore "La release è ${ATTESA} ma manifest.json dice ${VERSIONE}: allinea le versioni prima di pubblicare."
fi
VERSIONE_JSON="$(node -p "require('$RADICE/version.json').version")"
[[ "$VERSIONE_JSON" == "$VERSIONE" ]] || errore "version.json dice ${VERSIONE_JSON}, manifest.json ${VERSIONE}: «Cerca aggiornamento» darebbe informazioni sbagliate."
grep -q "^## ${VERSIONE//./\\.} " "$RADICE/CHANGELOG.md" || errore "CHANGELOG.md non ha la sezione «## ${VERSIONE} …»"
DATA="$(node -p "require('$RADICE/version.json').date || ''")"
[[ "$DATA" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || errore "version.json: «date» mancante o non nel formato AAAA-MM-GG"

NOME="Vinted_Relist-${VERSIONE}.zip"

# README: versione e nome dello zip li scrive lo script, non la mano.
if [[ $GITHUB -eq 1 ]]; then
  for f in "$RADICE"/README.md "$RADICE"/README.*.md; do
    [[ -f "$f" ]] || continue
    sed -i -E \
      -e "s/Vinted_Relist-[0-9]+\.[0-9]+\.[0-9]+\.zip/${NOME}/g" \
      -e "s/\*\*(Versione|Version|Versión) [0-9]+\.[0-9]+\.[0-9]+\*\*/**\1 ${VERSIONE}**/" \
      "$f"
  done
fi

LAVORO="$(mktemp -d)"
trap 'rm -rf "$LAVORO"' EXIT
CARTELLA="$LAVORO/Vinted_Relist"
mkdir -p "$CARTELLA"

# Solo quello che il browser carica, piu' licenza, avvertenze e guide (5 lingue).
# Niente test, documentazione di sviluppo, workflow, script, zip vecchi.
FILE=(manifest.json background.js links.json README.md README.en.md README.fr.md README.es.md README.de.md DISCLAIMER.md CHANGELOG.md LICENSE)
CARTELLE=(src icons)
for f in "${FILE[@]}"; do
  [[ -f "$RADICE/$f" ]] || errore "Manca $f"
  cp "$RADICE/$f" "$CARTELLA/"
done
for d in "${CARTELLE[@]}"; do
  [[ -d "$RADICE/$d" ]] || errore "Manca la cartella $d"
  cp -R "$RADICE/$d" "$CARTELLA/"
done
find "$CARTELLA" \( -name '.DS_Store' -o -name 'Thumbs.db' -o -name '*.log' -o -name '*~' \) -delete

# Ogni file nominato dal manifest (e dagli importScripts del service worker) deve esserci.
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
  const sw = fs.readFileSync(path.join(dir, m.background.service_worker), "utf8");
  const importati = [...sw.matchAll(/importScripts\(([^)]*)\)/g)].flatMap((x) => [...x[1].matchAll(/"([^"]+)"/g)].map((y) => y[1]));
  const persi = importati.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (persi.length) { console.error("::error::Script importati mancanti: " + persi.join(", ")); process.exit(1); }
' "$CARTELLA"

# ---------------------------------------------------------------- zip riproducibile
find "$CARTELLA" -type d -exec chmod 755 {} +
find "$CARTELLA" -type f -exec chmod 644 {} +
find "$CARTELLA" -exec env TZ=UTC touch -h -d "${DATA}T12:00:00Z" {} +
rm -f "$USCITA/$NOME" "$USCITA/$NOME.sha256"
(cd "$LAVORO" && find Vinted_Relist -type f | LC_ALL=C sort | TZ=UTC zip -qX -D "$USCITA/$NOME" -@)

ELENCO="$(unzip -Z1 "$USCITA/$NOME")"
grep -qx 'Vinted_Relist/manifest.json' <<<"$ELENCO" || errore "Vinted_Relist/manifest.json non è nello zip"
if grep -Ev '^Vinted_Relist/' <<<"$ELENCO" | grep -q .; then errore "Nello zip ci sono file fuori dalla cartella Vinted_Relist/"; fi
if grep -Eq '^Vinted_Relist/(tests|docs|scripts|\.github|node_modules|dist)/|\.zip$|(^|/)(package(-lock)?\.json|eslint\.config\.js|version\.json)$' <<<"$ELENCO"; then
  errore "Nello zip ci sono file di sviluppo"
fi
HASH="$(sha256sum "$USCITA/$NOME" | cut -d' ' -f1)"
echo "$HASH  $NOME" > "$USCITA/$NOME.sha256"
echo "Creato $USCITA/$NOME ($(wc -l <<<"$ELENCO") file, $(du -h "$USCITA/$NOME" | cut -f1)), SHA-256 $HASH"

# ---------------------------------------------------------------- confronto con la radice
DICHIARATO="$(node -p "require('$RADICE/version.json').sha256 || ''")"
if [[ $GITHUB -eq 0 ]]; then
  RADICE_ZIP=( "$RADICE"/Vinted_Relist-*.zip )
  if [[ -f "${RADICE_ZIP[0]}" && ${#RADICE_ZIP[@]} -gt 1 ]]; then errore "Nella radice ci sono ${#RADICE_ZIP[@]} zip Vinted_Relist-*.zip: deve restarne uno"; fi
  if [[ -f "$RADICE/$NOME" ]]; then
    RADICE_HASH="$(sha256sum "$RADICE/$NOME" | cut -d' ' -f1)"
    [[ -z "$DICHIARATO" || "$DICHIARATO" == "$RADICE_HASH" ]] || errore "version.json dichiara SHA-256 $DICHIARATO ma $NOME nella radice ha $RADICE_HASH: rilancia «npm run package»"
    if [[ "$RADICE_HASH" != "$HASH" ]]; then
      echo "::warning::Lo zip ricostruito ($HASH) è diverso da $NOME nella radice ($RADICE_HASH): i sorgenti sono cambiati dopo l'ultimo «npm run package», oppure zip è di un'altra versione." >&2
    fi
  fi
fi

echo "nome=$NOME" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "percorso=$USCITA/$NOME" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "sha256=$HASH" >> "${GITHUB_OUTPUT:-/dev/null}"
[[ $GITHUB -eq 1 ]] || exit 0

# ---------------------------------------------------------------- --github
find "$RADICE" -maxdepth 1 -name 'Vinted_Relist-*.zip' ! -name "$NOME" -print -delete | sed 's/^/Tolto dalla radice: /'
cp "$USCITA/$NOME" "$RADICE/$NOME"
node -e '
  const fs = require("fs");
  const [file, zip, sha] = process.argv.slice(1);
  const v = JSON.parse(fs.readFileSync(file, "utf8"));
  const fuori = { version: v.version, date: v.date, zip, sha256: sha, notes: v.notes };
  for (const [k, x] of Object.entries(v)) if (!(k in fuori)) fuori[k] = x;
  fs.writeFileSync(file, JSON.stringify(fuori, null, 2) + "\n");
' "$RADICE/version.json" "$NOME" "$HASH"
echo "version.json: zip $NOME, sha256 $HASH"

GH="$LAVORO/gh"
mkdir -p "$GH/Vinted_Relist_GitHub"
(cd "$RADICE" && find . -mindepth 1 \( -path ./node_modules -o -path ./dist -o -path ./.git -o -path ./tests/node_modules \) -prune -o -type f -print \
  | grep -Ev '(^|/)(\.DS_Store|Thumbs\.db)$|\.log$|~$' \
  | while read -r f; do mkdir -p "$GH/Vinted_Relist_GitHub/$(dirname "$f")"; cp "$f" "$GH/Vinted_Relist_GitHub/$f"; done)
rm -f "$USCITA/Vinted_Relist_GitHub.zip"
(cd "$GH" && zip -qrX "$USCITA/Vinted_Relist_GitHub.zip" Vinted_Relist_GitHub)
unzip -Z1 "$USCITA/Vinted_Relist_GitHub.zip" | grep -qx "Vinted_Relist_GitHub/$NOME" || errore "$NOME non è nella radice di Vinted_Relist_GitHub.zip"
if unzip -Z1 "$USCITA/Vinted_Relist_GitHub.zip" | grep -Eq '/(node_modules|dist|\.git)/'; then errore "Vinted_Relist_GitHub.zip contiene node_modules, dist o .git"; fi
echo "Creato $USCITA/Vinted_Relist_GitHub.zip ($(unzip -Z1 "$USCITA/Vinted_Relist_GitHub.zip" | wc -l) file)"
