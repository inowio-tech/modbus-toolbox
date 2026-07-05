import { useEffect, useState } from "react";
import { FiCode, FiList, FiPlus, FiTrash2 } from "react-icons/fi";
import { RiCloseLine } from "react-icons/ri";

import type { DeviceTemplate, TemplateRegister } from "./AddDeviceModal";

const BANKS = [
  { value: 1, label: "Coil (1)" },
  { value: 2, label: "Discrete (2)" },
  { value: 3, label: "Holding (3)" },
  { value: 4, label: "Input (4)" },
];
const NUMERIC_TYPES = ["u16", "i16", "u32", "i32", "f32", "u64", "i64", "f64"];
const MULTI_WORD = new Set(["u32", "i32", "f32", "u64", "i64", "f64"]);
const BYTE_ORDERS = ["ABCD", "BADC", "CDAB", "DCBA"];
const GENERATOR_KINDS = ["sine", "ramp", "decrement", "step", "random", "toggle"];
const DEVICE_PRESETS = ["temperature", "humidity", "pressure", "flow", "vibration", "analog", "discrete", "counter"];

const VALUE_SOURCES = [
  { value: "hold", label: "Hold — fixed value", bitOk: true },
  { value: "device", label: "Device preset — realistic signal", bitOk: false },
  { value: "generator", label: "Generator — synthetic waveform", bitOk: false },
  { value: "route", label: "Route — mirror a real slave", bitOk: false },
];

// Curated, device-oriented glyphs for the icon picker. Each carries search
// keywords (also the tooltip/aria text). Stored as a plain string (same as the
// built-ins), so imported/custom icons stay compatible; SVG icons can be layered
// on later without changing the data shape.
type IconChoice = { glyph: string; label: string };
const ICON_CHOICES: IconChoice[] = [
  { glyph: "📟", label: "device controller pager terminal" },
  { glyph: "🎛️", label: "plc controller hmi knobs panel" },
  { glyph: "🖥️", label: "hmi scada display screen panel" },
  { glyph: "🗄️", label: "plc server cabinet rack enclosure" },
  { glyph: "🎚️", label: "relay switch contactor slider level" },
  { glyph: "🔀", label: "relay switch router crossover network" },
  { glyph: "🔌", label: "power plug socket outlet supply" },
  { glyph: "⚡", label: "power energy voltage electric meter" },
  { glyph: "🔋", label: "battery charge ups power backup" },
  { glyph: "☀️", label: "solar pv irradiance light energy" },
  { glyph: "🌡️", label: "temperature thermostat heat sensor rtd" },
  { glyph: "💧", label: "humidity water moisture flow level" },
  { glyph: "🌀", label: "motor pump fan vibration spin drive" },
  { glyph: "💨", label: "air flow wind fan blower pressure" },
  { glyph: "🔥", label: "heat heater burner furnace flame" },
  { glyph: "❄️", label: "cooling chiller cold refrigeration hvac" },
  { glyph: "🚰", label: "valve water tap flow actuator" },
  { glyph: "🛢️", label: "tank silo oil drum level storage" },
  { glyph: "⚙️", label: "gear motor machine engine drive" },
  { glyph: "🔧", label: "maintenance service tool wrench" },
  { glyph: "🧲", label: "proximity inductive sensor magnet" },
  { glyph: "🧭", label: "pressure gauge compass meter" },
  { glyph: "🧪", label: "analyzer lab chemical ph process" },
  { glyph: "📊", label: "meter data analytics chart" },
  { glyph: "📈", label: "trend rate graph analytics" },
  { glyph: "🧮", label: "counter tally totalizer count" },
  { glyph: "⏱️", label: "timer stopwatch cycle time" },
  { glyph: "⏲️", label: "timer clock schedule interval" },
  { glyph: "🚦", label: "andon stack light tower status signal" },
  { glyph: "🚥", label: "andon traffic signal status light" },
  { glyph: "🔦", label: "pick to light picking guide lamp put" },
  { glyph: "💡", label: "light lamp indicator pick to light" },
  { glyph: "🔆", label: "light brightness indicator beacon" },
  { glyph: "🔔", label: "alarm bell notify andon call" },
  { glyph: "🚨", label: "alarm alert warning beacon fault" },
  { glyph: "🔊", label: "buzzer sounder horn audio alarm" },
  { glyph: "🧯", label: "safety fire extinguisher protection" },
  { glyph: "📶", label: "wireless signal cellular rssi strength" },
  { glyph: "🛜", label: "wireless wifi access point gateway" },
  { glyph: "📡", label: "wireless gateway antenna rf telemetry satellite" },
  { glyph: "🌐", label: "gateway network internet web iot" },
  { glyph: "📱", label: "handheld mobile terminal device scanner" },
  { glyph: "🏷️", label: "barcode label tag scanner sku rfid" },
  { glyph: "📷", label: "camera vision inspection machine" },
  { glyph: "🖨️", label: "printer label print marking" },
  { glyph: "⚖️", label: "scale weigh load balance weight" },
  { glyph: "🤖", label: "robot cobot automation controller" },
  { glyph: "🦾", label: "robot arm actuator manipulator gripper" },
  { glyph: "🏭", label: "factory plant line industrial cell" },
  { glyph: "📦", label: "box package carton warehouse kitting" },
  { glyph: "🔒", label: "security lock access safety guard" },
  { glyph: "🔩", label: "bolt fastener hardware assembly" },
];

