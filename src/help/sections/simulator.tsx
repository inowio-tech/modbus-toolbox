import React from "react";
import SectionBlock from "./SectionBlock";
import type { HelpSectionDefinition } from "../types";

const simulatorSection: HelpSectionDefinition = {
  slug: "simulator",
  title: "TCP Simulator",
  description:
    "Run a Modbus TCP server inside the app so external masters—SCADA systems, PLCs, test tools—can poll and write virtual devices without any physical hardware.",
  keywords: [
    "simulator",
    "tcp server",
    "modbus server",
    "virtual device",
    "holding registers",
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
    "random",
    "toggle",
    "byte order",
    "data type",
    "update interval",
    "route from slave",
    "route",
    "gateway",
    "source status",
    "ok",
    "stale",
    "missing",
    "rules",
    "automation",
    "trigger",
    "action",
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
    "device templates",
    "device catalog",
    "add device",
    "rename device",
    "rebase device",
    "delete device",
    "temp sensor",
    "energy meter",
    "vfd",
    "relay board",
    "soil sensor",
    "register playground",
  ],
  searchText:
    "Learn how the TCP Simulator turns the workbench into a Modbus TCP server that external masters can query. Covers the Expose toggle (LAN 0.0.0.0 vs Local only 127.0.0.1), configuring the port, Start and Stop, the resolved 'Listening on …' address, adding and editing Holding registers across multiple Unit IDs, device templates (a built-in catalog of ready-made virtual devices—temp/humidity sensor, energy meter, VFD, relay board, soil sensor, register playground—added at a base address + Unit ID, grouped in the registers table, and renamed/re-based/deleted as a unit), value sources (Hold, Device presets, Generators—sine/ramp/random/toggle, and Route from slave) with u16/i16/u32/i32/f32 data types and byte order (ABCD/BADC/CDAB/DCBA), per-register update intervals, the live value view streamed from the backend, the ok/stale/missing route source-status badge, the global running-status chip, and automation rules that pair a trigger (interval / register condition / on client write) with an action (set/inc/dec/toggle/copy/randomize) for conditional and cross-register behavior.",
  anchors: [
    { id: "overview", label: "What the TCP Simulator does" },
    { id: "expose", label: "Expose toggle (LAN vs Local only)" },
    { id: "port", label: "Port configuration" },
    { id: "start-stop", label: "Start / Stop" },
    { id: "listening", label: "\"Listening on …\" address" },
    { id: "registers", label: "Holding registers & Unit IDs" },
    { id: "device-templates", label: "Device templates" },
    { id: "value-sources", label: "Value sources: Hold, Device presets, Generators" },
    { id: "route-from-slave", label: "Route from slave" },
    { id: "live-values", label: "Live value view" },
    { id: "status-chip", label: "Global running-status chip" },
    { id: "rules", label: "Rules (trigger → action)" },
    { id: "best-practices", label: "Best practices" },
    { id: "summary", label: "Summary" },
  ],
  Component: (): React.ReactElement => (
    <div className="space-y-6">
      <SectionBlock section="simulator" anchor="overview" title="What the TCP Simulator does">
        <p>
          The TCP Simulator turns Modbus Workbench into a Modbus TCP <strong>server</strong>. Once started, external masters—SCADA systems, PLCs, HMIs, or test tools such as QModMaster—can connect to the app and issue standard Modbus TCP requests. The app answers them using the register values you have configured, with no physical hardware required.
        </p>
        <p>
          This is useful for verifying a SCADA configuration before hardware arrives, building integration tests against a controlled set of register values, or demonstrating device behavior in a training environment.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Serves Holding registers (function code 0x03 / 0x06 / 0x10) across one or more Unit IDs on a single TCP port.</li>
          <li>Supports concurrent client connections.</li>
          <li>Register values are editable live—masters see the change on the next poll.</li>
          <li>Configuration is saved with the workspace so each project can have its own simulator setup.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="expose" title="Expose toggle (LAN vs Local only)">
        <p>
          The <strong>Expose</strong> toggle controls which network interface the server binds to:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>LAN</strong> (default) — binds to <code>0.0.0.0</code>. The server accepts connections from any network interface, making it reachable by other devices on the same LAN. Use this when a SCADA system or PLC on another machine needs to poll the simulator.
          </li>
          <li>
            <strong>Local only</strong> — binds to <code>127.0.0.1</code>. Only processes running on the same machine can connect. Choose this for development and testing when you do not want the port exposed on your network.
          </li>
        </ul>
        <p className="text-xs text-amber-800 dark:text-amber-300">
          Enable LAN exposure only on trusted networks. The simulator does not authenticate clients—anyone who can reach the port can read and write registers.
        </p>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="port" title="Port configuration">
        <p>
          Enter any valid TCP port (1–65535) in the <strong>Port</strong> field. The standard Modbus TCP port is <strong>502</strong>, but that port typically requires elevated privileges on most operating systems. For development, use a high port such as <strong>5502</strong> or <strong>10502</strong> to avoid permission issues.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>If the chosen port is already in use, Start will fail with a descriptive error.</li>
          <li>Port changes only take effect after a Stop and Start cycle.</li>
          <li>The resolved address (host + port) shown in "Listening on …" reflects the actual bound socket.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="start-stop" title="Start / Stop">
        <p>
          Click <strong>Start</strong> to launch the server. The button switches to <strong>Stop</strong> once the server is running. Click Stop to shut it down and release the port.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>The server starts asynchronously; the status chip updates within a moment.</li>
          <li>Existing client connections are dropped when Stop is pressed.</li>
          <li>You can edit register values and add or remove registers while the server is running—changes are reflected immediately to polling masters.</li>
          <li>Changing the port or Expose toggle requires a Stop + Start to take effect.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="listening" title={"\"Listening on …\" address"}>
        <p>
          When the server is running, the page shows a <strong>Listening on …</strong> address, for example <code>127.0.0.1:5502</code> or <code>0.0.0.0:502</code>. This is the actual socket address reported by the OS after the port is bound—use it verbatim when configuring the master (SCADA, PLC, or test tool).
        </p>
        <p>
          If Expose is set to LAN (<code>0.0.0.0</code>), masters on other machines should use the machine's LAN IP address (e.g., <code>192.168.1.42:5502</code>) rather than <code>0.0.0.0</code>. The workbench displays the wildcard address because that is what is bound; substitute your actual IP when pointing an external client.
        </p>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="registers" title="Holding registers & Unit IDs">
        <p>
          The simulator can serve multiple <strong>Unit IDs</strong> on the same port—each unit acts as a separate virtual device from the master's perspective. Add registers per Unit ID using the register table:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Unit ID</strong> — a value from 0 to 255 identifying the virtual device. Masters specify this in the Modbus PDU.</li>
          <li><strong>Address</strong> — the Holding register address (0–65535), matching what the master will request with function code 0x03.</li>
          <li><strong>Alias</strong> — optional friendly name for quick identification in the table.</li>
          <li><strong>Value</strong> — the word value returned to masters, produced by the register's configured value source (see below). You can edit a Hold value live while the server is running.</li>
        </ul>
        <p>
          To add a register, click <strong>Add Register</strong>, fill in the Unit ID, address, and initial value, then save. To remove a register, use the delete action on its row.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Currently only Holding registers (function code 0x03 read / 0x06 single write / 0x10 multiple write) are supported. Coils, Discrete Inputs, and Input Registers are planned for a future release.
        </p>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="device-templates" title="Device templates">
        <p>
          Instead of adding registers one at a time, click <strong>+ Add Device</strong> to instantiate a ready-made virtual device from a built-in catalog (temperature/humidity sensor, energy meter, VFD, relay board, soil sensor, or an empty register playground). Pick a template, a <strong>base address</strong>, and a <strong>Unit ID</strong>—the app expands the template's register map into real registers at <code>base address + offset</code>, stamped as belonging to that device instance.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>The registers table groups a device's registers under a <strong>header row</strong> showing its name, Unit ID, and the min–max address span of its registers. Registers added individually (not via a device) appear in a separate <strong>Standalone</strong> group.</li>
          <li><strong>Rename</strong> — change the device's display name without touching its registers.</li>
          <li><strong>Re-base</strong> — move the whole device to a new base address; every child register shifts by the same offset. The move is rejected if it would collide with an existing register.</li>
          <li><strong>Delete</strong> — removes the device and all of its child registers together, as a single action.</li>
        </ul>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The v1 catalog is built-in and register-map only. Custom templates (save-as-template, JSON import/export) and bundled default rules per template are planned for a follow-up release.
        </p>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="value-sources" title="Value sources: Hold, Device presets, Generators">
        <p>
          Each register's value comes from one of three sources, chosen when the register is added or edited:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Hold</strong> — a fixed value you type in and can edit live while the server runs. Best for static configuration registers or values a master is expected to write to.</li>
          <li><strong>Device presets</strong> — canned signal shapes that mimic common sensors (temperature, humidity, pressure, flow, vibration, analog, discrete, counter), so a register looks like a plausible live device without hand-tuning a waveform.</li>
          <li><strong>Generators</strong> — raw waveform generators (sine, ramp, random, toggle) with configurable parameters (amplitude, period, min/max, etc.) for building custom test signals.</li>
        </ul>
        <p>
          Device and Generator registers support the <strong>u16</strong>, <strong>i16</strong>, <strong>u32</strong>, <strong>i32</strong>, and <strong>f32</strong> data types, each with a selectable <strong>byte order</strong>:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>1-word types (u16/i16) — <code>ABCD</code> (as-is) or <code>BADC</code> (byte swap).</li>
          <li>2-word types (u32/i32/f32) — <code>ABCD</code>, <code>BADC</code> (byte swap), <code>CDAB</code> (word swap), or <code>DCBA</code> (word + byte swap). Choose whichever matches your master's expected register-pair convention.</li>
        </ul>
        <p>
          Each Device or Generator register has its own <strong>update interval</strong> (in milliseconds) controlling how often its value recomputes—independent of the other registers, so you can mix a slow-drifting temperature with a fast toggle on the same simulator.
        </p>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="route-from-slave" title="Route from slave">
        <p>
          A register can also mirror a <strong>live value read from a connected real slave</strong>, turning the workbench into a Modbus gateway: masters that poll the simulator see a value sourced from an actual device over the workspace's existing client connection.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>The source slave must already be <strong>connected</strong> via the normal Connection UI—Route never auto-connects on your behalf.</li>
          <li>Reads are a straight mirror of the raw register words at the configured source address; the simulator does not decode them. <strong>Scale/offset transforms are not yet supported</strong> for routed values.</li>
          <li>Each routed register shows a small <strong>source-status badge</strong> next to its live value: <strong>ok</strong> (emerald) — the last read succeeded; <strong>stale</strong> (amber) — the last read failed or timed out, so the previous value is still being served; <strong>missing</strong> (rose) — the source session isn't connected, so no live read has ever succeeded.</li>
          <li>On a stale or missing read, the simulator keeps serving the last known-good value rather than an error.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="live-values" title="Live value view">
        <p>
          While the server is running, the register table shows the <strong>current in-memory value</strong> for each register, streamed live to the UI as the simulator ticks—no need to refresh the page. When a master writes a Hold register (via 0x06 or 0x10), the table updates immediately so you can see incoming writes without additional tooling.
        </p>
        <p>
          This makes the simulator useful as a passive observer: point a PLC's output block at the simulator and watch the values arrive in real time, confirming the master is writing the right addresses with the right values.
        </p>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="status-chip" title="Global running-status chip">
        <p>
          A small <strong>status chip</strong> in the navigation bar reflects the simulator's state across all pages—you do not have to return to the TCP Simulator page to check whether it is running. The chip shows:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Running</strong> (green) — server is bound and accepting connections.</li>
          <li><strong>Stopped</strong> (neutral) — server is not running; no port is held.</li>
        </ul>
        <p>
          Click the chip to navigate directly to the TCP Simulator page.
        </p>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="rules" title="Rules (trigger → action)">
        <p>
          Rules add conditional and cross-register behavior on top of the register list: each rule pairs a <strong>trigger</strong> with one or more <strong>actions</strong>. Rules run once per tick, in <strong>sort order</strong>, after generators/presets and routed values have updated but before the tick is served to clients—so a rule can react to this tick's fresh values.
        </p>
        <p>Three trigger types are available:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Interval</strong> — fires every N milliseconds, independent of any register value.</li>
          <li><strong>Condition</strong> — fires on the edge where <code>register op value</code> becomes true (op ∈ <code>== != &lt; &gt; &gt;= &lt;= changed</code>), e.g. <code>holding[0] &gt;= 100</code>. It only fires on the transition into true, not on every tick the condition holds.</li>
          <li><strong>On client write</strong> — fires when a connected master writes to a specific register (or any register, depending on configuration), e.g. <code>onWrite coil[0]</code>.</li>
        </ul>
        <p>When a rule fires, its actions run in order:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>set</strong> — writes a constant value.</li>
          <li><strong>inc</strong> / <strong>dec</strong> — increments or decrements by N, wrapping on overflow/underflow.</li>
          <li><strong>toggle</strong> — flips a bit, or a word between 0 and non-zero.</li>
          <li><strong>copy</strong> — copies another register's value, with optional integer scale and offset.</li>
          <li><strong>randomize</strong> — writes a random value within a min/max range.</li>
        </ul>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Rules act on a single word or bit at <code>(unit, bank, address)</code>—multi-word/typed targets are affected only at the base word. A rule can target any register regardless of its value source, including Device/Generator/Route registers, but a rule-written value on one of those is overwritten on the next tick since the source keeps driving it; rules are strongest on Hold registers. Rule changes—like register changes—take effect on the next Start.
        </p>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="best-practices" title="Best practices">
        <ul className="list-disc space-y-1 pl-5">
          <li>Use <strong>Local only</strong> during development and unit testing; switch to LAN only when a physical device on another machine needs to connect.</li>
          <li>Pick a high port (5502, 10502) to avoid OS permission requirements and conflicts with real Modbus servers.</li>
          <li>Add one register at address 0 for each Unit ID you plan to serve—masters often probe address 0 first.</li>
          <li>Confirm the "Listening on …" address matches what you enter in your master configuration. Mismatched ports are the most common connection failure.</li>
          <li>Stop the server before closing the workspace if other tools are connected—abrupt closure can confuse some PLCs.</li>
        </ul>
      </SectionBlock>
      <SectionBlock section="simulator" anchor="summary" title="Summary">
        <p>
          The TCP Simulator lets you replace physical Modbus hardware with a controllable in-app server. Configure the Expose toggle and port, add Holding registers across one or more Unit IDs, hit Start, and external masters immediately have a target to poll. Watch live values update as masters write, use the global status chip to confirm the server is up, and stop cleanly when the session ends.
        </p>
      </SectionBlock>
    </div>
  ),
};

export default simulatorSection;
