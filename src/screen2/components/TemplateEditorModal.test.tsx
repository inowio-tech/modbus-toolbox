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
});
