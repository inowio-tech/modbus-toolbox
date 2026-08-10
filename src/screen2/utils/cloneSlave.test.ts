import { describe, expect, it } from "vitest";
import { nextFreeUnitId, stripCopySuffix, suggestCloneName } from "./cloneSlave";

describe("suggestCloneName", () => {
  it("appends (copy) when the name is free", () => {
    expect(suggestCloneName("SHT20", ["SHT20"])).toBe("SHT20 (copy)");
  });

  it("escalates to (copy 2) when (copy) is taken", () => {
    expect(suggestCloneName("SHT20", ["SHT20", "SHT20 (copy)"])).toBe("SHT20 (copy 2)");
  });

  it("keeps escalating past (copy 2)", () => {
    expect(suggestCloneName("SHT20", ["SHT20", "SHT20 (copy)", "SHT20 (copy 2)"])).toBe(
      "SHT20 (copy 3)",
    );
  });

  it("compares names case-insensitively and ignores surrounding space", () => {
    expect(suggestCloneName("SHT20", ["  sht20 (COPY) "])).toBe("SHT20 (copy 2)");
  });

  it("does not stack suffixes when cloning a clone", () => {
    expect(suggestCloneName("SHT20 (copy)", ["SHT20", "SHT20 (copy)"])).toBe("SHT20 (copy 2)");
    expect(suggestCloneName("SHT20 (copy 2)", ["SHT20", "SHT20 (copy)", "SHT20 (copy 2)"])).toBe(
      "SHT20 (copy 3)",
    );
  });
});

describe("stripCopySuffix", () => {
  it("removes a trailing copy marker", () => {
    expect(stripCopySuffix("Pump (copy)")).toBe("Pump");
    expect(stripCopySuffix("Pump (copy 7)")).toBe("Pump");
  });

  it("leaves other names alone", () => {
    expect(stripCopySuffix("Pump (backup)")).toBe("Pump (backup)");
    expect(stripCopySuffix("  Pump  ")).toBe("Pump");
  });
});

describe("nextFreeUnitId", () => {
  it("returns 1 when nothing is used", () => {
    expect(nextFreeUnitId([])).toBe(1);
  });

  it("returns the lowest gap", () => {
    expect(nextFreeUnitId([1, 2, 4])).toBe(3);
  });

  it("skips past a contiguous block", () => {
    expect(nextFreeUnitId([2, 3])).toBe(1);
    expect(nextFreeUnitId([1, 2, 3])).toBe(4);
  });

  it("returns null when every Modbus unit id is taken", () => {
    const all = Array.from({ length: 247 }, (_, i) => i + 1);
    expect(nextFreeUnitId(all)).toBeNull();
  });
});
