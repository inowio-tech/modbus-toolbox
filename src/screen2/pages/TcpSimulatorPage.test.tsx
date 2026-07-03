import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const listenMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listenMock(...a) }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useOutletContext: () => ({ workspace: { name: "WS1" } }) };
});

import TcpSimulatorPage from "./TcpSimulatorPage";

describe("TcpSimulatorPage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    window.localStorage.clear();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_get_config") return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      if (cmd === "simulator_list_registers") return Promise.resolve([]);
      if (cmd === "simulator_list_rules") return Promise.resolve([]);
      if (cmd === "simulator_status") return Promise.resolve({ running: false, listen: null, clientCount: 0 });
      return Promise.resolve(null);
    });
    listenMock.mockResolvedValue(() => {});
  });

  it("loads config and shows the Start control when stopped", async () => {
    render(<TcpSimulatorPage />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("simulator_get_config", { name: "WS1" }));
    expect(await screen.findByRole("button", { name: /start/i })).toBeTruthy();
  });

  it("loads rules on mount and shows the Add Rule button", async () => {
    render(<TcpSimulatorPage />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("simulator_list_rules", { name: "WS1" }));
    expect(await screen.findByRole("button", { name: /add rule/i })).toBeTruthy();
  });

  it("subscribes to the simulator_values event for live values", async () => {
    render(<TcpSimulatorPage />);
    await waitFor(() => expect(listenMock).toHaveBeenCalledWith("simulator_values", expect.any(Function)));
  });

  it("groups registers by device and shows a per-device Delete control", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_get_config") return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      if (cmd === "simulator_list_devices") {
        return Promise.resolve([
          { id: 1, templateKey: "temp-humidity", name: "Roof Sensor", unitId: 1, baseAddress: 100, enabled: true, sortOrder: 0 },
        ]);
      }
      if (cmd === "simulator_list_registers") {
        return Promise.resolve([
          { id: 1, unitId: 1, functionCode: 3, address: 100, alias: "temp", dataType: "u16", holdValue: 0, sortOrder: 0, valueSource: "hold", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000, deviceInstanceId: 1 },
          { id: 2, unitId: 1, functionCode: 3, address: 101, alias: "humidity", dataType: "u16", holdValue: 0, sortOrder: 1, valueSource: "hold", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000, deviceInstanceId: 1 },
        ]);
      }
      if (cmd === "simulator_list_rules") return Promise.resolve([]);
      if (cmd === "simulator_status") return Promise.resolve({ running: false, listen: null, clientCount: 0 });
      return Promise.resolve(null);
    });

    render(<TcpSimulatorPage />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("simulator_list_devices", { name: "WS1" }));

    expect(await screen.findByText("Roof Sensor")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /delete device/i })).toBeTruthy();
  });

  it("shows a stale source-status badge for a route register", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_get_config") return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      if (cmd === "simulator_list_registers") {
        return Promise.resolve([
          { id: 1, unitId: 1, functionCode: 3, address: 0, alias: "route-reg", dataType: "u16", holdValue: 0, sortOrder: 0, valueSource: "route", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000 },
        ]);
      }
      if (cmd === "simulator_list_rules") return Promise.resolve([]);
      if (cmd === "simulator_status") return Promise.resolve({ running: true, listen: { bound: "0.0.0.0:502", port: 502, addresses: ["127.0.0.1:502"] }, clientCount: 0 });
      return Promise.resolve(null);
    });

    render(<TcpSimulatorPage />);
    await waitFor(() => expect(listenMock).toHaveBeenCalledWith("simulator_values", expect.any(Function)));

    const onValues = listenMock.mock.calls.find((c) => c[0] === "simulator_values")?.[1] as (event: { payload: unknown }) => void;
    onValues({
      payload: {
        workspace: "WS1",
        rows: [{ unitId: 1, functionCode: 3, address: 0, valueWord: 42, valueBit: null, sourceStatus: "stale" }],
      },
    });

    expect(await screen.findByText(/stale/i)).toBeTruthy();
  });
});
