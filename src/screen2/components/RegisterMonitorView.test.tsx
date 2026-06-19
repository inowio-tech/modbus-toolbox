import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RegisterMonitorView from "./RegisterMonitorView";
import type { RegisterRowDraft } from "./RegisterRowsTable";

function makeRow(over: Partial<RegisterRowDraft> & { key: string }): RegisterRowDraft {
  return {
    id: null,
    address: "0",
    alias: "",
    dataType: "u16",
    order: "",
    displayFormat: "dec",
    writeValue: "",
    runtimeValue: null,
    runtimeRawWords: null,
    runtimeStatus: "idle",
    runtimeError: null,
    runtimeTs: null,
    ...over,
  };
}

const formatValue = (r: RegisterRowDraft) => (r.runtimeValue == null ? "—" : String(r.runtimeValue));

function view(rows: RegisterRowDraft[]) {
  return (
    <RegisterMonitorView
      rows={rows}
      formatValue={formatValue}
      pinStorageKey="test.pins"
      densityStorageKey="test.density"
      onOpenDetails={vi.fn()}
    />
  );
}

function renderView(rows: RegisterRowDraft[]) {
  return render(view(rows));
}

describe("RegisterMonitorView", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const rows = [
    makeRow({ key: "k1", address: "1", alias: "PUMP", runtimeStatus: "ok", runtimeValue: 42, runtimeTs: 1 }),
    makeRow({ key: "k2", address: "2", alias: "VALVE", runtimeStatus: "error", runtimeError: "illegal addr" }),
  ];

  it("renders live values for each register", () => {
    renderView(rows);
    expect(screen.getByText("PUMP")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("VALVE")).toBeInTheDocument();
    expect(screen.getByText(/illegal addr/i)).toBeInTheDocument();
  });

  it("filters with the search box", () => {
    renderView(rows);
    fireEvent.change(screen.getByLabelText(/search registers/i), { target: { value: "PUMP" } });
    expect(screen.getByText("PUMP")).toBeInTheDocument();
    expect(screen.queryByText("VALVE")).toBeNull();
  });

  it("pins a register and the Pinned filter shows only pins", () => {
    renderView(rows);
    fireEvent.click(screen.getByRole("button", { name: /pin pump/i }));
    // Star flips to unpin.
    expect(screen.getByRole("button", { name: /unpin pump/i })).toBeInTheDocument();
    // Pinned filter narrows the list to pinned registers only.
    fireEvent.click(screen.getByRole("button", { name: /^pinned$/i }));
    expect(screen.getByText("PUMP")).toBeInTheDocument();
    expect(screen.queryByText("VALVE")).toBeNull();
  });

  it("narrows to faulted registers with the Errors filter", () => {
    renderView(rows);
    fireEvent.click(screen.getByRole("button", { name: /^errors$/i }));
    expect(screen.getByText("VALVE")).toBeInTheDocument();
    expect(screen.queryByText("PUMP")).toBeNull();
  });

  it("remembers the density choice in localStorage and applies it on mount", () => {
    const { unmount } = renderView(rows);
    // Small register sets default to the Cards layout.
    const denseRowsBtn = screen.getByRole("button", { name: "Dense rows" });
    expect(denseRowsBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(denseRowsBtn);
    expect(denseRowsBtn).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("test.density")).toBe("rows");

    // Re-mounting restores the saved density (renders the table header).
    unmount();
    renderView(rows);
    expect(screen.getByRole("button", { name: "Dense rows" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Addr")).toBeInTheDocument();
  });

  it("flashes a register whose value changed and the Changed filter narrows to it", () => {
    const before = [
      makeRow({ key: "k1", address: "1", alias: "PUMP", runtimeStatus: "ok", runtimeValue: 42, runtimeTs: 1 }),
      makeRow({ key: "k2", address: "2", alias: "VALVE", runtimeStatus: "ok", runtimeValue: 10, runtimeTs: 1 }),
    ];
    const { rerender } = render(view(before));

    // Next poll: PUMP changes value, VALVE stays the same.
    const after = [
      makeRow({ key: "k1", address: "1", alias: "PUMP", runtimeStatus: "ok", runtimeValue: 43, runtimeTs: 2 }),
      makeRow({ key: "k2", address: "2", alias: "VALVE", runtimeStatus: "ok", runtimeValue: 10, runtimeTs: 2 }),
    ];
    rerender(view(after));

    fireEvent.click(screen.getByRole("button", { name: /^changed$/i }));
    expect(screen.getByText("PUMP")).toBeInTheDocument();
    expect(screen.queryByText("VALVE")).toBeNull();
  });
});
