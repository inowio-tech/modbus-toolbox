import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SimRegisterModal from "./SimRegisterModal";

describe("SimRegisterModal", () => {
  it("renders defaults and submits a new register", () => {
    const onSubmit = vi.fn();
    render(<SimRegisterModal open initial={null} onClose={() => {}} onSubmit={onSubmit} />);
    // default address is 1
    expect((screen.getByLabelText(/address/i) as HTMLInputElement).value).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ unitId: 1, functionCode: 3, address: 1, dataType: "u16" }));
  });

  it("does not render when closed", () => {
    const { container } = render(<SimRegisterModal open={false} initial={null} onClose={() => {}} onSubmit={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("submits a generator register with serialized sourceParams", () => {
    const onSubmit = vi.fn();
    render(<SimRegisterModal open initial={null} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/value source/i), { target: { value: "generator" } });
    fireEvent.change(screen.getByLabelText(/generator kind/i), { target: { value: "sine" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const arg = onSubmit.mock.calls[0][0];
    expect(arg.valueSource).toBe("generator");
    expect(JSON.parse(arg.sourceParams).kind).toBe("sine");
  });

  it("submits a route register with source params", () => {
    const onSubmit = vi.fn();
    render(<SimRegisterModal open initial={null} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/value source/i), { target: { value: "route" } });
    fireEvent.change(screen.getByLabelText(/source slave unit/i), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText(/source function/i), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/source address/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const arg = onSubmit.mock.calls[0][0];
    expect(arg.valueSource).toBe("route");
    const sp = JSON.parse(arg.sourceParams);
    expect(sp.slaveUnitId).toBe(7);
    expect(sp.functionCode).toBe(4);
    expect(sp.address).toBe(1);
    expect(sp.connectionKind).toBe("tcp");
  });

  it("restricts_value_source_to_hold_for_coil", () => {
    const onSubmit = vi.fn();
    render(<SimRegisterModal open initial={null} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/register type/i), { target: { value: "1" } });
    expect(screen.getByRole("option", { name: /^device$/i })).toBeDisabled();
    expect(screen.getByRole("option", { name: /^generator$/i })).toBeDisabled();
    expect(screen.getByRole("option", { name: /^route$/i })).toBeDisabled();
  });
});
