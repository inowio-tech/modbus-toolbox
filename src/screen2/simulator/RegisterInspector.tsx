import { useEffect, useState } from "react";

import { rwLabel, type PageRegister } from "./simFilters";
import type { SimDevice } from "./useSimulatorData";

const DEVICE_PRESETS = ["temperature", "humidity", "pressure", "flow", "vibration", "analog", "discrete", "counter"];
const GENERATOR_KINDS = ["sine", "ramp", "decrement", "step", "random", "toggle"];
const MULTI_WORD_TYPES = ["u32", "i32", "f32", "u64", "i64", "f64"];
const BYTE_ORDERS = ["ABCD", "BADC", "CDAB", "DCBA"];
const DISPLAY_FORMATS = ["raw", "dec0", "dec1", "dec2", "hex"];

const FC_LABEL: Record<number, string> = { 1: "Coil", 2: "Discrete", 3: "Holding", 4: "Input" };

type SourceParams = {
  kind?: string;
  preset?: string;
  min?: number;
  max?: number;
  periodMs?: number;
  slaveUnitId?: number;
  connectionKind?: string;
  functionCode?: number;
  address?: number;
  scale?: number;
  offset?: number;
  srcByteOrder?: string;
};

function parseSourceParams(raw: string | undefined): SourceParams {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function accessLabel(functionCode: number): string {
  return rwLabel(functionCode) === "R/W" ? "Read-Write" : "Read Only";
}

type SubTab = "general" | "source" | "advanced";

const INPUT_CLASS = "rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900";
const LABEL_CLASS = "flex flex-col gap-1 text-xs";

export type RegisterInspectorProps = {
  register: PageRegister | null;
  devices: SimDevice[];
  history: number[];
  liveValue: string;
  sourceStatus?: string | null;
  running: boolean;
  onSave: (reg: PageRegister) => void;
  onDuplicate: (reg: PageRegister) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
  onViewDevice: (deviceId: number) => void;
};

function Sparkline({ history }: { history: number[] }) {
  if (history.length < 2) return null;
  const w = 160;
  const h = 40;
  const minV = Math.min(...history);
  const maxV = Math.max(...history);
  const range = maxV - minV || 1;
  const points = history
    .map((v, i) => {
      const x = (i / (history.length - 1)) * w;
      const y = h - ((v - minV) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="text-emerald-500 dark:text-emerald-400">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RegisterInspector(props: RegisterInspectorProps) {
  const { register, devices, history, liveValue, sourceStatus, running, onSave, onDuplicate, onDelete, onClose, onViewDevice } = props;

  const [tab, setTab] = useState<SubTab>("general");
  const [reg, setReg] = useState<PageRegister | null>(register);

  // Source-param editor state (mirrors SimRegisterModal's per-source fields).
  const [kind, setKind] = useState(GENERATOR_KINDS[0]);
  const [preset, setPreset] = useState(DEVICE_PRESETS[0]);
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(100);
  const [periodMs, setPeriodMs] = useState(1000);
  const [sourceUnitId, setSourceUnitId] = useState(1);
  const [sourceConnectionKind, setSourceConnectionKind] = useState("tcp");
  const [sourceFunctionCode, setSourceFunctionCode] = useState(3);
  const [sourceAddress, setSourceAddress] = useState(1);
  const [sourceScale, setSourceScale] = useState(1);
  const [sourceOffset, setSourceOffset] = useState(0);
  const [sourceByteOrder, setSourceByteOrder] = useState("");

  useEffect(() => {
    if (!register) {
      setReg(null);
      return;
    }
    setReg(register);
    setTab("general");
    const params = parseSourceParams(register.sourceParams);
    setKind(params.kind ?? GENERATOR_KINDS[0]);
    setPreset(params.preset ?? DEVICE_PRESETS[0]);
    setMin(params.min ?? 0);
    setMax(params.max ?? 100);
    setPeriodMs(params.periodMs ?? 1000);
    setSourceUnitId(params.slaveUnitId ?? 1);
    setSourceConnectionKind(params.connectionKind ?? "tcp");
    setSourceFunctionCode(params.functionCode ?? 3);
    setSourceAddress(params.address ?? 1);
    setSourceScale(params.scale ?? 1);
    setSourceOffset(params.offset ?? 0);
    // Empty string ⇒ "same as this register's byte order" (verbatim mirror).
    setSourceByteOrder(params.srcByteOrder ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register?.id]);

  if (!register || !reg) return null;

  const set = (patch: Partial<PageRegister>) => setReg((r) => (r ? { ...r, ...patch } : r));
  const device = devices.find((d) => d.id === reg.deviceInstanceId);

  // Mirror SimRegisterModal's constraints so the inspector can't produce a
  // dataType/byteOrder/valueSource combo the backend rejects. Bit banks are
  // bool-only; hold registers only support u16/i16; single-word types must
  // carry ABCD byte order.
  const isBit = reg.functionCode === 1 || reg.functionCode === 2;
  const isMultiWord = MULTI_WORD_TYPES.includes(reg.dataType);
  const dataTypeOptions = isBit
    ? ["bool"]
    : reg.valueSource === "hold"
      ? ["u16", "i16"]
      : ["u16", "i16", "u32", "i32", "f32", "u64", "i64", "f64"];
  const setDataType = (dataType: string) => {
    const patch: Partial<PageRegister> = { dataType };
    if (!MULTI_WORD_TYPES.includes(dataType)) patch.byteOrder = "ABCD";
    set(patch);
  };
  const handleValueSourceChange = (valueSource: string) => {
    if (valueSource === "hold") {
      const dataType = isBit ? "bool" : reg.dataType === "u16" || reg.dataType === "i16" ? reg.dataType : "u16";
      const patch: Partial<PageRegister> = { valueSource, dataType };
      if (!MULTI_WORD_TYPES.includes(dataType)) patch.byteOrder = "ABCD";
      set(patch);
    } else {
      set({ valueSource });
    }
  };

  const handleSave = () => {
    const sourceParams = JSON.stringify(
      reg.valueSource === "generator"
        ? { kind, min, max, periodMs }
        : reg.valueSource === "device"
        ? { preset, min, max, periodMs }
        : reg.valueSource === "route"
        ? {
            slaveUnitId: sourceUnitId,
            connectionKind: sourceConnectionKind,
            functionCode: sourceFunctionCode,
            address: sourceAddress,
            scale: sourceScale,
            offset: sourceOffset,
            // Only persist a source order when it differs from ABCD/blank so the
            // backend keeps its verbatim fast path by default.
            ...(sourceByteOrder ? { srcByteOrder: sourceByteOrder } : {}),
          }
        : {}
    );
    onSave({ ...reg, sourceParams });
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-white/5">
      {/* Header */}
      <div className="border-b border-slate-100 p-4 dark:border-slate-800">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-bold text-slate-900 dark:text-slate-100">{reg.alias}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Unit {reg.unitId} · {FC_LABEL[reg.functionCode] ?? reg.functionCode} · {reg.address}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
          >
            ×
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div role="tablist" aria-label="Register sections" className="flex items-center gap-1 border-b border-slate-100 px-4 dark:border-slate-800">
        {(["general", "source", "advanced"] as SubTab[]).map((t) => {
          const isActive = t === tab;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t)}
              className={`relative px-3 py-2 text-sm font-semibold capitalize transition ${
                isActive ? "text-emerald-800 dark:text-emerald-200" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {t}
              <span className={`absolute inset-x-0 -bottom-px h-0.5 rounded-full transition ${isActive ? "bg-emerald-500" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {tab === "general" && (
          <div className="grid grid-cols-2 gap-3">
            <label className={`col-span-2 ${LABEL_CLASS}`}>
              Alias
              <input value={reg.alias} onChange={(e) => set({ alias: e.target.value })} className={INPUT_CLASS} />
            </label>
            <label className={LABEL_CLASS}>
              Data Type
              <select aria-label="Data Type" value={reg.dataType} onChange={(e) => setDataType(e.target.value)} className={INPUT_CLASS} disabled={isBit}>
                {dataTypeOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Byte Order
              <select aria-label="Byte Order" value={reg.byteOrder} onChange={(e) => set({ byteOrder: e.target.value })} className={INPUT_CLASS} disabled={!isMultiWord}>
                {BYTE_ORDERS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Display Format
              <select
                aria-label="Display Format"
                value={reg.displayFormat ?? "raw"}
                onChange={(e) => set({ displayFormat: e.target.value })}
                className={INPUT_CLASS}
              >
                {DISPLAY_FORMATS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Unit
              <input aria-label="Unit" value={reg.unit ?? ""} onChange={(e) => set({ unit: e.target.value })} className={INPUT_CLASS} />
            </label>
            <label className={LABEL_CLASS}>
              Access
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {accessLabel(reg.functionCode)}
              </span>
            </label>
          </div>
        )}

        {tab === "source" && (
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL_CLASS}>
              Value source
              <select aria-label="Value source" value={reg.valueSource} onChange={(e) => handleValueSourceChange(e.target.value)} className={INPUT_CLASS}>
                <option value="hold">Hold</option>
                <option value="device">Device</option>
                <option value="generator">Generator</option>
                <option value="route">Route</option>
              </select>
            </label>

            {reg.valueSource === "hold" && (
              <label className={LABEL_CLASS}>
                Initial value
                <input type="number" value={reg.holdValue} onChange={(e) => set({ holdValue: Number(e.target.value) })} className={INPUT_CLASS} />
              </label>
            )}

            {reg.valueSource === "device" && (
              <label className={LABEL_CLASS}>
                Device preset
                <select aria-label="Device preset" value={preset} onChange={(e) => setPreset(e.target.value)} className={INPUT_CLASS}>
                  {DEVICE_PRESETS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
            )}

            {reg.valueSource === "generator" && (
              <label className={LABEL_CLASS}>
                Generator kind
                <select aria-label="Generator kind" value={kind} onChange={(e) => setKind(e.target.value)} className={INPUT_CLASS}>
                  {GENERATOR_KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </label>
            )}

            {reg.valueSource === "route" && (
              <>
                <label className={LABEL_CLASS}>
                  Source slave unit
                  <input
                    aria-label="Source slave unit"
                    type="number"
                    min={0}
                    max={255}
                    value={sourceUnitId}
                    onChange={(e) => setSourceUnitId(Number(e.target.value))}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Source connection
                  <select aria-label="Source connection" value={sourceConnectionKind} onChange={(e) => setSourceConnectionKind(e.target.value)} className={INPUT_CLASS}>
                    <option value="tcp">TCP</option>
                    <option value="serial">Serial</option>
                  </select>
                </label>
                <label className={LABEL_CLASS}>
                  Source function
                  <select
                    aria-label="Source function"
                    value={sourceFunctionCode}
                    onChange={(e) => setSourceFunctionCode(Number(e.target.value))}
                    className={INPUT_CLASS}
                  >
                    <option value={1}>Read Coils (0x01)</option>
                    <option value={2}>Read Discrete (0x02)</option>
                    <option value={3}>Read Holding (0x03)</option>
                    <option value={4}>Read Input (0x04)</option>
                  </select>
                </label>
                <label className={LABEL_CLASS}>
                  Source address
                  <input
                    aria-label="Source address"
                    type="number"
                    min={0}
                    max={65535}
                    value={sourceAddress}
                    onChange={(e) => setSourceAddress(Number(e.target.value))}
                    className={INPUT_CLASS}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className={LABEL_CLASS}>
                    Scale
                    <input
                      aria-label="Scale"
                      type="number"
                      step="any"
                      value={sourceScale}
                      onChange={(e) => setSourceScale(Number(e.target.value))}
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className={LABEL_CLASS}>
                    Offset
                    <input
                      aria-label="Offset"
                      type="number"
                      step="any"
                      value={sourceOffset}
                      onChange={(e) => setSourceOffset(Number(e.target.value))}
                      className={INPUT_CLASS}
                    />
                  </label>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Exposed value = source × scale + offset (e.g. scale 0.1, offset −40 turns a raw 700 into 30).
                </p>
                {isMultiWord ? (
                  <label className={LABEL_CLASS}>
                    Source byte order
                    <select
                      aria-label="Source byte order"
                      value={sourceByteOrder}
                      onChange={(e) => setSourceByteOrder(e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">Same as this register ({reg.byteOrder})</option>
                      {BYTE_ORDERS.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </>
            )}

            {(reg.valueSource === "device" || reg.valueSource === "generator") && (
              <>
                <label className={LABEL_CLASS}>
                  Min
                  <input aria-label="Min" type="number" value={min} onChange={(e) => setMin(Number(e.target.value))} className={INPUT_CLASS} />
                </label>
                <label className={LABEL_CLASS}>
                  Max
                  <input aria-label="Max" type="number" value={max} onChange={(e) => setMax(Number(e.target.value))} className={INPUT_CLASS} />
                </label>
                <label className={LABEL_CLASS}>
                  Period (ms)
                  <input aria-label="Period ms" type="number" value={periodMs} onChange={(e) => setPeriodMs(Number(e.target.value))} className={INPUT_CLASS} />
                </label>
              </>
            )}
          </div>
        )}

        {tab === "advanced" && (
          <div className="space-y-3">
            <label className={LABEL_CLASS}>
              Sort order
              <input
                aria-label="Sort order"
                type="number"
                value={reg.sortOrder}
                onChange={(e) => set({ sortOrder: Number(e.target.value) })}
                className={`${INPUT_CLASS} w-32`}
              />
            </label>
            <label className={LABEL_CLASS}>
              Raw source params
              <textarea
                aria-label="Raw source params"
                readOnly
                value={reg.sourceParams}
                className={`${INPUT_CLASS} h-24 font-mono text-xs`}
              />
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Device/Generator/Route edits apply on the next Start.
            </p>
          </div>
        )}

        {/* Live Value card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Live Value</span>
            {sourceStatus ? (
              <span className="inline-block rounded-full bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                {sourceStatus}
              </span>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100">{running ? liveValue : "—"}</span>
            <Sparkline history={history} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="space-y-2 border-t border-slate-100 p-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <div className="flex items-center justify-between">
          <span>
            Device: <span className="font-semibold text-slate-700 dark:text-slate-200">{device ? device.name : "—"}</span>
          </span>
          {device ? (
            <button
              type="button"
              onClick={() => onViewDevice(device.id)}
              className="rounded-full border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
            >
              View Device
            </button>
          ) : null}
        </div>
        <div>Value Source: {reg.valueSource}</div>
        <div>Interval: {reg.intervalMs} ms</div>
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-100 p-4 dark:border-slate-800">
        <button
          type="button"
          onClick={() => onDuplicate(reg)}
          className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => onDelete(reg.id)}
          className="rounded-full border border-rose-500/60 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-700 dark:text-rose-200"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-500/60 dark:text-emerald-200"
        >
          Save
        </button>
      </div>
    </div>
  );
}
