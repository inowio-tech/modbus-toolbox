import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import SimStatusDashboard from "./SimStatusDashboard";

const base = { config: { enabled: false, host: "0.0.0.0", port: 502, tickMs: 100 }, status: { running: false, listen: null, clientCount: 0 }, listen: null, busy: false, onStart: vi.fn(), onStop: vi.fn(), onSaveConfig: vi.fn(), onChangeExpose: vi.fn(), onChangePort: vi.fn() };

describe("SimStatusDashboard", () => {
  it("shows Start when stopped and calls onStart", () => {
    render(<SimStatusDashboard {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(base.onStart).toHaveBeenCalled();
  });

  it("shows client count and resolved address when running", () => {
    render(<SimStatusDashboard {...base} status={{ running: true, listen: { bound: "0.0.0.0", port: 502, addresses: ["192.168.1.10:502", "10.0.0.5:502"] }, clientCount: 2 }} listen={{ bound: "0.0.0.0", port: 502, addresses: ["192.168.1.10:502", "10.0.0.5:502"] }} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.1\.10:502/)).toBeInTheDocument();
    expect(screen.getByText(/and 1 more/i)).toBeInTheDocument();
  });
});
