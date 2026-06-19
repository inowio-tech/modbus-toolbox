# Changelog

All notable changes to this project are tracked here following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No changes yet._

## [0.3.1] - 2026-06-19
### Added
- **Live Monitor view** for the Read/Write Registers card. An Edit/Monitor
  toggle reveals a read-only dashboard tuned for watching values at scale:
  Cards / Dense-rows density, search by alias or address, status filters
  (All / Changed / Errors / Pinned), per-register pinning, and a change
  highlight that briefly flashes updated values (and faults) before fading.
- **Grid / List views** for the workspace browser, in a redesigned full-width
  layout, with the chosen view remembered between sessions.
- **Slave status bar** pinned to the bottom of the slave page showing the
  connection, polling state and interval, last-update age, and OK / Bad / Err
  tallies.
- Unsaved-changes warning when leaving a workspace with pending edits.

### Changed
- UI preferences now persist locally: the Edit/Monitor view and Monitor density
  are remembered per workspace, and the selected register type is remembered
  per slave, so each device returns to the register map you last viewed.
- Nudged the dropdown chevron in from the far edge of every select control.
- Tightened the slave detail header and registers card layout.

### Fixed
- The register change-highlight now fades after each update (and also flashes
  on errors) instead of staying lit permanently.
- PDF attachment preview rendering.

## [0.3.0] - 2026-05-23
### Changed
- **Renamed the project from "Modbus Toolbox" to "Modbus Workbench"** to
  avoid a trademark conflict with Infineon's ModbusToolbox. The GitHub
  repository moved to <https://github.com/inowio/modbus-workbench>.
- Bundle identifier changed from `in.inowio.modbus.toolbox` to
  `in.inowio.modbus.workbench`. **This is a breaking change for existing
  installs:** the OS treats v0.3.0 as a new application, so v0.2.x users
  will not receive an automatic update and must download and install
  v0.3.0 manually. Workspaces and settings stored under the old
  `in.inowio.modbus.toolbox` config directory are not migrated
  automatically.
- Dropped the `inowio-` prefix from internal package identifiers: Cargo
  package `inowio-modbus-workbench` → `modbus-workbench`, Rust library
  `inowio_modbus_workbench_lib` → `modbus_workbench_lib`, npm package
  name `inowio-modbus-workbench` → `modbus-workbench`. The GitHub
  organization (`inowio/`) already provides the namespace.
- Updater feed URL now points at the new repository's
  `releases/latest/download/latest.json`.

## [0.2.1] - 2026-05-20
### Added
- Custom right-click context menu on text inputs and textareas with Cut,
  Copy, Paste, Delete, and Select All. Replaces the browser's default
  context menu so the app feels consistently desktop-native.

### Changed
- External links (GitHub source, releases, etc.) now open in the system
  browser via the Tauri opener plugin. Previously they silently did nothing
  inside the locked-down webview.
- GitHub Actions release workflow now uses `actions/checkout@v5` and
  `actions/setup-node@v5` (Node.js 24 runtime), clearing the Node.js 20
  deprecation warnings GitHub started emitting.

### Documentation
- `docs/RELEASING.md` now documents the mandatory
  `bundle.createUpdaterArtifacts: true` flag, the PR-required release flow
  under branch protection, and a troubleshooting section for missing
  updater artifacts.

## [0.2.0] - 2026-05-20
### Added
- GitHub Actions release workflow that builds Windows, Linux, and macOS
  installers on every `v*` tag and publishes them as a draft release with
  signed update artifacts.
- In-app auto-updater: silent check on startup that prompts when a newer
  release is available, plus a manual "Check for updates" button and a
  "Latest release on GitHub" download link on the About page.
- `npm run release -- X.Y.Z` bump script that syncs the version across
  `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/Cargo.lock`, and reshapes `CHANGELOG.md` into a dated section.
- `docs/RELEASING.md` maintainer runbook covering one-time keypair setup,
  CI secrets, the release loop, pre-releases, and failure recovery.

## [0.1.0] - 2025-02-05

### Added
- Initial public release of Inowio Modbus Workbench
- Modbus TCP/RTU connection management with persistent workspaces
- Device registry, analyzer, traffic monitor, and logging system
- Cross-platform bundles plus documentation and help content
