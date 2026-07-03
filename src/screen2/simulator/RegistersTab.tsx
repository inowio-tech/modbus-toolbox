import { useMemo, useState } from "react";

import type { SimDevice, SimStatus, SnapshotRow } from "./useSimulatorData";
import {
  ALL_COLUMNS,
  EMPTY_FILTER,
  filterRegisters,
  readColumns,
  readPageSize,
  rwLabel,
  writeColumns,
  writePageSize,
  type ColumnKey,
  type PageRegister,
  type RegisterFilter,
} from "./simFilters";

const FC_LABEL: Record<number, string> = { 1: "Coil", 2: "Discrete", 3: "Holding", 4: "Input" };
const SOURCE_OPTIONS = ["hold", "device", "generator", "route"];

const SOURCE_STATUS_STYLE: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  stale: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
  missing: "bg-rose-500/15 text-rose-800 dark:text-rose-200",
};

const COLUMN_LABEL: Record<ColumnKey, string> = {
  unit: "Unit",
  fc: "FC",
  address: "Address",
  alias: "Alias",
  type: "Type",
  source: "Source",
  interval: "Interval",
  rw: "R/W",
  value: "Value",
  device: "Device",
};

function fmtAddr(a: number, addrFmt: "dec" | "hex"): string {
  return addrFmt === "hex" ? `0x${a.toString(16).toUpperCase().padStart(4, "0")}` : String(a);
}

function sourceLabel(r: PageRegister): string {
  if (r.valueSource === "route") return "Route";
  return r.valueSource;
}

export type RegistersTabProps = {
  ws: string;
  registers: PageRegister[];
  devices: SimDevice[];
  status: SimStatus;
  snapshotFor: (u: number, fc: number, a: number) => SnapshotRow | undefined;
  addrFmt: "dec" | "hex";
  onAddrFmt: (f: "dec" | "hex") => void;
  onSelectRegister: (reg: PageRegister) => void;
  onDelete: (id: number) => void;
  onAddRegister: () => void;
  onAddDevice: () => void;
};

