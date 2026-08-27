# Workshop-Zuteilung für GitHub Pages

Statische Browseranwendung für bis zu **500 Teilnehmer und 30 Durchführungen**. Die Berechnung läuft vollständig im Browser; ein Python-Server ist nicht erforderlich.

## Neu in dieser Version

### Jahrgangsregeln blockieren nicht mehr (Version 9.6.1)

Jahrgangs-Minima und -Maxima sind jetzt durchgehend bestmögliche Ziele. Sie erhöhen nicht mehr indirekt die gesamte Kursmindestbelegung und lösen vor der globalen Suche keinen Abbruch mehr aus. Sind beispielsweise für ein Jahrgangsminimum von 4 nur 2 zulässige Schüler verfügbar, werden diese 2 zugeteilt und die Abweichung wird gelb ausgewiesen.

Nur absolute Vorgaben dürfen weiterhin eine Berechnung verhindern: gesamte Kursmindest- und -maximalbelegung, Kurszugang, Sperrungen und feste Setzungen. Eine solche Meldung nennt nun nicht mehr fälschlich die Jahrgangsregel als Ursache.

### Gewichtung Wünsche ↔ Jahrgangsverteilung (Version 9.6)

Unter **Übersicht → Einstellungen** steht jetzt ein Regler von `0 %` bis `100 %` zur Verfügung:

- `0 %`: Wünsche werden maximal geschützt; unvermeidbare Jahrgangsabweichungen werden ausgewiesen.
- `50 %`: Wünsche und Jahrgangsverteilung werden ausgewogen berücksichtigt (empfohlen).
- `100 %`: Die bestmögliche Jahrgangsverteilung hat Vorrang vor der Wunschqualität.

Der Solver merkt sich während seiner Suche mehrere vollständige Zwischenlösungen und wählt anhand des Reglers die passendste aus. Die Gewichtung betrifft Jahrgangs-Minima/-Maxima, Kohorten-, Jahrgangsgruppen- und weitere Zusammensetzungsregeln. Unverändert absolut bleiben vollständige Zuteilung soweit ein zulässiger Platz existiert, Kapazitäten, Kurszugang, Sperrungen und feste Setzungen. Die Einstellung wird lokal und in JSON-Projektsicherungen gespeichert; alte Projekte starten automatisch mit `50 %`.

### Vollständige Bestmöglich-Zuteilung (Version 9.5)

Der Optimierer bevorzugt zuerst die Lösung mit den wenigsten unzugeteilten Schülern. Danach steuert in Version 9.6 der Gewichtungsregler den Zielkonflikt zwischen Regelabweichungen und Wünschen; anschließend wird der Kursausgleich bewertet.

Jahrgangs-Minima/-Maxima, Kohorten- und Gruppenregeln werden zunächst durch Verschieben, Tauschen und eine globale Kurssuche zu erfüllen versucht. Ist das nicht vollständig möglich, bleibt die bestmögliche zulässige Zuteilung erhalten. Das Programm nennt Kurs, Ist-Wert und Zielwert sowohl im Ergebnis als auch im Hinweisfeld der betroffenen Schüler. Verbindlich bleiben Kurskapazitäten, Kurszugang, Sperrungen, feste Setzungen sowie die gesamte Mindest-/Maximalbelegung.

### Jahrgangsgruppen-Regel

Pro Durchführung kann unter **Workshops → „Jahrgänge & Gruppen …“** die aktuelle Jahrgangsgruppen-Regel aktiviert werden:

- Jahrgänge **8+9 zusammen** müssen mit einer durch 4 teilbaren Schülerzahl vertreten sein.
- Jahrgang **10 aufwärts zusammen** muss ebenfalls durch 4 teilbar sein.
- Ein optionaler weicher Ausgleich bevorzugt möglichst ähnlich große Jahrgangsgruppen.

