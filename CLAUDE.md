# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **e-data (Datadis)**: it reads
the Spanish electricity supplies of a [Datadis](https://datadis.es) account
(hourly consumption, maximeter, contract) and exposes them in Gladys as
read-only energy devices, scene triggers, scene actions and dashboard widgets.
Cloud only (manifest `"transports": ["cloud"]`): Datadis is a web API, there is
nothing to control and nothing local.

A Node.js service (Node 22+, ESM, no build step) running in its own sandboxed
Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/sync.test.js             # one file
node --test --test-name-pattern "peak"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                 SDK wiring only: handlers registered before connect()
src/datadis.js           Datadis API client (login, supplies, contract, consumption, maximeter)
src/sync.js              sync engine: schedule, query spacing, publication, scene triggers
src/store.js             cache persisted in /data (readings, edge detection of the triggers)
src/summary.js           pure figures derived from the cache (last day, month, peaks, periods)
src/time.js              Europe/Madrid <-> UTC conversions (DST-safe, no dependency)
src/devices/supply.js    the supply device (one per CUPS) and its states
src/actions.js           Configuration screen buttons (manifest `actions`)
src/scenes.js            scene actions (manifest `scene_actions`)
src/widgets.js           dashboard widgets (manifest `widgets`)
src/config.js            DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
gladys-assistant-integration.json  manifest
docs/{en,fr,de,es}.md    user documentation, re-hosted by Gladys (mandatory)
test/                    node --test, against the SDK's fake Gladys and a fake Datadis
```

## Rules

- **External ids are forever.** A supply is keyed by its CUPS
  (`gladys.externalIds('supply', cups)`), never by its address. Feature keys,
  manifest `config_schema`, `actions`, scene trigger/action and widget keys are
  stored by users: never rename one.
- **Datadis etiquette.** Datadis refuses (429) an identical query asked too
  often and serves yesterday's readings at best. Never query more often than
  `refresh_hours` (6 h minimum) except on an explicit user request
  (`force: true`), read one month per query, and keep what was read in the
  cache. Tests never touch the network: inject a fake client / fetch.
- **Time.** Datadis dates are local Europe/Madrid times, an hourly reading
  being the hour that ENDS the interval (`01:00`..`24:00`, `25:00` on the
  autumn DST day). Convert only through `src/time.js`.
- **Consumption goes through `publishEnergyConsumption`** (30-minute slots, two
  equal halves per hour, created devices only), never through `publishState`.
  The other features use `publishChangedStates`.
- **Every feature carries `name`, `min`, `max`, `read_only` and
  `has_feedback`** (Gladys stores them NOT NULL); `test/devices.test.js` checks
  it.
- **Secrets and personal data.** The password is a `secret` field; never log
  it, the token, a NIF or a full CUPS (use `maskCups`). The rootfs is
  read-only: write only under `/data` (`DATA_DIR` overrides it in tests).
- **Scene triggers fire on transitions only** (a new day, a new peak, a new
  error), and the edge detection is persisted so a restart never re-fires
  them. A scene action never fires a scene event.
- **Four languages.** Every user-facing text — manifest labels, descriptions,
  placeholders, options, action messages, connection statuses, widget texts —
  is a `{ en, fr, de, es }` object, and `docs/en.md`, `fr.md`, `de.md`,
  `es.md` are kept in sync. `test/manifest.test.js` and
  `test/widgets.test.js` check the four keys.
- **Manifest.** The catalog `description` holds 10 to 100 characters per
  language. `widgets`, `scene_triggers` and `scene_actions` require
  `gladys_version` `>=5.1.0`. `test/manifest.test.js` ties the manifest to the
  code (defaults, bounds, handlers): change both sides together.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English.
