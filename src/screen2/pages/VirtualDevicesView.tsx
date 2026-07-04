import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiDownload, FiEdit2, FiPlus, FiTrash2, FiUpload } from "react-icons/fi";

import ConfirmDialog from "../../components/ConfirmDialog";
import type { DeviceTemplate } from "../components/AddDeviceModal";
import TemplateEditorModal from "../components/TemplateEditorModal";

export default function VirtualDevicesView() {
  const [templates, setTemplates] = useState<DeviceTemplate[]>([]);
  const [customKeys, setCustomKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DeviceTemplate | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DeviceTemplate | null>(null);

  const reload = useCallback(async () => {
    try {
      const [all, custom] = await Promise.all([
        invoke<DeviceTemplate[]>("simulator_list_device_templates"),
        invoke<DeviceTemplate[]>("simulator_list_custom_templates"),
      ]);
      setTemplates(all ?? []);
      setCustomKeys(new Set((custom ?? []).map((c) => c.templateKey)));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const isCustom = useCallback((key: string) => customKeys.has(key), [customKeys]);
  const takenKeys = useMemo(() => templates.map((t) => t.templateKey), [templates]);

  const openNew = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (t: DeviceTemplate) => { setEditing(t); setEditorOpen(true); };

  const handleSave = async (t: DeviceTemplate) => {
    try {
      await invoke("simulator_save_custom_template", { template: t });
      setEditorOpen(false);
      setEditing(null);
      await reload();
    } catch (e) { setError(String(e)); }
  };

  const handleDelete = async (key: string) => {
    try { await invoke("simulator_delete_custom_template", { templateKey: key }); await reload(); }
    catch (e) { setError(String(e)); }
  };

  const handleImport = async () => {
    try {
      const imported = await invoke<DeviceTemplate | null>("simulator_import_custom_template");
      if (imported) await reload();
    } catch (e) { setError(String(e)); }
  };

  const handleExport = async (key: string) => {
    try { await invoke("simulator_export_template", { templateKey: key }); }
    catch (e) { setError(String(e)); }
  };

  const builtIns = templates.filter((t) => !isCustom(t.templateKey));
  const customs = templates.filter((t) => isCustom(t.templateKey));

  const card = (t: DeviceTemplate, custom: boolean) => (
    <div key={t.templateKey} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xl" aria-hidden="true">{t.icon}</span>
          <div className="min-w-0">
            <div className="truncate font-bold text-slate-900 dark:text-slate-100">{t.name}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{t.category}</div>
          </div>
        </div>
        {custom ? (
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">Custom</span>
        ) : (
          <span className="shrink-0 rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Built-in</span>
        )}
      </div>
      {t.description ? <div className="line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{t.description}</div> : null}
      <div className="text-xs text-slate-500 dark:text-slate-400">{t.registers.length} register{t.registers.length === 1 ? "" : "s"}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => void handleExport(t.templateKey)}
          className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-200">
          <FiUpload className="h-3 w-3" aria-hidden="true" /> Export
        </button>
        {custom ? (
          <>
            <button type="button" onClick={() => openEdit(t)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-200">
              <FiEdit2 className="h-3 w-3" aria-hidden="true" /> Edit
            </button>
            <button type="button" onClick={() => setConfirmDelete(t)}
              className="inline-flex items-center gap-1 rounded-full border border-rose-400/60 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:border-rose-500 dark:text-rose-300">
              <FiTrash2 className="h-3 w-3" aria-hidden="true" /> Delete
            </button>
          </>
        ) : (
          <button type="button" onClick={() => openEdit({ ...t, templateKey: `custom_${t.templateKey}`, name: `${t.name} (copy)`, category: "Custom" })}
            className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-200">
            <FiEdit2 className="h-3 w-3" aria-hidden="true" /> Clone & edit
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-emerald-700 dark:font-normal dark:text-emerald-300">Virtual Device Builder</p>
          <div className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            Virtual devices are reusable register-map templates shared across every workspace — add one from a workspace's TCP Simulator → Add Device. Built-in devices can be cloned; custom ones can be edited, exported to share, or deleted. Import a shared <code>.json</code> to use someone else's device.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void handleImport()}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-200">
            <FiDownload className="h-3.5 w-3.5" aria-hidden="true" /> Import Device
          </button>
          <button type="button" onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:border-emerald-500 dark:border-emerald-500/60 dark:text-emerald-200">
            <FiPlus className="h-3.5 w-3.5" aria-hidden="true" /> New Device
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss error" onClick={() => setError(null)} className="shrink-0 rounded-md px-1 text-rose-600 dark:text-rose-300">✕</button>
        </div>
      ) : null}

      <div>
        <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          Custom Devices {customs.length > 0 ? <span className="text-slate-400">· {customs.length}</span> : null}
        </div>
        {customs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No custom devices yet. Create one, clone a built-in, or import a shared <code>.json</code>.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{customs.map((t) => card(t, true))}</div>
        )}
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Built-in Devices <span className="text-slate-400">· {builtIns.length}</span></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{builtIns.map((t) => card(t, false))}</div>
      </div>

      <TemplateEditorModal
        open={editorOpen}
        initial={editing}
        takenKeys={takenKeys}
        onClose={() => { setEditorOpen(false); setEditing(null); }}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        tone="danger"
        title="Delete template"
        description={
          confirmDelete ? (
            <>
              <p className="mb-2">
                Delete the custom template <span className="font-semibold text-emerald-700 dark:text-emerald-300">{confirmDelete.name}</span>?
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">This removes it from every workspace's Add Device gallery.</p>
            </>
          ) : null
        }
        confirmIcon={<FiTrash2 className="h-4 w-4" aria-hidden="true" />}
        confirmText="Delete template"
        onConfirm={() => { if (confirmDelete) void handleDelete(confirmDelete.templateKey); setConfirmDelete(null); }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}
