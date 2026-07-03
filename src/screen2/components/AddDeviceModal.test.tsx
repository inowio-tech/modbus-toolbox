import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AddDeviceModal from "./AddDeviceModal";

const T = [{ templateKey: "temp_humidity", name: "Temp/Humidity", category: "Sensors", description: "d", icon: "🌡️",
  registers: [{ offset: 0, bank: 4, dataType: "u16", byteOrder: "ABCD", valueSource: "device", sourceParams: "{}", alias: "Temperature" }] }];

describe("AddDeviceModal", () => {
  it("selects a template and submits", () => {
    const onSubmit = vi.fn();
    render(<AddDeviceModal open templates={T} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /temp\/humidity/i }));
    fireEvent.change(screen.getByLabelText(/device name/i), { target: { value: "Sensor A" } });
    fireEvent.click(screen.getByRole("button", { name: /add device/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ templateKey: "temp_humidity", deviceName: "Sensor A" }));
  });
  it("does not render when closed", () => {
    const { container } = render(<AddDeviceModal open={false} templates={[]} onClose={() => {}} onSubmit={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
