import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import VirtualDevicesView from "./VirtualDevicesView";

const tmpl = (templateKey: string, name: string, category = "Custom", description = "") => ({
  templateKey, name, category, description, icon: "📟", registers: [],
});

describe("VirtualDevicesView", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "simulator_list_device_templates")
        return Promise.resolve([tmpl("temp_humidity", "Temp Humidity", "Sensor"), tmpl("custom_pump", "Pump Meter")]);
      if (cmd === "simulator_list_custom_templates") return Promise.resolve([tmpl("custom_pump", "Pump Meter")]);
      return Promise.resolve(null);
    });
  });

  it("shows built-in and custom devices split into sections", async () => {
    render(<VirtualDevicesView search="" />);
    expect(await screen.findByText("Pump Meter")).toBeInTheDocument();
    expect(screen.getByText("Temp Humidity")).toBeInTheDocument();
  });

  it("filters both sections by the search prop", async () => {
    const { rerender } = render(<VirtualDevicesView search="" />);
    await screen.findByText("Pump Meter");
    rerender(<VirtualDevicesView search="pump" />);
    await waitFor(() => expect(screen.queryByText("Temp Humidity")).not.toBeInTheDocument());
    expect(screen.getByText("Pump Meter")).toBeInTheDocument();
    expect(screen.getByText(/no built-in devices match/i)).toBeInTheDocument();
  });
});
