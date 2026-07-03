import { useEffect, useRef, useState } from "react";

import type { PageRegister } from "./simFilters";

export type SimDevice = {
  id: number;
  templateKey: string;
  name: string;
  unitId: number;
  baseAddress: number;
  enabled: boolean;
  sortOrder: number;
};

export type DevicesTabProps = {
  devices: SimDevice[];
  registers: PageRegister[];
  onAddDevice: () => void;
  onRename: (device: SimDevice) => void;
  onRebase: (device: SimDevice) => void;
  onDelete: (device: SimDevice) => void;
};

const TEMPLATE_ICON: Record<string, string> = {
  temp_humidity: "🌡️",
  power_meter: "⚡",
  flow_meter: "🌊",
  pressure: "🧭",
};

function deviceIcon(templateKey: string): string {
  return TEMPLATE_ICON[templateKey] ?? "📟";
}

export default function DevicesTab({
  devices,
  registers,
  onAddDevice,
  onRename,
  onRebase,
  onDelete,
}: DevicesTabProps) {
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openMenuId === null) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenuId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Devices</div>
        {devices.length > 0 && (
          <button
            type="button"
            onClick={onAddDevice}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-1.5 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
          >
            + Add Device
          </button>
        )}
      </div>

      {devices.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-white/5">
          <div className="mb-3 text-sm text-slate-500 dark:text-slate-400">No devices yet.</div>
          <button
            type="button"
            onClick={onAddDevice}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-1.5 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
          >
            Add Device
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((d) => {
            const count = registers.filter((r) => r.deviceInstanceId === d.id).length;
            return (
              <div
                key={d.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-lg" aria-hidden="true">{deviceIcon(d.templateKey)}</span>
                    <span className="truncate font-bold text-slate-900 dark:text-slate-100">{d.name}</span>
                  </div>
                  <div className="relative shrink-0" ref={openMenuId === d.id ? menuRef : undefined}>
                    <button
                      type="button"
                      aria-label={`Actions for ${d.name}`}
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === d.id}
                      onClick={() => setOpenMenuId((cur) => (cur === d.id ? null : d.id))}
                      className="cursor-pointer rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
                    >
                      ⋮
                    </button>
                    {openMenuId === d.id && (
                      <div role="menu" className="absolute right-0 z-10 mt-1 w-32 rounded-lg border border-slate-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setOpenMenuId(null); onRename(d); }}
                          className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-white/5"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setOpenMenuId(null); onRebase(d); }}
                          className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-white/5"
                        >
                          Re-base
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setOpenMenuId(null); onDelete(d); }}
                          className="block w-full px-3 py-1.5 text-left text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                        >
                          Delete device
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <div>{d.templateKey}</div>
                  <div>
                    Unit {d.unitId} · Base {d.baseAddress}
                  </div>
                  <div>{count} registers</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
