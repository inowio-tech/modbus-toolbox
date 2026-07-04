import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import type { DeviceTemplate } from "../components/AddDeviceModal";
import type { SimRegister } from "../components/SimRegisterModal";
import type { SimRule } from "../components/SimRuleModal";

export type SimConfig = { enabled: boolean; host: string; port: number; tickMs: number };
export type ListenInfo = { bound: string; port: number; addresses: string[] };
export type ClientInfo = { id: number; addr: string; connectedAtMs: number };
export type SimEvent = { atMs: number; kind: string; detail: string };
export type SimStatus = {
  running: boolean;
  listen: ListenInfo | null;
  clientCount: number;
  startedAtMs?: number | null;
  clients?: ClientInfo[];
};
export type SnapshotRow = { unitId: number; functionCode: number; address: number; valueWord: number | null; valueBit: boolean | null; sourceStatus?: string | null };
export type SimDevice = { id: number; templateKey: string; name: string; unitId: number; baseAddress: number; enabled: boolean; sortOrder: number };
export type PageRegister = SimRegister & { deviceInstanceId?: number | null };

export type AddDevicePayload = { templateKey: string; deviceName: string; unitId: number; baseAddress: number };

/**
 * Extraction of the TCP Simulator page's data/mutation logic (state, reload,
 * status-poll effect, `simulator_values` subscription, config/start/stop, and
 * every register/device/rule mutation) so it can be shared by the tabbed
 * shell without duplicating Tauri wiring.
 */
