import { useCallback, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

import type { Screen2OutletContext } from "../Screen2Layout";
import AddDeviceModal from "../components/AddDeviceModal";
import SimRegisterModal, { type SimRegister } from "../components/SimRegisterModal";
import SimRuleModal, { type SimRule } from "../components/SimRuleModal";
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
        <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">Expose registers as a Modbus TCP server for external clients.</div>
      </div>

      {sim.error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {sim.error}
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
              onDelete={(id) => void deleteRegister(id)}
              onAddRegister={() => setAddRegisterOpen(true)}
              onAddDevice={() => setDeviceModalOpen(true)}
            />
          ) : null}

          {activeTab === "devices" ? (
            <DevicesTab
              devices={sim.devices}
              registers={sim.registers}
              onAddDevice={() => setDeviceModalOpen(true)}
              onToggleEnabled={(device, enabled) => void sim.updateDevice({ ...device, enabled })}
              onRename={handleRename}
              onRebase={handleRebase}
              onDelete={(device) => void sim.deleteDevice(device.id)}
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
              onDelete={(id) => void deleteRegister(id)}
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
