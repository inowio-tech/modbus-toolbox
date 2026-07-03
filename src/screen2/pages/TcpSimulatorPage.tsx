import { useCallback, useMemo, useState } from "react";
import { FiX } from "react-icons/fi";
import { useOutletContext } from "react-router-dom";

import type { Screen2OutletContext } from "../Screen2Layout";
import AddDeviceModal from "../components/AddDeviceModal";
import SimRegisterModal, { type SimRegister } from "../components/SimRegisterModal";
import SimRuleModal, { type SimRule } from "../components/SimRuleModal";
import ConfirmDialog from "../simulator/ConfirmDialog";
import DevicesTab from "../simulator/DevicesTab";
import LiveValuesTab from "../simulator/LiveValuesTab";
import PromptDialog from "../simulator/PromptDialog";
import RegisterInspector from "../simulator/RegisterInspector";
import RegistersTab from "../simulator/RegistersTab";
import RulesTab from "../simulator/RulesTab";
import SimFooterBar from "../simulator/SimFooterBar";
import SimStatusDashboard from "../simulator/SimStatusDashboard";
import SimTabBar, { type TabKey } from "../simulator/SimTabBar";
import { useSimulatorData, type PageRegister, type SimDevice } from "../simulator/useSimulatorData";
import { useValueHistory } from "../simulator/useValueHistory";
import { readAddressFormat, writeAddressFormat, type AddressFormat } from "../utils/simulatorPrefs";

const TAB_KEY = (ws: string) => `sim.tab.${ws}`;
function readTab(ws: string): TabKey {
  const v = window.localStorage.getItem(TAB_KEY(ws));
  return v === "devices" || v === "rules" || v === "live" ? v : "registers";
}
function writeTab(ws: string, tab: TabKey) {
  try { window.localStorage.setItem(TAB_KEY(ws), tab); } catch { /* ignore */ }
}

// Turn raw backend/SQLite errors into something a user can act on. Unknown
// errors pass through unchanged so we never hide real diagnostics.
function humanizeError(raw: string): string {
  const msg = raw.replace(/^Error:\s*/i, "");
  if (/UNIQUE constraint failed/i.test(msg)) {
    return "A register already exists at that unit and address. Pick a different address or unit.";
  }
  if (/would overlap existing register/i.test(msg)) {
    return "This device or register would overlap addresses already in use. Choose a different base address or unit.";
  }
  if (/address .* out of range/i.test(msg)) {
    return "Address is out of range (0–65535).";
  }
  if (/port/i.test(msg) && /(in use|address already|bind)/i.test(msg)) {
    return "That port is already in use. Stop the other server or choose a different port.";
  }
  return msg;
}

