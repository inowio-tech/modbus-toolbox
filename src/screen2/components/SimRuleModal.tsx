import { useEffect, useState } from "react";
import { RiCloseLine } from "react-icons/ri";

export type SimRule = {
  id: number;
  name: string;
  enabled: boolean;
  trigger: string;
  actions: string;
  sortOrder: number;
};

type TriggerForm = {
  type: string;
  ms: number;
  unit: number;
  bank: number;
  address: number;
  op: string;
  value: number;
};

type ActionRow = {
  type: string;
  unit: number;
  bank: number;
  address: number;
  value: number;
  by: number;
  srcUnit: number;
  srcBank: number;
  srcAddr: number;
  scale: number;
  offset: number;
  min: number;
  max: number;
  delayMs: number;
  dataType: string;
  byteOrder: string;
};

const ACTION_TYPES = ["u16", "i16", "u32", "i32", "f32", "u64", "i64", "f64"];
const BYTE_ORDERS = ["ABCD", "BADC", "CDAB", "DCBA"];
const MULTI_WORD = new Set(["u32", "i32", "f32", "u64", "i64", "f64"]);

const EMPTY_RULE: SimRule = {
  id: 0,
  name: "",
  enabled: true,
  trigger: "",
  actions: "",
  sortOrder: 0,
};

const DEFAULT_TRIGGER: TriggerForm = {
  type: "interval",
  ms: 1000,
  unit: 1,
  bank: 3,
  address: 0,
  op: "==",
  value: 0,
};

const DEFAULT_ACTION: ActionRow = {
  type: "set",
  unit: 1,
  bank: 3,
  address: 0,
  value: 0,
  by: 1,
  srcUnit: 1,
  srcBank: 3,
  srcAddr: 0,
  scale: 1,
  offset: 0,
  min: 0,
  max: 100,
  delayMs: 0,
  dataType: "u16",
  byteOrder: "ABCD",
};

const BANKS = [
  { value: 1, label: "Coils (1)" },
  { value: 2, label: "Discrete input (2)" },
  { value: 3, label: "Holding (3)" },
  { value: 4, label: "Input (4)" },
];

// The backend only emits write events for coil and holding writes (a client
// cannot write discrete inputs or input registers), so an onWrite trigger on
// bank 2/4 could never fire — restrict its bank options accordingly.
const WRITABLE_BANKS = BANKS.filter((b) => b.value === 1 || b.value === 3);

function parseTrigger(raw: string | undefined): TriggerForm {
  if (!raw) return { ...DEFAULT_TRIGGER };
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_TRIGGER };
    return {
      type: parsed.type ?? DEFAULT_TRIGGER.type,
      ms: parsed.ms ?? DEFAULT_TRIGGER.ms,
      unit: parsed.unit ?? DEFAULT_TRIGGER.unit,
      bank: parsed.bank ?? DEFAULT_TRIGGER.bank,
      address: parsed.address ?? DEFAULT_TRIGGER.address,
      op: parsed.op ?? DEFAULT_TRIGGER.op,
      value: parsed.value ?? DEFAULT_TRIGGER.value,
    };
  } catch {
    return { ...DEFAULT_TRIGGER };
  }
}

function parseActions(raw: string | undefined): ActionRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((a) => ({
      type: a.type ?? DEFAULT_ACTION.type,
      unit: a.unit ?? DEFAULT_ACTION.unit,
      bank: a.bank ?? DEFAULT_ACTION.bank,
      address: a.address ?? DEFAULT_ACTION.address,
      value: a.value ?? DEFAULT_ACTION.value,
      by: a.by ?? DEFAULT_ACTION.by,
      srcUnit: a.srcUnit ?? DEFAULT_ACTION.srcUnit,
      srcBank: a.srcBank ?? DEFAULT_ACTION.srcBank,
      srcAddr: a.srcAddr ?? DEFAULT_ACTION.srcAddr,
      scale: a.scale ?? DEFAULT_ACTION.scale,
      offset: a.offset ?? DEFAULT_ACTION.offset,
      min: a.min ?? DEFAULT_ACTION.min,
      max: a.max ?? DEFAULT_ACTION.max,
      delayMs: a.delayMs ?? DEFAULT_ACTION.delayMs,
      dataType: a.dataType ?? DEFAULT_ACTION.dataType,
      byteOrder: a.byteOrder ?? DEFAULT_ACTION.byteOrder,
    }));
  } catch {
    return [];
  }
}

