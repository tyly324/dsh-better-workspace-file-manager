# Arbeitsbereich-Dateimanager (erweitert)

[English](README.md) · [简体中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · **Deutsch** · [Русский](README.ru.md) · [Português](README.pt.md)

> **Fork-Hinweis (tyly324):** Dieses Repository ist ein Fork von [Arrosam/dsh-better-workspace-file-manager](https://github.com/Arrosam/dsh-better-workspace-file-manager). Es ergänzt die Bestätigung des Upload-Ziels, Fortschritt und Wiederholen, das automatische Schließen des Löschdialogs sowie Ausschneiden/Kopieren/Einfügen, Umbenennen, ZIP-Komprimierung/-Entpacken, Eigenschaften und neuen Ordner. Gleiche MIT-Lizenz wie das Original.

Ein Dateimanager für den **Dateien**-Tab von DSH Web und die Vorschau. Er ergänzt die fehlenden Schreiboperationen des offiziellen Baums, ohne dessen DOM zu verändern.

## Funktionen

- **Hochladen** per Schaltfläche, Drag-and-drop vom Rechner oder abgelegtem Ordner. Zuerst wird das Ziel bestätigt (ausgewählter Ordner, sonst Arbeitsbereichswurzel), dann folgen Fortschritt pro Datei, Fehlergrund und **Wiederholen**.
- **Mehrfachauswahl** per Klick, ⌘/Strg+Klick, Umschalt+Klick oder Auswahlrahmen im leeren Bereich.
- **Herunterladen** einer Datei, Auswahl oder eines ganzen Ordners als gestreamtes ZIP.
- **Neuer Ordner** über Kontextmenü oder Kopfzeilen-Schaltfläche; Ziel ist der zuletzt ausgewählte Ordner, sonst die Wurzel.
- **Löschen** nach Bestätigung. Der Dialog schließt immer nach dem Versuch; war die Zeile bereits weg, schließt er und die Liste wird aktualisiert.
- **Ausschneiden / Kopieren / Einfügen / Umbenennen**: bei Namenskonflikt `name (1).ext`, niemals überschreiben.
- **ZIP komprimieren / entpacken**: vor dem Entpacken werden `..`, absolute Pfade, symbolische Links und verschlüsselte Einträge geprüft.
- **Eigenschaften**: Name, Typ, Größe (bei Ordnern Anzahl der Einträge), Änderungszeit, Rechte und absoluter Pfad.
- **Verschieben per Drag-and-drop / in den Chat ziehen**: auf einen Ordner ziehen verschiebt; in das Eingabefeld ziehen fügt eine `@path`-Referenz hinzu.
- **Vorschau**: Download aus jeder Vorschau; Text/Code/Markdown direkt bearbeiten, Zeilenenden und BOM bleiben erhalten, mit Konflikterkennung und manuellem oder automatischem Speichern alle 5 s.

## Installation

```sh
dsh plugin --profile web add github:tyly324/dsh-better-workspace-file-manager
```

Voraussetzungen: DSH-**Web**-Profil **0.2.1-rc.3 oder neuer** (getestet mit 0.2.2-rc.1), lokales Dateisystem des Hosts (fs-local / fs-sandbox) und Node.js 20.15+.

## Hinweise und Grenzen

- Nur Standard-**ZIP**; ZIP64, verschlüsselte ZIPs, 7z und rar werden nicht unterstützt.
- 2 GiB pro Datei/Archiv und maximal 10 000 Einträge; für größere Aufgaben das Terminal verwenden.
- Löschen ist **endgültig**, kein Papierkorb.
- Die Datei-Zwischenablage gilt nur für die aktuelle Seite und wird beim Neuladen geleert.
- Die Ordnergröße zeigt die Anzahl direkter Einträge, nicht die rekursive Gesamtgröße.

## Lizenz

MIT, basierend auf Arrosam/dsh-better-workspace-file-manager. Die vollständige englische Dokumentation steht in [README.md](README.md).
