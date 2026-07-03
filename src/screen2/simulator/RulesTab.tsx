import type { SimRule } from "../components/SimRuleModal";
import type { SimDevice } from "./useSimulatorData";

const BANK_LABEL: Record<number, string> = { 1: "coil", 2: "discrete", 3: "holding", 4: "input" };
const bankLabel = (bank: number): string => BANK_LABEL[bank] ?? "reg";

type ActionRow = {
  type: string;
  bank: number;
  address: number;
  value?: number;
  by?: number;
  srcBank?: number;
  srcAddr?: number;
  min?: number;
  max?: number;
};

/** Human summary of a trigger's JSON, e.g. `holding[5] > 60`. */
export function ruleSummary(rule: SimRule): string {
  try {
    const t = JSON.parse(rule.trigger) as Record<string, unknown>;
    const bank = bankLabel(Number(t.bank));
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

/** Human summary of a rule's actions JSON, e.g. `Set holding[10]=1 · Inc holding[1] by 2`. */
export function actionsSummary(rule: SimRule): string {
  let rows: ActionRow[];
  try {
    const parsed = JSON.parse(rule.actions);
    if (!Array.isArray(parsed) || parsed.length === 0) return "—";
    rows = parsed;
  } catch {
    return "—";
  }
  return rows
    .map((a) => {
      const bank = bankLabel(Number(a.bank));
      switch (a.type) {
        case "set":
          return `Set ${bank}[${a.address}]=${a.value}`;
        case "inc":
          return `Inc ${bank}[${a.address}] by ${a.by}`;
        case "dec":
          return `Dec ${bank}[${a.address}] by ${a.by}`;
        case "toggle":
          return `Toggle ${bank}[${a.address}]`;
        case "copy":
          return `Copy ${bankLabel(Number(a.srcBank))}[${a.srcAddr}]→${bank}[${a.address}]`;
        case "randomize":
          return `Randomize ${bank}[${a.address}] ${a.min}..${a.max}`;
        default:
          return String(a.type ?? "unknown action");
      }
    })
    .join(" · ");
}

/** Best-effort scope resolution: does the trigger target a unit that maps to a known device? */
function ruleScope(rule: SimRule, devices: SimDevice[]): string {
  try {
    const t = JSON.parse(rule.trigger) as Record<string, unknown>;
    const unit = Number(t.unit);
    if (!Number.isFinite(unit)) return "—";
    const device = devices.find((d) => d.unitId === unit);
    return device?.name ?? "—";
  } catch {
    return "—";
  }
}

export default function RulesTab(props: {
  rules: SimRule[];
  devices: SimDevice[];
  onAdd: () => void;
  onEdit: (rule: SimRule) => void;
  onToggle: (rule: SimRule, enabled: boolean) => void;
  onDelete: (id: number) => void;
}) {
  const { rules, devices, onAdd, onEdit, onToggle, onDelete } = props;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-white/5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Rules</h2>
        <button
          type="button"
          className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
          onClick={onAdd}
        >
          + Add Rule
        </button>
      </div>

      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Rules apply on next Start.</p>

      {rules.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">No rules yet. Click "Add Rule".</p>
      ) : (
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="py-1">Name</th>
              <th>Scope</th>
              <th>Trigger</th>
              <th>Actions</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 truncate">{rule.name}</td>
                <td className="truncate text-xs">{ruleScope(rule, devices)}</td>
                <td className="font-mono text-xs">{ruleSummary(rule)}</td>
                <td className="truncate font-mono text-xs">{actionsSummary(rule)}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={rule.name}
                    checked={rule.enabled}
                    onChange={(e) => onToggle(rule, e.target.checked)}
                  />
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    className="mr-2 text-emerald-700 dark:text-emerald-300"
                    onClick={() => onEdit(rule)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-rose-600 dark:text-rose-300"
                    onClick={() => onDelete(rule.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
