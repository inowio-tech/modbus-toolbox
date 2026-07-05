import { describe, it, expect, beforeEach } from "vitest";
import { filterRegisters, EMPTY_FILTER, rwLabel, readColumns, writeColumns, DEFAULT_COLUMNS } from "./simFilters";

const reg = (o: Partial<any> = {}) => ({ id: 1, unitId: 1, functionCode: 3, address: 5, alias: "Temp", dataType: "u16", holdValue: 0, sortOrder: 0, valueSource: "hold", byteOrder: "ABCD", sourceParams: "{}", intervalMs: 1000, deviceInstanceId: null, ...o });

describe("filterRegisters", () => {
  const rows = [reg(), reg({ id: 2, unitId: 2, alias: "Volt", valueSource: "device", dataType: "f32" })];
  it("returns all with empty filter", () => expect(filterRegisters(rows, EMPTY_FILTER)).toHaveLength(2));
  it("filters by unit", () => expect(filterRegisters(rows, { ...EMPTY_FILTER, unit: 2 })).toHaveLength(1));
  it("filters by source", () => expect(filterRegisters(rows, { ...EMPTY_FILTER, source: "device" })[0].id).toBe(2));
  it("filters by type", () => expect(filterRegisters(rows, { ...EMPTY_FILTER, type: "f32" })[0].id).toBe(2));
  it("search matches alias case-insensitively", () => expect(filterRegisters(rows, { ...EMPTY_FILTER, search: "temp" })[0].id).toBe(1));
  it("search matches address", () => expect(filterRegisters(rows, { ...EMPTY_FILTER, search: "5" })).toHaveLength(2));
});

describe("rwLabel", () => {
  it("holding & coil are R/W", () => { expect(rwLabel(3)).toBe("R/W"); expect(rwLabel(1)).toBe("R/W"); });
  it("input & discrete are R", () => { expect(rwLabel(4)).toBe("R"); expect(rwLabel(2)).toBe("R"); });
});

describe("column prefs", () => {
  beforeEach(() => localStorage.clear());
  it("defaults when unset", () => expect(readColumns("ws")).toEqual(DEFAULT_COLUMNS));
  it("round-trips", () => { writeColumns("ws", ["unit", "value"]); expect(readColumns("ws")).toEqual(["unit", "value"]); });
});
