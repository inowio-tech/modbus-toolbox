import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RulesTab, { actionsSummary, ruleSummary } from "./RulesTab";

const rule = {
  id: 1,
  name: "High Temp",
  enabled: true,
  sortOrder: 0,
  trigger: JSON.stringify({ type: "condition", bank: 3, address: 5, op: ">", value: 60 }),
  actions: JSON.stringify([{ type: "set", bank: 3, address: 10, value: 1 }]),
};

describe("actionsSummary", () => {
  it("summarizes a set action", () => {
    expect(actionsSummary(rule as any)).toMatch(/set/i);
  });

  it("summarizes inc/dec/toggle/copy/randomize actions joined by · ", () => {
    const r = {
      ...rule,
      actions: JSON.stringify([
        { type: "inc", bank: 3, address: 1, by: 2 },
        { type: "dec", bank: 3, address: 2, by: 3 },
        { type: "toggle", bank: 1, address: 4 },
        { type: "copy", bank: 3, address: 5, srcBank: 4, srcAddr: 6 },
        { type: "randomize", bank: 3, address: 7, min: 0, max: 100 },
      ]),
    };
    const summary = actionsSummary(r as any);
    expect(summary).toBe(
      "Inc holding[1] by 2 · Dec holding[2] by 3 · Toggle coil[4] · Copy input[6]→holding[5] · Randomize holding[7] 0..100"
    );
  });

  it("falls back to the raw type for an unknown action", () => {
    const r = { ...rule, actions: JSON.stringify([{ type: "mystery", bank: 3, address: 1 }]) };
    expect(actionsSummary(r as any)).toBe("mystery");
  });

  it("returns — for invalid JSON", () => {
    expect(actionsSummary({ ...rule, actions: "not json" } as any)).toBe("—");
  });

  it("returns — for empty actions", () => {
    expect(actionsSummary({ ...rule, actions: "[]" } as any)).toBe("—");
    expect(actionsSummary({ ...rule, actions: "" } as any)).toBe("—");
  });

  it("uses reg fallback for an unknown bank number", () => {
    const r = { ...rule, actions: JSON.stringify([{ type: "toggle", bank: 9, address: 1 }]) };
    expect(actionsSummary(r as any)).toBe("Toggle reg[1]");
  });
});

describe("ruleSummary", () => {
  it("summarizes a condition trigger", () => {
    expect(ruleSummary(rule as any)).toBe("holding[5] > 60");
  });

  it("summarizes an interval trigger", () => {
    const r = { ...rule, trigger: JSON.stringify({ type: "interval", ms: 500 }) };
    expect(ruleSummary(r as any)).toBe("interval 500ms");
  });

  it("returns invalid trigger for bad JSON", () => {
    expect(ruleSummary({ ...rule, trigger: "nope" } as any)).toBe("invalid trigger");
  });
});

describe("RulesTab", () => {
  it("renders rule name and toggles", () => {
    const onToggle = vi.fn();
    render(
      <RulesTab
        rules={[rule as any]}
        devices={[]}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onToggle={onToggle}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText("High Temp")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /high temp/i }));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), false);
  });

  it("resolves scope to a device name when the trigger unit maps to a device", () => {
    const r = { ...rule, trigger: JSON.stringify({ type: "condition", unit: 3, bank: 3, address: 5, op: ">", value: 60 }) };
    const device = { id: 9, templateKey: "th", name: "Boiler", unitId: 3, baseAddress: 0, enabled: true, sortOrder: 0 };
    render(<RulesTab rules={[r as any]} devices={[device as any]} onAdd={vi.fn()} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("Boiler")).toBeInTheDocument();
  });

  it("shows — for scope when the trigger unit doesn't map to any device", () => {
    render(<RulesTab rules={[rule as any]} devices={[]} onAdd={vi.fn()} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("Add Rule triggers onAdd", () => {
    const onAdd = vi.fn();
    render(<RulesTab rules={[]} devices={[]} onAdd={onAdd} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("Edit and Delete buttons fire callbacks", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<RulesTab rules={[rule as any]} devices={[]} onAdd={vi.fn()} onEdit={onEdit} onToggle={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("shows the next-Start note and an empty state when there are no rules", () => {
    render(<RulesTab rules={[]} devices={[]} onAdd={vi.fn()} onEdit={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/next start/i)).toBeInTheDocument();
    expect(screen.getByText(/no rules/i)).toBeInTheDocument();
  });
});
