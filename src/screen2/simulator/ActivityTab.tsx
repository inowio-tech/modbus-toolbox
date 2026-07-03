import { useEffect, useState } from "react";

import type { SimEvent, SimStatus } from "./useSimulatorData";

export type ActivityTabProps = {
  status: SimStatus;
  events: SimEvent[];
};

const EVENT_STYLE: Record<string, { label: string; cls: string }> = {
  started: { label: "Started", cls: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" },
  stopped: { label: "Stopped", cls: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  clientConnected: { label: "Connected", cls: "bg-sky-500/15 text-sky-800 dark:text-sky-200" },
  clientDisconnected: { label: "Disconnected", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-200" },
};

function fmtClock(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleTimeString();
  } catch {
    return "—";
  }
}

function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Re-render once a second so uptime/durations tick.
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export default function ActivityTab({ status, events }: ActivityTabProps) {
  const now = useNow(status.running);
  const clients = status.clients ?? [];
  const uptime = status.running && status.startedAtMs ? fmtDuration(now - status.startedAtMs) : "—";
  const ordered = [...events].reverse(); // newest first

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Uptime</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{uptime}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Connected Clients</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{clients.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Logged Events</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{events.length}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-white/5">
        <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100">
          Clients
        </div>
        {clients.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {status.running ? "No clients connected." : "Simulator is stopped."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="px-4 py-2">Address</th>
                  <th className="px-4 py-2">Connected at</th>
                  <th className="px-4 py-2">Duration</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-1.5 font-mono text-xs">{c.addr}</td>
                    <td className="px-4 py-1.5">{fmtClock(c.connectedAtMs)}</td>
                    <td className="px-4 py-1.5 tabular-nums">{fmtDuration(now - c.connectedAtMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-white/5">
        <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100">
          Event Log
        </div>
        {ordered.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">No events yet.</div>
        ) : (
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {ordered.map((e, i) => {
              const meta = EVENT_STYLE[e.kind] ?? { label: e.kind, cls: "bg-slate-500/15 text-slate-700 dark:text-slate-300" };
              return (
                <li key={`${e.atMs}-${i}`} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-20 shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{fmtClock(e.atMs)}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.cls}`}>
                    {meta.label}
                  </span>
                  <span className="min-w-0 truncate font-mono text-xs text-slate-600 dark:text-slate-300">{e.detail}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
