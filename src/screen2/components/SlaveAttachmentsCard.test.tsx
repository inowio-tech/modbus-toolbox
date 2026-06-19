import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SlaveAttachmentsCard from "./SlaveAttachmentsCard";

const listMock = vi.fn();
const readMock = vi.fn();

vi.mock("../api/attachments", () => ({
  listSlaveAttachments: (...a: unknown[]) => listMock(...a),
  readSlaveAttachment: (...a: unknown[]) => readMock(...a),
  addSlaveAttachment: vi.fn(),
  deleteSlaveAttachment: vi.fn(),
  exportSlaveAttachment: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../components/ToastProvider", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("../api/logs", () => ({
  logEvent: vi.fn(),
}));

const PDF_ITEM = {
  fileName: "214046.pdf",
  displayName: "214046.pdf",
  ext: "pdf",
  sizeBytes: 1669482,
  modifiedAtIso: "2026-05-29T07:43:54",
  path: "/ws/attachments/slave-1/214046.pdf",
};

const origCreate = globalThis.URL.createObjectURL;
const origRevoke = globalThis.URL.revokeObjectURL;

describe("SlaveAttachmentsCard PDF preview", () => {
  beforeEach(() => {
    listMock.mockReset();
    readMock.mockReset();
    listMock.mockResolvedValue([PDF_ITEM]);
    readMock.mockResolvedValue({
      kind: "pdf",
      data: btoa("%PDF-1.4\n%binary\n"),
      mimeType: "application/pdf",
    });
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-pdf-url");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    globalThis.URL.createObjectURL = origCreate;
    globalThis.URL.revokeObjectURL = origRevoke;
  });

  it("renders the PDF in an iframe via a blob: URL, never a data: URL", async () => {
    render(<SlaveAttachmentsCard workspaceName="DPS" slaveId={1} />);

    fireEvent.click(await screen.findByRole("button", { name: /^preview$/i }));

    const iframe = await screen.findByTitle("214046.pdf");
    await waitFor(() => {
      expect(iframe.getAttribute("src") ?? "").toMatch(/^blob:/);
    });
    expect(iframe.getAttribute("src") ?? "").not.toMatch(/^data:/);
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
