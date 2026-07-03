import { useEffect, useState } from "react";

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

export type AddDeviceSubmit = {
  templateKey: string;
  deviceName: string;
  unitId: number;
  baseAddress: number;
};

export default function AddDeviceModal(props: {
  open: boolean;
  templates: DeviceTemplate[];
  onClose: () => void;
  onSubmit: (payload: AddDeviceSubmit) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<DeviceTemplate | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [unitId, setUnitId] = useState(1);
  const [baseAddress, setBaseAddress] = useState(0);

  useEffect(() => {
    if (!props.open) return;
    setSelected(null);
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

  if (!props.open) return null;

  const handleSubmit = () => {
    if (!selected) return;
    void props.onSubmit({ templateKey: selected.templateKey, deviceName, unitId, baseAddress });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="add-device-title"
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <div id="add-device-title" className="mb-4 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          Add device
        </div>

        {!selected ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {props.templates.map((t) => (
              <button
                key={t.templateKey}
                type="button"
                aria-label={t.name}
                onClick={() => setSelected(t)}
                className="flex flex-col items-start gap-1 rounded-xl border border-slate-300 bg-slate-50 p-3 text-left text-xs hover:border-emerald-500 dark:border-slate-700 dark:bg-slate-800"
              >
                <span className="text-lg">{t.icon}</span>
                <span className="font-semibold">{t.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{t.category}</span>
                <span className="text-slate-600 dark:text-slate-300">{t.description}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">
                {selected.icon} {selected.name}
              </div>
              <button type="button" className="text-xs text-emerald-700 dark:text-emerald-300" onClick={() => setSelected(null)}>
                Change template
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
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

            <table className="w-full table-fixed border-collapse text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-1">Address</th><th>Bank</th><th>Alias</th><th>Data type</th>
                </tr>
              </thead>
              <tbody>
                {selected.registers.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1">{baseAddress + r.offset}</td>
                    <td>{BANK_LABEL[r.bank] ?? r.bank}</td>
                    <td className="truncate">{r.alias}</td>
                    <td>{r.dataType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={props.onClose}
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100">Cancel</button>
          <button type="button" name="Add device" disabled={!selected} onClick={handleSubmit}
            className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50 dark:border-emerald-500/60 dark:text-emerald-200">Add device</button>
        </div>
      </div>
    </div>
  );
}
