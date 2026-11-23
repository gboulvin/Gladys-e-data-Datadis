# e-data (Datadis) — Gladys Assistant integration

External integration for [Gladys Assistant](https://gladysassistant.com) that
reads the Spanish electricity supplies of a [Datadis](https://datadis.es)
account — the free platform of the Spanish distributors (i-DE,
e-distribución, UFD, E-redes, Viesgo…) — like the e-data project does for
other home automation systems.

- **Cloud** integration (manifest `transports: ["cloud"]`), category
  **energy**, Gladys **5.1.0 or later**.
- **English, French, German and Spanish** everywhere: manifest, messages,
  widgets and [documentation](docs/en.md) ([fr](docs/fr.md),
  [de](docs/de.md), [es](docs/es.md)).

## Features

| Surface        | What                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Devices        | One per supply (CUPS): dated hourly consumption (energy monitoring), last day, month, month peak power, contracted power, last data date |
| Scene triggers | `new_daily_data`, `high_daily_consumption`, `power_peak_alarm`, `sync_error`                                                             |
| Scene actions  | `refresh_data`, `get_consumption` (last day, 7/30 days, current/previous month)                                                          |
| Widgets        | `supply_overview` (one supply), `supplies_summary` (all supplies)                                                                        |
| Config actions | `test_connection`, `refresh_now`                                                                                                         |

Datadis is read-only and serves yesterday's readings at best: there is nothing
to control, and the "alarms" are the scene triggers above (power peak close to
the contracted power, high daily consumption, Datadis errors).

## How it works

```
Datadis (datadis.es) ──HTTPS──> src/datadis.js ──> src/sync.js ──> Gladys
                                                     │   publishEnergyConsumption (30-min slots)
                                       /data cache <─┤   publishChangedStates, publishSceneEvent
                                                     └── widgets, scene actions (read the cache)
```

The sync engine reads Datadis every `refresh_hours` (12 h by default): the
supplies (daily), the contract (weekly), then the hourly consumption and the
maximeter of the current month, the previous month while its late readings can
still arrive, and the history months never read. Identical queries are spaced
out (Datadis answers 429 otherwise) and everything is cached under `/data`.

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="e-data-datadis" \
DATA_DIR=./data LOG_LEVEL=debug npm start
```

See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Release

Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md),
then **Actions → Release → Run workflow** (`patch`, `minor` or `major`): the
workflow bumps the version, tags, builds the multi-arch image
(`ghcr.io/gboulvin/gladys-e-data-datadis`) and publishes the GitHub Release.
The repository carries the `gladys-assistant-integration` topic so the Gladys
store indexes it.

## Security

See [`SECURITY.md`](SECURITY.md).

## License

Apache-2.0
