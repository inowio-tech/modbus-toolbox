import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ActivityTab from "./ActivityTab";
import type { SimStatus } from "./useSimulatorData";

const runningStatus: SimStatus = {
  running: true,
  listen: { bound: "0.0.0.0:502", port: 502, addresses: ["127.0.0.1:502"] },
  clientCount: 1,
  startedAtMs: Date.now() - 65_000,
  clients: [{ id: 1, addr: "127.0.0.1:51000", connectedAtMs: Date.now() - 30_000 }],
};

describe("ActivityTab", () => {
  it("renders uptime, the client row, and events", () => {
    const events = [
      { atMs: Date.now() - 66_000, kind: "started", detail: "0.0.0.0:502" },
      { atMs: Date.now() - 30_000, kind: "clientConnected", detail: "127.0.0.1:51000" },
    ];
    render(<ActivityTab status={runningStatus} events={events} />);
    // uptime + client duration both render as m:ss counters
    expect(screen.getAllByText(/^\d+:\d{2}$/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Uptime")).toBeInTheDocument();
    // client address appears (in the clients table and the event detail)
    expect(screen.getAllByText("127.0.0.1:51000").length).toBeGreaterThanOrEqual(1);
    // event log shows the Started badge
    expect(screen.getByText(/started/i)).toBeInTheDocument();
  });

  it("shows stopped/empty state when not running", () => {
    const stopped: SimStatus = { running: false, listen: null, clientCount: 0, startedAtMs: null, clients: [] };
    render(<ActivityTab status={stopped} events={[]} />);
    expect(screen.getByText(/simulator is stopped/i)).toBeInTheDocument();
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
  });
});
