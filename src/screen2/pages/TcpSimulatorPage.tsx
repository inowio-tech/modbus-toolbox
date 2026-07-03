import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";

import type { Screen2OutletContext } from "../Screen2Layout";
import AddDeviceModal, { type DeviceTemplate } from "../components/AddDeviceModal";
import SimRegisterModal, { type SimRegister } from "../components/SimRegisterModal";
import SimRuleModal, { type SimRule } from "../components/SimRuleModal";
import { readAddressFormat, writeAddressFormat, type AddressFormat } from "../utils/simulatorPrefs";

type SimConfig = { enabled: boolean; host: string; port: number; tickMs: number };
type ListenInfo = { bound: string; port: number; addresses: string[] };
type SimStatus = { running: boolean; listen: ListenInfo | null; clientCount: number };
type SnapshotRow = { unitId: number; functionCode: number; address: number; valueWord: number | null; valueBit: boolean | null; sourceStatus?: string | null };
type SimDevice = { id: number; templateKey: string; name: string; unitId: number; baseAddress: number; enabled: boolean; sortOrder: number };
type PageRegister = SimRegister & { deviceInstanceId?: number | null };

const SOURCE_STATUS_STYLE: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  stale: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
  missing: "bg-rose-500/15 text-rose-800 dark:text-rose-200",
};

const FC_LABEL: Record<number, string> = { 1: "Coil", 2: "Discrete", 3: "Holding", 4: "Input" };
const BANK_LABEL: Record<number, string> = { 1: "coil", 2: "discrete", 3: "holding", 4: "input" };

function ruleSummary(rule: SimRule): string {
  try {
    const t = JSON.parse(rule.trigger) as Record<string, unknown>;
    const bank = BANK_LABEL[Number(t.bank)] ?? "reg";
    switch (t.type) {
      case "interval":
        return `interval ${t.ms}ms`;
      case "condition":
        return `${bank}[${t.address}] ${t.op} ${t.value}`;
      case "onWrite":
        return `onWrite ${bank}[${t.address}]`;
      default:
        return String(t.type ?? "unknown trigger");
    }
  } catch {
    return "invalid trigger";
  }
}

