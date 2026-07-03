export type SimStatus = {
  running: boolean;
  listen: { bound: string; port: number; addresses: string[] } | null;
  clientCount: number;
};

export type SimConfig = { enabled: boolean; host: string; port: number; tickMs: number };

type Props = {
  status: SimStatus;
  config: SimConfig | null;
  lastUpdated: number | null;
  onRefresh: () => void;
};

function fmtTime(epochMs: number | null): string {
  if (epochMs === null) return "—";
  return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function SimFooterBar({ status, config, lastUpdated, onRefresh }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-white/5 dark:text-slate-300">
      <span className="flex items-center gap-1.5">
        <span className={`inline-block h-2 w-2 rounded-full ${status.running ? "bg-emerald-500" : "bg-slate-400"}`} />
        {status.running ? "running" : "stopped"}
      </span>
      <span>Port {config?.port ?? "—"}</span>
      <span>Tick {config?.tickMs ?? "—"} ms</span>
      <span>{status.clientCount} client{status.clientCount === 1 ? "" : "s"}</span>
      <span>updated {fmtTime(lastUpdated)}</span>
      <button
        type="button"
        aria-label="Refresh"
        onClick={onRefresh}
        className="ml-auto rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200"
      >
        Refresh
      </button>
    </div>
  );
}
