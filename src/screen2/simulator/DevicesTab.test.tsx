import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import DevicesTab from "./DevicesTab";

const dev = { id: 7, templateKey: "temp_humidity", name: "Temp Sensor A", unitId: 1, baseAddress: 40001, enabled: true, sortOrder: 0 };
const base = () => ({
  devices: [dev],
  registers: [{ id: 1, deviceInstanceId: 7 } as any, { id: 2, deviceInstanceId: 7 } as any],
  onAddDevice: vi.fn(),
  onToggleEnabled: vi.fn(),
  onRename: vi.fn(),
  onRebase: vi.fn(),
  onDelete: vi.fn(),
});

describe("DevicesTab", () => {
  it("renders a device card with register count", () => {
    render(<DevicesTab {...base()} />);
    expect(screen.getByText("Temp Sensor A")).toBeInTheDocument();
    expect(screen.getByText(/2 registers/i)).toBeInTheDocument();
  });
  it("toggles enabled", () => {
    const p = base();
    render(<DevicesTab {...p} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /enable/i }));
    expect(p.onToggleEnabled).toHaveBeenCalledWith(dev, false);
  });
  it("empty state offers Add Device", () => {
    const p = { ...base(), devices: [] };
    render(<DevicesTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /add device/i }));
    expect(p.onAddDevice).toHaveBeenCalled();
  });
});
