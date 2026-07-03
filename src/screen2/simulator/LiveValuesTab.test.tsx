import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import LiveValuesTab from "./LiveValuesTab";

const reg = (o: any = {}) => ({
  id: 1,
  unitId: 1,
  functionCode: 3,
  address: 5,
  alias: "Temp",
  dataType: "u16",
  holdValue: 0,
  sortOrder: 0,
  valueSource: "hold",
  byteOrder: "ABCD",
  sourceParams: "{}",
  intervalMs: 1000,
  deviceInstanceId: null,
  ...o,
});

describe("LiveValuesTab", () => {
  it("shows placeholder when stopped", () => {
    render(
      <LiveValuesTab
        registers={[]}
        snapshotFor={() => undefined}
        status={{ running: false, listen: null, clientCount: 0 }}
      />
    );
    expect(screen.getByText(/start the server/i)).toBeInTheDocument();
  });

  it("renders a row per register with live word value when running", () => {
    render(
      <LiveValuesTab
        registers={[reg()]}
        snapshotFor={() => ({ unitId: 1, functionCode: 3, address: 5, valueWord: 42, valueBit: null, sourceStatus: "ok" })}
        status={{ running: true, listen: { bound: "0.0.0.0", port: 502, addresses: ["127.0.0.1:502"] }, clientCount: 1 }}
      />
    );
    expect(screen.getByText("Temp")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(/ok/i)).toBeInTheDocument();
  });

  it("renders ON/OFF for bit values and — for missing snapshot", () => {
    render(
      <LiveValuesTab
        registers={[reg({ id: 2, alias: "Coil", functionCode: 1 }), reg({ id: 3, alias: "NoData", address: 9 })]}
        snapshotFor={(u, fc, a) =>
          fc === 1 ? { unitId: u, functionCode: fc, address: a, valueWord: null, valueBit: true, sourceStatus: "stale" } : undefined
        }
        status={{ running: true, listen: null, clientCount: 0 }}
      />
    );
    expect(screen.getByText("ON")).toBeInTheDocument();
    expect(screen.getByText(/stale/i)).toBeInTheDocument();
    expect(screen.getByText("NoData")).toBeInTheDocument();
  });
});
