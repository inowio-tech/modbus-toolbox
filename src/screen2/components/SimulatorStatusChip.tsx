import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

type SimStatus = { running: boolean; clientCount: number };

export default function SimulatorStatusChip({ workspaceName }: { workspaceName: string }) {
  const [status, setStatus] = useState<SimStatus>({ running: false, clientCount: 0 });
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const st = await invoke<SimStatus>("simulator_status", { name: workspaceName });
        if (!cancelled && st) setStatus(st);
      } catch { /* ignore */ }
    };
    void tick();
    const id = window.setInterval(tick, 2000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [workspaceName]);

  if (!status.running) return null;

  return (
    <button
      type="button"
      onClick={() => navigate(`/app/${encodeURIComponent(workspaceName)}/tcp-simulator`)}
      className="inline-flex items-center gap-2 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-100"
      title="TCP Simulator is running"
    >
      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
      Sim · {status.clientCount} client(s)
    </button>
  );
}
