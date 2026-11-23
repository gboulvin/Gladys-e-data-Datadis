# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-23

### Added

- First release of the e-data (Datadis) integration for Gladys Assistant 5.1 or
  later: one device per Spanish electricity supply (CUPS) of the Datadis
  account, read from the cloud (no local access).
- Hourly consumption imported into the Gladys energy monitoring as dated
  30-minute intervals, with up to 24 months of history on the first sync.
- Last day consumption, current month consumption, month maximum power,
  contracted power and date of the latest reading as device features.
- Scene triggers: new daily data, high daily consumption, power peak alarm
  (maximeter peak close to the contracted power) and Datadis error.
- Scene actions: refresh the Datadis data, get the consumption and the peak
  power of a supply over a period.
- Dashboard widgets: one supply (last day, month, peak power gauge, last 14
  days) and all the supplies of the account.
- Configuration actions: test the connection, refresh the data now.
- English, French, German and Spanish texts and documentation.
- Local cache under `/data`, so a restart re-reads nothing and Datadis queries
  are spaced out (Datadis refuses repeated identical queries).
- `SECURITY.md`, `CLAUDE.md`, CI on Node 22 and 24, Release workflow, GitHub
  Releases and Dependabot, from the official JavaScript template.

[Unreleased]: https://github.com/gboulvin/Gladys-e-data-Datadis/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gboulvin/Gladys-e-data-Datadis/releases/tag/v1.0.0