Die Regel wird vorrangig und bestmöglich eingehalten. Ist die Viererteilbarkeit wegen Kapazitäten, festen Setzungen, Sperrungen oder anderer Vorgaben unmöglich, werden die Schüler trotzdem zugeteilt und die kleinste Abweichung konkret ausgewiesen.

Die dynamische Excel-Vorlage sowie Excel-Import/-Export enthalten dafür in `Workshops` die Spalten **`Jahrgangsgruppen-Regel 8/9 + 10+`** und **`Gruppenausgleich`** mit `Ja`/`Nein`. Die alten Überschriften und das alte JSON-Feld `debateRule` werden beim Import weiterhin erkannt.

### Kursart und Durchführung sind getrennt

Ein Wunsch bezieht sich auf eine **Kursart**. Mehrere Gruppen derselben Kursart verwenden dieselbe Kursart-ID.

Beispiel:

- Durchführungs-ID `W10A` · Kursart-ID `DRACH` · Drachenboot · Gruppe A
- Durchführungs-ID `W10B` · Kursart-ID `DRACH` · Drachenboot · Gruppe B

In der Kursanwahl erscheint nur `DRACH · Drachenboot`. Wird ein Teilnehmer anschließend Gruppe A oder B zugeteilt, zählt beides als derselbe Erst-/Zweit-/Dritt-/Viertwunsch.

Im Workshopbereich erzeugt der **＋-Knopf** eine weitere Durchführung derselben Kursart.

### Mindestgruppe Jahrgang + Bildungsgang

Unter **Übersicht → Mindestgruppe Jahrgang + Bildungsgang** kann global z. B. `2`, `3` oder mehr eingestellt werden.

Regel pro Durchführung:

- eine Kombination wie `Jahrgang 9 / Regional` kommt gar nicht vor, **oder**
- sie muss mindestens die eingestellte Personenzahl erreichen.

Jede Durchführung kann den globalen Wert überschreiben:

- leeres Feld = globalen Wert verwenden
- `0` = Regel für diese Durchführung ausschalten
- `2`, `3`, `4` … = eigener Wert

Wenn die Regel mit Wünschen, Kapazitäten, festen Setzungen und Sperrungen nicht vollständig erfüllt werden kann, bleibt die bestmögliche Zuteilung erhalten und wird verständlich gekennzeichnet.

## Weitere Funktionen

- vier Wünsche pro Teilnehmer
- Klassenstufen und Bildungsgänge
- Pflicht- und optionale Durchführungen
- Mindest- und Maximalbelegung
- automatische Zielbelegung und Belastungsausgleich
- feste Setzungen auf eine konkrete Durchführung
- Sperrungen für konkrete Durchführungen
- dynamische Excel-Kursanwahl-Vorlage mit den aktuell angelegten Kursarten
- Excel-Import und Excel-Export
- JSON-Sicherung und Wiederherstellung
- Kurslisten und Klassenlisten als PDF-ZIP
- lokale Speicherung im Browser
- Offline-Nutzung nach dem ersten Laden

## Excel-Kursanwahl

Unter **Daten → Vorlage mit aktuellen Kursarten herunterladen** wird eine Excel-Datei erzeugt.

Die vier Wunschspalten enthalten **Kursart-IDs**, keine Durchführungs-IDs. Eine feste Setzung darf dagegen eine konkrete Durchführungs-ID enthalten.

Alte Dateien bleiben kompatibel: Überschriften wie `Schulform` und `Workshop-ID` werden weiterhin erkannt.

## Datenschutz

GitHub Pages veröffentlicht nur den Programmcode. Teilnehmerdaten werden im Browser gespeichert und für die Berechnung nicht an GitHub übertragen.

**Keine echten Schülerdaten als Excel-, JSON- oder PDF-Dateien in das GitHub-Repository hochladen.**

## Auf GitHub veröffentlichen

1. Repository anlegen bzw. vorhandenes Repository öffnen.
2. Den Inhalt dieses Ordners hochladen.
3. Unter **Settings → Pages → Source** `Deploy from a branch` auswählen.
4. Als Branch `main` und als Ordner `/docs` einstellen und speichern.
5. GitHub Pages veröffentlicht den bereits gebauten Ordner `docs` direkt.

