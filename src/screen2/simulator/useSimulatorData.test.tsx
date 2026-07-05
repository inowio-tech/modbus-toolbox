import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const listeners: Record<string, (e: any) => void> = {};
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: any[]) => invokeMock(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, cb: any) => { listeners[name] = cb; return Promise.resolve(() => {}); } }));

import { useSimulatorData } from "./useSimulatorData";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "simulator_get_config": return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      case "simulator_list_registers": return Promise.resolve([{ id: 1, unitId: 1, functionCode: 3, address: 5, alias: "T", dataType: "u16", holdValue: 0, sortOrder: 0, valueSource: "hold", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000, deviceInstanceId: null }]);
      case "simulator_list_rules": return Promise.resolve([]);
      case "simulator_status": return Promise.resolve({ running: false, listen: null, clientCount: 0 });
      case "simulator_list_device_templates": return Promise.resolve([]);
      case "simulator_list_devices": return Promise.resolve([]);
      default: return Promise.resolve(null);
    }
  });
});

describe("useSimulatorData", () => {
  it("reload aggregates all sources", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.registers).toHaveLength(1));
    expect(result.current.config?.port).toBe(502);
  });

  it("sets lastUpdated after reload", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.lastUpdated).not.toBeNull());
  });

  it("live-value event updates snapshot", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(listeners["simulator_values"]).toBeTypeOf("function"));
    act(() => listeners["simulator_values"]({ payload: { workspace: "ws", rows: [{ unitId: 1, functionCode: 3, address: 5, valueWord: 42, valueBit: null }] } }));
    await waitFor(() => expect(result.current.snapshot[0].valueWord).toBe(42));
  });

  it("snapshotFor looks up a row by unit/fc/address", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(listeners["simulator_values"]).toBeTypeOf("function"));
    act(() => listeners["simulator_values"]({ payload: { workspace: "ws", rows: [{ unitId: 1, functionCode: 3, address: 5, valueWord: 42, valueBit: null }] } }));
    await waitFor(() => expect(result.current.snapshotFor(1, 3, 5)?.valueWord).toBe(42));
    expect(result.current.snapshotFor(9, 9, 9)).toBeUndefined();
  });

  it("duplicateRegister clones with id:0, a (copy) alias, and the next free address, then reloads", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.registers).toHaveLength(1));
    invokeMock.mockClear();
    await act(async () => {
      await result.current.duplicateRegister(result.current.registers[0]);
    });
    // original is a u16 at address 5 → clone must not reuse 5 (UNIQUE constraint);
    // next free on the same unit+fc is 6, and it is created standalone.
    expect(invokeMock).toHaveBeenCalledWith(
      "simulator_add_register",
      expect.objectContaining({
        name: "ws",
        register: expect.objectContaining({ id: 0, alias: "T (copy)", address: 6, deviceInstanceId: null }),
      })
    );
    expect(invokeMock).toHaveBeenCalledWith("simulator_list_registers", { name: "ws" });
  });

  it("duplicateRegister skips addresses already taken on the same unit+function", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "simulator_get_config": return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
        case "simulator_list_registers": return Promise.resolve([
          { id: 1, unitId: 1, functionCode: 3, address: 5, alias: "T", dataType: "u16", holdValue: 0, sortOrder: 0, valueSource: "hold", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000, deviceInstanceId: null },
          { id: 2, unitId: 1, functionCode: 3, address: 6, alias: "U", dataType: "u16", holdValue: 0, sortOrder: 0, valueSource: "hold", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000, deviceInstanceId: null },
        ]);
        case "simulator_list_rules": return Promise.resolve([]);
        case "simulator_status": return Promise.resolve({ running: false, listen: null, clientCount: 0 });
        case "simulator_list_device_templates": return Promise.resolve([]);
        case "simulator_list_devices": return Promise.resolve([]);
        default: return Promise.resolve(null);
      }
    });
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.registers).toHaveLength(2));
    invokeMock.mockClear();
    await act(async () => { await result.current.duplicateRegister(result.current.registers[0]); });
    // 5+1=6 is taken → clone lands on 7
    expect(invokeMock).toHaveBeenCalledWith(
      "simulator_add_register",
      expect.objectContaining({ register: expect.objectContaining({ address: 7 }) })
    );
  });

  it("start invokes simulator_start and fetches a snapshot", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "simulator_get_config": return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
        case "simulator_list_registers": return Promise.resolve([]);
        case "simulator_list_rules": return Promise.resolve([]);
        case "simulator_status": return Promise.resolve({ running: false, listen: null, clientCount: 0 });
        case "simulator_list_device_templates": return Promise.resolve([]);
        case "simulator_list_devices": return Promise.resolve([]);
        case "simulator_start": return Promise.resolve({ running: true, listen: { bound: "0.0.0.0", port: 502, addresses: ["127.0.0.1:502"] }, clientCount: 0 });
        case "simulator_snapshot": return Promise.resolve([{ unitId: 1, functionCode: 3, address: 5, valueWord: 7, valueBit: null }]);
        default: return Promise.resolve(null);
      }
    });
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.lastUpdated).not.toBeNull());
    await act(async () => { await result.current.start(); });
    expect(result.current.status.running).toBe(true);
    expect(result.current.snapshot).toHaveLength(1);
  });

  it("setError sets the error message", async () => {
    const { result } = renderHook(() => useSimulatorData("ws"));
    await waitFor(() => expect(result.current.lastUpdated).not.toBeNull());
    act(() => result.current.setError("boom"));
    expect(result.current.error).toBe("boom");
  });
});
