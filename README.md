# Arbeitszeit – Gleitzeit-Erfassung (PWA)

Progressive Web App zur Erfassung der Arbeitszeit mit Gleitzeit-Saldo. Läuft offline, alle Daten bleiben auf dem Handy (IndexedDB).
Kein Server, kein Login, kein Build-Schritt.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html`, `styles.css` | Grundgerüst und Design (Hell/Dunkel nach Systemeinstellung) |
| `app.js` | Start der App, Navigation, Service-Worker-Updates |
| `ui-today.js` | Hauptbildschirm: Feierabend, Live-Werte, Warnungen, Buttons |
| `ui-history.js` | Verlauf (Kalender + Tagesliste) und Tages-Editor |
| `ui-settings.js` | Einstellungen, Export, Backup |
| `calc.js` | **Berechnungslogik** (Pausenregeln, Saldo, Feierabend, Warnungen) |
| `holidays.js` | Feiertage, Ostern per Algorithmus |
| `time.js` | Datums-/Zeithilfen und Formatierung |
| `export.js` | CSV-Export und JSON-Backup |
| `db.js`, `store.js` | Speicherung in IndexedDB |
| `sw.js`, `manifest.json`, `icons/` | Offline-Fähigkeit, Installation, App-Icon |
| `tests/` | Unit-Tests (`node --test`) |
| `tools/` | Icon-Generator und lokaler Test-Server (nur am PC nötig) |

## Rechenregeln

- Netto = Anwesenheit − Pausen; tatsächliche Pausen werden immer voll abgezogen.
- Über 6:00 h Arbeitszeit: mindestens 30 Min. Pause, Fehlendes wird automatisch abgezogen (nicht gestaffelt).
- Über 9:00 h (nach Abzug der 30 Min.): mindestens 45 Min. Pause (§ 4 ArbZG).
- Pausenblöcke unter 15 Min. werden abgezogen, zählen aber nicht zur Mindestpause.
- Urlaub/Krank: Soll erfüllt (±0). Gleittag: volles Tagessoll wird abgezogen.
- Feiertage automatisch, 24.12./31.12. dienstfrei (abschaltbar).
- Minutengenau: Sekunden werden abgeschnitten.

## Tests ausführen

```
node --test
```

## Lokal am PC ausprobieren

```
node tools/serve.mjs
```

Dann im Browser `http://localhost:8080` öffnen.

## Neue Version veröffentlichen

Nach jeder Änderung an App-Dateien in `sw.js` die Zeile `const VERSION = '1.0.0';` erhöhen
(z. B. auf `1.0.1`) und alle Dateien neu hochladen. Die App zeigt dann „Neue Version verfügbar“.

## Datensicherheit

Die Daten liegen nur im Speicher von Chrome auf dem Handy. Wer die App deinstalliert oder in
Chrome die Website-Daten löscht, verliert sie. Daher regelmäßig unter
**Einstellungen → Backup speichern** eine Sicherung anlegen (z. B. in Google Drive).