export default function TcpSimulatorPage() {
  const { workspace } = useOutletContext<Screen2OutletContext>();
  const ws = workspace.name;

  const [config, setConfig] = useState<SimConfig | null>(null);
  const [registers, setRegisters] = useState<PageRegister[]>([]);
  const [devices, setDevices] = useState<SimDevice[]>([]);
  const [rules, setRules] = useState<SimRule[]>([]);
  const [status, setStatus] = useState<SimStatus>({ running: false, listen: null, clientCount: 0 });
  const [listen, setListen] = useState<ListenInfo | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modalReg, setModalReg] = useState<SimRegister | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalRule, setModalRule] = useState<SimRule | null>(null);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [addrFmt, setAddrFmt] = useState<AddressFormat>(() => readAddressFormat(ws));
  const [deviceTemplates, setDeviceTemplates] = useState<DeviceTemplate[]>([]);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);

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
    }
  }, [ws]);

  useEffect(() => { void reload(); }, [reload]);

  // Poll status (client count) every 2s while running; live values arrive via the
  // `simulator_values` push event (subscribed below) instead of polling.
  useEffect(() => {
    if (!status.running) { setSnapshot([]); return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const st = await invoke<SimStatus>("simulator_status", { name: ws });
        if (!cancelled) setStatus(st);
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
    try { await invoke("simulator_stop", { name: ws }); setStatus({ running: false, listen: null, clientCount: 0 }); setListen(null); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [ws]);

  const deleteDevice = useCallback(async (device: SimDevice) => {
    try { await invoke("simulator_delete_device", { name: ws, id: device.id }); await reload(); }
    catch (e) { setError(String(e)); }
  }, [ws, reload]);

  const renameDevice = useCallback(async (device: SimDevice) => {
    const newName = window.prompt("Rename device", device.name);
    if (!newName || newName === device.name) return;
    try {
      await invoke("simulator_update_device", { name: ws, device: { ...device, name: newName } });
      await reload();
    } catch (e) { setError(String(e)); }
  }, [ws, reload]);

  const rebaseDevice = useCallback(async (device: SimDevice) => {
    const input = window.prompt("New base address", String(device.baseAddress));
    if (input === null) return;
    const trimmed = input.trim();
    if (trimmed === "") return;
    const newBaseAddress = Number(trimmed);
    if (!Number.isInteger(newBaseAddress)) { setError("Enter a whole-number base address"); return; }
    try {
      await invoke("simulator_rebase_device", { name: ws, id: device.id, newBaseAddress });
      await reload();
    } catch (e) { setError(String(e)); }
  }, [ws, reload]);

  const snapshotRow = (r: SimRegister): SnapshotRow | undefined =>
    snapshot.find((s) => s.unitId === r.unitId && s.functionCode === r.functionCode && s.address === r.address);

  const liveValue = (r: SimRegister): string => {
    const row = snapshotRow(r);
    if (!row) return "—";
    if (row.valueBit !== null) return row.valueBit ? "ON" : "OFF";
    return row.valueWord === null ? "—" : String(row.valueWord);
  };

  const sourceStatusBadge = (r: SimRegister) => {
    const status = snapshotRow(r)?.sourceStatus;
    if (!status) return null;
    const cls = SOURCE_STATUS_STYLE[status] ?? "bg-slate-500/15 text-slate-700 dark:text-slate-300";
    return (
      <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
        {status}
      </span>
    );
  };

  const fmtAddr = (a: number) => addrFmt === "hex" ? `0x${a.toString(16).toUpperCase().padStart(4, "0")}` : String(a);

  const deviceGroups = devices
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((device) => ({
      device,
      regs: registers.filter((r) => r.deviceInstanceId === device.id),
    }));
  const deviceIds = new Set(devices.map((d) => d.id));
  const standaloneRegs = registers.filter((r) => r.deviceInstanceId == null || !deviceIds.has(r.deviceInstanceId));
  const addrRange = (regs: PageRegister[]) => {
    if (regs.length === 0) return "—";
    const addrs = regs.map((r) => r.address);
    const min = Math.min(...addrs);
    const max = Math.max(...addrs);
    return min === max ? fmtAddr(min) : `${fmtAddr(min)}–${fmtAddr(max)}`;
  };

  const renderRegisterRow = (r: PageRegister) => (
    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
      <td className="py-1">{r.unitId}</td>
      <td>{FC_LABEL[r.functionCode]}</td>
      <td>{fmtAddr(r.address)}</td>
      <td className="truncate">{r.alias}</td>
      <td>{r.dataType}</td>
      <td>{r.holdValue}</td>
      <td className="font-mono">
        {status.running ? liveValue(r) : "—"}
        {status.running ? sourceStatusBadge(r) : null}
      </td>
      <td className="text-right">
        <button type="button" className="mr-2 text-emerald-700 dark:text-emerald-300" onClick={() => { setModalReg(r); setModalOpen(true); }}>Edit</button>
        <button type="button" className="text-rose-600 dark:text-rose-300" onClick={async () => {
          try { await invoke("simulator_delete_register", { name: ws, id: r.id }); await reload(); }
          catch (e) { setError(String(e)); }
        }}>Delete</button>
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">TCP Simulator</h1>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">{error}</div>
      ) : null}

      {/* Server bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${status.running ? "bg-emerald-500" : "bg-slate-400"}`} />
            <span className="text-sm font-semibold">{status.running ? "Listening" : "Stopped"}</span>
          </div>

          <label className="flex items-center gap-2 text-sm">
            Expose
            <select
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
              value={config?.host ?? "0.0.0.0"}
              disabled={status.running}
              onChange={(e) => void saveConfig({ host: e.target.value })}
            >
              <option value="0.0.0.0">LAN (0.0.0.0)</option>
              <option value="127.0.0.1">Local only (127.0.0.1)</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            Port
            <input
              type="number"
              className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
              value={config?.port ?? 502}
              min={1}
              max={65535}
              disabled={status.running}
              onChange={(e) => void saveConfig({ port: Number(e.target.value) })}
            />
          </label>

          {status.running ? (
            <button type="button" disabled={busy} onClick={() => void stop()}
              className="rounded-full border border-rose-500/60 bg-rose-500/10 px-4 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-200">Stop</button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void start()}
              className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200">Start</button>
          )}

          {status.running && listen ? (
            <span className="text-xs text-slate-600 dark:text-slate-300">
              Listening on {listen.addresses.join(", ")} · {status.clientCount} client(s)
            </span>
          ) : null}
        </div>
      </div>

      {/* Registers */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Exposed registers</h2>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full border border-slate-300 dark:border-slate-700 overflow-hidden">
              <button
                type="button"
                aria-label="Decimal addresses"
                className={`px-3 py-1 text-xs font-semibold transition ${addrFmt === "dec" ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-r border-slate-300 dark:border-slate-700" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border-r border-slate-300 dark:border-slate-700"}`}
                onClick={() => { const f: AddressFormat = "dec"; setAddrFmt(f); writeAddressFormat(ws, f); }}
              >Dec</button>
              <button
                type="button"
                aria-label="Hex addresses"
                className={`px-3 py-1 text-xs font-semibold transition ${addrFmt === "hex" ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                onClick={() => { const f: AddressFormat = "hex"; setAddrFmt(f); writeAddressFormat(ws, f); }}
              >Hex</button>
            </div>
            <button type="button"
              className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
              onClick={() => setDeviceModalOpen(true)}>+ Add Device</button>
            <button type="button"
              className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
              onClick={() => { setModalReg(null); setModalOpen(true); }}>+ Add Register</button>
          </div>
        </div>

        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          Device/Generator registers begin updating after Start; changes to them apply on the next Start.
        </p>

        {registers.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">No registers yet. Click "Add Register".</p>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1">Unit</th><th>Type</th><th>Address</th><th>Alias</th><th>Data type</th><th>Value</th><th>Live</th><th></th>
              </tr>
            </thead>
            <tbody>
              {deviceGroups.map(({ device, regs }) => (
                <Fragment key={`device-${device.id}`}>
                  <tr className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-white/10">
                    <td colSpan={6} className="py-1.5 pl-1 text-sm font-semibold">
                      {device.name}
                      <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                        Unit {device.unitId} · {addrRange(regs)}
                      </span>
                    </td>
                    <td colSpan={2} className="text-right text-xs">
                      <button type="button" className="mr-2 text-emerald-700 dark:text-emerald-300" onClick={() => void renameDevice(device)}>Rename</button>
                      <button type="button" className="mr-2 text-emerald-700 dark:text-emerald-300" onClick={() => void rebaseDevice(device)}>Re-base</button>
                      <button type="button" aria-label={`Delete device ${device.name}`} className="text-rose-600 dark:text-rose-300" onClick={() => void deleteDevice(device)}>Delete device</button>
                    </td>
                  </tr>
                  {regs.map((r) => renderRegisterRow(r))}
                </Fragment>
              ))}
              {standaloneRegs.length > 0 ? (
                <Fragment key="standalone">
                  {deviceGroups.length > 0 ? (
                    <tr className="border-t border-slate-200 dark:border-slate-700">
                      <td colSpan={8} className="py-1.5 pl-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Standalone</td>
                    </tr>
                  ) : null}
                  {standaloneRegs.map((r) => renderRegisterRow(r))}
                </Fragment>
              ) : null}
            </tbody>
          </table>
        )}
      </div>

      {/* Rules */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Rules</h2>
          <button type="button"
            className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
            onClick={() => { setModalRule(null); setRuleModalOpen(true); }}>+ Add Rule</button>
        </div>

        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Rules apply on next Start.</p>

        {rules.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">No rules yet. Click "Add Rule".</p>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1">Name</th><th>Trigger</th><th>Enabled</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 truncate">{r.name}</td>
                  <td className="font-mono text-xs">{ruleSummary(r)}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Rule enabled ${r.name}`}
                      checked={r.enabled}
                      onChange={async (e) => {
                        try {
                          await invoke("simulator_update_rule", { name: ws, rule: { ...r, enabled: e.target.checked } });
                          await reload();
                        } catch (err) { setError(String(err)); }
                      }}
                    />
                  </td>
                  <td className="text-right">
                    <button type="button" className="mr-2 text-emerald-700 dark:text-emerald-300" onClick={() => { setModalRule(r); setRuleModalOpen(true); }}>Edit</button>
                    <button type="button" className="text-rose-600 dark:text-rose-300" onClick={async () => {
                      try { await invoke("simulator_delete_rule", { name: ws, id: r.id }); await reload(); }
                      catch (e) { setError(String(e)); }
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SimRegisterModal
        open={modalOpen}
        initial={modalReg}
        onClose={() => setModalOpen(false)}
        onSubmit={async (reg) => {
          try {
            if (reg.id) await invoke("simulator_update_register", { name: ws, register: reg });
            else await invoke("simulator_add_register", { name: ws, register: reg });
            setModalOpen(false);
            await reload();
          } catch (e) { setError(String(e)); }
        }}
      />

      <AddDeviceModal
        open={deviceModalOpen}
        templates={deviceTemplates}
        onClose={() => setDeviceModalOpen(false)}
        onSubmit={async ({ templateKey, deviceName, unitId, baseAddress }) => {
          try {
            await invoke("simulator_add_device", { name: ws, deviceName, templateKey, unitId, baseAddress });
            setDeviceModalOpen(false);
            await reload();
          } catch (e) { setError(String(e)); }
        }}
      />

      <SimRuleModal
        open={ruleModalOpen}
        initial={modalRule}
        onClose={() => setRuleModalOpen(false)}
        onSubmit={async (rule) => {
          try {
            if (rule.id) await invoke("simulator_update_rule", { name: ws, rule });
            else await invoke("simulator_add_rule", { name: ws, rule });
            setRuleModalOpen(false);
            await reload();
          } catch (e) { setError(String(e)); }
        }}
      />
    </div>
  );
}
