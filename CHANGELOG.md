# Changelog

All notable changes to this project are tracked here following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- **Clone a slave** — duplicate any slave from the Slaves list, including its
  full register map across every function code (alias, address, data type, byte
  order, display format, value to write) plus its poll interval, connection kind
  and address offset. The clone dialog pre-fills a free name (`<name> (copy)`)
  and the lowest unused Unit ID, and shows how many register rows will be copied.
  The copy runs in a single transaction, so a failure never leaves a partly
  cloned slave behind.

### Changed
- Slaves list: the per-row actions (Open, Clone, Edit, Delete) are now compact
  icon buttons with tooltips, so all four fit on one line.

## [0.4.0] - 2026-07-04
### Added
- **TCP Simulator (Modbus TCP server).** Turn the workbench into a Modbus TCP
  server so external masters (SCADA/PLCs/test tools) can poll and write the app
  as virtual devices. Serves all four banks — **Coils (0x01), Discrete Inputs
  (0x02), Holding (0x03/0x06/0x10), and Input (0x04)** — across multiple Unit
  IDs on one port. Start/Stop with an Expose toggle (LAN `0.0.0.0` / Local only
  `127.0.0.1`), a configurable port, and a status dashboard (Exposed / Accessible
  At / Connected Clients / Tick Interval) plus a footer strip.
- Register **value sources**: **Hold** (fixed, live-editable), **Device presets**
  (temperature, humidity, pressure, flow, vibration, analog, discrete, counter),
  **Generators** (sine, ramp, decrement, step, random, toggle), and **Route**.
  Data types **u16/i16/u32/i32/f32/u64/i64/f64** with byte order
  (ABCD/BADC/CDAB/DCBA) and per-register update intervals; live values stream to
  the UI.
- **Route from slave (Modbus gateway).** Mirror a live value read from a
  connected real slave (serial RTU or TCP) with **scale/offset** transforms and
  an optional source byte order, and an ok/stale/missing source-status badge.
  The simulator now **opens the source connection itself on Start** (reusing an
  already-open shared connection), so routing no longer requires the Slaves page
  to be actively connected.
- **Automation rules** — trigger (interval / register condition / on client
  write) → one or more actions (set/inc/dec/toggle/copy/randomize) with an
  optional **per-action delay** and **multi-word/typed targets**. Rules run once
  per tick in sort order after generators/routes update.
- **Activity tab** — server uptime, a connected-clients list (address + duration),
  and a rolling event log (started/stopped, client connect/disconnect).
- **Profile export / import** — snapshot a workspace's entire simulator setup
  (config + devices + registers + rules) to a file and restore it later
  (workspace-specific; import requires the server stopped).
- **Virtual Devices** — a top-level tab (beside Workspaces) for reusable,
  app-global device blueprints shared across every workspace's simulator:
  - A built-in catalog plus fully editable **custom devices**; built-ins are
    immutable and can be **Cloned & edited** or exported only.
  - A device **builder** with name/key/category/description, a **searchable
    icon picker**, and a register map whose per-register **parameters** switch
    between a **Form view** and a raw **JSON view**.
  - **Add Device** wizard in the simulator instantiates a device at a chosen
    Unit ID + base address, with a register-map preview and collision check.
  - **Save as virtual device** — promote a configured live simulator device into
    the catalog (pre-filled in the builder, key clash-guarded).
  - **Expose a real slave as a routed device** — a "Workspace" category in Add
    Device turns any of the workspace's slaves into a one-click routed gateway.
  - **Export / import** a device as a self-contained `.json` for community
    sharing, via native file dialogs.

### Changed
- TCP Simulator: a tabbed workspace (Registers, Devices, Rules, Live Values,
  **Activity**) with a status dashboard, register search/filter/columns/pagination,
  the Add-Device wizard, and a right-hand register inspector (live sparkline,
  Duplicate, persisted Unit/Display Format). Header buttons for Profile
  export/import. Sidebar collapse state now persists across restarts.

### Fixed
- **Expose a real slave as a device** now works for slaves that have coil or
  discrete-input registers. Those bit-bank registers are mapped to the correct
  `u16` (0/1) route type instead of `bool`, which the register validator
  rejected — previously the whole "add slave as device" action failed for any
  slave with a coil/discrete register.
- Editing a running simulator register to a **narrower** data type (e.g. `f64`
  → `u16`) no longer leaves stale "ghost" words being served at the vacated
  addresses; the previous span is cleared before the new value is seeded.
- **Duplicating** a register now searches for a free slot span-aware: it accounts
  for every existing register's full word span (not just its start) and places
  the copy's whole span in a free, in-range gap, so duplicating a multi-word
  register no longer lands inside another register's tail (and reports clearly if
  the map is full).
- Manually adding or editing a **multi-word** register (and importing a Profile)
  now rejects configurations whose word span would overlap another register,
  closing a silent live-bank corruption path that the address-only uniqueness
  check missed.
- A **multi-word** register can no longer be placed so its span runs past address
  65535 — an `f64` near the top of the map used to wrap its tail words back to
  address 0. Such registers are now rejected on add, edit, and Profile import.
- The **Help** button now opens the section for the page you're on — TCP
  Simulator, Virtual Devices, Slaves, Analyzer, etc. — instead of always the
  overview.
- Deleting a simulator **rule** now asks for confirmation (parity with register
  and device deletes).
- Custom dropdown menus (the Registers **Columns** chooser and the Analyzer tile
  menus) now close on **Escape** and on an outside click.
- The register-map **Add Device** wizard trimmed to two steps (removed the Review
  step); Prev/Next pagination controls use icons.

## [0.3.2] - 2026-06-19
### Fixed
- RTU connect no longer fails with "modbus probe exception: Illegal data
  address" on devices whose holding registers don't start at address 0 (and on
  input-register-only sensors). The connect probe now treats a Modbus exception
  reply as a successful connection — the slave answering at all confirms the
  link; only a timeout or transport error means the device is unreachable.

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
