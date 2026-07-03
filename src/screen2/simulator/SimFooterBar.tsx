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
};

function fmtTime(epochMs: number | null): string {
  if (epochMs === null) return "—";
  return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Desktop-style status bar pinned to the bottom of the page's scroll viewport,
// mirroring SlaveStatusBar. `-bottom-4 -mb-4` cancels the shared scroll
// container's `pb-4` so the bar sits flush at the very bottom (plain `bottom-0`
// leaves a 16px gap inside the padding in Chromium/WebView2); `sm:-mx-4` makes
// it full-bleed; `mt-auto` (with the page root `min-h-full flex flex-col`) keeps
// it at the window bottom even when content is short.
export default function SimFooterBar({ status, config, lastUpdated }: Props) {
  return (
    <div className="sticky -bottom-4 z-20 mt-auto -mb-4 flex flex-wrap items-center gap-4 border-t border-slate-200 bg-white/90 px-4 py-1.5 text-xs text-slate-600 backdrop-blur supports-backdrop-filter:bg-white/70 sm:-mx-4 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-300 dark:supports-backdrop-filter:bg-slate-900/70">
      <span className="flex items-center gap-1.5">
        <span className={`inline-block h-2 w-2 rounded-full ${status.running ? "bg-emerald-500" : "bg-slate-400"}`} />
        {status.running ? "Running" : "Stopped"}
      </span>
      <span>Port {config?.port ?? "—"}</span>
      <span>Tick {config?.tickMs ?? "—"} ms</span>
      <span>{status.clientCount} client{status.clientCount === 1 ? "" : "s"}</span>
      <span>Updated {fmtTime(lastUpdated)}</span>
    </div>
  );
}
