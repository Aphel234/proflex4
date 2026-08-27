# V9.6.0 vollständig bei GitHub Pages veröffentlichen

Diese ZIP enthält die **gesamte Anwendung**. Ein vorhandenes Repository oder eine ältere Programmversion ist nicht erforderlich.

## 1. Dateien hochladen

1. ZIP entpacken.
2. Bei GitHub ein neues Repository anlegen oder das bestehende öffnen.
3. Den **Inhalt** des Ordners `WorkshopZuteilung_V9_6_0_GITHUB_PAGES_FULL` hochladen – nicht den umschließenden Ordner selbst.
4. Prüfen, dass `docs` direkt auf der obersten Repository-Ebene sichtbar ist.

## 2. GitHub Pages einschalten

1. **Settings → Pages** öffnen.
2. Unter **Build and deployment** die Quelle **Deploy from a branch** auswählen.
3. Branch **main** und Ordner **/docs** auswählen.
4. **Save** anklicken.

Nach wenigen Minuten zeigt GitHub dort die öffentliche Adresse an:

`https://DEIN-BENUTZERNAME.github.io/REPOSITORYNAME/`

## 3. Bei Aktualisierungsproblemen

Die Seite einmal hart neu laden:

- Windows/Linux: `Strg + Umschalt + R`
- macOS: `Cmd + Umschalt + R`

## Inhalt

- `docs/` – sofort veröffentlichbare GitHub-Pages-Anwendung
- `dist/` – fertiger Produktions-Build
- `public/` und `src/` – vollständiger Quellcode
- `tests/` – Optimierer-Tests
- `scripts/` – Build-Skript

Der Gewichtungsregler befindet sich in der Anwendung unter **Übersicht → Einstellungen → Priorität: Wünsche ↔ Jahrgangsverteilung**.
