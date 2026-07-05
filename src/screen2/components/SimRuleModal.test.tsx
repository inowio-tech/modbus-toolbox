import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SimRuleModal from "./SimRuleModal";

describe("SimRuleModal", () => {
  it("builds an interval rule with one action", () => {
    const onSubmit = vi.fn();
    render(<SimRuleModal open initial={null} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/rule name/i), { target: { value: "blink" } });
    fireEvent.change(screen.getByLabelText(/trigger type/i), { target: { value: "interval" } });
    fireEvent.click(screen.getByRole("button", { name: /add action/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const arg = onSubmit.mock.calls[0][0];
    expect(arg.name).toBe("blink");
    expect(JSON.parse(arg.trigger).type).toBe("interval");
    expect(JSON.parse(arg.actions).length).toBe(1);
  });
  it("does not render when closed", () => {
    const { container } = render(<SimRuleModal open={false} initial={null} onClose={() => {}} onSubmit={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
