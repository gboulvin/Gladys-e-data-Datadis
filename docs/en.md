# e-data (Datadis)

This integration brings the electricity supplies of a
[Datadis](https://datadis.es) account into Gladys. Datadis is the free
platform of the Spanish electricity distributors (i-DE, e-distribución, UFD,
E-redes, Viesgo…): it serves the hourly consumption, the maximeter and the
contract of every supply point (CUPS) of a holder.

It is a **cloud** integration: it only reads Datadis over the Internet. Nothing
is controlled, and the readings arrive with **one or two days of delay** (that
is how Datadis works: the meter data of a day is published the following days).

## Before you start

1. Create an account on [datadis.es](https://datadis.es/register) with the
   NIF/NIE of the supply holder (a "private" account is enough).
2. Log in once on datadis.es and check that your supplies are listed.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Enter your Datadis **username (NIF/NIE)** and **password**.
3. Optional: **Authorized NIF** — only to read the supplies of another holder
   who authorized your account on Datadis.
4. Optional settings:
   - **Refresh interval** (hours, 12 by default, 6 minimum): how often Datadis
     is read. Datadis refuses identical queries asked too often.
   - **History to import** (months, 3 by default, up to 24): read on the first
     sync of a supply.
   - **High daily consumption** (kWh, 0 = disabled): threshold of the scene
     trigger of the same name.
   - **Power peak alarm** (% of the contracted power, 90 by default).
5. Save, then press **Test the connection**: the number of supplies found is
   displayed.
6. Your supplies appear in the **Discovery** tab: add them.

## What you get

One device per supply, named after its address, with:

| Feature              | Description                                                                      |
| -------------------- | -------------------------------------------------------------------------------- |
| Consumption          | Hourly consumption, dated, fed into the Gladys energy monitoring (costs, charts) |
| Last day consumption | Total of the last complete day (kWh)                                             |
| Month consumption    | Total of the current month so far (kWh)                                          |
| Month maximum power  | Highest maximeter peak of the month (W)                                          |
| Contracted power     | Highest contracted power of the contract (W)                                     |
| Last data date       | Date of the most recent reading                                                  |

## Actions

- **Test the connection** — logs in and lists the supplies, without reading
  the consumption.
- **Refresh the data now** — reads Datadis immediately.

## Scenes

The integration adds its own cards to the scene editor (Gladys 5.1 or later):

Triggers:

- **New daily data** — Datadis delivered a new complete day. Variables:
  `{{triggerEvent.data.date}}`, `{{triggerEvent.data.consumption_kwh}}`.
- **High daily consumption** — a day consumed more than the configured
  threshold. Variables: `date`, `consumption_kwh`, `threshold_kwh`.
- **Power peak alarm** — the maximeter recorded a peak at or above the
  configured share of the contracted power (risk of the ICP tripping, or of
  power excess penalties). Variables: `date`, `time`, `max_power_w`,
  `contracted_power_w`, `percent`.
- **Datadis error** — Datadis could not be read (credentials refused, rate
  limit, service unavailable). Variables: `reason`, `message`.

Every trigger can be limited to one supply (or one error reason).

Actions:

- **Refresh Datadis data** — reads Datadis now. Outputs: `success`,
  `supplies`.
- **Get the consumption** — consumption of a supply over a period (last
  available day, last 7 or 30 days, current or previous month). Outputs:
  `consumption_kwh`, `days`, `start_date`, `end_date`, `max_power_w` — use
  them in a message to receive a weekly or monthly report.

## Dashboard

- **Electricity supply** — one supply: last day, current month, peak power
  gauge against the contracted power, the last 14 days as bars, distributor,
  supplier and connection state, with a **Refresh** button.
- **Datadis supplies** — every supply of the account and the connection state.

## Troubleshooting

- **"Datadis refused the username or the password"**: check the credentials
  on datadis.es. The username is the NIF/NIE, in capital letters.
- **"Datadis limits the number of queries"**: Datadis temporarily refused the
  queries; the integration retries later on its own.
- **No data for yesterday**: normal, distributors publish the readings with one
  or two days of delay (sometimes more).
- Logs: open the integration logs from Gladys (`LOG_LEVEL=debug` for the full
  detail). Passwords, tokens and full CUPS are never logged.

## Privacy

The integration only talks to datadis.es. It keeps a cache of the readings
under its own `/data` volume (never the password) so that a restart re-reads
nothing.
