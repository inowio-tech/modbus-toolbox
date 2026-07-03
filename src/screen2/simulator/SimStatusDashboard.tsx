import { useState } from "react";

type SimConfig = { enabled: boolean; host: string; port: number; tickMs: number };
type ListenInfo = { bound: string; port: number; addresses: string[] };
type SimStatus = { running: boolean; listen: ListenInfo | null; clientCount: number };

type Props = {
  config: SimConfig | null;
  status: SimStatus;
  listen: ListenInfo | null;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onSaveConfig: (patch: Partial<SimConfig>) => void;
  onChangeExpose: (host: string) => void;
  onChangePort: (port: number) => void;
  onRefresh: () => void;
  registerCount: number;
  unitCount: number;
  deviceCount: number;
};

const CARD_CLASS = "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5";

export default function SimStatusDashboard({
  config,
  status,
  listen,
  busy,
  onStart,
  onStop,
  onSaveConfig,
  onChangeExpose,
  onChangePort,
  onRefresh,
  registerCount,
  unitCount,
  deviceCount,
}: Props) {
  const [addressesExpanded, setAddressesExpanded] = useState(false);

  const host = config?.host ?? "0.0.0.0";
  const port = config?.port ?? 502;
  const effectiveListen = status.listen ?? listen;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Exposed surface */}
        <div className={CARD_CLASS}>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Exposed</span>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {registerCount} register{registerCount === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {unitCount} unit{unitCount === 1 ? "" : "s"} · {deviceCount} device{deviceCount === 1 ? "" : "s"}
          </p>
        </div>

        {/* Accessible At */}
        <div className={CARD_CLASS}>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Accessible At</span>
          {status.running && effectiveListen && effectiveListen.addresses.length > 0 ? (
            <div className="mt-1">
              <p className="font-mono text-sm text-slate-900 dark:text-slate-100">{effectiveListen.addresses[0]}</p>
              {effectiveListen.addresses.length > 1 ? (
                <button
                  type="button"
                  className="mt-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                  onClick={() => setAddressesExpanded((v) => !v)}
                >
                  {addressesExpanded ? "Show less" : `and ${effectiveListen.addresses.length - 1} more`}
                </button>
              ) : null}
              {addressesExpanded ? (
                <ul className="mt-1 space-y-0.5">
                  {effectiveListen.addresses.slice(1).map((addr) => (
                    <li key={addr} className="font-mono text-sm text-slate-900 dark:text-slate-100">
                      {addr}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">&mdash;</p>
          )}
        </div>

        {/* Connected Clients */}
        <div className={CARD_CLASS}>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Connected Clients</span>
          <p className="mt-1 text-sm text-slate-900 dark:text-slate-100">{status.clientCount}</p>
        </div>

        {/* Tick Interval */}
        <div className={CARD_CLASS}>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Tick Interval</span>
          {status.running ? (
            <p className="mt-1 text-sm text-slate-900 dark:text-slate-100">{config?.tickMs ?? 0} ms</p>
          ) : (
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="number"
                aria-label="Tick interval (ms)"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                value={config?.tickMs ?? 0}
                min={1}
                onChange={(e) => onSaveConfig({ tickMs: Number(e.target.value) })}
              />
              <span className="shrink-0 text-slate-500 dark:text-slate-400">ms</span>
            </label>
          )}
        </div>
      </div>

      {/* Server controls */}
      <div className={CARD_CLASS}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${status.running ? "bg-emerald-500" : "bg-slate-400"}`} />
            <span className="text-sm font-semibold">{status.running ? "Listening" : "Stopped"}</span>
          </div>

          <label className="flex items-center gap-2 text-sm">
            Expose
            <select
              aria-label="Expose"
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
              value={host}
              disabled={status.running}
              onChange={(e) => onChangeExpose(e.target.value)}
            >
              <option value="0.0.0.0">LAN / Intranet (0.0.0.0)</option>
              <option value="127.0.0.1">Local only (127.0.0.1)</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            Port
            <input
              type="number"
              aria-label="Port"
              className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
              value={port}
              min={1}
              max={65535}
              disabled={status.running}
              onChange={(e) => onChangePort(Number(e.target.value))}
            />
          </label>

          {status.running ? (
            <button
              type="button"
              disabled={busy}
              onClick={onStop}
              className="rounded-full border border-rose-500/60 bg-rose-500/10 px-4 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-200"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onStart}
              className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
            >
              Start
            </button>
          )}

          <button
            type="button"
            aria-label="Refresh"
            onClick={onRefresh}
            className="ml-auto rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-white/5"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
