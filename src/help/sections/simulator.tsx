import React from "react";
import SectionBlock from "./SectionBlock";
import HelpAnchorLink from "../components/HelpAnchorLink";
import type { HelpSectionDefinition } from "../types";

const simulatorSection: HelpSectionDefinition = {
  slug: "simulator",
  title: "TCP Simulator",
  description:
    "Run a Modbus TCP server inside the app so external masters—SCADA systems, PLCs, test tools—can poll and write virtual devices, generated signals, or values routed from real slaves, without any physical hardware.",
  keywords: [
    "simulator",
    "tcp server",
    "modbus server",
    "virtual device",
    "coils",
    "discrete inputs",
    "holding registers",
    "input registers",
    "banks",
    "unit id",
    "expose",
    "lan",
    "local only",
    "start",
    "stop",
    "listening",
    "port",
    "scada",
    "plc",
    "device presets",
    "generators",
    "sine",
    "ramp",
    "decrement",
    "step",
    "random",
    "toggle",
    "byte order",
    "data type",
    "u16",
    "u32",
    "u64",
    "f32",
    "f64",
    "update interval",
    "route from slave",
    "route",
    "gateway",
    "scale",
    "offset",
    "source status",
    "ok",
    "stale",
    "missing",
    "rules",
    "automation",
    "trigger",
    "action",
    "delay",
    "interval",
    "condition",
    "onwrite",
    "on write",
    "set",
    "inc",
    "dec",
    "toggle",
    "copy",
    "randomize",
    "tabs",
    "registers tab",
    "devices tab",
    "rules tab",
    "live values",
    "activity",
    "uptime",
    "connected clients",
    "event log",
    "profile",
    "export profile",
    "import profile",
    "add device",
    "virtual device",
    "rename device",
    "rebase device",
    "delete device",
  ],
  searchText:
    "Learn how the TCP Simulator turns the workbench into a Modbus TCP server external masters can query. Covers the tabbed workspace (Registers, Devices, Rules, Live Values, Activity), the status dashboard (Exposed, Accessible At, Connected Clients, Tick Interval) and footer, the Expose toggle (LAN 0.0.0.0 vs Local only 127.0.0.1), the port, Start/Stop, the resolved Listening/Accessible-At address, serving all four register banks (Coils, Discrete Inputs, Holding, Input) across multiple Unit IDs, value sources (Hold, Device presets, Generators—sine/ramp/decrement/step/random/toggle, and Route from slave) with u16/i16/u32/i32/f32/u64/i64/f64 data types and byte order (ABCD/BADC/CDAB/DCBA), per-register update intervals, adding whole virtual devices via Add Device (built-in, custom, or a workspace slave routed as a gateway), the live value view, the ok/stale/missing route source-status badge, scale/offset transforms on routed values, the Activity tab (uptime, connected-clients list, event log), workspace Profile export/import, the global running-status chip with client count, and automation rules pairing a trigger (interval / register condition / on client write) with actions (set/inc/dec/toggle/copy/randomize) including per-action delay and multi-word targets.",
  anchors: [
    { id: "overview", label: "What the TCP Simulator does" },
    { id: "tabs", label: "The five tabs" },
    { id: "expose", label: "Expose toggle (LAN vs Local only)" },
    { id: "port", label: "Port configuration" },
    { id: "start-stop", label: "Start / Stop" },
    { id: "status-dashboard", label: "Status dashboard & Accessible-At address" },
    { id: "registers", label: "Registers & banks across Unit IDs" },
    { id: "value-sources", label: "Value sources: Hold, Device, Generators" },
    { id: "route-from-slave", label: "Route from slave (gateway)" },
    { id: "add-device", label: "Add Device (virtual devices)" },
    { id: "rules", label: "Rules (trigger → action)" },
    { id: "live-values", label: "Live Values tab" },
    { id: "activity", label: "Activity tab (clients & events)" },
    { id: "profile", label: "Profile export / import" },
    { id: "status-chip", label: "Global running-status chip" },
    { id: "best-practices", label: "Best practices" },
    { id: "summary", label: "Summary" },
  ],
  Component: (): React.ReactElement => (
    <div className="space-y-6">
      <SectionBlock section="simulator" anchor="overview" title="What the TCP Simulator does">
        <p>
          The TCP Simulator turns Modbus Workbench into a Modbus TCP <strong>server</strong>. Once started, external masters—SCADA systems, PLCs, HMIs, or test tools such as QModMaster—connect to the app and issue standard Modbus TCP requests. The app answers them from the registers you configured, with no physical hardware required.
        </p>
        <p>
          Use it to verify a SCADA configuration before hardware arrives, build integration tests against a controlled set of values, demonstrate device behavior in training, or turn the workbench into a <strong>Modbus gateway</strong> that re-serves a real RTU/TCP slave over TCP.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Serves all four banks—<strong>Coils</strong> (0x01), <strong>Discrete Inputs</strong> (0x02), <strong>Holding registers</strong> (0x03/0x06/0x10), and <strong>Input registers</strong> (0x04)—across one or more Unit IDs on a single TCP port.</li>
          <li>Supports concurrent client connections; values update on a fixed <strong>tick</strong>.</li>
          <li>Register values can be fixed, generated, or routed from a live slave, and are editable while running—masters see the change on the next poll.</li>
          <li>Configuration is saved with the workspace, so each project has its own simulator setup.</li>
        </ul>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="tabs" title="The five tabs">
        <p>The simulator page is organized into tabs, each showing a count where relevant:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Registers</strong> — the full register table with search, unit/source/type filters, a Columns chooser, Dec/Hex address format, and pagination. Add individual registers or whole devices here.</li>
          <li><strong>Devices</strong> — the virtual-device instances you added, each with a Rename / Re-base / Save-as-virtual-device / Delete menu.</li>
          <li><strong>Rules</strong> — automation rules (trigger → action).</li>
          <li><strong>Live Values</strong> — a compact, always-live view of every register's current value.</li>
          <li><strong>Activity</strong> — uptime, the connected-clients list, and a rolling event log.</li>
        </ul>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="expose" title="Expose toggle (LAN vs Local only)">
        <p>The <strong>Expose</strong> control chooses which network interface the server binds to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>LAN / Intranet</strong> — binds to <code>0.0.0.0</code>, reachable by other devices on the same network. Use this when a SCADA system or PLC on another machine needs to poll the simulator.
          </li>
          <li>
            <strong>Local only</strong> — binds to <code>127.0.0.1</code>. Only processes on this machine can connect. Best for development and testing.
          </li>
        </ul>
        <p className="text-xs text-amber-800 dark:text-amber-300">
          Enable LAN exposure only on trusted networks. The simulator does not authenticate clients—anyone who can reach the port can read and write registers.
        </p>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="port" title="Port configuration">
        <p>
          Enter any valid TCP port (1–65535). The standard Modbus TCP port is <strong>502</strong>, but it usually needs elevated privileges. For development use a high port such as <strong>5502</strong> or <strong>10502</strong> to avoid permission issues.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>If the port is already in use, Start fails with a descriptive error.</li>
          <li>Port and Expose changes take effect after a Stop + Start.</li>
          <li>The <strong>Accessible At</strong> value reflects the actual bound socket.</li>
        </ul>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="start-stop" title="Start / Stop">
        <p>
          Click <strong>Start</strong> (Listen) to launch the server; it switches to <strong>Stop</strong> while running. Stop shuts it down and releases the port.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>The server starts asynchronously; the status updates within a moment.</li>
          <li>You can add, edit, and remove registers, devices, and rules while running—most changes apply immediately; changing the port/Expose, or a register's source/type wiring, applies on the next Start (the table notes this).</li>
          <li>Existing client connections are dropped on Stop.</li>
        </ul>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="status-dashboard" title="Status dashboard & Accessible-At address">
        <p>Above the tabs, four cards summarize the server at a glance:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Exposed</strong> — how many registers / units / devices are being served.</li>
          <li><strong>Accessible At</strong> — the bound socket, e.g. <code>192.168.68.127:502</code>. Use this verbatim when configuring the master.</li>
          <li><strong>Connected Clients</strong> — the current live client count.</li>
          <li><strong>Tick Interval</strong> — how often the simulator recomputes values and applies rules.</li>
        </ul>
        <p>
          A footer strip repeats the essentials across the bottom (Running, Port, Tick, clients, Up-time, last update). If Expose is LAN (<code>0.0.0.0</code>), point external masters at this machine's real LAN IP (e.g. <code>192.168.1.42:502</code>).
        </p>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="registers" title="Registers & banks across Unit IDs">
        <p>
          The simulator serves multiple <strong>Unit IDs</strong> on the same port—each unit is a separate virtual device to the master. Add a register with <strong>+ Add Register</strong>:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Unit ID</strong> (0–255) — the device the master addresses.</li>
          <li><strong>Register type / bank</strong> — Coil (0x01), Discrete input (0x02), Holding (0x03), or Input (0x04). Coils/Discrete carry a single <code>bool</code>; Holding/Input carry words.</li>
          <li><strong>Address</strong> (0–65535) — what the master requests.</li>
          <li><strong>Alias</strong> — an optional friendly name.</li>
          <li><strong>Value source</strong> — Hold, Device preset, Generator, or Route (see below).</li>
        </ul>
        <p>
          The table supports search, filters (unit / source / type), a <strong>Columns</strong> chooser, a <strong>Dec/Hex</strong> address toggle, and pagination. Click a row to open the inspector; use the row's delete action (with confirmation) to remove it.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Writable banks (Coils, Holding) accept master writes (0x05/0x06/0x0F/0x10); Discrete Inputs and Input registers are read-only, as in the Modbus spec.
        </p>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="value-sources" title="Value sources: Hold, Device presets, Generators">
        <p>Each register's value comes from one of four sources, chosen when it is added or edited:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Hold</strong> — a fixed value you type and can edit live. Best for configuration registers or values a master is expected to write.</li>
          <li><strong>Device presets</strong> — canned signal shapes that mimic real sensors (temperature, humidity, pressure, flow, vibration, analog, discrete, counter), so a register looks plausibly live without tuning a waveform.</li>
          <li><strong>Generators</strong> — raw waveforms: <strong>sine</strong>, <strong>ramp</strong> (rising sawtooth), <strong>decrement</strong> (falling sawtooth), <strong>step</strong> (integer staircase), <strong>random</strong>, and <strong>toggle</strong>, with min/max and period parameters.</li>
          <li><strong>Route</strong> — mirror a live value from a real slave (see the next topic).</li>
        </ul>
        <p>
          Device, Generator, and Route registers support <strong>u16, i16, u32, i32, f32, u64, i64,</strong> and <strong>f64</strong> data types, each with a selectable <strong>byte order</strong>:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>1-word types (u16/i16) occupy one register; byte order is fixed <code>ABCD</code>.</li>
          <li>Multi-word types (u32/i32/f32 = 2 words, u64/i64/f64 = 4 words) offer <code>ABCD</code>, <code>BADC</code> (byte swap), <code>CDAB</code> (word swap), or <code>DCBA</code> (word + byte swap) to match your master's register-pair convention.</li>
        </ul>
        <p>
          Each Device/Generator/Route register has its own <strong>update interval</strong> (ms), so you can mix a slow-drifting temperature with a fast toggle on one simulator.
        </p>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="route-from-slave" title="Route from slave (gateway)">
        <p>
          A <strong>Route</strong> register mirrors a live value read from a connected real slave, turning the workbench into a Modbus gateway: masters polling the simulator see a value sourced from an actual device over the workspace's client connection (serial RTU or TCP).
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Configure the <strong>source slave unit</strong>, <strong>connection</strong> (TCP/Serial), <strong>function</strong> (read coils/discrete/holding/input), and <strong>source address</strong>.</li>
          <li><strong>Scale &amp; offset</strong> transform the value: exposed = <code>source × scale + offset</code>. A separate <strong>source byte order</strong> can be set when the source encodes multi-word values differently from how you expose them.</li>
          <li>The simulator <strong>opens the source connection itself when you Start</strong>—you no longer need to keep the Slaves page connected. It reuses an already-open shared connection (so a serial port is never opened twice).</li>
          <li>Each routed register shows a <strong>source-status badge</strong>: <strong>ok</strong> (emerald, last read succeeded), <strong>stale</strong> (amber, last read failed/timed out—last good value still served), or <strong>missing</strong> (rose, no source connection yet). The last known-good value keeps being served on stale/missing.</li>
        </ul>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          If a source can't be reached at Start, the server still starts and the reason is written to the workspace log; affected registers show <strong>missing</strong> until the source becomes reachable.
        </p>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="add-device" title="Add Device (virtual devices)">
        <p>
          Instead of adding registers one at a time, click <strong>+ Add Device</strong> to instantiate a whole{" "}
          <HelpAnchorLink section="virtual-devices" anchor="overview">Virtual Device</HelpAnchorLink> in one step. The wizard groups choices by category:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Built-in</strong> and <strong>custom</strong> devices from the app-global catalog (e.g. temperature/humidity transmitter, energy meter).</li>
          <li><strong>Workspace</strong> — this workspace's own slaves, added as a <strong>routed</strong> device that mirrors the real slave (a one-click gateway). See <HelpAnchorLink section="virtual-devices" anchor="workspace-slaves">Expose a real slave as a device</HelpAnchorLink>.</li>
        </ul>
        <p>
          Pick a device, a <strong>Unit ID</strong>, and a <strong>base address</strong>; a live preview shows the resulting register map (<code>base + offset</code>) and flags collisions with a one-click free-base fix. Added devices group in the Registers table and appear in the Devices tab, where they can be <strong>renamed</strong>, <strong>re-based</strong> (moved as a unit), <strong>saved as a reusable virtual device</strong>, or <strong>deleted</strong> together.
        </p>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="rules" title="Rules (trigger → action)">
        <p>
          Rules add conditional and cross-register behavior. Each rule pairs a <strong>trigger</strong> with one or more <strong>actions</strong> and runs once per tick, in <strong>sort order</strong>, after generators/routes update but before the tick is served—so a rule reacts to this tick's fresh values. Deleting a rule asks for confirmation.
        </p>
        <p>Three trigger types:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Interval</strong> — fires every N milliseconds.</li>
          <li><strong>Condition</strong> — fires on the edge where <code>register op value</code> becomes true (<code>== != &lt; &gt; &gt;= &lt;= changed</code>), e.g. <code>holding[0] &gt;= 100</code>.</li>
          <li><strong>On client write</strong> — fires when a master writes a specific (or any) register, e.g. <code>onWrite coil[0]</code>.</li>
        </ul>
        <p>Actions run in order, each with an optional per-action <strong>delay</strong> (fire now, or N ms later):</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>set</strong> — write a constant.</li>
          <li><strong>inc</strong> / <strong>dec</strong> — add/subtract N (wraps on overflow).</li>
          <li><strong>toggle</strong> — flip a bit, or a word between 0 and non-zero.</li>
          <li><strong>copy</strong> — copy another register's value, with optional scale and offset.</li>
          <li><strong>randomize</strong> — write a random value in a min/max range.</li>
        </ul>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Actions can target multi-word/typed registers (the value is encoded across the register's words); single-word targets are written in place. A rule can target any register, but a rule-written value on a Device/Generator/Route register is overwritten on the next tick since the source keeps driving it—rules are strongest on Hold registers.
        </p>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="live-values" title="Live Values tab">
        <p>
          While the server runs, register values stream live to the UI as the simulator ticks—no refresh needed. When a master writes a Coil or Holding register, the value updates immediately, so the simulator doubles as a passive observer: point a PLC's output block at it and watch the writes arrive, confirming the master targets the right addresses with the right values.
        </p>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="activity" title="Activity tab (clients & events)">
        <p>The <strong>Activity</strong> tab is the server's operational view:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Uptime</strong> — how long the server has been running (also ticking in the footer).</li>
          <li><strong>Connected clients</strong> — a table of current clients with their address and how long each has been connected.</li>
          <li><strong>Event log</strong> — a rolling log of server events (started/stopped, client connect/disconnect) so you can confirm a master actually reached the server.</li>
        </ul>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="profile" title="Profile export / import">
        <p>
          A <strong>Profile</strong> captures this workspace's entire simulator setup—config, devices, registers, and rules—as one file. Use the header's <strong>Export Profile</strong> / <strong>Import Profile</strong> buttons (native file dialogs) to snapshot a setup, move it between machines, or restore a known-good configuration.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>A profile is <strong>workspace-specific</strong>: importing replaces this workspace's simulator setup.</li>
          <li>Import requires the server to be <strong>stopped</strong>.</li>
          <li>A profile is different from a device export—one is a whole-workspace snapshot, the other a single reusable device (see <HelpAnchorLink section="virtual-devices" anchor="sharing">device sharing</HelpAnchorLink>).</li>
        </ul>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="status-chip" title="Global running-status chip">
        <p>
          A <strong>status chip</strong> in the navigation bar reflects the simulator across all pages, showing <strong>Running</strong> (with the live client count, e.g. "Sim · 0 client(s)") or <strong>Stopped</strong>—so you don't have to return to the page to check. Click it to jump to the TCP Simulator.
        </p>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="best-practices" title="Best practices">
        <ul className="list-disc space-y-1 pl-5">
          <li>Use <strong>Local only</strong> during development; switch to LAN only when a device on another machine must connect.</li>
          <li>Pick a high port (5502, 10502) to avoid OS permission requirements and conflicts with real Modbus servers.</li>
          <li>Confirm the <strong>Accessible At</strong> address matches your master configuration—mismatched ports/units are the most common connection failure.</li>
          <li>For gateways, check the routed register's status badge is <strong>ok</strong>; a persistent <strong>missing</strong> means the source connection failed—check the workspace log for the reason.</li>
          <li>Snapshot a working setup with <strong>Export Profile</strong> before large changes.</li>
        </ul>
      </SectionBlock>

      <SectionBlock section="simulator" anchor="summary" title="Summary">
        <p>
          The TCP Simulator replaces physical Modbus hardware with a controllable in-app server. Configure Expose and port, add registers or whole virtual devices across banks and Unit IDs, drive them with fixed values, generators, or live routes from real slaves, and Start. Watch values stream in Live Values, monitor clients in Activity, automate with Rules, and snapshot the whole thing with Profile export/import.
        </p>
      </SectionBlock>
    </div>
  ),
};

export default simulatorSection;
