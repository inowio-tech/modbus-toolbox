import { useEffect, useState } from "react";

export type SimRegister = {
  id: number;
  unitId: number;
  functionCode: number;
  address: number;
  alias: string;
  dataType: string;
  holdValue: number;
  sortOrder: number;
  valueSource: string;
  byteOrder: string;
  sourceParams: string;
  intervalMs: number;
  unit?: string | null;
  displayFormat?: string | null;
};

const EMPTY: SimRegister = {
  id: 0,
  unitId: 1,
  functionCode: 3,
  address: 1,
  alias: "",
  dataType: "u16",
  holdValue: 0,
  sortOrder: 0,
  valueSource: "hold",
  byteOrder: "ABCD",
  sourceParams: "{}",
  intervalMs: 1000,
  unit: null,
  displayFormat: null,
};

const DEVICE_PRESETS = ["temperature", "humidity", "pressure", "flow", "vibration", "analog", "discrete", "counter"];
const GENERATOR_KINDS = ["sine", "ramp", "random", "toggle"];
const MULTI_WORD_TYPES = ["u32", "i32", "f32"];

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

export default function SimRegisterModal(props: {
  open: boolean;
  initial: SimRegister | null;
  onClose: () => void;
  onSubmit: (reg: SimRegister) => void | Promise<void>;
}) {
  const [reg, setReg] = useState<SimRegister>(EMPTY);
  const [kind, setKind] = useState(GENERATOR_KINDS[0]);
  const [preset, setPreset] = useState(DEVICE_PRESETS[0]);
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(100);
  const [periodMs, setPeriodMs] = useState(1000);
  const [sourceUnitId, setSourceUnitId] = useState(1);
  const [sourceConnectionKind, setSourceConnectionKind] = useState("tcp");
  const [sourceFunctionCode, setSourceFunctionCode] = useState(3);
  const [sourceAddress, setSourceAddress] = useState(1);

  useEffect(() => {
    if (!props.open) return;
    const next = props.initial ?? EMPTY;
    setReg(next);
    const params = parseSourceParams(next.sourceParams);
    setKind(params.kind ?? GENERATOR_KINDS[0]);
    setPreset(params.preset ?? DEVICE_PRESETS[0]);
    setMin(params.min ?? 0);
    setMax(params.max ?? 100);
    setPeriodMs(params.periodMs ?? 1000);
    setSourceUnitId(params.slaveUnitId ?? 1);
    setSourceConnectionKind(params.connectionKind ?? "tcp");
    setSourceFunctionCode(params.functionCode ?? 3);
    setSourceAddress(params.address ?? 1);
  }, [props.open, props.initial]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); props.onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  const isBit = reg.functionCode === 1 || reg.functionCode === 2;
  const set = (patch: Partial<SimRegister>) => setReg((r) => ({ ...r, ...patch }));
  const isMultiWord = MULTI_WORD_TYPES.includes(reg.dataType);

  // Sets dataType and, whenever the resulting type is single-word, resets
  // byteOrder to "ABCD" so a stale CDAB/DCBA value can't survive behind a
  // hidden Byte-order control (the backend rejects it with no way to fix it).
  const setDataType = (dataType: string, extra: Partial<SimRegister> = {}) => {
    const patch: Partial<SimRegister> = { ...extra, dataType };
    if (!MULTI_WORD_TYPES.includes(dataType)) patch.byteOrder = "ABCD";
    set(patch);
  };

  const handleValueSourceChange = (valueSource: string) => {
    if (valueSource === "hold") {
      const dataType = isBit ? "bool" : (reg.dataType === "u16" || reg.dataType === "i16" ? reg.dataType : "u16");
      setDataType(dataType, { valueSource });
    } else {
      set({ valueSource });
    }
  };

  const handleFunctionCodeChange = (functionCode: number) => {
    const bit = functionCode === 1 || functionCode === 2;
    const extra: Partial<SimRegister> = { functionCode };
    if (bit && (reg.valueSource === "device" || reg.valueSource === "generator" || reg.valueSource === "route")) {
      extra.valueSource = "hold";
    }
    setDataType(bit ? "bool" : "u16", extra);
  };

  const handleSubmit = () => {
    const sourceParams = JSON.stringify(
      reg.valueSource === "generator"
        ? { kind, min, max, periodMs }
        : reg.valueSource === "device"
        ? { preset, min, max, periodMs }
        : reg.valueSource === "route"
        ? { slaveUnitId: sourceUnitId, connectionKind: sourceConnectionKind, functionCode: sourceFunctionCode, address: sourceAddress }
        : {}
    );
    void props.onSubmit({ ...reg, sourceParams });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="sim-reg-title"
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <div id="sim-reg-title" className="mb-4 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          {reg.id ? "Edit register" : "Add register"}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs">Unit ID
            <input type="number" min={0} max={255} value={reg.unitId}
              onChange={(e) => set({ unitId: Number(e.target.value) })}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <label className="flex flex-col gap-1 text-xs">Register type
            <select value={reg.functionCode} onChange={(e) => handleFunctionCodeChange(Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
              <option value={1}>Coil (0x01)</option>
              <option value={2}>Discrete input (0x02)</option>
              <option value={3}>Holding (0x03)</option>
              <option value={4}>Input (0x04)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">Address
            <input aria-label="Address" type="number" min={0} max={65535} value={reg.address}
              onChange={(e) => set({ address: Number(e.target.value) })}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <label className="flex flex-col gap-1 text-xs">Data type
            <select aria-label="Data type" value={reg.dataType} onChange={(e) => setDataType(e.target.value)} disabled={isBit}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
              {isBit ? (
                <option value="bool">bool</option>
              ) : reg.valueSource === "hold" ? (
                <>
                  <option value="u16">u16</option>
                  <option value="i16">i16</option>
                </>
              ) : (
                <>
                  <option value="u16">u16</option>
                  <option value="i16">i16</option>
                  <option value="u32">u32</option>
                  <option value="i32">i32</option>
                  <option value="f32">f32</option>
                </>
              )}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs">Alias
            <input value={reg.alias} onChange={(e) => set({ alias: e.target.value })}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
          </label>

          <label className="flex flex-col gap-1 text-xs">Value source
            <select aria-label="Value source" value={reg.valueSource} onChange={(e) => handleValueSourceChange(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
              <option value="hold">Hold</option>
              <option value="device" disabled={isBit}>Device</option>
              <option value="generator" disabled={isBit}>Generator</option>
              <option value="route" disabled={isBit}>Route</option>
            </select>
          </label>

          {reg.valueSource === "hold" && (
            <label className="flex flex-col gap-1 text-xs">Initial value
              <input type="number" value={reg.holdValue} onChange={(e) => set({ holdValue: Number(e.target.value) })}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
            </label>
          )}

          {reg.valueSource === "device" && (
            <label className="flex flex-col gap-1 text-xs">Device preset
              <select aria-label="Device preset" value={preset} onChange={(e) => setPreset(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                {DEVICE_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          )}

          {reg.valueSource === "generator" && (
            <label className="flex flex-col gap-1 text-xs">Generator kind
              <select aria-label="Generator kind" value={kind} onChange={(e) => setKind(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                {GENERATOR_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
          )}

          {reg.valueSource === "route" && (
            <>
              <label className="flex flex-col gap-1 text-xs">Source slave unit
                <input aria-label="Source slave unit" type="number" min={0} max={255} value={sourceUnitId}
                  onChange={(e) => setSourceUnitId(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
              </label>
              <label className="flex flex-col gap-1 text-xs">Source connection
                <select aria-label="Source connection" value={sourceConnectionKind} onChange={(e) => setSourceConnectionKind(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                  <option value="tcp">TCP</option>
                  <option value="serial">Serial</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">Source function
                <select aria-label="Source function" value={sourceFunctionCode} onChange={(e) => setSourceFunctionCode(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                  <option value={1}>Read Coils (0x01)</option>
                  <option value={2}>Read Discrete (0x02)</option>
                  <option value={3}>Read Holding (0x03)</option>
                  <option value={4}>Read Input (0x04)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">Source address
                <input aria-label="Source address" type="number" min={0} max={65535} value={sourceAddress}
                  onChange={(e) => setSourceAddress(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
              </label>
            </>
          )}

          {(reg.valueSource === "device" || reg.valueSource === "generator") && (
            <>
              <label className="flex flex-col gap-1 text-xs">Min
                <input aria-label="Min" type="number" value={min} onChange={(e) => setMin(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
              </label>
              <label className="flex flex-col gap-1 text-xs">Max
                <input aria-label="Max" type="number" value={max} onChange={(e) => setMax(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
              </label>
              <label className="flex flex-col gap-1 text-xs">Period (ms)
                <input aria-label="Period ms" type="number" value={periodMs} onChange={(e) => setPeriodMs(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
              </label>
            </>
          )}

          {isMultiWord && (
            <label className="flex flex-col gap-1 text-xs">Byte order
              <select aria-label="Byte order" value={reg.byteOrder} onChange={(e) => set({ byteOrder: e.target.value })}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                <option value="ABCD">ABCD</option>
                <option value="BADC">BADC</option>
                <option value="CDAB">CDAB</option>
                <option value="DCBA">DCBA</option>
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs">Interval (ms)
            <input aria-label="Interval ms" type="number" min={0} value={reg.intervalMs}
              onChange={(e) => set({ intervalMs: Number(e.target.value) })}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={props.onClose}
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100">Cancel</button>
          <button type="button" onClick={handleSubmit}
            className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-500/60 dark:text-emerald-200">Save</button>
        </div>
      </div>
    </div>
  );
}
