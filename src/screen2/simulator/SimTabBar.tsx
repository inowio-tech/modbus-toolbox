export type TabKey = "registers" | "devices" | "rules" | "live" | "activity";

type Props = {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  counts?: Partial<Record<TabKey, number>>;
};

const TABS: { key: TabKey; label: string }[] = [
  { key: "registers", label: "Registers" },
  { key: "devices", label: "Devices" },
  { key: "rules", label: "Rules" },
  { key: "live", label: "Live Values" },
  { key: "activity", label: "Activity" },
];

export default function SimTabBar({ active, onChange, counts }: Props) {
  return (
    <div role="tablist" aria-label="Simulator sections" className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800">
      {TABS.map((t) => {
        const isActive = t.key === active;
        const count = counts?.[t.key];
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`relative flex items-center gap-1.5 px-3 py-2 text-sm font-semibold transition ${
              isActive
                ? "text-emerald-800 dark:text-emerald-200"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
            onClick={() => onChange(t.key)}
          >
            {t.label}
            {count !== undefined ? (
              <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                {count}
              </span>
            ) : null}
            <span
              className={`absolute inset-x-0 -bottom-px h-0.5 rounded-full transition ${
                isActive ? "bg-emerald-500" : "bg-transparent"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
