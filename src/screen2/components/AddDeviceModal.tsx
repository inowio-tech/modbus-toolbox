import { useEffect, useMemo, useState } from "react";

export type TemplateRegister = {
  offset: number;
  bank: number;
  dataType: string;
  byteOrder: string;
  valueSource: string;
  sourceParams: string;
  alias: string;
};

export type DeviceTemplate = {
  templateKey: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  registers: TemplateRegister[];
};

const BANK_LABEL: Record<number, string> = { 1: "coil", 2: "discrete", 3: "holding", 4: "input" };

const MULTI_WORD_TYPES = new Set(["u32", "i32", "f32"]);
const wordSpan = (dataType: string) => (MULTI_WORD_TYPES.has(dataType) ? 2 : 1);

export type ExistingRegister = { unitId: number; functionCode: number; address: number; dataType: string };

export type AddDeviceSubmit = {
  templateKey: string;
  deviceName: string;
  unitId: number;
  baseAddress: number;
};

type Step = "select" | "configure" | "review";
const STEPS: Step[] = ["select", "configure", "review"];
const STEP_LABEL: Record<Step, string> = { select: "Select template", configure: "Configure", review: "Review" };

export default function AddDeviceModal(props: {
  open: boolean;
  templates: DeviceTemplate[];
  existingRegisters?: ExistingRegister[];
  onClose: () => void;
  onSubmit: (payload: AddDeviceSubmit) => void | Promise<void>;
}) {
  const [step, setStep] = useState<Step>("select");
  const [selected, setSelected] = useState<DeviceTemplate | null>(null);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [unitId, setUnitId] = useState(1);
  const [baseAddress, setBaseAddress] = useState(0);

  useEffect(() => {
    if (!props.open) return;
    setStep("select");
    setSelected(null);
    setCategory("All");
    setSearch("");
    setDeviceName("");
    setUnitId(1);
    setBaseAddress(0);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); props.onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  const templates = props.templates ?? [];

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(templates.map((t) => t.category)))],
    [templates],
  );

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => (category === "All" || t.category === category) && (!q || t.name.toLowerCase().includes(q)));
  }, [templates, category, search]);

  const unitValid = Number.isInteger(unitId) && unitId >= 0 && unitId <= 255;
  const baseValid = Number.isInteger(baseAddress) && baseAddress >= 0 && baseAddress <= 65535;
  const configValid = unitValid && baseValid;

  // Addresses already taken by existing registers, keyed unit:bank:address
  // (span-aware), so the wizard can flag collisions before Create hits the
  // backend's UNIQUE(unit,function,address) check.
  const occupied = useMemo(() => {
    const set = new Set<string>();
    for (const r of props.existingRegisters ?? []) {
      const s = wordSpan(r.dataType);
      for (let a = r.address; a <= r.address + s - 1; a++) set.add(`${r.unitId}:${r.functionCode}:${a}`);
    }
    return set;
  }, [props.existingRegisters]);

  const regCollides = (r: TemplateRegister, base: number, unit: number): boolean => {
    const s = wordSpan(r.dataType);
    for (let a = base + r.offset; a <= base + r.offset + s - 1; a++) {
      if (occupied.has(`${unit}:${r.bank}:${a}`)) return true;
    }
    return false;
  };
  const baseCollides = (base: number, unit: number): boolean =>
    !!selected && selected.registers.some((r) => regCollides(r, base, unit));
  // Smallest base where every template register fits (0-65535) without colliding.
  const suggestBase = (unit: number): number => {
    if (!selected) return 0;
    for (let base = 0; base <= 65535; base++) {
      const fits = selected.registers.every((r) => base + r.offset + wordSpan(r.dataType) - 1 <= 65535);
      if (!fits) break;
      if (!baseCollides(base, unit)) return base;
    }
    return 0;
  };

  // On entering Configure (or changing unit/template), if the current base
  // collides, jump to a suggested free base. Manual base edits aren't overridden
  // (baseAddress is intentionally not a dep) — those get the inline warning instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!props.open || step !== "configure" || !selected) return;
    if (baseCollides(baseAddress, unitId)) setBaseAddress(suggestBase(unitId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selected?.templateKey, unitId, props.open]);

  if (!props.open) return null;

  const hasCollision = baseCollides(baseAddress, unitId);
  const suggestedBase = hasCollision ? suggestBase(unitId) : baseAddress;

  const handleSubmit = () => {
    if (!selected) return;
    void props.onSubmit({ templateKey: selected.templateKey, deviceName, unitId, baseAddress });
  };

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="add-device-title"
        className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <div id="add-device-title" className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            Add device
          </div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {STEPS.map((s, i) => (
              <span key={s} className={i === stepIndex ? "font-semibold text-emerald-700 dark:text-emerald-300" : ""}>
                {i > 0 && <span className="mx-1">›</span>}
                {STEP_LABEL[s]}
              </span>
            ))}
          </div>
        </div>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {step === "select" && (
          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="flex min-w-0 flex-1 gap-3 sm:gap-4">
              <div className="flex w-24 shrink-0 flex-col gap-1 sm:w-32">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    aria-label={cat}
                    onClick={() => setCategory(cat)}
                    className={`rounded-lg px-2 py-1 text-left text-xs ${
                      category === cat
                        ? "bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <input
                  aria-label="Search templates"
                  placeholder="Search templates"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
                <div className="grid grid-cols-2 gap-3 overflow-x-hidden sm:grid-cols-3 lg:max-h-112 lg:overflow-y-auto">
                  {filteredTemplates.map((t) => (
                    <button
                      key={t.templateKey}
                      type="button"
                      aria-label={t.name}
                      aria-pressed={selected?.templateKey === t.templateKey}
                      onClick={() => setSelected(t)}
                      className={`flex w-full min-w-0 flex-col items-start gap-1 rounded-xl border p-3 text-left text-xs dark:bg-slate-800 ${
                        selected?.templateKey === t.templateKey
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "border-slate-300 bg-slate-50 hover:border-emerald-500 dark:border-slate-700"
                      }`}
                    >
                      <span className="text-lg">{t.icon}</span>
                      <span className="w-full font-semibold wrap-break-word">{t.name}</span>
                      <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{t.category}</span>
                      <span className="w-full text-slate-600 wrap-break-word dark:text-slate-300">{t.description}</span>
                    </button>
                  ))}
                  {filteredTemplates.length === 0 && (
                    <div className="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400">No templates match.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="w-full shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs lg:w-56 dark:border-slate-800 dark:bg-slate-800/50">
              {selected ? (
                <div className="space-y-2">
                  <div className="font-semibold wrap-break-word">{selected.icon} {selected.name}</div>
                  <div className="text-slate-600 wrap-break-word dark:text-slate-300">{selected.description}</div>
                  <ul className="space-y-1">
                    {selected.registers.slice(0, 6).map((r, i) => (
                      <li key={i} className="truncate text-slate-600 dark:text-slate-300">
                        {r.alias} · {BANK_LABEL[r.bank] ?? r.bank} · {r.dataType}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-slate-500 dark:text-slate-400">Select a template to preview</div>
              )}
            </div>
          </div>
        )}

        {step === "configure" && selected && (
          <div className="space-y-4">
            <div className="text-sm font-semibold">
              {selected.icon} {selected.name}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs">Device name
                <input aria-label="Device name" value={deviceName} onChange={(e) => setDeviceName(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
              </label>
              <label className="flex flex-col gap-1 text-xs">Unit ID
                <input aria-label="Unit ID" type="number" min={0} max={255} value={unitId}
                  onChange={(e) => setUnitId(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
              </label>
              <label className="flex flex-col gap-1 text-xs">Base address
                <input aria-label="Base address" type="number" min={0} max={65535} value={baseAddress}
                  onChange={(e) => setBaseAddress(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
              </label>
            </div>

            {!configValid && (
              <div className="text-xs text-rose-600 dark:text-rose-400">
                Unit ID must be 0–255 and base address 0–65535.
              </div>
            )}

            <div>
              <div className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Register Map Preview</div>
              <table className="w-full table-fixed border-collapse text-left text-xs">
                <thead>
                  <tr className="text-slate-500">
                    <th className="py-1">Address</th><th>Bank</th><th>Alias</th><th>Data type</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.registers.map((r, i) => {
                    const clash = regCollides(r, baseAddress, unitId);
                    return (
                      <tr key={i} className={`border-t border-slate-100 dark:border-slate-800 ${clash ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : ""}`}>
                        <td className="py-1">{baseAddress + r.offset}</td>
                        <td>{BANK_LABEL[r.bank] ?? r.bank}</td>
                        <td className="truncate">{r.alias}</td>
                        <td>{r.dataType}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {hasCollision && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-rose-600 dark:text-rose-400">
                  <span>Overlaps existing registers on unit {unitId} (highlighted above).</span>
                  <button
                    type="button"
                    onClick={() => setBaseAddress(suggestedBase)}
                    className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-800 dark:border-emerald-500/60 dark:text-emerald-200"
                  >
                    Use free base {suggestedBase}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {step === "review" && selected && (
          <div className="space-y-3 text-sm">
            <div className="font-semibold">{selected.icon} {selected.name}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
              <dt className="text-slate-500 dark:text-slate-400">Device name</dt>
              <dd className="col-span-1 sm:col-span-2">{deviceName || "—"}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Unit ID</dt>
              <dd className="col-span-1 sm:col-span-2">{unitId}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Base address</dt>
              <dd className="col-span-1 sm:col-span-2">{baseAddress}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Registers</dt>
              <dd className="col-span-1 sm:col-span-2">{selected.registers.length}</dd>
            </dl>
          </div>
        )}
        </div>

        <div className="mt-4 flex shrink-0 items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Step {stepIndex + 1} of {STEPS.length}
          </div>
          <div className="flex justify-end gap-2">
            {step !== "select" && (
              <button type="button" onClick={() => setStep(step === "review" ? "configure" : "select")}
                className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100">
                Back
              </button>
            )}
            <button type="button" onClick={props.onClose}
              className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100">
              Cancel
            </button>
            {step === "select" && (
              <button type="button" disabled={!selected} onClick={() => setStep("configure")}
                className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50 dark:border-emerald-500/60 dark:text-emerald-200">
                Next
              </button>
            )}
            {step === "configure" && (
              <button type="button" disabled={!configValid || hasCollision} onClick={() => setStep("review")}
                className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50 dark:border-emerald-500/60 dark:text-emerald-200">
                Next
              </button>
            )}
            {step === "review" && (
              <button type="button" disabled={hasCollision} onClick={handleSubmit}
                className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50 dark:border-emerald-500/60 dark:text-emerald-200">
                Create
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
