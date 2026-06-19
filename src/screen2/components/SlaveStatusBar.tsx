import { FiAlertTriangle } from "react-icons/fi";

export type SlaveStatusSummary = {
  ok: number;
  illegal: number;
  error: number;
  ageLabel: string;
};

export type SlaveStatusBarProps = {
  connected: boolean;
  connecting: boolean;
  disconnecting: boolean;
  connectionKind?: string | null;
  endpointLabel?: string | null;
  unitId?: number | null;
  polling: boolean;
  pollIntervalMs?: number | null;
  summary: SlaveStatusSummary;
  pollingError?: string | null;
};

/**
 * Desktop-style status bar for the Slave detail screen. Pinned to the bottom of
 * the page's scroll viewport (sticky) so the polling/connection readout stays
 * visible no matter how long the register list grows.
 *
 * Positioning mirrors the sticky top toolbar: `-bottom-4 -mb-4` cancels the
 * shared scroll container's `pb-4` so the bar sits flush at the very bottom
 * (verified in Chromium/WebView2 — plain `bottom-0` leaves a 16px gap inside
 * the padding), and `sm:-mx-4` makes it full-bleed. `mt-auto` requires the page
 * root to be `min-h-full flex flex-col`; together they pin the bar to the
 * window bottom even when content is short (otherwise it floats mid-page).
 *
 * Presentational only: it renders state owned by SlaveDetailPage. Kept as a
 * standalone component so it can later be promoted to a global shell status bar
 * or reused on other live screens (e.g. Analyzer) without rework.
 */
export function SlaveStatusBar({
  connected,
  connecting,
  disconnecting,
  connectionKind,
  endpointLabel,
  unitId,
  polling,
  pollIntervalMs,
  summary,
  pollingError,
}: SlaveStatusBarProps) {
  const connLabel = connecting
    ? "Connecting…"
    : disconnecting
      ? "Disconnecting…"
      : connected
        ? "Connected"
        : "Disconnected";

  const connDot =
    connecting || disconnecting
      ? "bg-amber-400"
      : connected
        ? "bg-emerald-400"
        : "bg-rose-400";

  const connText =
    connecting || disconnecting
      ? "text-amber-700 dark:text-amber-300"
      : connected
        ? "text-emerald-700 dark:text-emerald-300"
        : "text-rose-700 dark:text-rose-300";

  const kindLabel =
    connectionKind === "tcp" ? "TCP" : connectionKind === "serial" ? "RTU" : null;

  return (
    <div className="sticky -bottom-4 z-20 mt-auto -mb-4 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/90 px-4 py-1.5 text-xs backdrop-blur supports-backdrop-filter:bg-white/70 sm:-mx-4 dark:border-slate-800 dark:bg-slate-900/90 dark:supports-backdrop-filter:bg-slate-900/70">
      {/* Left: connection */}
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${connDot}`} aria-hidden="true" />
        <span className={`font-semibold ${connText}`}>{connLabel}</span>

        {kindLabel ? (
          <>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="text-slate-500 dark:text-slate-400">{kindLabel}</span>
          </>
        ) : null}

        {endpointLabel ? (
          <span
            className="hidden min-w-0 truncate text-slate-500 dark:text-slate-400 md:inline"
            title={endpointLabel}
          >
            {endpointLabel}
          </span>
        ) : null}

        {unitId != null ? (
          <>
            <span className="hidden text-slate-300 sm:inline dark:text-slate-600">·</span>
            <span className="hidden whitespace-nowrap text-slate-500 sm:inline dark:text-slate-400">
              Unit {unitId}
            </span>
          </>
        ) : null}
      </div>

      {/* Right: polling + counts */}
      <div className="flex shrink-0 items-center gap-2">
        {pollingError ? (
          <span
            className="hidden max-w-50 items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 font-semibold text-rose-700 sm:inline-flex dark:text-rose-300"
            title={pollingError}
          >
            <FiAlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{pollingError}</span>
          </span>
        ) : null}

        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${polling ? "animate-pulse bg-emerald-400" : "bg-slate-400 dark:bg-slate-600"}`}
            aria-hidden="true"
          />
          <span
            className={
              polling
                ? "font-semibold text-emerald-700 dark:text-emerald-300"
                : "text-slate-600 dark:text-slate-300"
            }
          >
            {polling ? "Polling" : "Idle"}
          </span>
          {polling && pollIntervalMs ? (
            <span className="text-slate-500 dark:text-slate-400">{pollIntervalMs}ms</span>
          ) : null}
        </span>

        <span className="text-slate-300 dark:text-slate-600">|</span>

        <span className="hidden items-center gap-1 whitespace-nowrap sm:flex">
          <span className="text-slate-500 dark:text-slate-400">Updated</span>
          <span className="font-semibold text-slate-900 dark:text-slate-200">{summary.ageLabel}</span>
        </span>

        <span className="hidden text-slate-300 sm:inline dark:text-slate-600">|</span>

        <span className="flex items-center gap-2 whitespace-nowrap font-mono">
          <span className="text-emerald-700 dark:text-emerald-300">OK {summary.ok}</span>
          <span className="text-amber-700 dark:text-amber-300">Bad {summary.illegal}</span>
          <span className="text-rose-700 dark:text-rose-300">Err {summary.error}</span>
        </span>
      </div>
    </div>
  );
}

export default SlaveStatusBar;
