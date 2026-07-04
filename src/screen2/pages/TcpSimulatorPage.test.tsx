import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
import { ToastProvider } from "../../components/ToastProvider";

const renderPage = () => render(<ToastProvider><TcpSimulatorPage /></ToastProvider>);

const device = { id: 1, templateKey: "temp-humidity", name: "Roof Sensor", unitId: 1, baseAddress: 100, sortOrder: 0 };
const reg = { id: 1, unitId: 1, functionCode: 3, address: 100, alias: "temp", dataType: "u16", holdValue: 0, sortOrder: 0, valueSource: "hold", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000, deviceInstanceId: 1 };

describe("TcpSimulatorPage (tabbed shell)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    window.localStorage.clear();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_get_config") return Promise.resolve({ enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 });
      if (cmd === "simulator_list_registers") return Promise.resolve([reg]);
      if (cmd === "simulator_list_devices") return Promise.resolve([device]);
      if (cmd === "simulator_list_rules") return Promise.resolve([]);
      if (cmd === "simulator_list_device_templates") return Promise.resolve([]);
      if (cmd === "simulator_status") return Promise.resolve({ running: false, listen: null, clientCount: 0 });
      return Promise.resolve(null);
    });
    listenMock.mockResolvedValue(() => {});
  });

  it("loads config and shows the Start control + tab bar", async () => {
    renderPage();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("simulator_get_config", { name: "WS1" }));
    expect(await screen.findByRole("button", { name: /start/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /registers/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /devices/i })).toBeTruthy();
  });

  it("subscribes to the simulator_values event for live values", async () => {
    renderPage();
    await waitFor(() => expect(listenMock).toHaveBeenCalledWith("simulator_values", expect.any(Function)));
  });

  it("shows the register on the default Registers tab", async () => {
    renderPage();
    expect(await screen.findByText("temp")).toBeTruthy();
  });

  it("switches to the Devices tab and shows the device", async () => {
    renderPage();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("simulator_list_devices", { name: "WS1" }));
    fireEvent.click(screen.getByRole("tab", { name: /devices/i }));
    expect(await screen.findByText("Roof Sensor")).toBeTruthy();
  });

  it("switches to the Rules tab and shows Add Rule", async () => {
    renderPage();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("simulator_list_rules", { name: "WS1" }));
    fireEvent.click(screen.getByRole("tab", { name: /rules/i }));
    expect(await screen.findByRole("button", { name: /add rule/i })).toBeTruthy();
  });

  it("opens the inspector when a register row is selected", async () => {
    renderPage();
    const row = await screen.findByText("temp");
    fireEvent.click(row);
    // Inspector shows the alias as a heading and a Save button
    expect(await screen.findByRole("button", { name: /save/i })).toBeTruthy();
  });
});
