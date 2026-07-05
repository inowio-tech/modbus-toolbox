import { useMemo, useState } from "react";

import type { PageRegister } from "./simFilters";

export type SnapshotRow = {
  unitId: number;
  functionCode: number;
  address: number;
  valueWord: number | null;
  valueBit: boolean | null;
  sourceStatus?: string | null;
};

export type SimStatus = {
  running: boolean;
  listen: { bound: string; port: number; addresses: string[] } | null;
  clientCount: number;
};

type Props = {
  registers: PageRegister[];
  snapshotFor: (unitId: number, functionCode: number, address: number) => SnapshotRow | undefined;
  status: SimStatus;
};

const FC_LABEL: Record<number, string> = { 1: "Coil", 2: "Discrete", 3: "Holding", 4: "Input" };

const SOURCE_STATUS_STYLE: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  stale: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
  missing: "bg-rose-500/15 text-rose-800 dark:text-rose-200",
};

function liveValueText(row: SnapshotRow | undefined): string {
  if (!row) return "—";
  if (row.valueBit !== null) return row.valueBit ? "ON" : "OFF";
  return row.valueWord === null ? "—" : String(row.valueWord);
}

export default function LiveValuesTab({ registers, snapshotFor, status }: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return registers;
    return registers.filter(
      (r) => `${r.alias}`.toLowerCase().includes(q) || `${r.address}`.includes(q) || `${r.unitId}`.includes(q)
    );
  }, [registers, search]);

  if (!status.running) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-white/5">
        <p className="text-sm text-slate-600 dark:text-slate-300">Start the server to see live values.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Live values</h2>
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-48 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">No registers match.</p>
      ) : (
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="py-1">Unit</th>
              <th>Type</th>
              <th>Address</th>
              <th>Alias</th>
              <th>Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const row = snapshotFor(r.unitId, r.functionCode, r.address);
              const sourceStatus = row?.sourceStatus;
              const cls = sourceStatus ? SOURCE_STATUS_STYLE[sourceStatus] ?? "bg-slate-500/15 text-slate-700 dark:text-slate-300" : null;
              return (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1">{r.unitId}</td>
                  <td>{FC_LABEL[r.functionCode] ?? r.functionCode}</td>
                  <td>{r.address}</td>
                  <td className="truncate">{r.alias}</td>
                  <td className="font-mono">{liveValueText(row)}</td>
                  <td>
                    {sourceStatus ? (
                      <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
                        {sourceStatus}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
