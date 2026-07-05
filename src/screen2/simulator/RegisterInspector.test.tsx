import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RegisterInspector from "./RegisterInspector";
import type { PageRegister } from "./simFilters";
import type { SimDevice } from "./useSimulatorData";

const reg: PageRegister = {
  id: 1,
  unitId: 1,
  functionCode: 3,
  address: 40001,
  alias: "Temperature",
  dataType: "f32",
  holdValue: 0,
  sortOrder: 0,
  valueSource: "device",
  byteOrder: "ABCD",
  sourceParams: JSON.stringify({ preset: "temperature", min: 0, max: 100 }),
  intervalMs: 500,
  deviceInstanceId: 7,
  unit: "°C",
  displayFormat: "dec2",
};

const devices: SimDevice[] = [
  { id: 7, templateKey: "th", name: "Temp Sensor A", unitId: 1, baseAddress: 40001, sortOrder: 0 },
];

const base = () => ({
  register: reg,
  devices,
  history: [23.1, 23.3, 23.45],
  liveValue: "23.45 °C",
  sourceStatus: "ok",
  running: true,
  onSave: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  onClose: vi.fn(),
  onViewDevice: vi.fn(),
});

describe("RegisterInspector", () => {
  it("renders nothing when no register is selected", () => {
    const { container } = render(<RegisterInspector {...base()} register={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the register with Unit and derived Read-Write access", () => {
    render(<RegisterInspector {...base()} />);
    expect(screen.getByText("Temperature")).toBeInTheDocument();
    expect((screen.getByLabelText(/^unit$/i) as HTMLInputElement).value).toBe("°C");
    // FC 3 (holding) is derived as Read-Write via rwLabel.
    expect(screen.getByText(/read-write/i)).toBeInTheDocument();
  });

  it("edits unit and saves", () => {
    const p = base();
    render(<RegisterInspector {...p} />);
    fireEvent.change(screen.getByLabelText(/^unit$/i), { target: { value: "K" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ unit: "K" }));
  });

  it("duplicate and delete fire", () => {
    const p = base();
    render(<RegisterInspector {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /duplicate/i }));
    expect(p.onDuplicate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(p.onDelete).toHaveBeenCalledWith(1);
  });

  it("shows the owning device and calls onViewDevice", () => {
    const p = base();
    render(<RegisterInspector {...p} />);
    expect(screen.getByText("Temp Sensor A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view device/i }));
    expect(p.onViewDevice).toHaveBeenCalledWith(7);
  });

  it("switches to the Source tab and shows the matching param editor", () => {
    render(<RegisterInspector {...base()} />);
    fireEvent.click(screen.getByRole("tab", { name: /source/i }));
    expect(screen.getByLabelText(/device preset/i)).toBeInTheDocument();
  });

  it("renders gracefully with empty history (no crash)", () => {
    render(<RegisterInspector {...base()} history={[]} />);
    expect(screen.getByText("Temperature")).toBeInTheDocument();
  });

  it("re-seeds edit state when the register id changes", () => {
    const p = base();
    const { rerender } = render(<RegisterInspector {...p} />);
    fireEvent.change(screen.getByLabelText(/^unit$/i), { target: { value: "K" } });
    const other: PageRegister = { ...reg, id: 2, alias: "Pressure", unit: "kPa" };
    rerender(<RegisterInspector {...p} register={other} />);
    expect(screen.getByText("Pressure")).toBeInTheDocument();
    expect((screen.getByLabelText(/^unit$/i) as HTMLInputElement).value).toBe("kPa");
  });
});
