import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AddDeviceModal from "./AddDeviceModal";

const T = [{ templateKey: "temp_humidity", name: "Temp/Humidity", category: "Sensors", description: "d", icon: "🌡️",
  registers: [{ offset: 0, bank: 4, dataType: "u16", byteOrder: "ABCD", valueSource: "device", sourceParams: "{}", alias: "Temperature" }] }];

describe("AddDeviceModal", () => {
  it("selects a template, configures it, and submits from the review step", () => {
    const onSubmit = vi.fn();
    render(<AddDeviceModal open templates={T} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /temp\/humidity/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(screen.getByLabelText(/device name/i), { target: { value: "Sensor A" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ templateKey: "temp_humidity", deviceName: "Sensor A" }));
  });
  it("does not render when closed", () => {
    const { container } = render(<AddDeviceModal open={false} templates={[]} onClose={() => {}} onSubmit={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("AddDeviceModal wizard", () => {
  it("walks select → configure → review → create", () => {
    const onSubmit = vi.fn();
    render(<AddDeviceModal open templates={T} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("Temp/Humidity"));           // select template
    fireEvent.click(screen.getByRole("button", { name: /next/i })); // → configure
    fireEvent.change(screen.getByLabelText(/base address/i), { target: { value: "40001" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i })); // → review
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ templateKey: "temp_humidity", baseAddress: 40001 }));
  });
  it("blocks Next until a template is selected", () => {
    render(<AddDeviceModal open templates={T} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });
});