function buildTriggerJson(t: TriggerForm): string {
  if (t.type === "interval") {
    return JSON.stringify({ type: "interval", ms: t.ms });
  }
  if (t.type === "condition") {
    return JSON.stringify({ type: "condition", unit: t.unit, bank: t.bank, address: t.address, op: t.op, value: t.value });
  }
  return JSON.stringify({ type: "onWrite", unit: t.unit, bank: t.bank, address: t.address });
}

// Multi-word width applies to word banks (holding/input) for value-producing
// actions; toggle and bit banks are always single-word.
function typeApplies(a: ActionRow): boolean {
  return a.type !== "toggle" && (a.bank === 3 || a.bank === 4);
}

function buildActionJson(a: ActionRow): Record<string, unknown> {
  const base: Record<string, unknown> = { type: a.type, unit: a.unit, bank: a.bank, address: a.address };
  // Only persist a delay/width when non-default, keeping stored JSON minimal.
  if (a.delayMs > 0) base.delayMs = a.delayMs;
  if (typeApplies(a) && a.dataType !== "u16") {
    base.dataType = a.dataType;
    if (MULTI_WORD.has(a.dataType)) base.byteOrder = a.byteOrder;
  }
  switch (a.type) {
    case "set":
      return { ...base, value: a.value };
    case "inc":
    case "dec":
      return { ...base, by: a.by };
    case "toggle":
      return { ...base };
    case "copy":
      return { ...base, srcUnit: a.srcUnit, srcBank: a.srcBank, srcAddr: a.srcAddr, scale: a.scale, offset: a.offset };
    case "randomize":
      return { ...base, min: a.min, max: a.max };
    default:
      return base;
  }
}

const inputCls =
  "rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900";

