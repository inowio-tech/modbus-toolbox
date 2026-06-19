import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FiGrid, FiList, FiSearch, FiStar, FiX } from "react-icons/fi";
import type { RegisterRowDraft } from "./RegisterRowsTable";

export type RegisterMonitorSummary = {
  ok: number;
  illegal: number;
  error: number;
  idle: number;
  ageLabel: string;
};

export type RegisterMonitorViewProps = {
  rows: RegisterRowDraft[];
  formatValue: (row: RegisterRowDraft) => string;
  /** Scopes the pinned watch-list to this slave + function code. */
  pinStorageKey: string;
  polling: boolean;
  pollIntervalMs: number | null;
  summary: RegisterMonitorSummary;
  onOpenDetails: (key: string) => void;
};

type MonitorFilter = "all" | "changed" | "errors" | "pinned";
type MonitorDensity = "cards" | "rows";

const DENSITY_STORAGE_KEY = "inowio.monitor.density";

function rowId(row: RegisterRowDraft): string {
  return row.address.trim() !== "" ? row.address : row.key;
}

function ageLabel(ts: number | null): string {
  if (ts == null) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

const DOT_CLASS: Record<RegisterRowDraft["runtimeStatus"], string> = {
  ok: "bg-emerald-400",
  illegal: "bg-amber-400",
  error: "bg-rose-400",
  idle: "bg-slate-500",
};

type DisplayRow = {
  id: string;
  key: string;
  address: string;
  alias: string;
  status: RegisterRowDraft["runtimeStatus"];
  valueLabel: string;
  age: string;
  pinned: boolean;
  flashing: boolean;
};

export default function RegisterMonitorView({
  rows,
  formatValue,
  pinStorageKey,
  polling,
  pollIntervalMs,
  summary,
  onOpenDetails,
}: RegisterMonitorViewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MonitorFilter>("all");
  const [density, setDensity] = useState<MonitorDensity>(() => {
    try {
      const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
      if (stored === "cards" || stored === "rows") return stored;
    } catch {
      // ignore
    }
    return rows.length > 60 ? "rows" : "cards";
  });

  const [pins, setPins] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(pinStorageKey);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      // ignore
    }
    return new Set();
  });

  // Reload pins when the scope (slave / function code) changes.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(pinStorageKey);
      setPins(raw ? new Set(JSON.parse(raw) as string[]) : new Set());
    } catch {
      setPins(new Set());
    }
  }, [pinStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(pinStorageKey, JSON.stringify([...pins]));
    } catch {
      // ignore
    }
  }, [pins, pinStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
    } catch {
      // ignore
    }
  }, [density]);

  // Change-flash: detect when an OK value differs from the previous poll.
  const formatRef = useRef(formatValue);
  formatRef.current = formatValue;
  const prevValuesRef = useRef<Map<string, string>>(new Map());
  const [flash, setFlash] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const fmt = formatRef.current;
    const prev = prevValuesRef.current;
    const changed: string[] = [];
    for (const r of rows) {
      if (r.runtimeStatus !== "ok") continue;
      const id = rowId(r);
      const value = fmt(r);
      const previous = prev.get(id);
      if (previous !== undefined && previous !== value) changed.push(id);
      prev.set(id, value);
    }
    if (changed.length === 0) return;
    setFlash((current) => {
      const next = new Set(current);
      for (const id of changed) next.add(id);
      return next;
    });
    const timer = window.setTimeout(() => {
      setFlash((current) => {
        const next = new Set(current);
        for (const id of changed) next.delete(id);
        return next;
      });
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [rows]);

  function togglePin(id: string) {
    setPins((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const displayRows: DisplayRow[] = useMemo(
    () =>
      rows.map((r) => {
        const id = rowId(r);
        return {
          id,
          key: r.key,
          address: r.address,
          alias: r.alias,
          status: r.runtimeStatus,
          valueLabel:
            r.runtimeStatus === "idle"
              ? "—"
              : r.runtimeStatus === "illegal"
                ? "illegal addr"
                : r.runtimeStatus === "error"
                  ? r.runtimeError ?? "error"
                  : formatValue(r),
          age: ageLabel(r.runtimeTs),
          pinned: pins.has(id),
          flashing: flash.has(id),
        };
      }),
    [rows, formatValue, pins, flash],
  );

  const pinnedRows = useMemo(() => displayRows.filter((r) => r.pinned), [displayRows]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return displayRows.filter((r) => {
      if (filter === "changed" && !r.flashing) return false;
      if (filter === "errors" && r.status !== "error" && r.status !== "illegal") return false;
      if (filter === "pinned" && !r.pinned) return false;
      if (q) return r.alias.toLowerCase().includes(q) || r.address.toLowerCase().includes(q);
      return true;
    });
  }, [displayRows, query, filter, pins]);

  const chip = (value: MonitorFilter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
        filter === value
          ? "border-emerald-500/50 bg-emerald-500/12 text-emerald-700 dark:text-emerald-200"
          : "border-slate-300 bg-slate-100 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-300 dark:hover:border-slate-600"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 font-mono text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-400">
        {polling ? (
          <span className="inline-flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            Polling
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
            Idle
          </span>
        )}
        <span>
          updated <span className="text-slate-700 dark:text-slate-200">{summary.ageLabel}</span>
          {summary.ageLabel !== "—" ? " ago" : ""}
        </span>
        <span>
          OK <span className="font-semibold text-emerald-700 dark:text-emerald-300">{summary.ok}</span> · Bad{" "}
          <span className="font-semibold text-amber-600 dark:text-amber-300">{summary.illegal}</span> · Err{" "}
          <span className="font-semibold text-rose-600 dark:text-rose-300">{summary.error}</span>
        </span>
        {pollIntervalMs != null ? <span className="ml-auto">interval {pollIntervalMs} ms</span> : null}
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-45 flex-1 sm:max-w-xs">
          <FiSearch
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            aria-hidden="true"
          />
          <input
            aria-label="Search registers"
            className="w-full rounded-full border border-slate-300 bg-white py-1.5 pl-9 pr-8 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            placeholder="Search alias or address"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute inset-y-0 right-2 flex items-center text-slate-500 transition hover:text-slate-700 dark:hover:text-slate-300"
              aria-label="Clear search"
            >
              <FiX className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {chip("all", "All")}
          {chip("changed", "Changed")}
          {chip("errors", "Errors")}
          {chip("pinned", "Pinned")}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
            {visibleRows.length}/{rows.length}
          </span>
          <div className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-white/5">
            <button
              type="button"
              onClick={() => setDensity("rows")}
              aria-pressed={density === "rows"}
              title="Dense rows"
              aria-label="Dense rows"
              className={`inline-flex h-7 w-8 items-center justify-center rounded-full transition ${
                density === "rows"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <FiList className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setDensity("cards")}
              aria-pressed={density === "cards"}
              title="Cards"
              aria-label="Cards"
              className={`inline-flex h-7 w-8 items-center justify-center rounded-full transition ${
                density === "cards"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <FiGrid className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* pinned watch list */}
      {pinnedRows.length > 0 ? (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            <FiStar className="h-3 w-3" aria-hidden="true" /> Watch list · {pinnedRows.length}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {pinnedRows.map((r) => (
              <button
                type="button"
                key={`watch-${r.key}`}
                onClick={() => onOpenDetails(r.key)}
                className={`flex-none rounded-xl border bg-slate-50/70 px-3 py-2 text-left transition hover:border-emerald-500/40 dark:bg-slate-950/30 ${
                  r.flashing
                    ? "border-emerald-500/50"
                    : "border-emerald-500/20 dark:border-emerald-500/20"
                }`}
                style={{ minWidth: "9.5rem" }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                    {r.alias || `@${r.address}`}
                  </span>
                </div>
                <div
                  className={`mt-0.5 font-mono text-xl tabular-nums ${
                    r.status === "error" || r.status === "illegal"
                      ? "text-amber-600 dark:text-amber-300"
                      : "text-slate-900 dark:text-slate-100"
                  }`}
                >
                  {r.valueLabel}
                </div>
                <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                  <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[r.status]}`} />@{r.address} · {r.age}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* body */}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 px-4 py-6 text-center text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
          No registers yet. Switch to Edit to add rows, then Poll to watch live values here.
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 px-4 py-6 text-center text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
          No registers match the current search or filter.
        </div>
      ) : density === "rows" ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
          <div className="max-h-[460px] overflow-auto">
            <table className="w-full min-w-160 table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-10" />
                <col className="w-20" />
                <col />
                <col />
                <col className="w-28" />
                <col className="w-28" />
              </colgroup>
              <thead>
                <tr className="bg-slate-100/70 text-[10.5px] uppercase tracking-wider text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                  <th className="sticky top-0 bg-slate-100/95 px-2 py-2 backdrop-blur dark:bg-slate-900/80" aria-hidden="true" />
                  <th className="sticky top-0 bg-slate-100/95 px-3 py-2 font-semibold backdrop-blur dark:bg-slate-900/80">Addr</th>
                  <th className="sticky top-0 bg-slate-100/95 px-3 py-2 font-semibold backdrop-blur dark:bg-slate-900/80">Alias</th>
                  <th className="sticky top-0 bg-slate-100/95 px-3 py-2 font-semibold backdrop-blur dark:bg-slate-900/80">Value</th>
                  <th className="sticky top-0 bg-slate-100/95 px-3 py-2 font-semibold backdrop-blur dark:bg-slate-900/80">Status</th>
                  <th className="sticky top-0 bg-slate-100/95 px-3 py-2 font-semibold backdrop-blur dark:bg-slate-900/80">Updated</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <MonitorRow key={r.key} row={r} onTogglePin={togglePin} onOpenDetails={onOpenDetails} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
          {visibleRows.map((r) => (
            <MonitorCard key={r.key} row={r} onTogglePin={togglePin} onOpenDetails={onOpenDetails} />
          ))}
        </div>
      )}
    </div>
  );
}

type RowChildProps = {
  row: DisplayRow;
  onTogglePin: (id: string) => void;
  onOpenDetails: (key: string) => void;
};

const MonitorRow = memo(function MonitorRow({ row, onTogglePin, onOpenDetails }: RowChildProps) {
  return (
    <tr
      className={`cursor-pointer border-b border-slate-200/70 transition last:border-b-0 hover:bg-slate-100/70 dark:border-slate-800/70 dark:hover:bg-slate-900/50 ${
        row.flashing ? "bg-emerald-500/10" : ""
      }`}
      onClick={() => onOpenDetails(row.key)}
    >
      <td className="px-2 py-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(row.id);
          }}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition ${
            row.pinned
              ? "text-emerald-500"
              : "text-slate-400 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300"
          }`}
          aria-label={row.pinned ? `Unpin ${row.alias || row.address}` : `Pin ${row.alias || row.address}`}
          title={row.pinned ? "Unpin from watch list" : "Pin to watch list"}
        >
          <FiStar className={`h-4 w-4 ${row.pinned ? "fill-current" : ""}`} aria-hidden="true" />
        </button>
      </td>
      <td className="px-3 py-1.5 font-mono text-xs text-slate-500 dark:text-slate-400">{row.address}</td>
      <td className="truncate px-3 py-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
        {row.alias || <span className="font-normal italic text-slate-400 dark:text-slate-500">—</span>}
      </td>
      <td
        className={`truncate px-3 py-1.5 font-mono text-sm tabular-nums ${
          row.status === "error" || row.status === "illegal"
            ? "text-amber-600 dark:text-amber-300"
            : row.flashing
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {row.valueLabel}
        {row.flashing ? <span className="ml-1 text-[10px] text-emerald-500">▲</span> : null}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-slate-500 dark:text-slate-400">
        <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${DOT_CLASS[row.status]}`} />
        {row.status}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs tabular-nums text-slate-400 dark:text-slate-500">
        {row.age}
      </td>
    </tr>
  );
});

const MonitorCard = memo(function MonitorCard({ row, onTogglePin, onOpenDetails }: RowChildProps) {
  const isBad = row.status === "error" || row.status === "illegal";
  return (
    <div
      className={`group relative cursor-pointer rounded-2xl border bg-slate-50/70 p-3.5 transition hover:border-emerald-500/40 dark:bg-slate-950/30 ${
        row.flashing
          ? "border-emerald-500/50"
          : "border-slate-200 dark:border-slate-800"
      }`}
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetails(row.key)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetails(row.key);
        }
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(row.id);
        }}
        className={`absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-lg opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 ${
          row.pinned
            ? "text-emerald-500 opacity-100"
            : "text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
        }`}
        aria-label={row.pinned ? `Unpin ${row.alias || row.address}` : `Pin ${row.alias || row.address}`}
        title={row.pinned ? "Unpin from watch list" : "Pin to watch list"}
      >
        <FiStar className={`h-4 w-4 ${row.pinned ? "fill-current" : ""}`} aria-hidden="true" />
      </button>

      <div className="flex items-baseline gap-2 pr-8">
        <span className="truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100">
          {row.alias || <span className="font-normal italic text-slate-400 dark:text-slate-500">register</span>}
        </span>
        <span className="flex-none font-mono text-[10.5px] text-slate-400 dark:text-slate-500">@{row.address}</span>
      </div>
      <div
        className={`mt-1.5 font-mono text-2xl tabular-nums ${
          isBad ? "text-amber-600 dark:text-amber-300" : "text-slate-900 dark:text-slate-100"
        } ${isBad ? "text-base italic" : ""}`}
      >
        {row.valueLabel}
      </div>
      <div className="mt-2 flex items-center gap-1.5 font-mono text-[10.5px] text-slate-400 dark:text-slate-500">
        <span className={`h-2 w-2 rounded-full ${DOT_CLASS[row.status]}`} />
        {row.status} · {row.age}
      </div>
    </div>
  );
});
