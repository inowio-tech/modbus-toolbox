import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import SimulatorStatusChip from "./SimulatorStatusChip";

describe("SimulatorStatusChip", () => {
  beforeEach(() => { invokeMock.mockReset(); });

  it("shows nothing when the simulator is stopped", async () => {
    invokeMock.mockResolvedValue({ running: false, listen: null, clientCount: 0 });
    const { container } = render(<MemoryRouter><SimulatorStatusChip workspaceName="WS1" /></MemoryRouter>);
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(container.textContent).not.toMatch(/sim/i);
  });

  it("shows a chip when running", async () => {
    invokeMock.mockResolvedValue({ running: true, listen: null, clientCount: 2 });
    render(<MemoryRouter><SimulatorStatusChip workspaceName="WS1" /></MemoryRouter>);
    expect(await screen.findByText(/sim/i)).toBeTruthy();
  });
});
