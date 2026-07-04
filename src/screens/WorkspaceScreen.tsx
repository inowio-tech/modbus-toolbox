import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FiBookOpen, FiDatabase, FiDownload, FiEdit3, FiGrid, FiList, FiPlus, FiRefreshCcw, FiSearch, FiTrash2, FiX } from "react-icons/fi";
import { formatLocalDateTime } from "../datetime";
import ConfirmDialog from "../components/ConfirmDialog";
import ImportConflictModal from "../components/ImportConflictModal";
import { useErrorToast, useToast } from "../components/ToastProvider";
import ThemeToggleButton from "../components/ThemeToggleButton";
import { AppLogEntry, listAppLogs, LogLevel } from "../screen2/api/logs";
import VirtualDevicesView from "../screen2/pages/VirtualDevicesView";
import { RiCloseLine } from "react-icons/ri";
import { useHelp } from "../help/HelpProvider";

export type Workspace = {
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
  slave_count?: number;
};

type Props = {
  onOpen: (workspace: Workspace) => void;
};

export default function WorkspaceScreen({ onOpen }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { pushToast } = useToast();

  // Top-level view: the Workspaces list or the app-global Device Builder
  // (device templates are shared across all workspaces, so they live outside
  // any one workspace). Persisted like the grid/list view.
  const [mainTab, setMainTab] = useState<"workspaces" | "devices">(() => {
    try {
      return window.localStorage.getItem("inowio.mainTab") === "devices" ? "devices" : "workspaces";
    } catch {
      return "workspaces";
    }
  });
  const switchMainTab = (tab: "workspaces" | "devices") => {
    setMainTab(tab);
    try { window.localStorage.setItem("inowio.mainTab", tab); } catch { /* ignore */ }
  };

  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">(() => {
    try {
      return window.localStorage.getItem("inowio.workspace.view") === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Edit modal state
  const [editTarget, setEditTarget] = useState<Workspace | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Import state
  const [importConflict, setImportConflict] = useState<{ workspaceName: string } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importAction, setImportAction] = useState<"overwrite" | "new" | null>(null);

  const [logsOpen, setLogsOpen] = useState(false);
  const [logsBusy, setLogsBusy] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsMinLevel, setLogsMinLevel] = useState<LogLevel>("info");
  const [appLogs, setAppLogs] = useState<AppLogEntry[]>([]);
  const logsScrollRef = useRef<HTMLDivElement | null>(null);
  const [logsAutoFollow, setLogsAutoFollow] = useState(true);
  const { openHelp } = useHelp();

  useErrorToast(error);
  useErrorToast(addError);
  useErrorToast(deleteError);
  useErrorToast(logsError);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const items = await invoke<Workspace[]>("list_workspaces");
      setWorkspaces(items);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function refreshAppLogs(minLevel?: LogLevel) {
    const level = minLevel ?? logsMinLevel;
    setLogsBusy(true);
    setLogsError(null);
    try {
      const logs = await listAppLogs({ minLevel: level, limit: 200 });
      setAppLogs(logs);
      setLogsMinLevel(level);
    } catch (e) {
      setLogsError(String(e));
    } finally {
      setLogsBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await invoke<void>("delete_workspace", { name: deleteTarget.name });
      setWorkspaces((prev) => prev.filter((w) => w.name !== deleteTarget.name));
      pushToast(`Workspace "${deleteTarget.name}" deleted`, "info");
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  function openEditModal(ws: Workspace) {
    setEditTarget(ws);
    setEditName(ws.name);
    setEditDesc(ws.description ?? "");
    setEditError(null);
  }

  async function saveEdit() {
    if (!editTarget) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError("Workspace name is required");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const nowIso = new Date().toISOString();
      const updated = await invoke<Workspace>("rename_workspace", {
        oldName: editTarget.name,
        newName: trimmed,
        description: editDesc,
        nowIso,
      });
      setWorkspaces((prev) =>
        prev.map((w) => (w.name === editTarget.name ? { ...updated, slave_count: w.slave_count } : w)),
      );
      pushToast(`Workspace renamed`, "info");
      setEditTarget(null);
    } catch (e) {
      setEditError(String(e));
    } finally {
      setEditSaving(false);
    }
  }

  async function handleImportWorkspace() {
    try {
      const validation = await invoke<{ workspace_name: string; conflict: boolean } | null>(
        "validate_import_workspace",
      );

      if (!validation) return; // User cancelled file dialog

      if (validation.conflict) {
        setImportConflict({ workspaceName: validation.workspace_name });
        return;
      }

      // No conflict — import directly
      const nowIso = new Date().toISOString();
      const imported = await invoke<Workspace>("execute_workspace_import", {
        mode: "new",
        nowIso,
      });
      setWorkspaces((prev) => [{ ...imported, slave_count: 0 }, ...prev]);
      pushToast(`Imported workspace: ${imported.name}`, "info");
    } catch (e) {
      const message = String(e);
      if (message === "Invalid workspace package") {
        pushToast("Import failed. Invalid workspace package", "error");
        return;
      }
      pushToast(message, "error");
    }
  }

  async function handleImportOverwrite() {
    setImportBusy(true);
    setImportAction("overwrite");
    try {
      const nowIso = new Date().toISOString();
      const imported = await invoke<Workspace>("execute_workspace_import", {
        mode: "overwrite",
        nowIso,
      });
      await load(); // Refresh from backend for accurate state
      pushToast(`Overwritten workspace: ${imported.name}`, "info");
    } catch (e) {
      pushToast(String(e), "error");
    } finally {
      setImportBusy(false);
      setImportAction(null);
      setImportConflict(null);
    }
  }

  async function handleImportAsNew() {
    setImportBusy(true);
    setImportAction("new");
    try {
      const nowIso = new Date().toISOString();
      const imported = await invoke<Workspace>("execute_workspace_import", {
        mode: "new",
        nowIso,
      });
      setWorkspaces((prev) => [{ ...imported, slave_count: 0 }, ...prev]);
      pushToast(`Imported workspace: ${imported.name}`, "info");
    } catch (e) {
      pushToast(String(e), "error");
    } finally {
      setImportBusy(false);
      setImportAction(null);
      setImportConflict(null);
    }
  }

  function handleImportCancel() {
    void invoke("clear_import_cache");
    setImportConflict(null);
  }

  useEffect(() => {
    const title = `Inowio - Modbus Workbench v${__APP_VERSION__}`;
    void getCurrentWebviewWindow().setTitle(title);
    load();
  }, []);

  useEffect(() => {
    if (!logsOpen) return;
    void refreshAppLogs();
  }, [logsOpen]);

  // Oldest-first so newest entries appear at the bottom like the in-workspace logs panel.
  const orderedAppLogs = useMemo(
    () => [...appLogs].sort((a, b) => a.id - b.id),
    [appLogs],
  );

  function handleAppLogsScroll(e: { currentTarget: HTMLDivElement }) {
    const target = e.currentTarget;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    const atBottom = distanceFromBottom < 16;
    setLogsAutoFollow(atBottom);
  }

  useEffect(() => {
    if (!logsOpen || !logsAutoFollow) return;
    const container = logsScrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [logsOpen, logsAutoFollow, orderedAppLogs.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let items = workspaces;
    if (q.length > 0) {
      items = items.filter((w) => w.name.toLowerCase().includes(q));
    }

    return [...items].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }, [search, workspaces]);

  useEffect(() => {
    try {
      window.localStorage.setItem("inowio.workspace.view", view);
    } catch {
      // Best-effort persistence; ignore storage errors.
    }
  }, [view]);

  async function openWorkspace(ws: Workspace) {
    try {
      const nowIso = new Date().toISOString();
      const updated = await invoke<Workspace>("touch_workspace", {
        name: ws.name,
        nowIso,
      });
      onOpen(updated);
    } catch (e) {
      setError(String(e));
    }
  }

  async function createWorkspace() {
    setAddError(null);
    try {
      const nowIso = new Date().toISOString();
      const created = await invoke<Workspace>("create_workspace", {
        name: newName,
        description: newDesc,
        nowIso,
      });
      setIsAddOpen(false);
      setNewName("");
      setNewDesc("");
      setWorkspaces((prev) => [{ ...created, slave_count: 0 }, ...prev]);
      pushToast(`Workspace "${created.name}" created`, "info");
    } catch (e) {
      setAddError(String(e));
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex w-full items-center justify-between px-4 py-2">
          <div className="flex items-center gap-1">
            <img
              className="h-10 w-10 dark:hidden"
              src="/logo-dark.svg"
              alt="INOWIO"
              width={128}
              height={128}
            />
            <img
              className="hidden h-10 w-10 dark:block"
              src="/logo.svg"
              alt="INOWIO"
              width={128}
              height={128}
            />
            <div className="ml-1 md:ml-2">
              <p className="text-xs uppercase font-semibold  dark:font-normal tracking-[0.45em] text-emerald-700 dark:text-emerald-400">
                <span className="brand-name">INOWIO</span>
              </p>
              <div className="truncate tracking-widest text-lg">Modbus Workbench</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggleButton />
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-500/60 hover:text-emerald-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:text-emerald-100"
              onClick={() => {
                setLogsOpen(true);
                setLogsAutoFollow(true);
              }}
              title="View app logs"
            >
              <FiList className="h-3 w-3" aria-hidden="true" />
              <span className="truncate">Logs</span>
            </button>
            <button
              type="button"
              className="hidden items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-500/60 hover:text-emerald-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:text-emerald-100 sm:inline-flex"
              onClick={() => openHelp({ section: "overview" })}
              title="Open help"
            >
              <FiBookOpen className="h-3 w-3" aria-hidden="true" />
              <span className="truncate">Help</span>
            </button>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600 sm:hidden"
              onClick={() => openHelp({ section: "overview" })}
              aria-label="Open help"
              title="Help"
            >
              <FiBookOpen className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
          <div role="tablist" aria-label="Main sections" className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 p-0.5 text-xs font-semibold uppercase tracking-[0.15em] dark:border-slate-700 dark:bg-white/5">
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === "workspaces"}
              onClick={() => switchMainTab("workspaces")}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 transition ${mainTab === "workspaces" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
            >
              Workspaces
              <span className="font-mono text-[11px] tracking-normal">{workspaces.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === "devices"}
              onClick={() => switchMainTab("devices")}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 transition ${mainTab === "devices" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
            >
              Virtual Devices
            </button>
          </div>

          {mainTab === "workspaces" ? (
          <>
          <div className="relative min-w-45 flex-1 sm:max-w-md">
            <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden="true" />
            <input
              id="ws-search"
              ref={searchInputRef}
              aria-label="Search workspaces"
              className="w-full rounded-full border border-slate-300 bg-white py-2 pl-9 pr-8 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                if (!search) return;
                e.preventDefault();
                setSearch("");
              }}
              placeholder="Search workspaces"
            />
            {search ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  searchInputRef.current?.focus();
                }}
                className="absolute inset-y-0 right-2 flex items-center text-xs text-slate-500 transition hover:text-slate-700 dark:hover:text-slate-300"
                aria-label="Clear search"
              >
                <FiX className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-white/5">
              <button
                type="button"
                onClick={() => setView("grid")}
                aria-pressed={view === "grid"}
                title="Grid view"
                aria-label="Grid view"
                className={`inline-flex h-7 w-8 items-center justify-center rounded-full transition ${view === "grid" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
              >
                <FiGrid className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
                title="List view"
                aria-label="List view"
                className={`inline-flex h-7 w-8 items-center justify-center rounded-full transition ${view === "list" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
              >
                <FiList className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleImportWorkspace()}
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
              title="Import workspace"
            >
              <FiDownload className="h-4 w-4" aria-hidden="true" />
              Import
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
              onClick={() => {
                setAddError(null);
                setIsAddOpen(true);
              }}
              title="Add new workspace"
            >
              <FiPlus className="h-4 w-4" aria-hidden="true" />
              Add New
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
              onClick={() => load()}
              disabled={loading}
              aria-label="Refresh"
              title="Refresh"
            >
              <FiRefreshCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          </>
          ) : null}
        </div>

        {error ? (
          <div className="mx-4 mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {mainTab === "devices" ? (
                  <VirtualDevicesView />
                ) : (
                <>
                {loading ? <div className="flex items-center gap-2 p-2 text-sm text-slate-600 dark:text-slate-300 animate-pulse">
                  <FiRefreshCcw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading...
                </div> : null}
                {!loading && filtered.length === 0 ? (
                  <div className="mt-4 flex w-full items-center justify-center rounded-2xl">
                    <div className="relative h-80 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white/80 dark:border-slate-800/50 dark:bg-slate-950/40">
                      <div
                        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-75 dark:hidden"
                        style={{ backgroundImage: "url(/ws-empty-light.jpg)" }}
                        aria-hidden="true"
                      />
                      <div
                        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-75 hidden dark:block"
                        style={{ backgroundImage: "url(/ws-empty.jpg)" }}
                        aria-hidden="true"
                      />
                      <div className="pointer-events-none absolute inset-0 bg-white/70 dark:bg-slate-950/70" aria-hidden="true" />
                      <div className="relative flex flex-col items-center gap-3 px-6 py-22 text-center">
                        {workspaces.length === 0 && search.trim().length === 0 ? (
                          <>
                            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">No workspaces yet</div>
                            <div className="max-w-md text-sm text-slate-600 dark:text-slate-200/80">
                              Create a workspace to configure connection, slaves, and other settings.
                            </div>
                            <button
                              type="button"
                              className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-5 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                              onClick={() => {
                                setAddError(null);
                                setIsAddOpen(true);
                              }}
                              title="Add new workspace"
                            >
                              <FiPlus className="h-4 w-4" aria-hidden="true" />
                              Add New
                            </button>
                          </>
                        ) : (
                          <>
                            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">No workspaces found</div>
                            <div className="max-w-md text-sm text-slate-600 dark:text-slate-200/80">
                              Try a different search term, or clear the search to see all workspaces.
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                              <button
                                type="button"
                                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
                                onClick={() => {
                                  setSearch("");
                                  searchInputRef.current?.focus();
                                }}
                              >
                                <FiX className="h-4 w-4" aria-hidden="true" />
                                Clear search
                              </button>
                              {workspaces.length === 0 ? null : (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                                  onClick={() => {
                                    setAddError(null);
                                    setIsAddOpen(true);
                                  }}
                                  title="Add new workspace"
                                >
                                  <FiPlus className="h-4 w-4" aria-hidden="true" />
                                  Add New
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                {!loading && filtered.length > 0 && view === "grid" ? (
                  <div
                    className="grid gap-4"
                    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}
                  >
                    {filtered.map((ws) => {
                      const slaveCount = ws.slave_count ?? 0;
                      return (
                        <div
                          key={ws.name}
                          role="button"
                          tabIndex={0}
                          onClick={() => openWorkspace(ws)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openWorkspace(ws);
                            }
                          }}
                          aria-label={"Open " + ws.name}
                          title={"Open " + ws.name}
                          className="group relative cursor-pointer rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg focus:outline-none focus-visible:border-emerald-500/60 focus-visible:ring-2 focus-visible:ring-emerald-500/20 dark:border-slate-800 dark:bg-slate-950/30 dark:hover:border-emerald-500/40 dark:hover:bg-slate-900/60"
                        >
                          <div className="absolute right-2.5 top-2.5 flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                            <button
                              type="button"
                              title="Edit"
                              aria-label={`Edit ${ws.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditModal(ws);
                              }}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white/80 text-slate-500 transition hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
                            >
                              <FiEdit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${ws.name}`}
                              title={"Delete " + ws.name}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteError(null);
                                setDeleteTarget(ws);
                              }}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white/80 text-slate-500 transition hover:border-rose-500/60 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-rose-400/60 dark:hover:text-rose-300"
                            >
                              <FiTrash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>

                          <div className="min-w-0 pr-12">
                            <div className="truncate text-base font-semibold leading-tight text-emerald-700 group-hover:text-emerald-800 dark:text-emerald-300 dark:group-hover:text-emerald-200">
                              {ws.name}
                            </div>
                            <div
                              className={`mt-0.5 truncate text-sm ${ws.description ? "text-slate-600 dark:text-slate-300" : "italic text-slate-400 dark:text-slate-500"}`}
                              title={ws.description ?? undefined}
                            >
                              {ws.description ? ws.description : "No description"}
                            </div>
                          </div>

                          <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-200/70 pt-3.5 font-mono text-xs text-slate-500 dark:border-slate-800/70 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1.5">
                              <FiDatabase className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>
                                <span className="font-semibold text-emerald-700 dark:text-emerald-400">{slaveCount}</span>{" "}
                                {slaveCount === 1 ? "slave" : "slaves"}
                              </span>
                            </span>
                            <span className="truncate tabular-nums">{formatLocalDateTime(ws.updated_at)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {!loading && filtered.length > 0 && view === "list" ? (
                  <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full min-w-160 table-fixed border-collapse text-left">
                      <colgroup>
                        <col />
                        <col />
                        <col className="w-24" />
                        <col className="w-48" />
                        <col className="w-16" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/60 text-[10.5px] uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                          <th className="px-4 py-2.5 font-semibold">Workspace</th>
                          <th className="px-4 py-2.5 font-semibold">Description</th>
                          <th className="px-4 py-2.5 font-semibold">Slaves</th>
                          <th className="px-4 py-2.5 font-semibold">Updated</th>
                          <th className="px-4 py-2.5" aria-hidden="true" />
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((ws) => {
                          const slaveCount = ws.slave_count ?? 0;
                          return (
                            <tr
                              key={ws.name}
                              role="button"
                              tabIndex={0}
                              onClick={() => openWorkspace(ws)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  openWorkspace(ws);
                                }
                              }}
                              aria-label={"Open " + ws.name}
                              title={"Open " + ws.name}
                              className="group cursor-pointer border-b border-slate-200/70 transition last:border-b-0 hover:bg-slate-100/70 focus:outline-none focus-visible:bg-slate-100/70 dark:border-slate-800/70 dark:hover:bg-slate-900/50 dark:focus-visible:bg-slate-900/50"
                            >
                              <td className="truncate px-4 py-2.5 text-sm font-semibold text-emerald-700 group-hover:text-emerald-800 dark:text-emerald-300 dark:group-hover:text-emerald-200">
                                {ws.name}
                              </td>
                              <td
                                className={`truncate px-4 py-2.5 text-sm ${ws.description ? "text-slate-600 dark:text-slate-300" : "italic text-slate-400 dark:text-slate-500"}`}
                                title={ws.description ?? undefined}
                              >
                                {ws.description ? ws.description : "No description"}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-semibold text-emerald-700 dark:text-emerald-400">{slaveCount}</span> {slaveCount === 1 ? "slave" : "slaves"}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                                {formatLocalDateTime(ws.updated_at)}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex justify-end gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                                  <button
                                    type="button"
                                    title="Edit"
                                    aria-label={`Edit ${ws.name}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openEditModal(ws);
                                    }}
                                    className="inline-flex p-2 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-500 transition hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
                                  >
                                    <FiEdit3 className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Delete ${ws.name}`}
                                    title={"Delete " + ws.name}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeleteError(null);
                                      setDeleteTarget(ws);
                                    }}
                                    className="inline-flex items-center justify-center rounded-full p-2 border border-slate-200 bg-white/80 text-slate-500 transition hover:border-rose-500/60 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-rose-400/60 dark:hover:text-rose-300"
                                  >
                                    <FiTrash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                </>
                )}
        </div>
      </div>

      {isAddOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-md dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-emerald-700 dark:text-emerald-300">Add Workspace</div>
              </div>
              <button
                type="button"
                className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
                onClick={() => {
                  setIsAddOpen(false);
                  setAddError(null);
                }}
                title="Close"
              >
                <RiCloseLine className="h-4 w-3" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="ws-new-name">
                Workspace Name
              </label>
              <input
                id="ws-new-name"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                value={newName}
                onChange={(e) => setNewName(e.currentTarget.value)}
                placeholder="e.g. Site-1"
              />
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="ws-new-desc">
                Description
              </label>
              <input
                id="ws-new-desc"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500/60"
                value={newDesc}
                onChange={(e) => setNewDesc(e.currentTarget.value)}
                placeholder="Optional"
              />
            </div>

            {addError ? (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
                {addError}
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                onClick={() => {
                  setIsAddOpen(false);
                  setAddError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/60 dark:text-emerald-200 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
                onClick={() => createWorkspace()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Edit Workspace Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                Edit Workspace
              </h2>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                disabled={editSaving}
                className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              >
                <FiX size={18} />
              </button>
            </div>

            {editError && (
              <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-400">
                {editError}
              </div>
            )}

            <div className="mb-3">
              <label htmlFor="ws-edit-name" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Workspace Name
              </label>
              <input
                id="ws-edit-name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-emerald-600/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100"
                autoFocus
              />
            </div>

            <div className="mb-4">
              <label htmlFor="ws-edit-desc" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Description
              </label>
              <input
                id="ws-edit-desc"
                type="text"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-emerald-600/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                disabled={editSaving}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={editSaving || !editName.trim()}
                className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
              >
                {editSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ImportConflictModal
        open={importConflict !== null}
        workspaceName={importConflict?.workspaceName ?? ""}
        busy={importBusy}
        activeAction={importAction}
        onOverwrite={() => void handleImportOverwrite()}
        onImportAsNew={() => void handleImportAsNew()}
        onClose={handleImportCancel}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        tone="danger"
        title="Delete Workspace?"
        description={
          deleteTarget ? (
            <>
              This will permanently delete <span className="font-semibold text-emerald-700 dark:text-emerald-300">{deleteTarget.name}</span> including all stored settings and data.
            </>
          ) : null
        }
        error={deleteError}
        confirmIcon={<FiTrash2 className="h-4 w-4" aria-hidden="true" />}
        confirmText={deleting ? "Deleting..." : "Delete"}
        busy={deleting}
        onClose={() => {
          if (deleting) return;
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => confirmDelete()}
      />

      {logsOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="flex w-full max-w-7xl flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-md dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase font-semibold  dark:font-normal tracking-[0.25em] text-emerald-700 dark:text-emerald-300">App Logs</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <label className="text-slate-600 dark:text-slate-300" htmlFor="app-logs-min-level">
                  Min level
                </label>
                <select
                  id="app-logs-min-level"
                  className="rounded-full border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-hidden focus:border-emerald-600/60 focus:ring-2 focus:ring-emerald-500/10 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100 dark:focus:border-emerald-500/60"
                  value={logsMinLevel}
                  onChange={(e) => {
                    void refreshAppLogs(e.currentTarget.value as LogLevel);
                  }}
                  disabled={logsBusy}
                >
                  <option value="debug">Debug</option>
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-emerald-500/60 hover:text-emerald-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:text-emerald-100"
                  onClick={() => {
                    void refreshAppLogs();
                  }}
                  disabled={logsBusy}
                >
                  <FiRefreshCcw className="h-3 w-3" aria-hidden="true" />
                  Refresh
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-600"
                  onClick={() => {
                    setLogsOpen(false);
                    setLogsError(null);
                  }}
                  aria-label="Close logs"
                  title="Close logs"
                >
                  <FiX className="h-4 w-3" aria-hidden="true" />
                </button>
              </div>
            </div>

              {logsError ? (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">{logsError}</div>
              ) : null}

              <div className="max-h-[60vh] min-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-800/80 dark:bg-slate-950/40" ref={logsScrollRef} onScroll={handleAppLogsScroll}>
                {orderedAppLogs.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">No logs to display.</div>
                ) : (
                  <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm dark:bg-slate-950/70">
                      <tr>
                        <th className="border-b border-slate-200 bg-inherit px-3 py-2 text-slate-600 dark:border-slate-800 dark:text-slate-300">Time</th>
                        <th className="border-b border-slate-200 bg-inherit px-3 py-2 text-slate-600 dark:border-slate-800 dark:text-slate-300">Level</th>
                        <th className="border-b border-slate-200 bg-inherit px-3 py-2 text-slate-600 dark:border-slate-800 dark:text-slate-300">Message</th>
                        <th className="border-b border-slate-200 bg-inherit px-3 py-2 text-slate-600 dark:border-slate-800 dark:text-slate-300">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderedAppLogs.map((log) => (
                        <tr
                          key={`${log.id}-${log.tsIso}`}
                          className="border-b border-slate-200/80 hover:bg-white/70 last:border-b-0 dark:border-slate-800/80 dark:hover:bg-white/5"
                        >
                          <td className="whitespace-nowrap px-3 py-1.5 text-slate-600 dark:text-slate-300">{formatLocalDateTime(log.tsIso)}</td>
                          <td className="whitespace-nowrap px-3 py-1.5">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${log.level === "error"
                                ? "bg-rose-500/10 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200"
                                : log.level === "warn"
                                  ? "bg-amber-500/10 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
                                  : log.level === "debug"
                                    ? "bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200"
                                    : "bg-emerald-500/10 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                                }`}
                            >
                              {log.level}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-slate-900 dark:text-slate-200">{log.message}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-slate-600 dark:text-slate-300">{log.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        ) : null}
    </div>
  );
}
