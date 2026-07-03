import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import SimFooterBar from "./SimFooterBar";

describe("SimFooterBar", () => {
  it("renders status, config, and calls onRefresh", () => {
    const onRefresh = vi.fn();
    render(
      <SimFooterBar
        status={{ running: true, listen: null, clientCount: 2 }}
        config={{ enabled: true, host: "0.0.0.0", port: 502, tickMs: 100 }}
        lastUpdated={null}
        onRefresh={onRefresh}
      />
    );
    expect(screen.getByText(/running/i)).toBeInTheDocument();
    expect(screen.getByText(/port 502/i)).toBeInTheDocument();
    expect(screen.getByText(/tick 100 ms/i)).toBeInTheDocument();
    expect(screen.getByText(/2 clients/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("shows stopped and — when no config/lastUpdated", () => {
    render(<SimFooterBar status={{ running: false, listen: null, clientCount: 0 }} config={null} lastUpdated={null} onRefresh={vi.fn()} />);
    expect(screen.getByText(/stopped/i)).toBeInTheDocument();
    expect(screen.getByText(/updated —/i)).toBeInTheDocument();
  });
});