export default function SimRuleModal(props: {
  open: boolean;
  initial: SimRule | null;
  onClose: () => void;
  onSubmit: (rule: SimRule) => void | Promise<void>;
}) {
  const [rule, setRule] = useState<SimRule>(EMPTY_RULE);
  const [trigger, setTrigger] = useState<TriggerForm>(DEFAULT_TRIGGER);
  const [actions, setActions] = useState<ActionRow[]>([]);

  useEffect(() => {
    if (!props.open) return;
    const next = props.initial ?? EMPTY_RULE;
    setRule(next);
    setTrigger(parseTrigger(next.trigger));
    setActions(parseActions(next.actions));
  }, [props.open, props.initial]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  const set = (patch: Partial<SimRule>) => setRule((r) => ({ ...r, ...patch }));
  const setTriggerField = (patch: Partial<TriggerForm>) => setTrigger((t) => ({ ...t, ...patch }));

  const addAction = () => setActions((rows) => [...rows, { ...DEFAULT_ACTION }]);
  const removeAction = (idx: number) => setActions((rows) => rows.filter((_, i) => i !== idx));
  const updateAction = (idx: number, patch: Partial<ActionRow>) =>
    setActions((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  const handleSubmit = () => {
    const triggerJson = buildTriggerJson(trigger);
    const actionsJson = JSON.stringify(actions.map(buildActionJson));
    void props.onSubmit({ ...rule, trigger: triggerJson, actions: actionsJson });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sim-rule-title"
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <div id="sim-rule-title" className="min-w-0 truncate text-sm font-semibold text-emerald-700 dark:text-emerald-200">
            {rule.id ? "Edit rule" : "Add rule"}
          </div>
          <button type="button" onClick={props.onClose} title="Close"
            className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500">
            <RiCloseLine className="h-4 w-3" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs">
            Rule name
            <input
              aria-label="Rule name"
              value={rule.name}
              onChange={(e) => set({ name: e.target.value })}
              className={inputCls}
            />
          </label>

          <label className="flex flex-row items-center gap-2 text-xs">
            <input
              type="checkbox"
              aria-label="Enabled"
              checked={rule.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
            Enabled
          </label>

          <label className="flex flex-col gap-1 text-xs">
            Trigger type
            <select
              aria-label="Trigger type"
              value={trigger.type}
              onChange={(e) => setTriggerField({ type: e.target.value })}
              className={inputCls}
            >
              <option value="interval">interval</option>
              <option value="condition">condition</option>
              <option value="onWrite">onWrite</option>
            </select>
          </label>

          {trigger.type === "interval" && (
            <label className="flex flex-col gap-1 text-xs">
              Interval (ms)
              <input
                aria-label="Trigger interval ms"
                type="number"
                min={0}
                value={trigger.ms}
                onChange={(e) => setTriggerField({ ms: Number(e.target.value) })}
                className={inputCls}
              />
            </label>
          )}

          {(trigger.type === "condition" || trigger.type === "onWrite") && (
            <>
              <label className="flex flex-col gap-1 text-xs">
                Unit
                <input
                  aria-label="Trigger unit"
                  type="number"
                  min={0}
                  max={255}
                  value={trigger.unit}
                  onChange={(e) => setTriggerField({ unit: Number(e.target.value) })}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Bank
                <select
                  aria-label="Trigger bank"
                  value={trigger.bank}
                  onChange={(e) => setTriggerField({ bank: Number(e.target.value) })}
                  className={inputCls}
                >
                  {(trigger.type === "onWrite" ? WRITABLE_BANKS : BANKS).map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Address
                <input
                  aria-label="Trigger address"
                  type="number"
                  min={0}
                  max={65535}
                  value={trigger.address}
                  onChange={(e) => setTriggerField({ address: Number(e.target.value) })}
                  className={inputCls}
                />
              </label>
            </>
          )}

          {trigger.type === "condition" && (
            <>
              <label className="flex flex-col gap-1 text-xs">
                Op
                <select
                  aria-label="Trigger op"
                  value={trigger.op}
                  onChange={(e) => setTriggerField({ op: e.target.value })}
                  className={inputCls}
                >
                  <option value="==">==</option>
                  <option value="!=">!=</option>
                  <option value="<">&lt;</option>
                  <option value=">">&gt;</option>
                  <option value=">=">&gt;=</option>
                  <option value="<=">&lt;=</option>
                  <option value="changed">changed</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Value
                <input
                  aria-label="Trigger value"
                  type="number"
                  value={trigger.value}
                  onChange={(e) => setTriggerField({ value: Number(e.target.value) })}
                  className={inputCls}
                />
              </label>
            </>
          )}
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Actions</div>
            <button
              type="button"
              name="Add action"
              onClick={addAction}
              className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-500/60 dark:text-emerald-200"
            >
              Add action
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {actions.map((action, idx) => (
              <div
                key={idx}
                className="grid grid-cols-6 items-end gap-2 rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700"
              >
                <label className="flex flex-col gap-1">
                  Type
                  <select
                    aria-label={`Action type ${idx}`}
                    value={action.type}
                    onChange={(e) => updateAction(idx, { type: e.target.value })}
                    className={inputCls}
                  >
                    <option value="set">set</option>
                    <option value="inc">inc</option>
                    <option value="dec">dec</option>
                    <option value="toggle">toggle</option>
                    <option value="copy">copy</option>
                    <option value="randomize">randomize</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  Unit
                  <input
                    aria-label={`Action unit ${idx}`}
                    type="number"
                    min={0}
                    max={255}
                    value={action.unit}
                    onChange={(e) => updateAction(idx, { unit: Number(e.target.value) })}
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Bank
                  <select
                    aria-label={`Action bank ${idx}`}
                    value={action.bank}
                    onChange={(e) => updateAction(idx, { bank: Number(e.target.value) })}
                    className={inputCls}
                  >
                    {BANKS.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  Address
                  <input
                    aria-label={`Action address ${idx}`}
                    type="number"
                    min={0}
                    max={65535}
                    value={action.address}
                    onChange={(e) => updateAction(idx, { address: Number(e.target.value) })}
                    className={inputCls}
                  />
                </label>

                {action.type === "set" && (
                  <label className="flex flex-col gap-1">
                    Value
                    <input
                      aria-label={`Action value ${idx}`}
                      type="number"
                      value={action.value}
                      onChange={(e) => updateAction(idx, { value: Number(e.target.value) })}
                      className={inputCls}
                    />
                  </label>
                )}

                {(action.type === "inc" || action.type === "dec") && (
                  <label className="flex flex-col gap-1">
                    By
                    <input
                      aria-label={`Action by ${idx}`}
                      type="number"
                      value={action.by}
                      onChange={(e) => updateAction(idx, { by: Number(e.target.value) })}
                      className={inputCls}
                    />
                  </label>
                )}

                {action.type === "copy" && (
                  <>
                    <label className="flex flex-col gap-1">
                      Src unit
                      <input
                        aria-label={`Action src unit ${idx}`}
                        type="number"
                        min={0}
                        max={255}
                        value={action.srcUnit}
                        onChange={(e) => updateAction(idx, { srcUnit: Number(e.target.value) })}
                        className={inputCls}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      Src bank
                      <select
                        aria-label={`Action src bank ${idx}`}
                        value={action.srcBank}
                        onChange={(e) => updateAction(idx, { srcBank: Number(e.target.value) })}
                        className={inputCls}
                      >
                        {BANKS.map((b) => (
                          <option key={b.value} value={b.value}>
                            {b.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      Src address
                      <input
                        aria-label={`Action src address ${idx}`}
                        type="number"
                        min={0}
                        max={65535}
                        value={action.srcAddr}
                        onChange={(e) => updateAction(idx, { srcAddr: Number(e.target.value) })}
                        className={inputCls}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      Scale
                      <input
                        aria-label={`Action scale ${idx}`}
                        type="number"
                        value={action.scale}
                        onChange={(e) => updateAction(idx, { scale: Number(e.target.value) })}
                        className={inputCls}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      Offset
                      <input
                        aria-label={`Action offset ${idx}`}
                        type="number"
                        value={action.offset}
                        onChange={(e) => updateAction(idx, { offset: Number(e.target.value) })}
                        className={inputCls}
                      />
                    </label>
                  </>
                )}

                {action.type === "randomize" && (
                  <>
                    <label className="flex flex-col gap-1">
                      Min
                      <input
                        aria-label={`Action min ${idx}`}
                        type="number"
                        value={action.min}
                        onChange={(e) => updateAction(idx, { min: Number(e.target.value) })}
                        className={inputCls}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      Max
                      <input
                        aria-label={`Action max ${idx}`}
                        type="number"
                        value={action.max}
                        onChange={(e) => updateAction(idx, { max: Number(e.target.value) })}
                        className={inputCls}
                      />
                    </label>
                  </>
                )}

                <label className="flex flex-col gap-1">
                  Delay (ms)
                  <input
                    aria-label={`Action delay ${idx}`}
                    type="number"
                    min={0}
                    value={action.delayMs}
                    onChange={(e) => updateAction(idx, { delayMs: Math.max(0, Number(e.target.value)) })}
                    className={inputCls}
                  />
                </label>

                {typeApplies(action) && (
                  <label className="flex flex-col gap-1">
                    Target type
                    <select
                      aria-label={`Action data type ${idx}`}
                      value={action.dataType}
                      onChange={(e) => updateAction(idx, { dataType: e.target.value })}
                      className={inputCls}
                    >
                      {ACTION_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                )}

                {typeApplies(action) && MULTI_WORD.has(action.dataType) && (
                  <label className="flex flex-col gap-1">
                    Byte order
                    <select
                      aria-label={`Action byte order ${idx}`}
                      value={action.byteOrder}
                      onChange={(e) => updateAction(idx, { byteOrder: e.target.value })}
                      className={inputCls}
                    >
                      {BYTE_ORDERS.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </label>
                )}

                <button
                  type="button"
                  aria-label={`Remove action ${idx}`}
                  onClick={() => removeAction(idx)}
                  className="justify-self-start rounded-full border border-rose-500/60 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-700 dark:border-rose-500/60 dark:text-rose-300"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-500/60 dark:text-emerald-200"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
