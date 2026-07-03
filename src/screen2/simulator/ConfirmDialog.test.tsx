import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import ConfirmDialog from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  const base = () => ({
    open: true,
    title: "Delete device?",
    message: "Delete \"Temp Sensor A\" and all 2 of its registers?",
    confirmLabel: "Delete device",
    onConfirm: vi.fn(),
    onClose: vi.fn(),
  });

  it("renders title and message when open", () => {
    render(<ConfirmDialog {...base()} />);
    expect(screen.getByText("Delete device?")).toBeInTheDocument();
    expect(screen.getByText(/all 2 of its registers/i)).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<ConfirmDialog {...base()} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("fires onConfirm and onClose", () => {
    const p = base();
    render(<ConfirmDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /delete device/i }));
    expect(p.onConfirm).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(p.onClose).toHaveBeenCalled();
  });
});
