import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RegistersTab from "./RegistersTab";

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

const base = () => ({
  ws: "ws",
  registers: [reg(), reg({ id: 2, unitId: 2, alias: "Volt", valueSource: "device" })],
  devices: [],
  status: { running: false, listen: null, clientCount: 0 },
  snapshotFor: () => undefined,
  addrFmt: "dec" as const,
  onAddrFmt: vi.fn(),
  onSelectRegister: vi.fn(),
  onDelete: vi.fn(),
  onAddRegister: vi.fn(),
  onAddDevice: vi.fn(),
});

beforeEach(() => localStorage.clear());

describe("RegistersTab", () => {
  it("renders all rows then filters by search", () => {
    render(<RegistersTab {...base()} />);
    expect(screen.getAllByRole("row").length).toBeGreaterThan(2);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "volt" } });
    expect(screen.getByText("Volt")).toBeInTheDocument();
    expect(screen.queryByText("Temp")).not.toBeInTheDocument();
  });

  it("Add Register triggers callback", () => {
    const p = base();
    render(<RegistersTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /add register/i }));
    expect(p.onAddRegister).toHaveBeenCalled();
  });

  it("Add Device triggers callback", () => {
    const p = base();
    render(<RegistersTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /add device/i }));
    expect(p.onAddDevice).toHaveBeenCalled();
  });

  it("shows R/W for holding registers", () => {
    render(<RegistersTab {...base()} />);
    expect(screen.getAllByText("R/W").length).toBeGreaterThan(0);
  });

  it("clicking a row calls onSelectRegister with the register", () => {
    const p = base();
    render(<RegistersTab {...p} />);
    fireEvent.click(screen.getByText("Temp"));
    expect(p.onSelectRegister).toHaveBeenCalledWith(expect.objectContaining({ id: 1, alias: "Temp" }));
  });

  it("Delete action calls onDelete with the register id", () => {
    const p = base();
    render(<RegistersTab {...p} />);
    fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);
    expect(p.onDelete).toHaveBeenCalledWith(1);
  });

  it("shows empty state with Add Register / Add Device CTAs when there are no registers", () => {
    const p = { ...base(), registers: [] };
    render(<RegistersTab {...p} />);
    expect(screen.getByText(/no registers/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /add register/i })[0]);
    expect(p.onAddRegister).toHaveBeenCalled();
  });

  it("Dec/Hex toggle calls onAddrFmt", () => {
    const p = base();
    render(<RegistersTab {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /hex addresses/i }));
    expect(p.onAddrFmt).toHaveBeenCalledWith("hex");
  });

  it("closes the Columns menu on Escape and on an outside click", () => {
    render(<RegistersTab {...base()} />);
    const toggle = screen.getByRole("button", { name: /show or hide columns/i });

    // Opens, then Escape closes it.
    fireEvent.click(toggle);
    expect(screen.getByLabelText(/toggle unit column/i)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText(/toggle unit column/i)).not.toBeInTheDocument();

    // Opens again, then a click outside closes it.
    fireEvent.click(toggle);
    expect(screen.getByLabelText(/toggle unit column/i)).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText(/toggle unit column/i)).not.toBeInTheDocument();
  });
});
