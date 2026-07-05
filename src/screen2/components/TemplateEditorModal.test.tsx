import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TemplateEditorModal from "./TemplateEditorModal";

const custom = {
  templateKey: "custom_x",
  name: "My Device",
  category: "Custom",
  description: "",
  icon: "📟",
  registers: [{ offset: 0, bank: 3, dataType: "u16", byteOrder: "ABCD", valueSource: "hold", sourceParams: "{}", alias: "A" }],
};

describe("TemplateEditorModal", () => {
  it("does not render when closed", () => {
    const { container } = render(<TemplateEditorModal open={false} initial={null} takenKeys={[]} onClose={() => {}} onSave={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("blocks Save until a key and name are present, and on a key clash", () => {
    render(<TemplateEditorModal open initial={null} takenKeys={["taken_key"]} onClose={vi.fn()} onSave={vi.fn()} />);
    const save = screen.getByRole("button", { name: /save device/i });
    expect(save).toBeDisabled(); // blank key + name
    fireEvent.change(screen.getByLabelText(/template name/i), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText(/template key/i), { target: { value: "taken_key" } });
    expect(save).toBeDisabled(); // key clash
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/template key/i), { target: { value: "fresh_key" } });
    expect(save).toBeEnabled();
  });

  it("locks the key when editing an existing template and saves it", () => {
    const onSave = vi.fn();
    render(<TemplateEditorModal open initial={custom} takenKeys={["custom_x"]} onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByLabelText(/template key/i)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ templateKey: "custom_x", name: "My Device" }));
  });

  it("adds and removes register rows", () => {
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByLabelText("Alias 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add register/i }));
    expect(screen.getByLabelText("Alias 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove register 1/i }));
    expect(screen.queryByLabelText("Alias 1")).not.toBeInTheDocument();
  });

  it("picks an icon from the chooser modal instead of typing one", () => {
    const onSave = vi.fn();
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
    // No free-text icon box, and the grid is behind a modal (not inline).
    expect(screen.queryByRole("radio", { name: "Icon ⚡" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Choose device icon"));
    fireEvent.click(screen.getByRole("radio", { name: "Icon ⚡" }));
    // Picking closes the modal; the choice sticks on save.
    expect(screen.queryByRole("radio", { name: "Icon ⚡" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ icon: "⚡" }));
  });

  it("filters icons in the chooser by keyword", () => {
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Choose device icon"));
    fireEvent.change(screen.getByLabelText(/search icons/i), { target: { value: "andon" } });
    // 🚦 is tagged "andon"; ⚡ is not.
    expect(screen.getByRole("radio", { name: "Icon 🚦" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Icon ⚡" })).not.toBeInTheDocument();
  });

  it("hold registers carry no parameter fields", () => {
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    // hold source => no form/JSON toggle, no raw JSON textarea.
    expect(screen.queryByLabelText("Params JSON 0")).not.toBeInTheDocument();
    expect(screen.getByText(/no parameters/i)).toBeInTheDocument();
  });

  it("edits generator params through the form and saves clean JSON", () => {
    const onSave = vi.fn();
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={onSave} />);
    // Switch the first register to a generator, then set its waveform + max.
    fireEvent.change(screen.getByLabelText("Source 0"), { target: { value: "generator" } });
    fireEvent.change(screen.getByLabelText("Generator kind 0"), { target: { value: "ramp" } });
    fireEvent.change(screen.getByLabelText("Max 0"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));
    const saved = onSave.mock.calls[0][0];
    expect(JSON.parse(saved.registers[0].sourceParams)).toEqual({ kind: "ramp", min: 0, max: 250, periodMs: 1000 });
  });

  it("switches a register's params to a raw JSON editor", () => {
    render(<TemplateEditorModal open initial={custom} takenKeys={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Source 0"), { target: { value: "generator" } });
    // Form view is default; toggle to JSON exposes the raw editor.
    expect(screen.queryByLabelText("Params JSON 0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Params JSON view 0"));
    const editor = screen.getByLabelText("Params JSON 0");
    expect(editor).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: "{ not json" } });
    expect(screen.getByText(/not valid json/i)).toBeInTheDocument();
  });
});
