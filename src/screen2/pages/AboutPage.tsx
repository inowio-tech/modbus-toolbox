import { useState } from "react";
import { FiRefreshCcw, FiCheckCircle, FiAlertCircle, FiDownload } from "react-icons/fi";
import type { Update } from "@tauri-apps/plugin-updater";

import UpdateDialog from "../../components/UpdateDialog";
import { checkForUpdate, installAndRelaunch } from "../api/updater";

const RELEASES_URL = "https://github.com/inowio/modbus-workbench/releases/latest";

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "error"; message: string };

type UpdatePrompt = {
  version: string;
  currentVersion: string;
  notes: string | null;
  update: Update;
};

export default function AboutPage() {
  const versionLabel = __APP_VERSION__;
  const [checkState, setCheckState] = useState<CheckState>({ kind: "idle" });
  const [updatePrompt, setUpdatePrompt] = useState<UpdatePrompt | null>(null);

  async function handleCheck() {
    setCheckState({ kind: "checking" });
    const result = await checkForUpdate();
    if (result.status === "available") {
      setUpdatePrompt({
        version: result.version,
        currentVersion: result.currentVersion,
        notes: result.notes,
        update: result.update,
      });
      setCheckState({ kind: "idle" });
    } else if (result.status === "up-to-date") {
      setCheckState({ kind: "up-to-date" });
    } else {
      setCheckState({ kind: "error", message: result.message });
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-inner shadow-black/5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800/70 dark:bg-slate-900/60 dark:shadow-black/30">
        <div>
          <p className="text-sm uppercase font-semibold  dark:font-normal tracking-[0.35em] text-emerald-700 dark:text-emerald-300">About this software</p>
        </div>
      </div>

      <div className="grid flex-1 gap-8 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm sm:p-10 dark:border-slate-800/70 dark:bg-slate-900/60 dark:text-slate-300">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/logo-dark.svg"
              alt="Inowio Technologies LLP logo"
              className="h-8 w-8 dark:hidden"
              width={128}
              height={128}
            />
            <img
              src="/logo.svg"
              alt="Inowio Technologies LLP logo"
              className="hidden h-8 w-8 dark:block"
              width={128}
              height={128}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-200">
                Modbus Workbench
                <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  {versionLabel}
                </span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-emerald-500/60 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:text-emerald-100"
                  onClick={handleCheck}
                  disabled={checkState.kind === "checking"}
                  title="Check for updates"
                >
                  {checkState.kind === "checking" ? (
                    <FiRefreshCcw className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <FiRefreshCcw className="h-3 w-3" aria-hidden="true" />
                  )}
                  Check for updates
                </button>
                {checkState.kind === "up-to-date" ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
                    <FiCheckCircle className="h-3 w-3" aria-hidden="true" />
                    You're on the latest version.
                  </span>
                ) : null}
                {checkState.kind === "error" ? (
                  <span className="inline-flex items-center gap-1 text-xs text-rose-700 dark:text-rose-300" title={checkState.message}>
                    <FiAlertCircle className="h-3 w-3" aria-hidden="true" />
                    Could not check for updates.
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-4 text-base leading-relaxed text-slate-900 dark:text-slate-200">
            <div className="mb-6 flex flex-col gap-2">
              <p>
                <strong>Modbus Workbench</strong> is for configuring, testing, and analyzing Modbus devices in a structured and repeatable way. It helps engineers build workspaces, manage connections, define register maps, and monitor live data through a clean, predictable workflow.
              </p>
              <p>
                The tool supports commissioning, troubleshooting, and validation of Modbus-based systems across TCP and Serial (RTU) networks, keeping everything local and offline-first for field reliability.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2 ">
              <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-linear-to-br from-slate-50 to-white p-6 transition-all hover:border-emerald-600/30 shadow-inner shadow-black/5 dark:shadow-black/30 hover:shadow-lg hover:shadow-emerald-600/10 dark:border-slate-800/50 dark:from-slate-800/40 dark:to-slate-900/60 dark:hover:border-emerald-500/30 dark:hover:shadow-emerald-500/10">
                <h4 className="text-sm font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">What this software can do</h4>
                <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-slate-700 dark:text-slate-300">
                  <li>Create and manage Modbus workspaces.</li>
                  <li>Configure TCP and Serial (RTU) connections.</li>
                  <li>Define and organize Modbus slave devices.</li>
                  <li>Read and write all standard Modbus register types.</li>
                  <li>Scan and discover registers on unknown devices.</li>
                  <li>Decode values with multiple data types and byte orders.</li>
                  <li>Perform single, multiple, and mask writes.</li>
                  <li>Create reusable signals from registers.</li>
                  <li>Visualize data with value tiles and trend charts.</li>
                  <li>Poll devices at controlled intervals.</li>
                  <li>Monitor live values with search, status filters, and pinned watch-lists.</li>
                  <li>Expose registers as a Modbus TCP server (TCP Simulator) so SCADA systems, PLCs, and test masters can poll and write the app as virtual devices.</li>
                  <li>View workspace and application logs.</li>
                  <li>Persist configuration for repeatable testing.</li>
                </ul>
              </div>

              <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-linear-to-br from-slate-50 to-white p-6 transition-all hover:border-emerald-600/30 shadow-inner shadow-black/5 dark:shadow-black/30 hover:shadow-lg hover:shadow-emerald-600/10 dark:border-slate-800/50 dark:from-slate-800/40 dark:to-slate-900/60 dark:hover:border-emerald-500/30 dark:hover:shadow-emerald-500/10">
                <h4 className="text-sm font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Key features</h4>
                <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-slate-700 dark:text-slate-300">
                  <li>Support for standard Modbus function codes (0x01–0x10, 0x16).</li>
                  <li>Advanced 16/32/64-bit integer and float data types.</li>
                  <li>Flexible byte-order handling for vendor-specific layouts.</li>
                  <li>Read-after-write validation with immediate confirmation.</li>
                  <li>Front-end controlled polling that never overlaps requests.</li>
                  <li>Clear visibility into protocol errors and device responses.</li>
                  <li>Local, offline-first operation for secure environments.</li>
                  <li>Clean UI optimized for engineering workflows.</li>
                </ul>
              </div>
            </div>
          </div>

          <hr className="my-4 border-slate-200 dark:border-slate-800" />

          <div className="grid gap-4 text-sm text-slate-700 sm:grid-cols-2 dark:text-slate-300">
            <div className="flex flex-col gap-2">
            <p>
              <span className="font-semibold text-slate-900 dark:text-slate-100">License:</span> MIT
            </p>
            <p>
              <span className="font-semibold text-slate-900 dark:text-slate-100">Source:</span>
              <a
                href="https://github.com/inowio/modbus-workbench"
                className="ml-2 inline-flex items-center gap-1 text-emerald-800 transition hover:text-sky-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                target="_blank"
                rel="noreferrer"
              >
                https://github.com/inowio/modbus-workbench
              </a>
            </p>
            <p>
              <span className="font-semibold text-slate-900 dark:text-slate-100">Downloads:</span>
              <a
                href={RELEASES_URL}
                className="ml-2 inline-flex items-center gap-1 text-emerald-800 transition hover:text-sky-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                target="_blank"
                rel="noreferrer"
              >
                <FiDownload className="h-3 w-3" aria-hidden="true" />
                Latest release on GitHub
              </a>
            </p>
            </div>
          </div>

          <hr className="my-4 border-slate-200 dark:border-slate-800" />

          <div className="flex items-center gap-2">
            <img
              src="/inowio-logo-dark.svg"
              alt="Inowio Technologies LLP logo"
              className="h-12 w-12 dark:hidden"
              width={32}
              height={32}
            />
            <img
              src="/inowio-logo.svg"
              alt="Inowio Technologies LLP logo"
              className="hidden h-12 w-12 dark:block"
              width={32}
              height={32}
            />
            <div>
              <p className="text-md uppercase font-semibold  dark:font-normal tracking-[0.16em] text-slate-900 dark:text-emerald-200">
                <span className="brand-name">Inowio Technologies LLP</span>
              </p>
              <a
                href="https://inowio.in"
                className="inline-flex items-center gap-1 text-emerald-800 transition hover:text-sky-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                target="_blank"
                rel="noreferrer"
              >
                <span>https://inowio.in</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {updatePrompt ? (
        <UpdateDialog
          open
          version={updatePrompt.version}
          currentVersion={updatePrompt.currentVersion}
          notes={updatePrompt.notes}
          install={(onProgress) => installAndRelaunch(updatePrompt.update, onProgress)}
          onClose={() => setUpdatePrompt(null)}
        />
      ) : null}
    </div>
  );
}
