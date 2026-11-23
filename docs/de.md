# e-data (Datadis)

Diese Integration bringt die Stromanschlüsse eines
[Datadis](https://datadis.es)-Kontos in Gladys. Datadis ist die kostenlose
Plattform der spanischen Stromnetzbetreiber (i-DE, e-distribución, UFD,
E-redes, Viesgo…): Sie liefert den stündlichen Verbrauch, das Maximeter und
den Vertrag jedes Anschlusses (CUPS) eines Inhabers.

Es ist eine **Cloud**-Integration: Sie liest Datadis nur über das Internet.
Nichts wird gesteuert, und die Messwerte kommen mit **ein bis zwei Tagen
Verzögerung** (so funktioniert Datadis: Die Zählerdaten eines Tages werden an
den folgenden Tagen veröffentlicht).

## Bevor Sie beginnen

1. Erstellen Sie auf [datadis.es](https://datadis.es/register) ein Konto mit
   der NIF/NIE des Vertragsinhabers (ein Privatkonto genügt).
2. Melden Sie sich einmal auf datadis.es an und prüfen Sie, dass Ihre
   Anschlüsse aufgeführt sind.

## Konfiguration

1. Öffnen Sie den Reiter **Konfiguration** der Integration.
2. Geben Sie Ihren Datadis-**Benutzernamen (NIF/NIE)** und Ihr **Passwort**
   ein.
3. Optional: **Autorisierte NIF** — nur um die Anschlüsse eines anderen
   Inhabers zu lesen, der Ihr Konto auf Datadis autorisiert hat.
4. Optionale Einstellungen:
   - **Aktualisierungsintervall** (Stunden, standardmäßig 12, mindestens 6):
     wie oft Datadis gelesen wird. Datadis lehnt zu häufige identische
     Abfragen ab.
   - **Zu importierender Verlauf** (Monate, standardmäßig 3, bis zu 24): wird
     bei der ersten Synchronisierung eines Anschlusses gelesen.
   - **Hoher Tagesverbrauch** (kWh, 0 = deaktiviert): Schwelle des
     gleichnamigen Szenenauslösers.
   - **Leistungsspitzen-Alarm** (% der Vertragsleistung, standardmäßig 90).
5. Speichern Sie und klicken Sie auf **Verbindung testen**: Die Anzahl der
   gefundenen Anschlüsse wird angezeigt.
6. Ihre Anschlüsse erscheinen im Reiter **Erkennung**: Fügen Sie sie hinzu.

## Was Sie erhalten

Ein Gerät pro Anschluss, nach seiner Adresse benannt, mit:

| Funktion                    | Beschreibung                                                                     |
| --------------------------- | -------------------------------------------------------------------------------- |
| Verbrauch                   | Stündlicher Verbrauch mit Datum, im Gladys-Energiemonitoring (Kosten, Diagramme) |
| Verbrauch des letzten Tages | Summe des letzten vollständigen Tages (kWh)                                      |
| Monatsverbrauch             | Summe des laufenden Monats (kWh)                                                 |
| Maximale Monatsleistung     | Höchste Maximeter-Spitze des Monats (W)                                          |
| Vertragsleistung            | Höchste Vertragsleistung des Vertrags (W)                                        |
| Datum der neuesten Daten    | Datum des jüngsten Messwerts                                                     |

## Aktionen

- **Verbindung testen** — meldet sich an und listet die Anschlüsse auf, ohne
  den Verbrauch zu lesen.
- **Daten jetzt aktualisieren** — liest Datadis sofort.

## Szenen

Die Integration fügt dem Szeneneditor eigene Karten hinzu (Gladys 5.1 oder
neuer):

Auslöser:

- **Neue Tagesdaten** — Datadis hat einen neuen vollständigen Tag geliefert.
  Variablen: `{{triggerEvent.data.date}}`,
  `{{triggerEvent.data.consumption_kwh}}`.
- **Hoher Tagesverbrauch** — ein Tag hat die eingestellte Schwelle
  überschritten. Variablen: `date`, `consumption_kwh`, `threshold_kwh`.
- **Leistungsspitzen-Alarm** — das Maximeter hat eine Spitze ab dem
  eingestellten Anteil der Vertragsleistung erfasst (Gefahr, dass der ICP
  auslöst, oder von Überschreitungsgebühren). Variablen: `date`, `time`,
  `max_power_w`, `contracted_power_w`, `percent`.
- **Datadis-Fehler** — Datadis konnte nicht gelesen werden (Zugangsdaten
  abgelehnt, Abfragelimit, Dienst nicht verfügbar). Variablen: `reason`,
  `message`.

Jeder Auslöser kann auf einen Anschluss (oder eine Fehlerursache) beschränkt
werden.

Aktionen:

- **Datadis-Daten aktualisieren** — liest Datadis sofort. Ausgaben:
  `success`, `supplies`.
- **Verbrauch abrufen** — Verbrauch eines Anschlusses über einen Zeitraum
  (letzter verfügbarer Tag, letzte 7 oder 30 Tage, aktueller Monat oder
  Vormonat). Ausgaben: `consumption_kwh`, `days`, `start_date`, `end_date`,
  `max_power_w` — verwenden Sie sie in einer Nachricht für einen Wochen- oder
  Monatsbericht.

## Dashboard

- **Stromanschluss** — ein Anschluss: letzter Tag, laufender Monat,
  Spitzenleistungs-Anzeige im Verhältnis zur Vertragsleistung, die letzten 14
  Tage als Balken, Netzbetreiber, Lieferant und Verbindungsstatus, mit einer
  Schaltfläche **Aktualisieren**.
- **Datadis-Anschlüsse** — alle Anschlüsse des Kontos und der
  Verbindungsstatus.

## Fehlerbehebung

- **„Datadis hat den Benutzernamen oder das Passwort abgelehnt“**: Prüfen Sie
  Ihre Zugangsdaten auf datadis.es. Der Benutzername ist die NIF/NIE, in
  Großbuchstaben.
- **„Datadis begrenzt die Anzahl der Abfragen“**: Datadis hat die Abfragen
  vorübergehend abgelehnt; die Integration versucht es später selbst erneut.
- **Keine Daten für gestern**: normal, die Netzbetreiber veröffentlichen die
  Messwerte mit ein bis zwei Tagen Verzögerung (manchmal mehr).
- Protokolle: Öffnen Sie die Protokolle der Integration in Gladys
  (`LOG_LEVEL=debug` für alle Details). Passwörter, Tokens und vollständige
  CUPS werden nie protokolliert.

## Datenschutz

Die Integration kommuniziert nur mit datadis.es. Sie speichert einen Cache der
Messwerte in ihrem eigenen `/data`-Volume (nie das Passwort), damit nach einem
Neustart nichts erneut gelesen wird.