Es ist auf GitHub keine `npm`-Installation notwendig.

## Technischer Hinweis

Der Optimierer verwendet eine Flussoptimierung für Wünsche, Mindestbelegungen und Kapazitäten. Bei schwierigen Jahrgangsgrenzen folgt eine globale Neuberechnung mit unteren und oberen Schranken für sämtliche Kurse. Erst wenn keine exakte Jahrgangsverteilung existiert, wird die kleinstmögliche Abweichung als gelber Hinweis ausgewiesen.

Die Tests decken u. a. ab:

- zwei Durchführungen derselben Kursart,
- identische Wunschwertung für Gruppe A/B,
- Kohortenminimum,
- nicht erfüllbare Kohortenregeln,
- Pflicht- und optionale Durchführungen,
- erfüllbare und nicht erfüllbare Jahrgangsgruppen-Regeln,
- Rückwärtskompatibilität alter Projekte.

## Lizenz

MIT

## Berechnungsqualität

Unter **Übersicht → Einstellungen** kann zwischen drei Qualitätsstufen gewählt werden:

- **Schnell** – 1 Berechnung
- **Standard** – 6 unterschiedliche Startvarianten; empfohlen
- **Gründlich** – 24 unterschiedliche Startvarianten

Die Anwendung behält automatisch die beste Verteilung: zuerst möglichst vollständig, dann mit möglichst wenigen und kleinen Regelabweichungen. Mindest- und Maximalbelegungen der Kurse bleiben in jeder Variante verbindlich.

## Vorrangige Regeln

Als **Vorrangig** markierte Zuteilungsregeln werden vor Wunschqualität und Belastungsausgleich behandelt. Die Optimierung versucht kleine Regelgruppen aktiv zu verstärken oder vollständig umzuverteilen. Eine nicht vollständig erfüllbare Regel führt zu einer gekennzeichneten Bestmöglich-Zuteilung und nicht zum Verlust ansonsten zulässiger Workshopplätze.

## Mehrfach-Umfrageimport
Unter **Daten → Umfrage-Dateien importieren** können mehrere Excel-Umfrageexporte gemeinsam eingelesen werden. Die App gleicht Workshopkennungen und Namen mit den Kursarten im aktuellen Projekt ab, zeigt unsichere Treffer zur Prüfung und erkennt mögliche Dubletten über Vorname + Nachname + Klasse. Person-IDs werden automatisch vergeben.

## Jahrgangsbelegung pro Kurs (seit Version 2.3, globale Suche ab 9.4)

In **Workshops** gibt es pro Durchführung den Knopf **„Jahrgänge & Gruppen …“**. Dort können für jeden zugelassenen Jahrgang getrennte Mindest- und Höchstziele festgelegt werden.

- Minimum leer = keine Mindestvorgabe
- Maximum leer = keine Höchstvorgabe
- Minimum `7`, Maximum leer = mindestens 7 Schüler dieses Jahrgangs müssen in diesen Kurs
- Minimum leer, Maximum `4` = höchstens 4 Schüler dieses Jahrgangs dürfen in diesen Kurs
- Minimum `2`, Maximum `5` = zwischen 2 und 5 Schüler dieses Jahrgangs

Diese Grenzen werden zuerst **vorrangig** gesucht und gelten zusätzlich zur gesamten Mindest-/Maximalbelegung, zu Sperrungen, festen Setzungen und anderen Regeln. Ist keine exakte Jahrgangsverteilung möglich, wird die Berechnung nicht abgebrochen: Das Programm liefert die Lösung mit der kleinsten Abweichung und kennzeichnet sie deutlich als Hinweis.

Die Excel-Vorlage sowie Excel-Import/-Export unterstützen dafür das Blatt **`Jahrgangsbelegung`** mit den Spalten `Durchführungs-ID | Jahrgang | Minimum | Maximum`.
