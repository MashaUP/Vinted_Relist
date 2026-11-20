// Controllo statico (npm run lint): variabili non definite, variabili inutili, errori comuni.
// I file dell'estensione sono script classici (niente moduli): si parlano con globali
// dichiarati qui sotto, file per file, cosi' un nome scritto male o fuori portata ferma il lint.
const globals = require("globals");
const js = require("@eslint/js");

// Globali condivisi tra gli script dell'estensione (window.X / self.X).
const ESTENSIONE = {
  VR: "writable", I18N: "readonly", CodaLogica: "readonly", ArmadioLogica: "readonly", Versione: "readonly",
  VintoryLogica: "readonly", VintoryDB: "readonly", VintoryZip: "readonly", LinkProgetto: "readonly", LinkChrome: "readonly",
  EditorLogica: "readonly", Analisi: "readonly",
};

module.exports = [
  { ignores: ["node_modules/**", "dist/**", "**/*.min.js"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: { ...globals.browser, ...globals.webextensions, ...globals.serviceworker, ...ESTENSIONE },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // I globali qui sopra si ridichiarano di proposito («const VL = self.VintoryLogica»).
      "no-redeclare": ["error", { builtinGlobals: false }],
      // Il BOM del CSV e' voluto, dentro un template.
      "no-irregular-whitespace": ["error", { skipTemplates: true }],
      // Regex di sanificazione con caratteri di controllo: volute.
      "no-control-regex": "off",
      // Stile, non errori: «let x = null» prima di un try, errori riscritti per l'utente.
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
    },
  },
  // UMD: «typeof module !== "undefined" && module.exports» per i test in Node.
  { files: ["src/**/*.js", "background.js"], languageOptions: { globals: { module: "readonly" } } },
  // La dashboard e' fatta di piu' script nella stessa pagina: questi aiuti stanno in dashboard.js.
  {
    files: ["src/dashboard-coda.js", "src/dashboard-vintory.js"],
    languageOptions: { globals: { el: "readonly", crea: "readonly", miniatura: "readonly", piano: "readonly", euro: "readonly", dati: "writable" } },
  },
  // Test, script di sviluppo e questa configurazione girano in Node.
  {
    files: ["tests/**/*.js", "scripts/**/*.js", "eslint.config.js"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node, ...ESTENSIONE } },
  },
];