export default function RegistersTab(props: RegistersTabProps) {
  const {
    ws,
    registers,
    devices,
    status,
    snapshotFor,
    addrFmt,
    onAddrFmt,
    onSelectRegister,
    onDelete,
    onAddRegister,
    onAddDevice,
  } = props;

  const [filter, setFilter] = useState<RegisterFilter>(EMPTY_FILTER);
  const [columns, setColumns] = useState<ColumnKey[]>(() => readColumns(ws));
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(() => readPageSize(ws));

  const unitOptions = useMemo(
    () => Array.from(new Set(registers.map((r) => r.unitId))).sort((a, b) => a - b),
    [registers]
  );
  const typeOptions = useMemo(
    () => Array.from(new Set(registers.map((r) => r.dataType))).sort(),
    [registers]
  );

  const filtered = useMemo(() => filterRegisters(registers, filter), [registers, filter]);
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  const start = clampedPage * pageSize;
  const end = Math.min(start + pageSize, total);
  const pageRows = filtered.slice(start, end);

  const updateFilter = (patch: Partial<RegisterFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setPage(0);
  };

  const toggleColumn = (col: ColumnKey) => {
    setColumns((prev) => {
      const next = prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col];
      writeColumns(ws, next);
      return next;
    });
  };

  const changePageSize = (n: number) => {
    setPageSize(n);
    writePageSize(ws, n);
    setPage(0);
  };

  const liveValueCell = (r: PageRegister) => {
    if (!status.running) return <span>&mdash;</span>;
    const row = snapshotFor(r.unitId, r.functionCode, r.address);
    if (!row) return <span>&mdash;</span>;
    const text = row.valueBit !== null ? (row.valueBit ? "ON" : "OFF") : row.valueWord === null ? "—" : String(row.valueWord);
    const sourceStatus = row.sourceStatus;
    const badgeCls = sourceStatus ? SOURCE_STATUS_STYLE[sourceStatus] ?? "bg-slate-500/15 text-slate-700 dark:text-slate-300" : null;
    return (
      <span>
        {text}
        {sourceStatus ? (
          <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeCls}`}>
            {sourceStatus}
          </span>
        ) : null}
      </span>
    );
  };

  const renderCell = (col: ColumnKey, r: PageRegister) => {
    switch (col) {
      case "unit":
        return (
          <span className="inline-block rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-semibold text-sky-800 dark:text-sky-200">
            {r.unitId}
          </span>
        );
      case "fc":
        return FC_LABEL[r.functionCode] ?? String(r.functionCode);
      case "address":
        return fmtAddr(r.address, addrFmt);
      case "alias":
        return r.alias;
      case "type":
        return r.dataType;
      case "source":
        return sourceLabel(r);
      case "interval":
        return `${r.intervalMs}ms`;
      case "rw":
        return rwLabel(r.functionCode);
      case "value":
        return liveValueCell(r);
      case "device":
        return devices.find((d) => d.id === r.deviceInstanceId)?.name ?? "—";
      default:
        return null;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
          onClick={onAddRegister}
        >
          + Add Register
        </button>
        <button
          type="button"
          className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
          onClick={onAddDevice}
        >
          + Add Device
        </button>

        <input
          type="text"
          placeholder="Search registers..."
          aria-label="Search registers"
          value={filter.search}
          onChange={(e) => updateFilter({ search: e.target.value })}
          className="min-w-40 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
        />

        <label className="flex items-center gap-1 text-xs">
          <span className="sr-only">Filter by unit</span>
          <select
            aria-label="Filter by unit"
            value={filter.unit}
            onChange={(e) => updateFilter({ unit: e.target.value === "all" ? "all" : Number(e.target.value) })}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="all">All Units</option>
            {unitOptions.map((u) => (
              <option key={u} value={u}>
                Unit {u}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs">
          <span className="sr-only">Filter by source</span>
          <select
            aria-label="Filter by source"
            value={filter.source}
            onChange={(e) => updateFilter({ source: e.target.value })}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="all">All Sources</option>
            {SOURCE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs">
          <span className="sr-only">Filter by type</span>
          <select
            aria-label="Filter by type"
            value={filter.type}
            onChange={(e) => updateFilter({ type: e.target.value })}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="all">All Types</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <div className="relative">
          <button
            type="button"
            aria-label="Show or hide columns"
            aria-expanded={columnsMenuOpen}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
            onClick={() => setColumnsMenuOpen((v) => !v)}
          >
            Columns
          </button>
          {columnsMenuOpen ? (
            <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-slate-300 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {ALL_COLUMNS.map((col) => (
                <label key={col} className="flex items-center gap-2 py-0.5 text-xs">
                  <input
                    type="checkbox"
                    aria-label={`Toggle ${COLUMN_LABEL[col]} column`}
                    checked={columns.includes(col)}
                    onChange={() => toggleColumn(col)}
                  />
                  {COLUMN_LABEL[col]}
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex overflow-hidden rounded-full border border-slate-300 dark:border-slate-700">
          <button
            type="button"
            aria-label="Decimal addresses"
            className={`px-3 py-1 text-xs font-semibold transition ${addrFmt === "dec" ? "border-r border-slate-300 bg-emerald-500/20 text-emerald-800 dark:border-slate-700 dark:text-emerald-200" : "border-r border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"}`}
            onClick={() => onAddrFmt("dec")}
          >
            Dec
          </button>
          <button
            type="button"
            aria-label="Hex addresses"
            className={`px-3 py-1 text-xs font-semibold transition ${addrFmt === "hex" ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200" : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"}`}
            onClick={() => onAddrFmt("hex")}
          >
            Hex
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Device/Generator registers begin updating after Start; changes apply on next Start.
      </p>

      {registers.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-white/5">
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">No registers yet.</p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
              onClick={onAddRegister}
            >
              + Add Register
            </button>
            <button
              type="button"
              className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
              onClick={onAddDevice}
            >
              + Add Device
            </button>
          </div>
        </div>
      ) : total === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-white/5">
          <p className="text-sm text-slate-600 dark:text-slate-300">No registers match the current filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-white/5">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                {columns.map((col) => (
                  <th key={col} className="px-2 py-2">
                    {COLUMN_LABEL[col]}
                  </th>
                ))}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-white/5"
                  onClick={() => onSelectRegister(r)}
                >
                  {columns.map((col) => (
                    <td key={col} className="px-2 py-1.5">
                      {renderCell(col, r)}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      aria-label={`Delete register ${r.alias}`}
                      className="text-rose-600 dark:text-rose-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(r.id);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span>
              Showing {total === 0 ? 0 : start + 1} to {end} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous page"
                disabled={clampedPage === 0}
                className="rounded-lg border border-slate-300 px-2 py-1 disabled:opacity-40 dark:border-slate-700"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Prev
              </button>
              <span>
                Page {clampedPage + 1} of {pageCount}
              </span>
              <button
                type="button"
                aria-label="Next page"
                disabled={clampedPage >= pageCount - 1}
                className="rounded-lg border border-slate-300 px-2 py-1 disabled:opacity-40 dark:border-slate-700"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Next
              </button>
              <label className="flex items-center gap-1">
                <span className="sr-only">Rows per page</span>
                <select
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={(e) => changePageSize(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                >
                  {[10, 20, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n} / page
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