export function useSimulatorData(ws: string) {
  const [config, setConfig] = useState<SimConfig | null>(null);
  const [registers, setRegisters] = useState<PageRegister[]>([]);
  const [devices, setDevices] = useState<SimDevice[]>([]);
  const [rules, setRules] = useState<SimRule[]>([]);
  const [status, setStatus] = useState<SimStatus>({ running: false, listen: null, clientCount: 0 });
  const [listen, setListen] = useState<ListenInfo | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotRow[]>([]);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [deviceTemplates, setDeviceTemplates] = useState<DeviceTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const [cfg, regs, rls, st, templates, devs] = await Promise.all([
        invoke<SimConfig>("simulator_get_config", { name: ws }),
        invoke<PageRegister[]>("simulator_list_registers", { name: ws }),
        invoke<SimRule[]>("simulator_list_rules", { name: ws }),
        invoke<SimStatus>("simulator_status", { name: ws }),
        invoke<DeviceTemplate[]>("simulator_list_device_templates"),
        invoke<SimDevice[]>("simulator_list_devices", { name: ws }),
      ]);
      setConfig(cfg);
      setRegisters(regs ?? []);
      setRules(rls);
      setStatus(st);
      setDeviceTemplates(templates);
      setDevices(devs ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLastUpdated(Date.now());
    }
  }, [ws]);

  useEffect(() => { void reload(); }, [reload]);

  // Poll status (client list) + events every 2s while running; live values arrive
  // via the `simulator_values` push event (subscribed below) instead of polling.
  useEffect(() => {
    if (!status.running) { setSnapshot([]); return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const [st, evs] = await Promise.all([
          invoke<SimStatus>("simulator_status", { name: ws }),
          invoke<SimEvent[]>("simulator_events", { name: ws }),
        ]);
        if (!cancelled) { setStatus(st); setEvents(evs ?? []); }
      } catch { /* transient */ }
    };
    const id = window.setInterval(tick, 2000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [status.running, ws]);

  // Subscribe to live register values for this workspace.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    (async () => {
      const un = await tauriListen<{ workspace: string; rows: SnapshotRow[] }>("simulator_values", (event) => {
        if (event.payload.workspace !== ws) return;
        setSnapshot(event.payload.rows);
      });
      if (disposed) { void un(); return; }
      unlisten = un;
    })();
    return () => {
      disposed = true;
      if (unlisten) void unlisten();
    };
  }, [ws]);

  const saveConfig = useCallback(async (patch: Partial<SimConfig>) => {
    if (!config) return;
    const next = { ...config, ...patch };
    setConfig(next);
    try { await invoke("simulator_set_config", { name: ws, config: next }); }
    catch (e) { setError(String(e)); }
  }, [config, ws]);

  const start = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const st = await invoke<SimStatus>("simulator_start", { name: ws });
      setStatus(st);
      if (st.listen) setListen(st.listen);
      // Fetch an immediate snapshot so values show before the first push event arrives.
      try {
        const rows = await invoke<SnapshotRow[]>("simulator_snapshot", { name: ws });
        setSnapshot(rows);
      } catch { /* transient */ }
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [ws]);

  const stop = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      await invoke("simulator_stop", { name: ws });
      setStatus({ running: false, listen: null, clientCount: 0, startedAtMs: null, clients: [] });
      setListen(null);
      // Keep the event history visible after Stop (it includes the "stopped" line).
      try { setEvents(await invoke<SimEvent[]>("simulator_events", { name: ws })); } catch { /* transient */ }
    }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [ws]);

  const addRegister = useCallback(async (reg: SimRegister) => {
    try { await invoke("simulator_add_register", { name: ws, register: reg }); await reload(); }
    catch (e) { setError(String(e)); }
  }, [ws, reload]);

  const updateRegister = useCallback(async (reg: SimRegister) => {
    try { await invoke("simulator_update_register", { name: ws, register: reg }); await reload(); }
    catch (e) { setError(String(e)); }
  }, [ws, reload]);

  const deleteRegister = useCallback(async (id: number) => {
    try { await invoke("simulator_delete_register", { name: ws, id }); await reload(); }
    catch (e) { setError(String(e)); }
  }, [ws, reload]);

  // Clone with id:0 and a "(copy)" alias. The table has UNIQUE(unit,fc,address),
  // so the clone MUST land on a free address or the insert fails — pick the next
  // free address on the same unit+function, past the original's own span. The
  // copy is created standalone (deviceInstanceId cleared) since the backend
  // insert doesn't attach it to a device anyway.
  const duplicateRegister = useCallback(async (reg: PageRegister) => {
    const span = reg.dataType === "u32" || reg.dataType === "i32" || reg.dataType === "f32" ? 2 : 1;
    const taken = new Set(
      registers.filter((r) => r.unitId === reg.unitId && r.functionCode === reg.functionCode).map((r) => r.address),
    );
    let addr = reg.address + span;
    while (addr <= 65535 && taken.has(addr)) addr += 1;
    const clone: PageRegister = { ...reg, id: 0, alias: `${reg.alias} (copy)`, address: addr, deviceInstanceId: null };
    try { await invoke("simulator_add_register", { name: ws, register: clone }); await reload(); }
    catch (e) { setError(String(e)); }
  }, [ws, reload, registers]);

  const addDevice = useCallback(async (payload: AddDevicePayload) => {
    try {
      await invoke("simulator_add_device", {
        name: ws,
        deviceName: payload.deviceName,
        templateKey: payload.templateKey,
        unitId: payload.unitId,
        baseAddress: payload.baseAddress,
      });
      await reload();
    } catch (e) { setError(String(e)); }
  }, [ws, reload]);

  const updateDevice = useCallback(async (device: SimDevice) => {
    try { await invoke("simulator_update_device", { name: ws, device }); await reload(); }
    catch (e) { setError(String(e)); }
  }, [ws, reload]);

  const deleteDevice = useCallback(async (id: number) => {
    try { await invoke("simulator_delete_device", { name: ws, id }); await reload(); }
    catch (e) { setError(String(e)); }
  }, [ws, reload]);

  const renameDevice = useCallback(async (device: SimDevice, name: string) => {
    try { await invoke("simulator_update_device", { name: ws, device: { ...device, name } }); await reload(); }
    catch (e) { setError(String(e)); }
  }, [ws, reload]);

  const rebaseDevice = useCallback(async (id: number, base: number) => {
    try { await invoke("simulator_rebase_device", { name: ws, id, newBaseAddress: base }); await reload(); }
    catch (e) { setError(String(e)); }
  }, [ws, reload]);

  const addRule = useCallback(async (rule: SimRule) => {
    try { await invoke("simulator_add_rule", { name: ws, rule }); await reload(); }
    catch (e) { setError(String(e)); }
  }, [ws, reload]);

  const updateRule = useCallback(async (rule: SimRule) => {
    try { await invoke("simulator_update_rule", { name: ws, rule }); await reload(); }
    catch (e) { setError(String(e)); }
  }, [ws, reload]);

  const deleteRule = useCallback(async (id: number) => {
    try { await invoke("simulator_delete_rule", { name: ws, id }); await reload(); }
    catch (e) { setError(String(e)); }
  }, [ws, reload]);

  // Export the whole workspace sim setup to a JSON file. The Rust backend opens
  // the native save dialog and writes the file; returns true if saved.
  const exportProfile = useCallback(async (): Promise<boolean> => {
    try { return (await invoke<boolean>("simulator_export_profile", { name: ws })) === true; }
    catch (e) { setError(String(e)); return false; }
  }, [ws]);

  // Replace the workspace sim setup from a JSON file chosen via the backend's
  // native open dialog. Reloads on a successful import.
  const importProfile = useCallback(async (): Promise<boolean> => {
    try {
      const ok = (await invoke<boolean>("simulator_import_profile", { name: ws })) === true;
      if (ok) await reload();
      return ok;
    } catch (e) { setError(String(e)); return false; }
  }, [ws, reload]);

  // Build a *pre-filled draft* from a configured live device: its full register
  // layout captured as a DeviceTemplate the user can review/refine in the editor
  // before saving. A key is suggested from the name (editable + clash-guarded in
  // the editor). Returns null on failure.
  const buildDeviceTemplate = useCallback(async (deviceId: number, deviceName: string): Promise<DeviceTemplate | null> => {
    try {
      const slug = deviceName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      return await invoke<DeviceTemplate>("simulator_device_to_template", {
        name: ws, deviceId, templateKey: `custom_${slug || "device"}`,
        templateName: deviceName.trim() || "New device", category: "Custom", icon: "📟", description: "",
      });
    } catch (e) { setError(String(e)); return null; }
  }, [ws]);

  // Persist a custom (app-global) device template, then reload so the in-workspace
  // Add Device gallery reflects it immediately. Returns true on success.
  const saveCustomTemplate = useCallback(async (template: DeviceTemplate): Promise<boolean> => {
    try {
      await invoke("simulator_save_custom_template", { template });
      await reload();
      return true;
    } catch (e) { setError(String(e)); return false; }
  }, [reload]);

  const snapshotFor = useCallback(
    (unitId: number, fc: number, address: number): SnapshotRow | undefined =>
      snapshot.find((s) => s.unitId === unitId && s.functionCode === fc && s.address === address),
    [snapshot]
  );

  return {
    config, registers, devices, rules, status, listen, snapshot, events,
    deviceTemplates, error, busy, lastUpdated,
    reload, saveConfig, start, stop,
    addRegister, updateRegister, deleteRegister, duplicateRegister,
    addDevice, updateDevice, deleteDevice, renameDevice, rebaseDevice,
    addRule, updateRule, deleteRule,
    exportProfile, importProfile, buildDeviceTemplate, saveCustomTemplate,
    setError,
    snapshotFor,
  };
}