export default function TcpSimulatorPage() {
  const { workspace } = useOutletContext<Screen2OutletContext>();
  const ws = workspace.name;
  const sim = useSimulatorData(ws);

  const [activeTab, setActiveTab] = useState<TabKey>(() => readTab(ws));
  const [addrFmt, setAddrFmt] = useState<AddressFormat>(() => readAddressFormat(ws));
  const [selectedRegisterId, setSelectedRegisterId] = useState<number | null>(null);
  const [addRegisterOpen, setAddRegisterOpen] = useState(false);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [modalRule, setModalRule] = useState<SimRule | null>(null);
  const [deviceEdit, setDeviceEdit] = useState<{ kind: "rename" | "rebase"; device: SimDevice } | null>(null);
  const [confirmDeleteDevice, setConfirmDeleteDevice] = useState<SimDevice | null>(null);
  const [confirmDeleteRegister, setConfirmDeleteRegister] = useState<PageRegister | null>(null);

  const changeTab = useCallback((tab: TabKey) => { setActiveTab(tab); writeTab(ws, tab); }, [ws]);
  const changeAddrFmt = useCallback((f: AddressFormat) => { setAddrFmt(f); writeAddressFormat(ws, f); }, [ws]);

  const selectedRegister = useMemo<PageRegister | null>(
    () => sim.registers.find((r) => r.id === selectedRegisterId) ?? null,
    [sim.registers, selectedRegisterId],
  );
  const selectedKey = selectedRegister
    ? { unitId: selectedRegister.unitId, functionCode: selectedRegister.functionCode, address: selectedRegister.address }
    : null;
  const history = useValueHistory(sim.snapshot, selectedKey);

  const liveValueOf = useCallback((r: PageRegister): string => {
    const row = sim.snapshotFor(r.unitId, r.functionCode, r.address);
    if (!row) return "—";
    if (row.valueBit !== null && row.valueBit !== undefined) return row.valueBit ? "ON" : "OFF";
    if (row.valueWord === null || row.valueWord === undefined) return "—";
    return r.unit ? `${row.valueWord} ${r.unit}` : String(row.valueWord);
  }, [sim.snapshotFor]);

  const deleteRegister = useCallback(async (id: number) => {
    await sim.deleteRegister(id);
    if (selectedRegisterId === id) setSelectedRegisterId(null);
  }, [sim, selectedRegisterId]);

  const handleRename = useCallback((device: SimDevice) => setDeviceEdit({ kind: "rename", device }), []);
  const handleRebase = useCallback((device: SimDevice) => setDeviceEdit({ kind: "rebase", device }), []);

  const counts: Partial<Record<TabKey, number>> = {
    registers: sim.registers.length,
    devices: sim.devices.length,
    rules: sim.rules.length,
  };

  return (
    <div className="flex min-h-full flex-1 flex-col gap-4 px-3 sm:px-0">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-emerald-700 dark:font-normal dark:text-emerald-300">TCP Simulator</p>
        <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">Expose devices (including TCP & RTU) and registers as a Modbus TCP server for external clients.</div>
      </div>

      {sim.error ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          <span>{humanizeError(sim.error)}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            title="Dismiss"
            onClick={() => sim.setError(null)}
            className="shrink-0 rounded-md p-0.5 text-rose-600 transition hover:bg-rose-500/15 dark:text-rose-300"
          >
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <SimStatusDashboard
        config={sim.config}
        status={sim.status}
        listen={sim.listen}
        busy={sim.busy}
        onStart={() => void sim.start()}
        onStop={() => void sim.stop()}
        onSaveConfig={(patch) => void sim.saveConfig(patch)}
        onChangeExpose={(host) => void sim.saveConfig({ host })}
        onChangePort={(port) => void sim.saveConfig({ port })}
        onRefresh={() => void sim.reload()}
        registerCount={sim.registers.length}
        unitCount={new Set(sim.registers.map((r) => r.unitId)).size}
        deviceCount={sim.devices.length}
      />

      <SimTabBar active={activeTab} onChange={changeTab} counts={counts} />

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          {activeTab === "registers" ? (
            <RegistersTab
              ws={ws}
              registers={sim.registers}
              devices={sim.devices}
              status={sim.status}
              snapshotFor={sim.snapshotFor}
              addrFmt={addrFmt}
              onAddrFmt={changeAddrFmt}
              onSelectRegister={(r) => setSelectedRegisterId(r.id)}
              onDelete={(id) => setConfirmDeleteRegister(sim.registers.find((r) => r.id === id) ?? null)}
              onAddRegister={() => setAddRegisterOpen(true)}
              onAddDevice={() => setDeviceModalOpen(true)}
            />
          ) : null}

          {activeTab === "devices" ? (
            <DevicesTab
              devices={sim.devices}
              registers={sim.registers}
              onAddDevice={() => setDeviceModalOpen(true)}
              onRename={handleRename}
              onRebase={handleRebase}
              onDelete={(device) => setConfirmDeleteDevice(device)}
            />
          ) : null}

          {activeTab === "rules" ? (
            <RulesTab
              rules={sim.rules}
              devices={sim.devices}
              onAdd={() => { setModalRule(null); setRuleModalOpen(true); }}
              onEdit={(rule) => { setModalRule(rule); setRuleModalOpen(true); }}
              onToggle={(rule, enabled) => void sim.updateRule({ ...rule, enabled })}
              onDelete={(id) => void sim.deleteRule(id)}
            />
          ) : null}

          {activeTab === "live" ? (
            <LiveValuesTab registers={sim.registers} snapshotFor={sim.snapshotFor} status={sim.status} />
          ) : null}
        </div>

        {activeTab === "registers" && selectedRegister ? (
          <div className="w-full lg:w-96 lg:shrink-0">
            <RegisterInspector
              register={selectedRegister}
              devices={sim.devices}
              history={history}
              liveValue={liveValueOf(selectedRegister)}
              sourceStatus={sim.snapshotFor(selectedRegister.unitId, selectedRegister.functionCode, selectedRegister.address)?.sourceStatus}
              running={sim.status.running}
              onSave={(reg) => void sim.updateRegister(reg)}
              onDuplicate={(reg) => void sim.duplicateRegister(reg)}
              onDelete={(id) => setConfirmDeleteRegister(sim.registers.find((r) => r.id === id) ?? null)}
              onClose={() => setSelectedRegisterId(null)}
              onViewDevice={() => changeTab("devices")}
            />
          </div>
        ) : null}
      </div>

      <SimFooterBar status={sim.status} config={sim.config} lastUpdated={sim.lastUpdated} />

      <SimRegisterModal
        open={addRegisterOpen}
        initial={null}
        onClose={() => setAddRegisterOpen(false)}
        onSubmit={async (reg: SimRegister) => { await sim.addRegister(reg); setAddRegisterOpen(false); }}
      />

      <AddDeviceModal
        open={deviceModalOpen}
        templates={sim.deviceTemplates}
        existingRegisters={sim.registers}
        onClose={() => setDeviceModalOpen(false)}
        onSubmit={async (payload) => { await sim.addDevice(payload); setDeviceModalOpen(false); }}
      />

      <SimRuleModal
        open={ruleModalOpen}
        initial={modalRule}
        onClose={() => setRuleModalOpen(false)}
        onSubmit={async (rule: SimRule) => {
          if (rule.id) await sim.updateRule(rule);
          else await sim.addRule(rule);
          setRuleModalOpen(false);
        }}
      />

      <PromptDialog
        open={deviceEdit?.kind === "rename"}
        title="Rename device"
        label="Device name"
        initialValue={deviceEdit?.device.name ?? ""}
        submitLabel="Rename"
        validate={(v) => (v.trim() === "" ? "Name can't be empty" : null)}
        onSubmit={(v) => { if (deviceEdit) void sim.renameDevice(deviceEdit.device, v.trim()); setDeviceEdit(null); }}
        onClose={() => setDeviceEdit(null)}
      />

      <ConfirmDialog
        open={confirmDeleteDevice !== null}
        title="Delete device?"
        message={
          confirmDeleteDevice
            ? `Delete "${confirmDeleteDevice.name}" and all ${sim.registers.filter((r) => r.deviceInstanceId === confirmDeleteDevice.id).length} of its registers? This can't be undone.`
            : ""
        }
        confirmLabel="Delete device"
        onConfirm={() => {
          if (confirmDeleteDevice) void sim.deleteDevice(confirmDeleteDevice.id);
          setConfirmDeleteDevice(null);
        }}
        onClose={() => setConfirmDeleteDevice(null)}
      />

      <ConfirmDialog
        open={confirmDeleteRegister !== null}
        title="Delete register?"
        message={(() => {
          if (!confirmDeleteRegister) return "";
          const r = confirmDeleteRegister;
          const name = r.alias?.trim() ? `"${r.alias.trim()}"` : `register at unit ${r.unitId}, address ${r.address}`;
          const lastOfDevice =
            r.deviceInstanceId != null &&
            sim.registers.filter((x) => x.deviceInstanceId === r.deviceInstanceId).length === 1;
          const dev = lastOfDevice ? sim.devices.find((d) => d.id === r.deviceInstanceId) : undefined;
          const tail = dev ? ` This is the last register of device "${dev.name}", which will also be removed.` : "";
          return `Delete ${name}? This can't be undone.${tail}`;
        })()}
        confirmLabel="Delete register"
        onConfirm={() => {
          if (confirmDeleteRegister) void deleteRegister(confirmDeleteRegister.id);
          setConfirmDeleteRegister(null);
        }}
        onClose={() => setConfirmDeleteRegister(null)}
      />

      <PromptDialog
        open={deviceEdit?.kind === "rebase"}
        title="Re-base device"
        label="New base address"
        initialValue={deviceEdit ? String(deviceEdit.device.baseAddress) : "0"}
        inputMode="numeric"
        hint="Moves all of this device's registers together to a new start address — their relative offsets stay the same (e.g. base 0→100 shifts Temp 0→100, Humidity 1→101)."
        submitLabel="Re-base"
        validate={(v) => {
          const t = v.trim();
          if (t === "") return "Enter a base address";
          const n = Number(t);
          if (!Number.isInteger(n) || n < 0 || n > 65535) return "Enter a whole number between 0 and 65535";
          return null;
        }}
        onSubmit={(v) => { if (deviceEdit) void sim.rebaseDevice(deviceEdit.device.id, Number(v.trim())); setDeviceEdit(null); }}
        onClose={() => setDeviceEdit(null)}
      />
    </div>
  );
}
