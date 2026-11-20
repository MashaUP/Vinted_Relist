# Vinted Relist

[🇮🇹 Italiano](README.md) · [🇬🇧 English](README.en.md) · [🇫🇷 Français](README.fr.md) · [🇪🇸 Español](README.es.md) · **🇩🇪 Deutsch**

Erweiterung für **Brave und Chrome**, die Ihre Vinted-Anzeigen mit einem Klick neu einstellt –
einzeln oder in einer Warteschlange –, damit sie wieder oben in den Ergebnissen erscheinen, ohne
dass Sie sie von Hand neu anlegen müssen.

**Version 2.6.1** · [Neuigkeiten (auf Italienisch)](CHANGELOG.md) · [Discord-Community](https://discord.gg/EPsbQCuAkx) ·
[Problem melden](https://github.com/MashaUP/Vinted_Relist/issues/new?template=segnalazione-bug.yml) ·
[Entwicklung auf Ko-fi unterstützen](https://ko-fi.com/mashaup)

> [!WARNING]
> **Inoffizielles Projekt, Nutzung auf eigenes Risiko.** Es steht in keiner Verbindung zu Vinted
> und ist nicht von Vinted genehmigt. Das Automatisieren von Aktionen auf der Website ist nach den
> Bedingungen von Vinted möglicherweise nicht erlaubt; Vinted kann Konten einschränken oder
> sperren. **Der Autor haftet nicht** für das, was mit Ihrem Konto geschieht, für verlorene oder
> gelöschte Anzeigen, entgangene Verkäufe oder Missbrauch der Erweiterung. Neu einstellen
> **löscht** die alte Anzeige: Aufrufe und Favoriten beginnen wieder bei null. Mit der Installation
> akzeptieren Sie den [vollständigen Haftungsausschluss](DISCLAIMER.md#deutsch).

---

## Für wen

Für alle, die aus ihrem eigenen Vinted-Kleiderschrank verkaufen und dieselben Artikel oft neu
einstellen: Bücher, Manga, Kleidung, Pakete. Statt Fotos und Texte in eine neue Anzeige zu kopieren
und die alte zu löschen, drücken Sie **Neu einstellen** auf der Karte des Artikels, oder Sie wählen
mehrere aus und reihen sie mit einer Pause dazwischen in eine **Warteschlange** ein.

Es ist ein kostenloses, privates Projekt ohne Server: alles bleibt in Ihrem Browser. Die
Oberfläche gibt es auf **Italienisch, Englisch, Französisch, Spanisch und Deutsch**.

Sie wird als Zip-Datei auf GitHub verteilt und als entpackte Erweiterung geladen — **sie ist nicht
im Chrome Web Store**. **Probieren Sie sie zuerst an einem unwichtigen Artikel aus.**

## Installation

1. Laden Sie **`Vinted_Relist-2.6.1.zip`** von der
   [Release-Seite auf GitHub](https://github.com/MashaUP/Vinted_Relist/releases) (unter „Assets“)
   oder aus dem Hauptverzeichnis des Repositorys herunter.
2. Entpacken Sie sie **in einen dauerhaften Ordner**, z. B. `Dokumente\Vinted_Relist` (nicht in
   den temporären Ordner, den Windows beim Doppelklick auf die Zip-Datei öffnet). Der richtige
   Ordner ist der, der `manifest.json` enthält.
3. Öffnen Sie `brave://extensions` (oder `chrome://extensions`) und aktivieren Sie den
   **Entwicklermodus** (oben rechts).
4. **Entpackte Erweiterung laden** › den Ordner mit `manifest.json` wählen.
5. Öffnen Sie Ihren Kleiderschrank auf Vinted **angemeldet** und laden Sie die Seite neu: auf den
   Karten erscheinen die Schaltflächen **Neu einstellen** und **Bearbeiten**.

> Löschen oder verschieben Sie den Ordner nach der Installation nicht: der Browser nutzt ihn
> jedes Mal.

### Aktualisieren

1. Popup › **Status** › **Nach Update suchen** (prüft auch selbst alle 12 Stunden und
   benachrichtigt Sie).
2. **Zip herunterladen** und **über den aktuellen Ordner** entpacken, die Dateien ersetzend.
3. **Update installieren**: die Erweiterung lädt neu. Danach die Vinted-Tabs neu laden (F5).

## Kurzanleitung

**0. Sprache.** Die Schaltfläche 🌐 oben im Popup und im Dashboard öffnet das Feld **Sprache**:
„Automatisch“ folgt der Browsersprache, oder wählen Sie Italiano, English, Français, Español oder
Deutsch. Die Änderung gilt sofort überall.

**1. Ein Artikel.** Auf einer Karte in Ihrem Kleiderschrank:
- **Neu einstellen**: klont die Anzeige und löscht die alte, sofort;
- **Bearbeiten**: zuerst Fotos, Titel, Beschreibung oder Preis ändern, die Vorschau der Änderungen
  ansehen, dann veröffentlichen.

**2. Viele Artikel (Warteschlange).** Kästchen auf den Karten anhaken (Umschalt+Klick für einen
Bereich) › **Warteschlange** › Optionen wählen (Preis, Texte, Intervall zwischen den Artikeln,
Startzeit) › die Prüfung liest jeden Artikel, **ohne zu veröffentlichen**, und teilt sie in bereit,
mit Hinweisen und blockiert ein › **Starten**. Lassen Sie einen Vinted-Tab offen, solange die
Warteschlange arbeitet.

**3. Während die Warteschlange läuft.** Weiter Artikel auswählen und **Zur Warteschlange
hinzufügen** drücken: die **Bearbeitungszentrale** öffnet sich, und sie werden zu einem neuen
**Batch** mit eigenen Regeln und eigenem Intervall. Die Warteschlange hält nicht an. **Verwalten**
öffnet die Seite der Warteschlange, wo Sie alles sehen, umsortieren, pausieren und korrigieren
können.

**4. Von Vinted bereits gelöschte Anzeigen.** Mit [Vintory](https://github.com/MashaUP/Vintory)
die Anzeigen exportieren („Für Vinted_Relist“), dann Dashboard › **Aus Vintory neu einstellen** ›
die ZIP-Datei wählen: die Vorschau zeigt, welche sich neu einstellen lassen, ohne etwas zu löschen.

**5. Wenn etwas schiefgeht.** Popup › **Status**: Zustand der Erweiterung, Diagnose zum Kopieren
und was zu tun ist. Ein unsicheres Ergebnis wird „zu prüfen“ und nie automatisch neu eingestellt.

## Was sie macht

- **Neueinstellen:** klont die Anzeige (Fotos, Titel, Beschreibung, Kategorie, Marke, Größe,
  Zustand, Farben, Modell bei Handys, Preis, Versand) und löscht die alte, über die internen APIs
  der Website und Ihre Sitzung — keine simulierten Klicks.
- **Sichere Reihenfolge:** erst veröffentlichen, dann löschen (Standard). Lehnt Vinted die neue
  Anzeige ab, bleibt die alte bestehen.
- **Im Zweifel stellt sie nicht neu ein:** ohne eindeutige Antwort von Vinted wird der Artikel „zu
  prüfen“, und Sie bestätigen ihn (auch mit **Veröffentlichung prüfen**, das auf Vinted nachsieht,
  ohne etwas zu veröffentlichen).
- **Nur Ihre Anzeigen:** die Schaltflächen erscheinen nur in Ihrem Kleiderschrank; verkaufte
  Artikel werden nie neu eingestellt.
- **Anzeigen-Editor:** Fotos umsortieren, drehen, zuschneiden und entfernen; Titel, Beschreibung,
  Preis, Farbe; Prüfungen in Echtzeit und Vollständigkeitswert; Download der Originalfotos.
- **Warteschlange:** hinzufügen, entfernen und umsortieren, auch während sie läuft; Batches mit
  eigenen Regeln und Intervall; Statusmarkierungen auf den Karten; zeitgesteuerte Pause; „Jetzt
  neu einstellen“; Sammeloptionen (Preis in %, in Euro oder fest, Suchen und Ersetzen, Zeile am
  Ende der Beschreibung); Schutz vor den Limits von Vinted; Verlauf und CSV/JSON-Export.
- **Dashboard:** Verwaltung der Warteschlange, Artikelgruppen (kürzlich, stagnierend, zu
  optimieren…), mögliche Duplikate, was funktioniert (Aufrufe nach 48 Stunden nach Tag und
  Zeitfenster), Verlauf mit Vorher/Nachher-Vergleich und Wiederherstellung, **Aus Vintory neu
  einstellen**.

## Tipps: wann neu einstellen

- **Zwischen verschiedenen Artikeln 15–20 Minuten** (das Standardintervall der Warteschlange).
  Wenige Artikel auf einmal, großzügige Pausen.
- **Denselben Artikel alle 5–7 Tage, nie täglich.**
- **Sonntagabend, 20–22 Uhr** gilt als beste Zeit; **Freitag** als schlechtester Tag; 1–6 Uhr
  meiden.

Diese Zahlen stammen von Anbietern von Neueinstell-Tools ([Relisted](https://relisted.io/en/blog/best-time-post-vinted),
[Vinkit](https://vinkit.co/it/blog/con-quale-frequenza-ripubblicare-annunci-vinted-studio-24m-articoli))
und sind nicht überprüfbar; nach einigen Wochen zeigt das Dashboard, was für Ihren Kleiderschrank
funktioniert.

## Wenn etwas nicht klappt

Popup › **Status** › **Diagnose vorbereiten**: Version, Einstellungen, Status der Warteschlange
und letzte Fehler, ohne Tokens, Cookies, IDs oder Adressen. Sie sehen sie vor dem Kopieren und
können sie auf Discord oder in einer Fehlermeldung einfügen.

- **Die Schaltflächen erscheinen nicht.** Sie erscheinen nur in Ihrem Kleiderschrank
  (`/member/<Ihre ID>`), sobald die Erweiterung Ihr Konto erkannt hat: angemeldet ein wenig auf
  Vinted surfen, dann neu laden.
- **„CSRF-Token nicht gefunden“ oder „Seite neu laden“ nach einem Update.** Den Vinted-Tab neu
  laden (F5): bereits geöffnete Seiten laufen noch mit dem alten Code.
- **Handys: Vinted verlangt, das Modell auszuwählen.** Seit 2.6 wird das Modell automatisch
  übernommen. Passiert es trotzdem: die Anzeige auf Vinted öffnen › **Bearbeiten** › Modell prüfen ›
  speichern, dann erneut versuchen (die Erweiterung lernt die Felder dieser Kategorie). Reicht das
  nicht, schicken Sie uns die Diagnose.
- **Die Warteschlange hält mit „Problem der Erweiterung“ an.** Der Grund steht in der Pause und in
  der Diagnose. Meist reicht es, den Vinted-Tab neu zu laden; dann **Fortsetzen**. Es wurde nichts
  an Vinted gesendet.
- **Fehler 403 oder 429.** Das ist der Bot-Schutz von Vinted: die Warteschlange verlangsamt sich
  von selbst. Das Intervall erhöhen.
- **Kaputtes Symbol, `ERR_FILE_NOT_FOUND`.** Der Browser findet den Ordner nicht mehr: an einem
  dauerhaften Ort entpacken und die Erweiterung von dort neu laden.

## Datenschutz und Berechtigungen

Entwürfe, Verlauf, Statistiken, Warteschlange und Benachrichtigungen bleiben in Ihrem Browser.
**Keine Telemetrie, kein Server, keine Daten an den Autor.** Die einzigen Anfragen außerhalb von
Vinted gehen an GitHub, ohne Cookies oder persönliche Daten: `version.json` für Updates und
`links.json` für die Projektlinks (abschaltbar unter Einstellungen › Erweitert).

| Berechtigung | Wofür |
|---|---|
| `storage` | Einstellungen, Warteschlange, Inventar, Verlauf, Benachrichtigungen, Sprache: alles lokal |
| `webRequest` | Sitzungstoken, Ihre ID und die Formate aus den Anfragen von Vinted lesen |
| `alarms` | die Warteschlange zur richtigen Zeit wecken und eine zeitgesteuerte Pause fortsetzen |
| `notifications` | Benachrichtigungen am Ende der Warteschlange und bei Updates |
| `idle` | unregelmäßiges Tempo: keine Schritte, wenn Sie nicht am Computer sind |
| `downloads` | heruntergeladene Fotos, Sicherungen der Einstellungen, Exporte der Warteschlange |
| Websites `vinted.*` und `*.vinted.net` | die APIs von Vinted aufrufen und Fotos von seinem CDN laden |

## Was sie nicht macht

- Sie holt die ursprüngliche Anzeige nicht zurück: Aufrufe, Favoriten und Alter beginnen bei null.
- Sie verändert keine Fotos, um die Prüfungen von Vinted zu umgehen.
- Sie arbeitet nicht bei geschlossenem Browser: der Browser muss offen sein, mit einem Vinted-Tab.
- Sie aktualisiert sich nicht selbst: sie benachrichtigt Sie, entpacken müssen Sie selbst.

## Hilfe und Unterstützung

- **Fragen und Hilfe:** die [Discord-Community](https://discord.gg/EPsbQCuAkx).
- **Fehler:** [Meldung eröffnen](https://github.com/MashaUP/Vinted_Relist/issues/new?template=segnalazione-bug.yml)
  mit Version, Browser, was passiert ist und der Diagnose. **Niemals Cookies, Tokens oder
  Kontodaten einfügen.**
- **Entwicklung unterstützen:** Vinted Relist ist kostenlos; wenn es Ihnen Zeit spart, können Sie
  mir auf [Ko-fi](https://ko-fi.com/mashaup) einen Kaffee spendieren.

Die technische Dokumentation für Entwickler ist auf Italienisch ([README](README.md#per-sviluppatori),
[docs/SVILUPPO.md](docs/SVILUPPO.md)).

## Lizenz und Haftungsausschluss

[MIT](LICENSE): Sie dürfen den Code nutzen, ändern und weiterverbreiten, auch in eigenen
Projekten, solange der Urheberrechtshinweis erhalten bleibt. Die Software wird **wie besehen und
ohne Gewährleistung** bereitgestellt.

Vinted Relist ist ein unabhängiges Projekt, **nicht mit Vinted verbunden und nicht von Vinted
genehmigt**. Nutzung auf eigenes Risiko: der Autor haftet nicht für Sperrungen oder Blockierungen
des Kontos, verlorene Anzeigen, entgangene Verkäufe oder Missbrauch. Lesen Sie den
[vollständigen Haftungsausschluss](DISCLAIMER.md#deutsch).
