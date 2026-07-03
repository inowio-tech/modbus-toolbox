import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import SimTabBar from "./SimTabBar";

describe("SimTabBar", () => {
  it("highlights active and switches", () => {
    const onChange = vi.fn();
    render(<SimTabBar active="registers" onChange={onChange} counts={{ registers: 3 }} />);
    expect(screen.getByRole("tab", { name: /registers/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /devices/i })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(screen.getByRole("tab", { name: /devices/i }));
    expect(onChange).toHaveBeenCalledWith("devices");
  });

  it("renders a tablist with all tabs", () => {
    render(<SimTabBar active="live" onChange={vi.fn()} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByRole("tab", { name: /live values/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /activity/i })).toBeInTheDocument();
  });

  it("shows a count badge when provided", () => {
    render(<SimTabBar active="registers" onChange={vi.fn()} counts={{ registers: 5 }} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
