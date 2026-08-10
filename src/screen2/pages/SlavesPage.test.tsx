import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SlavesPage from "./SlavesPage";

const invokeMock = vi.fn();
const navigateMock = vi.fn();
const pushToastMock = vi.fn();
const logEventMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useOutletContext: () => ({
      workspace: { name: "TestWS", updated_at: "", created_at: "" },
    }),
  };
});

vi.mock("../../components/ToastProvider", () => ({
  useToast: () => ({ pushToast: pushToastMock }),
  useErrorToast: () => undefined,
}));

vi.mock("../api/logs", async () => {
  const actual = await vi.importActual<typeof import("../api/logs")>("../api/logs");
  return {
    ...actual,
    logEvent: (...args: unknown[]) => logEventMock(...args),
  };
});

describe("SlavesPage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    navigateMock.mockReset();
    pushToastMock.mockReset();
    logEventMock.mockReset();
  });

  function setupList(slaves = [{ id: 1, name: "Pump", unitId: 10, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" }]) {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_slaves") {
        return Promise.resolve(slaves);
      }
      return Promise.resolve(null);
    });
  }

  it("loads and renders slave rows", async () => {
    setupList();
    render(<SlavesPage />);
    await screen.findByText(/Pump/);
    expect(screen.getByText(/Unit-ID 10/i)).toBeInTheDocument();
  });

  it("shows validation error in modal when fields missing", async () => {
    setupList([]);
    render(<SlavesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^add$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /add/i }));

    await screen.findByText(/name is required/i);
  });

  it("humanizes delete errors", async () => {
    setupList([
      { id: 5, name: "Valve", unitId: 5, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
    ]);

    invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "list_slaves") {
        return Promise.resolve([
          { id: 5, name: "Valve", unitId: 5, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
        ]);
      }
      if (command === "delete_slave" && args?.id === 5) {
        return Promise.reject(new Error("foreign key constraint failed"));
      }
      return Promise.resolve(null);
    });

    render(<SlavesPage />);

    const valveText = await screen.findByText(/Valve/i);
    const row = valveText.closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLLIElement).getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("delete_slave", expect.objectContaining({ id: 5 })),
    );
    await waitFor(() =>
      expect(logEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Failed to delete slave",
          detailsJson: expect.objectContaining({
            humanMessage: expect.stringContaining("Analyzer dashboard"),
          }),
        }),
      ),
    );
  });

  it("navigates to details when clicking open", async () => {
    setupList();
    render(<SlavesPage />);
    const listButton = await screen.findByRole("button", { name: /unit-id 10/i });
    fireEvent.click(listButton);
    expect(navigateMock).toHaveBeenCalledWith("1");
  });

  it("shows non-zero register counts and opens the details modal", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_slaves") {
        return Promise.resolve([
          { id: 1, name: "Pump", unitId: 10, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-02-02T00:00:00Z" },
        ]);
      }
      if (command === "count_slave_register_rows") {
        return Promise.resolve([
          { slaveId: 1, functionCode: 1, count: 3 },
          { slaveId: 1, functionCode: 3, count: 5 },
        ]);
      }
      return Promise.resolve(null);
    });

    render(<SlavesPage />);

    await screen.findByText(/Pump/);
    // Inline shows only non-zero function codes.
    expect(await screen.findByText("0x01")).toBeInTheDocument();
    expect(screen.getByText("0x03")).toBeInTheDocument();
    expect(screen.queryByText("0x02")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /register details/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Read Coils \(0x01\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Read Holding Registers \(0x03\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Total/)).toBeInTheDocument();
  });

  it("shows an empty state when a slave has no configured registers", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_slaves") {
        return Promise.resolve([
          { id: 2, name: "Idle", unitId: 7, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
        ]);
      }
      if (command === "count_slave_register_rows") {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });

    render(<SlavesPage />);
    await screen.findByText(/Idle/);
    expect(await screen.findByText(/no registers configured/i)).toBeInTheDocument();
  });

  it("opens the clone dialog pre-filled with a free name and unit id", async () => {
    setupList([
      { id: 1, name: "SHT20", unitId: 1, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
      { id: 2, name: "Pump", unitId: 2, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
    ]);

    render(<SlavesPage />);

    const sht = await screen.findByText(/SHT20/);
    const row = sht.closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLLIElement).getByRole("button", { name: /clone/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/name/i)).toHaveValue("SHT20 (copy)");
    // 1 and 2 are taken, so the first free unit id is 3.
    expect(within(dialog).getByLabelText(/unit id/i)).toHaveValue(3);
  });

  it("clones a slave through the backend and reports success", async () => {
    invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "list_slaves") {
        return Promise.resolve([
          { id: 1, name: "SHT20", unitId: 1, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
        ]);
      }
      if (command === "clone_slave") {
        return Promise.resolve({
          id: 2,
          name: args?.newName,
          unitId: args?.newUnitId,
          createdAt: "2024-02-02T00:00:00Z",
          updatedAt: "2024-02-02T00:00:00Z",
        });
      }
      return Promise.resolve(null);
    });

    render(<SlavesPage />);

    const sht = await screen.findByText(/SHT20/);
    fireEvent.click(
      within(sht.closest("li") as HTMLLIElement).getByRole("button", { name: /clone/i }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^clone$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "clone_slave",
        expect.objectContaining({ id: 1, newName: "SHT20 (copy)", newUnitId: 2 }),
      ),
    );
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith('Slave "SHT20 (copy)" cloned', "info"),
    );
    await waitFor(() =>
      expect(logEventMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Slave cloned" }),
      ),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("update_slave", expect.anything());

    await screen.findByText(/SHT20 \(copy\)/);
    expect(invokeMock.mock.calls.filter(([c]) => c === "count_slave_register_rows")).toHaveLength(2);
  });

  it("surfaces clone failures in the dialog", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_slaves") {
        return Promise.resolve([
          { id: 1, name: "SHT20", unitId: 1, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
        ]);
      }
      if (command === "clone_slave") {
        return Promise.reject(new Error("failed to copy register rows: disk full"));
      }
      return Promise.resolve(null);
    });

    render(<SlavesPage />);

    const sht = await screen.findByText(/SHT20/);
    fireEvent.click(
      within(sht.closest("li") as HTMLLIElement).getByRole("button", { name: /clone/i }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^clone$/i }));

    await screen.findByText(/failed to copy register rows/i);
    await waitFor(() =>
      expect(logEventMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Failed to clone slave" }),
      ),
    );
  });
});
