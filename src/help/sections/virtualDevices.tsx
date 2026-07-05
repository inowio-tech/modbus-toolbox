import React from "react";
import SectionBlock from "./SectionBlock";
import HelpAnchorLink from "../components/HelpAnchorLink";
import type { HelpSectionDefinition } from "../types";

const virtualDevicesSection: HelpSectionDefinition = {
  slug: "virtual-devices",
  title: "Virtual Devices",
  description:
    "Reusable device blueprints — register maps you build once and reuse across every workspace's TCP Simulator, clone from a built-in catalog, save from a live device, and share with the community as a JSON file.",
  keywords: [
    "virtual device",
    "device builder",
    "device template",
    "template",
    "catalog",
    "gallery",
    "built-in",
    "custom device",
    "clone",
    "register map",
    "icon picker",
    "form view",
    "json view",
    "parameters",
    "export device",
    "import device",
    "share device",
    "community",
    "save as virtual device",
    "workspace device",
    "route slave",
    "add device",
    "base address",
    "unit id",
    "value source",
    "hold",
    "generator",
    "device preset",
    "route",
  ],
  searchText:
    "Learn what Virtual Devices are and how to build, reuse, and share them. Covers the top-level Virtual Devices tab (next to Workspaces), the built-in catalog vs custom devices, cloning a built-in, the device builder/editor (name, key, category, description, searchable icon picker, and a register map with per-register bank, data type, byte order and value source), the per-register Parameters editor with a Form/JSON toggle for generator/device-preset/route sources, using a virtual device in a workspace's TCP Simulator via Add Device (base address + Unit ID with a register-map preview and collision check), saving a configured live device as a reusable virtual device, exposing an existing workspace slave as a routed virtual device from the Workspace category, and exporting/importing a device as a self-contained .json for community sharing.",
  anchors: [
    { id: "overview", label: "What Virtual Devices are" },
    { id: "where", label: "Where they live" },
    { id: "builtin-custom", label: "Built-in vs custom" },
    { id: "gallery", label: "The device gallery" },
    { id: "builder", label: "The device builder" },
    { id: "params", label: "Register parameters (Form / JSON)" },
    { id: "use-in-simulator", label: "Using a device in the TCP Simulator" },
    { id: "save-as", label: "Save a live device as a virtual device" },
    { id: "workspace-slaves", label: "Expose a real slave as a device" },
    { id: "sharing", label: "Export / import & sharing" },
    { id: "best-practices", label: "Best practices" },
    { id: "summary", label: "Summary" },
  ],
  Component: (): React.ReactElement => (
    <div className="space-y-6">
      <SectionBlock section="virtual-devices" anchor="overview" title="What Virtual Devices are">
        <p>
          A <strong>Virtual Device</strong> is a reusable blueprint for a Modbus device — a named <strong>register map</strong> (which registers exist, at which offsets, in which bank, with which data type and value source) that you configure once and then drop into any workspace's <HelpAnchorLink section="simulator" anchor="overview">TCP Simulator</HelpAnchorLink> as a ready-made device.
        </p>
        <p>
          Think of it as the difference between adding registers one-by-one and instantiating a whole device in a single step. Instead of recreating "an SHT20 temperature/humidity sensor" every time, you build it once as a virtual device and add it wherever you need it, at any base address and Unit ID.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Virtual devices are <strong>app-global</strong> — they are shared across every workspace, not stored inside one project.</li>
          <li>Each device carries its full register map: per-register offset, bank, data type, byte order, alias, and value source (Hold / Device preset / Generator / Route).</li>
          <li>They can be <strong>exported to a single <code>.json</code> file</strong> and imported by anyone, which is the basis for community device sharing.</li>
        </ul>
      </SectionBlock>

      <SectionBlock section="virtual-devices" anchor="where" title="Where they live">
        <p>
          Because virtual devices are shared across all workspaces, they live <strong>outside</strong> any single workspace. On the main screen (the workspace list), a segmented toggle switches between <strong>Workspaces</strong> and <strong>Virtual Devices</strong>. Select <strong>Virtual Devices</strong> to open the gallery and builder.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The choice is remembered between sessions, so if you were last working with devices the app reopens on that tab.
        </p>
      </SectionBlock>

      <SectionBlock section="virtual-devices" anchor="builtin-custom" title="Built-in vs custom">
        <p>The gallery has two kinds of device, shown in separate sections:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Built-in devices</strong> ship with the app (temperature/humidity transmitter, AC energy/power meter, and more). They are <strong>immutable</strong> — you cannot edit or delete them. You can only <strong>Export</strong> them or <strong>Clone &amp; edit</strong> (which copies the device into a new, fully editable custom device).
          </li>
          <li>
            <strong>Custom devices</strong> are the ones you create, clone, import, or save from a live device. They are fully editable and can be renamed, re-mapped, exported, or deleted.
          </li>
        </ul>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Every device has a unique <strong>key</strong> that is its identity. Built-in keys are reserved: a custom device can't overwrite a built-in, and cloning a built-in prefixes its key with <code>custom_</code>.
        </p>
      </SectionBlock>

      <SectionBlock section="virtual-devices" anchor="gallery" title="The device gallery">
        <p>
          The gallery lists <strong>Custom Devices</strong> and <strong>Built-in Devices</strong> as cards. Each card shows the device's icon, name, category, description, and register count, with per-card actions:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Export</strong> (both kinds) — write the device to a <code>.json</code> file via the native save dialog.</li>
          <li><strong>Edit</strong> / <strong>Delete</strong> (custom only) — open the builder, or remove the device from every workspace's Add Device gallery.</li>
          <li><strong>Clone &amp; edit</strong> (built-in only) — copy the built-in into a new custom device and open the builder.</li>
        </ul>
        <p>
          The header holds <strong>New Device</strong> (build one from scratch) and <strong>Import Device</strong> (load a shared <code>.json</code>), plus a <strong>search</strong> box that filters both sections by name, category, or description.
        </p>
      </SectionBlock>

      <SectionBlock section="virtual-devices" anchor="builder" title="The device builder">
        <p>
          The builder (opened by New Device, Edit, or Clone &amp; edit) is where a device's identity and register map are defined:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Name</strong> — the display name shown in galleries and the Add Device wizard.</li>
          <li><strong>Key</strong> — the unique identity (lower-case, underscores). Editable when creating; <strong>locked</strong> when editing an existing custom device.</li>
          <li><strong>Category</strong> and <strong>Description</strong> — free text for grouping and search.</li>
          <li><strong>Icon</strong> — pick a glyph from a searchable icon chooser (sensors, meters, valves, relays, gateways, Andon lights, robots, and more). Search by keyword such as "relay", "andon", or "wireless".</li>
        </ul>
        <p>
          Below the identity, the <strong>register map</strong> lists one card per register. For each register you set:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Alias</strong> — a friendly name (e.g. <code>voltage_l1</code>).</li>
          <li><strong>Offset</strong> — the register's address <em>relative to the device's base</em>. When the device is added at base <code>0</code>, offset <code>1</code> becomes address <code>1</code>; at base <code>100</code> it becomes <code>101</code>.</li>
          <li><strong>Bank</strong> — Coil (1), Discrete (2), Holding (3), or Input (4).</li>
          <li><strong>Type</strong> — <code>u16/i16</code> for single-word, <code>u32/i32/f32</code> and <code>u64/i64/f64</code> for multi-word (bit banks are always <code>bool</code>).</li>
          <li><strong>Byte order</strong> — <code>ABCD/BADC/CDAB/DCBA</code> for multi-word types (see the <HelpAnchorLink section="simulator" anchor="value-sources">simulator value-sources</HelpAnchorLink> reference).</li>
          <li><strong>Value source</strong> — Hold, Device preset, Generator, or Route, each with its own parameters (below).</li>
        </ul>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800/60 dark:bg-slate-900/30">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Example — build a power meter</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>New Device → name "Acme Power Meter", key <code>acme_power_meter</code>, pick the ⚡ icon.</li>
            <li>Add a register: alias <code>voltage</code>, offset <code>0</code>, Input bank, <code>f32</code>, source Generator → sine 220–240.</li>
            <li>Add a register: alias <code>energy</code>, offset <code>2</code>, Holding bank, <code>u32</code>, source Generator → ramp.</li>
            <li>Save. The meter now appears under Custom Devices and in every workspace's Add Device gallery.</li>
          </ol>
        </div>
      </SectionBlock>

      <SectionBlock section="virtual-devices" anchor="params" title="Register parameters (Form / JSON)">
        <p>
          A register's <strong>Parameters</strong> depend on its value source. Rather than force you to hand-write JSON, each register offers a <strong>Form ⟷ JSON</strong> toggle:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Form</strong> (default) — labeled fields per source. Generator: waveform, min, max, period. Device preset: preset, min, max, period. Route: slave unit, connection, function, address, scale, offset, and (for multi-word) source byte order.</li>
          <li><strong>JSON</strong> — a raw parameter editor for power users, with live validation (an invalid edit is flagged and never silently saved).</li>
          <li><strong>Hold</strong> registers take no parameters — they serve a fixed value that can be changed live once the device is running.</li>
        </ul>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The form produces exactly the same parameters as the simulator's own register editor, so a device built here behaves identically to registers created directly in the TCP Simulator.
        </p>
      </SectionBlock>

      <SectionBlock section="virtual-devices" anchor="use-in-simulator" title="Using a device in the TCP Simulator">
        <p>
          Inside a workspace, open the <HelpAnchorLink section="simulator" anchor="add-device">TCP Simulator</HelpAnchorLink> and click <strong>+ Add Device</strong>. The wizard lists every virtual device (built-in, custom, and workspace slaves) grouped by category. Pick one, then choose:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Unit ID</strong> — the Modbus unit the device answers as (0–255).</li>
          <li><strong>Base address</strong> — where the device's register map lands; every register's exposed address is <code>base + offset</code>.</li>
        </ul>
        <p>
          A live <strong>register-map preview</strong> shows the resulting addresses and flags any that would <strong>collide</strong> with registers already in the simulator, with a one-click "use a free base" fix. On Create, the device's registers are added to the simulator as a group that can be renamed, re-based, or deleted together.
        </p>
      </SectionBlock>

      <SectionBlock section="virtual-devices" anchor="save-as" title="Save a live device as a virtual device">
        <p>
          The reverse direction is just as easy. In the simulator's <strong>Devices</strong> tab, a device's action menu has <strong>Save as virtual device</strong>. This captures the device's current register layout (aliases, offsets, types, value sources, and parameters) and opens the builder pre-filled, so you can name it, pick an icon, refine anything, and save it to the custom catalog.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The key is suggested from the name and checked for clashes, so you won't silently overwrite an existing device. Once saved, it's immediately available in every workspace's Add Device gallery.
        </p>
      </SectionBlock>

      <SectionBlock section="virtual-devices" anchor="workspace-slaves" title="Expose a real slave as a device">
        <p>
          If you already configured a device on the <HelpAnchorLink section="slaves" anchor="detail-registers">Slaves</HelpAnchorLink> page, you can expose it over the simulator in one step. In <strong>Add Device</strong>, the <strong>Workspace</strong> category lists the workspace's slaves. Adding one creates a device whose registers <strong>route</strong> to that real slave — mirroring its read registers (same address, bank, and type), using the slave's own Unit ID and connection.
        </p>
        <p>
          The result is a Modbus gateway: an external master polling the simulator reads live values coming from your physical device. The simulator opens the source connection itself when it starts, so you don't have to keep the Slaves page connected. See <HelpAnchorLink section="simulator" anchor="route-from-slave">Route from slave</HelpAnchorLink> for how routing behaves and its ok/stale/missing status.
        </p>
      </SectionBlock>

      <SectionBlock section="virtual-devices" anchor="sharing" title="Export / import & sharing">
        <p>
          Virtual devices are designed to be shared. <strong>Export</strong> writes a self-contained <code>.json</code> (key, name, category, description, icon, and the full register map with base-relative offsets) via the native save dialog. Anyone can then <strong>Import Device</strong> to add it to their own gallery, where it persists and can be instantiated in any workspace.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>File and folder selection use the OS-native dialogs.</li>
          <li>An imported device keeps its own glyph even if it isn't in the built-in icon set.</li>
          <li>Import rejects a file whose key clashes with a built-in — rename it first.</li>
        </ul>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Device sharing is separate from a workspace <strong>Profile</strong>: a profile (see the <HelpAnchorLink section="simulator" anchor="profile">TCP Simulator</HelpAnchorLink>) exports one workspace's entire simulator setup, whereas a device export is a single reusable blueprint.
        </p>
      </SectionBlock>

      <SectionBlock section="virtual-devices" anchor="best-practices" title="Best practices">
        <ul className="list-disc space-y-1 pl-5">
          <li>Clone a built-in rather than starting from scratch when a similar device exists — you inherit a sensible register map to tweak.</li>
          <li>Keep offsets small and contiguous; the base address you pick at Add-Device time re-homes the whole map, so relative offsets are all that matter.</li>
          <li>Give registers meaningful aliases — they carry through to the simulator table and make routed gateways self-documenting.</li>
          <li>Use "Save as virtual device" to capture a simulator device you tuned by hand, then export it to share.</li>
        </ul>
      </SectionBlock>

      <SectionBlock section="virtual-devices" anchor="summary" title="Summary">
        <p>
          Virtual Devices turn one-off register setups into reusable, shareable blueprints. Build a device once (or clone a built-in), pick an icon, define its register map with friendly Form-based parameters, and it's available in every workspace's TCP Simulator via Add Device. Save a live device back into the catalog, expose a real slave as a routed device, and export any device to a <code>.json</code> that teammates or the community can import.
        </p>
      </SectionBlock>
    </div>
  ),
};

export default virtualDevicesSection;
