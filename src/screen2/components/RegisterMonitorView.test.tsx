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

function renderView(rows: RegisterRowDraft[]) {
  return render(
    <RegisterMonitorView
      rows={rows}
      formatValue={(r) => (r.runtimeValue == null ? "—" : String(r.runtimeValue))}
      pinStorageKey="test.pins"
      onOpenDetails={vi.fn()}
    />,
  );
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
});
