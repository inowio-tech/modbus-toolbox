import { useEffect, useState } from "react";
import { FiTrash2 } from "react-icons/fi";

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
const VALUE_SOURCES = ["hold", "device", "generator", "route"];

const blankReg = (): TemplateRegister => ({
  offset: 0, bank: 3, dataType: "u16", byteOrder: "ABCD", valueSource: "hold", sourceParams: "{}", alias: "",
});

const inputCls = "rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900";

export default function TemplateEditorModal(props: {
  open: boolean;
  initial: DeviceTemplate | null;
  /** Keys already used by other templates (for a uniqueness hint). */
  takenKeys: string[];
  onClose: () => void;
  onSave: (t: DeviceTemplate) => void | Promise<void>;
}) {
  const [t, setT] = useState<DeviceTemplate>(() => props.initial ?? emptyTemplate());
  // Editing an existing custom template keeps its key locked (it's the identity).
  const [isEdit, setIsEdit] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setT(props.initial ?? emptyTemplate());
    setIsEdit(!!props.initial);
  }, [props.open, props.initial]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); props.onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="tpl-editor-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <div id="tpl-editor-title" className="mb-4 shrink-0 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          {isEdit ? "Edit template" : "New template"}
        </div>

        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs">Name
              <input aria-label="Template name" value={t.name} onChange={(e) => set({ name: e.target.value })} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs">Key
              <input aria-label="Template key" value={t.templateKey} disabled={isEdit}
                onChange={(e) => set({ templateKey: e.target.value.replace(/\s+/g, "_").toLowerCase() })}
                className={`${inputCls} ${isEdit ? "opacity-60" : ""}`} />
            </label>
            <label className="flex flex-col gap-1 text-xs">Category
              <input aria-label="Category" value={t.category} onChange={(e) => set({ category: e.target.value })} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs">Icon
              <input aria-label="Icon" value={t.icon} maxLength={4} onChange={(e) => set({ icon: e.target.value })} className={inputCls} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs">Description
            <input aria-label="Description" value={t.description} onChange={(e) => set({ description: e.target.value })} className={inputCls} />
          </label>

          {keyClashes ? (
            <div className="text-xs text-rose-600 dark:text-rose-400">A template with key "{keyTrim}" already exists. Choose a different key.</div>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Registers (offsets are relative to the device base)</div>
              <button type="button" onClick={addReg}
                className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-500/60 dark:text-emerald-200">
                Add register
              </button>
            </div>
            {t.registers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No registers yet.
              </div>
            ) : (
              <div className="space-y-2">
                {t.registers.map((r, i) => {
                  const isBit = r.bank === 1 || r.bank === 2;
                  const typeOptions = isBit ? ["bool"] : r.valueSource === "hold" ? ["u16", "i16"] : NUMERIC_TYPES;
                  return (
                    <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-slate-200 p-2 text-xs sm:grid-cols-7 dark:border-slate-700">
                      <label className="flex flex-col gap-1">Alias
                        <input aria-label={`Alias ${i}`} value={r.alias} onChange={(e) => setReg(i, { alias: e.target.value })} className={inputCls} />
                      </label>
                      <label className="flex flex-col gap-1">Offset
                        <input aria-label={`Offset ${i}`} type="number" min={0} value={r.offset} onChange={(e) => setReg(i, { offset: Number(e.target.value) })} className={inputCls} />
                      </label>
                      <label className="flex flex-col gap-1">Bank
                        <select aria-label={`Bank ${i}`} value={r.bank} onChange={(e) => {
                          const bank = Number(e.target.value);
                          const patch: Partial<TemplateRegister> = { bank };
                          if (bank === 1 || bank === 2) { patch.dataType = "bool"; patch.byteOrder = "ABCD"; }
                          else if (r.dataType === "bool") { patch.dataType = "u16"; }
                          setReg(i, patch);
                        }} className={inputCls}>
                          {BANKS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">Source
                        <select aria-label={`Source ${i}`} value={r.valueSource} onChange={(e) => {
                          const valueSource = e.target.value;
                          const patch: Partial<TemplateRegister> = { valueSource };
                          if (valueSource === "hold" && !["u16", "i16", "bool"].includes(r.dataType)) patch.dataType = isBit ? "bool" : "u16";
                          setReg(i, patch);
                        }} className={inputCls}>
                          {VALUE_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">Type
                        <select aria-label={`Type ${i}`} value={r.dataType} disabled={isBit} onChange={(e) => {
                          const dataType = e.target.value;
                          const patch: Partial<TemplateRegister> = { dataType };
                          if (!MULTI_WORD.has(dataType)) patch.byteOrder = "ABCD";
                          setReg(i, patch);
                        }} className={inputCls}>
                          {typeOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">Order
                        <select aria-label={`Order ${i}`} value={r.byteOrder} disabled={!MULTI_WORD.has(r.dataType)} onChange={(e) => setReg(i, { byteOrder: e.target.value })} className={inputCls}>
                          {BYTE_ORDERS.map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </label>
                      <div className="flex items-end gap-1">
                        <label className="flex flex-1 flex-col gap-1">Params (JSON)
                          <input aria-label={`Params ${i}`} value={r.sourceParams} onChange={(e) => setReg(i, { sourceParams: e.target.value })} className={inputCls} />
                        </label>
                        <button type="button" aria-label={`Remove register ${i}`} onClick={() => removeReg(i)}
                          className="mb-0.5 rounded-md p-1.5 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300">
                          <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <button type="button" onClick={props.onClose}
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100">
            Cancel
          </button>
          <button type="button" disabled={!valid} onClick={() => void props.onSave({ ...t, templateKey: keyTrim })}
            className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50 dark:border-emerald-500/60 dark:text-emerald-200">
            Save template
          </button>
        </div>
      </div>
    </div>
  );
}

function emptyTemplate(): DeviceTemplate {
  return { templateKey: "", name: "", category: "Custom", description: "", icon: "📟", registers: [blankReg()] };
}