const blankReg = (): TemplateRegister => ({
  offset: 0, bank: 3, dataType: "u16", byteOrder: "ABCD", valueSource: "hold", sourceParams: "{}", alias: "",
});

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const labelCls = "flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300";

// --- Params helpers -------------------------------------------------------

type Params = Record<string, unknown>;

function parseParams(raw: string): Params {
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Params) : {};
  } catch {
    return {};
  }
}
const numOr = (v: unknown, d: number) => (typeof v === "number" && !Number.isNaN(v) ? v : d);
const strOr = (v: unknown, d: string) => (typeof v === "string" ? v : d);

/** Fresh, minimal params for a newly-picked value source. */
function defaultParamsFor(source: string): string {
  switch (source) {
    case "generator":
      return JSON.stringify({ kind: "sine", min: 0, max: 100, periodMs: 1000 });
    case "device":
      return JSON.stringify({ preset: "temperature", min: 0, max: 100, periodMs: 1000 });
    case "route":
      return JSON.stringify({ slaveUnitId: 1, connectionKind: "tcp", functionCode: 3, address: 1, scale: 1, offset: 0 });
    default:
      return "{}";
  }
}

export default function TemplateEditorModal(props: {
  open: boolean;
  initial: DeviceTemplate | null;
  /** Keys already used by other templates (for a uniqueness hint). */
  takenKeys: string[];
  /**
   * Treat `initial` as a *pre-filled draft for a brand-new* device rather than
   * an existing one to edit: the key stays editable and clash-guarded. Used by
   * "Save as virtual device", which pre-fills from a live device but must not
   * silently overwrite an existing template that happens to share the key.
   */
  forceNew?: boolean;
  onClose: () => void;
  onSave: (t: DeviceTemplate) => void | Promise<void>;
}) {
  const [t, setT] = useState<DeviceTemplate>(() => props.initial ?? emptyTemplate());
  // Editing an existing custom template keeps its key locked (it's the identity).
  const [isEdit, setIsEdit] = useState(false);
  const [iconModalOpen, setIconModalOpen] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setT(props.initial ?? emptyTemplate());
    setIsEdit(!!props.initial && !props.forceNew);
  }, [props.open, props.initial, props.forceNew]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Escape closes the topmost layer first: the icon picker, then the editor.
      if (iconModalOpen) setIconModalOpen(false);
      else props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose, iconModalOpen]);

  if (!props.open) return null;

  const set = (patch: Partial<DeviceTemplate>) => setT((prev) => ({ ...prev, ...patch }));
  const setReg = (i: number, patch: Partial<TemplateRegister>) =>
    setT((prev) => ({ ...prev, registers: prev.registers.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const addReg = () => setT((prev) => ({ ...prev, registers: [...prev.registers, blankReg()] }));
  const removeReg = (i: number) => setT((prev) => ({ ...prev, registers: prev.registers.filter((_, idx) => idx !== i) }));

  const keyTrim = t.templateKey.trim();
  const keyClashes = !isEdit && props.takenKeys.includes(keyTrim);
  const valid = keyTrim !== "" && t.name.trim() !== "" && !keyClashes;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="tpl-editor-title"
        className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <div id="tpl-editor-title" className="truncate text-sm font-semibold text-emerald-700 dark:text-emerald-200">
              {isEdit ? "Edit virtual device" : "New virtual device"}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Describe the device, then add the registers it exposes.
            </div>
          </div>
          <button type="button" onClick={props.onClose} title="Close" aria-label="Close"
            className="flex shrink-0 items-center rounded-full border border-slate-300 bg-slate-100 p-1.5 text-slate-600 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:bg-white/5 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white">
            <RiCloseLine className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Identity */}
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={labelCls}>Name
                  <input aria-label="Template name" placeholder="e.g. Acme Power Meter" value={t.name}
                    onChange={(e) => set({ name: e.target.value })} className={inputCls} />
                </label>
                <label className={labelCls}>Key
                  <input aria-label="Template key" placeholder="acme_power_meter" value={t.templateKey} disabled={isEdit}
                    onChange={(e) => set({ templateKey: e.target.value.replace(/\s+/g, "_").toLowerCase() })}
                    className={`${inputCls} font-mono ${isEdit ? "cursor-not-allowed opacity-60" : ""}`} />
                </label>
              </div>
              <label className={labelCls}>Category
                <input aria-label="Category" placeholder="Custom" value={t.category}
                  onChange={(e) => set({ category: e.target.value })} className={inputCls} />
              </label>
              <label className={labelCls}>Description
                <input aria-label="Description" placeholder="What this device represents" value={t.description}
                  onChange={(e) => set({ description: e.target.value })} className={inputCls} />
              </label>
              {keyClashes ? (
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                  A device with key “{keyTrim}” already exists. Choose a different key.
                </div>
              ) : null}
            </div>
            <IconField value={t.icon} onOpen={() => setIconModalOpen(true)} />
          </section>

          {/* Registers */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Registers</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Offsets are relative to the device’s base address.</div>
              </div>
              <button type="button" onClick={addReg}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-500/20 dark:border-emerald-500/60 dark:text-emerald-200">
                <FiPlus className="h-3.5 w-3.5" aria-hidden="true" /> Add register
              </button>
            </div>

            {t.registers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No registers yet. Add one to expose data on this device.
              </div>
            ) : (
              <div className="space-y-3">
                {t.registers.map((r, i) => (
                  <RegisterCard key={i} index={i} reg={r} onChange={(patch) => setReg(i, patch)} onRemove={() => removeReg(i)} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <button type="button" onClick={props.onClose}
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500">
            Cancel
          </button>
          <button type="button" disabled={!valid} onClick={() => void props.onSave({ ...t, templateKey: keyTrim })}
            className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-500/60 dark:text-emerald-200">
            Save device
          </button>
        </div>
      </div>
    </div>

    <IconPickerModal
      open={iconModalOpen}
      value={t.icon}
      onPick={(icon) => { set({ icon }); setIconModalOpen(false); }}
      onClose={() => setIconModalOpen(false)}
    />
    </>
  );
}

// --- Icon field (compact trigger) + picker modal --------------------------

function IconField(props: { value: string; onOpen: () => void }) {
  const { value, onOpen } = props;
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
      <button type="button" onClick={onOpen} aria-label="Choose device icon"
        className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-white text-3xl leading-none transition hover:border-emerald-400 hover:bg-emerald-500/5 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-500/60">
        {value || "❔"}
      </button>
      <div className="text-center">
        <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Icon</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">Shown in the device gallery.</div>
      </div>
      <button type="button" onClick={onOpen}
        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-400 hover:text-emerald-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-200 dark:hover:text-emerald-200">
        Choose icon
      </button>
    </div>
  );
}

function IconPickerModal(props: { open: boolean; value: string; onPick: (icon: string) => void; onClose: () => void }) {
  const { open, value, onPick, onClose } = props;
  const [q, setQ] = useState("");

  useEffect(() => { if (open) setQ(""); }, [open]);

  if (!open) return null;

  const query = q.trim().toLowerCase();
  // Keep an imported/custom glyph outside the curated set selectable.
  const base: IconChoice[] =
    value && !ICON_CHOICES.some((c) => c.glyph === value)
      ? [{ glyph: value, label: "current custom" }, ...ICON_CHOICES]
      : ICON_CHOICES;
  const list = query ? base.filter((c) => c.label.includes(query) || c.glyph === q.trim()) : base;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Choose device icon" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-200">Choose an icon</div>
          <button type="button" onClick={onClose} title="Close" aria-label="Close"
            className="flex items-center rounded-full border border-slate-300 bg-slate-100 p-1.5 text-slate-600 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:bg-white/5 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white">
            <RiCloseLine className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="shrink-0 px-5 pt-4">
          <input aria-label="Search icons" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search — relay, andon, wireless, pump…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {list.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">No icons match “{q.trim()}”.</div>
          ) : (
            <div role="radiogroup" aria-label="Device icon" className="grid grid-cols-6 gap-2 sm:grid-cols-8">
              {list.map((c) => {
                const active = c.glyph === value;
                return (
                  <button key={c.glyph} type="button" role="radio" aria-checked={active} aria-label={`Icon ${c.glyph}`} title={c.label}
                    onClick={() => onPick(c.glyph)}
                    className={`flex aspect-square items-center justify-center rounded-lg border text-2xl leading-none transition ${active
                      ? "border-emerald-500 bg-emerald-500/15 ring-2 ring-emerald-500/30"
                      : "border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-500/5 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-500/60"}`}>
                    {c.glyph}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Register card --------------------------------------------------------

function RegisterCard(props: {
  index: number;
  reg: TemplateRegister;
  onChange: (patch: Partial<TemplateRegister>) => void;
  onRemove: () => void;
}) {
  const { index: i, reg: r, onChange, onRemove } = props;
  const isBit = r.bank === 1 || r.bank === 2;
  const isMulti = MULTI_WORD.has(r.dataType);
  const typeOptions = isBit ? ["bool"] : r.valueSource === "hold" ? ["u16", "i16"] : NUMERIC_TYPES;

  const changeBank = (bank: number) => {
    const patch: Partial<TemplateRegister> = { bank };
    if (bank === 1 || bank === 2) {
      // Bit banks only carry a boolean, driven by a fixed value.
      patch.dataType = "bool";
      patch.byteOrder = "ABCD";
      if (r.valueSource !== "hold") { patch.valueSource = "hold"; patch.sourceParams = "{}"; }
    } else if (r.dataType === "bool") {
      patch.dataType = "u16";
    }
    onChange(patch);
  };

  const changeSource = (valueSource: string) => {
    const patch: Partial<TemplateRegister> = { valueSource, sourceParams: defaultParamsFor(valueSource) };
    if (valueSource === "hold" && !["u16", "i16", "bool"].includes(r.dataType)) {
      patch.dataType = isBit ? "bool" : "u16";
    }
    onChange(patch);
  };

  const changeType = (dataType: string) => {
    const patch: Partial<TemplateRegister> = { dataType };
    if (!MULTI_WORD.has(dataType)) patch.byteOrder = "ABCD";
    onChange(patch);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      {/* Card header: index + alias + delete */}
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
          {i + 1}
        </span>
        <input aria-label={`Alias ${i}`} placeholder="Alias (e.g. voltage_l1)" value={r.alias}
          onChange={(e) => onChange({ alias: e.target.value })}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-900" />
        <button type="button" aria-label={`Remove register ${i}`} onClick={onRemove} title="Remove register"
          className="shrink-0 rounded-lg p-2 text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300">
          <FiTrash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Placement + type */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <label className={labelCls}>Offset
          <input aria-label={`Offset ${i}`} type="number" min={0} value={r.offset}
            onChange={(e) => onChange({ offset: Number(e.target.value) })} className={inputCls} />
        </label>
        <label className={labelCls}>Bank
          <select aria-label={`Bank ${i}`} value={r.bank} onChange={(e) => changeBank(Number(e.target.value))} className={inputCls}>
            {BANKS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </label>
        <label className={labelCls}>Type
          <select aria-label={`Type ${i}`} value={r.dataType} disabled={isBit} onChange={(e) => changeType(e.target.value)}
            className={`${inputCls} ${isBit ? "cursor-not-allowed opacity-60" : ""}`}>
            {typeOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className={labelCls}>Byte order
          <select aria-label={`Order ${i}`} value={r.byteOrder} disabled={!isMulti}
            onChange={(e) => onChange({ byteOrder: e.target.value })}
            className={`${inputCls} ${!isMulti ? "cursor-not-allowed opacity-60" : ""}`}>
            {BYTE_ORDERS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
      </div>

      {/* Value source */}
      <label className={`${labelCls} mt-2.5`}>Value source
        <select aria-label={`Source ${i}`} value={r.valueSource} onChange={(e) => changeSource(e.target.value)} className={inputCls}>
          {VALUE_SOURCES.map((s) => (
            <option key={s.value} value={s.value} disabled={isBit && !s.bitOk}>{s.label}</option>
          ))}
        </select>
      </label>

      {/* Parameters */}
      <ParamsEditor index={i} reg={r} isMulti={isMulti} onChange={(sourceParams) => onChange({ sourceParams })} />
    </div>
  );
}

// --- Params editor (form ⟷ JSON) -----------------------------------------

function ParamsEditor(props: {
  index: number;
  reg: TemplateRegister;
  isMulti: boolean;
  onChange: (sourceParams: string) => void;
}) {
  const { index: i, reg: r, isMulti, onChange } = props;
  const [mode, setMode] = useState<"form" | "json">("form");
  const [draft, setDraft] = useState(r.sourceParams);
  const [err, setErr] = useState<string | null>(null);

  const params = parseParams(r.sourceParams);
  const patch = (p: Params) => onChange(JSON.stringify({ ...params, ...p }));

  const openJson = () => {
    let pretty = r.sourceParams;
    try { pretty = JSON.stringify(JSON.parse(r.sourceParams), null, 2); } catch { /* keep raw */ }
    setDraft(pretty);
    setErr(null);
    setMode("json");
  };
  const onDraft = (v: string) => {
    setDraft(v);
    try {
      const p = JSON.parse(v);
      if (p && typeof p === "object" && !Array.isArray(p)) { setErr(null); onChange(JSON.stringify(p)); }
      else setErr("Parameters must be a JSON object, e.g. { }");
    } catch {
      setErr("Not valid JSON yet");
    }
  };

  const hasParams = r.valueSource !== "hold";

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Parameters</div>
        {hasParams ? (
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs dark:border-slate-600">
            <button type="button" aria-label={`Params form view ${i}`} onClick={() => setMode("form")}
              className={`inline-flex items-center gap-1 px-2 py-1 transition ${mode === "form" ? "bg-emerald-500/15 font-semibold text-emerald-800 dark:text-emerald-200" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"}`}>
              <FiList className="h-3 w-3" aria-hidden="true" /> Form
            </button>
            <button type="button" aria-label={`Params JSON view ${i}`} onClick={openJson}
              className={`inline-flex items-center gap-1 border-l border-slate-300 px-2 py-1 transition dark:border-slate-600 ${mode === "json" ? "bg-emerald-500/15 font-semibold text-emerald-800 dark:text-emerald-200" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"}`}>
              <FiCode className="h-3 w-3" aria-hidden="true" /> JSON
            </button>
          </div>
        ) : null}
      </div>

      {!hasParams ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Holds a fixed value — no parameters. The value can be changed live once the device is running.
        </p>
      ) : mode === "json" ? (
        <div className="space-y-1">
          <textarea aria-label={`Params JSON ${i}`} value={draft} onChange={(e) => onDraft(e.target.value)} rows={4} spellCheck={false}
            className={`w-full rounded-lg border bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/20 dark:bg-slate-900 dark:text-slate-100 ${err ? "border-rose-400 focus:border-rose-500" : "border-slate-300 focus:border-emerald-500 dark:border-slate-700"}`} />
          {err ? <div className="text-xs text-rose-600 dark:text-rose-400">{err}</div>
            : <div className="text-xs text-slate-400 dark:text-slate-500">Advanced: edit the raw parameter object.</div>}
        </div>
      ) : (
        <ParamsForm index={i} source={r.valueSource} params={params} isMulti={isMulti} byteOrder={r.byteOrder}
          patch={patch} setParams={(p) => onChange(JSON.stringify(p))} />
      )}
    </div>
  );
}

function ParamsForm(props: {
  index: number;
  source: string;
  params: Params;
  isMulti: boolean;
  byteOrder: string;
  patch: (p: Params) => void;
  setParams: (p: Params) => void;
}) {
  const { index: i, source, params, isMulti, byteOrder, patch, setParams } = props;

  if (source === "generator") {
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <label className={labelCls}>Waveform
          <select aria-label={`Generator kind ${i}`} value={strOr(params.kind, "sine")} onChange={(e) => patch({ kind: e.target.value })} className={inputCls}>
            {GENERATOR_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className={labelCls}>Min
          <input aria-label={`Min ${i}`} type="number" value={numOr(params.min, 0)} onChange={(e) => patch({ min: Number(e.target.value) })} className={inputCls} />
        </label>
        <label className={labelCls}>Max
          <input aria-label={`Max ${i}`} type="number" value={numOr(params.max, 100)} onChange={(e) => patch({ max: Number(e.target.value) })} className={inputCls} />
        </label>
        <label className={labelCls}>Period (ms)
          <input aria-label={`Period ${i}`} type="number" min={0} value={numOr(params.periodMs, 1000)} onChange={(e) => patch({ periodMs: Number(e.target.value) })} className={inputCls} />
        </label>
      </div>
    );
  }

  if (source === "device") {
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <label className={labelCls}>Preset
          <select aria-label={`Device preset ${i}`} value={strOr(params.preset, "temperature")} onChange={(e) => patch({ preset: e.target.value })} className={inputCls}>
            {DEVICE_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className={labelCls}>Min
          <input aria-label={`Min ${i}`} type="number" value={numOr(params.min, 0)} onChange={(e) => patch({ min: Number(e.target.value) })} className={inputCls} />
        </label>
        <label className={labelCls}>Max
          <input aria-label={`Max ${i}`} type="number" value={numOr(params.max, 100)} onChange={(e) => patch({ max: Number(e.target.value) })} className={inputCls} />
        </label>
        <label className={labelCls}>Period (ms)
          <input aria-label={`Period ${i}`} type="number" min={0} value={numOr(params.periodMs, 1000)} onChange={(e) => patch({ periodMs: Number(e.target.value) })} className={inputCls} />
        </label>
      </div>
    );
  }

  if (source === "route") {
    return (
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <label className={labelCls}>Slave unit
            <input aria-label={`Source unit ${i}`} type="number" min={0} max={255} value={numOr(params.slaveUnitId, 1)}
              onChange={(e) => patch({ slaveUnitId: Number(e.target.value) })} className={inputCls} />
          </label>
          <label className={labelCls}>Connection
            <select aria-label={`Source connection ${i}`} value={strOr(params.connectionKind, "tcp")} onChange={(e) => patch({ connectionKind: e.target.value })} className={inputCls}>
              <option value="tcp">TCP</option>
              <option value="serial">Serial</option>
            </select>
          </label>
          <label className={labelCls}>Function
            <select aria-label={`Source function ${i}`} value={numOr(params.functionCode, 3)} onChange={(e) => patch({ functionCode: Number(e.target.value) })} className={inputCls}>
              <option value={1}>Coils (0x01)</option>
              <option value={2}>Discrete (0x02)</option>
              <option value={3}>Holding (0x03)</option>
              <option value={4}>Input (0x04)</option>
            </select>
          </label>
          <label className={labelCls}>Address
            <input aria-label={`Source address ${i}`} type="number" min={0} max={65535} value={numOr(params.address, 1)}
              onChange={(e) => patch({ address: Number(e.target.value) })} className={inputCls} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <label className={labelCls}>Scale
            <input aria-label={`Scale ${i}`} type="number" step="any" value={numOr(params.scale, 1)}
              onChange={(e) => patch({ scale: Number(e.target.value) })} className={inputCls} />
          </label>
          <label className={labelCls}>Offset
            <input aria-label={`Route offset ${i}`} type="number" step="any" value={numOr(params.offset, 0)}
              onChange={(e) => patch({ offset: Number(e.target.value) })} className={inputCls} />
          </label>
          {isMulti ? (
            <label className={labelCls}>Source byte order
              <select aria-label={`Source byte order ${i}`} value={strOr(params.srcByteOrder, "")}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) patch({ srcByteOrder: v });
                  else { const { srcByteOrder: _drop, ...rest } = params; setParams(rest); }
                }} className={inputCls}>
                <option value="">Same as register ({byteOrder})</option>
                {BYTE_ORDERS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Exposed value = source × scale + offset.</p>
      </div>
    );
  }

  return null;
}

function emptyTemplate(): DeviceTemplate {
  return { templateKey: "", name: "", category: "Custom", description: "", icon: "📟", registers: [blankReg()] };
}
